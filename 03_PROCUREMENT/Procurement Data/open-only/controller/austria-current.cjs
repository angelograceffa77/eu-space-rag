'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const endpoint='https://ausschreibungen.usp.gv.at/at.gv.bmdw.eproc-p/public/api/tenderlist';
function decode(raw,page,day,previous=null,meta={}){
 const start=meta.start??page*100,size=meta.size??100;
 const data=JSON.parse(raw);if(!Array.isArray(data.data)||!Number.isSafeInteger(data.recordsTotal)||data.recordsFiltered!==data.recordsTotal)throw Error('Austria unfiltered index schema changed');
 if(data.data.length!==Math.min(size,Math.max(0,data.recordsTotal-start)))throw Error('Austria premature page end');
 const selected=[];let undated=0;
 for(let i=0;i<data.data.length;i++){
  const r=data.data[i];if(!Array.isArray(r)||r.length!==8||typeof r[4]!=='string'||!r[4]||typeof r[5]!=='boolean')throw Error('Austria row schema changed');
  const dates=(r[5]?[r[6],r[7]]:[r[3]]).filter(x=>x!==null&&x!=='');
  for(const d of dates)if(typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d)throw Error('Austria deadline schema changed');
  if(!dates.length)undated++;if(dates.some(d=>d>=day))selected.push(i);
 }
 return {data,selected,undated};
}
function save(file,s){fs.writeFileSync(file+'.tmp',JSON.stringify(s,null,2));fs.renameSync(file+'.tmp',file);}
function verifyIndex(dir,s){
 let received=0,undated=0,selected=0;const ids=new Set(),selectedIds=new Set();
 const read=p=>{if(path.basename(p.file)!==p.file)throw Error('Austria unsafe evidence path');const b=fs.readFileSync(path.join(dir,p.file));if(sha(b)!==p.sha256)throw Error('Austria evidence corrupt');return b;};
 for(let n=0;n<s.pages.length;n++){const p=s.pages[n];if(p.page!==n||(p.start??n*100)!==received)throw Error('Austria page sequence differs');const d=decode(read(p),n,s.day,null,p);received+=d.data.data.length;undated+=d.undated;selected+=d.selected.length;for(const r of d.data.data)ids.add(r[4]);for(const i of d.selected)selectedIds.add(d.data.data[i][4]);}
 if(received!==s.indexReceived||undated!==s.undated||selected!==s.received||ids.size!==s.uniqueIndexReceived||selectedIds.size!==s.uniqueReceived||s.page!==s.pages.length)throw Error('Austria index counters differ from source');
 if(s.traversalExhausted){if(s.probes.length!==1)throw Error('Austria final count evidence missing');const d=decode(read(s.probes[0]),0,s.day,null,s.probes[0]);if(d.data.recordsTotal!==s.finalTotal||s.indexCountReconciled!==(!s.inventoryChanged&&ids.size===s.finalTotal&&received===s.finalTotal))throw Error('Austria final count differs');}
 return {indexRows:received,uniqueIndexRows:ids.size,currentDeadlineRows:selected,undatedRows:undated,indexCountReconciled:s.indexCountReconciled||false};
}
async function collect(j,dir,{fetchPage,maxPages=3000}={}){
 const pageSize=j.indexPageSize??1000;if(!Number.isInteger(pageSize)||pageSize<100||pageSize>200000)throw Error('Austria invalid page size');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'state.json'),identity=sha(JSON.stringify(j));
 const s=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{identity,format:'austria-index-json',day:j.day,pages:[],probes:[],page:0,received:0,indexReceived:0,undated:0,total:null,state:'running',countBasis:'full-public-metadata-index-current-deadline-selection',scopeWarnings:['Full mixed-history metadata index scanned only to discover current deadlines; no tender detail or historical detail requests.','Missing deadlines, source changes, cancellation, amendments and bidding eligibility remain unresolved; candidates are not verified open tenders.']};
 if(s.identity!==identity)throw Error('Austria resume scope changed');
 const ids=new Set(),selectedIds=new Set();let count=0,index=0,undated=0;
 for(let n=0;n<s.pages.length;n++){const p=s.pages[n];if(p.page!==n||(p.start??n*100)!==index||path.basename(p.file)!==p.file)throw Error('Austria invalid checkpoint path/page');const raw=fs.readFileSync(path.join(dir,p.file));if(sha(raw)!==p.sha256)throw Error('Austria evidence corrupt');const d=decode(raw,n,j.day,null,p);if(JSON.stringify(d.selected)!==JSON.stringify(p.selectedRows))throw Error('Austria saved selection differs');count+=d.selected.length;index+=d.data.data.length;undated+=d.undated;for(const r of d.data.data)ids.add(r[4]);for(const i of d.selected)selectedIds.add(d.data.data[i][4]);}
 if(count!==s.received||index!==s.indexReceived||undated!==s.undated||s.page!==s.pages.length)throw Error('Austria checkpoint counters differ');if(s.traversalExhausted)return s;s.state='running';delete s.error;
 const persist=(raw,prefix)=>{const digest=sha(raw),name=prefix+'-'+digest+'.json';if(!fs.existsSync(path.join(dir,name)))fs.writeFileSync(path.join(dir,name),raw,{flag:'wx'});return {file:name,sha256:digest};};
 const urlFor=(start,size=pageSize)=>endpoint+'?'+new URLSearchParams({start:String(start),length:String(size),draw:'1',orderColumn:'2',orderDir:'asc'});
 try{let budget=0;while(budget++<maxPages){const start=s.indexReceived,size=pageSize,url=urlFor(start),raw=await fetchPage({url,init:{method:'GET'},minimumDelayMs:2000,maxContentLength:64*1024*1024}),evidence=persist(raw,'page-'+s.page),d=decode(raw,s.page,j.day,null,{start,size});
   if(s.total!==null&&s.total!==d.data.recordsTotal)s.inventoryChanged=true;s.total=d.data.recordsTotal;
   if(s.pages.some(p=>p.sha256===evidence.sha256))throw Error('Austria repeated index page');
   s.pages.push({...evidence,url,page:s.page,start,size,rows:d.selected.length,indexRows:d.data.data.length,selectedRows:d.selected,retrievedAt:raw.retrievedAt||new Date().toISOString()});s.received+=d.selected.length;s.indexReceived+=d.data.data.length;s.undated+=d.undated;
   for(const r of d.data.data)ids.add(r[4]);for(const i of d.selected)selectedIds.add(d.data.data[i][4]);s.uniqueIndexReceived=ids.size;s.uniqueReceived=selectedIds.size;s.duplicateSourceIds=s.received-selectedIds.size;s.page++;save(file,s);
   if(s.indexReceived>=s.total){const checkUrl=urlFor(0,1000),checkRaw=await fetchPage({url:checkUrl,init:{method:'GET'},minimumDelayMs:2000,maxContentLength:64*1024*1024}),p=persist(checkRaw,'final-count'),check=decode(checkRaw,0,j.day,null,{start:0,size:1000});s.probes.push({...p,start:0,size:1000,url:checkUrl,retrievedAt:new Date().toISOString()});s.finalTotal=check.data.recordsTotal;s.indexCountReconciled=!s.inventoryChanged&&ids.size===s.finalTotal&&s.indexReceived===s.finalTotal;s.traversalExhausted=true;s.state='partial';s.error='Metadata traversal finished; undated notices and native bidding status are not verified'+(s.indexCountReconciled?'':'; index changed or duplicate/missing identities observed');save(file,s);return s;}
  }throw Error('Austria page budget reached; resume');
 }catch(e){s.state='partial';s.error=String(e.message).split('\n')[0];save(file,s);return s;}
}
module.exports={decode,collect,verifyIndex};
