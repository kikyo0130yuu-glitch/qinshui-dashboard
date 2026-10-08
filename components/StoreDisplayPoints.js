(function (root) {
  'use strict';
  /** Pure display transform. Never pass the result to persistence or source export. */
  function apply(points, overlay) {
    if (!Array.isArray(points)) return points;
    const entries = overlay?.metadata?.mode === 'schematic' && Array.isArray(overlay.points) ? overlay.points : [];
    const byId = new Map(entries.filter(entry => entry.type === 'store' && entry.inTown === true && entry.inCounty === true &&
      entry.coordinateSystem === 'WGS84' && Array.isArray(entry.displayCoordinate) && entry.displayCoordinate.length === 2 &&
      entry.displayCoordinate.every(Number.isFinite)).map(entry => [entry.id, entry]));
    return points.map(point => {
      if (point.type !== 'store') return point;
      const entry = byId.get(point.id);
      if (!entry) return point;
      return {
        ...point,
        longitude:entry.displayCoordinate[0], latitude:entry.displayCoordinate[1], town:entry.townName,
        displayPosition:{
          mode:'schematic', label:entry.displayPositionLabel || '示意位置',
          revision:overlay.metadata.revision, coordinateSystem:'WGS84', townName:entry.townName,
          originalCoordinate:entry.originalCoordinate.slice(), displayCoordinate:entry.displayCoordinate.slice(),
          offsetKm:entry.offsetKm, seed:entry.seed, method:entry.method,
          usesInteriorFallback:entry.usesInteriorFallback, inTown:entry.inTown, inCounty:entry.inCounty,
          sourcePointSha256:overlay.metadata.sourcePointSha256,
          originalPositionSource:entry.originalPositionSource
        }
      };
    });
  }
  root.StoreDisplayPoints = Object.freeze({apply});
  if (typeof module !== 'undefined' && module.exports) module.exports = root.StoreDisplayPoints;
})(globalThis);
