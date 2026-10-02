'use strict';
const fs=require('node:fs'),path=require('node:path');const {main,args,exportData}=require('./collect.cjs');
const readLines=file=>fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
async function refresh(){
 const options=args(process.argv.slice(2));if(options.help||options.list)return main();
 const output=path.resolve(process.env.PROCUREMENT_FINAL_OUTPUT_DIR||path.join(__dirname,'final-output'));fs.mkdirSync(output,{recursive:true});
 const snapshots=fs.readdirSync(output).filter(n=>/^EU27_NATIONAL_SPACE_\d{4}-\d{2}-\d{2}_HISTORY\.jsonl$/.test(n)).sort();
 const baseline=snapshots.at(-1),rows=baseline?readLines(path.join(output,baseline)):[];
 const coverageFile=baseline&&path.join(output,baseline.replace('_HISTORY.jsonl','_COVERAGE.jsonl'));
 const coverage=new Map(coverageFile&&fs.existsSync(coverageFile)?readLines(coverageFile).map(r=>[r.sourceId,r]):[]);
 await main();
 const state=JSON.parse(fs.readFileSync(path.join(options.output,'checkpoint.json'),'utf8'));
 for(const r of state.rows){if(r.rawFile&&!path.isAbsolute(r.rawFile))r.rawFile=path.join(options.output,state.runId,r.rawFile);rows.push(r);}
 for(const r of state.coverage)coverage.set(r.sourceId,r);
 const summary=await exportData(output,rows,[...coverage.values()],new Date());
 console.log('Consolidated final outputs:',JSON.stringify(summary,null,2));
 return summary;
}
if(require.main===module)refresh().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={refresh};
