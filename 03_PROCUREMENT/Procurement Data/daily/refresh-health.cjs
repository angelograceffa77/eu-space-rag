'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function evaluate(previous,attempt){
 const days={...(previous?.days||{})},old=days[attempt.day];
 const success=attempt.outcome==='published';
 const failed=attempt.outcome==='held';
 const uncertainty=attempt.awaitingRecheck??null;
 const day={...attempt,attempts:(old?.attempts||0)+1};days[attempt.day]=day;
 const ordered=Object.keys(days).sort().reverse();let failureDays=0;
 for(const key of ordered){if(days[key].outcome!=='held')break;failureDays++;}
 const prior=previous?.latest;
 const grew=failed&&uncertainty!==null&&prior?.awaitingRecheck!==undefined&&prior.awaitingRecheck!==null&&uncertainty>prior.awaitingRecheck;
 const changed=failed&&(!prior||prior.outcome!=='held'||prior.error!==attempt.error);
 const repeated=failed&&(failureDays>=2||day.attempts>=2);
 const lastSuccessfulPublication=success?attempt.publication:previous?.lastSuccessfulPublication||attempt.retainedPublication||null;
 const alerts=[];
 if(changed)alerts.push('new_or_changed_failure');if(grew)alerts.push('growing_uncertainty');if(repeated)alerts.push('repeated_failure');
 const newAlert=alerts.some(a=>!previous?.alerts?.includes(a))||changed||grew;
 return {schemaVersion:1,workflow:attempt.workflow,latest:day,days,lastSuccessfulPublication,consecutiveFailureDays:failureDays,alerts,notify:success?!!attempt.materialChange:failed&&newAlert,meaning:'A refresh attempt is separate from a successful publication. Awaiting-recheck records never count as verified open.'};
}
function atomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2)+'\n');for(let n=0;;n++)try{fs.renameSync(tmp,file);break;}catch(e){if(!['EPERM','EBUSY','EACCES'].includes(e.code)||n>=19)throw e;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100);}}
function publishedMaster(masterRoot){const ptr=JSON.parse(fs.readFileSync(path.join(masterRoot,'manifest.json'))),file=ptr.manifest?path.resolve(masterRoot,ptr.manifest):path.resolve(masterRoot,ptr.path,'manifest.json');if(!file.startsWith(path.resolve(masterRoot)+path.sep))throw Error('Master path escapes package');const raw=fs.readFileSync(file);if(sha(raw)!==ptr.manifestSha256)throw Error('Master manifest checksum mismatch');const m=JSON.parse(raw);return {generation:ptr.generation,snapshotAsOf:m.asOf||null,summary:m.summary||m.counts||null,publishedAt:null};}
function record({workflow,stateFile,archiveRoot,masterRoot,result,error=null,now=new Date().toISOString()}){
 if(!['procurement','funding'].includes(workflow))throw Error('Unknown workflow');
 const ok=['published','complete'].includes(result.status)&&!!result.publication&&!result.error;
 if(!ok&&result.status!=='held')return null;
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Budapest',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
 const previous=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile)):null;
 const master=publishedMaster(masterRoot),reason=error?.message||result.error||null;
 const pending=result.summary?.awaitingRecheck??Number(reason?.match(/funding checks: (\d+)/)?.[1]||NaN);
 const unchanged=result.publication?.unchanged||result.publication?.status==='unchanged';
 const publication=ok?(unchanged?(previous?.lastSuccessfulPublication?.generation===master.generation?previous.lastSuccessfulPublication:{...master,commit:result.publication.commit||null,publishedAt:null,verifiedAt:now}):{...master,commit:result.publication.commit||null,publishedAt:result.publication.verifiedAt||result.publication.publishedAt||result.finishedAt||now}):null;
 const attempt={workflow,day,attemptedAt:now,startedAt:result.startedAt||null,outcome:ok?'published':'held',error:reason,awaitingRecheck:Number.isFinite(pending)?pending:null,publication,retainedPublication:master,materialChange:!!result.changes?.materialChange||!!result.publication?.published||previous?.lastSuccessfulPublication?.generation!==master.generation,coverage:'partial unless independently documented otherwise'};
 const health=evaluate(previous,attempt);
 const receipt=path.join(archiveRoot,'_daily-refresh-status',workflow,day,now.replace(/[:.]/g,'-')+'-'+crypto.randomUUID()+'.json');atomic(receipt,health);atomic(stateFile,{...health,receipt});return health;
}
module.exports={evaluate,record,publishedMaster};
