'use strict';
const fs=require('fs'),path=require('path'),zlib=require('zlib'),crypto=require('crypto'),{dateWindows}=require('./native-portals.cjs'),{writeJSON}=require('./greece-files.cjs');
function retryDelay(header,now=Date.now()){const value=String(header||'').trim(),seconds=/^\d+$/.test(value)?Number(value):NaN,date=Date.parse(value);return Math.max(60000,Number.isFinite(seconds)?seconds*1000:Number.isFinite(date)?date-now:60000);}
async function collectExtra(run,asOf){fs.mkdirSync(run,{recursive:true});const cp=path.join(run,'checkpoint.json'),s=fs.existsSync(cp)?JSON.parse(fs.readFileSync(cp)):{asOf,pages:{},queries:{}};if(s.asOf!==asOf)throw Error('Resume date mismatch');
let nextRequestAt=0;
async function get(key,payload){
 if(s.pages[key]){const p=s.pages[key],b=fs.readFileSync(p.file);if(crypto.createHash('sha256').update(b).digest('hex')!==p.sha256)throw Error('Checksum mismatch');return JSON.parse(zlib.gunzipSync(b));}
 const page=Number(key.split(':').at(-1)),url='https://cerpp.eprocurement.gov.gr/khmdhs-opendata/notice?page='+page;let last;
 for(let i=0;i<3;i++){
  try{
   await new Promise(r=>setTimeout(r,Math.max(0,nextRequestAt-Date.now())));nextRequestAt=Date.now()+3000;
   const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(45000)});
   if(r.status===429){const error=Error('HTTP 429: public portal rate limit');error.retryAfterMs=retryDelay(r.headers.get('retry-after'));await r.body?.cancel();throw error;}
   const d=await r.json();if(!r.ok&&!(r.status===404&&d.message==='No notices found for the given criteria'))throw Error('HTTP '+r.status+' '+d.message);
   const b=zlib.gzipSync(JSON.stringify(d)),file=path.join(run,crypto.createHash('sha256').update(key).digest('hex')+'.json.gz');fs.writeFileSync(file,b);s.pages[key]={file,sha256:crypto.createHash('sha256').update(b).digest('hex'),url,payload};writeJSON(cp,s);return d;
  }catch(e){last=e;if(i===2)break;const delay=e.retryAfterMs||1500*(i+1);if(delay>600000)throw Error('Portal requested a cooldown longer than ten minutes; preserve checkpoint and retry later. Delay milliseconds: '+delay);if(e.retryAfterMs)console.log('Portal rate limit: respecting cooldown of '+Math.ceil(delay/1000)+' seconds');await new Promise(r=>setTimeout(r,delay));}
 }
 throw last;
}

const cpvs=['34712000-0','34712100-1','34712200-2','35631000-7','35631100-8','35631200-9','35631300-0','32531000-4','32532000-1','32533000-8','32534000-5','32530000-7','38112100-4','38115000-0','71354200-6','71354100-5','72316000-3','64214100-0'];
async function query(kind,filters,range){const key=kind+':'+range.from+':'+range.to;if(s.queries[key]?.complete)return;let total,count=0,ids=new Set(),totals=[];for(let page=0;;page++){let d=await get(key+':'+page,{...filters,dateFrom:range.from,dateTo:range.to});if(d.message==='No notices found for the given criteria')d={content:[],totalElements:0,last:true};if(!Array.isArray(d.content)||!Number.isInteger(d.totalElements))throw Error('Invalid response');total??=d.totalElements;totals.push(d.totalElements);for(const x of d.content){if(x.submissionDate.slice(0,10)<range.from||x.submissionDate.slice(0,10)>range.to)throw Error('Date filter mismatch');if(kind==='ongoing'&&x.finalSubmissionDate.slice(0,10)<asOf)throw Error('Deadline filter mismatch');if(kind==='space-center'&&x.organization?.key!=='100062923')throw Error('Buyer filter mismatch');ids.add(x.referenceNumber);}count+=d.content.length;if(d.last)break;if(!d.content.length||page>10000)throw Error('Pagination stalled');if(page%20===0)console.log(key,page,count,total);}
 if(totals.some(n=>n!==total)||total!==count||ids.size!==total){if(range.from===range.to)throw Error('Single-day count mismatch '+key);const first=Date.parse(range.from),last=Date.parse(range.to),mid=first+Math.floor((last-first)/86400000/2)*86400000;const left={from:range.from,to:new Date(mid).toISOString().slice(0,10)},right={from:new Date(mid+86400000).toISOString().slice(0,10),to:range.to};s.queries[key]={complete:false,subdivided:true,reportedTotals:totals,observed:ids.size};writeJSON(cp,s);await query(kind,filters,left);await query(kind,filters,right);s.queries[key]={...s.queries[key],complete:true,children:[kind+':'+left.from+':'+left.to,kind+':'+right.from+':'+right.to],total:s.queries[kind+':'+left.from+':'+left.to].total+s.queries[kind+':'+right.from+':'+right.to].total};}else s.queries[key]={complete:true,total};writeJSON(cp,s);console.log('DONE',key,s.queries[key].total);}
for(const [kind,filters]of [['ongoing',{finalDateFrom:asOf+' 00:00'}],['space-categories',{cpvItems:cpvs}],['space-center',{organizations:['100062923']}],['research-buyers',{organizations:['50067','99220979','99221129']}]])for(const range of dateWindows(kind==='ongoing'?'2020-01-01':require('../../daily/scope.cjs').from(),asOf))await query(kind,filters,range);
return s;}
if(require.main===module)collectExtra(path.resolve(process.argv[2]),process.argv[3]).catch(e=>{console.error(e.stack);process.exitCode=1});module.exports={collectExtra,retryDelay};
