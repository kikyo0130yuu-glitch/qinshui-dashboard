(function(root){
  'use strict';
  const fields=[['id','订单号',['单据编号','订单编号','订单号','单据号']],['code','门店编码',['门店编码','部门编码','门店编号']],['amount','净销售金额',['实收金额','净销售金额','销售金额']],['date','业务日期',['销售日期','订单日期','营业日期','日期']]];
  const $=id=>document.getElementById(id);
  function parseRows(rows,mapping,today,stores){
    const known=new Map(stores.map(s=>[s.code,s.name])),seen=new Map(),events=[],errors=[];let duplicates=0;
    const pick=(row,key)=>row[mapping[key]];
    for(let i=0;i<rows.length;i++){
      const row=rows[i];if(row.every(x=>x===null||x===undefined||String(x).trim()===''))continue;
      const id=String(pick(row,'id')??'').trim(),code=String(pick(row,'code')??'').trim();
      if(!id&&String(pick(row,'code')??'').includes('合计'))continue;
      const raw=pick(row,'amount'),amount=typeof raw==='number'?raw:Number(String(raw??'').replace(/[,，¥￥\s]/g,''));
      let rawDate=pick(row,'date'),date;
      if(typeof rawDate==='number'){const d=XLSX.SSF.parse_date_code(rawDate);if(d)date=`${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;}
      else {const match=String(rawDate??'').match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);if(match)date=`${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`;}
      if(!id||!known.has(code)||raw===''||raw===null||raw===undefined||!Number.isFinite(amount)||date!==today){errors.push(`第 ${i+1} 条：${!id?'缺少订单号':!known.has(code)?'门店编码不在确认清单':!Number.isFinite(amount)||raw===''||raw==null?'金额无效':'业务日期不是今日 '+today}`);continue;}
      const key=code+'|'+id,signature=JSON.stringify([code,amount,date]);
      if(seen.has(key)){if(seen.get(key)!==signature)errors.push(`第 ${i+1} 条：相同订单号对应不同金额`);else duplicates++;continue;}
      seen.set(key,signature);const time=String(rawDate??'').match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/)?.[0]||'—';
      events.push({id,code,name:known.get(code),date,time,amount,kind:'retail',type:amount<0?'零售退单':'零售'});
    }
    if(!events.length&&!errors.length)errors.push('没有可导入的今日门店订单');
    return {events,errors,duplicates,amount:events.reduce((sum,e)=>sum+e.amount,0)};
  }
  function init(stores,todayFn,onApply){
    let workbook=null,preview=null;
    const status=text=>{$('todayOrderResult').textContent=text;};
    const mapping=()=>Object.fromEntries(fields.map(([key])=>[key,Number($('today-map-'+key).value)]));
    function readSheet(){if(!workbook)return;const sheet=workbook.Sheets[$('todayOrderSheet').value],rows=XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:true}),header=Math.max(1,Number($('todayOrderHeader').value)||1);return {rows:rows.slice(header),headings:rows[header-1]||[]};}
    function fillMapping(){preview=null;$('applyTodayOrders').disabled=true;const data=readSheet();if(!data)return;$('todayOrderMapping').replaceChildren();for(const [key,label,candidates]of fields){const row=document.createElement('div');row.className='mapping-row';const span=document.createElement('span');span.textContent=label;const select=document.createElement('select');select.id='today-map-'+key;select.add(new Option('请选择字段','-1'));data.headings.forEach((h,i)=>select.add(new Option(String(h||'未命名列 '+(i+1)),String(i))));const found=data.headings.findIndex(h=>candidates.includes(String(h).trim()));select.value=String(found);select.onchange=()=>{preview=null;$('applyTodayOrders').disabled=true;};row.append(span,select);$('todayOrderMapping').append(row);}status('请确认“净销售金额”字段已扣减退单，且文件为订单主表。订单明细不能直接作为订单金额导入。');}
    $('todayOrderFile').onchange=async e=>{preview=null;$('applyTodayOrders').disabled=true;workbook=null;$('todayOrderMapping').replaceChildren();const file=e.target.files[0];if(!file)return;if(file.size>20*1024*1024){status('请选择小于20MB的门店订单主表');return;}try{workbook=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false});$('todayOrderSheet').replaceChildren();for(const name of workbook.SheetNames)$('todayOrderSheet').add(new Option(name,name));fillMapping();}catch{status('文件无法解析，请检查Excel或UTF-8 CSV格式');}};
    $('todayOrderSheet').onchange=fillMapping;$('todayOrderHeader').onchange=fillMapping;
    $('previewTodayOrders').onclick=()=>{const data=readSheet();if(!data){status('先选择今日门店订单主表');return;}const map=mapping(),columns=Object.values(map);if(columns.some(x=>x<0)||new Set(columns).size!==fields.length){status('必须为四个业务字段选择不同的来源列');return;}preview=parseRows(data.rows,map,todayFn(),stores);status(preview.errors.length?`校验未通过，未应用：\n${preview.errors.slice(0,10).join('\n')}\n共 ${preview.errors.length} 条问题`:`今日 ${todayFn()} · ${preview.events.length} 张订单 · 净销售额 ¥${preview.amount.toFixed(2)}\n相同内容重复订单 ${preview.duplicates} 条，已去重。应用时替换当前浏览器的整批今日订单，不重复叠加。`);$('applyTodayOrders').disabled=preview.errors.length>0;};
    $('applyTodayOrders').onclick=()=>{if(!preview||preview.errors.length||preview.events.some(e=>e.date!==todayFn())){status('预览已失效，请重新核对今日订单');return;}const batch={date:todayFn(),events:preview.events};try{localStorage.setItem('qinshui-today-orders-v1',JSON.stringify(batch));}catch{status('浏览器不能保存订单；已应用本次会话。');}onApply(batch);status(`已应用今日门店订单 ${batch.events.length} 张。此导入仅影响当前浏览器；共享发布需由管理端更新公共数据。`);};
    $('clearTodayOrders').onclick=()=>{localStorage.removeItem('qinshui-today-orders-v1');onApply(null);status('已恢复历史回放源');};
  }
  root.TodayOrderImport={init,parseRows};
})(window);
