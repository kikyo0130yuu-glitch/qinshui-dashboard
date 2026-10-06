(function (global) {
  'use strict';
  const DEFAULT_COLORS = { gold: '#ffe551', cyan: '#2eace2', text: '#ffffff', muted: '#92a0b7', grid: 'rgba(46,172,226,0.15)' };
  const finiteAmount = value => value == null ? null : typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  const exactYuan = value => value == null ? '—' : value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' 元';
  const toWan = value => value == null ? null : value / 10000;

  function normalize(data) {
    if (!data || data.currency !== 'CNY' || !Array.isArray(data.months)) throw new TypeError('invalid_monthly_sales_data');
    const seen = new Set();
    return data.months.map(row => {
      if (!row || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(row.month) || seen.has(row.month)) throw new TypeError('invalid_monthly_sales_month');
      seen.add(row.month);
      const actual = finiteAmount(row.actualSalesCny);
      const estimate = finiteAmount(row.estimatedSalesCny);
      const [year, month] = row.month.split('-').map(Number);
      let periodEnd = row.actualPeriodEnd == null ? null : row.actualPeriodEnd;
      let partial = Boolean(row.partial);
      if (periodEnd != null) {
        const parsed = Date.parse(periodEnd + 'T00:00:00Z');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== periodEnd || periodEnd.slice(0, 7) !== row.month) throw new TypeError('invalid_actual_period_end');
        const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
        partial = Number(periodEnd.slice(8)) < lastDay;
        if (typeof row.partial === 'boolean' && row.partial !== partial) throw new TypeError('inconsistent_actual_period');
      } else if (actual != null) {
        throw new TypeError('missing_actual_period_end');
      }
      return { month: row.month, monthNumber: month, actual, estimate, periodEnd, partial };
    }).sort((a, b) => a.month.localeCompare(b.month));
  }

  function buildOption(data, colors, forecast) {
    const palette = Object.assign({}, DEFAULT_COLORS, colors || {}), barColor = '#19bdd6';
    const observed = normalize(data), firstYear = observed[0] && observed[0].month.slice(0, 4);
    const byMonth = new Map(observed.map(row => [row.month, { ...row, prediction: null }]));
    const predicted = forecast && forecast.sourceKind === 'trend-model-forecast' && Array.isArray(forecast.months) ? forecast.months : [];
    for (const prediction of predicted) {
      if (!prediction || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(prediction.month)
        || [prediction.pointSalesCny, prediction.scenarioLowerSalesCny, prediction.scenarioUpperSalesCny].some(value => finiteAmount(value) == null)
        || prediction.scenarioLowerSalesCny > prediction.pointSalesCny || prediction.pointSalesCny > prediction.scenarioUpperSalesCny) throw new TypeError('invalid_sales_forecast');
      const row = byMonth.get(prediction.month) || { month: prediction.month, monthNumber: Number(prediction.month.slice(5)), actual: null, estimate: null, periodEnd: null, partial: false };
      byMonth.set(prediction.month, { ...row, prediction });
    }
    const rows = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)), hasForecast = predicted.length > 0;
    const maximum=Math.max(0,...rows.flatMap(row=>[row.actual||0,row.estimate||0,row.prediction?.scenarioUpperSalesCny||0]));
    const monthLabel = row => (row.month.slice(0, 4) !== firstYear ? row.month.slice(2, 4) + '年' : '') + row.monthNumber + '月';
    const cutoffLabel = row => row.periodEnd ? '截至' + row.monthNumber + '月' + Number(row.periodEnd.slice(8)) + '日' : '部分月';
    const actualSeries = {
      name: '实际销售额', type: 'bar', barWidth: hasForecast ? 28 : 38, itemStyle: { color: barColor },
      data: rows.map(row => ({ value: toWan(row.actual), itemStyle: row.partial ? { opacity: .8, borderColor: barColor, borderWidth: 1, borderType: 'dashed' } : undefined, label: row.actual!=null&&row.estimate!=null&&maximum>0&&(row.estimate-row.actual)/maximum>.03&&(row.estimate-row.actual)/maximum<.23?{distance:28}:undefined })),
      label: { show: true, position: 'top', distance: 10, color: barColor, fontSize: 16, formatter: params => params.value == null ? '' : params.value.toFixed(2) }
    };
    const existingName = hasForecast ? '已有预期' : '销售预估';
    const existingLine = { name: existingName, type: 'line', connectNulls: false, data: rows.map(row => toWan(row.estimate)), symbol: 'circle', symbolSize: 7,
      lineStyle: { color: palette.gold, width: 2, type: 'solid' }, itemStyle: { color: palette.gold }, z: 5 };
    const series = [actualSeries, existingLine];
    if (hasForecast) {
      series.push({ name: '预测销售额', type: 'bar', barWidth: 28, barGap: rows.some(row => row.actual != null && row.prediction) ? '35%' : '-100%',
        data: rows.map(row => row.prediction ? toWan(row.prediction.pointSalesCny) : null),
        itemStyle: { color: 'rgba(25,189,214,.24)', borderColor: '#94d7f5', borderWidth: 1, borderType: 'dashed' },
        label: { show: true, position: 'top', distance: 10, color: '#94d7f5', fontSize: 16, formatter: params => params.value == null ? '' : params.value.toFixed(2) } });
      // The model line is separate from supplied expectations; never join two different sources across October/November.
      series.push({ name: '模型预期', type: 'line', connectNulls: false, data: rows.map(row => row.prediction ? toWan(row.prediction.pointSalesCny) : null),
        symbol: 'emptyCircle', symbolSize: 7, lineStyle: { color: palette.gold, width: 2, type: 'dashed' }, itemStyle: { color: palette.gold }, z: 5 });
      series.push({ name: '情景范围', type: 'custom', silent: true, clip: true, z: 4,
        data: rows.flatMap((row, index) => row.prediction ? [[index, toWan(row.prediction.scenarioLowerSalesCny), toWan(row.prediction.scenarioUpperSalesCny)]] : []),
        renderItem: function (params, api) {
          const low = api.coord([api.value(0), api.value(1)]), high = api.coord([api.value(0), api.value(2)]);
          const style = { stroke: '#94d7f5', lineWidth: 1.5, opacity: .75 };
          return { type: 'group', children: [
            { type: 'line', shape: { x1: low[0], y1: low[1], x2: high[0], y2: high[1] }, style },
            { type: 'line', shape: { x1: low[0] - 7, y1: low[1], x2: low[0] + 7, y2: low[1] }, style },
            { type: 'line', shape: { x1: high[0] - 7, y1: high[1], x2: high[0] + 7, y2: high[1] }, style }
          ] };
        } });
    }
    return {
      animation: false, color: [barColor, palette.gold],
      grid: { left: 72, right: 28, top: 42, bottom: 62 },
      legend: { top: 0, left: 'center', itemWidth: 20, itemHeight: 10, itemGap: 22, textStyle: { color: palette.muted, fontSize: 18 },
        data: [{ name: '实际销售额', icon: 'rect' }, { name: existingName }, ...(hasForecast ? [{ name: '预测销售额', icon: 'rect' }, { name: '模型预期' }] : [])] },
      tooltip: { trigger: 'axis', confine: true, backgroundColor: 'rgba(6,20,36,.96)', borderColor: palette.grid, textStyle: { color: palette.text, fontSize: 15 },
        formatter: function (params) {
          const first = Array.isArray(params) ? params[0] : params, row = rows[first && first.dataIndex];
          if (!row) return '';
          const title = row.month.slice(0, 4) + '年' + row.monthNumber + '月';
          const lines = [title];
          if (row.actual != null) lines.push('实际销售额：' + exactYuan(row.actual) + (row.partial ? '（' + cutoffLabel(row) + '）' : ''));
          else if (!row.prediction) lines.push('实际销售额：—');
          if (row.estimate != null) lines.push((hasForecast?'已有预期':'销售预估')+'：' + exactYuan(row.estimate));
          else if (!row.prediction) lines.push('销售预估：—');
          if (row.prediction) {
            lines.push('预测销售额 / 模型预期：' + exactYuan(row.prediction.pointSalesCny));
            lines.push('情景范围：' + exactYuan(row.prediction.scenarioLowerSalesCny) + '–' + exactYuan(row.prediction.scenarioUpperSalesCny));
            lines.push('情景范围非置信区间；模型预期不是业务目标。');
            lines.push('观测截至' + forecast.observedThrough + '；阻尼系数' + (typeof forecast.model.damping==='number'?forecast.model.damping:forecast.model.damping.value));
            lines.push('训练'+forecast.model.completeMonthCount+'个完整月；最近观测'+forecast.model.anchor.coveredCalendarDays+'天，未校正节假日。');
          }
          return lines.join('<br>');
        } },
      xAxis: { type: 'category', data: rows.map(row => monthLabel(row) + (row.prediction && row.actual == null ? '\n预测' : row.partial ? '\n' + cutoffLabel(row) : '')),
        axisLabel: { color: palette.muted, fontSize: 18, lineHeight: 22, interval: 0, margin: 10 }, axisTick: { show: false }, axisLine: { lineStyle: { color: palette.grid } } },
      yAxis: { type: 'value', name: '万元', min: 0, splitNumber: 3, nameTextStyle: { color: palette.muted, fontSize: 16 },
        axisLabel: { color: palette.muted, fontSize: 17, formatter: value => value.toLocaleString('zh-CN') }, axisTick: { show: false }, axisLine: { show: false }, splitLine: { lineStyle: { color: palette.grid } } },
      series
    };
  }

  global.SalesTrend = Object.freeze({ title: '销售情况与业绩走势', buildOption: buildOption });
})(typeof window !== 'undefined' ? window : globalThis);
