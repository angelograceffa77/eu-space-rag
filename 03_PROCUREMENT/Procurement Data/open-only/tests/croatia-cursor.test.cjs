'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),hr=require('../controller/croatia-cursor.cjs');
const row=Id=>({Id,TenderStatusId:2}),body=(data,totalCount)=>Buffer.from(JSON.stringify({data,totalCount}));
test('Croatian cursor rejects ignored boundaries, status changes and hidden result caps',()=>{
 a.throws(()=>hr.decode(body([row(1)],1),1),/identity/);
 a.throws(()=>hr.decode(body([{Id:2,TenderStatusId:4}],1),1),/status/);
 a.throws(()=>hr.decode(body([row(2)],200),1),/count/);
 const u=new URL(hr.request(99).url);a.equal(u.searchParams.get('skip'),'0');a.deepEqual(JSON.parse(u.searchParams.get('filter'))[2],['Id','>',99]);
});
test('Croatian current cursor reconciles independent final count and rejects changed evidence',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hr-cursor-')),j={id:'hr',cursorPagination:true};let n=0;
 const s=await hr.collect(j,dir,{fetchPage:async()=>{n++;return body([row(1),row(2)],2);}});
 a.equal(n,2);a.equal(s.state,'reconciled');a.equal(hr.verifyIndex(dir,s).received,2);
 fs.appendFileSync(path.join(dir,s.pages[0].file),' ');
 await a.rejects(hr.collect(j,dir,{fetchPage:async()=>{throw Error('Should not fetch');}}),/evidence mismatch/);
});
test('Croatian cursor continues across changing totals without promoting the result to complete',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hr-moving-'));let n=0;
 const s=await hr.collect({id:'hr'},dir,{fetchPage:async()=>++n===1?body(Array.from({length:100},(_,i)=>row(i+1)),101):n===2?body([row(101),row(102)],2):body(Array.from({length:100},(_,i)=>row(i+1)),102)});
 a.equal(s.received,102);a.equal(s.state,'partial');a.equal(s.traversalExhausted,true);a.equal(s.totalChanges.length,1);a.equal(hr.verifyIndex(dir,s).finalTotal,102);
});
