#!/usr/bin/env node
'use strict';

// Node 20+, built-in modules only. Credentials and quota ledgers stay on the server.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');

const LOCATION = Object.freeze({ name: '沁水县', longitude: 112.14, latitude: 35.72, coordinateSystem: 'WGS84' });
const MONTHLY_CAP = 6000;
const FREE_GROUP_CAP = 50000;
const TTL = Object.freeze({ current: 600000, daily: 3600000 });
const DIRECTIONS = Object.freeze({ n: '北风', nne: '北东北风', ne: '东北风', ene: '东东北风', e: '东风', ese: '东东南风', se: '东南风', sse: '南东南风', s: '南风', ssw: '南西南风', sw: '西南风', wsw: '西西南风', w: '西风', wnw: '西西北风', nw: '西北风', nnw: '北西北风', none: '静风', vrb: '风向不定' });

class WeatherError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new WeatherError(code); };
const numberOrNull = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const textOrNull = value => typeof value === 'string' && value.length <= 160 ? value : null;
function fractionPercent(value) {
  return typeof value === 'number' && value >= 0 && value <= 1 ? Math.round(value * 1000) / 10 : null;
}
function measurement(value, unit) {
  return value && value.unit === unit ? numberOrNull(value.value) : null;
}
function normalizeCurrent(payload) {
  const compass = payload?.wind?.direction?.compass;
  return {
    observedAt: null, // The v1 current response does not provide an observation timestamp.
    temperature: measurement(payload?.temperature, '°C'),
    conditionText: textOrNull(payload?.condition?.text),
    conditionCode: textOrNull(payload?.condition?.code),
    humidityPercent: fractionPercent(payload?.humidity),
    windScale: numberOrNull(payload?.wind?.scale),
    windDirectionText: Object.hasOwn(DIRECTIONS, compass) ? DIRECTIONS[compass] : null
  };
}
function normalizeDaily(payload) {
  if (!Array.isArray(payload?.days)) return [];
  return payload.days.slice(0, 7).map(day => ({
    date: typeof day.forecastStartTime === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(day.forecastStartTime) ? day.forecastStartTime.slice(0, 10) : null,
    high: measurement(day.temperatureMax, '°C'),
    low: measurement(day.temperatureMin, '°C'),
    conditionText: textOrNull(day.daytime?.condition?.text),
    precipitationProbabilityPercent: fractionPercent(day.daytime?.precipitation?.probability),
    dayPrecipitationMm: measurement(day.daytime?.precipitation?.amount, 'mm'),
    windScale: numberOrNull(day.daytime?.wind?.scale)
  }));
}
function attributions(payload) {
  return Array.isArray(payload?.metadata?.attributions)
    ? payload.metadata.attributions.filter(value => typeof value === 'string' && value.length <= 2000)
    : [];
}
function monthAt(milliseconds = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).formatToParts(new Date(milliseconds));
  return `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}`;
}
function parseInteger(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return null;
}
function resolveFile(base, value, fallback) {
  return path.resolve(base, value || fallback);
}
function normalizeConfig(input = {}, base = process.cwd(), env = process.env) {
  let allowedOrigins = input.allowedOrigins || [];
  if (env.WEATHER_ALLOWED_ORIGINS) {
    try { allowedOrigins = JSON.parse(env.WEATHER_ALLOWED_ORIGINS); } catch { fail('invalid_cors_config'); }
  }
  if (!Array.isArray(allowedOrigins) || allowedOrigins.some(origin => {
    try { const url = new URL(origin); return url.origin !== origin || !['http:', 'https:'].includes(url.protocol); } catch { return true; }
  })) fail('invalid_cors_config');
  const apiHost = env.QWEATHER_API_HOST || input.apiHost || input.host || '';
  if (apiHost && !/^[a-z0-9-]+(?:\.re)?\.qweatherapi\.com$/i.test(apiHost)) fail('invalid_api_host');
  if (input.location && (input.location.longitude !== LOCATION.longitude || input.location.latitude !== LOCATION.latitude || (input.location.coordinateSystem && input.location.coordinateSystem !== 'WGS84'))) fail('unexpected_location');
  const freeGroupBudget = { ...(input.freeGroupBudget || {}) };
  if (env.WEATHER_FREE_BUDGET_JSON) {
    try { Object.assign(freeGroupBudget, JSON.parse(env.WEATHER_FREE_BUDGET_JSON)); } catch { fail('invalid_quota_config'); }
  }
  const port = parseInteger(env.PORT || input.port) ?? 8787;
  if (port < 0 || port > 65535) fail('invalid_port');
  return {
    apiHost,
    developerId: env.QWEATHER_DEVELOPER_ID || input.developerId || '',
    projectId: env.QWEATHER_PROJECT_ID || input.projectId || '',
    credentialId: env.QWEATHER_CREDENTIAL_ID || input.credentialId || '',
    privateKeyFile: resolveFile(base, env.QWEATHER_PRIVATE_KEY_FILE || input.privateKeyFile, 'private.pem'),
    stateDir: resolveFile(base, env.WEATHER_STATE_DIR || input.stateDir, 'weather-state'),
    outputFile: resolveFile(base, env.WEATHER_OUTPUT_FILE || input.outputFile, 'weather-latest.json'),
    allowedOrigins,
    bind: input.bind || '127.0.0.1',
    port,
    freeGroupBudget
  };
}
async function loadConfig(file, env = process.env) {
  if (!file) return normalizeConfig({}, process.cwd(), env);
  let input;
  try { input = JSON.parse(await fs.readFile(file, 'utf8')); } catch { fail('config_unreadable'); }
  return normalizeConfig(input, path.dirname(path.resolve(file)), env);
}
async function atomicJSON(file, value, mode = 0o600) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode, flag: 'wx' });
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
}
function emptyState() { return { version: 1, requests: {}, cache: {}, attempts: {} }; }
async function readState(file) {
  try {
    const state = JSON.parse(await fs.readFile(file, 'utf8'));
    if (state.version !== 1 || !state.requests || !state.cache || !state.attempts || Object.entries(state.requests).some(([month, count]) => !/^\d{4}-\d{2}$/.test(month) || !Number.isSafeInteger(count) || count < 0)) fail('state_invalid');
    return state;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    fail('state_invalid');
  }
}
async function withStateLock(stateDir, operation) {
  await fs.mkdir(stateDir, { recursive: true, mode: 0o700 });
  const lockFile = path.join(stateDir, 'update.lock');
  let lock;
  try { lock = await fs.open(lockFile, 'wx', 0o600); } catch { fail('state_locked'); }
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    return await operation();
  } finally {
    await lock.close();
    await fs.rm(lockFile, { force: true });
  }
}
function quotaAllowance(config, state, now) {
  const month = monthAt(now);
  const budget = config.freeGroupBudget;
  const verifiedAt = Date.parse(budget.verifiedAt);
  if (budget.verifiedMonth !== month || !Number.isFinite(verifiedAt) || monthAt(verifiedAt) !== month || verifiedAt > now + 60000) fail('quota_unverified');
  if (budget.otherConsumersStopped !== true) fail('shared_quota_not_isolated');
  const remaining = parseInteger(budget.verifiedRemainingRequests);
  const allocated = parseInteger(budget.allocatedRequests);
  const reserve = parseInteger(budget.reserveRequests);
  const baseline = parseInteger(budget.baselineProjectRequests);
  if ([remaining, allocated, reserve, baseline].some(value => value === null || value < 0) || remaining > FREE_GROUP_CAP || allocated > remaining - reserve) fail('invalid_quota_config');
  const consumed = state.requests[month] ?? 0;
  if (consumed < baseline) fail('accounting_inconsistent');
  if (consumed >= MONTHLY_CAP) fail('project_monthly_cap');
  if (consumed - baseline >= allocated) fail('free_allocation_exhausted');
  return month;
}
async function createJWT(config, now, privateKeyOverride) {
  for (const name of ['developerId', 'projectId', 'credentialId']) if (!/^[a-zA-Z0-9_-]{1,80}$/.test(config[name])) fail('auth_unconfigured');
  let privateKey;
  try {
    privateKey = privateKeyOverride || crypto.createPrivateKey(await fs.readFile(config.privateKeyFile));
    if (privateKey.asymmetricKeyType !== 'ed25519') fail('invalid_private_key');
  } catch { fail('invalid_private_key'); }
  const seconds = Math.floor(now / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: config.credentialId })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: config.developerId, sub: config.projectId, iat: seconds - 30, exp: seconds + 300 })).toString('base64url');
  const message = `${header}.${payload}`;
  return `${message}.${crypto.sign(null, Buffer.from(message), privateKey).toString('base64url')}`;
}
function validatePayload(kind, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !payload.metadata) fail('unexpected_upstream_response');
  if (kind === 'current' && normalizeCurrent(payload).temperature === null) fail('unexpected_upstream_response');
  if (kind === 'daily') {
    const days = normalizeDaily(payload);
    if (!Array.isArray(payload.days) || payload.days.length !== 7) fail('unexpected_upstream_response');
    let previous;
    for (let i = 0; i < days.length; i += 1) {
      const day = days[i];
      const startTime = payload.days[i].forecastStartTime;
      const dateTime = Date.parse(`${day.date}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(startTime) || !Number.isFinite(Date.parse(startTime)) || !Number.isFinite(dateTime) || new Date(dateTime).toISOString().slice(0, 10) !== day.date || (previous !== undefined && dateTime - previous !== 86400000) || day.high === null || day.low === null || day.high < day.low) fail('unexpected_upstream_response');
      previous = dateTime;
    }
  }
}
async function fetchJSON(url, token, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(8000), redirect: 'error' });
  } catch { fail('upstream_unavailable'); }
  if (!response.ok) fail(`upstream_http_${response.status}`);
  try {
    if (Number(response.headers.get('content-length')) > 1048576) fail('upstream_response_too_large');
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 1048576) { await reader.cancel(); fail('upstream_response_too_large'); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof WeatherError) throw error;
    fail('upstream_invalid_json');
  }
}
function makeSnapshot(state, errors = [], now = Date.now()) {
  const current = state?.cache.current;
  const daily = state?.cache.daily;
  const complete = Boolean(current && daily);
  const expired = complete && (now - Date.parse(current.fetchedAt) >= TTL.current || now - Date.parse(daily.fetchedAt) >= TTL.daily);
  const times = [current?.fetchedAt, daily?.fetchedAt].filter(Boolean).sort();
  return {
    snapshotVersion: '1.0',
    status: complete ? (errors.length || expired ? 'stale' : 'ok') : 'unavailable',
    provider: 'qweather', location: { ...LOCATION },
    fetchedAt: times.at(-1) || null,
    currentFetchedAt: current?.fetchedAt || null,
    dailyFetchedAt: daily?.fetchedAt || null,
    current: current?.data || null, days: daily?.data || [],
    attributions: [...new Set([...(current?.attributions || []), ...(daily?.attributions || [])])],
    errors
  };
}
function createWeatherService(config, options = {}) {
  const now = options.now || Date.now;
  const fetchImpl = options.fetch || globalThis.fetch;
  const stateFile = path.join(config.stateDir, 'state.json');
  let pending;
  async function update() {
    let state;
    try {
      return await withStateLock(config.stateDir, async () => {
        state = await readState(stateFile);
        if (!state) fail('accounting_uninitialized');
        const errors = [];
        for (const kind of ['current', 'daily']) {
          const moment = now();
          if (state.cache[kind] && moment - Date.parse(state.cache[kind].fetchedAt) < TTL[kind]) continue;
          if (state.attempts[kind] && moment - Date.parse(state.attempts[kind]) < TTL[kind]) {
            errors.push({ code: 'refresh_cooldown', component: kind }); continue;
          }
          try {
            const month = quotaAllowance(config, state, moment);
            if (!config.apiHost) fail('auth_unconfigured');
            const token = await createJWT(config, moment, options.privateKey);
            const endpoint = `https://${config.apiHost}/weather/v1/${kind}/${LOCATION.latitude.toFixed(2)}/${LOCATION.longitude.toFixed(2)}`;
            const url = `${endpoint}?${kind === 'daily' ? 'days=7&' : ''}localTime=true&lang=zh`;
            // Reserve and persist BEFORE sending. Failed and interrupted requests still count.
            state.requests[month] = (state.requests[month] || 0) + 1;
            state.attempts[kind] = new Date(moment).toISOString();
            await atomicJSON(stateFile, state);
            const payload = await fetchJSON(url, token, fetchImpl);
            validatePayload(kind, payload);
            state.cache[kind] = { fetchedAt: new Date(now()).toISOString(), data: kind === 'current' ? normalizeCurrent(payload) : normalizeDaily(payload), attributions: attributions(payload) };
            await atomicJSON(stateFile, state);
          } catch (error) {
            errors.push({ code: error instanceof WeatherError ? error.code : 'refresh_failed', component: kind });
          }
        }
        return makeSnapshot(state, errors, now());
      });
    } catch (error) {
      // A concurrent process or damaged ledger never triggers an uncounted request.
      if (!state) state = await readState(stateFile).catch(() => null);
      return makeSnapshot(state, [{ code: error instanceof WeatherError ? error.code : 'state_unavailable' }], now());
    }
  }
  return {
    getWeather() {
      if (!pending) pending = update().finally(() => { pending = null; });
      return pending;
    },
    async publish(outputFile = config.outputFile) {
      const result = await this.getWeather();
      // Re-read and publish while holding the same cross-process lock. A caller
      // that observed an older cache cannot overwrite a newer published update.
      return withStateLock(config.stateDir, async () => {
        const state = await readState(stateFile);
        if (!state) return result; // Lost accounting must not erase the last public file.
        const unchanged = result.currentFetchedAt === state.cache.current?.fetchedAt && result.dailyFetchedAt === state.cache.daily?.fetchedAt;
        const snapshot = makeSnapshot(state, unchanged ? result.errors : [], now());
        await atomicJSON(outputFile, snapshot, 0o644);
        return snapshot;
      });
    },
    async readCached() { return makeSnapshot(await readState(stateFile), [], now()); }
  };
}
async function importRaw(config, currentFile, dailyFile, outputFile, seedRequestCount) {
  const readRaw = async file => {
    let raw;
    try { raw = JSON.parse(await fs.readFile(file, 'utf8')); } catch { fail('raw_input_unreadable'); }
    if (raw.payload) {
      if (raw.httpStatus !== 200 || !Number.isFinite(Date.parse(raw.fetchedAt))) fail('raw_input_invalid');
      return { payload: raw.payload, fetchedAt: raw.fetchedAt };
    }
    fail('raw_input_requires_fetch_timestamp');
  };
  const [current, daily] = await Promise.all([readRaw(currentFile), readRaw(dailyFile)]);
  validatePayload('current', current.payload); validatePayload('daily', daily.payload);
  return withStateLock(config.stateDir, async () => {
    const stateFile = path.join(config.stateDir, 'state.json');
    const existing = await readState(stateFile);
    if (!existing && seedRequestCount === undefined) fail('accounting_uninitialized');
    const state = existing || emptyState();
    if (seedRequestCount !== undefined) {
      const count = parseInteger(seedRequestCount);
      if (count === null || count < 0) fail('invalid_seed_count');
      const month = monthAt(Date.parse(current.fetchedAt));
      if (monthAt(Date.parse(daily.fetchedAt)) !== month) fail('raw_input_month_mismatch');
      state.requests[month] = Math.max(state.requests[month] || 0, count);
    }
    for (const [kind, raw] of [['current', current], ['daily', daily]]) {
      if (state.cache[kind] && Date.parse(state.cache[kind].fetchedAt) > Date.parse(raw.fetchedAt)) continue;
      state.cache[kind] = { fetchedAt: raw.fetchedAt, data: kind === 'current' ? normalizeCurrent(raw.payload) : normalizeDaily(raw.payload), attributions: attributions(raw.payload) };
      state.attempts[kind] = raw.fetchedAt;
    }
    await atomicJSON(stateFile, state);
    // Offline import labels freshness honestly; it never creates an observation time.
    const snapshot = makeSnapshot(state);
    await atomicJSON(outputFile || config.outputFile, snapshot, 0o644);
    return snapshot;
  });
}
function createRequestHandler(config, service) {
  return async (request, response) => {
    const send = (status, payload) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify(payload));
    };
    const origin = request.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin)) return send(403, { error: 'origin_not_allowed' });
    if (origin) { response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Vary', 'Origin'); }
    if (request.method !== 'GET') return send(405, { error: 'method_not_allowed' });
    // Exact paths only: no query parameters, arbitrary coordinates or upstream URLs.
    if (request.url === '/health') return send(200, { status: 'ready', provider: 'qweather' });
    if (request.url !== '/api/weather') return send(404, { error: 'not_found' });
    try {
      const snapshot = await service.getWeather();
      return send(snapshot.status === 'unavailable' ? 503 : 200, snapshot);
    } catch { return send(503, { status: 'unavailable', provider: 'qweather', error: 'weather_unavailable' }); }
  };
}
function startServer(config, service) {
  const server = http.createServer(createRequestHandler(config, service));
  server.listen(config.port, config.bind);
  return server;
}
async function cli(args = process.argv.slice(2)) {
  const value = flag => { const index = args.indexOf(flag); if (index === -1) return undefined; if (!args[index + 1] || args[index + 1].startsWith('--')) fail('missing_cli_argument'); return args[index + 1]; };
  const config = await loadConfig(value('--config'));
  const outputFile = value('--output') ? path.resolve(value('--output')) : config.outputFile;
  if (args.includes('--from-raw-current') || args.includes('--from-raw-daily')) {
    if (!value('--from-raw-current') || !value('--from-raw-daily')) fail('both_raw_inputs_required');
    const snapshot = await importRaw(config, value('--from-raw-current'), value('--from-raw-daily'), outputFile, value('--seed-request-count'));
    console.log(JSON.stringify({ status: snapshot.status, mode: 'offline-import' })); return;
  }
  const service = createWeatherService(config);
  if (args.includes('--once')) {
    const snapshot = await service.publish(outputFile);
    console.log(JSON.stringify({ status: snapshot.status, errors: snapshot.errors }));
    if (snapshot.status !== 'ok') process.exitCode = 2;
    return;
  }
  if (!args.includes('--serve')) fail('select_once_serve_or_raw_import');
  const server = startServer(config, service);
  server.on('listening', () => console.log(JSON.stringify({ status: 'listening', port: server.address().port })));
  server.on('error', () => { console.error('weather_server_unavailable'); process.exitCode = 1; });
}

module.exports = { LOCATION, TTL, monthAt, normalizeCurrent, normalizeDaily, normalizeConfig, loadConfig, quotaAllowance, createJWT, createWeatherService, importRaw, createRequestHandler, startServer, cli };
if (require.main === module) cli().catch(error => { console.error(error instanceof WeatherError ? error.code : 'weather_operation_failed'); process.exitCode = 1; });
