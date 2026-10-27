'use strict';
// One resumable six-calendar-month job; publication is the final validated step.
const fs=require('fs'),path=require('path'),cp=require('child_process');
const root=path.resolve(__dirname,'..','..'),home=__dirname;
const archive=path.join(path.dirname(root),'05_COMPANIES','Periodic-Refresh');
function read(p,d=null){return fs.existsSync(p)?JSON.parse(fs.readFileSync(p)):d;}
function save(p,x){fs.mkdirSync(path.dirname(p),{recursive:true});require(path.join(root,'03_PROCUREMENT/Procurement Data/orchestration/atomic-state.cjs')).write(p,x);}
function plusSix(value){const d=new Date(value),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+6);const end=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,end));return d.toISOString();}
function conflicts(){return [path.join(root,'03_PROCUREMENT/Procurement Data/daily/.daily.lock'),path.join(root,'04_FUNDING/funding data/00_Control/local-state/daily.lock'),path.join(root,'04_FUNDING/funding data/01_Daily-Update/daily.lock'),path.join(root,'05_COMPANIES/Private-Client-Discovery/refresh.lock'),path.join(path.dirname(root),'05_COMPANIES/Investment-Discovery/collection.lock')].filter(p=>fs.existsSync(p));}
async function main(){const policy=read(path.join(home,'policy.json'));if(!policy?.enabled)throw Error('Periodic refresh disabled');if(conflicts().length)throw Error('Other collection active: '+conflicts().join(', '));
 const lock=path.join(home,'refresh.lock');if(fs.existsSync(lock)){const owner=read(lock);try{process.kill(owner.pid,0);throw Error('Periodic refresh already running');}catch(e){if(e.code!=='ESRCH')throw e;}fs.mkdirSync(archive,{recursive:true});fs.renameSync(lock,path.join(archive,'interrupted-lock-'+Date.now()+'.json'));}const fd=fs.openSync(lock,'wx');fs.writeFileSync(fd,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));fs.closeSync(fd);
 let state=read(path.join(archive,'state.json'),{});try{if(state.status==='completed'&&Date.now()<Date.parse(state.nextDueAt.slice(0,10))&&!process.argv.includes('--force')){console.log('Not due until '+state.nextDueAt);return;}
 if(!state.runId||state.status==='completed')state={runId:new Date().toISOString().replace(/[:.]/g,'-'),steps:{}};
 state.status='running';delete state.error;save(path.join(archive,'state.json'),state);const run=path.join(archive,'Runs',state.runId);fs.mkdirSync(run,{recursive:true});
 const python=policy.python;
 function step(name,exe,args,env={}){if(state.steps[name]?.status==='completed')return;const logfile=path.join(run,name+'.log'),out=fs.openSync(logfile,'a');state.currentStep=name;save(path.join(archive,'state.json'),state);const result=cp.spawnSync(exe,args,{cwd:root,env:{...process.env,...env},stdio:['ignore',out,out],windowsHide:true});fs.closeSync(out);if(result.error||result.status!==0)throw Error(name+' failed; see '+logfile+' '+(result.error||result.status));state.steps[name]={status:'completed',at:new Date().toISOString(),log:logfile};save(path.join(archive,'state.json'),state);}
 step('scope',process.execPath,[path.join(home,'scope.cjs'),root,path.join(home,'procurement-scope.json')]);
 let esa;
 for(;;){const attempt=state.companyAttempt||1;esa=path.join(run,attempt===1?'ESA-Companies':'ESA-Companies-attempt-'+attempt);fs.mkdirSync(esa,{recursive:true});
  try{step('companies',process.execPath,['--use-system-ca','--max-old-space-size=8192',path.join(root,'05_COMPANIES/esa-companies.js')],{ESA_OUTPUT_DIR:esa});break;}
  catch(e){const log=fs.readFileSync(path.join(run,'companies.log'),'utf8').slice(-3000);if(attempt>=3||!/changed during download|fresh attempt required|duplicate profile IDs/.test(log))throw e;state.companyAttempt=attempt+1;state.preservedFailedCompanyAttempts=attempt;save(path.join(archive,'state.json'),state);}
 }
 step('promote-companies',python,[path.join(home,'publish.py'),'promote-esa','--source',esa]);
 step('investment',process.execPath,['--use-system-ca','--max-old-space-size=8192',path.join(root,'05_COMPANIES/Investment-Discovery/01_Collectors/collect.cjs')]);
 step('investment-validation',process.execPath,[path.join(root,'05_COMPANIES/Investment-Discovery/01_Collectors/validate.cjs')]);
 step('country-discovery',python,[path.join(home,'country_clients.py'),'--scope',path.join(home,'procurement-scope.json'),'--archive',path.join(path.dirname(root),'05_COMPANIES/Country-Discovery'),'--output',home,'--run-id',state.runId]);
 step('clients','powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'05_COMPANIES/Private-Client-Discovery/01_Collectors/refresh.ps1'),'-Python',python,'-Node',process.execPath]);
 step('clients-validation',python,[path.join(root,'05_COMPANIES/Private-Client-Discovery/01_Collectors/clients.py'),'validate','--root',path.join(root,'05_COMPANIES/Private-Client-Discovery')]);
 if(!process.argv.includes('--publish'))throw Error('Validation complete; --publish required to finish authorized workflow');
 step('publication',python,[path.join(home,'publish.py'),'publish']);state.status='completed';state.completedAt=new Date().toISOString();state.nextDueAt=plusSix(state.completedAt);save(path.join(archive,'state.json'),state);save(path.join(run,'completion.json'),state);console.log(JSON.stringify(state));
 }catch(e){state.status='held';state.error=e.stack;save(path.join(archive,'state.json'),state);throw e;}finally{fs.unlinkSync(lock);}}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
module.exports={plusSix,conflicts};
