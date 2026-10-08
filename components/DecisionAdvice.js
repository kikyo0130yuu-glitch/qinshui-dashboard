(function (global) {
  'use strict';
  const STORAGE_KEY = 'qinshui-decision-ai-v1';
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const clean = (value, limit = 100) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
  const money = value => finite(value) ? '¥' + value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
  const count = value => finite(value) ? value.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : '—';
  const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : '';
  const ruleVersion = 'supply-chain-insight-v1.0';
  function normalizeEndpoint(value) {
    const text = clean(value, 2048); if (!text) return '';
    const url = new URL(text);
    if (url.username || url.password || url.hash) throw new Error('代理地址不能包含账号、密码或片段');
    for (const key of url.searchParams.keys()) if (/^(?:auth|sig|password|passwd|pwd|bearer|session|key)$|api[-_]?key|token|secret|authorization|credential|signature|access[-_]?key/i.test(key)) throw new Error('请勿将API密钥放入前端代理地址');
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('分析代理须使用HTTPS；本机服务可使用HTTP');
    return url.href;
  }
  function readStoredConfig() {
    const defaults = { endpoint: '', enabled: false, interval: 60 };
    try { const saved = JSON.parse(global.localStorage.getItem(STORAGE_KEY) || 'null');
      return saved && typeof saved === 'object' ? { endpoint: normalizeEndpoint(saved.endpoint), enabled: saved.enabled === true, interval: 60 } : defaults;
    } catch (_) { return defaults; }
  }
  const dependencyIds = new WeakMap(); let dependencySequence = 0;
  function dependencyId(value) { if (!value || typeof value !== 'object') return ''; if (!dependencyIds.has(value)) dependencyIds.set(value, ++dependencySequence); return dependencyIds.get(value); }
  function summary(input, factsResolver) {
    input = input || {}; let analysis = null, analysisError = '';
    try {
      if (input.analysisInput && global.SupplyChainAnalysis) analysis = factsResolver ? factsResolver(input.analysisInput, input.analysisConfig, input.analysisRevision) : global.SupplyChainAnalysis.analyze(input.analysisInput, input.analysisConfig);
      else if (input.analysis && Array.isArray(input.analysis.insights) && input.analysis.metrics && input.analysis.data_quality) analysis = input.analysis;
    } catch (error) { analysisError = clean(error.message, 150); }
    const number = value => finite(value) ? value : null, c = input.consumerMetrics || {}, window = c.window || {};
    // Raw orders, item rows, member names and member hashes do not leave the facts engine.
    return { businessDate: date(input.businessDate) || (analysis && analysis.business_date) || '', sourceDate: date(input.sourceDate),
      mode: clean(input.mode, 30), sourceKind: clean(input.sourceKind, 60), sourceVersion: clean(String(input.sourceVersion || ''), 160),
      updatedAt: clean(input.updatedAt, 60), salesAmount: number(input.salesAmount ?? input.netOrderSales), orderCount: number(input.orderCount),
      refundCount: number(input.refundCount), retailOrderSales: number(input.retailOrderSales), retailOrderCount: number(input.retailOrderCount),
      topOrderStores: (Array.isArray(input.topOrderStores) ? input.topOrderStores : []).slice(0, 3).map(x => ({ name: clean(x.name), amount: number(x.amount), count: number(x.count) })),
      consumerMetrics: { status: clean(c.status), sourceKind: clean(c.sourceKind), window: { start: date(window.start), end: date(window.end), days: number(window.days), complete: window.complete === true },
        counts: { identifiedCustomers: number((c.counts || {}).identifiedCustomers), purchaseOrders: number((c.counts || {}).purchaseOrders), repeatCustomers: number((c.counts || {}).repeatCustomers) } },
      analysis, analysisError };
  }
  function localAdvice(snapshot) {
    if (snapshot.analysis && global.SupplyChainAnalysis) return global.SupplyChainAnalysis.narrate(snapshot.analysis);
    const item = (type, label, text, emphasis, evidence, id) => ({ type, label, text, emphasis: emphasis || [], evidence,
      ruleId: id, ruleVersion, sources: [], dataQuality: snapshot.analysisError ? 'error' : 'limited' });
    const advice = [], x = snapshot;
    if (finite(x.salesAmount) && Number.isSafeInteger(x.orderCount) && x.orderCount >= 0) advice.push(item('stock', '销售态势', '当前订单销售' + money(x.salesAmount) + '、累计' + count(x.orderCount) + '单；按当前订单观察销售结构。',
      ['销售' + money(x.salesAmount)], ['当前订单销售：' + money(x.salesAmount), '当前累计订单：' + count(x.orderCount) + '单'], 'summary_sales'));
    const top = x.topOrderStores[0];
    if (top && finite(top.amount)) advice.push(item('plan', '门店贡献', top.name + '当前销售' + money(top.amount) + '；按当前订单观察门店贡献。', [top.name], [top.name + '当前销售：' + money(top.amount)], 'summary_store'));
    const c = x.consumerMetrics.counts, w = x.consumerMetrics.window;
    if (w.start && w.end && c.identifiedCustomers > 0 && Number.isSafeInteger(c.repeatCustomers) && c.repeatCustomers >= 0 && c.repeatCustomers <= c.identifiedCustomers
      && c.purchaseOrders >= c.identifiedCustomers + c.repeatCustomers) {
      const rate = Number((c.repeatCustomers / c.identifiedCustomers * 100).toFixed(2));
      advice.push(item('plan', '会员活跃', '统计窗口内' + count(c.repeatCustomers) + '人多次下单，占识别会员' + count(rate) + '%；观察重复购买表现。', ['多次下单'], ['多次下单会员：' + count(c.repeatCustomers) + '人', '多次下单会员占比：' + count(rate) + '%'], 'summary_member'));
    }
    return advice.slice(0, 4);
  }
  const presentationForbidden = /演示|回放|多日叠加|historical-order-replay|数据核验|净额/;
  function businessAdvice(item) { return item && item.type !== 'data' && item.ruleId !== 'data_quality' && !/数据核验/.test(item.label || '') && typeof item.text === 'string' && !presentationForbidden.test(item.text); }
  function identity(snapshot) { return JSON.stringify([snapshot.businessDate, snapshot.mode, snapshot.sourceKind, snapshot.sourceVersion]); }
  function fingerprint(snapshot) {
    const analysis = snapshot.analysis;
    return JSON.stringify([identity(snapshot), snapshot.salesAmount, snapshot.orderCount, snapshot.refundCount, snapshot.topOrderStores, snapshot.consumerMetrics,
      analysis && [[analysis.freshness.status, analysis.freshness.last_order_time], analysis.metrics, analysis.data_quality, analysis.history, analysis.forecast, analysis.stores, analysis.categories, analysis.products,
        analysis.insights.filter(x => ['weather_context', 'warehouse_configuration'].includes(x.signal_type)).map(x => [x.metrics, x.evidence, x.factors])], snapshot.analysisError]);
  }
  function appendEmphasis(element, text, values) {
    const terms = [...new Set((values || []).filter(value => typeof value === 'string' && value.length > 1 && value.length <= 32 && value !== text && text.includes(value)))].slice(0, 2).sort((a, b) => b.length - a.length);
    let cursor = 0;
    while (cursor < text.length) {
      let matchAt = text.length, match = '';
      for (const term of terms) { const position = text.indexOf(term, cursor); if (position >= 0 && position < matchAt) { matchAt = position; match = term; } }
      if (!match) { element.appendChild(document.createTextNode(text.slice(cursor))); break; }
      if (matchAt > cursor) element.appendChild(document.createTextNode(text.slice(cursor, matchAt)));
      const strong = document.createElement('strong'); strong.textContent = match; element.appendChild(strong); cursor = matchAt + match.length;
    }
  }
  function installMotion() {
    if (document.getElementById('decision-advice-motion')) return;
    const style = document.createElement('style'); style.id = 'decision-advice-motion';
    style.textContent = '.advice.is-updating{animation:decision-advice-refresh 1.2s ease-out}.advice-body{flex:1;min-width:0;display:flex;flex-direction:column}.advice-evidence{display:block;font-size:11px;line-height:16px;margin-top:3px;cursor:pointer;color:#a7bbcc;white-space:normal}.advice-evidence summary{outline-offset:2px}.advice-evidence p{margin:4px 0;line-height:1.55}.advice-evidence[open]{max-height:90px;overflow:auto}.advice.is-updating strong{animation:decision-value-refresh 1.2s ease-out}@keyframes decision-advice-refresh{0%{background:#3fbed725}100%{background:transparent}}@keyframes decision-value-refresh{0%{color:#fff;text-shadow:0 0 12px #52daf5}100%{text-shadow:none}}@media(prefers-reduced-motion:reduce){.advice.is-updating,.advice.is-updating strong{animation:none}}';
    document.head.appendChild(style);
  }
  class DecisionAdvice {
    constructor(container, options = {}) {
      if (!container || typeof container.replaceChildren !== 'function') throw new Error('决策建议容器不存在');
      this.container = container; this.statusElement = options.statusElement || null; this.configElements = options.configElements || {};
      this.offline = options.offline === true; this.config = this.offline ? { endpoint: '', enabled: false, interval: 60 } : readStoredConfig();
      this.analysisCache = null; this.performanceStats = { computationCount: 0, cacheHitCount: 0, lastDurationMs: 0 };
      this.latest = null; this.latestHash = ''; this.latestIdentity = ''; this.lastAI = null; this.sequence = 0; this.inflight = null;
      this.timer = null; this.lastRequestedAt = -Infinity; this.destroyed = false;
      this.handleSave = () => this.saveConfig(); this.onRefresh = typeof options.onRefresh === 'function' ? options.onRefresh : () => {};
      this.refreshTimer = global.setInterval(() => { this.onRefresh(); this.refreshAdvice(); }, 60000);
      if (this.configElements.save) this.configElements.save.addEventListener('click', this.handleSave);
      this.fillConfig(); installMotion(); this.status('本地事实规则；每60秒生成，语言模型未配置。');
    }
    fillConfig() { const x = this.configElements; if (x.endpoint) x.endpoint.value = this.config.endpoint; if (x.enabled) x.enabled.checked = this.config.enabled; if (x.interval) x.interval.value = '60'; }
    status(text) { if (this.statusElement) this.statusElement.textContent = text; }
    saveConfig() {
      if (this.offline) { this.status('本地事实规则每60秒生成；语言模型未配置。'); this.fillConfig(); return false; }
      const x = this.configElements;
      try { const next = { endpoint: normalizeEndpoint(x.endpoint ? x.endpoint.value : this.config.endpoint), enabled: x.enabled ? x.enabled.checked : this.config.enabled, interval: 60 };
        if (next.enabled && !next.endpoint) throw new Error('启用分析代理前请填写HTTPS地址');
        this.cancelRequest(); this.lastAI = null; this.config = next;
        try { global.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch (_) {}
        this.fillConfig(); this.refreshAdvice(); return true;
      } catch (error) { this.status(error.message || '分析配置无效'); return false; }
    }
    computeAnalysis(input, configuration, revision) {
      // History/mapping inputs are immutable snapshots; replace their array or increment revision after edits.
      // Current rows are fingerprinted each call so even a same-count correction invalidates the result.
      const source = input.source || {}, time = Date.parse(input.now || input.updatedAt || ''), key = JSON.stringify([
        input.businessDate, Math.floor(time / 60000), revision ?? input.revision ?? null,
        input.historyRevision ?? null, input.categoryRevision ?? null,
        [dependencyId(input.historyOrders), dependencyId(input.historyDetails), dependencyId(input.categoryMapping)],
        input.orders, input.details, input.historyCompleteDates, source.historyCompleteDates,
        [source.kind, source.updateCadence, source.sourceDates], input.categoryMappingSource,
        input.weather, input.consumerMetrics, input.warehouse, configuration || input.config
      ]);
      if (this.analysisCache && this.analysisCache.key === key) { this.performanceStats.cacheHitCount++; return this.analysisCache.analysis; }
      const start = Date.now(), analysis = global.SupplyChainAnalysis.analyze(input, configuration);
      this.performanceStats.computationCount++; this.performanceStats.lastDurationMs = Date.now() - start;
      this.analysisCache = { key, analysis }; return analysis;
    }
    getPerformance() { return { ...this.performanceStats }; }
    update(input) {
      if (this.destroyed) return;
      const snapshot = summary(input, (facts, configuration, revision) => this.computeAnalysis(facts, configuration, revision)), hash = fingerprint(snapshot), sourceIdentity = identity(snapshot);
      const changed = !this.latest || hash !== this.latestHash;
      if (changed) { this.cancelRequest(); this.lastAI = null; }
      this.latest = snapshot; this.latestHash = hash; this.latestIdentity = sourceIdentity;
      // New facts are visible immediately; a minute timer also regenerates against the newest input.
      if (changed) this.refreshAdvice();
    }
    refreshAdvice() {
      if (this.destroyed || !this.latest) return;
      if (!this.lastAI || this.lastAI.hash !== this.latestHash) this.render(localAdvice(this.latest), 'local-rules', this.latest);
      if (!this.config.enabled || !this.config.endpoint || !this.latest.analysis) {
        const freshness = this.latest.analysis && this.latest.analysis.freshness;
        const label = freshness && freshness.status === 'delayed' ? '数据延迟' : '当前数据';
        this.status('本地事实规则 · ' + label + ' · 每60秒生成；语言模型未配置。');
      }
      this.schedule();
    }
    render(advice, source, snapshot) {
      const fragment = document.createDocumentFragment();
      for (const item of advice.filter(businessAdvice).slice(0, 4)) {
        const card = document.createElement('div'); card.className = 'advice is-updating'; card.dataset.source = source;
        card.dataset.ruleId = item.ruleId || ''; card.dataset.ruleVersion = item.ruleVersion || ruleVersion;
        if (item.analysisId) card.dataset.analysisId = item.analysisId;
        card.title = (source === 'ai' ? '语言模型解读' : source === 'remote-rules' ? '远端事实规则' : '本地事实规则') + ' · ' + snapshot.updatedAt;
        const label = document.createElement('span'); label.className = 'advice-label ' + item.type; label.appendChild(document.createTextNode(item.label));
        const text = document.createElement('span'); text.className = 'advice-text'; appendEmphasis(text, item.text, item.emphasis);
        const body = document.createElement('div'); body.className = 'advice-body'; body.appendChild(text); card.append(label, body);
        const evidence = document.createElement('details'); evidence.className = 'advice-evidence';
        const toggle = document.createElement('summary'); toggle.textContent = '查看依据'; evidence.appendChild(toggle);
        const insight = snapshot.analysis && snapshot.analysis.insights.find(row => row.analysis_id === item.analysisId);
        const evidenceRows = insight && global.SupplyChainAnalysis ? global.SupplyChainAnalysis.presentationEvidence(insight, snapshot.analysis) : item.evidence || [];
        for (const row of evidenceRows) {
          if (typeof row !== 'string' || presentationForbidden.test(row)) continue;
          const paragraph = document.createElement('p'); paragraph.textContent = row; evidence.appendChild(paragraph);
        }
        body.appendChild(evidence); fragment.appendChild(card);
      }
      this.container.replaceChildren(fragment); this.container.dataset.analysisSource = source; this.container.dataset.updatedAt = snapshot.updatedAt;
      this.container.dataset.businessDate = snapshot.businessDate; this.container.dataset.sourceMode = snapshot.mode;
    }
    schedule() {
      if (this.offline || this.destroyed || !this.latest || !this.latest.analysis || !this.config.enabled || !this.config.endpoint || this.inflight || this.timer !== null) return;
      if (typeof global.fetch !== 'function') { this.status('分析请求不可用；继续显示本地事实规则。'); return; }
      const delay = Math.max(0, 60000 - (Date.now() - this.lastRequestedAt));
      if (delay === 0) this.request(); else this.timer = global.setTimeout(() => { this.timer = null; this.request(); }, delay);
    }
    async request() {
      if (this.offline || this.destroyed || this.inflight || !this.config.enabled || !this.latest || !this.latest.analysis) return;
      const snapshot = this.latest, hash = this.latestHash, sequence = ++this.sequence;
      const controller = typeof global.AbortController === 'function' ? new global.AbortController() : null;
      const task = { controller, sequence }; this.inflight = task; this.lastRequestedAt = Date.now(); let timeout = null;
      this.status('分析代理正在处理结构化事实；当前显示本地事实规则。');
      try {
        const deadline = new Promise((_, reject) => { timeout = global.setTimeout(() => { if (controller) controller.abort(); reject(new Error('分析请求超时')); }, 15000); });
        const call = (async () => {
          // IDs, metrics and evidence only. This object contains no original order/customer records.
          const response = await global.fetch(this.config.endpoint, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ schemaVersion: ruleVersion, analysis: global.SupplyChainAnalysis.proxyContext(snapshot.analysis), instructions: { selectEvidenceOnly: true, requireAnalysisId: true, businessAnalysisOnly: true, noDataQualityCards: true, noPresentationSourceLabels: true,
              noNewNumbers: true, noCausalClaims: true, noInventoryOrMarginClaims: true, includeDatesOnlyWhenNeeded: true, forbidTerm: '净额' } }), ...(controller ? { signal: controller.signal } : {}) });
          if (!response.ok) throw new Error('分析代理返回HTTP ' + response.status);
          const type = response.headers && response.headers.get ? response.headers.get('content-type') : '';
          if (type && !type.toLowerCase().includes('application/json')) throw new Error('分析代理须返回JSON');
          const payload = await response.json(), advice = global.SupplyChainAnalysis.validateNarration(payload, snapshot.analysis);
          return { advice, source: payload.narrationProvider === 'llm' && clean(payload.model, 100) ? 'ai' : 'remote-rules' };
        })();
        const result = await Promise.race([call, deadline]);
        if (this.destroyed || sequence !== this.sequence || hash !== this.latestHash) return;
        this.lastAI = { ...result, snapshot, hash }; this.render(result.advice, result.source, snapshot);
        this.status((result.source === 'ai' ? '语言模型依据解读' : '远端事实规则；未声明语言模型') + ' · ' + snapshot.updatedAt + ' · 每60秒生成。');
      } catch (error) {
        if (this.destroyed || sequence !== this.sequence || hash !== this.latestHash) return;
        this.lastAI = null; this.render(localAdvice(this.latest), 'local-rules', this.latest);
        this.status('分析代理未通过校验，已回退本地事实规则。' + clean(error.message, 100));
      } finally { if (timeout !== null) global.clearTimeout(timeout); if (this.inflight === task) this.inflight = null; }
    }
    getAnalysis() { return this.latest && this.latest.analysis || null; }
    cancelRequest() { this.sequence++; if (this.timer !== null) { global.clearTimeout(this.timer); this.timer = null; } if (this.inflight && this.inflight.controller) this.inflight.controller.abort(); this.inflight = null; }
    destroy() { this.destroyed = true; this.analysisCache = null; this.cancelRequest(); global.clearInterval(this.refreshTimer); if (this.configElements.save) this.configElements.save.removeEventListener('click', this.handleSave); }
  }
  global.DecisionAdvice = DecisionAdvice;
})(window);
