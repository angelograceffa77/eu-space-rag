'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {registry,command}=require('./registry.cjs'),{runProcess}=require('./process.cjs'),{records,read}=require('./jsonl.cjs');
const {write}=require('./atomic-state.cjs');
const digest=async file=>{const h=crypto.createHash('sha256');for await(const c of fs.createReadStream(file))h.update(c);return h.digest('hex');};
function options(argv,root){const o={root,group:'all',timeoutMs:4*3600000,asOf:new Date().toISOString().slice(0,10),from:'2020-01-01',list:false,resume:false,consolidate:true};for(const a of argv){if(a==='--daily'){o.daily=true;continue;}if(a==='--list'){o.list=true;continue;}if(a==='--no-consolidate'){o.consolidate=false;continue;}if(a==='--resume'){o.resume=true;continue;}const m=a.match(/^--(run-dir|only|group|timeout-ms|as-of|from)=(.+)$/);if(!m)throw Error('Unknown argument: '+a);o[{'run-dir':'runDir','timeout-ms':'timeoutMs','as-of':'asOf'}[m[1]]||m[1]]=m[2];}o.timeoutMs=Number(o.timeoutMs);if(!Number.isFinite(o.timeoutMs)||o.timeoutMs<1000)throw Error('timeout-ms must be >=1000');if(!['all','national','standalone'].includes(o.group))throw Error('Invalid group');for(const k of ['from','asOf'])if(!/^\d{4}-\d{2}-\d{2}$/.test(o[k])||!Number.isFinite(Date.parse(o[k]))||new Date(o[k]).toISOString().slice(0,10)!==o[k])throw Error('Invalid date '+k);if(o.from<'2020-01-01'||o.from>o.asOf)throw Error('Invalid date range');if(o.resume&&!o.runDir)throw Error('--resume requires --run-dir');o.runDir=path.resolve(o.runDir||path.join(root,'.procurement-runs',new Date().toISOString().replace(/[:.]/g,'-')));return o;}
function select(jobs,o){let selected=jobs.filter(j=>o.group==='all'||(o.group==='national')===(j.kind!=='standalone'));if(o.only){const wanted=new Set(o.only.split(','));selected=selected.filter(j=>wanted.has(j.id));if(selected.length!==wanted.size)throw Error('Unknown or excluded job in --only');}if(!selected.length)throw Error('No jobs selected');return selected;}
function files(dir,depth=0){if(!fs.existsSync(dir))return [];return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isFile()?[path.join(dir,e.name)]:depth<1?files(path.join(dir,e.name),depth+1):[]);}
function seed(job,c,root){if(job.kind!=='dedicated')return;const original=path.join(root,'EU27','National-Portals','final-output',job.name);if(!fs.existsSync(original))return;const prior=fs.readdirSync(original).filter(n=>/_HISTORY\.jsonl$/.test(n)).sort().at(-1);if(!prior)return;const dest=path.join(c.output,job.name,prior);fs.mkdirSync(path.dirname(dest),{recursive:true});if(!fs.existsSync(dest))fs.copyFileSync(path.join(original,prior),dest,fs.constants.COPYFILE_EXCL);}
async function assess(job,c,startedAt,before={}){let output=c.output;if(job.kind==='national'){const cp=path.join(c.raw,'checkpoint.json');if(!fs.existsSync(cp))throw Error('No collection checkpoint');const checkpoint=JSON.parse(fs.readFileSync(cp));output=path.join(c.raw,checkpoint.runId);}
const candidates=files(output).filter(f=>/\.(jsonl|csv|xlsx|json)$/i.test(f)&&!/(checkpoint|cache)/i.test(path.basename(f))&&fs.statSync(f).mtimeMs>=startedAt-1000&&before[f]!==fs.statSync(f).size+':'+fs.statSync(f).mtimeMs);
if(!candidates.some(f=>/\.(jsonl|csv|xlsx)$/i.test(f)))throw Error('No new substantive output files found');
const hashes=[];let rowCount=0;for(const f of candidates){let count=null;if(f.endsWith('.jsonl')){count=0;for await(const r of records(f)){if(!r||typeof r!=='object')throw Error('Non-object JSONL record');count++;}rowCount+=count;}hashes.push({file:f,bytes:fs.statSync(f).size,sha256:await digest(f),rows:count});}
const history=candidates.filter(f=>/_HISTORY\.jsonl$/.test(f)).sort((a,b)=>a.split(path.sep).length-b.split(path.sep).length)[0];let coverage=[];if(history){const cf=history.replace('_HISTORY','_COVERAGE');if(fs.existsSync(cf))coverage=await read(cf);}
const currentSourceChecks=require('./source-health.cjs').sourceHealth(candidates),currentGaps=currentSourceChecks.filter(c=>c.state!=='collected'||c.cached===true||c.error);
const bad=coverage.filter(c=>['failed','blocked','running'].includes(c.state));const gaps=coverage.filter(c=>!['complete','collected'].includes(c.state)||(c.gaps||[]).length||c.error);
return {state:bad.length?'failed':currentGaps.length?'partial':coverage.length?(gaps.length?'partial':'validated'):'unassessed',currentSourceChecks,coverage:coverage.map(c=>({sourceId:c.sourceId,state:c.state,error:c.error||'',gaps:c.gaps||[]})),outputs:hashes,history:history||null,coverageFile:history&&fs.existsSync(history.replace('_HISTORY','_COVERAGE'))?history.replace('_HISTORY','_COVERAGE'):null,warning:coverage.length?null:'Output files checksummed and JSONL parsed; source completeness is not independently established.',rowCount};}
async function run(o,dependencies={}){const jobs=select(dependencies.jobs||registry(o.root),o);if(o.list){console.log(JSON.stringify(jobs,null,2));return {jobs};}fs.mkdirSync(o.runDir,{recursive:true});const stateFile=path.join(o.runDir,'run-state.json'),lock=path.join(o.runDir,'.coordinator.lock');let fd;try{fd=fs.openSync(lock,'wx');fs.writeSync(fd,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));fs.closeSync(fd);}catch{throw Error('Run is locked. Verify the previous process has stopped before manually removing '+lock);}
let state;try{if(fs.existsSync(stateFile)){if(!o.resume)throw Error('Existing run requires --resume');state=JSON.parse(fs.readFileSync(stateFile));if(JSON.stringify(state.jobIds)!==JSON.stringify(jobs.map(j=>j.id)))throw Error('Resume job selection differs');o.asOf=state.asOf;o.from=state.from;}else{if(o.resume)throw Error('No run-state.json to resume');state={schemaVersion:1,startedAt:new Date().toISOString(),asOf:o.asOf,from:o.from,daily:!!o.daily,jobIds:jobs.map(j=>j.id),jobs:{},status:'running'};write(stateFile,state);}
for(const job of jobs){
 const old=state.jobs[job.id];if(old&&['validated','partial','unassessed'].includes(old.state))continue;
 const startedAt=Date.now(),attempt=(old?.attempt||0)+1;
 const record=state.jobs[job.id]={state:'running',startedAt:new Date(startedAt).toISOString(),entry:job.entry,attempt};
 write(stateFile,state);console.log('Starting '+job.id);
 try{
  const c=command(job,{...o,resume:o.resume||!!old,attempt}),sourceHash=await digest(job.entry);
  record.sourceHash=sourceHash;record.args=c.args;
  if(old?.sourceHash&&old.sourceHash!==sourceHash)throw Error('Collector changed since interrupted run; start a new run: '+job.id);
  fs.mkdirSync(c.output,{recursive:true});
  if(old?.process?.pid)for(const lockDir of [c.raw,path.join(c.raw,'live')]){
   const lockFile=path.join(lockDir,'.collection.lock');
   if(fs.existsSync(lockFile)&&Number(fs.readFileSync(lockFile,'utf8'))===old.process.pid){
    let alive=true;try{process.kill(old.process.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}
    if(alive)throw Error('Previous collector still alive; refusing to clear its lock');
    fs.renameSync(lockFile,lockFile+'.retired-'+Date.now());
   }
  }
  seed(job,c,o.root);const before=Object.fromEntries([...files(c.output),...files(c.raw)].map(f=>[f,fs.statSync(f).size+':'+fs.statSync(f).mtimeMs]));write(stateFile,state);
  const result=await (dependencies.execute||runProcess)(job.entry,c.args,{cwd:path.dirname(job.entry),env:c.env,timeoutMs:o.timeoutMs,logFile:path.join(c.work,'attempt-'+attempt+'.log')});
  record.process=result;
  if(result.error||result.code!==0||result.timedOut)throw Error(result.timedOut?'Collector exceeded time limit; checkpoint retained':result.error||'Collector exited '+result.code);
  Object.assign(record,await assess(job,c,startedAt,before));
 }catch(e){record.state=record.process?.timedOut?'timed_out':'failed';record.error=e.message;}
 record.finishedAt=new Date().toISOString();write(stateFile,state);console.log(job.id+': '+record.state);
}
const inputs=Object.values(state.jobs).filter(j=>j.history).map(j=>({history:j.history,coverage:j.coverageFile}));if(o.consolidate&&inputs.length){const config={root:o.root,baselineDir:path.join(o.root,'EU27','National-Portals','final-output'),inputs,output:path.join(o.runDir,'national-consolidated'),asOf:o.asOf,countries:false};const cf=path.join(o.runDir,'consolidation-config.json');write(cf,config);const result=await (dependencies.execute||runProcess)(path.join(__dirname,'consolidate.cjs'),[cf],{cwd:o.root,timeoutMs:o.timeoutMs,logFile:path.join(o.runDir,'consolidation.log')});state.consolidation={...result,output:config.output,state:result.code===0&&!result.timedOut?'validated':'failed'};}
const bad=Object.values(state.jobs).some(j=>['failed','timed_out','running'].includes(j.state))||state.consolidation?.state==='failed';state.status=bad?'partial-failure':Object.values(state.jobs).some(j=>j.state!=='validated')?'partial':'validated';state.finishedAt=new Date().toISOString();write(stateFile,state);console.log(JSON.stringify({status:state.status,runDir:o.runDir,jobs:Object.fromEntries(Object.entries(state.jobs).map(([k,v])=>[k,v.state]))},null,2));return state;
}finally{fs.unlinkSync(lock);}}
module.exports={run,options,select,assess,digest};
