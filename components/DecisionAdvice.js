(function (global) {
  'use strict';

  const STORAGE_KEY = 'qinshui-decision-ai-v1';
  const ALLOWED_TYPES = new Set(['stock', 'data', 'plan', 'forecast']);
  const MONEY = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const amount = (value) => finite(value) ? '¥' + MONEY.format(value) : '—';
  const count = (value) => finite(value) ? Math.max(0, Math.round(value)).toLocaleString('zh-CN') : '—';
  const clean = (value, limit = 80) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
  const DISPLAY_LABELS = { stock: '门店', data: '运营', plan: '拓展', forecast: '配送' };

  // Presentation only: source mode, composition, amounts and proxy request provenance stay intact.
  function displayText(value) {
    let text = value.replace(/[（(]\s*含基数\s*[）)]/g, '').replace(/演示|含基数/g, '');
    let previous;
    do { previous = text; text = text.replace(/[（(]\s*[）)]/g, ''); } while (text !== previous);
    return text.replace(/[ \t]{2,}/g, ' ').trim();
  }

  function displayAdvice(item) {
    const text = displayText(item.text) || '建议内容待补充，请结合业务核验。';
    const label = displayText(item.label) || DISPLAY_LABELS[item.type] || '建议';
    const emphasis = Array.isArray(item.emphasis) ? [...new Set(item.emphasis.filter((value) => typeof value === 'string')
      .map(displayText).filter((value) => value && value !== '—' && value !== text && text.includes(value)))] : [];
    return { ...item, label, text, emphasis };
  }

  function intervalSeconds(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(30, Math.min(300, Math.round(number))) : 30;
  }

  function normalizeEndpoint(value) {
    const text = clean(value, 2048);
    if (!text) return '';
    const url = new URL(text);
    if (url.username || url.password || url.hash) throw new Error('代理地址不能包含账号、密码或片段');
    for (const key of url.searchParams.keys()) {
      if (/api[-_]?key|token|secret|authorization|access[-_]?key/i.test(key)) throw new Error('请勿将 API 密钥放入前端代理地址');
    }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
      throw new Error('AI 代理须使用 HTTPS；本机 localhost 服务可使用 HTTP');
    }
    return url.href;
  }

  function readStoredConfig() {
    const defaults = { endpoint: '', enabled: false, interval: 30 };
    try {
      const saved = JSON.parse(global.localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved || typeof saved !== 'object') return defaults;
      return { endpoint: normalizeEndpoint(saved.endpoint), enabled: saved.enabled === true, interval: intervalSeconds(saved.interval) };
    } catch (_) {
      return defaults;
    }
  }

  // Only the summary schema below may be sent to an AI proxy. Raw orders and customer data are excluded.
  function summary(input) {
    const source = input && typeof input === 'object' ? input : {};
    const number = (value) => finite(value) ? value : null;
    const order = source.recentOrder && typeof source.recentOrder === 'object' ? {
      name: clean(source.recentOrder.name), amount: number(source.recentOrder.amount)
    } : null;
    const stores = Array.isArray(source.topOrderStores) ? source.topOrderStores.slice(0, 3).map((store) => ({
      name: clean(store && store.name), amount: number(store && store.amount), count: number(store && store.count)
    })).filter((store) => store.name) : [];
    return {
      businessDate: clean(source.businessDate, 20), mode: clean(source.mode, 30),
      sourceKind: clean(source.sourceKind, 60), sourceVersion: clean(String(source.sourceVersion || ''), 120),
      displayComposition: clean(source.displayComposition, 40), baselineSales: number(source.baselineSales),
      updatedAt: clean(source.updatedAt, 40), displayedSales: number(source.displayedSales),
      retail: number(source.retail), netOrderSales: number(source.netOrderSales), retailOrderSales: number(source.retailOrderSales), orderCount: number(source.orderCount),
      retailOrderCount: number(source.retailOrderCount), averageOrder: number(source.averageOrder),
      refundCount: number(source.refundCount), recentOrder: order, topOrderStores: stores,
      logistics: {
        active: number(source.logistics && source.logistics.active), total: number(source.logistics && source.logistics.total),
        ratio: number(source.logistics && source.logistics.ratio), source: clean(source.logistics && source.logistics.source, 40)
      },
      plans: { octStores: number(source.plans && source.plans.octStores), octLogistics: number(source.plans && source.plans.octLogistics), source: clean(source.plans && source.plans.source, 40) }
    };
  }

  function fingerprint(snapshot) {
    // A clock update alone must not send another request or falsely animate a data change.
    const { updatedAt, ...businessValues } = snapshot;
    return JSON.stringify(businessValues);
  }

  function identity(snapshot) {
    return JSON.stringify([snapshot.businessDate, snapshot.mode, snapshot.sourceKind, snapshot.sourceVersion]);
  }

  function localAdvice(snapshot) {
    const orderCount = count(snapshot.orderCount);
    const sales = amount(snapshot.displayedSales);
    const aov = amount(snapshot.averageOrder);
    const refund = snapshot.refundCount > 0 ? `含${count(snapshot.refundCount)}笔负额订单，建议关注净额变化。` : `零售客单价${aov}，关注订单与销售进度。`;
    const salesText = snapshot.displayComposition === 'baseline-plus-replay'
      ? `销售额${sales}，已累计订单净额${amount(snapshot.netOrderSales)}，${orderCount}单。`
      : `订单净额${amount(snapshot.netOrderSales)}，累计${orderCount}单。`;
    const top = snapshot.topOrderStores[0];
    const recent = snapshot.recentOrder;
    const storeText = recent && recent.name
      ? `最新订单：${recent.name}，净额${amount(recent.amount)}；建议关注门店销售与备货衔接。`
      : top ? `${top.name}累计销售${amount(top.amount)}，建议关注门店销售与备货衔接。`
        : '当前暂无订单门店数据；建议在导入后核对门店销售与备货安排。';
    const active = count(snapshot.logistics.active), total = count(snapshot.logistics.total);
    const ratio = snapshot.logistics.total > 0 && finite(snapshot.logistics.active)
      ? (snapshot.logistics.active / snapshot.logistics.total * 100).toFixed(2) + '%' : '—';
    const stores = count(snapshot.plans.octStores), posts = count(snapshot.plans.octLogistics);
    return [
      { type: 'data', label: '运营', text: salesText + refund, emphasis: [sales, amount(snapshot.netOrderSales), orderCount + '单', aov] },
      { type: 'stock', label: '门店', text: storeText, emphasis: [recent && recent.name || top && top.name || '', recent ? amount(recent.amount) : top ? amount(top.amount) : ''].filter(Boolean) },
      { type: 'forecast', label: '配送', text: `活跃配送网点${active}个 / 后勤网点${total}个，占比${ratio}；建议核对网点服务与配送安排。`, emphasis: [active + '个', total + '个', ratio] },
      { type: 'plan', label: '拓展', text: `10月预估新增门店${stores}家、后勤网点${posts}个；建议核对开业和配送资源安排。`, emphasis: [stores + '家', posts + '个'] }
    ];
  }

  function validateAIAdvice(payload) {
    if (!payload || !Array.isArray(payload.advice) || payload.advice.length < 1 || payload.advice.length > 4) {
      throw new Error('AI 返回的建议列表无效');
    }
    return payload.advice.map((item) => {
      if (!item || typeof item !== 'object' || !ALLOWED_TYPES.has(item.type)
        || typeof item.label !== 'string' || !item.label.trim() || item.label.length > 12
        || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 180) {
        throw new Error('AI 返回的建议字段无效');
      }
      const text = item.text.trim();
      const emphasis = Array.isArray(item.emphasis) ? item.emphasis.filter((value) => typeof value === 'string'
        && value.length > 0 && value.length <= 40 && value.trim() !== text && text.includes(value)).slice(0, 8) : [];
      return displayAdvice({ type: item.type, label: item.label.trim(), text, emphasis });
    });
  }

  function appendEmphasis(element, text, emphasis) {
    const terms = [...new Set(emphasis)].filter((term) => term && term !== '—').sort((a, b) => b.length - a.length);
    let cursor = 0;
    while (cursor < text.length) {
      let matchAt = text.length, match = '';
      for (const term of terms) {
        const position = text.indexOf(term, cursor);
        if (position >= 0 && (position < matchAt || position === matchAt && term.length > match.length)) {
          matchAt = position; match = term;
        }
      }
      if (!match) { element.appendChild(document.createTextNode(text.slice(cursor))); break; }
      if (matchAt > cursor) element.appendChild(document.createTextNode(text.slice(cursor, matchAt)));
      const strong = document.createElement('strong'); strong.textContent = match; element.appendChild(strong);
      cursor = matchAt + match.length;
    }
  }

  function installMotion() {
    if (document.getElementById('decision-advice-motion')) return;
    const style = document.createElement('style'); style.id = 'decision-advice-motion';
    style.textContent = '.advice.is-updating{animation:decision-advice-refresh 1.2s ease-out}.advice.is-updating strong{animation:decision-value-refresh 1.2s ease-out}@keyframes decision-advice-refresh{0%{background:#3fbed725}100%{background:transparent}}@keyframes decision-value-refresh{0%{color:#fff;text-shadow:0 0 12px #52daf5}100%{text-shadow:none}}@media(prefers-reduced-motion:reduce){.advice.is-updating,.advice.is-updating strong{animation:none}}';
    document.head.appendChild(style);
  }

  class DecisionAdvice {
    constructor(container, options = {}) {
      if (!container || typeof container.replaceChildren !== 'function') throw new Error('决策建议容器不存在');
      this.container = container; this.statusElement = options.statusElement || null;
      this.configElements = options.configElements || {}; this.config = readStoredConfig();
      this.latest = null; this.latestHash = ''; this.latestIdentity = ''; this.lastAI = null; this.sequence = 0;
      this.inflight = null; this.timer = null; this.lastRequestedAt = -Infinity; this.destroyed = false;
      this.handleSave = () => this.saveConfig();
      if (this.configElements.save) this.configElements.save.addEventListener('click', this.handleSave);
      this.fillConfig(); installMotion(); this.status('本地规则建议；AI 分析尚未启用。');
    }

    fillConfig() {
      const fields = this.configElements;
      if (fields.endpoint) fields.endpoint.value = this.config.endpoint;
      if (fields.enabled) fields.enabled.checked = this.config.enabled;
      if (fields.interval) fields.interval.value = String(this.config.interval);
    }

    status(text) {
      if (this.statusElement) this.statusElement.textContent = text;
    }

    saveConfig() {
      const fields = this.configElements;
      try {
        const next = { endpoint: normalizeEndpoint(fields.endpoint ? fields.endpoint.value : this.config.endpoint),
          enabled: fields.enabled ? fields.enabled.checked : this.config.enabled,
          interval: intervalSeconds(fields.interval ? fields.interval.value : this.config.interval) };
        if (next.enabled && !next.endpoint) throw new Error('启用 AI 前请填写 HTTPS 分析代理地址');
        this.cancelRequest(); this.lastAI = null; this.config = next;
        try { global.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch (_) { /* Usable without browser storage. */ }
        this.fillConfig();
        if (this.latest) this.render(localAdvice(this.latest), 'local-rules', this.latest);
        this.status(next.enabled ? 'AI 代理已启用；等待当前汇总分析。' : '本地规则建议；AI 分析尚未启用。');
        this.schedule();
        return true;
      } catch (error) {
        this.status(error.message || 'AI 配置无效'); return false;
      }
    }

    update(input) {
      if (this.destroyed) return;
      const snapshot = summary(input), hash = fingerprint(snapshot), sourceIdentity = identity(snapshot);
      if (this.latestHash === hash) return;
      if (this.latestIdentity && this.latestIdentity !== sourceIdentity) { this.cancelRequest(); this.lastAI = null; }
      this.latest = snapshot; this.latestHash = hash; this.latestIdentity = sourceIdentity;
      if (this.config.enabled && this.lastAI && this.lastAI.identity === sourceIdentity) {
        this.status('AI 建议基于 ' + this.lastAI.snapshot.updatedAt + ' 的汇总；每 ' + this.config.interval + ' 秒按数据变化更新。');
      } else {
        this.render(localAdvice(snapshot), 'local-rules', snapshot);
      }
      if (!this.config.enabled) this.status('本地规则建议；AI 分析尚未启用。');
      this.schedule();
    }

    render(advice, source, snapshot) {
      const fragment = document.createDocumentFragment();
      for (const original of advice) {
        const item = displayAdvice(original);
        const card = document.createElement('div'); card.className = 'advice is-updating';
        card.dataset.source = source;
        card.title = (source === 'ai' ? 'AI 代理建议' : '本地规则建议') + ' · ' + snapshot.mode + ' · ' + snapshot.updatedAt;
        const label = document.createElement('span'); label.className = 'advice-label ' + item.type; label.textContent = item.label;
        const text = document.createElement('span'); text.className = 'advice-text'; appendEmphasis(text, item.text, item.emphasis);
        card.append(label, text); fragment.appendChild(card);
      }
      this.container.replaceChildren(fragment);
      this.container.dataset.analysisSource = source;
      this.container.dataset.updatedAt = snapshot.updatedAt;
      this.container.dataset.businessDate = snapshot.businessDate;
      this.container.dataset.sourceMode = snapshot.mode;
    }

    schedule() {
      if (this.destroyed || !this.latest || !this.config.enabled || !this.config.endpoint || this.inflight) return;
      if (typeof global.fetch !== 'function') { this.status('浏览器不支持分析请求；已回退本地规则建议。'); return; }
      if (this.timer !== null) return;
      const delay = Math.max(0, this.config.interval * 1000 - (Date.now() - this.lastRequestedAt));
      if (delay === 0) { this.request(); return; }
      this.timer = global.setTimeout(() => { this.timer = null; this.request(); }, delay);
    }

    async request() {
      if (this.destroyed || this.inflight || !this.config.enabled || !this.latest) return;
      const snapshot = this.latest, hash = this.latestHash, sourceIdentity = this.latestIdentity;
      const sequence = ++this.sequence;
      const controller = typeof global.AbortController === 'function' ? new global.AbortController() : null;
      const task = { controller, sequence }; this.inflight = task; this.lastRequestedAt = Date.now();
      this.status(this.lastAI ? 'AI 正在分析当前汇总；保留 ' + this.lastAI.snapshot.updatedAt + ' 的分析建议。'
        : 'AI 正在分析当前汇总；页面继续展示本地规则建议。');
      let timeout = null;
      try {
        const deadline = new Promise((_, reject) => { timeout = global.setTimeout(() => {
          if (controller) controller.abort(); reject(new Error('AI 分析超时'));
        }, 15000); });
        const call = (async () => {
          const response = await global.fetch(this.config.endpoint, {
            method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ snapshot }), ...(controller ? { signal: controller.signal } : {})
          });
          if (!response.ok) throw new Error('AI 代理返回 HTTP ' + response.status);
          const contentType = response.headers && typeof response.headers.get === 'function' ? response.headers.get('content-type') : null;
          if (contentType && !contentType.toLowerCase().includes('application/json')) throw new Error('AI 代理须返回 JSON');
          return validateAIAdvice(await response.json());
        })();
        const advice = await Promise.race([call, deadline]);
        if (this.destroyed || sequence !== this.sequence || sourceIdentity !== this.latestIdentity) return;
        this.lastAI = { advice, snapshot, identity: sourceIdentity };
        this.render(advice, 'ai', snapshot);
        this.status('AI 分析时间 ' + snapshot.updatedAt + '；每 ' + this.config.interval + ' 秒按数据变化更新，请结合业务核验。');
      } catch (error) {
        if (this.destroyed || sequence !== this.sequence || sourceIdentity !== this.latestIdentity) return;
        this.lastAI = null;
        this.render(localAdvice(this.latest), 'local-rules', this.latest);
        this.status('AI 分析未完成，已回退本地规则建议。' + (error && error.message ? ' ' + clean(error.message, 100) : ''));
      } finally {
        if (timeout !== null) global.clearTimeout(timeout);
        if (this.inflight === task) this.inflight = null;
        // Same-source AI results remain visible with their analysis time while later totals are analysed.
        // Date, mode, or batch changes invalidate the response via sourceIdentity/sequence above.
        if (!this.destroyed && sequence === this.sequence && hash !== this.latestHash) this.schedule();
      }
    }

    cancelRequest() {
      this.sequence++;
      if (this.timer !== null) { global.clearTimeout(this.timer); this.timer = null; }
      if (this.inflight && this.inflight.controller) this.inflight.controller.abort();
      this.inflight = null;
    }

    destroy() {
      this.destroyed = true; this.cancelRequest();
      if (this.configElements.save) this.configElements.save.removeEventListener('click', this.handleSave);
    }
  }

  global.DecisionAdvice = DecisionAdvice;
})(window);
