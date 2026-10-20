#!/usr/bin/env node
'use strict';
if(require.main===module&&require('./open-only/policy.cjs').load(__dirname)?.dailyMode==='open-space-v1')throw Error('Legacy collection/build is disabled for the open-space master. Use node --use-system-ca --max-old-space-size=8192 daily/daily.cjs --publish.');
const {run,options}=require('./orchestration/coordinator.cjs');
if(require.main===module)run(options(process.argv.slice(2),__dirname)).then(s=>{if(s.status==='partial-failure')process.exitCode=1;}).catch(e=>{console.error(e.stack);process.exitCode=1;});
