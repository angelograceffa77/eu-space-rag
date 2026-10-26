'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');
const {normalize,classify,main,request,queryFor,options}=require('../scrapers/scrape-eu-funding-tenders');
const record=(id,status='31094502',description='Satellite Earth observation for wildfire monitoring')=>({reference:id+'en',checksum:id+'v1',url:'https://ec.europa.eu/example',content:id,metadata:{identifier:[id],type:['1'],status:[status],description:[description],title:['Test '+id],startDate:['2027-01-01T00:00:00Z'],deadlineDate:['2028-01-01T17:00:00.000+0000'],budget:['100000']}});
function response(results,total,page,size,warnings=[]){return new Response(JSON.stringify({results,totalResults:total,pageNumber:page,pageSize:size,warnings}),{status:200});}
test('source statuses, deadlines, classifications, fallback identifiers',()=>{
 const now='2026-10-13T00:00:00Z';assert.equal(normalize(record('A'),now,'raw').status,'open');assert.equal(normalize(record('A','31094501'),now,'raw').status,'forthcoming');assert.equal(normalize(record('A','31094503'),now,'raw').status,'closed');assert.equal(normalize(record('A','unknown'),now,'raw').status,'uncertain');
 const stale=record('A');stale.metadata.deadlineDate=['2020-02-01'];assert.equal(normalize(stale,now,'raw').status,'uncertain');
 assert.equal(classify(record('A')).decision,'relevant');assert.equal(classify(record('B','31094503','Generic artificial intelligence for agriculture')).decision,'review');assert.equal(classify(record('C','31094503','Hotel tourism training')).decision,'excluded');
 const fallback=record('D');fallback.metadata.identifier=[];assert.match(normalize(fallback,now,'raw').canonicalId,/ref:Den/);
 const a=record('A');a.metadata.actions=[JSON.stringify([{status:{description:'Cancelled'}}])];assert.equal(normalize(a,now,'raw').status,'cancelled');
});
test('year queries preserve overlap and unknown-date review; CLI validation',()=>{assert.equal(queryFor({kind:'dated',from:1,to:2}).bool.must[1].bool.should.length,2);assert.ok(queryFor({kind:'undated'}).bool.must[1].bool.must_not);assert.throws(()=>options(['--page-size','NaN']));assert.throws(()=>options(['--since','2019']));});
test('rejects malformed API schema without retries',async()=>{let calls=0;await assert.rejects(request({kind:'current'},1,2,async()=>{calls++;return new Response('{}');}),/schema/);assert.equal(calls,1);});
test('end-to-end partial, resume, dedup, Excel, raw evidence, retention',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'funding-test-'));let calls=0;
 const fetcher=async u=>{calls++;const page=Number(u.searchParams.get('pageNumber')),size=Number(u.searchParams.get('pageSize'));return response(page===1?[record('A','31094502','Satellite control character \u0001 test'),record('B')]:[record('B'),record('C')],4,page,size);};
 try{
  const partial=await main(['--mode','current','--page-size','2','--max-pages','1','--out',root],fetcher);assert.equal(partial.manifest.status,'partial');await assert.rejects(fs.access(path.join(root,'generated','latest-complete.json')));
  const full=await main(['--mode','current','--page-size','2','--resume','--out',root],fetcher);assert.equal(full.manifest.status,'complete');assert.equal(full.records.length,3);assert.equal(full.manifest.counts.duplicates,1);assert.equal(calls,2);
  const ExcelJS=require('exceljs'),book=new ExcelJS.Workbook();await book.xlsx.readFile(path.join(full.dir,'funding-master.xlsx'));assert.equal(book.getWorksheet('master').rowCount,4);assert.equal(book.getWorksheet('master').getRow(2).getCell(1).value,full.records[0].canonicalId);
  const next=await main(['--mode','current','--page-size','2','--out',root],async u=>response([record('A')],1,Number(u.searchParams.get('pageNumber')),2));assert.equal(next.manifest.counts.retained,2);assert.equal(next.records.find(r=>r.identifier==='C').status,'uncertain');
 }finally{process.exitCode=0;await fs.rm(root,{recursive:true,force:true});}
});
test('repeated page yields partial instead of false success',async()=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'funding-repeat-'));try{const run=await main(['--mode','current','--page-size','1','--out',root],async u=>response([record('A')],3,Number(u.searchParams.get('pageNumber')),1));assert.equal(run.manifest.status,'partial');assert.match(run.manifest.error,/Repeated page/);}finally{process.exitCode=0;await fs.rm(root,{recursive:true,force:true});}});
test('unexpected zero never publishes a complete pointer',async()=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'funding-zero-'));try{const run=await main(['--mode','current','--out',root],async()=>response([],0,1,100));assert.equal(run.manifest.status,'unexpectedly_empty');await assert.rejects(fs.access(path.join(root,'generated','latest-complete.json')));}finally{process.exitCode=0;await fs.rm(root,{recursive:true,force:true});}});
