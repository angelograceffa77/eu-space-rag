'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{saveResponse}=require('../sedia.cjs');
test('changed responses for the same page retain both originals and checksum references',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sedia-evidence-'));
 for(const id of [1,2,2])saveResponse(dir,'DEFIS/',1,{results:[{id}],totalResults:1},'https://example.test');
 const folder=path.join(dir,'source-responses'),entries=fs.readFileSync(path.join(folder,'requests.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(new Set(entries.map(e=>e.file)).size,2);assert.equal(entries.length,3);
 for(const e of entries)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(folder,e.file))).digest('hex'),e.sha256);
 assert.equal(JSON.parse(fs.readFileSync(path.join(folder,entries[0].file))).results[0].id,1);
});
