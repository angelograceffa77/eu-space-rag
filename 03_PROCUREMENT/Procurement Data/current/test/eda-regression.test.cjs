'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const text=fs.readFileSync(path.resolve(__dirname,'../../EDA/scrapers/scrape-eda-procurements.js'),'utf8');
test('EDA relative notice URLs resolve against the official index',()=>{
 const body=text.slice(text.indexOf('function normalizeUrl('),text.indexOf('\nfunction parseDate('));const fn=vm.runInNewContext(body+';normalizeUrl',{URL,clean:x=>String(x||'').trim(),EDA_OTHER_NOTICES:'https://www.eda.europa.eu/procurement/other-notices'});
 assert.equal(fn('other-notices/example'),'https://www.eda.europa.eu/procurement/other-notices/example');assert.equal(fn('javascript:void(0)'), '');
});
test('EDA retry records permanent errors and bounds transient failures',async()=>{
 const body=text.slice(text.indexOf('async function withRetry('),text.indexOf('\nconst currentSourceChecks'));
 for(const status of [403,503]){const checks=[],fn=vm.runInNewContext(body+';withRetry',{currentSourceChecks:checks,Date,sleep:async()=>{},RETRY_START_MS:1,RETRY_MAX_MS:3});let calls=0;await assert.rejects(fn(async()=>{calls++;throw Object.assign(Error('source unavailable'),{response:{status}});},'official-source'),/source unavailable/);assert.equal(calls,status===403?1:3);assert.equal(checks[0].source,'official-source');}
});
