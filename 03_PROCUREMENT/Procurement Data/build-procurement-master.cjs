#!/usr/bin/env node
'use strict';
if(require.main===module&&require('./open-only/policy.cjs').load(__dirname)?.dailyMode==='open-space-v1')throw Error('Legacy collection/build is disabled for the open-space master. Use node --use-system-ca --max-old-space-size=8192 daily/daily.cjs --publish.');
const path=require('node:path'),{build}=require('./master/build.cjs');
const o={root:__dirname,companies:path.resolve(__dirname,'../../05_COMPANIES'),archiveRoot:'C:/Users/angel/OneDrive/Desktop/knowledge/03_PROCUREMENT/Procurement Data',output:path.join(__dirname,'Procurement-Master'),partBytes:256*1024,asOf:new Date().toISOString()};
for(const a of process.argv.slice(2)){const m=a.match(/^--(output|companies|archive-root|run-dir|part-bytes|reconciliation)=(.+)$/);if(!m)throw Error('Use --output=DIR --companies=DIR --archive-root=DIR --run-dir=DIR --part-bytes=N');if(m[1]==='run-dir'){(o.runDir??=[]).push(m[2]);}else o[{'archive-root':'archiveRoot','part-bytes':'partBytes'}[m[1]]||m[1]]=m[2];}o.partBytes=Number(o.partBytes);if(!Number.isInteger(o.partBytes)||o.partBytes<4096||o.partBytes>8*1024*1024)throw Error('part-bytes must be between 4096 and 8388608');
if(require.main===module)build(o).catch(e=>{console.error(e.stack);process.exitCode=1;});
