'use strict';
const fs=require('node:fs'),path=require('node:path'),{records,read}=require('./jsonl.cjs');
function latest(dir,pattern){return fs.existsSync(dir)?fs.readdirSync(dir).filter(n=>pattern.test(n)).sort().at(-1):undefined;}
async function consolidate({root,baselineDir,inputs=[],output,asOf=new Date().toISOString().slice(0,10),countries=false}){if(path.resolve(output)===path.resolve(baselineDir))throw Error('Consolidation must use a separate output directory');const rows=new Map(),coverage=new Map();let inputRows=0;
async function ingest(file){for await(const r of records(file)){if(!r.recordId)throw Error('Missing recordId in '+file);rows.set(r.recordId,r);inputRows++;}}
const prior=latest(baselineDir,/^EU27_NATIONAL_SPACE_\d{4}-\d{2}-\d{2}_HISTORY\.jsonl$/);if(prior){await ingest(path.join(baselineDir,prior));const cf=path.join(baselineDir,prior.replace('_HISTORY','_COVERAGE'));if(fs.existsSync(cf))for(const r of await read(cf))coverage.set(r.sourceId,r);}
for(const item of inputs){await ingest(item.history);if(item.coverage)for(const r of await read(item.coverage))coverage.set(r.sourceId,r);}
const national=path.join(root,'EU27','National-Portals'),exporter=require(path.join(national,'romania-large-export.cjs')),data=[...rows.values()];rows.clear();
const now=new Date(asOf+'T12:00:00Z');const result=await exporter.exportData(output,data,[...coverage.values()],now,{preserveStatus:true,recheckOpen:true});
if(countries){const names=require(path.join(national,'sources.cjs')).countries;result.countries={};for(const [code,name]of [...names,['EU','European Union']]){const subset=data.filter(r=>r.country===code),cv=[...coverage.values()].filter(r=>r.country===code);if(code==='EU'&&!subset.length&&!cv.length)continue;result.countries[code]=await exporter.exportData(path.join(output,name),subset,cv,now,{preserveStatus:true,recheckOpen:true,singleCountry:true,prefix:code+'_NATIONAL_SPACE'});}}
result.inputRows=inputRows;result.statusPolicy='Preserved collector decisions; previously open rows are rechecked for deadline expiry and admission/consultation type at consolidation time. Source retrieval timestamps are not refreshed by export.';fs.writeFileSync(path.join(output,'consolidation-validation.json'),JSON.stringify(result,null,2));return result;}
if(require.main===module){const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));consolidate(config).then(v=>console.log(JSON.stringify(v,null,2))).catch(e=>{console.error(e.stack);process.exitCode=1;});}
module.exports={consolidate,latest};
