/* Config-driven demand arithmetic. No sales values or event dates live here. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProductDemandTrend = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function isFiniteWeight(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
  }

  function validDateString(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const time = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
  }

  function getShanghaiDate(now) {
    if (validDateString(now)) return now;
    if (typeof now === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(now)) {
      throw new RangeError('Invalid business date');
    }
    const instant = now === undefined ? new Date() : new Date(now);
    if (!Number.isFinite(instant.getTime())) throw new RangeError('Invalid reference date');
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(instant);
    const values = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return values.year + '-' + values.month + '-' + values.day;
  }

  function addDays(dateString, count) {
    if (!validDateString(dateString) || !Number.isInteger(count)) throw new RangeError('Invalid natural day offset');
    const date = new Date(dateString + 'T00:00:00Z');
    date.setUTCDate(date.getUTCDate() + count);
    return date.toISOString().slice(0, 10);
  }

  function validateParameters(config) {
    if (!config || config.timeZone !== 'Asia/Shanghai') throw new TypeError('Asia/Shanghai weight configuration required');
    const factors = config.factors || {};
    for (const name of ['monthFactor', 'weekdayFactor', 'holidayFactor']) {
      if (!isFiniteWeight(factors[name])) throw new TypeError('Missing or invalid factor: ' + name);
    }
    const limits = config.demandIndexLimits || {};
    if (!isFiniteWeight(limits.min) || !isFiniteWeight(limits.max) || limits.min > limits.max) {
      throw new TypeError('Invalid configured demand limits');
    }
    if (!isFiniteWeight(config.fallbackWeight) || !isFiniteWeight(config.normalHolidayWeight)) {
      throw new TypeError('Configured fallback and normal holiday weights required');
    }
    if (!Array.isArray(config.trendLevels) || !config.trendLevels.length ||
      config.trendLevels.some(t => !t || typeof t.label !== 'string' || (t.min !== null && !isFiniteWeight(t.min))) ||
      config.trendLevels[config.trendLevels.length - 1].min !== null) {
      throw new TypeError('Configured trend thresholds required');
    }
    const bounds = config.trendLevels.filter(t => t.min !== null).map(t => t.min);
    if (bounds.some((v, i) => i && v >= bounds[i - 1])) throw new TypeError('Trend thresholds must be descending');
  }

  function classifyDemandTrend(index, config) {
    if (typeof index !== 'number' || !Number.isFinite(index)) return null;
    const levels = config && config.trendLevels;
    if (!Array.isArray(levels)) throw new TypeError('Configured trend thresholds required');
    const level = levels.find(t => t.min === null || index >= t.min);
    return level ? level.label : null;
  }

  function classifyTrendDirection(index, config) {
    if (typeof index !== 'number' || !Number.isFinite(index)) return null;
    const level = config?.trendLevels?.find(t => t.min === null || index >= t.min);
    return level?.direction || null;
  }

  function calcDemandIndex(weights, config) {
    validateParameters(config);
    for (const name of ['monthWeight', 'weekdayWeight', 'holidayWeight']) {
      if (!isFiniteWeight(weights[name])) throw new TypeError('Invalid resolved weight: ' + name);
    }
    const f = config.factors;
    const raw = Number((1 + f.monthFactor * (weights.monthWeight - 1)
      + f.weekdayFactor * (weights.weekdayWeight - 1)
      + f.holidayFactor * (weights.holidayWeight - 1)).toFixed(12));
    const value = Number(Math.max(config.demandIndexLimits.min,
      Math.min(config.demandIndexLimits.max, raw)).toFixed(12));
    return { rawDemandIndex: raw, demandIndex: value, finalDemandIndex: value, isClamped: raw !== value,
      trendLevel: classifyDemandTrend(value, config), trendDirection: classifyTrendDirection(value, config) };
  }

  function getWeightForDate(dateString, config) {
    validateParameters(config);
    if (!validDateString(dateString)) throw new RangeError('Invalid business date');
    const d = new Date(dateString + 'T00:00:00Z');
    const month = d.getUTCMonth() + 1, weekday = d.getUTCDay(), year = d.getUTCFullYear();
    const missing = [], warnings = [];
    function resolve(record, factor) {
      if (record && isFiniteWeight(record.weight)) return record.weight;
      const flag = { code: 'MISSING_WEIGHT', factor: factor, date: dateString,
        fallbackWeight: config.fallbackWeight };
      missing.push(flag);
      return config.fallbackWeight;
    }
    const monthWeight = resolve(config.months && config.months[String(month)], 'month');
    const weekdayRecord = config.weekdays && config.weekdays[String(weekday)];
    const weekdayWeight = resolve(weekdayRecord, 'weekday');
    const holidays = Array.isArray(config.holidays) ? config.holidays : [];
    const matches = [];
    for (const event of holidays) {
      if (!event || !validDateString(event.start) || !validDateString(event.end) || event.start > event.end) {
        warnings.push({ code: 'INVALID_HOLIDAY_EVENT', date: dateString, name: event && event.name });
      } else if (event.start <= dateString && dateString <= event.end) matches.push(event);
    }
    let holidayWeight;
    if (matches.length) {
      if (config.overlappingHolidayPolicy !== 'max') throw new TypeError('Configured max overlap policy required');
      holidayWeight = Math.max(...matches.map(event => resolve(event, 'holiday')));
      if (matches.length > 1) warnings.push({ code: 'OVERLAPPING_HOLIDAY_EVENTS', date: dateString,
        policy: config.overlappingHolidayPolicy, names: matches.map(e => e.name) });
    } else if (!Array.isArray(config.holidays) || !Array.isArray(config.holidayCoverageYears)
      || !config.holidayCoverageYears.includes(year)) {
      missing.push({ code: 'MISSING_HOLIDAY_COVERAGE', factor: 'holiday', date: dateString,
        fallbackWeight: config.fallbackWeight });
      holidayWeight = config.fallbackWeight;
    } else {
      holidayWeight = config.normalHolidayWeight;
    }
    return { date: dateString, month: month, weekday: weekday,
      weekdayName: weekdayRecord ? weekdayRecord.name : null,
      monthWeight: monthWeight, weekdayWeight: weekdayWeight, holidayWeight: holidayWeight,
      holidayNames: matches.map(e => e.name), missingWeights: missing,
      hasMissingWeight: missing.length > 0, warnings: warnings };
  }

  function calculateNext7Days(config, now) {
    validateParameters(config);
    if (!Number.isInteger(config.futureDays) || config.futureDays !== 7 ||
      !Number.isInteger(config.startOffsetDays)) throw new TypeError('Configured seven-day window required');
    const asOfDate = getShanghaiDate(now);
    const days = Array.from({ length: config.futureDays }, (_, i) => {
      const weights = getWeightForDate(addDays(asOfDate, config.startOffsetDays + i), config);
      return Object.assign({}, weights, calcDemandIndex(weights, config));
    });
    const missingWeightCount = days.reduce((sum, day) => sum + day.missingWeights.length, 0);
    const warnings = days.flatMap(day => day.missingWeights.concat(day.warnings));
    const overallDemandIndex = Number((days.reduce((sum, day) => sum + day.demandIndex, 0) / days.length).toFixed(12));
    return { asOfDate: asOfDate, timeZone: config.timeZone,
      startDate: days[0].date, endDate: days[days.length - 1].date,
      days: days, next7Days: days, future7Days: days, missingWeightCount: missingWeightCount,
      hasMissingWeight: missingWeightCount > 0, warnings: warnings,
      overallDemandIndex: overallDemandIndex,
      overallTrendLevel: classifyDemandTrend(overallDemandIndex, config),
      overallTrendDirection: classifyTrendDirection(overallDemandIndex, config),
      demandIndexLimits: { ...config.demandIndexLimits },
      categorySpecificWeights: config.categorySpecificWeights === true,
      scopeNote: config.scopeNote || null };
  }

  // Keep the V1.1 arithmetic, but replace the common weekday weight with the
  // middle category's own observed weekday/daily sales ratio. Multiplying an
  // additional weekday ratio would count the same calendar effect twice.
  function calculateCategoryNext7Days(profile, config, now) {
    const common = calculateNext7Days(config, now), settings = config.categoryDemand;
    if (!settings || settings.method !== 'category-weekday-sales-v1' ||
      !Number.isInteger(settings.minHistoryDays) || settings.minHistoryDays < 1 ||
      !Number.isInteger(settings.minWeekdaySampleDays) || settings.minWeekdaySampleDays < 1) {
      throw new TypeError('Configured category sales model required');
    }
    const unavailable = reason => ({ middleCategoryCode: profile?.middleCategoryCode || null,
      middleCategoryName: profile?.middleCategoryName || null, status: 'insufficient-data', reason,
      startDate: common.startDate, endDate: common.endDate, future7Days: [], days: [] });
    if (!profile || profile.status !== 'ok' || !isFiniteWeight(profile.historicalDailySalesAmountCny) ||
      profile.historicalDailySalesAmountCny <= 0 || profile.historyDayCount < settings.minHistoryDays) {
      return unavailable('insufficient-category-history');
    }
    const historyDates = (profile.dailySales || []).map(day => day.date).filter(validDateString).sort();
    if (historyDates.length !== profile.historyDayCount || new Set(historyDates).size !== historyDates.length) {
      return unavailable('invalid-history-dates');
    }
    if (historyDates.at(-1) >= common.startDate) return unavailable('history-overlaps-forecast');
    const days = [];
    for (const day of common.days) {
      const weekday = profile.weekdays?.[String(day.weekday)];
      if (!weekday || !isFiniteWeight(weekday.weight) || !Number.isInteger(weekday.sampleDays) ||
        weekday.sampleDays < settings.minWeekdaySampleDays) return unavailable('insufficient-weekday-history');
      const result = calcDemandIndex({ monthWeight: day.monthWeight, weekdayWeight: weekday.weight,
        holidayWeight: day.holidayWeight }, config);
      const missingWeights = day.missingWeights.filter(warning => warning.factor !== 'weekday');
      days.push({ ...day, ...result, weekdayWeight: weekday.weight,
        categoryWeekdayWeight: weekday.weight, calendarWeekdayWeight: day.weekdayWeight,
        weekdaySampleDays: weekday.sampleDays, weekdayDailySalesAmountCny: weekday.dailySalesAmountCny,
        historicalDailySalesAmountCny: profile.historicalDailySalesAmountCny,
        missingWeights, hasMissingWeight: missingWeights.length > 0 });
    }
    const overallDemandIndex = Number((days.reduce((sum, day) => sum + day.finalDemandIndex, 0) / days.length).toFixed(12));
    return { middleCategoryCode: profile.middleCategoryCode, middleCategoryName: profile.middleCategoryName,
      status: 'ok', method: settings.method, metric: 'positive-valid-sales-amount',
      startDate: common.startDate, endDate: common.endDate, days, future7Days: days,
      historicalDailySalesAmountCny: profile.historicalDailySalesAmountCny,
      historyDayCount: profile.historyDayCount, positiveSaleDays: profile.positiveSaleDays,
      warnings: profile.warnings || [], overallDemandIndex,
      overallTrendLevel: classifyDemandTrend(overallDemandIndex, config),
      overallTrendDirection: classifyTrendDirection(overallDemandIndex, config),
      demandIndexLimits: { ...common.demandIndexLimits } };
  }

  function profilesMatchAnalysis(profilesData, analysis) {
    const dependency = profilesData?.metadata?.scopeDependency;
    if (!dependency || !analysis?.analysisPeriod || !analysis?.sourceScope) return false;
    const keys = ['start', 'end', 'startDateTime', 'endDateTime', 'timeZone', 'dateField', 'timeField', 'windowInclusion'];
    if (keys.some(key => dependency.analysisPeriod?.[key] !== analysis.analysisPeriod[key])) return false;
    const department = analysis.sourceScope.salesDepartmentFilter ?? analysis.sourceScope.shopIdFilter ?? null;
    if ((dependency.departmentFilter === null ? null : String(dependency.departmentFilter)) !==
      (department === null ? null : String(department))) return false;
    const identities = items => JSON.stringify((items || []).map(item => [String(item.middleCategoryCode),
      item.middleCategoryName, String(item.bigCategoryCode), item.bigCategoryName]).sort((a, b) => a[0].localeCompare(b[0])));
    return identities(dependency.categories) === identities(analysis.middleCategories);
  }

  function calculateCategories(config, profilesData, now, analysis) {
    const common = calculateNext7Days(config, now), byCode = Object.create(null);
    const scopeMatches = analysis === undefined || profilesMatchAnalysis(profilesData, analysis);
    const forecasts = (scopeMatches ? profilesData?.profiles || [] : []).map(profile => calculateCategoryNext7Days(profile, config, now));
    for (const forecast of forecasts) byCode[String(forecast.middleCategoryCode)] = forecast;
    return { ...common, forecastScope: 'category-historical-sales', categorySpecificWeights: true,
      categoryForecasts: forecasts, categoryForecastsByCode: byCode,
      profileScopeMatches: scopeMatches,
      scopeNote: '各中类使用自身历史销售额的星期系数；月份及节假日仍采用公共配置。' };
  }

  return Object.freeze({ getShanghaiDate, addDays, getWeightForDate,
    calcDemandIndex, classifyDemandTrend, classifyTrendDirection, calculateNext7Days,
    calculateCategoryNext7Days, calculateCategories, profilesMatchAnalysis });
});
