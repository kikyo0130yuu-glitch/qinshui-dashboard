(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const types = {
    store: { label: '门店', color: '#49d5e8', icon: 'M-11-3H11L8-10H-8ZM-9-3V10H9V-3M-3 10V2H3V10' },
    canteen: { label: '后勤事业部 / 食堂', color: '#f1cb74', icon: 'M-10 11V-10H10V11ZM-5-5H-3M3-5H5M-5 0H-3M3 0H5M-3 11V5H3V11' },
    base: { label: '农产品基地', color: '#72ddb1', icon: 'M0 12V-4M0 0Q-13 1-10-10Q1-10 0 0M0 5Q13 5 11-6Q0-6 0 5' },
    warehouse: { label: '仓库 / 配送中心', color: '#82b9ff', icon: 'M-12-3L0-12L12-3M-10-4V11H10V-4M-6 11V1H6V11M-6 5H6' },
    logistics: { label: '物流节点', color: '#cbacff', icon: 'M-12-7H3V6H-12ZM3-2H9L12 3V6H3M-5 9A3 3 0 1 0-5 3A3 3 0 1 0-5 9M8 9A3 3 0 1 0 8 3A3 3 0 1 0 8 9' },
    farmer: { label: '农户 / 合作社', color: '#eab783', icon: 'M-11 0L0-10L11 0M-8-2V11H8V-2M-3 11V4H3V11' }
  };
  const fallback = { label: '业务点位', color: '#c4dcec', icon: 'M0 12C-17-3-7-13 0-13C7-13 17-3 0 12ZM0-8A4 4 0 1 0 0 0A4 4 0 1 0 0-8' };
  function node(tag, attrs = {}, text) {
    const el = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function polygonOK(geometry) {
    if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) return false;
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    return Array.isArray(polygons) && polygons.length > 0 && polygons.every(poly => Array.isArray(poly) && poly.length > 0 && poly.every(ring =>
      Array.isArray(ring) && ring.length >= 4 && ring.every(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90) && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]
    ));
  }
  class QinshuiTownMap {
    constructor(container, data) {
      this.container = container;
      this.colors = {};
      this.setData(data);
      this.observer = new ResizeObserver(() => this.render());
      this.observer.observe(container);
    }
    static validate(data) {
      const { towns, county, points, settings } = data;
      if (!towns?.features?.length || !county?.features?.length) return settings.boundaryReviewPending?'行政边界已处理，差异待核验；点位坐标系待确认':'缺少沁水县县界及 12 个乡镇真实边界数据';
      if (settings.boundaryCoordinateSystem !== 'WGS84' || settings.boundaryCoordinateSystemConfirmed === false) return '边界坐标系尚未确认，暂不显示地图';
      if (settings.boundaryReviewPending && !settings.boundaryPrototypeUseApproved) return '行政边界差异待核验，尚未确认用于原型';
      if (towns.metadata?.coordinateSystem !== 'WGS84' || county.metadata?.coordinateSystem !== 'WGS84') return '边界文件坐标系与 WGS84 配置不一致，暂不显示地图';
      if (towns.metadata?.status !== 'verified' || county.metadata?.status !== 'verified') return '行政边界数据来源尚未核验';
      if (!towns.metadata.source || !county.metadata.source || !towns.metadata.dataDate || !county.metadata.dataDate) return '请补充边界数据来源及数据日期';
      if (county.features.length !== 1 || county.features[0].properties?.name !== settings.countyName) return '县界文件必须包含一个沁水县完整 Polygon / MultiPolygon';
      if (![...towns.features, ...county.features].every(f => polygonOK(f.geometry))) return '行政边界包含无效或未闭合的几何数据';
      const names = towns.features.map(f => f.properties?.name);
      const missing = settings.expectedTownNames.filter(name => !names.includes(name));
      const extra = names.filter(name => !settings.expectedTownNames.includes(name));
      if (names.length !== 12 || new Set(names).size !== 12 || missing.length || extra.length) return `乡镇数据不完整：缺少 ${missing.join('、') || '无'}；多出或重复 ${extra.join('、') || (new Set(names).size !== names.length ? '重复乡镇' : '无')}`;
      return null;
    }
    static pointIssue({ points, settings }) {
      if (!Array.isArray(points)) return '点位数据格式待核验';
      if (points.length && (settings.pointCoordinateSystem !== 'WGS84' || !(settings.pointCoordinateSystemsConfirmed || settings.coordinateSystemsConfirmed))) return '业务点位坐标系待确认，暂不显示点位';
      const ids = new Set();
      for (const p of points) {
        if (!p.id || !p.name || !p.type || ids.has(p.id) || !Number.isFinite(p.longitude) || !Number.isFinite(p.latitude) || Math.abs(p.longitude) > 180 || Math.abs(p.latitude) > 90 || (p.coordinateSystem && p.coordinateSystem !== 'WGS84') || (p.pointCoordinateSystem && p.pointCoordinateSystem !== 'WGS84')) return '点位标识、经纬度或坐标系待核验，暂不显示点位';
        ids.add(p.id);
      }
      return null;
    }
    // D3 spherical rings use the opposite exterior orientation to RFC 7946.
    // Reverse a deep copy only; original files and original point.town stay intact.
    normalize(feature) {
      const copy = JSON.parse(JSON.stringify(feature));
      const polygons = copy.geometry.type === 'Polygon' ? [copy.geometry.coordinates] : copy.geometry.coordinates;
      for (const poly of polygons) poly.forEach((ring, i) => {
        const large = d3.geoArea({ type: 'Polygon', coordinates: [ring] }) > 2 * Math.PI;
        if ((i === 0 && large) || (i > 0 && !large)) ring.reverse();
      });
      return copy;
    }
    setData(data) {
      this.data = data;
      this.error = QinshuiTownMap.validate(data);
      this.pointError = QinshuiTownMap.pointIssue(data);
      if (!this.error && typeof d3 === 'undefined') this.error = '地图投影依赖未加载';
      if (!this.error) {
        this.towns = data.towns.features.map(f => this.normalize(f));
        this.county = this.normalize(data.county.features[0]);
        this.pointInfo = (this.pointError ? [] : data.points).map(point => {
          const coordinate = [point.longitude, point.latitude];
          const matches = this.towns.filter(t => d3.geoContains(t, coordinate)).map(t => t.properties.name);
          const inside = d3.geoContains(this.county, coordinate);
          if (data.settings.development && point.town && !matches.includes(point.town)) console.warn('点位所属乡镇与经纬度计算结果不一致', { id: point.id, providedTown: point.town, calculatedTowns: matches });
          if (data.settings.development && !inside) console.warn('点位位于沁水县边界外', { id: point.id });
          return { point, matches, inside };
        });
      }
      this.render();
    }
    labelCenter(feature, path, projection) {
      const centroid = path.centroid(feature);
      const candidates = [centroid, projection(d3.geoCentroid(feature))];
      for (const xy of candidates) if (xy?.every(Number.isFinite) && d3.geoContains(feature, projection.invert(xy))) return xy;
      // For concave areas / disconnected parts, find an interior point nearest
      // the calculated centroid. No hand-authored town label coordinates.
      const [[x0, y0], [x1, y1]] = path.bounds(feature);
      let best, distance = Infinity;
      for (let i = 1; i < 40; i++) for (let j = 1; j < 40; j++) {
        const xy = [x0 + (x1 - x0) * i / 40, y0 + (y1 - y0) * j / 40];
        if (d3.geoContains(feature, projection.invert(xy))) {
          const d = (xy[0] - centroid[0]) ** 2 + (xy[1] - centroid[1]) ** 2;
          if (d < distance) { distance = d; best = xy; }
        }
      }
      return best || null;
    }
    placeLabel(feature, path, projection, placed) {
      const center = this.labelCenter(feature, path, projection);
      if (!center) return null;
      const name = feature.properties.name;
      const box = (xy, size) => ({ x0: xy[0] - name.length * size / 2 - 3, x1: xy[0] + name.length * size / 2 + 3, y0: xy[1] - size * .65, y1: xy[1] + size * .65 });
      const free = rect => !placed.some(other => rect.x0 < other.x1 && rect.x1 > other.x0 && rect.y0 < other.y1 && rect.y1 > other.y0);
      const [[x0,y0],[x1,y1]] = path.bounds(feature);
      for (const size of [13,11,9]) {
        let best = null, distance = Infinity;
        const candidates = [center];
        for (let i=1;i<16;i++) for (let j=1;j<16;j++) candidates.push([x0+(x1-x0)*i/16,y0+(y1-y0)*j/16]);
        for (const xy of candidates) {
          const rect = box(xy,size);
          if (!free(rect) || !d3.geoContains(feature,projection.invert(xy))) continue;
          const delta = (xy[0]-center[0])**2+(xy[1]-center[1])**2;
          if (delta<distance) { best={xy,size,box:rect};distance=delta; }
          if (delta===0) break;
        }
        if (best) return best;
      }
      return {xy:center,size:9,box:box(center,9)};
    }
    setTownStatus(statusByName) { this.colors = { ...statusByName }; this.render(); }
    render() {
      if (!this.container) return;
      this.container.replaceChildren();
      if (this.error) {
        const empty = document.createElement('div');
        empty.className = 'map-empty';
        const title = document.createElement('strong'); title.textContent = '沁水县乡镇行政区域地图';
        const message = document.createElement('p'); message.textContent = this.error;
        const detail = document.createElement('p'); detail.textContent = this.data.settings.boundaryReviewPending?'7 镇 · 5 乡｜行政边界检查报告已生成':'7 镇 · 5 乡｜真实经纬度点位待提供';
        empty.append(title, message, detail); this.container.append(empty); return;
      }
      // clientWidth is unscaled CSS size: the LED board scales as one unit.
      const width = this.container.clientWidth, height = this.container.clientHeight;
      if (width < 80 || height < 80) return;
      // In wide containers, reserve widgets sit in the free left margin.
      // Taller containers retain a top inset so the widgets cannot cover towns.
      const topInset = width / height >= 1.8 ? 20 : Math.min(125, height * .25);
      const bottomInset = Math.min(65, height * .2), sideInset = Math.min(35, width * .06);
      const extentFeatures = {type:'FeatureCollection',features:[this.county,...this.towns]};
      const projection = d3.geoMercator().fitExtent([[sideInset, topInset], [width - sideInset, height - bottomInset]], extentFeatures);
      this.projection = projection;
      const path = d3.geoPath(projection);
      const svg = node('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': '沁水县 12 个乡镇真实行政边界及业务点位', class: 'town-map-svg' });
      const regions = node('g');
      const palette = ['#074b7e', '#0b65a1', '#126fa6', '#185c85', '#246d9e', '#164f8d', '#235a98', '#285f89', '#347598', '#205677', '#2d678c', '#17577e'];
      this.towns.forEach((feature, i) => {
        const name = feature.properties.name, status = this.colors[name] || feature.properties.status;
        const townIndex = this.data.settings.expectedTownNames.indexOf(name);
        const customColor = /^#[0-9a-f]{6}$/i.test(feature.properties.color || '') ? feature.properties.color : null;
        const color = this.data.settings.statusColors[status] || customColor || palette[(townIndex < 0 ? i : townIndex) % palette.length];
        const region = node('path', { d: path(feature), fill: color, class: 'town-region', tabindex: 0, role: 'button', 'aria-label': name });
        region.append(node('title', {}, name));
        const select = () => this.container.dispatchEvent(new CustomEvent('townselect', { detail: { name, properties: { ...feature.properties } } }));
        region.onclick = select;
        region.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } };
        regions.append(region);
      });
      svg.append(regions, node('path', { d: path(this.county), class: 'county-outline' }));
      const labels = node('g', { class: 'town-labels', 'pointer-events': 'none' });
      const placedLabels = [];
      for (const feature of this.towns) {
        const placement = this.placeLabel(feature, path, projection, placedLabels);
        if (placement) {
          const {xy,size,box} = placement;
          placedLabels.push(box);
          labels.append(node('text', { x: xy[0], y: xy[1], style: `font-size:${size}px`, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, feature.properties.name));
        }
      }
      svg.append(labels);
      // Both endpoints use the same projection, including after a resize.
      // Routes are display connections; they are not road / vehicle traces.
      const origin = this.pointInfo.find(info => info.inside && info.point.id === this.data.settings.dispatchOriginId);
      if (origin) {
        const routes = node('g', { class: 'dispatch-routes', 'pointer-events': 'none' });
        const [ox, oy] = projection([origin.point.longitude, origin.point.latitude]);
        for (const info of this.pointInfo) {
          if (!info.inside || !['store', 'canteen'].includes(info.point.type) || info.point.id === origin.point.id) continue;
          const [tx, ty] = projection([info.point.longitude, info.point.latitude]);
          const distance = Math.hypot(tx - ox, ty - oy);
          if (distance < 1) continue;
          const bend = Math.min(distance * .12, 45);
          const cx = (ox + tx) / 2 - (ty - oy) / distance * bend;
          const cy = (oy + ty) / 2 + (tx - ox) / distance * bend;
          const route = `M${ox},${oy}Q${cx},${cy} ${tx},${ty}`;
          routes.append(node('path', { d: route, class: 'dispatch-line' }));
          const duration = `${Math.max(3, distance / 130)}s`;
          const dot = node('circle', { r: 4, fill: '#adf6ff', class: 'dispatch-dot dispatch-outbound' });
          dot.append(node('animateMotion', { dur: duration, repeatCount: 'indefinite', path: route, rotate: 'auto' }));
          const returning = node('circle', { r: 3.5, fill: '#ffe551', class: 'dispatch-dot dispatch-inbound' });
          returning.append(node('animateMotion', { dur: duration, repeatCount: 'indefinite', path: route, rotate: 'auto', keyPoints: '1;0', keyTimes: '0;1', calcMode: 'linear', begin: '-1s' }));
          routes.append(dot, returning);
        }
        svg.append(routes);
      }
      const markers = node('g');
      for (const info of this.pointInfo) {
        if (!info.inside) continue; // outside points are reported, never clamped.
        const p = info.point, [x, y] = projection([p.longitude, p.latitude]), style = types[p.type] || fallback;
        const marker = node('g', { transform: `translate(${x},${y})`, class: 'map-marker', tabindex: 0, role: 'button', 'aria-label': `${p.name}，${style.label}`, style: `color:${style.color}` });
        const pulse = node('circle', { r: 25, fill: 'none', stroke: 'currentColor', 'stroke-width': 1, class: 'map-marker-pulse' });
        pulse.append(node('animate', { attributeName: 'r', values: '22;34;22', dur: '3s', repeatCount: 'indefinite' }), node('animate', { attributeName: 'opacity', values: '.5;.1;.5', dur: '3s', repeatCount: 'indefinite' }));
        marker.append(pulse);
        marker.append(node('circle', { r: 21, fill: '#091726', stroke: 'currentColor', 'stroke-width': 2 }), node('path', { d: style.icon, fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }), node('title', {}, `${p.name} · ${style.label}`));
        const select = () => { this.showPoint(p, style); this.container.dispatchEvent(new CustomEvent('pointselect', { detail: { ...p } })); };
        marker.onclick = select;
        marker.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } };
        markers.append(marker);
      }
      svg.append(markers); this.container.append(svg);
      if (!this.pointInfo.length) { const note = document.createElement('div'); note.className = 'map-point-note'; note.textContent = this.pointError || (this.data.settings.pendingPointCount ? '业务点位坐标系待确认' : '真实经纬度点位待提供'); this.container.append(note); }
    }
    showPoint(point, style) {
      this.container.querySelector('.map-point-card')?.remove();
      const card = document.createElement('aside'); card.className = 'map-point-card';
      const name = document.createElement('strong'); name.textContent = point.name;
      const type = document.createElement('p'); type.textContent = style.label;
      const coordinate = document.createElement('p'); coordinate.textContent = `${point.longitude.toFixed(6)}, ${point.latitude.toFixed(6)} · WGS84`;
      const close = document.createElement('button'); close.textContent = '关闭'; close.onclick = () => card.remove();
      card.append(name, type, coordinate, close); this.container.append(card); close.focus();
    }
    destroy() { this.observer.disconnect(); this.container.replaceChildren(); }
  }
  root.QinshuiTownMap = QinshuiTownMap;
})(globalThis);
