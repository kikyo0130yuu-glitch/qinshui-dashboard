(function(global){
  'use strict';
  const cents=event=>Number.isSafeInteger(event.amountCents)?event.amountCents:Math.round(event.amount*100);
  // Track the contents, not just the receipt count. A corrected amount, refund,
  // replacement receipt, store assignment or detail edit must refresh the view.
  function signature(events,details=[]){
    return JSON.stringify([
      events.map(e=>[e.key||e.id,e.code,e.name,e.kind,e.type,e.date,e.sourceDate,e.processingTime||e.time||e.salesTime,cents(e),e.amount,e.detailCount]),
      details.map(d=>[d.orderKey,d.orderId,d.id,d.code,d.date,d.sourceDate,d.time,d.sku,d.name,d.unit,d.quantity,cents(d),d.amount,d.salesDepartmentCode,d.salesDepartmentName])
    ]);
  }
  function valid(batch,today,stores){
    if(!batch||batch.date!==today||!Array.isArray(batch.events)||!['actual','replay',undefined].includes(batch.mode))return false;
    const known=new Set(stores.map(s=>s.code)),orders=new Map(),seen=new Set();
    for(const e of batch.events){
      if(!e||!e.id||e.date!==today||e.kind!=='retail'||!known.has(e.code)||!Number.isFinite(e.amount)||!Number.isSafeInteger(cents(e)))return false;
      if(e.amountCents!==undefined&&e.amountCents!==Math.round(e.amount*100))return false;
      if(global.OrderTimeWindow.seconds(e.processingTime||e.time||e.salesTime)===null)return false;
      const key=e.key||[e.sourceDate||e.date,e.code,e.id].join('|');
      if(seen.has(key))return false;
      seen.add(key);orders.set(key,e);
    }
    if(batch.details===undefined)return true;
    if(!Array.isArray(batch.details))return false;
    if(!batch.details.length)return true; // A validated master-only import is supported.
    const lines=new Set(),totals=new Map();
    for(const d of batch.details){
      const order=orders.get(d?.orderKey);
      if(!order||!d.id||d.date!==today||d.code!==order.code||!Number.isFinite(d.quantity)||!Number.isFinite(d.amount)||!Number.isSafeInteger(cents(d)))return false;
      if(d.amountCents!==undefined&&d.amountCents!==Math.round(d.amount*100))return false;
      const key=d.orderKey+'|'+d.id;if(lines.has(key))return false;
      lines.add(key);totals.set(d.orderKey,(totals.get(d.orderKey)||0)+cents(d));
    }
    for(const [key,order]of orders)if(totals.get(key)!==cents(order))return false;
    return true;
  }
  global.OrderBatchSync={signature,valid};
})(window);
