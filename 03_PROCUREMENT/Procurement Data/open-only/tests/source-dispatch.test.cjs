'use strict';
const test=require('node:test'),a=require('node:assert/strict'),{dispatch}=require('../controller/source-dispatch.cjs');
test('A busy source does not strand an otherwise free collection worker',async()=>{
 let release;const ready=new Promise(r=>release=r),events=[],active=new Set();
 await dispatch([{id:'A1',kind:'A'},{id:'A2',kind:'A'},{id:'B1',kind:'B'}],2,async j=>{
  a.ok(!active.has(j.kind));active.add(j.kind);events.push(j.id);
  if(j.id==='A1')await ready;if(j.id==='B1')release();active.delete(j.kind);
 });
 a.deepEqual(events,['A1','B1','A2']);
});
test('Dispatcher waits for in-flight work before propagating a failure',async()=>{
 let finished=false;
 await a.rejects(dispatch([{kind:'A'},{kind:'B'}],2,async j=>{if(j.kind==='A')throw Error('source failure');await new Promise(r=>setTimeout(r,10));finished=true;}),/source failure/);
 a.equal(finished,true);
});
