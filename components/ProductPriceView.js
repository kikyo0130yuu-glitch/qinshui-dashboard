(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.ProductPriceView=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const finite=value=>typeof value==='number'&&Number.isFinite(value);
  const centerOf=item=>finite(item?.categoryPriceCenter)?item.categoryPriceCenter:finite(item?.priceCenter)?item.priceCenter:null;
  const yuan=value=>finite(value)?'￥'+value.toFixed(2):'--';
  const defaultPolicy={pageSize:3,hiddenMiddleCategoryCodes:['1101','9999','1004'],hiddenMiddleCategoryNames:['环岛类','默认分类','默认类别','临时采购'],hideNoPriceCategories:true};
  function displayPages(data,policy={}){
    const settings={...defaultPolicy,...policy},hiddenCodes=new Set(settings.hiddenMiddleCategoryCodes),hiddenNames=new Set(settings.hiddenMiddleCategoryNames);
    const items=data?.middleCategories||data?.categoryPages?.flatMap(p=>p.items)||[],groups=new Map();
    for(const item of items){
      if(hiddenCodes.has(String(item.middleCategoryCode))||hiddenNames.has(item.middleCategoryName))continue;
      if(settings.hideNoPriceCategories&&(centerOf(item)===null||centerOf(item)<=0||item.priceValidSkuCount===0))continue;
      const key=String(item.bigCategoryCode)+'|'+item.bigCategoryName;
      if(!groups.has(key))groups.set(key,{bigCategoryCode:item.bigCategoryCode,bigCategoryName:item.bigCategoryName,items:[]});
      groups.get(key).items.push(item);
    }
    const pages=[],size=Number.isSafeInteger(settings.pageSize)&&settings.pageSize>0?Math.min(4,settings.pageSize):3;
    for(const group of [...groups.values()].sort((a,b)=>String(a.bigCategoryCode).localeCompare(String(b.bigCategoryCode)))){
      group.items.sort((a,b)=>(centerOf(b)??-Infinity)-(centerOf(a)??-Infinity)||String(a.middleCategoryCode).localeCompare(String(b.middleCategoryCode)));
      const count=Math.ceil(group.items.length/size);
      for(let start=0;start<group.items.length;start+=size)pages.push({bigCategoryCode:group.bigCategoryCode,bigCategoryName:group.bigCategoryName,page:start/size+1,pageCount:count,items:group.items.slice(start,start+size)});
    }
    return pages;
  }
  function page(data,offset=0,policy={}){const pages=displayPages(data,policy);return pages.length?pages[((offset%pages.length)+pages.length)%pages.length]:null;}
  // Seven daily demand factors use their original 0.60–2.00 scale. They are
  // independent of currency prices and do not predict a future selling price.
  function demandRange(trend){
    const values=(trend?.days||[]).map(day=>finite(day.finalDemandIndex)?day.finalDemandIndex:day.demandIndex).filter(finite);
    return values.length===7?{min:Math.min(...values),max:Math.max(...values),dayCount:values.length}:null;
  }
  function buildOption(current,trend,colors,store={}){
    const items=current?.items||[],prices=items.map(centerOf),range=demandRange(trend);
    const storeCenter=finite(store.storePriceCenter)?store.storePriceCenter:items.find(item=>finite(item.storePriceCenter))?.storePriceCenter??null;
    const highest=Math.max(1,...prices.filter(finite),storeCenter||0);
    const limits=trend?.demandIndexLimits||{min:0.6,max:2};
    const annotations=items.flatMap((item,i)=>prices[i]===null?[{xAxis:0,yAxis:i,value:'--',symbolSize:0,label:{show:true,formatter:'--',position:'right',fontSize:18,color:colors.muted}}]:[]);
    const tooltip=params=>{
      const first=params.find(item=>item.seriesId==='price-center')||params[0];if(!first)return '';
      const item=items[first.dataIndex],i=first.dataIndex;if(!item)return '';
      const future=range?`<br>未来7天需求范围：${range.min.toFixed(2)}–${range.max.toFixed(2)}（1.00为正常需求）<br>${escape(trend.startDate)} 至 ${escape(trend.endDate)}<br>各品类暂用同一整体需求权重`:'';
      return `${escape(item.middleCategoryName)}<br>成交价格重心：${yuan(prices[i])}<br>全店成交价格重心：${yuan(storeCenter)}<br>价格有效SKU：${item.priceValidSkuCount}个 · 动销SKU：${item.salesActiveSkuCount}个${future}`;
    };
    return {animationDurationUpdate:600,
      grid:{left:176,right:252,top:29,bottom:31},
      tooltip:{trigger:'axis',confine:true,formatter:tooltip},
      xAxis:[{type:'value',position:'top',min:0,max:highest*1.1,name:'元',nameGap:12,nameTextStyle:{color:colors.gold,fontSize:15},axisLabel:{fontSize:15,color:colors.gold,formatter:value=>Number(value).toLocaleString('zh-CN',{maximumFractionDigits:2})},axisTick:{show:false},axisLine:{show:false},splitNumber:4,splitLine:{lineStyle:{color:colors.grid}}},
        {type:'value',position:'bottom',min:limits.min,max:limits.max,axisLabel:{fontSize:15,color:'#c4d0df',formatter:value=>Number(value).toFixed(2)},axisTick:{show:false},axisLine:{show:false},splitNumber:4,splitLine:{show:false}}],
      yAxis:{type:'category',inverse:true,data:items.map(item=>item.middleCategoryName),axisLabel:{fontSize:17,color:colors.text},axisTick:{show:false},axisLine:{show:false}},
      series:[{id:'price-center',name:'成交价格重心',type:'bar',xAxisIndex:0,barWidth:8,barGap:'45%',data:prices,
        itemStyle:{color:colors.gold,borderRadius:[0,3,3,0]},label:{show:true,position:'right',distance:7,color:colors.gold,fontSize:17,
          formatter:params=>yuan(prices[params.dataIndex])},
        markPoint:{silent:true,data:annotations},
        {id:'demand-range-start',name:'需求范围起点',type:'bar',xAxisIndex:1,stack:'demand-range',barWidth:12,data:items.map(()=>range?.min??null),itemStyle:{color:'transparent'},silent:true},
        {id:'demand-range',name:'未来7天需求范围',type:'bar',xAxisIndex:1,stack:'demand-range',barWidth:12,data:items.map(()=>range?range.max-range.min:null),
          itemStyle:{color:'rgba(194,206,222,.12)',borderColor:'#c2cede',borderWidth:1.2,borderType:'dashed'},
          label:{show:Boolean(range),position:'right',color:'#c4d0df',fontSize:16,formatter:()=>range?`${range.min.toFixed(2)}–${range.max.toFixed(2)}`:''}}]
    };
  }
  return {page,displayPages,demandRange,buildOption};
});
