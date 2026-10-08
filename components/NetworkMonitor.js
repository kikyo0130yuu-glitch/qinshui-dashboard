(function (global) {
  'use strict';
  const STATES = Object.freeze({
    checking: '正在检测网络…',
    normal: 'LIVE 实时监测',
    weak: '网络不稳定，数据可能延迟',
    disconnected: '连接中断',
    reconnecting: '网络异常，正在重连…',
    recovered: '网络已恢复，实时监测中'
  });
  const PUBLIC_HEALTH_URL = 'https://kikyo0130yuu-glitch.github.io/qinshui-dashboard/network-health.js';

  class NetworkMonitor {
    constructor(element, options = {}) {
      this.element = element;
      this.text = element.querySelector('[data-network-text]');
      this.now = options.now || (() => Date.now());
      this.probe = options.probe || (token => this.scriptProbe(token));
      this.url = new URL(options.endpoint ||
        (/^https?:$/.test(global.location.protocol)
          ? new URL('network-health.js', document.baseURI).href : PUBLIC_HEALTH_URL));
      this.pollMs = options.pollMs || 15000;
      this.timeoutMs = options.timeoutMs || 6000;
      this.weakMs = options.weakMs || 1800;
      this.recoveredMs = options.recoveredMs || 8000;
      this.failures = 0;
      this.hadIssue = false;
      this.sequence = 0;
      this.running = false;
      this.destroyed = false;
      this.online = () => this.check(true);
      this.offline = () => {
        this.cancelCheck();
        clearTimeout(this.nextTimer);
        this.hadIssue = true;
        this.setState('disconnected');
        this.schedule(this.pollMs);
      };
      this.visible = () => { if (!document.hidden) this.check(this.hadIssue); };
      global.addEventListener('online', this.online);
      global.addEventListener('offline', this.offline);
      document.addEventListener('visibilitychange', this.visible);
      this.setState('checking');
      if (options.autoStart !== false) this.check();
    }

    setState(state, latency) {
      clearTimeout(this.recoveryTimer);
      this.state = state;
      this.element.dataset.networkState = state;
      this.text.textContent = STATES[state];
      const target = global.location.protocol === 'file:' ? '公网大屏站点' : '当前大屏站点';
      this.element.title = `检测目标：${target} · ${this.url.host}` +
        (Number.isFinite(latency) ? ` · 响应 ${Math.round(latency)} ms` : '') +
        '；表示该站点可达性，不代表天气或ERP数据已更新';
    }

    schedule(delay) {
      clearTimeout(this.nextTimer);
      if (!this.destroyed) this.nextTimer = setTimeout(() => this.check(this.hadIssue), delay);
    }

    scriptProbe(token) {
      let script, callback;
      const promise = new Promise((resolve, reject) => {
        callback = (id, payload) => {
          if (id !== token) return;
          if (payload?.service === 'qinshui-dashboard' && payload?.status === 'ok') resolve();
          else reject(new Error('Invalid dashboard heartbeat'));
        };
        global.__qinshuiNetworkProbe = callback;
        script = document.createElement('script');
        const url = new URL(this.url);
        url.searchParams.set('check', token);
        url.searchParams.set('ts', String(this.now()));
        script.src = url.href;
        script.async = true;
        script.dataset.networkProbe = 'true';
        script.onerror = () => reject(new Error('Dashboard heartbeat unreachable'));
        script.onload = () => reject(new Error('Dashboard heartbeat missing response'));
        document.head.append(script);
      });
      return {promise, cancel: () => {
        if (script) { script.onload = script.onerror = null; script.remove(); }
        if (global.__qinshuiNetworkProbe === callback) delete global.__qinshuiNetworkProbe;
      }};
    }

    cancelCheck() {
      this.sequence++;
      clearTimeout(this.timeoutTimer);
      this.active?.cancel?.();
      this.active = null;
      this.running = false;
    }

    async check(reconnecting = false) {
      if (this.destroyed || this.running) return;
      clearTimeout(this.nextTimer);
      if (global.navigator.onLine === false) {
        this.hadIssue = true;
        this.setState('disconnected');
        this.schedule(this.pollMs);
        return;
      }
      if (reconnecting) this.setState('reconnecting');
      this.running = true;
      const sequence = ++this.sequence;
      const token = `qinshui-${sequence}-${this.now()}`;
      const started = this.now();
      let succeeded = false;
      try {
        const probe = this.probe(token, this.url.href);
        this.active = probe?.promise ? probe : {promise: Promise.resolve(probe)};
        await Promise.race([this.active.promise, new Promise((_, reject) => {
          this.timeoutTimer = setTimeout(() => reject(new Error('Dashboard heartbeat timed out')), this.timeoutMs);
        })]);
        if (this.destroyed || sequence !== this.sequence) return;
        succeeded = true;
        const latency = Math.max(0, this.now() - started);
        this.failures = 0;
        this.element.dataset.networkCheckedAt = String(this.now());
        if (latency >= this.weakMs) {
          this.hadIssue = true;
          this.setState('weak', latency);
        } else if (this.hadIssue) {
          this.hadIssue = false;
          this.setState('recovered', latency);
          this.recoveryTimer = setTimeout(() => {
            if (this.state === 'recovered' && !this.destroyed) this.setState('normal', latency);
          }, this.recoveredMs);
        } else this.setState('normal', latency);
      } catch (_) {
        if (this.destroyed || sequence !== this.sequence) return;
        this.failures++;
        this.hadIssue = true;
        this.setState('disconnected');
      } finally {
        if (sequence === this.sequence) {
          clearTimeout(this.timeoutTimer);
          this.active?.cancel?.();
          this.active = null;
          this.running = false;
          this.schedule(succeeded ? this.pollMs : Math.min(30000, 5000 * 2 ** Math.min(this.failures - 1, 3)));
        }
      }
    }

    destroy() {
      this.destroyed = true;
      this.cancelCheck();
      clearTimeout(this.nextTimer);
      clearTimeout(this.recoveryTimer);
      global.removeEventListener('online', this.online);
      global.removeEventListener('offline', this.offline);
      document.removeEventListener('visibilitychange', this.visible);
    }
  }
  NetworkMonitor.STATES = STATES;
  NetworkMonitor.PUBLIC_HEALTH_URL = PUBLIC_HEALTH_URL;
  global.NetworkMonitor = NetworkMonitor;
})(window);
