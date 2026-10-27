'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process');
function run(){const root=path.resolve(__dirname,'..'),repo=path.resolve(root,'../..'),archive=path.join(require('../daily/config.json').archiveRoot,'Planned-and-Awarded/Annual-Lists'),stateFile=path.join(archive,'refresh-state.json');fs.mkdirSync(archive,{recursive:true});
 const old=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile)):null;if(old?.status==='complete'&&Date.now()-Date.parse(old.completedAt)<30*86400000)return old;
 const release=require('../open-only/controller/run-lock.cjs').acquire(path.join(archive,'.annual.lock'));
 try{const python=JSON.parse(fs.readFileSync(path.join(repo,'05_COMPANIES/Periodic-Refresh/policy.json'))).python;
 cp.execFileSync(python,[path.join(__dirname,'annual_award_evidence.py')],{windowsHide:true,stdio:'inherit'});
 const coverage=JSON.parse(fs.readFileSync(path.join(__dirname,'annual-list-coverage.json')));
 if(coverage.traversalBoundReached||coverage.sources.some(s=>s.status==='failed')||!coverage.sources.some(s=>s.status==='downloaded_document'))throw Error('Annual source traversal incomplete; previous disclosures retained');
 const sources=[];for(const e of fs.readdirSync(archive,{withFileTypes:true})){if(!e.isDirectory()||e.isSymbolicLink())continue;const f=path.join(archive,e.name,'receipt.json');if(fs.existsSync(f))sources.push(...JSON.parse(fs.readFileSync(f)).sources);}
 const receipt=path.join(archive,'combined-'+Date.now()+'.json');fs.writeFileSync(receipt,JSON.stringify({sources,complete:false}),{flag:'wx'});
 cp.execFileSync(python,[path.join(__dirname,'annual_disclosures.py'),'--receipt',receipt,'--output',path.join(root,'Lifecycle-Data/Awarded-Contracts/annual-disclosures')],{windowsHide:true,stdio:'inherit'});
 const result={status:'complete',completedAt:new Date().toISOString(),receipt,coverage:'partial_EEA_EDA_annual_disclosures_not_all_authorities'};require('../orchestration/atomic-state.cjs').write(stateFile,result);return result;
 }finally{release();}}
module.exports={run};if(require.main===module)run();
