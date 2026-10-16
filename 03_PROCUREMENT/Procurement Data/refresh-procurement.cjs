#!/usr/bin/env node
'use strict';
const {run,options}=require('./orchestration/coordinator.cjs');
if(require.main===module)run(options(process.argv.slice(2),__dirname)).then(s=>{if(s.status==='partial-failure')process.exitCode=1;}).catch(e=>{console.error(e.stack);process.exitCode=1;});
