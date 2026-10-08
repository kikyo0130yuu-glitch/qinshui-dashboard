(function (global) {
  'use strict';
  // All physical field names live in this adapter; arithmetic and narration use logical fields.
  const DEFAULTS = Object.freeze({
    version: 'supply-chain-insight-v1.0', refreshSeconds: 60, timeBucketMinutes: 15,
    timeZoneOffset: '+08:00', freshnessLagSeconds: 900, weatherMaxAgeSeconds: 3600,
    amountToleranceCents: 1, largeOrderAmount: 5000, businessHours: { open: '06:00', close: '22:00' },
    minimumHistoryDays: 3, basicBaselineDays: 14, weekdayBaselineDays: 28, lookbackDays: { short: 7, recent: 14, weekday: 28 },
    changeThresholdPercent: 20, forecastMinimumOrders: 20, forecastMinimumProgress: 0.15,
    forecastWeights: { currentProgress: 0.7, recentAverage: 0.3 },
    heatWeights: { amount: 0.4, quantity: 0.3, growth: 0.3 },
    fieldMap: {
      orders: { key: 'key', id: 'id', storeId: 'code', storeName: 'name', amount: 'amount', amountCents: 'amountCents', date: 'sourceDate', processingDate: 'processingDate', time: 'time', memberHash: 'memberHash' },
      details: { id: 'id', orderKey: 'orderKey', orderId: 'orderId', storeId: 'code', productId: 'sku', productName: 'name', quantity: 'quantity', amount: 'amount', amountCents: 'amountCents', date: 'sourceDate', time: 'time', unit: 'unit' }
    }
  });
  const numeric = x => typeof x === 'number' && Number.isFinite(x);
  const round = (x, p = 2) => numeric(x) ? Number(x.toFixed(p)) : null;
  const safe = (x, limit = 100) => typeof x === 'string' || typeof x === 'number' ? String(x).trim().slice(0, limit) : '';
  const validDate = x => /^\d{4}-\d{2}-\d{2}$/.test(x || '') && Number.isFinite(Date.parse(x + 'T00:00:00Z')) && new Date(x + 'T00:00:00Z').toISOString().slice(0, 10) === x;
  const seconds = x => { const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(x || ''); return m && +m[1] < 24 && +m[2] < 60 && +(m[3] || 0) < 60 ? +m[1] * 3600 + +m[2] * 60 + +(m[3] || 0) : null; };
  const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const median = xs => { const values = xs.filter(numeric).sort((a, b) => a - b), half = Math.floor(values.length / 2); return values.length ? values.length % 2 ? values[half] : (values[half - 1] + values[half]) / 2 : null; };
  function skuMedianPrice(details) {
    const sku = new Map();
    for (const line of details.filter(x => x.quantity > 0 && x.amountCents > 0)) {
      if (!sku.has(line.productId)) sku.set(line.productId, { amount: 0, qty: 0, units: new Set() });
      const entry = sku.get(line.productId); entry.amount += line.amountCents; entry.qty += line.quantity; entry.units.add(line.unit);
    }
    return round(median([...sku.values()].filter(x => x.units.size === 1).map(x => x.amount / 100 / x.qty)), 8);
  }
  const percent = (a, b) => numeric(a) && numeric(b) && b > 0 ? round((a - b) / b * 100) : null;
  const ratio = (a, b) => numeric(a) && b > 0 ? round(a / b, 4) : null;
  const money = x => numeric(x) ? '¥' + x.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
  const count = x => numeric(x) ? x.toLocaleString('zh-CN', { maximumFractionDigits: 3 }) : '—';
  const unsigned = x => /^\d+$/.test(String(x || '')) ? +x : null;
  function config(overrides) {
    const x = overrides || {};
    const result = { ...DEFAULTS, ...x, lookbackDays: { ...DEFAULTS.lookbackDays, ...x.lookbackDays }, businessHours: { ...DEFAULTS.businessHours, ...x.businessHours },
      forecastWeights: { ...DEFAULTS.forecastWeights, ...x.forecastWeights }, heatWeights: { ...DEFAULTS.heatWeights, ...x.heatWeights },
      fieldMap: { orders: { ...DEFAULTS.fieldMap.orders, ...(x.fieldMap || {}).orders }, details: { ...DEFAULTS.fieldMap.details, ...(x.fieldMap || {}).details } } };
    for (const key of ['refreshSeconds', 'timeBucketMinutes', 'freshnessLagSeconds', 'weatherMaxAgeSeconds', 'amountToleranceCents', 'largeOrderAmount', 'minimumHistoryDays', 'basicBaselineDays', 'weekdayBaselineDays', 'changeThresholdPercent', 'forecastMinimumOrders', 'forecastMinimumProgress']) if (!numeric(result[key]) || result[key] < 0) throw new Error('分析配置数值无效：' + key);
    if (result.minimumHistoryDays < 3 || result.timeBucketMinutes < 1 || result.forecastMinimumProgress > 1 || seconds(result.businessHours.open) === null || seconds(result.businessHours.close) === null || seconds(result.businessHours.close) <= seconds(result.businessHours.open)) throw new Error('分析配置营业时间或最低样本无效');
    for (const weights of [result.forecastWeights, result.heatWeights, result.lookbackDays]) if (Object.values(weights).some(value => !numeric(value) || value < 0) || Object.values(weights).reduce((a, b) => a + b, 0) <= 0) throw new Error('分析配置权重或历史窗口无效');
    return result;
  }
  function amountCents(row, fields) {
    const cents = row[fields.amountCents], amount = row[fields.amount];
    return Number.isSafeInteger(cents) ? cents : numeric(amount) ? Math.round(amount * 100) : null;
  }
  function orderRows(raw, cfg, dateFallback, cutoff, quality, excludeCrossDate) {
    const rows = [], seen = new Set(), rawKeys = new Set(), f = cfg.fieldMap.orders;
    for (const record of Array.isArray(raw) ? raw : []) {
      const day = safe(record[f.date]) || dateFallback, id = safe(record[f.id]), storeId = safe(record[f.storeId]);
      const key = safe(record[f.key], 200) || [day, storeId, id].join('|'); rawKeys.add(key);
      const time = safe(record[f.time]), stamp = seconds(time), cents = amountCents(record, f);
      if (!id || !storeId || !validDate(day) || stamp === null || cents === null) { quality.invalidOrders++; continue; }
      const processingDate = safe(record[f.processingDate]);
      if (excludeCrossDate && processingDate && processingDate !== day) { quality.processingDateMismatchExcluded++; continue; }
      if (seen.has(key)) { quality.duplicateOrders++; continue; } seen.add(key);
      if (cutoff !== null && stamp > cutoff) { quality.futureOrdersExcluded++; continue; }
      const memberHash = safe(record[f.memberHash], 160);
      rows.push({ key, id, storeId, storeName: safe(record[f.storeName]) || storeId, date: day, time, stamp, amountCents: cents,
        // Names are never hashed ad hoc or allowed into results. Only a supplied cryptographic hash is accepted.
        memberHash: /^(?:sha256:)?[a-f0-9]{64}$/i.test(memberHash) ? memberHash : null });
    }
    return { rows, rawKeys };
  }
  function detailRows(raw, orders, rawKeys, cfg, mappings, quality) {
    const f = cfg.fieldMap.details, byKey = new Map(orders.map(x => [x.key, x]));
    const byId = new Map(); for (const order of orders) { const k = [order.date, order.storeId, order.id].join('|'); byId.set(k, order); }
    const rows = [], seen = new Set();
    for (const record of Array.isArray(raw) ? raw : []) {
      let key = safe(record[f.orderKey], 200);
      if (!key) key = [safe(record[f.date]), safe(record[f.storeId]), safe(record[f.orderId])].join('|');
      const parent = byKey.get(key) || byId.get(key);
      if (!parent) { if (!rawKeys.has(key)) quality.orphanDetails++; continue; }
      const id = safe(record[f.id]), productId = safe(record[f.productId]), qty = record[f.quantity], cents = amountCents(record, f);
      const lineKey = parent.key + '|' + id;
      if (!id || !productId || !numeric(qty) || cents === null) { quality.invalidDetails++; continue; }
      if (seen.has(lineKey)) { quality.duplicateDetails++; continue; } seen.add(lineKey);
      if (qty === 0) quality.zeroQuantityLines++;
      if (qty < 0) quality.negativeQuantityLines++;
      if (qty !== 0 && cents !== 0 && Math.sign(qty) !== Math.sign(cents)) quality.amountQuantitySignMismatch++;
      const mapping = mappings.get(productId);
      if (!mapping) quality.unmappedCategoryLines++;
      rows.push({ id, orderKey: parent.key, storeId: parent.storeId, storeName: parent.storeName, date: parent.date,
        time: parent.time, stamp: parent.stamp, productId, productName: safe(record[f.productName]) || productId,
        unit: safe(record[f.unit]) || '未标单位', quantity: qty, amountCents: cents,
        categoryId: mapping ? mapping.categoryId : 'unmapped', categoryName: mapping ? mapping.categoryName : '待映射分类', categoryVerified: Boolean(mapping) });
    }
    return rows;
  }
  function qualityCounts() { return { invalidOrders: 0, duplicateOrders: 0, futureOrdersExcluded: 0, orphanDetails: 0, invalidDetails: 0, duplicateDetails: 0,
    zeroQuantityLines: 0, negativeQuantityLines: 0, amountQuantitySignMismatch: 0, unmappedCategoryLines: 0, ordersWithoutDetails: 0, mainDetailAmountMismatch: 0, largeOrders: 0, processingDateMismatchExcluded: 0 }; }
  function sumCents(xs) { return xs.reduce((n, row) => n + row.amountCents, 0); }
  function summarize(orders, details) {
    const saleCents = sumCents(orders), qty = details.reduce((n, x) => n + x.quantity, 0), units = [...new Set(details.map(x => x.unit))];
    const positiveLines = details.filter(x => x.quantity > 0 && x.amountCents > 0), priceUnits = [...new Set(positiveLines.map(x => x.unit))];
    const positiveQty = positiveLines.reduce((n, x) => n + x.quantity, 0), priceCents = sumCents(positiveLines);
    return { sales_amount: saleCents / 100, sales_amount_cents: saleCents, order_count: orders.length, sales_qty: round(qty, 3),
      aov: ratio(saleCents / 100, orders.length), units_per_order: units.length === 1 ? ratio(qty, orders.length) : null,
      avg_selling_price: units.length === 1 ? ratio(saleCents / 100, qty) : null,
      price_center: skuMedianPrice(details), price_method: 'median-of-positive-sku-average-deal-prices',
      quantity_units: units, quantity_comparable: units.length === 1, refund_order_count: orders.filter(x => x.amountCents < 0).length,
      detail_amount: sumCents(details) / 100, detail_count: details.length };
  }
  function groupStats(orders, details, dimension) {
    const map = new Map();
    if (dimension === 'store') for (const order of orders) {
      if (!map.has(order.storeId)) map.set(order.storeId, { id: order.storeId, name: order.storeName, orders: [], details: [] }); map.get(order.storeId).orders.push(order);
    }
    for (const line of details) {
      const id = dimension === 'store' ? line.storeId : dimension === 'category' ? line.categoryId : line.productId;
      const name = dimension === 'store' ? line.storeName : dimension === 'category' ? line.categoryName : line.productName;
      if (!map.has(id)) map.set(id, { id, name, orders: [], details: [] }); map.get(id).details.push(line);
    }
    const byOrder = new Map(orders.map(x => [x.key, x]));
    return [...map.values()].map(group => {
      if (dimension !== 'store') group.orders = [...new Set(group.details.map(x => x.orderKey))].map(key => byOrder.get(key)).filter(Boolean);
      const stats = summarize(group.orders, group.details);
      if (dimension !== 'store') { stats.sales_amount_cents = sumCents(group.details); stats.sales_amount = stats.sales_amount_cents / 100; stats.aov = null; stats.avg_selling_price = stats.quantity_comparable ? ratio(stats.sales_amount, stats.sales_qty) : null; }
      return { id: group.id, name: group.name, ...stats, order_coverage: group.orders.length, store_coverage: new Set(group.details.map(x => x.storeId)).size,
        category_verified: dimension !== 'category' || group.id !== 'unmapped' };
    }).sort((a, b) => b.sales_amount_cents - a.sales_amount_cents || a.id.localeCompare(b.id));
  }
  function mappingRows(input) {
    const map = new Map();
    for (const row of Array.isArray(input.categoryMapping) ? input.categoryMapping : []) {
      // Name guesses, example products and unverified classifications never become authoritative mapping.
      const sku = safe(row.sku || row.productId), id = safe(row.middleCategoryCode || row.categoryCode || row.categoryId), name = safe(row.middleCategoryName || row.categoryName);
      if (sku && id && name && row.verified === true) map.set(sku, { categoryId: id, categoryName: name });
    }
    return map;
  }
  function analyze(input, overrides) {
    input = input || {}; const cfg = config(overrides || input.config), generatedAt = safe(input.now || input.updatedAt, 60);
    const now = Date.parse(generatedAt), businessDate = validDate(input.businessDate) ? input.businessDate : generatedAt.slice(0, 10);
    if (!validDate(businessDate) || !Number.isFinite(now) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(generatedAt)) throw new Error('分析须提供 businessDate 与含时区的 now');
    const offsetMatch = /^([+-])(\d{2}):(\d{2})$/.exec(cfg.timeZoneOffset);
    const offset = offsetMatch ? (offsetMatch[1] === '-' ? -1 : 1) * (+offsetMatch[2] * 60 + +offsetMatch[3]) : 480;
    const localNow = new Date(now + offset * 60000).toISOString(), cutoff = seconds(localNow.slice(11, 19));
    if (businessDate !== localNow.slice(0, 10)) throw new Error('businessDate须与分析时区的当前日期一致');
    const source = input.source || {}, kindValue = safe(source.kind), kind = kindValue === 'replay' ? 'historical-order-replay' : kindValue === 'actual-today' ? 'actual' : kindValue || 'unverified', cadence = safe(source.updateCadence) || 'unknown';
    const quality = qualityCounts(), mappings = mappingRows(input), normalized = orderRows(input.orders, cfg, businessDate, cutoff, quality);
    const orders = normalized.rows, details = detailRows(input.details, orders, normalized.rawKeys, cfg, mappings, quality);
    const perOrder = new Map(); for (const row of details) perOrder.set(row.orderKey, (perOrder.get(row.orderKey) || 0) + row.amountCents);
    for (const order of orders) {
      if (!perOrder.has(order.key)) quality.ordersWithoutDetails++;
      else if (Math.abs(perOrder.get(order.key) - order.amountCents) > cfg.amountToleranceCents) quality.mainDetailAmountMismatch++;
      if (Math.abs(order.amountCents) >= cfg.largeOrderAmount * 100) quality.largeOrders++;
    }
    const warnings = [], warning = (code, countValue, message, severity) => { if (countValue > 0) warnings.push({ code, count: countValue, message, severity }); };
    warning('invalid_order', quality.invalidOrders, '主表必要字段或时间无效，已排除', 'high');
    warning('duplicate_order', quality.duplicateOrders, '重复主单已去重', 'high');
    warning('orphan_detail', quality.orphanDetails, '明细未找到主单', 'high');
    warning('invalid_detail', quality.invalidDetails, '明细必要字段或数量无效，已排除', 'high');
    warning('duplicate_detail', quality.duplicateDetails, '重复明细已去重', 'high');
    warning('missing_detail', quality.ordersWithoutDetails, '主单未接到明细', 'high');
    warning('main_detail_mismatch', quality.mainDetailAmountMismatch, '订单金额与明细合计不一致', 'high');
    warning('zero_quantity', quality.zeroQuantityLines, '商品数量为零，不能参与价格计算', 'medium');
    warning('negative_quantity', quality.negativeQuantityLines, '负数量行需结合退单记录核验', 'medium');
    warning('amount_qty_sign', quality.amountQuantitySignMismatch, '金额与数量方向不一致，相关行不参与成交价计算', 'medium');
    warning('unmapped_category', quality.unmappedCategoryLines, 'SKU正式分类映射缺失', 'medium');
    warning('large_order', quality.largeOrders, '大额单达到配置核验阈值', 'medium');
    const dataQuality = { status: warnings.some(x => x.severity === 'high') ? 'error' : warnings.length ? 'warning' : 'ok', warnings, counts: quality };
    const stats = summarize(orders, details), stores = groupStats(orders, details, 'store'), categories = groupStats(orders, details, 'category'), products = groupStats(orders, details, 'product');
    const last = orders.slice().sort((a, b) => b.stamp - a.stamp)[0], lastTime = last ? businessDate + 'T' + last.time + cfg.timeZoneOffset : null;
    const lag = lastTime ? Math.max(0, Math.round((now - Date.parse(lastTime)) / 1000)) : null;
    const freshness = { last_order_time: lastTime, lag_seconds: lag,
      status: kind === 'historical-order-replay' || cadence === 'historical-replay' ? 'historical-replay' : cadence === 'daily-batch' ? 'batch' : cadence !== 'stream' ? 'unverified' : !last ? 'empty' : lag > cfg.freshnessLagSeconds ? 'delayed' : 'fresh',
      source_updated_at: safe(source.updatedAt, 60) || null, update_cadence: cadence };
    const historyQuality = qualityCounts(), historyNormalized = orderRows(input.historyOrders, cfg, '', null, historyQuality, true);
    const history = historyNormalized.rows.filter(x => x.date < businessDate), historyItems = detailRows(input.historyDetails, history, historyNormalized.rawKeys, cfg, mappings, historyQuality);
    const historyAmounts = new Map(); for (const line of historyItems) historyAmounts.set(line.orderKey, (historyAmounts.get(line.orderKey) || 0) + line.amountCents);
    for (const order of history) {
      if (!historyAmounts.has(order.key)) historyQuality.ordersWithoutDetails++;
      else if (Math.abs(historyAmounts.get(order.key) - order.amountCents) > cfg.amountToleranceCents) historyQuality.mainDetailAmountMismatch++;
    }
    const availableDates = [...new Set(history.map(x => x.date))].sort();
    const completeDates = (input.historyCompleteDates || source.historyCompleteDates || []).filter(x => validDate(x) && availableDates.includes(x));
    const usableDates = [...new Set(completeDates)].sort();
    const historyReady = usableDates.length >= cfg.minimumHistoryDays;
    const businessDay = Date.parse(businessDate + 'T00:00:00Z');
    const recent = (dates, days) => dates.filter(day => { const age = (businessDay - Date.parse(day + 'T00:00:00Z')) / 86400000; return age > 0 && age <= days; });
    function selectDates(dates) {
      const last28 = recent(dates, cfg.lookbackDays.weekday), last14 = recent(dates, cfg.lookbackDays.recent), last7 = recent(dates, cfg.lookbackDays.short);
      const weekday = last28.filter(day => new Date(day + 'T00:00:00Z').getUTCDay() === new Date(businessDate + 'T00:00:00Z').getUTCDay());
      if (dates.length >= cfg.weekdayBaselineDays && weekday.length >= cfg.minimumHistoryDays) return { dates: weekday, method: 'same-weekday-same-time', level: 'basic' };
      if (dates.length >= cfg.basicBaselineDays && last14.length >= cfg.minimumHistoryDays) return { dates: last14, method: 'same-time-14-day-mean', level: last14.length >= cfg.basicBaselineDays ? 'basic' : 'low-sample' };
      if (dates.length >= cfg.basicBaselineDays && last28.length >= cfg.minimumHistoryDays) return { dates: last28, method: 'same-time-28-day-mean', level: 'basic' };
      return { dates: last7, method: 'same-time-simple-mean', level: 'low-sample' };
    }
    const selection = selectDates(usableDates), baselineDates = selection.dates;
    const historicalIntegrity = historyQuality.invalidOrders + historyQuality.duplicateOrders + historyQuality.orphanDetails + historyQuality.invalidDetails + historyQuality.duplicateDetails + historyQuality.ordersWithoutDetails + historyQuality.mainDetailAmountMismatch === 0;
    const comparisonAligned = !(kind === 'historical-order-replay' && new Set([...(source.sourceDates || []), ...orders.map(x => x.date)]).size > 1);
    const baselineAllowed = historyReady && baselineDates.length >= cfg.minimumHistoryDays && historicalIntegrity && comparisonAligned && dataQuality.status !== 'error' && freshness.status !== 'delayed';
    // Index a historical day once; per-SKU baselines then use map lookups instead of rescanning all rows.
    const historyByDate = new Map(), itemsByDate = new Map(), historyCache = new Map();
    for (const order of history) { if (!historyByDate.has(order.date)) historyByDate.set(order.date, []); historyByDate.get(order.date).push(order); }
    for (const line of historyItems) { if (!itemsByDate.has(line.date)) itemsByDate.set(line.date, []); itemsByDate.get(line.date).push(line); }
    function historicalMetrics(type, id, dateValue, fullDay) {
      const cacheKey = dateValue + '|' + fullDay;
      if (!historyCache.has(cacheKey)) {
        const dayOrders = (historyByDate.get(dateValue) || []).filter(row => fullDay || row.stamp <= cutoff);
        const keys = new Set(dayOrders.map(x => x.key)), dayItems = (itemsByDate.get(dateValue) || []).filter(row => keys.has(row.orderKey));
        const cache = { global: summarize(dayOrders, dayItems), store: new Map(), category: new Map(), sku: new Map() };
        for (const dimension of ['store', 'category', 'product']) {
          const target = dimension === 'product' ? cache.sku : cache[dimension];
          for (const row of groupStats(dayOrders, dayItems, dimension)) target.set(row.id, row);
        }
        historyCache.set(cacheKey, cache);
      }
      const cache = historyCache.get(cacheKey);
      return type === 'global' ? cache.global : cache[type].get(id) || { sales_amount: 0, order_count: 0, sales_qty: 0, aov: null, quantity_comparable: false };
    }
    function baseline(type, id) {
      if (!baselineAllowed) return null;
      // A full county day does not establish that a new store was open. Do not invent zero-sales open days.
      const scopeDates = type === 'store' ? usableDates.filter(day => historicalMetrics(type, id, day, true).order_count > 0) : usableDates;
      if (scopeDates.length < cfg.minimumHistoryDays) return null;
      const selection = selectDates(scopeDates), dates = selection.dates;
      if (dates.length < cfg.minimumHistoryDays) return null;
      const rows = dates.map(day => historicalMetrics(type, id, day, false));
      return { sales_amount: mean(rows.map(x => x.sales_amount)), order_count: mean(rows.map(x => x.order_count)), sales_qty: rows.every(x => x.quantity_comparable !== false) ? mean(rows.map(x => x.sales_qty)) : null,
        aov: ratio(mean(rows.map(x => x.sales_amount)), mean(rows.map(x => x.order_count))), sample_days: rows.length, total_scope_days: scopeDates.length,
        method: selection.method, evidence_level: selection.level, baseline_dates: dates };
    }
    const bucket = Math.floor(cutoff / (cfg.timeBucketMinutes * 60)), sourceDates = [...new Set(orders.map(x => x.date))].sort();
    const insights = [];
    function make(type, id, name, signal, severity, headline, metrics, evidence, recommendations, extra) {
      const item = { analysis_id: [type, id, signal, businessDate.replace(/-/g, ''), bucket].join('_'), generated_at: generatedAt,
        data_time_range: { start: businessDate + 'T00:00:00' + cfg.timeZoneOffset, end: generatedAt },
        freshness: { ...freshness }, scope: { type, id, name }, signal_type: signal, severity, headline,
        metrics, factors: [], evidence, forecast: null, recommendations: recommendations || [], confidence: null,
        confidence_basis: '未校准统计概率；以样本条件和数据状态说明证据强度', data_quality: dataQuality,
        record_kind: 'observed', ...extra };
      insights.push(item); return item;
    }
    const metric = (name, value, base, extra) => ({ name, current: round(value, name === 'sales_qty' ? 3 : ['price_center', 'price_index'].includes(name) ? 8 : 2), baseline: numeric(base) ? round(base) : null,
      change_pct: percent(value, base), ...extra });
    if (warnings.length) make('global', 'all', '全部门店', 'data_quality', dataQuality.status === 'error' ? 'critical' : 'warning', '先核验数据口径',
      warnings.map(x => metric(x.code, x.count, null)), warnings.map(x => x.message + '：' + count(x.count) + '条'), ['核验主从表与正式分类映射后再判断品类变化']);
    const salesBase = baseline('global', 'all');
    const coreEvidence = ['已发生订单销售额' + money(stats.sales_amount) + '，去重订单' + count(stats.order_count) + '单，客单价' + money(stats.aov),
      stats.refund_order_count > 0 ? '含' + count(stats.refund_order_count) + '笔负金额订单，销售金额保留其方向' : '销售金额按订单主表累计'];
    if (kind === 'historical-order-replay') coreEvidence.push('原始' + sourceDates.length + '天订单映射到当前日期展示，属于历史记录回放');
    if (!historyReady) coreEvidence.push('已确认完整时段历史' + usableDates.length + '天，数据不足，暂不做趋势或收口预测');
    if (historyQuality.processingDateMismatchExcluded) coreEvidence.push('历史' + historyQuality.processingDateMismatchExcluded + '单处理日期与记账日不同，已连同明细排除同时点基线');
    if (!comparisonAligned) coreEvidence.push('多日原始订单叠加回放，不能直接与单日同时间均值比较或预测收口');
    if (!stats.quantity_comparable && details.length) coreEvidence.push('明细含' + stats.quantity_units.join('、') + '单位，件单量与全局平均件价暂不计算');
    const sales = make('global', 'all', '全部门店', 'sales_overview', 'info', '销售态势与订单结构',
      [metric('sales_amount', stats.sales_amount, salesBase && salesBase.sales_amount), metric('order_count', stats.order_count, salesBase && salesBase.order_count),
        metric('aov', stats.aov, salesBase && salesBase.aov), metric('sales_qty', stats.sales_qty, null, { unit: stats.quantity_comparable ? stats.quantity_units[0] : '原始混合单位，仅作核对' }),
        metric('units_per_order', stats.units_per_order, null), metric('avg_selling_price', stats.avg_selling_price, null)], coreEvidence, ['按订单与品类事实安排门店销售观察']);
    if (salesBase) {
      const deltaOrders = percent(stats.order_count, salesBase.order_count), deltaAov = percent(stats.aov, salesBase.aov);
      const dominant = numeric(deltaOrders) && numeric(deltaAov) && Math.abs(deltaOrders) >= Math.abs(deltaAov) ? 'order_count' : 'aov';
      sales.factors.push({ name: dominant, direction: (dominant === 'order_count' ? deltaOrders : deltaAov) >= 0 ? 'positive' : 'negative', strength: 'rule-related',
        evidence: '销售变化主要伴随' + (dominant === 'order_count' ? '订单数' : '客单价') + '变化；规则相关不表示因果' });
      sales.evidence.push('较' + salesBase.sample_days + '天同时间销售均值变化' + count(percent(stats.sales_amount, salesBase.sales_amount)) + '%（' + salesBase.evidence_level + '）');
    }
    for (const store of stores) {
      const base = baseline('store', store.id), change = base && percent(store.sales_amount, base.sales_amount);
      make('store', store.id, store.name, change !== null && base && Math.abs(change) >= cfg.changeThresholdPercent ? 'store_sales_anomaly' : 'store_sales',
        change !== null && base && Math.abs(change) >= cfg.changeThresholdPercent ? 'warning' : 'info', store.name + '当前订单表现',
        [metric('sales_amount', store.sales_amount, base && base.sales_amount), metric('order_count', store.order_count, base && base.order_count), metric('aov', store.aov, base && base.aov)],
        [store.name + '销售' + money(store.sales_amount) + '，' + count(store.order_count) + '单，客单价' + money(store.aov)], [], { baseline: base });
    }
    const positiveCategoryAmount = categories.reduce((n, x) => n + Math.max(0, x.sales_amount), 0);
    for (const category of categories) {
      const base = baseline('category', category.id), share = ratio(Math.max(0, category.sales_amount) * 100, positiveCategoryAmount);
      category.sales_share_pct = share; category.price_index = numeric(category.price_center) && stats.price_center > 0 ? round(category.price_center / stats.price_center * 100, 8) : null;
      category.growth_pct = base ? percent(category.sales_amount, base.sales_amount) : null;
      // Growth and mixed-unit quantity scores are deliberately unavailable when the inputs do not support them.
      category.heat_index = null;
      make('category', category.id, category.name, 'category_structure', category.category_verified ? 'info' : 'warning', category.name + '成交结构',
        [metric('sales_amount', category.sales_amount, base && base.sales_amount), metric('sales_share_pct', share, null), metric('price_center', category.price_center, null), metric('price_index', category.price_index, null)],
        [category.name + '成交' + money(category.sales_amount) + '，覆盖' + count(category.order_coverage) + '单',
          category.category_verified ? '分类来自已核验SKU映射' : '分类数据不足，未按商品名称猜测归类'], [], { baseline: base });
    }
    if (baselineAllowed && stats.quantity_comparable && categories.every(x => numeric(x.growth_pct))) {
      const normalize = (value, values) => { const low = Math.min(...values), high = Math.max(...values); return high === low ? 50 : (value - low) / (high - low) * 100; };
      const amountScores = categories.map(x => x.sales_share_pct), quantityScores = categories.map(x => x.sales_qty), growthScores = categories.map(x => x.growth_pct), w = cfg.heatWeights;
      const weightSum = w.amount + w.quantity + w.growth;
      for (const category of categories) if (category.category_verified && weightSum > 0) {
        category.heat_index = round((w.amount * normalize(category.sales_share_pct, amountScores) + w.quantity * normalize(category.sales_qty, quantityScores) + w.growth * normalize(category.growth_pct, growthScores)) / weightSum);
        const insight = insights.find(x => x.scope.type === 'category' && x.scope.id === category.id);
        insight.metrics.push(metric('category_heat_index', category.heat_index, null)); insight.evidence.push('热度来自销售份额、同单位数量份额与历史增速配置加权；不代表库存状态');
      }
    }
    for (const product of products) {
      const base = baseline('sku', product.id); product.growth_pct = base ? percent(product.sales_amount, base.sales_amount) : null;
      make('sku', product.id, product.name, 'product_sales', 'info', product.name + '当前动销事实',
        [metric('sales_amount', product.sales_amount, base && base.sales_amount), metric('sales_qty', product.sales_qty, base && base.sales_qty), metric('order_coverage', product.order_coverage, null), metric('store_coverage', product.store_coverage, null)],
        [product.name + '销售' + money(product.sales_amount) + '，数量' + count(product.sales_qty) + product.quantity_units.join('/'), '订单覆盖' + count(product.order_coverage) + '单，门店覆盖' + count(product.store_coverage) + '家'], [], { baseline: base });
    }
    const buckets = new Map();
    for (const order of orders) { const index = Math.floor(order.stamp / (cfg.timeBucketMinutes * 60));
      if (!buckets.has(index)) buckets.set(index, { index, sales_amount_cents: 0, order_count: 0 }); const value = buckets.get(index); value.sales_amount_cents += order.amountCents; value.order_count++; }
    for (const line of details) { const value = buckets.get(Math.floor(line.stamp / (cfg.timeBucketMinutes * 60))); if (value) { value.sales_qty = (value.sales_qty || 0) + line.quantity; } }
    const timeBuckets = [...buckets.values()].sort((a, b) => a.index - b.index).map(row => ({ ...row, sales_amount: row.sales_amount_cents / 100,
      start: String(Math.floor(row.index * cfg.timeBucketMinutes / 60)).padStart(2, '0') + ':' + String(row.index * cfg.timeBucketMinutes % 60).padStart(2, '0'), complete: row.index < bucket, aov: ratio(row.sales_amount_cents / 100, row.order_count), sales_qty: round(row.sales_qty || 0, 3), quantity_comparable: stats.quantity_comparable }));
    const peak = timeBuckets.filter(x => x.complete).sort((a, b) => b.sales_amount_cents - a.sales_amount_cents)[0];
    if (peak) make('global', 'all', '全部门店', 'observed_time_peak', 'info', '已发生时段高峰',
      [metric('bucket_sales_amount', peak.sales_amount, null), metric('bucket_order_count', peak.order_count, null)],
      ['已完成' + cfg.timeBucketMinutes + '分钟时段中，' + peak.start + '起销售最高：' + money(peak.sales_amount) + '、' + count(peak.order_count) + '单'], ['按已发生时段观察收银与门店服务配置']);
    let forecast = null;
    const open = seconds(cfg.businessHours.open), close = seconds(cfg.businessHours.close), weights = cfg.forecastWeights;
    if (baselineAllowed && orders.length >= cfg.forecastMinimumOrders && cutoff >= open && cutoff < close && stats.sales_amount > 0) {
      const full = baselineDates.map(day => historicalMetrics('global', 'all', day, true)), current = baselineDates.map(day => historicalMetrics('global', 'all', day, false));
      const progress = mean(full.map((day, index) => day.sales_amount > 0 ? current[index].sales_amount / day.sales_amount : null).filter(numeric));
      const wSum = weights.currentProgress + weights.recentAverage;
      if (progress >= cfg.forecastMinimumProgress && progress <= 1 && wSum > 0) {
        const estimate = Math.max(stats.sales_amount, (weights.currentProgress * stats.sales_amount / progress + weights.recentAverage * mean(full.map(x => x.sales_amount))) / wSum);
        forecast = { record_kind: 'forecast', sales_amount: round(estimate), historical_progress: round(progress, 4), sample_days: baselineDates.length,
          method: 'historical-cumulative-progress-and-daily-mean', weights: { ...weights }, weather_adjustment: null, calendar_adjustment: null };
        make('global', 'all', '全部门店', 'eod_forecast', 'info', '当日收口预测', [], ['预计整日销售' + money(forecast.sales_amount) + '；来自' + baselineDates.length + '天完整历史累计进度'], [], { forecast, record_kind: 'forecast' });
      }
    }
    const consumer = input.consumerMetrics || {}, c = consumer.counts || {}, window = consumer.window || {};
    if (Number.isSafeInteger(c.identifiedCustomers) && c.identifiedCustomers > 0 && Number.isSafeInteger(c.purchaseOrders) && Number.isSafeInteger(c.repeatCustomers)
      && c.repeatCustomers >= 0 && c.repeatCustomers <= c.identifiedCustomers && c.purchaseOrders >= c.identifiedCustomers + c.repeatCustomers
      && validDate(window.start) && validDate(window.end) && window.end >= window.start) {
      const rate = round(c.repeatCustomers / c.identifiedCustomers * 100);
      make('global', 'all', '识别会员', 'member_repeat_observed', 'info', '会员重复购买事实',
        [metric('identified_customers', c.identifiedCustomers, null), metric('purchase_orders', c.purchaseOrders, null), metric('repeat_customers', c.repeatCustomers, null), metric('repeat_customer_pct', rate, null)],
        ['会员统计窗口' + window.start + '至' + window.end + '，识别会员' + count(c.identifiedCustomers) + '人，其中' + count(c.repeatCustomers) + '人多次下单，占' + count(rate) + '%', '不代表新注册会员或长期留存率'], ['观察会员多次下单与门店服务表现'], { data_time_range: { start: window.start, end: window.end } });
    }
    const weather = input.weather || {}, currentWeather = weather.current || weather, fetchedAt = weather.currentFetchedAt || weather.fetchedAt;
    const weatherAge = now - Date.parse(fetchedAt || ''), observedDate = safe(currentWeather.observedAt || weather.observedAt).slice(0, 10);
    const weatherFresh = ['ok', 'ready'].includes(weather.status) && weatherAge >= 0 && weatherAge <= cfg.weatherMaxAgeSeconds * 1000;
    if (numeric(currentWeather.temperature) || numeric(weather.temperature)) {
      const temperature = numeric(currentWeather.temperature) ? currentWeather.temperature : weather.temperature;
      make('global', 'all', safe((weather.location || {}).name) || '天气上下文', 'weather_context', weatherFresh ? 'info' : 'warning', weatherFresh ? '天气上下文' : '天气数据待更新',
        [metric('temperature_celsius', temperature, null)], [weatherFresh ? '最近天气快照气温' + count(temperature) + '℃' : '天气快照已过期或状态待核验，暂不用于经营判断', '未建立天气与订单历史模型，天气贡献比例为空'],
        [], { factors: [{ name: 'weather', observed_at: safe(currentWeather.observedAt) || null, fetched_at: safe(fetchedAt) || null,
          geographical_match: Boolean(weather.location), time_match: observedDate === businessDate, contribution_pct: null, basis: 'context-only' }] });
    }
    const warehouse = input.warehouse || {};
    if (warehouse.source === 'configuration') {
      const metrics = [['sorting_pieces', warehouse.sortingPieces], ['floor_stack_positions', warehouse.floorStackPositions], ['cold_zone_count', warehouse.coldZoneCount], ['cold_stored_tonnes', warehouse.coldStoredTonnes]].filter(x => numeric(x[1]) && x[1] >= 0).map(x => metric(x[0], x[1], null));
      if (metrics.length) make('global', 'all', '仓储配置', 'warehouse_configuration', 'info', '仓储配置口径', metrics,
        ['仓储数值为用户配置，库区数与存储吨位分开记录', '缺少SKU可用库存、批次和实际配送时间，不生成补货、缺货或准时率结论'], []);
    }
    return { schema_version: cfg.version, configuration: { refresh_seconds: cfg.refreshSeconds, minimum_history_days: cfg.minimumHistoryDays, time_bucket_minutes: cfg.timeBucketMinutes, business_hours: cfg.businessHours }, generated_at: generatedAt, business_date: businessDate, source: { kind, update_cadence: cadence, source_dates: sourceDates, classification_as_of: safe((input.categoryMappingSource || {}).classificationAsOf), classification_note: safe((input.categoryMappingSource || {}).snapshotNote, 240), history_source_days: usableDates.length },
      freshness, data_quality: dataQuality, history: { available_days: availableDates.length, complete_days: usableDates.length, baseline_enabled: baselineAllowed, comparison_aligned: comparisonAligned, method: salesBase && salesBase.method || null,
        limitation: usableDates.length < cfg.minimumHistoryDays ? '完整时段历史少于' + cfg.minimumHistoryDays + '天；只展示事实' : !historicalIntegrity ? '历史数据质量需核验' : !comparisonAligned ? '多日历史订单叠加回放，与单日同时点基线不具可比性；只展示事实' : null,
        aggregate_history_used_for_time_baseline: false, data_quality_counts: historyQuality, processing_date_policy: 'exclude-processing-date-different-from-accounting-date',
        baseline_order_count: history.length, baseline_detail_count: historyItems.length, store_coverage: [...new Set(history.map(x => x.storeId))].map(id => ({ store_id: id, dates: [...new Set(history.filter(x => x.storeId === id).map(x => x.date))].sort() })) },
      capabilities: { sales: true, categories: mappings.size > 0, prices: numeric(stats.price_center), time_buckets: true, trend: baselineAllowed,
        eod_forecast: Boolean(forecast), category_heat: categories.some(x => numeric(x.heat_index)), weather_contribution: false, inventory: false, procurement: false, delivery_fulfillment: false, margin: false },
      metrics: stats, stores, categories, products, time_buckets: timeBuckets, forecast, insights,
      disabled_conclusions: ['缺货判断', '补货数量', '采购数量', '库存健康', '库存滞销', '临期风险', '供应商履约', '配送准时率', '毛利', '天气数字归因', '价格弹性'] };
  }
  function narrate(analysis) {
    const rows = analysis.insights || [], core = rows.find(x => x.signal_type === 'sales_overview'), advice = [];
    const create = (insight, type, label, level, text, emphasis) => ({ type, label, level, text, emphasis: emphasis || [],
      analysisId: insight.analysis_id, ruleId: insight.signal_type, ruleVersion: analysis.schema_version, evidence: insight.evidence,
      metrics: insight.metrics, sources: [], dataQuality: insight.data_quality.status, freshness: insight.freshness.status });
    const quality = rows.find(x => x.signal_type === 'data_quality');
    if (quality) { const counts = analysis.data_quality.counts;
      const issue = counts.mainDetailAmountMismatch ? count(counts.mainDetailAmountMismatch) + '单主从金额不一致' : counts.ordersWithoutDetails ? count(counts.ordersWithoutDetails) + '单缺少明细' : counts.unmappedCategoryLines ? count(counts.unmappedCategoryLines) + '条明细尚未正式归类' : counts.amountQuantitySignMismatch ? count(counts.amountQuantitySignMismatch) + '行金额与数量方向不一致，已排除成交价计算' : quality.evidence[0];
      advice.push(create(quality, 'data', '数据核验', '核心', issue + '；先核验来源与口径，再判断品类变化。', ['先核验来源与口径'])); }
    if (core) {
      const x = analysis.metrics, source = analysis.source.kind === 'historical-order-replay' ? '当前已回放' : '当前已发生';
      const limitation = analysis.history.complete_days < analysis.configuration.minimum_history_days ? '完整时段历史不足' + analysis.configuration.minimum_history_days + '天，暂不预测。' : !analysis.history.comparison_aligned ? '多日叠加回放，暂不与单日比较或预测。' : analysis.freshness.status === 'delayed' ? '订单数据延迟，先核验同步。' : '按订单结构观察门店销售。';
      advice.push(create(core, 'stock', '销售态势', '核心', source + '销售' + money(x.sales_amount) + '、' + count(x.order_count) + '单，客单价' + money(x.aov) + '；' + limitation, ['销售' + money(x.sales_amount)]));
    }
    const member = rows.find(x => x.signal_type === 'member_repeat_observed'), topStore = analysis.stores[0];
    if (member) {
      const x = Object.fromEntries(member.metrics.map(x => [x.name, x.current]));
      advice.push(create(member, 'plan', '会员活跃', '一般', '统计窗口内识别会员' + count(x.identified_customers) + '人，' + count(x.repeat_customers) + '人多次下单（' + count(x.repeat_customer_pct) + '%）；观察重复购买表现。', ['多次下单']));
    } else if (topStore) {
      const store = rows.find(x => x.scope.type === 'store' && x.scope.id === topStore.id);
      advice.push(create(store, 'plan', '门店贡献', '一般', topStore.name + '当前销售' + money(topStore.sales_amount) + '、' + count(topStore.order_count) + '单；按已发生订单核对门店表现。', [topStore.name]));
    }
    const category = analysis.categories.find(x => x.category_verified), categoryInsight = category && rows.find(x => x.scope.type === 'category' && x.scope.id === category.id);
    const peak = rows.find(x => x.signal_type === 'observed_time_peak'), weather = rows.find(x => x.signal_type === 'weather_context');
    if (categoryInsight) advice.push(create(categoryInsight, 'forecast', '商品结构', '一般', category.name + '当前成交' + money(category.sales_amount) + '，覆盖' + count(category.order_coverage) + '单；按正式分类观察销售结构。', [category.name]));
    else if (peak) advice.push(create(peak, 'forecast', '时段观察', '一般', peak.evidence[0] + '；按已发生时段观察服务配置。', ['已发生时段']));
    else if (weather) advice.push(create(weather, 'forecast', '天气观察', '一般', weather.evidence.join('；') + '。', ['天气数据待更新']));
    return advice.slice(0, 4);
  }
  // A fact-only proxy contract: the remote model selects an insight and evidence; it cannot insert new claims.
  function validateNarration(payload, analysis) {
    if (!payload || !Array.isArray(payload.advice) || payload.advice.length < 1 || payload.advice.length > 4) throw new Error('分析代理返回建议列表无效');
    const allowed = new Map(analysis.insights.map(x => [x.analysis_id, x]));
    return payload.advice.map(item => {
      const insight = item && allowed.get(item.analysisId);
      if (!insight || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 180 || !['stock', 'data', 'plan', 'forecast'].includes(item.type)) throw new Error('建议须引用当前分析事实ID');
      const text = item.text.trim();
      if (/净额|导致|保证|缺货|补货|采购量|毛利|准时率|库存健康|滞销|弹性|新注册|会员姓名|<[^>]*>/.test(text)) throw new Error('建议包含未授权结论或格式');
      // Free rewriting cannot be proved factual in a browser. Exact evidence selection is verifiable and fails closed.
      const candidates = [...insight.evidence, ...insight.recommendations];
      if (!candidates.includes(text)) throw new Error('远程文案未与结构化证据一致');
      const labels = { stock: '销售态势', data: '数据核验', plan: '经营观察', forecast: '时段观察' };
      return { type: item.type, label: labels[item.type], level: insight.severity === 'critical' || insight.severity === 'warning' ? '核心' : '一般', text,
        emphasis: [], analysisId: insight.analysis_id, ruleId: insight.signal_type, ruleVersion: analysis.schema_version,
        evidence: insight.evidence, metrics: insight.metrics, sources: [], dataQuality: insight.data_quality.status, freshness: insight.freshness.status };
    });
  }
  function proxyContext(analysis) {
    const selected = analysis.insights.filter(x => x.scope.type === 'global');
    for (const type of ['store', 'category', 'sku']) selected.push(...analysis.insights.filter(x => x.scope.type === type).slice(0, 3));
    return { schema_version: analysis.schema_version, generated_at: analysis.generated_at, business_date: analysis.business_date, source: analysis.source, freshness: analysis.freshness, data_quality: analysis.data_quality, history: analysis.history, capabilities: analysis.capabilities, metrics: analysis.metrics, forecast: analysis.forecast, insights: selected, disabled_conclusions: analysis.disabled_conclusions };
  }
  const API = { defaults: DEFAULTS, analyze, narrate, validateNarration, proxyContext, config };
  global.SupplyChainAnalysis = API;
  if (typeof module === 'object' && module.exports) module.exports = API;
})(typeof window === 'object' ? window : globalThis);
