(function (global) {
  'use strict';
  const dateFormat = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});
  const timeFormat = new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  function seconds(value) {
    if (typeof value !== 'string') return null;
    const m = value.match(/^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/);
    return m ? Number(m[1])*3600+Number(m[2])*60+Number(m[3]) : null;
  }
  function select(events, now = Date.now()) {
    const instant = new Date(now), businessDate = dateFormat.format(instant), cutoffTime = timeFormat.format(instant);
    const cutoff = seconds(cutoffTime), eligible = [];
    let future = 0, missingTime = 0, otherDate = 0;
    for (const event of events) {
      if (event.date && event.date !== businessDate) { otherDate++; continue; }
      const time = seconds(event.processingTime || event.time || event.salesTime);
      if (time === null) missingTime++;
      else if (time <= cutoff) eligible.push(event);
      else future++;
    }
    return {eligible, future, missingTime, otherDate, businessDate, cutoffTime};
  }
  global.OrderTimeWindow = {seconds, select};
})(window);
