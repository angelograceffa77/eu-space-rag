'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function save(f,s){fs.writeFileSync(f+'.tmp',JSON.stringify(s,null,2));fs.renameSync(f+'.tmp',f);}
const localDay=r=>{const d=new Date(r.publicationDate);if(!Number.isFinite(d.getTime()))throw Error('Missing German publication date');return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);};
function key(r){if(!r.noticeIdentifier||!r.noticeVersion||!r.lotIdentifier)throw Error('Missing German identity');return JSON.stringify([r.noticeIdentifier,r.noticeVersion,r.lotIdentifier]);}
function request(part,size=100){return {url:'https://oeffentlichevergabe.de/bkmk/searches',init:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({SELECT:'ALL',WHERE:[{fields:['active'],operator:'=',operands:[true]},...(part.from?[{fields:['publicationDate'],operator:'>=',operands:[part.from]},{fields:['publicationDate'],operator:'<',operands:[part.to]}]:[])],FROM:'lots',PAGE:{number:part.page||0,size},ORDER:{field:'publicationDate',direction:'ASC'}})}};}
async function collect(j,dir,{fetchPage,maxPages=1000,size=100,partitionLimit=9000}={}){
 fs.mkdirSync(dir,{recursive:true});const f=path.join(dir,'state.json'),identity=sha(JSON.stringify({j,version:1,size,partitionLimit}));let s=fs.existsSync(f)?JSON.parse(fs.readFileSync(f)):{identity,pages:[],splits:[],queue:[{page:0}],received:0,total:null,state:'running'};if(s.identity!==identity)throw Error('German partition scope changed');const ids=new Set();let verified=0;
 for(const p of [...s.splits,...s.pages]){if(path.basename(p.file)!==p.file)throw Error('Invalid evidence path');const raw=fs.readFileSync(path.join(dir,p.file));if(sha(raw)!==p.sha256)throw Error('German evidence corrupt');if(s.pages.includes(p)){const d=JSON.parse(raw);if(d.elements.length!==p.rows||d.offset!==p.partition.page*size||d.totalElements!==p.total)throw Error('German checkpoint page mismatch');verified+=d.elements.length;for(const r of d.elements){const k=key(r);if(ids.has(k))throw Error('Duplicate stored German lot');ids.add(k);}}}
 if(verified!==s.received||s.state==='reconciled'&&(s.queue.length||s.received!==s.total))throw Error('German checkpoint counters mismatch');if(s.state==='reconciled')return s;
 try{s.state='running';delete s.error;save(f,s);for(let n=0;s.queue.length&&n<maxPages;n++){
  const part=s.queue[0],req=request(part,size),raw=await fetchPage(req),digest=sha(raw),file='part-'+sha(JSON.stringify(part)).slice(0,12)+'-'+digest+'.json';if(!fs.existsSync(path.join(dir,file)))fs.writeFileSync(path.join(dir,file),raw,{flag:'wx'});const d=JSON.parse(raw),rows=d.elements,total=d.totalElements;
  if(!Array.isArray(rows)||!Number.isInteger(total)||total<0||d.offset!==part.page*size||rows.length!==Math.min(size,Math.max(0,total-d.offset)))throw Error('German schema/offset/count mismatch');
  if(!part.from)s.total=total;
  if(part.expected!==undefined&&part.expected!==total)throw Error('German partition total changed; retain evidence and start a new snapshot');
  if(total>partitionLimit){const from=part.from||localDay(rows[0]),to=part.to||new Date(Date.parse(j.day)+86400000).toISOString().slice(0,10);const days=(Date.parse(to)-Date.parse(from))/86400000;if(!Number.isFinite(days)||days<=1)throw Error('German daily result window requires additional partitioning');const mid=new Date(Date.parse(from)+Math.floor(days/2)*86400000).toISOString().slice(0,10);s.splits.push({file,sha256:digest,total,partition:{...part}});s.queue.splice(0,1,{from,to:mid,page:0},{from:mid,to,page:0});save(f,s);continue;}
  for(const r of rows){const date=localDay(r);if(part.from&&(!date||date<part.from||date>=part.to))throw Error('German partition not honoured');const k=key(r);if(ids.has(k))throw Error('Duplicate German lot across pages or partitions');ids.add(k);}
  s.pages.push({file,sha256:digest,rows:rows.length,total,partition:{...part},url:req.url,retrievedAt:new Date().toISOString()});s.received+=rows.length;
  if((part.page+1)*size>=total)s.queue.shift();else{part.page++;part.expected=total;}save(f,s);
 }
 s.state=s.queue.length?'partial':s.received===s.total?'reconciled':'partial';if(s.state==='reconciled')delete s.error;else s.error=s.queue.length?'Partition page budget reached; resume':'Partition union differs from unrestricted active count; start a new snapshot and retain this evidence';save(f,s);return s;
 }catch(e){s.state='partial';s.error=e.message;save(f,s);return s;}
}
module.exports={collect,request,key,localDay};
