'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function request(after=0,size=100){
 const u=new URL('https://eojn.hr/api/searchgrid/TendersAll/get');
 u.search=new URLSearchParams({filter:JSON.stringify([[['TenderStatusId','=',2],'or',['TenderStatusId','=',7]],'and',['Id','>',after]]),skip:'0',take:String(size),sort:JSON.stringify([{selector:'Id',desc:false}])});
 return {url:u.href,init:{method:'GET'}};
}
function decode(raw,after,size=100){
 const d=JSON.parse(raw);if(!Array.isArray(d.data)||!Number.isInteger(d.totalCount)||d.totalCount<0||d.data.length!==Math.min(size,d.totalCount))throw Error('Croatian cursor response count/cap mismatch');
 let last=after;for(const r of d.data){if(!Number.isSafeInteger(r.Id)||r.Id<=last||![2,7].includes(r.TenderStatusId))throw Error('Croatian cursor identity/order/status mismatch');last=r.Id;}
 return {rows:d.data,total:d.totalCount,last};
}
function save(f,s){fs.writeFileSync(f+'.tmp',JSON.stringify(s,null,2));fs.renameSync(f+'.tmp',f);}
function verifyIndex(dir,s){
 let after=0,received=0,initial=null;const changes=[];
 for(const p of s.pages){
  if(path.basename(p.file)!==p.file)throw Error('Croatian evidence path invalid');
  const b=fs.readFileSync(path.join(dir,p.file));if(sha(b)!==p.sha256||p.after!==after||p.url!==request(after).url)throw Error('Croatian cursor evidence mismatch');
  const d=decode(b,after);if(p.rows!==d.rows.length||p.total!==d.total)throw Error('Croatian cursor counts differ');
  if(initial===null)initial=d.total;
  if(received+d.total!==initial)changes.push({page:s.pages.indexOf(p)+1,initialTotal:initial,observedCombinedTotal:received+d.total});
  received+=d.rows.length;after=d.last;
 }
 if(received!==s.received||after!==s.lastId||s.uniqueReceived!==received||JSON.stringify(changes)!==JSON.stringify(s.totalChanges))throw Error('Croatian cursor checkpoint differs');
 if(s.traversalExhausted){
  const last=s.pages.at(-1);if(!last||last.rows!==last.total)throw Error('Croatian cursor end not established');
  const p=s.probes.at(-1);if(!p||path.basename(p.file)!==p.file||p.url!==request().url)throw Error('Croatian final count evidence missing');
  const b=fs.readFileSync(path.join(dir,p.file));if(sha(b)!==p.sha256)throw Error('Croatian final count corrupt');
  const d=decode(b,0);if(d.total!==s.finalTotal||p.total!==d.total)throw Error('Croatian final count differs');
  const expected=received===initial&&received===d.total&&!changes.length?'reconciled':'partial';
  if(s.state!==expected)throw Error('Croatian completeness claim differs from evidence');
 }
 return {received,initialTotal:initial,finalTotal:s.finalTotal??null,traversalExhausted:!!s.traversalExhausted};
}
async function collect(j,dir,{maxPages=1000,fetchPage}={}){
 fs.mkdirSync(dir,{recursive:true});const f=path.join(dir,'state.json'),identity=sha(JSON.stringify(j));
 const s=fs.existsSync(f)?JSON.parse(fs.readFileSync(f)):{identity,format:'croatia-cursor-json',pages:[],probes:[],received:0,uniqueReceived:0,lastId:0,total:null,totalChanges:[],state:'running',countBasis:'reported-total-and-identity-cursor-with-final-count'};
 if(s.identity!==identity)throw Error('Croatian cursor resume scope changed');verifyIndex(dir,s);if(s.traversalExhausted)return s;
 async function work(fetchPage){
  async function get(after,prefix){const req=request(after),b=await fetchPage(req);if(b.length>32*1024*1024)throw Error('Croatian response size exceeded');const digest=sha(b),file=prefix+'-'+digest+'.json';if(!fs.existsSync(path.join(dir,file)))fs.writeFileSync(path.join(dir,file),b,{flag:'wx'});const d=decode(b,after);return {d,e:{file,sha256:digest,url:req.url,after,rows:d.rows.length,total:d.total,retrievedAt:new Date().toISOString()}};}
  try{
   s.state='running';delete s.error;
   for(let n=0;n<maxPages;n++){
    const {d,e}=await get(s.lastId,'page');if(s.total===null)s.total=d.total;
    if(s.received+d.total!==s.total)s.totalChanges.push({page:s.pages.length+1,initialTotal:s.total,observedCombinedTotal:s.received+d.total});
    s.pages.push(e);s.received+=d.rows.length;s.uniqueReceived=s.received;s.lastId=d.last;save(f,s);
    if(d.rows.length===d.total){
     const final=await get(0,'final-count');s.probes.push(final.e);s.finalTotal=final.d.total;s.traversalExhausted=true;
     s.state=s.received===s.total&&s.received===s.finalTotal&&!s.totalChanges.length?'reconciled':'partial';
     s.error=s.state==='partial'?'Cursor traversal finished but the live inventory changed; completeness remains partial':null;save(f,s);verifyIndex(dir,s);return s;
    }
   }
   s.state='partial';s.error='Croatian cursor page budget reached; resume';save(f,s);return s;
  }catch(e){s.state='partial';s.error=String(e.message).split('\n')[0];save(f,s);return s;}
 }
 if(fetchPage)return work(fetchPage);
 return require('./croatia-intake.cjs').collect(j,dir,{size:100,maxPages,collectPages:async(_j,_dir,options)=>work(options.fetchPage)});
}
module.exports={request,decode,collect,verifyIndex};
