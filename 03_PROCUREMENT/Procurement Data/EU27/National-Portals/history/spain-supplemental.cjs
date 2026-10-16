'use strict';
const path=require('node:path');
const national=process.env.NATIONAL_COLLECTOR_ROOT||path.resolve(__dirname,'..');
const cheerio=require(path.join(national,'node_modules/cheerio'));
const {parseArchiveFeed}=require(path.join(national,'archives.cjs'));
function parseHistoryFeed(xml,source){
 const result=parseArchiveFeed(xml,source);
 if(!['consultation','in_house_assignment'].includes(source.noticeType)||!result.rows.length)return result;
 const doc=cheerio.load(xml,{xml:true}),local=(el,name)=>el.find('*').filter((i,e)=>e.name?.split(':').pop()===name),first=(el,name)=>local(el,name).first().text().trim();
 const entries=new Map();doc('*').filter((i,e)=>e.name?.split(':').pop()==='entry').each((i,e)=>{const el=doc(e);entries.set(first(el,'id'),el);});
 for(const row of result.rows){
  const el=entries.get(row.noticeId);if(!el)throw Error('Supplemental entry identity missing');
  row.noticeType=source.noticeType;
  if(source.noticeType==='consultation'){
   row.sourceStatus=first(el,'PreliminaryMarketConsultationStatusCode');
   row.deadlineRaw=first(el,'LimitDate');
   if(!row.publicationDate)row.publicationDate=first(el,'PlannedDate');
  }else if(!row.value){
   const amount=local(local(el,'ProcurementProject').first(),'TaxExclusiveAmount').first();
   row.value=amount.text().trim();row.currency=amount.attr('currencyID')||'';
   if(row.value)row.description+=' Source budget excluding VAT: '+row.value+' '+row.currency+'.';
  }
 }
 return result;
}
module.exports={parseHistoryFeed};
