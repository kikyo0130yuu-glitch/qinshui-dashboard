(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.ProductPriceView=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function page(data,offset=0){const pages=data?.categoryPages||[];return pages.length?pages[((offset%pages.length)+pages.length)%pages.length]:null;}
  function buildOption(current,trend,colors){
    const items=current?.items||[],days=trend?.days||[],indices=items.map(item=>item.priceIndex);
    const max=Math.ceil(Math.max(120,...indices)/100)*100;
    return {animationDurationUpdate:600,
      grid:[{left:176,right:212,top:7,bottom:'41%'},{left:176,right:38,top:'76%',bottom:23}],
      tooltip:{trigger:'axis',confine:true,formatter:params=>{
        const first=params.find(item=>item.seriesId==='price-index')||params[0];if(!first)return '';
        if(first.seriesId==='demand-trend'){
          const day=days[first.dataIndex];return day?`${escape(day.date)}<br>需求趋势：${escape(day.trendLevel)}（${day.demandIndex.toFixed(3)}）<br>月 / 周内 / 节日权重：${day.monthWeight} / ${day.weekdayWeight} / ${day.holidayWeight}${day.hasMissingWeight?'<br>部分权重缺失，采用默认1':''}`:'';
        }
        const item=items[first.dataIndex];return item?`${escape(item.middleCategoryName)}<br>成交价格重心：￥${item.priceCenter.toFixed(2)}<br>中类价格指数：${item.priceIndex.toFixed(2)}（全店=100）<br>较全店：${item.compareToStorePercent>=0?'+':''}${item.compareToStorePercent.toFixed(2)}%<br>价格有效SKU：${item.priceValidSkuCount}个<br>指数只表示价格位置，不评价经营优劣`:'';
      }},
      xAxis:[{type:'value',gridIndex:0,min:0,max,axisLabel:{fontSize:16,color:colors.muted},axisTick:{show:false},splitNumber:4,splitLine:{lineStyle:{color:colors.grid}}},
        {type:'category',gridIndex:1,data:days.map(day=>day.date.slice(5).replace('-','/')),axisLabel:{fontSize:15,color:colors.muted,interval:0},axisTick:{show:false},axisLine:{lineStyle:{color:colors.grid}}}],
      yAxis:[{type:'category',gridIndex:0,inverse:true,data:items.map(item=>item.middleCategoryName),axisLabel:{fontSize:17,color:colors.text},axisTick:{show:false},axisLine:{show:false}},
        {type:'value',gridIndex:1,min:.6,max:2,axisLabel:{show:false},axisTick:{show:false},splitLine:{show:false}}],
      series:[{id:'price-index',name:'中类价格指数',type:'bar',xAxisIndex:0,yAxisIndex:0,barWidth:10,data:indices,
        itemStyle:{color:colors.gold,borderRadius:[0,3,3,0]},label:{show:true,position:'right',color:colors.gold,fontSize:18,formatter:params=>`${params.value.toFixed(1)} · ￥${items[params.dataIndex].priceCenter.toFixed(2)}`},
        markLine:{silent:true,symbol:'none',label:{show:false},lineStyle:{color:'#dc7777',type:'dashed'},data:[{xAxis:100}]}},
        {id:'demand-trend',name:'未来7天整体需求趋势',type:'line',xAxisIndex:1,yAxisIndex:1,data:days.map(day=>day.demandIndex),symbolSize:6,
          lineStyle:{color:colors.cyan,width:2},itemStyle:{color:colors.cyan},areaStyle:{color:colors.cyan,opacity:.12},
          markLine:{silent:true,symbol:'none',label:{show:false},lineStyle:{color:colors.muted,type:'dashed',opacity:.45},data:[{yAxis:1}]}}]
    };
  }
  return {page,buildOption};
});
