
  'use strict';
  const $=id=>document.getElementById(id), money=n=>Number(n).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}), shortMoney=n=>Number(n).toLocaleString('zh-CN',{maximumFractionDigits:0});
  const OFFLINE_DEMO=window.QINSHUI_OFFLINE_DEMO===true;
  const YESTERDAY_SALES=49823.87;
  const BASELINE_FACTOR=.45,scaledBaseline=value=>Number.isFinite(value)?value*BASELINE_FACTOR:null;
  const STORE_ROTATION_MS=9000;
  const initialConfig={stores:10,logistics:70,delivery:44,ontime:99.7,ontimeChange:.6,storageMetricVersion:3,sortingPieces:13000,floorStackPositions:2030,coldZoneCount:10,coldStoredTonnes:53.2,storageMetricsSource:'user-configuration',warehouse:120,warehouseUnit:'吨',cold:50,coldUnit:'吨',rankSpeed:6,storeRankSpeed:9,replaySpeed:3,q1ActualStores:null,q1ActualLogistics:null,q2ActualStores:null,q2ActualLogistics:null,q3ActualStores:null,q3ActualLogistics:null,q4ActualStores:null,q4ActualLogistics:null,octStores:5,octLogistics:8,novStandard:1,novFranchise:5,novLogistics:10,decFranchise:20,decLogistics:10,holidayWeight:2,brandCount:3,brandDaily:8600,cooperativeCount:6,sundayWeight:1.5,double11Weight:2.2,peakStart:'17:30',peakEnd:'19:10'};
  let config={...initialConfig};try{const saved=JSON.parse(localStorage.getItem('county-dashboard-prototype-v1')||'null');if(saved&&typeof saved==='object'){config={...initialConfig,...saved};if(![2,3].includes(saved.storageMetricVersion)){for(const key of ["sortingPieces","floorStackPositions","coldZoneCount","coldStoredTonnes"])config[key]=initialConfig[key];}else if(saved.storageMetricVersion===2&&Number(saved.floorStackPositions)===2050){config.floorStackPositions=2030;}config.storageMetricVersion=3;if(saved.storeRankSpeed===undefined)config.storeRankSpeed=(Number.isFinite(Number(saved.rankSpeed))&&Number(saved.rankSpeed)>0?Number(saved.rankSpeed):6)+3;}}catch{}
  config.storeRankSpeed=STORE_ROTATION_MS/1000;
  const storageMetric=(value,integer=false)=>Number.isFinite(value)&&value>=0&&(!integer||Number.isSafeInteger(value))?String(value):'—';
  function storageCapacity(){
    const zoneCount=Number.isSafeInteger(config.coldZoneCount)&&config.coldZoneCount>=0?config.coldZoneCount:null;
    const storedTonnes=Number.isFinite(config.coldStoredTonnes)&&config.coldStoredTonnes>=0?config.coldStoredTonnes:null;
    return {zoneCount,storedTonnes,totalTonnes:null,remainingTonnes:null,unit:'吨',source:'user-configuration'};
  }
  function fitBoard(){document.documentElement.style.setProperty('--board-scale',Math.min(window.innerWidth/3268,window.innerHeight/1290));}
  fitBoard();window.addEventListener('resize',fitBoard);
  const state={mode:'demo',source:'prepared',day:'2026-10-03',replayed:0,playing:true,product:'price',unit:'kg',storeOffset:0,productOffset:0,flowCursor:0,flowTick:0,flowEpoch:Date.now()};
  let mapPointState={points:MAP_DATA.points.map(p=>({...p})),originId:MAP_DATA.settings.dispatchOriginId||MAP_DATA.points.find(p=>p.isDispatchOrigin)?.id||''};
  try{
    const saved=JSON.parse(localStorage.getItem('qinshui-map-points-v1')||'null');
    if(saved&&Array.isArray(saved.points)){
      // Keep newly published sites when an older browser has an empty point list.
      const publishedIds=new Set(MAP_DATA.points.map(p=>p.id));
      const correctedIds=new Set(MAP_DATA.points.filter(p=>p.sourceCoordinate?.correctionRevision).map(p=>p.id));
      const sameRevision=saved.publishedPointRevision===MAP_DATA.settings.pointDataRevision;
      const valid=saved.points.filter(p=>p.id&&p.name&&p.type&&Number.isFinite(p.longitude)&&Number.isFinite(p.latitude)&&Math.abs(p.longitude)<=180&&Math.abs(p.latitude)<=90&&p.coordinateSystem==='WGS84'&&(!p.pointCoordinateSystem||p.pointCoordinateSystem==='WGS84')&&(!correctedIds.has(p.id)||sameRevision)&&(!publishedIds.has(p.id)||sameRevision||p.positionSource==='browser-geolocation-wgs84'));
      const points=MapPointImport.mergeGPS(mapPointState.points,valid);
      const origin=points.find(p=>p.id===saved.originId)||points.find(p=>p.id===mapPointState.originId)||points.find(p=>p.isDispatchOrigin);
      mapPointState={...mapPointState,...saved,points,originId:origin?.id||''};
    }
  }catch{}
  const townMap=new QinshuiTownMap($('townMap'),pointData());
  const monthWeights=[1,1.2,1.3,1.1,1.16,1.4,1.6];
  let decisionAdvice=null,decisionBatchRevision=0,weatherFeed=null,consumerMetrics=null;
  let consumerReplayRun=0,consumerReplayBatch=null,consumerReplayStep=-1;
  const lastStoreValues=new Map();let storeFlow=null,storeSourceKey=null,lastStoreRenderSignature=null,salesForecast=null;
  let storePriorityCodes=[],storePriorityAt=null;
  const charts={}, colors={text:'#ffffff',muted:'#92a0b7',grid:'rgba(46,172,226,0.15)',cyan:'#2eace2',gold:'#ffe551',mint:'#64d6ad'};
  const chart=(id)=>charts[id]||(charts[id]=echarts.init($(id),null,{renderer:'svg'}));
  const localISO=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const nowText=()=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date());
  const weekdayText=(date=localISO())=>['周日','周一','周二','周三','周四','周五','周六'][new Date(date+'T12:00:00Z').getUTCDay()];
  const activeSiteRatio=()=>Number(config.logistics)>0&&Number.isFinite(Number(config.delivery))?(Number(config.delivery)/Number(config.logistics)*100).toFixed(2)+'%':'—';
  let tickerSpans=null,clockBusinessDate=null;
  const renderErrors=new Map();let salesClockTimer=null;
  function renderPart(name,render){
    try{render();renderErrors.delete(name);return true;}
    catch(error){const message=String(error?.message||error);if(renderErrors.get(name)!==message){console.error('[沁水大屏] '+name,error);renderErrors.set(name,message);}return false;}
  }
  function tickSalesClock(){renderPart('订单自动计时',updateClock);}
  function startSalesClock(){
    if(salesClockTimer!==null)return;
    // Register before optional chart/weather/analysis initialization. A failed
    // peripheral render must not disable receipt arrival and sales updates.
    salesClockTimer=setInterval(tickSalesClock,1000);
  }
  function renderTicker(v=view()){
    const iso=localISO(),month=Number(iso.slice(5,7)),day=Number(iso.slice(8,10));
    const holiday=month===10&&day<=7;
    const history=Object.values(DASHBOARD_DATA.days).map(d=>d.retail),low=Math.min(...history),high=Math.max(...history);
    const weight=monthWeights[month-6];
    const businessLabel=state.mode==='real'&&!dataset().isToday?'门店 '+state.day+' 销售':'门店今日销售';
    const items=[
      `${businessLabel} <b>¥${shortMoney(v.retail)}</b> · 历史日销售区间 <b>¥${shortMoney(low)}–${shortMoney(high)}</b>`,
      holiday?`国庆假期权重 <b>${Number(config.holidayWeight).toFixed(2)}</b>（10.01–10.07）· 今日黄金周第 <b>${day}</b> 天`:`${month}月销售权重 <b>${weight===undefined?'待配置':Number(weight).toFixed(2)}</b>`,
      `后勤事业部在服 <b>${config.logistics} 家</b> 企事业单位 · 活跃网点占比 <b>${activeSiteRatio()}</b>`,
      `品牌代理 <b>${config.brandCount} 个</b>`,
      `农产品上行 · <b>${config.cooperativeCount} 个</b> 合作社 · 冷链库区 <b>${storageMetric(storageCapacity().zoneCount,true)}个</b> · 当前存储 <b>${storageMetric(storageCapacity().storedTonnes)}吨</b>`,
      `周日销售权重 <b>${Number(config.sundayWeight).toFixed(1)}</b> · 晚高峰预计 <b>${config.peakStart}–${config.peakEnd}</b>`,
      `10月计划新增：便民店 <b>+${config.octStores} 家</b> · 后勤网点 <b>+${config.octLogistics} 个</b>`,
      `<span class="warn">备货预警</span> 双十一权重 <b>${Number(config.double11Weight).toFixed(2)}</b> · ${iso.slice(5,10)<='10-25'?'建议10月25日前完成备货':'复核双十一备货与配送安排'}`
    ];
    if(!tickerSpans){
      $('tickerFlow').replaceChildren();tickerSpans=[];
      for(let copy=0;copy<2;copy++){
        const group=document.createElement('div');group.className='ticker-group';if(copy)group.setAttribute('aria-hidden','true');
        for(let i=0;i<items.length;i++){const span=document.createElement('span');span.className='ticker-item';group.append(span);tickerSpans.push(span);}
        $('tickerFlow').append(group);
      }
    }
    // Preserve the animated groups; changing sales never restarts the marquee.
    items.forEach((html,i)=>{for(const span of [tickerSpans[i],tickerSpans[i+items.length]])if(span.innerHTML!==html)span.innerHTML=html;});
  }
  function updateClock(){
    refreshPreparedSource();currentTimeSelection=null;
    const date=localISO();
    if(clockBusinessDate&&clockBusinessDate!==date){state.replayed=0;state.flowCursor=0;state.flowTick=0;state.flowEpoch=Date.now();renderStats();consumerMetrics?.refresh();if(clockBusinessDate.slice(0,7)!==date.slice(0,7))renderPlans();}
    clockBusinessDate=date;
    const current=dataset();if(current.isToday){const count=clockWindow(current).eligible.length;if(salesRenderRevision(current)!==lastSalesRenderRevision){if(count!==state.replayed)state.flowCursor=0;state.replayed=count;renderStats();}else renderFlow(view(),current);}
    $('clock').textContent=nowText();$('dataUpdate').textContent=date+' '+nowText();
    $('deliveryFoot').textContent=`活跃网点占比 ${activeSiteRatio()}`;
    renderTicker();
  }
  function toast(text){$('toast').textContent=text;$('toast').style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').style.display='none',3200);}
  const TODAY_ORDER_KEY='qinshui-today-orders-v1';
  let todayOrders=null;try{const saved=JSON.parse(localStorage.getItem(TODAY_ORDER_KEY)||'null');if(OrderBatchSync.valid(saved,localISO(),DASHBOARD_DATA.stores))todayOrders=saved;}catch{}
  let preparedBatch=null,currentTimeSelection=null,preparedSourceSignature=null,lastSalesRenderRevision=null;
  function refreshPreparedSource(){
    if(todayOrders||state.mode!=='demo'||state.source!=='prepared')return;
    const revision=OrderBatchSync.signature(TODAY_REPLAY_DATA.events,TODAY_REPLAY_DATA.details);
    if(preparedSourceSignature!==revision){preparedSourceSignature=revision;preparedBatch=null;currentTimeSelection=null;decisionBatchRevision++;}
  }
  function salesRenderRevision(day=dataset()){
    const events=day.isToday?clockWindow(day).eligible:day.events;
    return JSON.stringify([state.mode,state.source,day.date||state.day,OrderBatchSync.signature(events,day.details||[])]);
  }
  function applyTodayOrderBatch(batch){
    if(batch!==null&&!OrderBatchSync.valid(batch,localISO(),DASHBOARD_DATA.stores)){toast('订单与明细校验未通过，保留当前销售数据');return;}
    const sameContext=state.source==='prepared'&&(batch===null?todayOrders===null:todayOrders&&batch.date===todayOrders.date
      &&(batch.mode||'actual')===(todayOrders.mode||'actual'));
    saveSalesProgress();todayOrders=batch;currentTimeSelection=null;lastSalesRenderRevision=null;decisionBatchRevision++;
    state.source='prepared';restoreSalesProgress();state.playing=true;if(!sameContext)state.storeOffset=0;renderStats();consumerMetrics?.refresh();
  }
  function syncStorageData(event){
    if(event.key===TODAY_ORDER_KEY||event.key===null){
      let raw,batch;try{raw=localStorage.getItem(TODAY_ORDER_KEY);batch=raw===null?null:JSON.parse(raw);}catch{return;}
      if(batch!==null&&!OrderBatchSync.valid(batch,localISO(),DASHBOARD_DATA.stores)){toast('更新的订单与明细尚未核对，保留当前销售数据');return;}
      applyTodayOrderBatch(batch);
    }else if(event.key===DailySalesProgress.KEY){restoreSalesProgress();renderStats({persist:false});}
  }
  const salesProgress=new DailySalesProgress({getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)},localISO);
  function salesProgressSlot(){const day=dataset();return day.isToday?(todayOrders?'imported:':'prepared:')+(activeBatch()?.mode||'actual')+':clock-v1':'history:'+state.day;}
  function restoreSalesProgress(){
    Object.assign(state,{replayed:0,flowCursor:0,flowTick:0,flowEpoch:Date.now()},salesProgress.restore(salesProgressSlot(),dataset().events)||{});
    if(dataset().isToday)state.replayed=clockWindow().eligible.length;
  }
  function restoreSalesSession(){
    const saved=salesProgress.selection();
    if(saved&&['demo','real'].includes(saved.mode)&&['prepared','history'].includes(saved.source)&&DASHBOARD_DATA.days[saved.day]){
      state.day=saved.day;
      // A previous historical preview must not silently freeze the main daily
      // display on its next opening. Keep current-day imported mode choices;
      // history remains available explicitly in this session's config panel.
      if(saved.source==='prepared'&&(saved.mode==='demo'||todayOrders))Object.assign(state,saved);
      else if(todayOrders)state.mode=saved.mode;
    }
    restoreSalesProgress();
    for(const mode of ['demo','real']){const button=$(mode+'Mode');button.classList.toggle('active',state.mode===mode);button.setAttribute('aria-pressed',String(state.mode===mode));}
  }
  function saveSalesProgress(){
    const day=dataset(),timed=day.isToday;
    if(timed)state.replayed=clockWindow(day).eligible.length;
    const entry=salesProgress.save(salesProgressSlot(),day.events,timed?{...state,accumulationPolicy:'clock-cutoff'}:state);
    if(!timed&&entry.replayed>state.replayed)Object.assign(state,{replayed:entry.replayed,flowCursor:entry.flowCursor,flowTick:entry.flowTick,flowEpoch:entry.flowEpoch});
    $('salesValue').dataset.persistence=salesProgress.available?'saved':'unavailable';
  }
  function activeBatch(){
    const date=localISO();
    if(todayOrders&&todayOrders.date!==date)todayOrders=null;
    if(todayOrders&&(state.mode==='demo'||todayOrders.mode!=='replay'))return todayOrders;
    if(state.mode==='demo'&&state.source==='prepared'){
      if(!preparedBatch||preparedBatch.date!==date)preparedBatch={date,mode:'replay',consumerReplayFingerprint:TODAY_REPLAY_DATA.metadata?.consumerReplayFingerprint,events:TODAY_REPLAY_DATA.events.map(e=>({...e,date})),details:TODAY_REPLAY_DATA.details.map(e=>({...e,date}))};
      return preparedBatch;
    }
    return null;
  }
  function sumMoney(events){return events.reduce((sum,e)=>sum+(Number.isInteger(e.amountCents)?e.amountCents:Math.round(e.amount*100)),0)/100;}
  function sumStoreSales(stores){return Object.values(stores).reduce((sum,value)=>sum+(Number.isFinite(value)?value:0),0);}
  function dataset(){
    const batch=activeBatch();
    if(batch){const events=batch.events,retail=sumMoney(events),stores=Object.fromEntries(DASHBOARD_DATA.stores.map(s=>[s.code,0]));events.forEach(e=>stores[e.code]+=e.amount);return {total:retail,retail,wholesale:0,stores,events,details:batch.details||[],orderCount:events.length,retailCount:events.length,isToday:true,simulated:batch.mode==='replay',date:batch.date};}
    return {...DASHBOARD_DATA.days[state.day],isToday:false};
  }
  function clockWindow(day=dataset()){
    const second=nowText();
    if(!currentTimeSelection||currentTimeSelection.events!==day.events||currentTimeSelection.date!==day.date||currentTimeSelection.second!==second){
      currentTimeSelection={events:day.events,date:day.date,second,window:OrderTimeWindow.select(day.events)};
    }
    return currentTimeSelection.window;
  }
  function view(){
    const day=dataset();
    if(day.isToday){
      const orders=clockWindow(day).eligible,retailOrders=orders.filter(e=>e.kind==='retail'),retail=sumMoney(retailOrders),wholesale=sumMoney(orders.filter(e=>e.kind==='wholesale'));
      const demo=state.mode==='demo',stores=Object.fromEntries(DASHBOARD_DATA.stores.map(s=>[s.code,demo?scaledBaseline(s.baseline):0]));
      for(const e of retailOrders)stores[e.code]=(stores[e.code]||0)+e.amount;
      return {total:(demo?scaledBaseline(DASHBOARD_DATA.baseline):0)+retail+wholesale,retail:sumStoreSales(stores),wholesale:(demo?scaledBaseline(DASHBOARD_DATA.wholesaleBaseline):0)+wholesale,stores,events:orders.slice(-3).reverse(),count:orders.length,retailCount:retailOrders.length,average:retailOrders.length?retail/retailOrders.length:null};
    }
    if(state.mode==='real')return {total:day.total,retail:day.retail,wholesale:day.wholesale,stores:day.stores,events:day.events.slice(-3).reverse(),count:day.orderCount,retailCount:day.retailCount,average:day.retailCount?day.retail/day.retailCount:null};
    const played=day.events.slice(0,state.replayed),retailOrders=played.filter(e=>e.kind==='retail'),retail=sumMoney(retailOrders),wholesale=sumMoney(played.filter(e=>e.kind==='wholesale')),stores=Object.fromEntries(DASHBOARD_DATA.stores.map(s=>[s.code,scaledBaseline(s.baseline)]));
    retailOrders.forEach(e=>stores[e.code]=(stores[e.code]||0)+e.amount);
    // Average order value uses only orders already accumulated, never the baseline.
    return {total:scaledBaseline(DASHBOARD_DATA.baseline)+retail+wholesale,retail:scaledBaseline(DASHBOARD_DATA.retailBaseline)+retail,wholesale:scaledBaseline(DASHBOARD_DATA.wholesaleBaseline)+wholesale,stores,events:played.slice(-3).reverse(),count:played.length,retailCount:retailOrders.length,average:retailOrders.length?retail/retailOrders.length:null};
  }
  function displayedFlow(v){
    const day=dataset();
    if(state.mode==='real'&&!day.isToday)return v.events;
    const source=day.isToday?OrderLiveFlow.latest(clockWindow(day).eligible):day.events.slice(0,state.replayed),n=source.length;
    if(!n)return [];
    // Newest first; retain the last three between arrivals. Scrolling is a
    // presentation transition, never a second accounting accumulation.
    if(day.isToday)return source.map(e=>({...e,displayTime:e.processingTime||e.time||e.salesTime||'—'}));
    const end=((n-1-state.flowCursor)%n+n)%n;
    return Array.from({length:Math.min(3,n)},(_,i)=>{
      const e=source[(end-i+n)%n];
      return {...e,displayTime:e.processingTime||e.time||e.salesTime||'—'};
    });
  }
  const receiptKey=e=>e.key||[e.sourceDate||e.date||'',e.code,e.id].join('|');
  let lastFlowSource=null,lastFlowSignature=null,lastFlowReceipts=new Map();
  function renderFlow(v,day=dataset()){
    const sourceKey=[state.mode,state.source,day.isToday?day.date:state.day,todayOrders?'imported':'prepared',day.simulated?'replay':'actual'].join(':');
    const sameSource=lastFlowSource===sourceKey,eligible=day.isToday?clockWindow(day).eligible:v.events;
    const receipts=new Map(eligible.map(e=>[receiptKey(e),Number.isInteger(e.amountCents)?e.amountCents:Math.round(e.amount*100)]));
    const rows=displayedFlow(v),signature=JSON.stringify([sourceKey,rows.map(e=>[receiptKey(e),e.displayTime||e.time,e.name,e.type,e.amount])]);
    if(signature!==lastFlowSignature){
      const previousRows=new Map([...$('flowList').querySelectorAll('.flow-row')].map((row,index)=>[row.dataset.orderKey,{row,index}]));
      const fragment=document.createDocumentFragment();
      for(const [index,e] of rows.entries()){
        const key=receiptKey(e),previous=sameSource?previousRows.get(key):null,row=previous?.row||document.createElement('div');
        row.className='flow-row';row.dataset.orderKey=key;row.dataset.occurrenceTime=e.displayTime||e.time||'';
        row.replaceChildren();
        const arrived=day.isToday&&sameSource&&(!lastFlowReceipts.has(key)||lastFlowReceipts.get(key)!==receipts.get(key));
        if(arrived)row.classList.add('flow-arrival');
        else if(previous&&previous.index!==index){row.style.setProperty('--flow-shift-from',String((previous.index-index)*43)+'px');row.classList.add('flow-shift');}
        for(const [className,value] of [['mono small',e.displayTime||e.time||'—'],['place',e.name||'—'],['flow-type',e.type||'门店'],['flow-amount'+(e.amount<0?' red':''),(e.amount<0?'−':'¥')+money(Math.abs(e.amount))]]){
          const span=document.createElement('span');span.className=className;span.textContent=value;if(className==='place')span.title=e.name||'—';row.append(span);
        }
        fragment.append(row);
      }
      if(!rows.length){const empty=document.createElement('div');empty.className='small';empty.style.padding='18px 0';empty.textContent=day.isToday?'当前时间暂无订单':'暂无订单';fragment.append(empty);}
      $('flowList').replaceChildren(fragment);lastFlowSignature=signature;
    }
    $('flowList').dataset.accumulatedCount=String(v.count);
    lastFlowSource=sourceKey;lastFlowReceipts=receipts;
  }
  function renderConsumerMetrics(){
    if(!consumerMetrics)return;
    const batch=activeBatch(),source=window.CONSUMER_REPLAY_DATA;
    const matched=state.mode==='demo'&&batch?.mode==='replay'&&source?.sourceKind==='historical-order-replay'
      &&source.fingerprintAlgorithm==='sha256-json-key-amountCents-v1'&&batch.consumerReplayFingerprint===source.sourceFingerprint
      &&Number.isSafeInteger(source.eventCount)&&source.eventCount===batch.events.length&&Array.isArray(source.steps)&&source.steps.length===source.eventCount;
    if(!matched){consumerMetrics.clearReplay();consumerReplayBatch=null;consumerReplayStep=-1;return;}
    const step=Math.min(batch.events.length,Math.max(0,state.replayed));
    if(consumerReplayBatch!==batch||step<consumerReplayStep){consumerReplayRun++;consumerReplayStep=-1;}
    if(step===consumerReplayStep)return;
    const entry=step===0?{step:0,counts:source.initialCounts}:source.steps[step-1];
    if(!entry||entry.step!==step){consumerMetrics.clearReplay();consumerReplayBatch=null;consumerReplayStep=-1;return;}
    const applied=consumerMetrics.updateReplay({sourceKind:'historical-order-replay',updatedAt:source.updatedAt,window:source.window,counts:entry.counts,
      replay:{sourceVersion:source.sourceFingerprint,runId:'consumer-replay-'+consumerReplayRun,step,total:source.eventCount}});
    if(applied){consumerReplayBatch=batch;consumerReplayStep=step;}
  }
  function renderStats(options={}){
    // Storage observers render locally without writing back to other tabs.
    if(options.persist!==false)saveSalesProgress();
    const v=view(),demo=state.mode==='demo',day=dataset();
    const salesChanged=$('salesValue').textContent!==money(v.total);
    $('salesValue').textContent=money(v.total);
    if(salesChanged){$('salesValue').classList.remove('order-value-update');void $('salesValue').offsetWidth;$('salesValue').classList.add('order-value-update');}
    $('salesLabel').textContent=demo||day.isToday?'今日销售额':'历史日净销售额';
    const comparisonBase=YESTERDAY_SALES;
    const change=comparisonBase>0?(v.total-comparisonBase)/comparisonBase*100:null;
    $('salesFoot').textContent=change===null?'— vs 昨日':`${change<0?'▼':'▲'} ${Math.abs(change).toFixed(1)}% vs 昨日`;
    $('salesFoot').classList.toggle('red',change<0);
    const retailChanged=$('retailTotal').textContent!=='¥'+money(v.retail);
    $('retailTotal').textContent='¥'+money(v.retail);
    if(retailChanged){$('retailTotal').classList.remove('order-value-update');void $('retailTotal').offsetWidth;$('retailTotal').classList.add('order-value-update');}
    $('salesValue').dataset.orderCount=String(v.count);$('retailTotal').dataset.orderCount=String(v.retailCount);
    $('deliveryValue').textContent=config.delivery;$('deliveryFoot').textContent=`活跃网点占比 ${activeSiteRatio()}`;
    $('ontimeValue').textContent=Number(config.ontime).toFixed(1);$('ontimeFoot').textContent=`${config.ontimeChange>=0?'+':''}${Number(config.ontimeChange).toFixed(1)}pt 较上周`;
    $('siteValue').textContent=Number(config.stores)+Number(config.logistics);$('siteFoot').textContent=`门店 ${config.stores} + 后勤 ${config.logistics}`;$('averageOrder').textContent=v.average===null?'—':Number(v.average).toFixed(2);
    $('modeStatus').textContent=day.isToday?(day.simulated?'日均基数×45% + 截至'+nowText()+'的已发生订单':'今日门店订单 · '+(demo?'基数 + 回放':'实收净额')):(demo?'日均基数 + 所选历史订单回放':'历史订单净销售额 · 不加基数');
    $('dataDayLabel').textContent=day.isToday?'历史预览日期':demo?'回放源日期':'业务日期';$('dataDay').disabled=day.isToday;
    $('dateInfo').textContent=day.isToday?`订单日期 ${day.date}${day.simulated?' · 演示（保留原始日期）':''}`:(demo?`展示日期 ${localISO()} · 演示`:'已导入历史数据，非今日实时');
    const flowOK=renderPart('订单流水',()=>renderFlow(v,day)),storesOK=renderPart('门店销售',()=>renderStores(v));
    renderPart('实时滚动',()=>renderTicker(v));renderPart('消费者分析',renderConsumerMetrics);renderPart('智慧决策',()=>renderDecisions(v));
    if(flowOK&&storesOK)lastSalesRenderRevision=salesRenderRevision(day);
  }
  function renderStores(v){
    const day=dataset(),sourceKey=[state.mode,day.isToday?day.date:state.day,day.simulated?'replay':day.isToday?'actual':'historical',state.source,todayOrders?'imported':'prepared'].join(':');
    const sameSource=storeSourceKey===sourceKey;if(!sameSource){lastStoreValues.clear();storePriorityCodes=[];storePriorityAt=null;storeSourceKey=sourceKey;}
    const all=DASHBOARD_DATA.stores.filter(s=>Number.isFinite(v.stores[s.code])).map(s=>({...s,value:v.stores[s.code]})).sort((a,b)=>b.value-a.value||a.code.localeCompare(b.code));
    const pinned=all.find(s=>s.code==='2001'),others=all.filter(s=>s.code!=='2001');
    const changed=all.filter(s=>lastStoreValues.has(s.code)?Math.abs(lastStoreValues.get(s.code)-s.value)>.0001:sameSource&&s.value!==0);
    const changedOrdinary=new Set(changed.filter(s=>s.code!=='2001').map(s=>s.code));
    if(changedOrdinary.size){
      // Presentation priority follows the newest changed receipts; underlying
      // amounts and the ordinary sales ordering remain untouched.
      storePriorityCodes=[...new Set([...v.events.map(e=>e.code),...changed.map(s=>s.code)])].filter(code=>changedOrdinary.has(code));
      storePriorityAt=Date.now();
    }
    const positiveCodes=changed.filter(s=>s.value>(lastStoreValues.get(s.code)??0)+.0001).map(s=>s.code);for(const s of all)lastStoreValues.set(s.code,s.value);
    const size=pinned?3:4,normal=rankWindow(others,state.storeOffset,size),priority=storePriorityCodes.map(code=>others.find(s=>s.code===code)).filter(Boolean);
    const promoted=new Set(priority.map(s=>s.code)),ordinary=[...priority,...normal.filter(s=>!promoted.has(s.code))];
    const rows=[...ordinary.slice(0,size),...(pinned?[pinned]:[])];state.storeRows=rows;
    // Only the nine-second carousel or changed receipts alter presentation.
    // Repeated data/clock notifications do not restart identical chart motion.
    const signature=JSON.stringify([sourceKey,rows.map(s=>[s.code,s.name,s.value])]);
    if(signature===lastStoreRenderSignature)return;
    const name='门店销售额',scale=StoreSalesScale,axisMax=scale.maximumAmount;
    chart('storeChart').setOption({
      animationDuration:800,animationDurationUpdate:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?0:1000,animationEasingUpdate:'cubicOut',grid:{left:206,right:138,top:20,bottom:55},tooltip:{trigger:'axis',axisPointer:{type:'shadow'},formatter:params=>{const row=params[0]?.data;return row?params[0].name+'<br>门店销售额：¥'+money(row.actualValue):'';}},legend:{show:false},
      xAxis:{type:'value',name:'元',nameLocation:'end',nameGap:64,min:0,max:scale.maximumPosition,interval:2,
        nameTextStyle:{color:colors.muted,fontSize:18},axisTick:{show:false},
        axisLabel:{color:colors.muted,fontSize:18,align:'center',hideOverlap:false,showMaxLabel:true,formatter:scale.tickLabel},
        axisPointer:{label:{formatter:p=>'¥'+shortMoney(scale.toAmount(p.value))}},splitLine:{show:false}},
      yAxis:{type:'category',inverse:true,data:rows.map(s=>s.name),axisLabel:{color:colors.text,fontSize:18},axisTick:{show:false},axisLine:{show:false}},
      series:[{id:'store-sales',name,type:'bar',data:rows.map(s=>({id:s.code,name:s.code,value:scale.toPosition(s.value),actualValue:s.value,itemStyle:{shadowBlur:0},label:s.value>axisMax?{position:[ '100%',-9 ],align:'right',verticalAlign:'bottom',distance:0}:s.value<0?{position:'top',align:'center',distance:6}:undefined})),barWidth:10,itemStyle:{color:{type:'linear',x:0,y:0,x2:1,y2:0,colorStops:[{offset:0,color:'#19495a'},{offset:1,color:'#19cbe5'}]},borderRadius:[0,4,4,0]},
        markLine:{silent:true,symbol:'none',label:{show:false},lineStyle:{color:colors.grid,type:'solid',width:1},data:scale.positions.map(xAxis=>({xAxis}))},
        label:{show:true,position:'right',fontSize:22,color:colors.cyan,formatter:p=>'¥'+shortMoney(p.data.actualValue)}}]
    },false);
    renderPart('门店光条动效',()=>storeFlow?.update({rows,positiveCodes,changedCodes:changed.map(s=>s.code),sourceKey}));
    lastStoreRenderSignature=signature;
  }
  function setMode(mode){saveSalesProgress();state.mode=mode;restoreSalesProgress();state.storeOffset=0;$('demoMode').classList.toggle('active',mode==='demo');$('realMode').classList.toggle('active',mode==='real');$('demoMode').setAttribute('aria-pressed',String(mode==='demo'));$('realMode').setAttribute('aria-pressed',String(mode==='real'));renderStats();}
  function renderMonitor(){
    const capacity=storageCapacity();
    $('mapSortingPieces').textContent=storageMetric(config.sortingPieces,true);
    $('mapFloorStackPositions').textContent=storageMetric(config.floorStackPositions,true);
    $('mapColdZoneCount').textContent=storageMetric(capacity.zoneCount,true);
    $('mapColdStoredTonnes').textContent=storageMetric(capacity.storedTonnes);
  }
  function renderPlans(){
    const quarter=Number($('planQuarter').value),known=quarter===4;
    const currentMonth=Number(localISO().slice(5,7)),monthClass=month=>'month-plan-column forecast'+(currentMonth===month?' current-month':'');
    const stores=[Number(config.octStores),Number(config.novStandard)+Number(config.novFranchise),Number(config.decFranchise)];
    const posts=[Number(config.octLogistics),Number(config.novLogistics),Number(config.decLogistics)];
    $('planTitle').textContent=`Q${quarter} 开店与网点拓展计划`;
    const card=(title,value,note)=>`<div class="month-plan-card"><div><span>${title}</span><strong>${value}</strong></div><p>${note}</p></div>`;
    $('quarterDetail').innerHTML=known?`<div class="${monthClass(10)}" data-plan-month="10">${card('新增便民店','+'+stores[0]+' 家','10月计划完成 · 社区布点')}${card('后勤服务网点','+'+posts[0]+' 个','10月计划完成 · 后勤服务')}</div><div class="${monthClass(11)}" data-plan-month="11">${card('3000㎡ 标准店',config.novStandard+' 家','月末开业 · 同步新增加盟店 '+config.novFranchise+' 家')}${card('后勤服务网点扩容','+'+posts[1]+' 个','11月计划 · 配送线路扩容')}</div><div class="${monthClass(12)}" data-plan-month="12">${card('新增加盟店','+'+stores[2]+' 家','12月计划 · 年末消费高峰前布局')}${card('后勤服务网点','+'+posts[2]+' 个','累计预计 '+(Number(config.logistics)+posts[1]+posts[2])+' 个')}</div>`:`<div class="quarter-missing">该季度逐月新增和计划尚未记录</div>`;
    const barData=(values,color)=>values.map(value=>({value,itemStyle:{color:color==='#2eace2'?'rgba(148,215,245,.25)':'rgba(255,242,183,.25)',borderColor:color==='#2eace2'?'#94d7f5':'#fff2b7',borderWidth:1}}));
    chart('planChart').setOption({animationDuration:350,grid:{left:54,right:24,top:28,bottom:34},legend:{top:0,textStyle:{color:colors.muted,fontSize:18},itemWidth:18,itemHeight:8},tooltip:{trigger:'axis',formatter:p=>`${p[0].axisValue}<br>${p.map(x=>x.seriesName+'：'+(x.value==null?'未记录':x.value+' 家/个')).join('<br>')}`},xAxis:{type:'category',data:known?['10月 · 计划','11月 · 计划','12月 · 计划']:['逐月数据待补'],axisLabel:{color:colors.text,fontSize:20,interval:0},axisTick:{show:false},axisLine:{lineStyle:{color:colors.grid}}},yAxis:{type:'value',min:0,minInterval:1,splitNumber:2,axisLabel:{color:colors.muted,fontSize:17},splitLine:{lineStyle:{color:colors.grid}}},series:[{name:'新增门店',type:'bar',itemStyle:{color:colors.cyan},barWidth:32,data:known?barData(stores,'#2eace2'):[null],label:{show:true,position:'top',fontSize:21,color:'#bce6fa'}},{name:'新增后勤网点',type:'bar',itemStyle:{color:colors.gold},barWidth:32,data:known?barData(posts,'#ffe551'):[null],label:{show:true,position:'top',fontSize:21,color:'#fff2b7'}}]},true);
    renderWeights();renderDecisions();
  }
  function renderWeights(){
    try{salesForecast=SalesGrowthScenario.build(window.MONTHLY_SALES_DATA,{horizonMonths:3});}catch{salesForecast=null;}
    chart('weightChart').setOption(SalesTrend.buildOption(window.MONTHLY_SALES_DATA,colors,salesForecast),true);
    $('salesTrendScopeTag').textContent=salesForecast?.status==='ok'?'未来3个月计划':'预测数据不足';
    $('weightChart').setAttribute('aria-label','6月至10月园区销售与已有预期；'+(salesForecast?.status==='ok'?salesForecast.months.map(m=>m.month).join('、')+'销售计划':'未来销售预测暂缺'));
  }
  function renderProducts(){
    const data=window.PRODUCT_PRICE_ANALYSIS_DATA,current=ProductPriceView.page(data,state.productOffset,window.SALES_WEIGHT_CONFIG.carousel);
    const trend=ProductDemandTrend.calculateCategories(window.SALES_WEIGHT_CONFIG,window.CATEGORY_DEMAND_PROFILES_DATA,Date.now(),data);
    const center=data?.store?.storePriceCenter,hasCenter=Number.isFinite(center);
    state.productRows=current?.items||[];
    $('quantityUnit').hidden=true;
    $('productCategoryTitle').textContent=hasCenter?(current?.bigCategoryName||'暂无有效销售数据'):'暂无有效销售数据';
    $('productPageNumber').textContent=current?current.page+'/'+current.pageCount:'';
    chart('productChart').setOption(ProductPriceView.buildOption(current,trend,colors,data?.store),true);
    $('productLegendBase').textContent='成交价格重心（元）· 上轴';
    $('productRangeLegend').textContent='7天需求指数范围 · 下轴';
    $('productStoreCenter').textContent=hasCenter?'全店 ￥'+center.toFixed(2):'全店 --';
    $('productCenterValue').textContent=hasCenter?'全店 ￥'+center.toFixed(2):'全店 --';
    $('productCenterLegend').hidden=false;
    $('productChart').setAttribute('aria-label',`${current?.bigCategoryName||'无数据'}中类真实成交价格重心，全店成交价格重心${hasCenter?center.toFixed(2)+'元':'无有效销售数据'}；下方虚框为未来7天需求指数最小至最大范围`);
  }
  function renderRadar(){
    chart('radarChart').setOption(ConsumerVisuals.decorateRadarOption({animation:false,legend:{orient:'vertical',right:2,top:'center',textStyle:{color:colors.muted,fontSize:17},itemWidth:17,itemHeight:10},radar:{center:['40%','47%'],radius:'58%',indicator:['消费频次','购物篮大小','生鲜偏好','价格敏感度','复购意愿','晚间消费'].map(name=>({name,max:100})),axisName:{color:colors.text,fontSize:17},splitLine:{lineStyle:{color:colors.grid}},splitArea:{show:false},axisLine:{lineStyle:{color:colors.grid}}},series:[{type:'radar',symbolSize:5,data:[{name:'门店客群',value:[76,61,89,64,72,81],lineStyle:{color:colors.gold,width:3},itemStyle:{color:colors.gold},areaStyle:{color:colors.gold,opacity:.1}},{name:'后勤单位客群',value:[61,80,55,76,65,41],lineStyle:{color:colors.cyan,type:'dashed',width:3},itemStyle:{color:colors.cyan},areaStyle:{color:colors.cyan,opacity:.06}}]}]}),true);
  }
  const basicFields=[['stores','在营门店数','家',0,999,1],['logistics','后勤事业部数','个',0,999,1],['delivery','后勤配送网点','家',0,999,1],['ontime','配送准时率','%',0,100,.1],['ontimeChange','相较上周变化','个百分点',-100,100,.1],['sortingPieces','分拣拆整','个',0,999999,1],['floorStackPositions','地堆区','个',0,999999,1],['coldZoneCount','冷链库区数','个',0,999999,1],['coldStoredTonnes','冷链当前存储量','吨',0,999999,.1],['warehouse','旧常温库存（待核验）','吨',0,999999,.1],['cold','旧冷链库存（待核验）','吨',0,999999,.1]];
  const planFields=[['octStores','10 月计划新增便民店','家'],['octLogistics','10 月计划新增后勤网点','个'],['novStandard','11 月标准店','家'],['novFranchise','11 月加盟店','家'],['novLogistics','11 月后勤网点','个'],['decFranchise','12 月加盟店','家'],['decLogistics','12 月后勤网点','个']];
  const tickerFields=[['holidayWeight','国庆假期权重','倍',0,20,.1],['brandCount','品牌代理数','个'],['brandDaily','品牌代理日均出货','元',0,9999999,.01],['cooperativeCount','合作社数','个'],['sundayWeight','周日销售权重','倍',0,20,.1],['double11Weight','双十一权重','倍',0,20,.1]];
  const actualPlanFields=Array.from({length:3},(_,i)=>i+1).flatMap(q=>[['q'+q+'ActualStores','Q'+q+'实际新增门店','家'],['q'+q+'ActualLogistics','Q'+q+'实际新增后勤网点','个']]);
  function syncStorageValidity(){/* Zone count and stored tonnes are different units; do not compare them. */}
  function fillConfig(values=config){const field=([key,label,unit,min=0,max=999,step=1])=>`<div class="field"><label for="cfg-${key}">${label}（${unit}）</label><input id="cfg-${key}" type="number" value="${values[key]}" required min="${min}" max="${max}" step="${step}"></div>`;$('basicFields').innerHTML=basicFields.map(field).join('')+`<div class="drawer-note storage-config-note">分拣拆整、地堆区及库区数按个计；当前存储量按吨计。库区数不能作为吨位上限，原总库容/剩余库容口径已替换。</div><div class="field"><label for="cfg-warehouseUnit">旧常温库存单位</label><select id="cfg-warehouseUnit"><option>吨</option><option>立方米</option><option>件</option></select></div><div class="field"><label for="cfg-coldUnit">旧冷链库存单位</label><select id="cfg-coldUnit"><option>吨</option><option>立方米</option><option>件</option></select></div>`;$('planFields').innerHTML=planFields.map(field).join('');$('tickerFields').innerHTML=tickerFields.map(field).join('')+`<div class="field"><label for="cfg-peakStart">预计晚高峰开始</label><input id="cfg-peakStart" type="time" required></div><div class="field"><label for="cfg-peakEnd">预计晚高峰结束</label><input id="cfg-peakEnd" type="time" required></div>`;$('cfg-peakStart').value=values.peakStart;$('cfg-peakEnd').value=values.peakEnd;$('actualPlanFields').innerHTML=actualPlanFields.map(([key,label,unit])=>`<div class="field"><label for="cfg-${key}">${label}（${unit}）</label><input id="cfg-${key}" type="number" min="0" max="999" step="1" value="${values[key]??''}" placeholder="未记录"></div>`).join('');$('cfg-warehouseUnit').value=values.warehouseUnit;$('cfg-coldUnit').value=values.coldUnit;$('cfgRankSpeed').value=values.rankSpeed;$('cfgStoreRankSpeed').value=STORE_ROTATION_MS/1000;$('cfgReplaySpeed').value=values.replaySpeed;syncStorageValidity();}
  function openConfig(){fillConfig();pane('basic');$('configBackdrop').classList.add('open');$('closeConfig').focus();}function closeConfig(){$('configBackdrop').classList.remove('open');$('openConfig').focus();}
  function saveConfig(){syncStorageValidity();const inputs=[...document.querySelectorAll('[id^="cfg-"]'),$('cfgRankSpeed'),$('cfgStoreRankSpeed'),$('cfgReplaySpeed')];for(const input of inputs)if(!input.checkValidity()){input.reportValidity();return;}for(const [key] of [...basicFields,...planFields,...tickerFields])config[key]=Number($('cfg-'+key).value);for(const [key] of actualPlanFields)config[key]=$('cfg-'+key).value===''?null:Number($('cfg-'+key).value);config.peakStart=$('cfg-peakStart').value;config.peakEnd=$('cfg-peakEnd').value;config.warehouseUnit=$('cfg-warehouseUnit').value;config.coldUnit=$('cfg-coldUnit').value;config.rankSpeed=Number($('cfgRankSpeed').value);config.storeRankSpeed=STORE_ROTATION_MS/1000;config.replaySpeed=Number($('cfgReplaySpeed').value);config.storageMetricsSource='user-configuration';config.storageMetricVersion=3;try{localStorage.setItem('county-dashboard-prototype-v1',JSON.stringify(config));}catch{toast('当前浏览器不能保存配置，已应用到本次预览');}renderStats();renderMonitor();renderPlans();startTimers();closeConfig();toast('配置已保存到当前浏览器；其他访问者不会受影响');}
  function pane(name){document.querySelectorAll('[data-pane]').forEach(b=>b.classList.toggle('active',b.dataset.pane===name));document.querySelectorAll('[data-pane-body]').forEach(b=>b.classList.toggle('active',b.dataset.paneBody===name));$('saveConfig').hidden=name!=='basic';$('resetConfig').hidden=name!=='basic';if(name==='map')fillPointList();}
  let replayTimer,rankTimer,storeRankTimer;
  function startTimers(){
    clearInterval(replayTimer);clearInterval(rankTimer);clearInterval(storeRankTimer);
    const delay=(key,min,max)=>{const value=Number(config[key]);return (Number.isFinite(value)&&value>=min&&value<=max?value:initialConfig[key])*1000;};
    replayTimer=setInterval(()=>{if(state.playing){const day=dataset();if(day.isToday){tickSalesClock();}else if(state.mode==='demo'){const n=day.events.length;if(state.replayed<n)state.replayed++;else if(n)state.flowCursor++;state.flowTick++;renderPart('历史流水',renderStats);}}},delay('replaySpeed',1,30));
    storeRankTimer=setInterval(()=>{
      state.storeOffset++;
      // Keep a receipt promoted when it arrives on this exact rotation tick.
      if(storePriorityAt===null||Date.now()-storePriorityAt>=1000){storePriorityCodes=[];storePriorityAt=null;}
      renderPart('门店排行轮播',()=>renderStores(view()));
    },STORE_ROTATION_MS);
    rankTimer=setInterval(()=>{state.productOffset++;renderPart('商品轮播',renderProducts);},delay('rankSpeed',3,120));
  }
  function rankWindow(items,offset,size){const start=offset%Math.max(1,items.length-size+1);return items.slice(start,start+size);}
  function renderWeather(){
    if(weatherFeed)return;
    $('refreshWeather').onclick=async()=>{const button=$('refreshWeather');button.disabled=true;try{const ok=await weatherFeed.refresh({manual:true});toast(ok?'已读取沁水天气':weatherFeed.getState().message);}finally{button.disabled=false;}};
    weatherFeed=new WeatherFeed(document.querySelector('.weather-panel'),{
      snapshot:window.WEATHER_DATA||null,intervalMs:300000,enabled:true,timeoutMs:30000,fallbackEndpoint:location.protocol==='file:'?'https://kikyo0130yuu-glitch.github.io/qinshui-dashboard/data/weather-latest.json':undefined,...(window.WEATHER_SERVICE_CONFIG?.endpoint&&window.WEATHER_SERVICE_CONFIG.endpoint!=='data/weather-latest.json'?{endpoint:window.WEATHER_SERVICE_CONFIG.endpoint}:{}),...(OFFLINE_DEMO?{offline:true,enabled:false,autoStart:false,autoRefresh:false,persistConfig:false}:{}),statusElement:$('weatherFeedStatus'),showSourceNote:false,
      onStatus:()=>renderDecisions(),
      configElements:{endpoint:$('weatherFeedEndpoint'),enabled:$('weatherFeedEnabled'),interval:$('weatherFeedInterval'),save:$('saveWeatherFeed')},
      renderChart:(model,meta)=>{
        const values=[...model.highs,...model.lows].filter(Number.isFinite);
        const lower=values.length?Math.floor((Math.min(...values)-2)/5)*5:0;
        const upper=values.length?Math.ceil((Math.max(...values)+2)/5)*5:30;
        chart('weatherChart').setOption({animation:!meta.reducedMotion,animationDurationUpdate:450,grid:{left:46,right:22,top:8,bottom:24},
          tooltip:{trigger:'axis',confine:true,renderMode:'richText',formatter:params=>{
            const i=params[0]?.dataIndex,day=model.days[i];if(!day)return '';
            const lines=[day.date,...params.filter(p=>p.value!=null).map(p=>`${p.seriesName}：${Number(p.value).toFixed(1)}°C`)];
            if(day.conditionText)lines.push(day.conditionText);
            if(Number.isFinite(day.precipitationProbabilityPercent))lines.push(`白天降水概率：${day.precipitationProbabilityPercent}%`);
            if(Number.isFinite(day.dayPrecipitationMm))lines.push(`白天降水量：${day.dayPrecipitationMm} mm`);
            return lines.join('\n');
          }},
          xAxis:{type:'category',data:model.dates,axisLabel:{color:colors.muted,fontSize:17},axisLine:{lineStyle:{color:colors.grid}},axisTick:{show:false}},
          yAxis:{type:'value',min:lower,max:Math.max(lower+5,upper),splitNumber:2,axisLabel:{color:colors.muted,fontSize:14,hideOverlap:true,formatter:n=>Number(n)===lower||Number(n)===Math.max(lower+5,upper)?`${n}°`:''},splitLine:{lineStyle:{color:colors.grid,type:'dashed'}}},
          series:[{name:'最高气温',type:'line',data:model.highs,connectNulls:false,symbolSize:6,lineStyle:{color:colors.gold,width:2.5},itemStyle:{color:colors.gold}},
            {name:'最低气温',type:'line',data:model.lows,connectNulls:false,symbolSize:6,lineStyle:{color:colors.cyan,width:2.5,type:'dashed'},itemStyle:{color:colors.cyan}}]
        },true);
      }
    });
  }
  function decisionContext(){
    const monthly=window.MONTHLY_SALES_DATA,consumer=consumerMetrics?.getState(false),weatherState=weatherFeed?.getState(),weather=weatherState?.snapshot;
    return {
      salesTrend:monthly?{source:'user-provided-monthly-sales',currency:monthly.currency,
        actual:monthly.months.map(row=>({month:row.month,amount:row.actualSalesCny,periodStart:row.month+'-01',periodEnd:row.actualPeriodEnd,complete:!row.partial})),
        forecast:monthly.months.map(row=>({month:row.month,amount:row.estimatedSalesCny,source:'user-forecast'})),baseline:{coefficient:BASELINE_FACTOR,source:'user-setting'}}:null,
      // Current stored tonnes are user-supplied stock; zone/item counts remain separate.
      reserves:{ambientTonnes:null,coldTonnes:storageCapacity().storedTonnes,source:'configuration'},
      capacity:storageCapacity(),
      consumerMetrics:consumer?{status:consumer.status,sourceKind:consumer.sourceKind,window:consumer.snapshot?.window||null,counts:consumer.snapshot?.counts||null,replay:consumer.replay?{step:consumer.replay.step,total:consumer.replay.total}:null}:null,
      weather:weather?{status:weather.status==='stale'?'stale':weatherState.status,provider:weather.provider,observedAt:weather.current.observedAt,currentFetchedAt:weather.currentFetchedAt,dailyFetchedAt:weather.dailyFetchedAt,
        temperature:weather.current.temperature,days:weather.days.map(day=>({date:day.date,high:day.high,low:day.low,dayPrecipitationMm:day.dayPrecipitationMm,windScale:day.windScale}))}:null
    };
  }
  function renderDecisions(v=view()){
    if(!decisionAdvice)return;
    const day=dataset(),orders=day.isToday?clockWindow(day).eligible:state.mode==='demo'?day.events.slice(0,state.replayed):day.events;
    const retailOrders=orders.filter(order=>order.kind==='retail'),grouped=new Map();
    for(const order of retailOrders){
      const entry=grouped.get(order.code)||{name:DASHBOARD_DATA.stores.find(store=>store.code===order.code)?.name||order.name,amountCents:0,count:0};
      entry.amountCents+=Number.isInteger(order.amountCents)?order.amountCents:Math.round(order.amount*100);entry.count++;grouped.set(order.code,entry);
    }
    const historySummary=state.mode==='real'&&!day.isToday;
    const sourceKind=day.isToday?(day.simulated?'replay':'actual-today'):state.mode==='demo'?'replay':'historical';
    const orderKeys=new Set(orders.map(order=>order.key||[order.sourceDate||order.date,order.code,order.id].join('|')));
    const context=decisionContext();
    const topOrderStores=historySummary?DASHBOARD_DATA.stores.filter(store=>Number.isFinite(day.stores[store.code])).map(store=>({name:store.name,amount:day.stores[store.code],count:null})).sort((a,b)=>b.amount-a.amount).slice(0,3):[...grouped.values()].sort((a,b)=>b.amountCents-a.amountCents).slice(0,3).map(row=>({name:row.name,amount:row.amountCents/100,count:row.count}));
    decisionAdvice.update({
      businessDate:localISO(),sourceDate:day.date||state.day,mode:state.mode,sourceKind,
      sourceVersion:[sourceKind,day.date||state.day,day.events.length,day.total,decisionBatchRevision].join(':'),
      updatedAt:localISO()+' '+nowText(),displayComposition:state.mode==='demo'?'baseline-plus-replay':'order-net',
      baselineSales:state.mode==='demo'?scaledBaseline(DASHBOARD_DATA.baseline):0,displayedSales:v.total,retail:v.retail,
      netOrderSales:historySummary?day.total:sumMoney(orders),retailOrderSales:historySummary?day.retail:sumMoney(retailOrders),orderCount:historySummary?day.orderCount:orders.length,retailOrderCount:historySummary?day.retailCount:retailOrders.length,
      averageOrder:v.average,refundCount:historySummary?null:orders.filter(order=>order.amount<0).length,
      recentOrder:!historySummary&&orders.length?{name:orders.at(-1).name,amount:orders.at(-1).amount}:null,
      topOrderStores,
      logistics:{active:Number(config.delivery),total:Number(config.logistics),ratio:Number(config.logistics)>0?Number(config.delivery)/Number(config.logistics)*100:null,source:'configuration',onTimePercent:Number(config.ontime),onTimeSource:'configuration'},
      plans:{octStores:Number(config.octStores),octLogistics:Number(config.octLogistics),source:'forecast-configuration'},
      ...context,
      analysisInput:{
        businessDate:localISO(),now:localISO()+'T'+nowText()+'+08:00',
        source:{kind:sourceKind==='replay'?'historical-order-replay':sourceKind==='actual-today'?'actual':'historical',updateCadence:sourceKind==='replay'?'historical-replay':'daily-batch',sourceDates:[...new Set(day.events.map(order=>order.sourceDate||order.date))],updatedAt:localISO()+'T'+nowText()+'+08:00'},
        orders,details:(day.details||[]).filter(item=>orderKeys.has(item.orderKey)),
        historyOrders:window.HISTORY_ORDERS_ANALYSIS_DATA.events,historyDetails:window.HISTORY_ORDERS_ANALYSIS_DATA.details,
        historyCompleteDates:window.HISTORY_ORDERS_ANALYSIS_DATA.metadata.usableForHistoricalBaseline?window.HISTORY_ORDERS_ANALYSIS_DATA.metadata.sourceDates:[],
        categoryMapping:window.PRODUCT_CATEGORY_MAPPING_DATA.items,categoryMappingSource:window.PRODUCT_CATEGORY_MAPPING_DATA.metadata,
        consumerMetrics:context.consumerMetrics,weather:weatherFeed?.snapshot||window.WEATHER_DATA||null,
        warehouse:{source:'configuration',sortingPieces:config.sortingPieces,floorStackPositions:config.floorStackPositions,coldZoneCount:config.coldZoneCount,coldStoredTonnes:config.coldStoredTonnes}
      },analysisRevision:decisionBatchRevision
    });
  }
  function pointData(){
    // Display-only offsets never enter the coordinate editor, storage, or source exports.
    const canonicalStores=MAP_DATA.points.filter(p=>p.type==='store'),publishedStoreIds=new Set(canonicalStores.map(p=>p.id));
    const originals=[...mapPointState.points.filter(p=>!publishedStoreIds.has(p.id)),...canonicalStores];
    const points=StoreDisplayPoints.apply(originals,window.STORE_DISPLAY_POINTS_DATA);
    return {...MAP_DATA,points,settings:{...MAP_DATA.settings,dispatchOriginId:mapPointState.originId,pointCoordinateSystemsConfirmed:Boolean(points.length),pointCoordinateSystem:points.length?'WGS84':MAP_DATA.settings.pointCoordinateSystem}};
  }
  function persistPoints(){
    mapPointState.publishedPointRevision=MAP_DATA.settings.pointDataRevision||null;
    try{localStorage.setItem('qinshui-map-points-v1',JSON.stringify(mapPointState));}catch{$('pointFeedback').textContent='当前浏览器无法保存，已应用于本次预览。';}
    townMap.setData(pointData());fillPointList();
  }
  function fillPointList(){
    $('pointList').replaceChildren();
    for(const p of mapPointState.points){const row=document.createElement('div');row.className='point-row';const copy=document.createElement('div'),name=document.createElement('b'),coord=document.createElement('p');name.textContent=p.name;coord.textContent=`${p.type} · ${p.longitude}, ${p.latitude} · ${p.town||'待判定'}`;copy.append(name,coord);const edit=document.createElement('button');edit.textContent='编辑';edit.onclick=()=>{for(const [field,key] of [['pointId','id'],['pointName','name'],['pointType','type'],['pointLongitude','longitude'],['pointLatitude','latitude'],['pointTown','town']])$(field).value=p[key]??'';$('pointCrs').value='WGS84';};row.append(copy,edit);$('pointList').append(row);}
    const warehouses=mapPointState.points.filter(p=>p.type==='warehouse');$('dispatchOrigin').replaceChildren();$('dispatchOrigin').add(new Option('请选择真实园区仓库',''));for(const p of warehouses)$('dispatchOrigin').add(new Option(p.name,p.id));$('dispatchOrigin').value=mapPointState.originId||'';
    if(!mapPointState.points.length){const empty=document.createElement('p');empty.className='small';empty.textContent='表格坐标系尚未确认，未上屏；可在此录入明确为WGS84的点位。';$('pointList').append(empty);}
  }
  function initPoints(){
    $('applyGpsPoints').onclick=async()=>{
      const file=$('gpsPointFile').files?.[0];if(!file){$('gpsPointFeedback').textContent='请先选择现场采集页导出的JSON文件。';return;}
      if(file.size>1024*1024){$('gpsPointFeedback').textContent='文件过大，请使用采集页导出的点位JSON。';return;}
      try{
        const incoming=MapPointImport.parseGPS(JSON.parse(await file.text()),MAP_DATA.pendingPoints||[]);
        const points=MapPointImport.mergeGPS(mapPointState.points,incoming),origin=points.find(p=>p.isDispatchOrigin)||points.find(p=>p.id===mapPointState.originId);
        mapPointState={...mapPointState,points,originId:origin?.id||'',sourceCoordinateSystem:'WGS84',sourceCoordinateSystemConfirmedByUser:false};
        persistPoints();$('gpsPointFeedback').textContent=`已导入${incoming.length}条现场记录，当前显示${points.length}个点位。${origin?'园区与网点已按真实坐标显示。':'已显示网点，园区坐标仍待补齐。'}本版不显示业务连接线，雷达扫过时点位发光。此处导入仅保存在当前浏览器。`;
      }catch(error){$('gpsPointFeedback').textContent=error instanceof SyntaxError?'JSON格式不正确，请重新导出文件。':error.message||'点位导入失败。';}
    };
    $('applySourcePoints').onclick=()=>{
      // Restore the converted public batch, never relabel raw GCJ-02 as WGS84.
      const points=MAP_DATA.points.map(p=>({...p})),origin=points.find(p=>p.id===MAP_DATA.settings.dispatchOriginId);
      const issue=QinshuiTownMap.pointIssue({...MAP_DATA,points});
      if(issue||!origin){$('sourcePointFeedback').textContent=issue||'本版缺少有效园区点位。';return;}
      mapPointState={points,originId:origin.id,sourceCoordinateSystem:MAP_DATA.settings.sourcePointCoordinateSystem,sourceCoordinateSystemConfirmedByUser:true};
      persistPoints();$('sourcePointFeedback').textContent=`已恢复本版${points.length}个WGS84点位；原表${MAP_DATA.settings.pendingPointCount}条缺坐标保留待补。`;
    };
    $('sourcePointCrs').value=MAP_DATA.settings.sourcePointCoordinateSystem||'UNKNOWN';
    $('sourcePointCrs').disabled=true;
    for(const s of DASHBOARD_DATA.stores)$('pointPreset').add(new Option(s.name+' · '+s.code,s.code));for(const name of MAP_DATA.settings.expectedTownNames)$('pointTown').add(new Option(name,name));
    $('pointPreset').onchange=e=>{const store=DASHBOARD_DATA.stores.find(s=>s.code===e.target.value);if(!store)return;const found=mapPointState.points.find(p=>p.id==='store_'+store.code);$('pointId').value='store_'+store.code;$('pointName').value=store.name;$('pointType').value='store';$('pointLongitude').value=found?.longitude??'';$('pointLatitude').value=found?.latitude??'';$('pointTown').value=found?.town??'';};
    $('pointForm').onsubmit=e=>{e.preventDefault();if(!$('pointForm').reportValidity())return;if($('pointCrs').value!=='WGS84'){$('pointFeedback').textContent='GCJ-02 不能直接叠加到 WGS84 边界上，请先提供转换并核验后的坐标。';return;}const point={id:$('pointId').value.trim(),name:$('pointName').value.trim(),type:$('pointType').value,longitude:Number($('pointLongitude').value),latitude:Number($('pointLatitude').value),town:$('pointTown').value,coordinateSystem:'WGS84'};if(!point.id||!point.name){$('pointFeedback').textContent='请填写点位 ID 和名称。';return;}const i=mapPointState.points.findIndex(p=>p.id===point.id);if(i<0)mapPointState.points.push(point);else mapPointState.points[i]=point;if(!mapPointState.originId&&point.type==='warehouse')mapPointState.originId=point.id;persistPoints();$('pointFeedback').textContent='WGS84点位已保存并投影；县界外的点位按真实坐标显示并提示。';};
    $('dispatchOrigin').onchange=e=>{mapPointState.originId=e.target.value;persistPoints();};
    $('exportPoints').onclick=()=>{const blob=new Blob([JSON.stringify(mapPointState.points.map(p=>({...p,isDispatchOrigin:p.id===mapPointState.originId})),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='qinshui-map-points.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};fillPointList();
  }

  function init(){startSalesClock();window.dashboardNetworkMonitor=new NetworkMonitor($('networkStatus'));restoreSalesSession();const storeChart=chart('storeChart');if(typeof storeChart.getModel==='function'&&typeof storeChart.getZr==='function'&&echarts.graphic)storeFlow=new StoreBarFlow(storeChart,{seriesId:'store-sales',durationMs:1200});consumerMetrics=new ConsumerMetrics($('consumerAnalysisPanel'),{snapshot:window.CONSUMER_METRICS_DATA||null,...(OFFLINE_DEMO?{offline:true,enabled:false,autoStart:false,autoRefresh:false,persistConfig:false}:{}),statusElement:$('consumerMetricsStatus'),expectedWindowDays:window.CONSUMER_REPLAY_DATA?.window?.days||2,allowHistoricalWindow:true,precision:2,onStatus:()=>{renderDecisions();},configElements:{endpoint:$('consumerMetricsEndpoint'),enabled:$('consumerMetricsEnabled'),interval:$('consumerMetricsInterval'),save:$('saveConsumerMetrics')}});decisionAdvice=new DecisionAdvice($('decisionAdviceList'),{statusElement:$('aiAdviceStatus'),offline:OFFLINE_DEMO,onRefresh:()=>renderDecisions(),configElements:{endpoint:$('aiAdviceEndpoint'),enabled:$('aiAdviceEnabled'),interval:$('aiAdviceInterval'),save:$('saveAIAdvice')}});Object.keys(DASHBOARD_DATA.days).sort().forEach(day=>{$('dataDay').add(new Option(day,day));});$('dataDay').value=state.day;$('dataDay').onchange=e=>{saveSalesProgress();state.day=e.target.value;state.source='history';state.storeOffset=0;restoreSalesProgress();state.playing=true;renderStats();};$('demoMode').onclick=()=>setMode('demo');$('realMode').onclick=()=>setMode('real');$('openConfig').onclick=openConfig;$('openMapConfig').onclick=()=>{openConfig();pane('map');};$('planQuarter').onchange=renderPlans;$('closeConfig').onclick=closeConfig;$('saveConfig').onclick=saveConfig;$('resetConfig').onclick=()=>{fillConfig({...initialConfig});toast('已填入初始值，点击保存并预览后应用');};$('configBackdrop').onclick=e=>{if(e.target===$('configBackdrop'))closeConfig();};document.querySelectorAll('[data-pane]').forEach(b=>b.onclick=()=>pane(b.dataset.pane));$('openSources').onclick=()=>{$('sourcesModal').classList.add('open');$('closeSources').focus();};$('closeSources').onclick=()=>{$('sourcesModal').classList.remove('open');$('openSources').focus();};$('sourcesModal').onclick=e=>{if(e.target===$('sourcesModal'))$('closeSources').click();};document.addEventListener('keydown',e=>{if(e.key==='Escape'){if($('configBackdrop').classList.contains('open'))closeConfig();$('sourcesModal').classList.remove('open');}if(e.key==='Tab'){const modal=$('sourcesModal').classList.contains('open')?$('sourcesModal'):$('configBackdrop').classList.contains('open')?$('configBackdrop'):null;if(modal){const focusable=[...modal.querySelectorAll('button,input,select')].filter(el=>!el.hidden&&el.offsetParent!==null&&!el.disabled),first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}});$('fullscreen').onclick=async()=>{try{if(!document.fullscreenElement)await document.documentElement.requestFullscreen();else await document.exitFullscreen();}catch{toast('当前预览窗口不支持全屏，可在浏览器新窗口打开');}};document.querySelectorAll('[data-product]').forEach(b=>b.onclick=()=>{state.product=b.dataset.product;state.productOffset=0;renderProducts();});$('quantityUnit').onchange=e=>{state.unit=e.target.value;state.productOffset=0;renderProducts();};renderWeather();$('sourceRows').innerHTML=[['试营业销售基数','10 天 · 零售 + 批发 ¥417,280.88','已核对',false],['类别销售报表','期间自选 · 正式表头待业务确认','样表已收到',true],['零售订单主表','9,711 张 · 9 家门店 · 10 天','已核对',false],['今日演示订单与明细','10月5日、6日 · 1,682张订单 / 5,068条明细 · ¥40,457.49','逐单对账一致',false],['批发订单主表','283 张 · 批发与退单按净额计算','已核对',false],['批发订单明细','284 行样本 · 51 张单据','部分样本',true],['商品价格与9月历史','19,745张主单 / 51,258条明细 · 3,059价格有效SKU · 17个中类','正式分类已核验',false],['月度实际与销售计划','6–9月完整实绩 · 10月截至5日 · 当月实际/预期对比 · 未来3个月计划','配置计划',true]].map(([name,note,status,pending])=>`<div class="source-row"><div><b>${name}</b><p>${note}</p></div><span class="source-status ${pending?'pending':''}">${status}</span></div>`).join('');initPoints();TodayOrderImport.init(DASHBOARD_DATA.stores,localISO,applyTodayOrderBatch);const headings=['部门编码','部门名称','含税销售额','销售数量','客流量'];$('mappingFields').innerHTML=[['门店 / 部门编码','部门编码'],['门店 / 部门名称','部门名称'],['含税销售金额','含税销售额']].map(([label,selected])=>`<div class="mapping-row"><span>${label}</span><select aria-label="${label}对应字段">${headings.map(h=>`<option ${h===selected?'selected':''}>${h}</option>`).join('')}</select></div>`).join('');$('importFile').onchange=e=>{const f=e.target.files[0];$('fileStatus').textContent=f?`已选择 ${f.name} · ${(f.size/1024).toFixed(1)} KB；下方字段为样表映射演示，未解析文件。`:'按实际字段映射，不依赖固定列位置。';$('importResult').textContent='';};$('previewImport').onclick=()=>{const a=new Date($('importStart').value+'T00:00:00Z'),b=new Date($('importEnd').value+'T00:00:00Z'),days=Math.round((b-a)/86400000)+1;if(!Number.isFinite(days)||days<=0){$('importResult').textContent='请填写有效的起止日期，结束日期不能早于开始日期。';return;}const selected=[...$('mappingFields').querySelectorAll('select')].map(x=>x.value);if(new Set(selected).size!==selected.length){$('importResult').textContent='不同业务字段不能映射到同一个来源字段。';return;}if(selected[2]!=='含税销售额'){$('importResult').textContent='销售金额不能使用销售数量或客流量；需确认选定字段的金额含义。';return;}$('importResult').innerHTML=`<p>期间首尾计入：<b>${days} 天</b><br>映射：${selected.join(' / ')}<br>导入规则：忽略空白与合计行，按部门编码匹配，展示基数 = 对应含税金额 ÷ ${days} × 45%。</p><p class="gold">这是映射规则预览，尚未解析或保存所选文件。</p>`;};renderStats();renderPart('配送地图',renderMonitor);renderPart('季度计划',renderPlans);renderPart('商品图表',renderProducts);renderPart('消费者画像',renderRadar);tickSalesClock();startTimers();window.addEventListener('pagehide',saveSalesProgress);document.addEventListener('visibilitychange',()=>{if(document.hidden)saveSalesProgress();else tickSalesClock();});window.addEventListener('pageshow',tickSalesClock);window.addEventListener('focus',tickSalesClock);window.addEventListener('storage',syncStorageData);window.addEventListener('resize',()=>Object.values(charts).forEach(c=>c.resize()));if(document.modelContext?.registerTool){const tools=[{name:'read_dashboard_preview',description:'Read the current prototype mode, source date, sales summary and local configuration.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>({mode:state.mode,sourceDate:state.day,sales:view().total,config:{...config},prototype:true})},{name:'set_dashboard_preview_mode',description:'Switch between historical real-data preview and historical order replay; no shared data is changed.',inputSchema:{type:'object',properties:{mode:{type:'string',enum:['real','demo']}},required:['mode'],additionalProperties:false},execute:input=>{if(!input||!['real','demo'].includes(input.mode))throw new Error('Invalid preview mode');setMode(input.mode);return {mode:state.mode,sales:view().total};}}];for(const tool of tools)try{Promise.resolve(document.modelContext.registerTool(tool)).catch(()=>{});}catch{}}}
  if(typeof DASHBOARD_DATA!=='undefined'&&typeof echarts!=='undefined')init();else{$('modeStatus').textContent='资源加载失败，请刷新页面';}
