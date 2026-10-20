#!/usr/bin/env node
'use strict';
if(require.main===module&&require('./open-only/policy.cjs').load(__dirname)?.dailyMode==='open-space-v1')throw Error('Legacy collection/build is disabled for the open-space master. Use node --use-system-ca --max-old-space-size=8192 daily/daily.cjs --publish.');
const path=require('node:path'),{run,options}=require('./orchestration/coordinator.cjs'),{build}=require('./master/build.cjs');
async function update(argv,root=__dirname,dependencies={}){const o=options(argv,root);const state=await(dependencies.run||run)(o);if(o.list)return state;const master=await(dependencies.build||build)({root,companies:path.resolve(root,'../../05_COMPANIES'),archiveRoot:'C:/Users/angel/OneDrive/Desktop/knowledge/03_PROCUREMENT/Procurement Data',output:path.join(root,'Procurement-Master'),partBytes:256*1024,asOf:new Date().toISOString(),runDir:o.runDir});return {collectionStatus:state.status,masterGeneration:master.generation,status:state.status==='partial-failure'?'partial-failure':'partial'};}
if(require.main===module)update(process.argv.slice(2)).then(r=>{console.log(JSON.stringify(r,null,2));if(r.status==='partial-failure')process.exitCode=1;}).catch(e=>{console.error(e.stack);process.exitCode=1;});
module.exports={update};
