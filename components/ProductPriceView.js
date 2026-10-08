(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.ProductPriceView=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function page(data,offset=0){const pages=data?.categoryPages||[];return pages.length?pages[((offset%pages.length)+pages.length)%pages.length]:null;}
  // Range is the smallest/largest of seven daily demand values, not a price
  // forecast or a statistical confidence interval. Current weights are global.
  function demandRange(trend){
    const values=(trend?.days||[]).map(day=>day.demandIndex).filter(Number.isFinite).map(value=>value*100);
    return values.length===7?{min:Math.min(...values),max:Math.max(...values),dayCount:values.length}:null;
  }
  function buildOption(current,trend,colors){
    const items=current?.items||[],indices=items.map(item=>item.priceIndex),range=demandRange(trend);
    const max=Math.ceil(Math.max(120,...indices)/100)*100;
    return {animationDurationUpdate:600,
      grid:{left:176,right:212,top:25,bottom:28},
      tooltip:{trigger:'axis',confine:true,formatter:params=>{
        const first=params.find(item=>item.seriesId==='price-index')||params[0];if(!first)return '';
        const item=items[first.dataIndex];if(!item)return '';
        const future=range?`<br>未来7天需求指数范围：${range.min.toFixed(1)}–${range.max.toFixed(1)}（正常需求=100）<br>日期：${escape(trend.startDate)} 至 ${escape(trend.endDate)}<br>范围为7天逐日最小值/最大值，不是价格预测或置信区间<br>当前各品类采用同一整体需求权重`:'';
        return `${escape(item.middleCategoryName)}<br>成交价格重心：￥${item.priceCenter.toFixed(2)}<br>实算价格指数：${item.priceIndex.toFixed(2)}（全店=100）<br>较全店：${item.compareToStorePercent>=0?'+':''}${item.compareToStorePercent.toFixed(2)}%<br>价格有效SKU：${item.priceValidSkuCount}个${future}<br>指数只表示价格位置，不评价经营优劣`;
      }},
      xAxis:[{type:'value',position:'top',min:0,max,axisLabel:{fontSize:15,color:colors.gold},axisTick:{show:false},axisLine:{show:false},splitNumber:4,splitLine:{lineStyle:{color:colors.grid}}},
        {type:'value',position:'bottom',min:0,max:200,axisLabel:{fontSize:15,color:'#c4d0df'},axisTick:{show:false},axisLine:{show:false},interval:50,splitLine:{show:false}}],
      yAxis:{type:'category',inverse:true,data:items.map(item=>item.middleCategoryName),axisLabel:{fontSize:17,color:colors.text},axisTick:{show:false},axisLine:{show:false}},
      series:[{id:'price-index',name:'实算价格指数',type:'bar',xAxisIndex:0,barWidth:8,barGap:'45%',data:indices,
        itemStyle:{color:colors.gold,borderRadius:[0,3,3,0]},label:{show:true,position:'right',color:colors.gold,fontSize:18,formatter:params=>`${params.value.toFixed(1)} · ￥${items[params.dataIndex].priceCenter.toFixed(2)}`},
        markLine:{silent:true,symbol:'none',label:{show:false},lineStyle:{color:'#dc7777',type:'dashed'},data:[{xAxis:100}]}},
        {id:'demand-range-start',name:'需求范围起点',type:'bar',xAxisIndex:1,stack:'demand-range',barWidth:12,data:items.map(()=>range?.min??null),itemStyle:{color:'transparent'},silent:true},
        {id:'demand-range',name:'未来7天需求指数范围',type:'bar',xAxisIndex:1,stack:'demand-range',barWidth:12,data:items.map(()=>range?range.max-range.min:null),
          itemStyle:{color:'rgba(194,206,222,.12)',borderColor:'#c2cede',borderWidth:1.2,borderType:'dashed'},
          label:{show:Boolean(range),position:'right',color:'#c4d0df',fontSize:16,formatter:()=>range?`${range.min.toFixed(1)}–${range.max.toFixed(1)}`:''}}]
    };
  }
  return {page,demandRange,buildOption};
});
