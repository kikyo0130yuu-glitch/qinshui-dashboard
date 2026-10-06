
  'use strict';
  const $=id=>document.getElementById(id), money=n=>Number(n).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}), shortMoney=n=>Number(n).toLocaleString('zh-CN',{maximumFractionDigits:0});
  const initialConfig={stores:10,logistics:70,delivery:44,ontime:99.7,ontimeChange:.6,warehouse:120,warehouseUnit:'吨',cold:50,coldUnit:'吨',rankSpeed:6,storeRankSpeed:9,replaySpeed:3,q1ActualStores:null,q1ActualLogistics:null,q2ActualStores:null,q2ActualLogistics:null,q3ActualStores:null,q3ActualLogistics:null,q4ActualStores:null,q4ActualLogistics:null,octStores:5,octLogistics:8,novStandard:1,novFranchise:5,novLogistics:10,decFranchise:20,decLogistics:10,holidayWeight:2,brandCount:3,brandDaily:8600,cooperativeCount:6,sundayWeight:1.5,double11Weight:2.2,peakStart:'17:30',peakEnd:'19:10'};
  let config={...initialConfig};try{const saved=JSON.parse(localStorage.getItem('county-dashboard-prototype-v1')||'null');if(saved&&typeof saved==='object'){config={...initialConfig,...saved};if(saved.storeRankSpeed===undefined)config.storeRankSpeed=(Number.isFinite(Number(saved.rankSpeed))&&Number(saved.rankSpeed)>0?Number(saved.rankSpeed):6)+3;}}catch{}
  function fitBoard(){document.documentElement.style.setProperty('--board-scale',Math.min(window.innerWidth/3268,window.innerHeight/1290));}
  fitBoard();window.addEventListener('resize',fitBoard);
  const state={mode:'demo',source:'prepared',day:'2026-10-03',replayed:0,playing:true,product:'price',unit:'kg',storeOffset:0,productOffset:0,flowCursor:0,flowTick:0,flowEpoch:Date.now()};
  let mapPointState={points:MAP_DATA.points.map(p=>({...p})),originId:MAP_DATA.settings.dispatchOriginId||MAP_DATA.points.find(p=>p.isDispatchOrigin)?.id||''};
  try{const saved=JSON.parse(localStorage.getItem('qinshui-map-points-v1')||'null');if(saved&&Array.isArray(saved.points)&&saved.points.every(p=>p.id&&p.name&&p.type&&Number.isFinite(p.longitude)&&Number.isFinite(p.latitude)&&Math.abs(p.longitude)<=180&&Math.abs(p.latitude)<=90))mapPointState=saved;}catch{}
  const townMap=new QinshuiTownMap($('townMap'),pointData());
  const monthWeights=[1,1.2,1.3,1.1,1,1.4,1.6];
  let decisionAdvice=null,decisionBatchRevision=0,weatherFeed=null,consumerMetrics=null;
  let consumerReplayRun=0,consumerReplayBatch=null,consumerReplayStep=-1;
  const charts={}, colors={text:'#ffffff',muted:'#92a0b7',grid:'rgba(46,172,226,0.15)',cyan:'#2eace2',gold:'#ffe551',mint:'#64d6ad'};
  const chart=(id)=>charts[id]||(charts[id]=echarts.init($(id),null,{renderer:'svg'}));
  const localISO=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const nowText=()=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date());
  const weekdayText=(date=localISO())=>['周日','周一','周二','周三','周四','周五','周六'][new Date(date+'T12:00:00Z').getUTCDay()];
  const activeSiteRatio=()=>Number(config.logistics)>0&&Number.isFinite(Number(config.delivery))?(Number(config.delivery)/Number(config.logistics)*100).toFixed(2)+'%':'—';
  let tickerSpans=null,clockBusinessDate=null;
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
      `品牌代理 <b>${config.brandCount} 个</b> · 日均出货约 <b>¥${shortMoney(config.brandDaily)}</b>`,
      `农产品上行 · <b>${config.cooperativeCount} 个</b> 合作社 · 冷链储备 <b>${config.cold} ${config.coldUnit}</b>`,
      `周日销售权重 <b>${Number(config.sundayWeight).toFixed(1)}</b> · 晚高峰预计 <b>${config.peakStart}–${config.peakEnd}</b>`,
      `10月预估新增：便民店 <b>+${config.octStores} 家</b> · 后勤网点 <b>+${config.octLogistics} 个</b>`,
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
    const date=localISO();
    if(clockBusinessDate&&clockBusinessDate!==date){state.replayed=0;state.flowCursor=0;state.flowTick=0;state.flowEpoch=Date.now();renderStats();consumerMetrics?.refresh();if(clockBusinessDate.slice(0,7)!==date.slice(0,7))renderPlans();}
    clockBusinessDate=date;
    $('clock').textContent=nowText();$('dataUpdate').textContent=date+' '+nowText();
    $('deliveryFoot').textContent=`活跃网点占比 ${activeSiteRatio()}`;
    renderTicker();
  }
  function toast(text){$('toast').textContent=text;$('toast').style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').style.display='none',3200);}
  let todayOrders=null;try{const saved=JSON.parse(localStorage.getItem('qinshui-today-orders-v1')||'null');if(saved?.date===localISO()&&Array.isArray(saved.events)&&saved.events.every(e=>e.date===saved.date&&e.kind==='retail'&&Number.isFinite(e.amount)&&DASHBOARD_DATA.stores.some(s=>s.code===e.code)))todayOrders=saved;}catch{}
  let preparedBatch=null;
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
  function dataset(){
    const batch=activeBatch();
    if(batch){const events=batch.events,retail=sumMoney(events),stores=Object.fromEntries(DASHBOARD_DATA.stores.map(s=>[s.code,0]));events.forEach(e=>stores[e.code]+=e.amount);return {total:retail,retail,wholesale:0,stores,events,details:batch.details||[],orderCount:events.length,retailCount:events.length,isToday:true,simulated:batch.mode==='replay',date:batch.date};}
    return {...DASHBOARD_DATA.days[state.day],isToday:false};
  }
  function view(){
    const day=dataset();
    if(state.mode==='real')return {total:day.total,retail:day.retail,wholesale:day.wholesale,stores:day.stores,events:day.events.slice(-3).reverse(),count:day.orderCount,retailCount:day.retailCount,average:day.retailCount?day.retail/day.retailCount:null};
    const played=day.events.slice(0,state.replayed),retailOrders=played.filter(e=>e.kind==='retail'),retail=sumMoney(retailOrders),wholesale=sumMoney(played.filter(e=>e.kind==='wholesale')),stores=Object.fromEntries(DASHBOARD_DATA.stores.map(s=>[s.code,s.baseline]));
    retailOrders.forEach(e=>stores[e.code]=(stores[e.code]||0)+e.amount);
    // Average order value uses only orders already accumulated, never the baseline.
    return {total:DASHBOARD_DATA.baseline+retail+wholesale,retail:DASHBOARD_DATA.retailBaseline+retail,wholesale:DASHBOARD_DATA.wholesaleBaseline+wholesale,stores,events:played.slice(-3).reverse(),count:played.length,retailCount:retailOrders.length,average:retailOrders.length?retail/retailOrders.length:null};
  }
  function displayedFlow(v){
    if(state.mode==='real')return v.events;
    const source=dataset().events.slice(0,state.replayed),n=source.length;
    if(!n)return [];
    const end=(n-1+state.flowCursor)%n;
    return Array.from({length:Math.min(3,n)},(_,i)=>{
      const e=source[(end-i+n)%n],when=new Date(state.flowEpoch+(state.flowTick-i)*Number(config.replaySpeed)*1000);
      return {...e,displayTime:new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(when)};
    });
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
  function renderStats(){
    const v=view(),demo=state.mode==='demo',day=dataset();
    $('salesValue').textContent=money(v.total);
    $('salesLabel').textContent=demo||day.isToday?'今日销售额':'历史日净销售额';
    const comparisonBase=!demo&&day.isToday?DASHBOARD_DATA.retailBaseline:DASHBOARD_DATA.baseline;
    const change=comparisonBase>0?(v.total-comparisonBase)/comparisonBase*100:null;
    $('salesFoot').textContent=change===null?'— vs 昨日':`${change<0?'▼':'▲'} ${Math.abs(change).toFixed(1)}% vs 昨日`;
    $('salesFoot').classList.toggle('red',change<0);
    $('retailTotal').textContent='¥'+money(v.retail);$('deliveryValue').textContent=config.delivery;$('deliveryFoot').textContent=`活跃网点占比 ${activeSiteRatio()}`;
    $('ontimeValue').textContent=Number(config.ontime).toFixed(1);$('ontimeFoot').textContent=`${config.ontimeChange>=0?'+':''}${Number(config.ontimeChange).toFixed(1)}pt 较上周`;
    $('siteValue').textContent=Number(config.stores)+Number(config.logistics);$('siteFoot').textContent=`门店 ${config.stores} + 后勤 ${config.logistics}`;$('averageOrder').textContent=v.average===null?'—':Number(v.average).toFixed(2);
    $('modeStatus').textContent=day.isToday?(day.simulated?'日均基数 + 10月2日、3日订单映射今日回放':'今日门店订单 · '+(demo?'基数 + 回放':'实收净额')):(demo?'日均基数 + 所选历史订单回放':'历史订单净销售额 · 不加基数');
    $('dataDayLabel').textContent=day.isToday?'历史预览日期':demo?'回放源日期':'业务日期';$('dataDay').disabled=day.isToday;
    $('dateInfo').textContent=day.isToday?`订单日期 ${day.date}${day.simulated?' · 演示（保留原始日期）':''}`:(demo?`展示日期 ${localISO()} · 演示`:'已导入历史数据，非今日实时');
    $('flowList').innerHTML=displayedFlow(v).map(e=>`<div class="flow-row"><span class="mono small">${e.displayTime||e.time||'—'}</span><span class="place" title="${e.name}">${e.name}</span><span class="flow-type">${e.type}</span><span class="flow-amount ${e.amount<0?'red':''}">${e.amount<0?'−':'¥'}${money(Math.abs(e.amount))}</span></div>`).join('');
    if(!v.events.length)$('flowList').innerHTML='<div class="small" style="padding:18px 0">暂无订单</div>';
    renderStores(v);renderTicker(v);renderDecisions(v);renderConsumerMetrics();
  }
  function renderStores(v){
    const all=DASHBOARD_DATA.stores.filter(s=>Number.isFinite(v.stores[s.code])).map(s=>({...s,value:v.stores[s.code]})).sort((a,b)=>b.value-a.value||a.code.localeCompare(b.code));
    const pinned=all.find(s=>s.code==='2001'),others=all.filter(s=>s.code!=='2001');
    const rows=pinned?[...rankWindow(others,state.storeOffset,3),pinned]:rankWindow(all,state.storeOffset,4);state.storeRows=rows;
    $('storeTag').textContent='降序';
    const name='门店销售额',axisMax=Math.max(30000,Math.ceil(Math.max(0,...all.map(x=>x.value))*1.1/5000)*5000),ticks=[500,1000,5000,10000,20000,30000];
    chart('storeChart').setOption({
      animationDurationUpdate:600,grid:{left:206,right:138,top:20,bottom:55},tooltip:{trigger:'axis',axisPointer:{type:'shadow'}},legend:{show:false},
      xAxis:{type:'value',name:'元',nameLocation:'end',nameGap:64,min:Math.floor(Math.min(0,...all.map(x=>x.value))/1000)*1000,max:axisMax,interval:500,
        nameTextStyle:{color:colors.muted,fontSize:18},axisTick:{show:false},
        // Preserve monetary distances; stagger 500 and 1000 to keep both labels legible.
        axisLabel:{color:colors.muted,fontSize:18,align:'left',formatter:n=>ticks.includes(n)?(n===500?'\n500':n>=10000?Number((n/10000).toFixed(1))+'万':n):''},splitLine:{show:false}},
      yAxis:{type:'category',inverse:true,data:rows.map(s=>s.name),axisLabel:{color:colors.text,fontSize:18},axisTick:{show:false},axisLine:{show:false}},
      series:[{name,type:'bar',data:rows.map(s=>({name:s.code,value:s.value})),barWidth:10,itemStyle:{color:{type:'linear',x:0,y:0,x2:1,y2:0,colorStops:[{offset:0,color:'#19495a'},{offset:1,color:'#19cbe5'}]},borderRadius:[0,4,4,0]},
        markLine:{silent:true,symbol:'none',label:{show:false},lineStyle:{color:colors.grid,type:'solid',width:1},data:ticks.map(xAxis=>({xAxis}))},
        label:{show:true,position:'right',fontSize:22,color:colors.cyan,formatter:p=>'¥'+shortMoney(p.value)}}]
    },true);
  }
  function setMode(mode){state.mode=mode;state.storeOffset=0;$('demoMode').classList.toggle('active',mode==='demo');$('realMode').classList.toggle('active',mode==='real');$('demoMode').setAttribute('aria-pressed',String(mode==='demo'));$('realMode').setAttribute('aria-pressed',String(mode==='real'));renderStats();}
  function renderMonitor(){
    $('mapWarehouse').innerHTML=`${config.warehouse}<small>${config.warehouseUnit}</small>`;
    $('mapCold').innerHTML=`${config.cold}<small>${config.coldUnit}</small>`;
  }
  function renderPlans(){
    const quarter=Number($('planQuarter').value),known=quarter===4;
    const currentMonth=Number(localISO().slice(5,7)),monthClass=month=>'month-plan-column forecast'+(currentMonth===month?' current-month':'');
    const stores=[Number(config.octStores),Number(config.novStandard)+Number(config.novFranchise),Number(config.decFranchise)];
    const posts=[Number(config.octLogistics),Number(config.novLogistics),Number(config.decLogistics)];
    $('planTitle').textContent=`Q${quarter} 开店与网点拓展计划`;
    const card=(title,value,note)=>`<div class="month-plan-card"><div><span>${title}</span><strong>${value}</strong></div><p>${note}</p></div>`;
    $('quarterDetail').innerHTML=known?`<div class="${monthClass(10)}" data-plan-month="10">${card('新增便民店','+'+stores[0]+' 家','10月预估完成 · 社区布点')}${card('后勤服务网点','+'+posts[0]+' 个','10月预估完成 · 后勤服务')}</div><div class="${monthClass(11)}" data-plan-month="11">${card('3000㎡ 标准店',config.novStandard+' 家','月末开业 · 同步新增加盟店 '+config.novFranchise+' 家')}${card('后勤服务网点扩容','+'+posts[1]+' 个','11月计划 · 配送线路扩容')}</div><div class="${monthClass(12)}" data-plan-month="12">${card('新增加盟店','+'+stores[2]+' 家','12月计划 · 年末消费高峰前布局')}${card('后勤服务网点','+'+posts[2]+' 个','累计预计 '+(Number(config.logistics)+posts[1]+posts[2])+' 个')}</div>`:`<div class="quarter-missing">该季度逐月新增和计划尚未记录</div>`;
    const barData=(values,color)=>values.map(value=>({value,itemStyle:{color:color==='#2eace2'?'rgba(148,215,245,.25)':'rgba(255,242,183,.25)',borderColor:color==='#2eace2'?'#94d7f5':'#fff2b7',borderWidth:1}}));
    chart('planChart').setOption({animationDuration:350,grid:{left:54,right:24,top:28,bottom:34},legend:{top:0,textStyle:{color:colors.muted,fontSize:18},itemWidth:18,itemHeight:8},tooltip:{trigger:'axis',formatter:p=>`${p[0].axisValue}<br>${p.map(x=>x.seriesName+'：'+(x.value==null?'未记录':x.value+' 家/个')).join('<br>')}`},xAxis:{type:'category',data:known?['10月 · 预估','11月 · 计划','12月 · 计划']:['逐月数据待补'],axisLabel:{color:colors.text,fontSize:20,interval:0},axisTick:{show:false},axisLine:{lineStyle:{color:colors.grid}}},yAxis:{type:'value',min:0,minInterval:1,splitNumber:2,axisLabel:{color:colors.muted,fontSize:17},splitLine:{lineStyle:{color:colors.grid}}},series:[{name:'新增门店',type:'bar',itemStyle:{color:colors.cyan},barWidth:32,data:known?barData(stores,'#2eace2'):[null],label:{show:true,position:'top',fontSize:21,color:'#bce6fa'}},{name:'新增后勤网点',type:'bar',itemStyle:{color:colors.gold},barWidth:32,data:known?barData(posts,'#ffe551'):[null],label:{show:true,position:'top',fontSize:21,color:'#fff2b7'}}]},true);
    renderWeights();renderDecisions();
  }
  function renderWeights(){
    const p=Number(config.logistics),future=[p,p+Number(config.novLogistics),p+Number(config.novLogistics)+Number(config.decLogistics)];
    chart('weightChart').setOption({animation:false,grid:{left:56,right:70,top:42,bottom:31},tooltip:{trigger:'axis'},legend:{top:0,textStyle:{color:colors.muted,fontSize:18},itemWidth:16,itemHeight:8,data:[{name:'月度基础权重',icon:'roundRect'},{name:'后勤家数·实际'},{name:'后勤家数·预估',icon:'circle',itemStyle:{color:'transparent',borderColor:'#64d6ad',borderWidth:2}}]},xAxis:{type:'category',data:['6月','7月','8月','9月','10月','11月','12月'],axisLabel:{color:colors.muted,fontSize:19,interval:0},axisLine:{lineStyle:{color:colors.grid}},axisTick:{show:false}},yAxis:[{type:'value',name:'权重',max:2,splitNumber:2,nameTextStyle:{color:colors.muted,fontSize:18},axisLabel:{color:colors.muted,fontSize:18},splitLine:{lineStyle:{color:colors.grid}}},{type:'value',name:'网点/个',max:120,splitNumber:2,nameTextStyle:{color:colors.muted,fontSize:18},axisLabel:{color:colors.muted,fontSize:18},splitLine:{show:false}}],series:[{name:'月度基础权重',type:'bar',itemStyle:{color:'#19bdd6'},data:monthWeights.map((value,i)=>({value,itemStyle:{color:'#19bdd6',opacity:i>4?.3:1}})),barWidth:26},{name:'后勤家数·实际',type:'line',symbol:'circle',yAxisIndex:1,data:[null,32,47,70,p,null,null],symbolSize:7,lineStyle:{color:colors.mint,width:3},itemStyle:{color:colors.mint}},{name:'后勤家数·预估',type:'line',yAxisIndex:1,data:[null,null,null,p,...future],lineStyle:{type:'dashed',color:'rgba(100,214,173,0.4)',width:3},symbol:'circle',symbolSize:8,itemStyle:{color:'transparent',borderColor:'#64d6ad',borderWidth:2,shadowBlur:3,shadowColor:'#64d6ad'}}]},true);
  }
  const products=[{name:'生鲜果蔬',price:108,indexRange:[120,168],amount:[56000,78400],kg:[840,1176]},{name:'肉禽蛋奶',price:102,indexRange:[96,130],amount:[42000,62000],kg:[560,812]},{name:'粮油调味',price:98,indexRange:[82,105],amount:[31000,45000],kg:[350,490],袋:[420,588]},{name:'酒水饮料',price:96,indexRange:[78,118],amount:[26000,41000],瓶:[840,1176]},{name:'日用百货',price:94,indexRange:[70,92],amount:[12000,19000],瓶:[210,294],袋:[140,210]}];
  function renderProducts(){
    const isPrice=state.product==='price',isAmount=state.product==='amount',unit=isPrice?'指数':isAmount?'元':state.unit;
    const all=products.filter(p=>state.product!=='quantity'||p[state.unit]).slice().sort((a,b)=>(isPrice?b.price-a.price:isAmount?b.amount[1]-a.amount[1]:b[state.unit][1]-a[state.unit][1]));
    const items=rankWindow(all,state.productOffset,3);state.productRows=items;$('quantityUnit').hidden=state.product!=='quantity';document.querySelectorAll('[data-product]').forEach(b=>b.classList.toggle('active',b.dataset.product===state.product));
    const ranges=items.map(p=>isPrice?p.indexRange:isAmount?p.amount:p[state.unit]);
    const series=[{name:isPrice?'自身历史价格指数':'预估下限',type:'bar',data:items.map((p,i)=>isPrice?p.price:ranges[i][0]),barWidth:8,itemStyle:{color:colors.gold},label:{show:true,position:'right',color:colors.gold,fontSize:19,formatter:p=>isPrice?p.value:shortMoney(p.value)}},{name:'区间起点',type:'bar',stack:'range',data:ranges.map(x=>x[0]),barWidth:14,itemStyle:{color:'transparent'},silent:true},{name:'预估区间',type:'bar',stack:'range',data:ranges.map(x=>x[1]-x[0]),barWidth:14,itemStyle:{color:'#c2cede44',borderColor:'#c2cede',borderWidth:1.2,borderType:'dashed'},label:{show:true,position:'right',color:'#c4d0df',fontSize:17,formatter:p=>ranges[p.dataIndex].map(shortMoney).join('–')}}];
    if(isPrice)series[0].markLine={symbol:'none',silent:true,label:{show:false},lineStyle:{type:'dashed',color:'#dc7777'},data:[{xAxis:100}]};
    chart('productChart').setOption({animationDurationUpdate:600,grid:{left:140,right:125,top:16,bottom:26},tooltip:{trigger:'axis',formatter:p=>{const i=p[0].dataIndex,d=items[i];return `${d.name}<br>${isPrice?'价格指数：'+d.price+'（自身历史售价=100）<br>':''}未来7天${isPrice?'销量（指数化）':''}：${ranges[i].map(shortMoney).join('–')} ${unit}`;}},xAxis:[{type:'value',name:unit,max:isPrice?200:Math.max(...ranges.map(x=>x[1]))*1.22,nameTextStyle:{color:colors.muted,fontSize:16},axisLabel:{color:colors.muted,fontSize:17,formatter:n=>n>=10000?Number((n/10000).toFixed(1))+'万':n},splitLine:{lineStyle:{color:colors.grid}}}],yAxis:{type:'category',inverse:true,data:items.map(p=>p.name),axisLabel:{color:colors.text,fontSize:19},axisLine:{show:false},axisTick:{show:false}},series},true);
    $('productLegendBase').textContent=isPrice?'自身历史价格指数':'预估下限';$('productRangeLegend').textContent=isPrice?'销量预估区间（指数化）':`未来7天预估区间 / ${unit}`;$('productCenterLegend').hidden=!isPrice;
  }
  function renderRadar(){
    chart('radarChart').setOption(ConsumerVisuals.decorateRadarOption({animation:false,legend:{orient:'vertical',right:2,top:'center',textStyle:{color:colors.muted,fontSize:17},itemWidth:17,itemHeight:10},radar:{center:['40%','47%'],radius:'58%',indicator:['消费频次','购物篮大小','生鲜偏好','价格敏感度','复购意愿','晚间消费'].map(name=>({name,max:100})),axisName:{color:colors.text,fontSize:17},splitLine:{lineStyle:{color:colors.grid}},splitArea:{show:false},axisLine:{lineStyle:{color:colors.grid}}},series:[{type:'radar',symbolSize:5,data:[{name:'门店客群',value:[76,61,89,64,72,81],lineStyle:{color:colors.gold,width:3},itemStyle:{color:colors.gold},areaStyle:{color:colors.gold,opacity:.1}},{name:'后勤单位客群',value:[61,80,55,76,65,41],lineStyle:{color:colors.cyan,type:'dashed',width:3},itemStyle:{color:colors.cyan},areaStyle:{color:colors.cyan,opacity:.06}}]}]}),true);
  }
  const basicFields=[['stores','在营门店数','家',0,999,1],['logistics','后勤事业部数','个',0,999,1],['delivery','后勤配送网点','家',0,999,1],['ontime','配送准时率','%',0,100,.1],['ontimeChange','相较上周变化','个百分点',-100,100,.1],['warehouse','常温仓储储备','吨',0,999999,.1],['cold','冷链储备','吨',0,999999,.1]];
  const planFields=[['octStores','10 月预估新增便民店','家'],['octLogistics','10 月预估新增后勤网点','个'],['novStandard','11 月标准店','家'],['novFranchise','11 月加盟店','家'],['novLogistics','11 月后勤网点','个'],['decFranchise','12 月加盟店','家'],['decLogistics','12 月后勤网点','个']];
  const tickerFields=[['holidayWeight','国庆假期权重','倍',0,20,.1],['brandCount','品牌代理数','个'],['brandDaily','品牌代理日均出货','元',0,9999999,.01],['cooperativeCount','合作社数','个'],['sundayWeight','周日销售权重','倍',0,20,.1],['double11Weight','双十一权重','倍',0,20,.1]];
  const actualPlanFields=Array.from({length:3},(_,i)=>i+1).flatMap(q=>[['q'+q+'ActualStores','Q'+q+'实际新增门店','家'],['q'+q+'ActualLogistics','Q'+q+'实际新增后勤网点','个']]);
  function fillConfig(values=config){const field=([key,label,unit,min=0,max=999,step=1])=>`<div class="field"><label for="cfg-${key}">${label}（${unit}）</label><input id="cfg-${key}" type="number" value="${values[key]}" required min="${min}" max="${max}" step="${step}"></div>`;$('basicFields').innerHTML=basicFields.map(field).join('')+`<div class="field"><label for="cfg-warehouseUnit">仓储储备单位</label><select id="cfg-warehouseUnit"><option>吨</option><option>立方米</option><option>件</option></select></div><div class="field"><label for="cfg-coldUnit">冷链储备单位</label><select id="cfg-coldUnit"><option>吨</option><option>立方米</option><option>件</option></select></div>`;$('planFields').innerHTML=planFields.map(field).join('');$('tickerFields').innerHTML=tickerFields.map(field).join('')+`<div class="field"><label for="cfg-peakStart">预计晚高峰开始</label><input id="cfg-peakStart" type="time" required></div><div class="field"><label for="cfg-peakEnd">预计晚高峰结束</label><input id="cfg-peakEnd" type="time" required></div>`;$('cfg-peakStart').value=values.peakStart;$('cfg-peakEnd').value=values.peakEnd;$('actualPlanFields').innerHTML=actualPlanFields.map(([key,label,unit])=>`<div class="field"><label for="cfg-${key}">${label}（${unit}）</label><input id="cfg-${key}" type="number" min="0" max="999" step="1" value="${values[key]??''}" placeholder="未记录"></div>`).join('');$('cfg-warehouseUnit').value=values.warehouseUnit;$('cfg-coldUnit').value=values.coldUnit;$('cfgRankSpeed').value=values.rankSpeed;$('cfgStoreRankSpeed').value=values.storeRankSpeed;$('cfgReplaySpeed').value=values.replaySpeed;}
  function openConfig(){fillConfig();pane('basic');$('configBackdrop').classList.add('open');$('closeConfig').focus();}function closeConfig(){$('configBackdrop').classList.remove('open');$('openConfig').focus();}
  function saveConfig(){const inputs=[...document.querySelectorAll('[id^="cfg-"]'),$('cfgRankSpeed'),$('cfgStoreRankSpeed'),$('cfgReplaySpeed')];for(const input of inputs)if(!input.checkValidity()){input.reportValidity();return;}for(const [key] of [...basicFields,...planFields,...tickerFields])config[key]=Number($('cfg-'+key).value);for(const [key] of actualPlanFields)config[key]=$('cfg-'+key).value===''?null:Number($('cfg-'+key).value);config.peakStart=$('cfg-peakStart').value;config.peakEnd=$('cfg-peakEnd').value;config.warehouseUnit=$('cfg-warehouseUnit').value;config.coldUnit=$('cfg-coldUnit').value;config.rankSpeed=Number($('cfgRankSpeed').value);config.storeRankSpeed=Number($('cfgStoreRankSpeed').value);config.replaySpeed=Number($('cfgReplaySpeed').value);try{localStorage.setItem('county-dashboard-prototype-v1',JSON.stringify(config));}catch{toast('当前浏览器不能保存配置，已应用到本次预览');}renderStats();renderMonitor();renderPlans();startTimers();closeConfig();toast('配置已保存到当前浏览器；其他访问者不会受影响');}
  function pane(name){document.querySelectorAll('[data-pane]').forEach(b=>b.classList.toggle('active',b.dataset.pane===name));document.querySelectorAll('[data-pane-body]').forEach(b=>b.classList.toggle('active',b.dataset.paneBody===name));$('saveConfig').hidden=name!=='basic';$('resetConfig').hidden=name!=='basic';if(name==='map')fillPointList();}
  let replayTimer,rankTimer,storeRankTimer;
  function startTimers(){
    clearInterval(replayTimer);clearInterval(rankTimer);clearInterval(storeRankTimer);
    replayTimer=setInterval(()=>{if(state.mode==='demo'&&state.playing){const n=dataset().events.length;if(state.replayed<n)state.replayed++;else if(n)state.flowCursor++;state.flowTick++;renderStats();}},config.replaySpeed*1000);
    storeRankTimer=setInterval(()=>{state.storeOffset++;renderStores(view());},config.storeRankSpeed*1000);
    rankTimer=setInterval(()=>{state.productOffset++;renderProducts();},config.rankSpeed*1000);
  }
  function rankWindow(items,offset,size){const start=offset%Math.max(1,items.length-size+1);return items.slice(start,start+size);}
  function renderWeather(){
    if(weatherFeed)return;
    weatherFeed=new WeatherFeed(document.querySelector('.weather-panel'),{
      snapshot:window.WEATHER_DATA||null,statusElement:$('weatherFeedStatus'),
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
  function renderDecisions(v=view()){
    if(!decisionAdvice)return;
    const day=dataset(),orders=state.mode==='demo'?day.events.slice(0,state.replayed):day.events;
    const retailOrders=orders.filter(order=>order.kind==='retail'),grouped=new Map();
    for(const order of retailOrders){
      const entry=grouped.get(order.code)||{name:DASHBOARD_DATA.stores.find(store=>store.code===order.code)?.name||order.name,amountCents:0,count:0};
      entry.amountCents+=Number.isInteger(order.amountCents)?order.amountCents:Math.round(order.amount*100);entry.count++;grouped.set(order.code,entry);
    }
    const historySummary=state.mode==='real'&&!day.isToday;
    const sourceKind=state.mode==='demo'?'replay':day.isToday?'actual-today':'historical';
    const topOrderStores=historySummary?DASHBOARD_DATA.stores.filter(store=>Number.isFinite(day.stores[store.code])).map(store=>({name:store.name,amount:day.stores[store.code],count:null})).sort((a,b)=>b.amount-a.amount).slice(0,3):[...grouped.values()].sort((a,b)=>b.amountCents-a.amountCents).slice(0,3).map(row=>({name:row.name,amount:row.amountCents/100,count:row.count}));
    decisionAdvice.update({
      businessDate:day.isToday?day.date:state.day,mode:state.mode,sourceKind,
      sourceVersion:[sourceKind,day.date||state.day,day.events.length,day.total,decisionBatchRevision].join(':'),
      updatedAt:localISO()+' '+nowText(),displayComposition:state.mode==='demo'?'baseline-plus-replay':'order-net',
      baselineSales:state.mode==='demo'?DASHBOARD_DATA.baseline:0,displayedSales:v.total,retail:v.retail,
      netOrderSales:historySummary?day.total:sumMoney(orders),retailOrderSales:historySummary?day.retail:sumMoney(retailOrders),orderCount:historySummary?day.orderCount:orders.length,retailOrderCount:historySummary?day.retailCount:retailOrders.length,
      averageOrder:v.average,refundCount:historySummary?null:orders.filter(order=>order.amount<0).length,
      recentOrder:!historySummary&&orders.length?{name:orders.at(-1).name,amount:orders.at(-1).amount}:null,
      topOrderStores,
      logistics:{active:Number(config.delivery),total:Number(config.logistics),ratio:Number(config.logistics)>0?Number(config.delivery)/Number(config.logistics)*100:null,source:'configuration'},
      plans:{octStores:Number(config.octStores),octLogistics:Number(config.octLogistics),source:'forecast-configuration'}
    });
  }
  function pointData(){return {...MAP_DATA,points:mapPointState.points,settings:{...MAP_DATA.settings,dispatchOriginId:mapPointState.originId,pointCoordinateSystemsConfirmed:Boolean(mapPointState.points.length),pointCoordinateSystem:mapPointState.points.length?'WGS84':MAP_DATA.settings.pointCoordinateSystem}};}
  function persistPoints(){
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
    $('applySourcePoints').onclick=()=>{
      const crs=$('sourcePointCrs').value;
      if(crs!=='WGS84'){$('sourcePointFeedback').textContent=crs==='UNKNOWN'?'请先核实原表C列的坐标系；不能根据数值猜测或直接上屏。':`${crs}不能直接叠加WGS84边界，请先转换并核验坐标。`;return;}
      const source=MAP_DATA.pendingPoints||[],points=source.filter(p=>Number.isFinite(p.longitude)&&Number.isFinite(p.latitude)).map(p=>({...p,coordinateSystem:'WGS84',pointCoordinateSystem:'WGS84',coordinateSystemConfirmedByUser:true}));
      const origin=points.find(p=>p.isDispatchOrigin||p.sourceType==='园区');
      if(!origin){$('sourcePointFeedback').textContent='原表缺少有效园区坐标，无法启用园区线路；龙港镇100公里雷达独立显示。';return;}
      mapPointState={points,originId:origin.id,sourceCoordinateSystem:'WGS84',sourceCoordinateSystemConfirmedByUser:true};
      persistPoints();$('sourcePointFeedback').textContent=`已接入${points.length}条已确认WGS84点位；${source.length-points.length}条缺坐标保留待补。县界外点位按真实坐标显示并提示，不强行放入县域。`;
    };
    if(mapPointState.sourceCoordinateSystemConfirmedByUser){$('sourcePointCrs').value=mapPointState.sourceCoordinateSystem;$('sourcePointFeedback').textContent=`当前浏览器已接入${mapPointState.points.length}条已确认WGS84的原表点位。`;}
    for(const s of DASHBOARD_DATA.stores)$('pointPreset').add(new Option(s.name+' · '+s.code,s.code));for(const name of MAP_DATA.settings.expectedTownNames)$('pointTown').add(new Option(name,name));
    $('pointPreset').onchange=e=>{const store=DASHBOARD_DATA.stores.find(s=>s.code===e.target.value);if(!store)return;const found=mapPointState.points.find(p=>p.id==='store_'+store.code);$('pointId').value='store_'+store.code;$('pointName').value=store.name;$('pointType').value='store';$('pointLongitude').value=found?.longitude??'';$('pointLatitude').value=found?.latitude??'';$('pointTown').value=found?.town??'';};
    $('pointForm').onsubmit=e=>{e.preventDefault();if(!$('pointForm').reportValidity())return;if($('pointCrs').value!=='WGS84'){$('pointFeedback').textContent='GCJ-02 不能直接叠加到 WGS84 边界上，请先提供转换并核验后的坐标。';return;}const point={id:$('pointId').value.trim(),name:$('pointName').value.trim(),type:$('pointType').value,longitude:Number($('pointLongitude').value),latitude:Number($('pointLatitude').value),town:$('pointTown').value,coordinateSystem:'WGS84'};if(!point.id||!point.name){$('pointFeedback').textContent='请填写点位 ID 和名称。';return;}const i=mapPointState.points.findIndex(p=>p.id===point.id);if(i<0)mapPointState.points.push(point);else mapPointState.points[i]=point;if(!mapPointState.originId&&point.type==='warehouse')mapPointState.originId=point.id;persistPoints();$('pointFeedback').textContent='WGS84点位已保存并投影；县界外的点位按真实坐标显示并提示。';};
    $('dispatchOrigin').onchange=e=>{mapPointState.originId=e.target.value;persistPoints();};
    $('exportPoints').onclick=()=>{const blob=new Blob([JSON.stringify(mapPointState.points.map(p=>({...p,isDispatchOrigin:p.id===mapPointState.originId})),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='qinshui-map-points.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};fillPointList();
  }

  function init(){consumerMetrics=new ConsumerMetrics($('consumerAnalysisPanel'),{snapshot:window.CONSUMER_METRICS_DATA||null,statusElement:$('consumerMetricsStatus'),expectedWindowDays:10,allowHistoricalWindow:true,precision:2,onStatus:info=>{const window=info.snapshot?.window;if(window)$('consumerSampleTag').textContent=window.start.slice(5).replace('-','.')+'–'+window.end.slice(5).replace('-','.')+'会员样本';},configElements:{endpoint:$('consumerMetricsEndpoint'),enabled:$('consumerMetricsEnabled'),interval:$('consumerMetricsInterval'),save:$('saveConsumerMetrics')}});decisionAdvice=new DecisionAdvice($('decisionAdviceList'),{statusElement:$('aiAdviceStatus'),configElements:{endpoint:$('aiAdviceEndpoint'),enabled:$('aiAdviceEnabled'),interval:$('aiAdviceInterval'),save:$('saveAIAdvice')}});Object.keys(DASHBOARD_DATA.days).sort().forEach(day=>{$('dataDay').add(new Option(day,day));});$('dataDay').value=state.day;$('dataDay').onchange=e=>{state.day=e.target.value;state.source='history';state.storeOffset=0;state.replayed=0;state.flowCursor=0;state.flowTick=0;state.flowEpoch=Date.now();state.playing=true;renderStats();};$('demoMode').onclick=()=>setMode('demo');$('realMode').onclick=()=>setMode('real');$('openConfig').onclick=openConfig;$('openMapConfig').onclick=()=>{openConfig();pane('map');};$('planQuarter').onchange=renderPlans;$('closeConfig').onclick=closeConfig;$('saveConfig').onclick=saveConfig;$('resetConfig').onclick=()=>{fillConfig({...initialConfig});toast('已填入初始值，点击保存并预览后应用');};$('configBackdrop').onclick=e=>{if(e.target===$('configBackdrop'))closeConfig();};document.querySelectorAll('[data-pane]').forEach(b=>b.onclick=()=>pane(b.dataset.pane));$('openSources').onclick=()=>{$('sourcesModal').classList.add('open');$('closeSources').focus();};$('closeSources').onclick=()=>{$('sourcesModal').classList.remove('open');$('openSources').focus();};$('sourcesModal').onclick=e=>{if(e.target===$('sourcesModal'))$('closeSources').click();};document.addEventListener('keydown',e=>{if(e.key==='Escape'){if($('configBackdrop').classList.contains('open'))closeConfig();$('sourcesModal').classList.remove('open');}if(e.key==='Tab'){const modal=$('sourcesModal').classList.contains('open')?$('sourcesModal'):$('configBackdrop').classList.contains('open')?$('configBackdrop'):null;if(modal){const focusable=[...modal.querySelectorAll('button,input,select')].filter(el=>!el.hidden&&el.offsetParent!==null&&!el.disabled),first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}});$('fullscreen').onclick=async()=>{try{if(!document.fullscreenElement)await document.documentElement.requestFullscreen();else await document.exitFullscreen();}catch{toast('当前预览窗口不支持全屏，可在浏览器新窗口打开');}};document.querySelectorAll('[data-product]').forEach(b=>b.onclick=()=>{state.product=b.dataset.product;state.productOffset=0;renderProducts();});$('quantityUnit').onchange=e=>{state.unit=e.target.value;state.productOffset=0;renderProducts();};renderWeather();$('sourceRows').innerHTML=[['试营业销售基数','10 天 · 零售 + 批发 ¥417,280.88','已核对',false],['类别销售报表','期间自选 · 正式表头待业务确认','样表已收到',true],['零售订单主表','9,711 张 · 9 家门店 · 10 天','已核对',false],['今日演示订单与明细','10月2日、3日 · 2,049张订单 / 5,864条明细 · ¥55,774.59','逐单对账一致',false],['批发订单主表','283 张 · 批发与退单按净额计算','已核对',false],['批发订单明细','284 行样本 · 51 张单据','部分样本',true],['商品与分类表','SKU → 最小级分类 → 二级分类','待补齐',true]].map(([name,note,status,pending])=>`<div class="source-row"><div><b>${name}</b><p>${note}</p></div><span class="source-status ${pending?'pending':''}">${status}</span></div>`).join('');initPoints();TodayOrderImport.init(DASHBOARD_DATA.stores,localISO,batch=>{todayOrders=batch;decisionBatchRevision++;state.source='prepared';state.replayed=0;state.flowCursor=0;state.flowTick=0;state.flowEpoch=Date.now();state.playing=true;state.storeOffset=0;renderStats();consumerMetrics.refresh();});const headings=['部门编码','部门名称','含税销售额','销售数量','客流量'];$('mappingFields').innerHTML=[['门店 / 部门编码','部门编码'],['门店 / 部门名称','部门名称'],['含税销售金额','含税销售额']].map(([label,selected])=>`<div class="mapping-row"><span>${label}</span><select aria-label="${label}对应字段">${headings.map(h=>`<option ${h===selected?'selected':''}>${h}</option>`).join('')}</select></div>`).join('');$('importFile').onchange=e=>{const f=e.target.files[0];$('fileStatus').textContent=f?`已选择 ${f.name} · ${(f.size/1024).toFixed(1)} KB；下方字段为样表映射演示，未解析文件。`:'按实际字段映射，不依赖固定列位置。';$('importResult').textContent='';};$('previewImport').onclick=()=>{const a=new Date($('importStart').value+'T00:00:00Z'),b=new Date($('importEnd').value+'T00:00:00Z'),days=Math.round((b-a)/86400000)+1;if(!Number.isFinite(days)||days<=0){$('importResult').textContent='请填写有效的起止日期，结束日期不能早于开始日期。';return;}const selected=[...$('mappingFields').querySelectorAll('select')].map(x=>x.value);if(new Set(selected).size!==selected.length){$('importResult').textContent='不同业务字段不能映射到同一个来源字段。';return;}if(selected[2]!=='含税销售额'){$('importResult').textContent='销售金额不能使用销售数量或客流量；需确认选定字段的金额含义。';return;}$('importResult').innerHTML=`<p>期间首尾计入：<b>${days} 天</b><br>映射：${selected.join(' / ')}<br>导入规则：忽略空白与合计行，按部门编码匹配，日均基数 = 对应金额 ÷ ${days}。</p><p class="gold">这是映射规则预览，尚未解析或保存所选文件。</p>`;};renderStats();renderMonitor();renderPlans();renderProducts();renderRadar();updateClock();setInterval(updateClock,1000);startTimers();window.addEventListener('resize',()=>Object.values(charts).forEach(c=>c.resize()));if(document.modelContext?.registerTool){const tools=[{name:'read_dashboard_preview',description:'Read the current prototype mode, source date, sales summary and local configuration.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>({mode:state.mode,sourceDate:state.day,sales:view().total,config:{...config},prototype:true})},{name:'set_dashboard_preview_mode',description:'Switch between historical real-data preview and historical order replay; no shared data is changed.',inputSchema:{type:'object',properties:{mode:{type:'string',enum:['real','demo']}},required:['mode'],additionalProperties:false},execute:input=>{if(!input||!['real','demo'].includes(input.mode))throw new Error('Invalid preview mode');setMode(input.mode);return {mode:state.mode,sales:view().total};}}];for(const tool of tools)try{Promise.resolve(document.modelContext.registerTool(tool)).catch(()=>{});}catch{}}}
  if(typeof DASHBOARD_DATA!=='undefined'&&typeof echarts!=='undefined')init();else{$('modeStatus').textContent='资源加载失败，请刷新页面';}
