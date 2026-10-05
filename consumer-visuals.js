(function (global) {
  'use strict';

  // Only decorate the consumer panel; data values and metric calculations stay
  // with dashboard.js and ConsumerMetrics. Motion never changes data values.
  function decorateRadarOption(option) {
    const radar = option.radar;
    radar.splitLine = { lineStyle: {
      color: ['#2d5268', '#38677f', '#437d94', '#5399ac', '#6eb8c9'],
      width: 1.2, opacity: .95
    } };
    radar.axisLine = { lineStyle: { color: '#4b8ba3', width: 1.2 } };
    radar.splitArea = { show: true, areaStyle: {
      color: ['rgba(31,107,135,.055)', 'rgba(31,107,135,.10)']
    } };
    for (const series of option.series || []) {
      if (series.type !== 'radar') continue;
      series.symbol = 'circle';
      series.symbolSize = 8;
      for (const group of series.data || []) {
        const color = group.itemStyle && group.itemStyle.color;
        group.itemStyle = { ...group.itemStyle,
          borderColor: '#e7fcff', borderWidth: 1.2,
          shadowBlur: 7, shadowColor: color
        };
      }
    }
    return option;
  }

  function installMetricGlow() {
    if (document.getElementById('consumer-metric-glow')) return;
    const style = document.createElement('style');
    style.id = 'consumer-metric-glow';
    style.textContent = `
      .profile-numbers .profile-number strong {
        display:inline-block;
        animation:consumer-metric-breathe 2.4s ease-in-out infinite;
      }
      .profile-numbers .profile-number:nth-child(2) strong {animation-delay:.6s}
      .profile-numbers .profile-number:nth-child(3) strong {animation-delay:1.2s}
      @keyframes consumer-metric-breathe {
        0%,100% {filter:brightness(1);text-shadow:0 0 0 transparent}
        50% {filter:brightness(1.35);text-shadow:0 0 13px #ffc44c99}
      }
      @media(prefers-reduced-motion:reduce) {
        .profile-numbers .profile-number strong {
          animation:none;filter:none;text-shadow:none;
        }
      }
    `;
    document.head.appendChild(style);
  }

  global.ConsumerVisuals = { decorateRadarOption, installMetricGlow };
  installMetricGlow();
})(window);
