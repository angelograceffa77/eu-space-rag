'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),{network}=require('../controller/intake.cjs');
test('Portal retry delay backs off after transient failures while keeping the original response bytes',async()=>{
 const waits=[];let calls=0;
 const fetch=network({delay:0,sleep:async ms=>waits.push(ms),send:async()=>++calls<3?{status:503,headers:{}}:{status:200,headers:{'x-pagination':'original-header'},data:Buffer.from('original bytes')}});
 const b=await fetch({url:'https://example.org/current',init:{method:'GET'},minimumRetryDelayMs:15000,capturePagination:true});
 a.equal(calls,3);a.deepEqual(waits.filter(n=>n>=15000),[15000,30000]);a.equal(b.toString(),'original bytes');a.equal(b.paginationHeader,'original-header');
});
test('Retry limits remain bounded and long server cooldowns still stop the source',async()=>{
 let calls=0;const waits=[];
 const fetch=network({delay:0,sleep:async ms=>waits.push(ms),send:async()=>{calls++;return {status:503,headers:{}};}});
 await a.rejects(fetch({url:'https://example.org/current',init:{method:'GET'},minimumRetryDelayMs:15000}),/HTTP 503/);a.equal(calls,3);a.ok(waits.every(x=>x<=60000));
 calls=0;const cooldown=network({sleep:async()=>{},send:async()=>{calls++;return {status:503,headers:{'retry-after':'120'}};}});
 await a.rejects(cooldown({url:'https://example.org/current',init:{method:'GET'}}),/server cooldown/);a.equal(calls,1);
});
