#!/usr/bin/env node
'use strict';
// This adapter runs on GitHub. The private key is read only from Actions Secrets.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const backend = require('./weather-service.cjs');
const MONTHLY_CAP = 100;
const fail = code => { throw new Error(code); };

function validateLedger(ledger) {
  if (!ledger || ledger.version !== 1 || !ledger.requests || Array.isArray(ledger.requests) ||
      Object.entries(ledger.requests).some(([month, count]) => !/^\d{4}-\d{2}$/.test(month) || !Number.isSafeInteger(count) || count < 0)) fail('request_ledger_invalid');
  return ledger;
}
function credentials(env) {
  let privateKey;
  try { privateKey = crypto.createPrivateKey(env.QWEATHER_PRIVATE_KEY || ''); } catch { fail('private_key_missing_or_invalid'); }
  if (privateKey.asymmetricKeyType !== 'ed25519') fail('private_key_must_be_ed25519');
  const config = backend.normalizeConfig({}, process.cwd(), env);
  if (!config.apiHost || ['developerId', 'projectId', 'credentialId'].some(key => !/^[a-zA-Z0-9_-]{1,80}$/.test(config[key]))) fail('weather_secrets_missing');
  return { privateKey, config };
}
function reserve(ledger, runId, now = Date.now()) {
  validateLedger(ledger);
  if (!runId) fail('run_id_missing');
  const month = backend.monthAt(now), before = ledger.requests[month] || 0;
  if (before + 2 > MONTHLY_CAP) fail('monthly_request_cap_reached');
  // A previous interrupted run stays counted. Never refund its reservation.
  return { ...ledger, requests: { ...ledger.requests, [month]: before + 2 },
    pending: { runId, month, before, allocation: 2, reservedAt: new Date(now).toISOString() } };
}
function cacheFromSnapshot(snapshot) {
  const cache = {};
  if (snapshot?.provider !== 'qweather') return cache;
  if (snapshot.current && Number.isFinite(Date.parse(snapshot.currentFetchedAt)))
    cache.current = { fetchedAt: snapshot.currentFetchedAt, data: snapshot.current, attributions: snapshot.attributions || [] };
  if (snapshot.days?.length === 7 && Number.isFinite(Date.parse(snapshot.dailyFetchedAt)))
    cache.daily = { fetchedAt: snapshot.dailyFetchedAt, data: snapshot.days, attributions: snapshot.attributions || [] };
  return cache;
}
async function refresh({ ledger, snapshot, runId, env, now = Date.now, fetchImpl }) {
  validateLedger(ledger);
  const moment = now(), month = backend.monthAt(moment), pending = ledger.pending;
  if (!pending || pending.runId !== runId || pending.month !== month || pending.allocation !== 2 ||
      !Number.isSafeInteger(pending.before) || pending.before < 0 || ledger.requests[month] !== pending.before + 2 || ledger.requests[month] > MONTHLY_CAP) fail('reservation_missing_or_invalid');
  const { privateKey, config } = credentials(env);
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qinshui-weather-'));
  try {
    config.stateDir = stateDir;
    config.freeGroupBudget = {
      verifiedMonth: month, verifiedAt: new Date(moment).toISOString(),
      verifiedRemainingRequests: 50000 - pending.before, baselineProjectRequests: 0,
      allocatedRequests: MONTHLY_CAP, reserveRequests: 100, otherConsumersStopped: true,
      authorizationBasis: 'User confirmed this is the only calling project; requests tracked in repository ledger. Console usage was not inspected.'
    };
    await fs.writeFile(path.join(stateDir, 'state.json'), JSON.stringify({ version: 1,
      requests: { ...ledger.requests, [month]: pending.before }, cache: cacheFromSnapshot(snapshot), attempts: {} }), { mode: 0o600 });
    const service = backend.createWeatherService(config, { now, privateKey, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
    const result = await service.getWeather();
    const state = JSON.parse(await fs.readFile(path.join(stateDir, 'state.json'), 'utf8'));
    const requestsMade = state.requests[month] - pending.before;
    if (requestsMade < 0 || requestsMade > 2) fail('unexpected_request_count');
    const nextLedger = { ...ledger, lastResult: { runId, month, status: result.status, requestsMade,
      completedAt: new Date(now()).toISOString() } };
    delete nextLedger.pending;
    // Keep both reserved calls counted, including errors, cancellation and cache hits.
    return { snapshot: result, ledger: nextLedger };
  } finally { await fs.rm(stateDir, { recursive: true, force: true }); }
}
async function writeJSON(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.tmp';
  await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n');
  await fs.rename(temp, file);
}
async function cli() {
  const root = path.resolve(__dirname, '..'), ledgerFile = path.join(__dirname, 'request-ledger.json');
  const runId = `${process.env.GITHUB_RUN_ID || ''}:${process.env.GITHUB_RUN_ATTEMPT || ''}`;
  if (!process.env.GITHUB_RUN_ID || !process.env.GITHUB_RUN_ATTEMPT) fail('must_run_in_github_actions');
  credentials(process.env); // Fail before committing a reservation if Secrets are missing.
  const ledger = validateLedger(JSON.parse(await fs.readFile(ledgerFile, 'utf8')));
  if (process.argv[2] === '--reserve') {
    const next = reserve(ledger, runId);
    await writeJSON(ledgerFile, next);
    console.log(`Weather requests reserved: ${next.requests[next.pending.month]}/${MONTHLY_CAP}`);
    return;
  }
  if (process.argv[2] !== '--refresh') fail('expected_reserve_or_refresh');
  const snapshotFile = path.join(root, 'data/weather-latest.json');
  const snapshot = JSON.parse(await fs.readFile(snapshotFile, 'utf8'));
  const result = await refresh({ ledger, snapshot, runId, env: process.env });
  await writeJSON(ledgerFile, result.ledger);
  await writeJSON(snapshotFile, result.snapshot);
  await fs.writeFile(path.join(root, 'weather-data.js'), 'window.WEATHER_DATA=' + JSON.stringify(result.snapshot).replaceAll('<', '\\u003c') + ';\n');
  console.log(`Weather refresh: ${result.snapshot.status}; calls made: ${result.ledger.lastResult.requestsMade}`);
  if (result.snapshot.status !== 'ok') process.exitCode = 2;
}
module.exports = { MONTHLY_CAP, validateLedger, credentials, reserve, cacheFromSnapshot, refresh };
if (require.main === module) cli().catch(() => { console.error('Weather refresh failed. Check Secrets, API access and the request ledger; no credentials are logged.'); process.exitCode = 1; });
