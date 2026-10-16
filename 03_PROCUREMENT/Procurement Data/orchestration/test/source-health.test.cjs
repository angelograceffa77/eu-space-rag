'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {assess}=require('../coordinator.cjs');
test('successful output with failed current-source checks is explicitly partial',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'source-health-'));fs.writeFileSync(path.join(dir,'records.jsonl'),'{}\n');fs.writeFileSync(path.join(dir,'Agency_Summary.json'),JSON.stringify({sourceCounts:{currentSourceChecks:[{source:'live',state:'failed',error:'parse failure'}]}}));
 const result=await assess({kind:'standalone'},{output:dir},Date.now()-1000);assert.equal(result.state,'partial');assert.equal(result.currentSourceChecks[0].error,'parse failure');
});
test('ESO blocked live layer is not interpreted as successful zero-current coverage',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'source-health-'));fs.writeFileSync(path.join(dir,'records.jsonl'),'{}\n');fs.writeFileSync(path.join(dir,'ESO_Summary.json'),JSON.stringify({liveInTendLayerAccessible:false}));
 const result=await assess({kind:'standalone'},{output:dir},Date.now()-1000);assert.equal(result.state,'partial');assert.equal(result.currentSourceChecks[0].state,'blocked');
});
