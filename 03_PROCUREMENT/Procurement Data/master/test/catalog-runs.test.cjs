'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {discover}=require('../catalog.cjs');
test('multiple refresh runs supplement preserved baseline without duplicate file imports',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'master-catalog-'));fs.mkdirSync(path.join(root,'EU27/National-Portals/final-output'),{recursive:true});fs.mkdirSync(path.join(root,'ESA/generated'),{recursive:true});fs.writeFileSync(path.join(root,'ESA/generated/ESA_Test_2026-10-01.jsonl'),'{}\n');
 const runs=['a','b'].map((id,i)=>{const run=path.join(root,id);fs.mkdirSync(run);const file=path.join(run,'ESA_Test_2026-10-15.jsonl');fs.writeFileSync(file,JSON.stringify({id})+'\n');fs.writeFileSync(path.join(run,'run-state.json'),JSON.stringify({asOf:'2026-10-15',jobs:{['ESA--'+id]:{state:'unassessed',outputs:[{file,sha256:'expected-'+i}]}}}));return run;});
 const found=discover(root,[...runs,runs[0]]);assert.equal(found.length,3);assert.equal(found.filter(s=>s.date==='2026-10-01').length,1);assert.deepEqual(found.filter(s=>s.expectedSha256).map(s=>s.expectedSha256),['expected-0','expected-1']);
});
