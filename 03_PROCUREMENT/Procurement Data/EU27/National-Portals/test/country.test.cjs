'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {exportCountries}=require('../collect.cjs'),{normalize}=require('../core.cjs'),{sources}=require('../sources.cjs');
test('country exports isolate records and coverage, retain EU-wide data and create empty countries',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'country-export-')),now=new Date('2026-10-01T12:00:00Z');
 try{
  const rows=['FR','DE','EU'].map(country=>normalize({noticeId:country,sourceUrl:'https://example.test/'+country,title:'Satellite communications – é',description:'Satellite',publicationDate:'2026-09-30',deadlineRaw:'2026-12-01',noticeType:'tender',noticeVerified:true},sources.find(s=>s.country===country),'raw/example',now));
  const coverage=rows.map(r=>({sourceId:r.sourceId,country:r.country,state:'partial',gaps:['Test gap']}));
  const result=await exportCountries(dir,rows,coverage,now);
  assert.equal(Object.keys(result).length,28);
  for(const code of ['FR','DE','EU']){
   const r=result[code];assert.equal(r.counts.MASTER,1);
   const record=JSON.parse(fs.readFileSync(r.files.find(f=>f.endsWith('_MASTER.jsonl')),'utf8'));assert.equal(record.country,code);assert.equal(record.title,rows.find(x=>x.country===code).title);
   const c=JSON.parse(fs.readFileSync(r.files.find(f=>f.endsWith('_COVERAGE.jsonl')),'utf8'));assert.equal(c.country,code);
  }
  assert.equal(path.basename(path.dirname(result.FR.files[0])),'France');
  assert.equal(path.basename(path.dirname(result.EU.files[0])),'European Union');
  assert.equal(result.BE.counts.MASTER,0);assert.equal(fs.readFileSync(result.BE.files.find(f=>f.endsWith('_MASTER.jsonl')),'utf8'),'');
  await assert.rejects(exportCountries(dir,[{country:'UNKNOWN'}],[],now),/Unknown country/);
 }finally{assert(dir.startsWith(path.join(os.tmpdir(),'country-export-')));fs.rmSync(dir,{recursive:true,force:true});}
});
