'use strict';
const test=require('node:test'),a=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {decode,collect}=require('../controller/austria-current.cjs');
const day='2026-10-20',row=(id,date=null,modern=false,offer=null,participation=null)=>['Title','Buyer','2019-01-01',date,id,modern,offer,participation];
const response=rows=>Buffer.from(JSON.stringify({recordsTotal:rows.length,recordsFiltered:rows.length,data:rows}));
test('Austria includes older publications with current offer or participation dates; excludes expired and undated rows',()=>{
 const d=decode(response([row('old','2026-11-01'),row('expired','2026-10-19'),row('undated'),row('offer',null,true,day),row('participation',null,true,null,'2027-01-01'),row('modern-expired','2027-01-01',true,'2026-10-01')]),0,day);
 a.deepEqual(d.selected,[0,3,4]);a.equal(d.undated,1);
});
test('Austria rejects malformed dates, filtered inventories and premature pages',()=>{
 a.throws(()=>decode(response([row('bad','2026-02-30')]),0,day),/deadline/);
 a.throws(()=>decode(Buffer.from(JSON.stringify({recordsTotal:200,recordsFiltered:200,data:[row('one')]})),0,day),/premature/);
 a.throws(()=>decode(Buffer.from(JSON.stringify({recordsTotal:2,recordsFiltered:1,data:[row('one')]})),0,day),/unfiltered/);
});
test('Austria preserves raw metadata, resumes without requests, exports only selected rows and verifies original evidence',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'austria-index-')),job='national-AT-USP-current',target=path.join(dir,job),j={id:job,kind:'austria',day};
 const bytes=response([row('open','2026-11-01'),row('expired','2020-01-01'),row('unknown')]);let calls=0;
 const s=await collect(j,target,{fetchPage:async req=>{calls++;a.equal(new URL(req.url).pathname,'/at.gv.bmdw.eproc-p/public/api/tenderlist');return bytes;}});
 a.equal(calls,2);a.equal(s.received,1);a.equal(s.indexReceived,3);a.equal(s.indexCountReconciled,true);a.equal(s.undated,1);a.equal(s.state,'partial');a.deepEqual(fs.readFileSync(path.join(target,s.pages[0].file)),bytes);
 await collect(j,target,{fetchPage:async()=>{throw Error('unexpected refetch');}});
 fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({day,finishedAt:new Date().toISOString(),jobs:{[job]:{state:s.state,received:s.received}}}));
 require('../controller/export-candidates.cjs').exportCandidates(dir);a.equal(require('../controller/verify-candidates.cjs').verify(dir).rows,1);
 const checkpoint=JSON.parse(fs.readFileSync(path.join(target,'state.json')));checkpoint.pages[0].selectedRows=[1];fs.writeFileSync(path.join(target,'state.json'),JSON.stringify(checkpoint));
 a.throws(()=>require('../controller/verify-candidates.cjs').verify(dir),/selected rows changed/);
});
test('Austria count change remains partial and never closes unseen notices',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'austria-changing-'));let calls=0;
 const s=await collect({day},dir,{fetchPage:async()=>++calls===1?response([row('a',day)]):response([row('a',day),row('b',day)])});
 a.equal(s.indexCountReconciled,false);a.equal(s.finalTotal,2);a.equal(s.state,'partial');a.equal(s.received,1);
});
test('Austria resumes earlier 100-row pages with larger pages and verifies offset continuity',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'austria-page-size-')),j={day},crypto=require('crypto'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
 const rows=Array.from({length:1105},(_,i)=>row(String(i),i%10===0?day:null));
 const raw=Buffer.from(JSON.stringify({recordsTotal:1105,recordsFiltered:1105,data:rows.slice(0,100)})),file='old-page.json';fs.writeFileSync(path.join(dir,file),raw);
 const state={identity:hash(JSON.stringify(j)),format:'austria-index-json',day,pages:[{file,sha256:hash(raw),page:0,rows:10,selectedRows:Array.from({length:10},(_,i)=>i*10)}],probes:[],page:1,received:10,indexReceived:100,undated:90,total:1105,state:'partial'};
 fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify(state));const offsets=[];
 const s=await collect(j,dir,{fetchPage:async req=>{const u=new URL(req.url),start=Number(u.searchParams.get('start')),size=Number(u.searchParams.get('length'));offsets.push(start);return Buffer.from(JSON.stringify({recordsTotal:1105,recordsFiltered:1105,data:rows.slice(start,start+size)}));}});
 a.deepEqual(offsets,[100,1100,0]);a.equal(s.indexReceived,1105);a.equal(s.received,111);a.equal(require('../controller/austria-current.cjs').verifyIndex(dir,s).indexCountReconciled,true);
 s.pages[1].start=101;a.throws(()=>require('../controller/austria-current.cjs').verifyIndex(dir,s),/sequence/);
});
test('Austria bulk metadata mode uses a separate small final-count request',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'austria-bulk-')),rows=Array.from({length:2001},(_,i)=>row(String(i),day)),sizes=[];
 const s=await collect({day,indexPageSize:200000},dir,{fetchPage:async req=>{const u=new URL(req.url),size=Number(u.searchParams.get('length'));sizes.push(size);a.ok(req.maxContentLength<=64*1024*1024);return Buffer.from(JSON.stringify({recordsTotal:rows.length,recordsFiltered:rows.length,data:rows.slice(0,size)}));}});
 a.deepEqual(sizes,[200000,1000]);a.equal(s.received,2001);a.equal(s.indexCountReconciled,true);a.equal(require('../controller/austria-current.cjs').verifyIndex(dir,s).uniqueIndexRows,2001);
 await a.rejects(collect({day,indexPageSize:200001},dir,{}),/page size/);
});
