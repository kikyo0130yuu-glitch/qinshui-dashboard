(function(global){
  'use strict';
  const timeFormat=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  // This list is a recent observation window, never an accounting accumulator.
  function recent(events,now=Date.now(),windowSeconds=300){
    const cutoff=global.OrderTimeWindow.seconds(timeFormat.format(new Date(now)));
    const width=Number.isFinite(windowSeconds)&&windowSeconds>0?windowSeconds:300;
    return global.OrderTimeWindow.select(events,now).eligible.filter(event=>{
      const second=global.OrderTimeWindow.seconds(event.processingTime||event.time||event.salesTime);
      return second>=Math.max(0,cutoff-width);
    }).sort((a,b)=>(a.processingTime||a.time||a.salesTime).localeCompare(b.processingTime||b.time||b.salesTime)||(a.key||a.id).localeCompare(b.key||b.id));
  }
  // Keep the latest receipts visible between arrivals. Displaying an existing
  // receipt never counts it again; accounting remains in OrderTimeWindow.
  function latest(events,now=Date.now(),limit=3){
    const count=Number.isSafeInteger(limit)&&limit>0?limit:3;
    return global.OrderTimeWindow.select(events,now).eligible.slice(-count).reverse();
  }
  global.OrderLiveFlow={recent,latest};
})(window);
