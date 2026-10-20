'use strict';
const test=require('node:test'),a=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),{check}=require('../controller/recheck-open.cjs');
test('Rechecks retrieve a shared URL once, retain separate identities and share unchanged bytes',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shared-recheck-'));fs.mkdirSync(path.join(dir,'open-checks'));
 fs.writeFileSync(path.join(dir,'open-checks/watchlist.json'),JSON.stringify({generation:'g',targets:[{procurementId:'a',sourceRecordId:'a',noticeId:'notice-one',url:'https://example.org/shared'},{procurementId:'b',sourceRecordId:'b',noticeId:'notice-two',url:'https://example.org/shared'}]}));
 let requests=0;const result=await check(dir,dir,{fetchPage:async url=>{requests++;return {url,body:Buffer.from('notice-one'),contentType:'text/plain'};}});
 a.equal(requests,1);a.equal(result.checked,2);a.equal(result.uniqueSourceURLs,1);a.equal(result.unverified,2);
 const rows=Object.values(JSON.parse(fs.readFileSync(result.receiptFile)).receipts);a.equal(rows[0].evidenceFile,rows[1].evidenceFile);a.equal(rows.filter(x=>x.identityMatched).length,1);
});
test('A failed shared URL is not repeatedly requested or interpreted as closure',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shared-error-'));fs.mkdirSync(path.join(dir,'open-checks'));
 fs.writeFileSync(path.join(dir,'open-checks/watchlist.json'),JSON.stringify({generation:'g',targets:Array.from({length:28},(_,i)=>({procurementId:String(i),url:'https://example.org/blocked'}))}));
 let requests=0;const result=await check(dir,dir,{fetchPage:async()=>{requests++;throw Error('HTTP 403');}});
 a.equal(requests,1);a.equal(result.failed,28);a.equal(result.uniqueFailedURLs,1);a.equal(result.unverified,28);
});
