(function (global) {
  'use strict';
  // Piecewise monetary scale: enlarge low amounts, keep every quoted amount exact.
  // Coordinate distances are deliberately non-proportional to CNY sales.
  const amounts = Object.freeze([0, 200, 500, 1000, 3000, 8000, 15000]);
  const positions = Object.freeze([0, 10, 20, 30, 42, 56, 72]);
  function interpolate(value, source, target) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    if (value <= source[0]) return target[0];
    if (value >= source.at(-1)) return target.at(-1);
    const i = source.findIndex((next, index) => index > 0 && value <= next);
    return target[i - 1] + (value - source[i - 1]) / (source[i] - source[i - 1]) * (target[i] - target[i - 1]);
  }
  function tickLabel(position) {
    const i = positions.findIndex(value => Math.abs(value - position) < 1e-8);
    if (i < 0) return '';
    return amounts[i] >= 10000 ? amounts[i] / 10000 + '万' : String(amounts[i]);
  }
  global.StoreSalesScale = Object.freeze({ amounts, positions, maximumAmount: amounts.at(-1), maximumPosition: positions.at(-1),
    toPosition: value => interpolate(value, amounts, positions),
    toAmount: value => interpolate(value, positions, amounts), tickLabel });
})(typeof window !== 'undefined' ? window : globalThis);
