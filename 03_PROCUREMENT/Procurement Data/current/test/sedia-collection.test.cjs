'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{collect}=require('../sedia-collection.cjs');
test('oversized queries split and include undated/outside-range records',async()=>{
 const output=fs.mkdtempSync(path.join(os.tmpdir(),'sedia-split-'));const rows=await collect({terms:['Space'],size:100,output,windowLimit:2,accept:()=>true,searchPage:async(term,page,part)=>part.kind==='all'?{totalResults:3,results:[{}]}:{totalResults:1,results:[{id:part.kind+':'+part.from}]}});assert.equal(rows.length,3);assert.equal(JSON.parse(fs.readFileSync(path.join(output,'sedia-collection-state.json'))).state,'reconciled');
});
test('API result-window zero cannot silently mark a partition complete; resume retains prior pages',async()=>{
 const output=fs.mkdtempSync(path.join(os.tmpdir(),'sedia-zero-'));const o={terms:['Space'],size:1,output,accept:()=>true,searchPage:async(t,page)=>page===1?{totalResults:2,results:[{id:1}]}:{totalResults:0,results:[]}};await assert.rejects(collect(o),/total changed/);const state=JSON.parse(fs.readFileSync(path.join(output,'sedia-collection-state.json')));assert.equal(state.records.length,1);assert.equal(state.queue[0].page,2);const calls=[];const rows=await collect({...o,searchPage:async(t,page)=>{calls.push(page);return {totalResults:2,results:[{id:2}]};}});assert.deepEqual(calls,[2]);assert.deepEqual(rows.map(r=>r.id),[1,2]);
});
