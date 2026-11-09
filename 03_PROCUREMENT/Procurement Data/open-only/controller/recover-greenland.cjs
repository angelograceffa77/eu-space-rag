'use strict';
const fs=require('fs'),path=require('path');
async function recover({state,day,root,writeState}){
 if(state.discoveryDir)return state.discoveryDir;
 const original=path.join(state.runDir,'discovery'),id='national-GL-BusinessInGreenland-current',f=path.join(original,id,'state.json');
 if(!fs.existsSync(path.join(original,'candidates/manifest.json'))||!fs.existsSync(f))return original;
 const old=JSON.parse(fs.readFileSync(f));
 if(old.error!=='Greenland current inventory pagination/count requires qualification'||old.total!==null||old.pages.length!==0)return original;
 // Exported evidence is immutable. Collect only the failed source into a new
 // snapshot and assemble same-day sources with their original signed hashes.
 const repair=path.join(state.runDir,'greenland-pagination-recovery'),output=path.join(state.runDir,'discovery-paginated');
 if(!fs.existsSync(path.join(output,'validation.json'))){
  await require('./intake.cjs').run({dir:repair,day,root,only:[id],workers:1});
  const repaired=JSON.parse(fs.readFileSync(path.join(repair,'manifest.json')));
  if(repaired.jobs[id]?.state!=='reconciled')throw Error('Greenland pagination recovery incomplete: '+repaired.jobs[id]?.error);
  const prior=JSON.parse(fs.readFileSync(path.join(original,'manifest.json'))),selection=Object.fromEntries(Object.keys(prior.jobs).map(job=>[job,job===id?repair:original]));
  require('./assemble-discovery.cjs').assemble({selection,output,day,expectedJobs:Object.keys(prior.jobs)});
 }
 require('./verify-candidates.cjs').verify(output);
 state.discoveryDir=output;state.greenlandRecovery={original,replacement:repair,assembled:output,recoveredAt:new Date().toISOString()};writeState();return output;
}
module.exports={recover};
