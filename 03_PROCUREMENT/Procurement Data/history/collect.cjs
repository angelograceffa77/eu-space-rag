#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {run,options}=require('../orchestration/coordinator.cjs');
// Separate durable run directories: rerunning the same selection resumes its evidence.
async function history(root,argv){require('../open-only/policy.cjs').assertHistory(root);if(argv.some(a=>/^(--daily|--publish|--from=)/.test(a)))throw Error('History runs from 2020, separately from daily publication');const selection=argv.find(a=>a.startsWith('--only='));if(!selection)throw Error('Choose --only=collector-id (use procurement:list). History is collected one source at a time.');const id=selection.slice(7);if(!/^[A-Za-z0-9_-]+$/.test(id))throw Error('Choose one registered collector');const dir=path.join(root,'.procurement-runs','history',id);const args=[...argv,'--from=2020-01-01','--run-dir='+dir,'--no-consolidate'];if(fs.existsSync(path.join(dir,'run-state.json')))args.push('--resume');const result=await run(options(args,root));const config=JSON.parse(fs.readFileSync(path.join(root,'daily/config.json')));const archived=await require('../daily/daily.cjs').archiveRun(root,dir,config.archiveRoot);fs.writeFileSync(path.join(dir,'history-archive-receipt.json'),JSON.stringify(archived,null,2));return result;}
if(require.main===module)history(path.resolve(__dirname,'..'),process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={history};
