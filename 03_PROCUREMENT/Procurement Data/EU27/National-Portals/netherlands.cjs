'use strict';
const fs=require('node:fs'),path=require('node:path'),cheerio=require('cheerio');
const {download}=require('./archives.cjs');
function parseRelease(r){
 const t=r.tender||{},tags=(r.tag||[]).join(' '),label=t.noticeTypeDetails||'';
 const kind=/award|contract/i.test(tags)||/gegunde|gunning/i.test(label)?'award':/planning/i.test(tags)||/marktconsultatie|vooraankondiging/i.test(label)?'planning':'tender';
 const cancelled=/tenderCancellation|cancelled/i.test(tags+' '+t.status)||/beëindiging/i.test(label);
 const lots=t.lots?.length?t.lots:[{}];
 return lots.map(l=>({noticeId:String(r.id)+(l.id?'|'+l.id:''),procedureId:String(r.ocid||t.id||r.id)+(l.id?'|'+l.id:''),sourceUrl:'https://www.tenderned.nl/aankondigingen/overzicht/'+encodeURIComponent(r.id),title:l.title||t.title||'',description:l.description||t.description||'',buyer:r.buyer?.name||'',publicationDate:(r.date||'').slice(0,10),sourceUpdated:r.date||'',deadlineRaw:l.tenderPeriod?.endDate||t.tenderPeriod?.endDate||t.registrationPeriod?.endDate||'',noticeType:kind,sourceStatus:cancelled?'cancelled':t.status||label,noticeVerified:true,cpv:[t.classification?.id,...(t.items||[]).filter(i=>!l.id||i.relatedLot===l.id).map(i=>i.classification?.id)].filter(Boolean).join(' | '),value:l.value?.amount??t.value?.amount??'',currency:l.value?.currency||t.value?.currency||'',documents:(t.documents||[]).map(d=>d.url).filter(Boolean).join(' | ')}));
}
async function dutchArchives(ctx){
 const page='https://www.tenderned.nl/cms/nl/aanbesteden-in-cijfers/datasets-aanbestedingen';
 const {body}=await ctx.get(page),$=cheerio.load(body),links=new Map();
 $('a[href]').each((i,e)=>{const u=new URL($(e).attr('href'),page),m=u.pathname.match(/Dataset_Tenderned-(\d{4})-01-01-(\d{4}-\d{2}-\d{2})\.json$/i);if(u.hostname==='www.tenderned.nl'&&m&&m[1]>=ctx.options.from.slice(0,4)&&m[1]<=ctx.options.to.slice(0,4))links.set(m[1],{url:u.href,end:m[2]});});
 if(!links.size)throw Error('No official TenderNed JSON datasets discovered');
 let latest='';for(const [year,item]of [...links].sort((a,b)=>a[0].localeCompare(b[0]))){
  if(!ctx.canFetch()){ctx.gap('Dutch annual dataset request budget reached');break;}
  const file=path.join(ctx.rawDir,'TenderNed-'+year+'.json');ctx.recordRequest();console.log('[NL-portal] historical dataset '+year);
  if(!fs.existsSync(file))await download(item.url,file,Math.max(ctx.options.timeout,300000));
  if(fs.statSync(file).size>256*1024*1024)throw Error('Dutch dataset exceeds 256 MiB parser limit');
  const data=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(data.releases))throw Error('Dutch dataset has no OCDS releases');
  for(const release of data.releases)for(const r of parseRelease(release))ctx.emit(r,file+'#release='+release.id);
  console.log('[NL-portal] '+year+': scanned '+data.releases.length+' releases');if(item.end>latest)latest=item.end;
 }
 if(latest<ctx.options.to)ctx.gap('Dutch public historical dataset ends '+latest+'; recent RSS does not fill the full intervening period. Full current XML API requires separately issued credentials.');
 ctx.gap('Dutch historical dataset includes notice types and lots. Later portal amendments must be checked before treating historical future deadlines as current opportunities.');
}
module.exports={parseRelease,dutchArchives};
