// Static, cache-busted site heartbeat. No weather API or credentials are used.
(function () {
  'use strict';
  const id = new URL(document.currentScript.src).searchParams.get('check');
  if (id && typeof window.__qinshuiNetworkProbe === 'function') {
    window.__qinshuiNetworkProbe(id, {service: 'qinshui-dashboard', status: 'ok'});
  }
})();
