'use strict';
const {test}=require('node:test'),a=require('node:assert/strict');
const ee=require('../controller/estonia-intake.cjs');
test('Estonia uses inclusive source calendar dates, avoiding the live ISO timestamp boundary shift',()=>{
 const lo=Date.parse('2026-08-12T00:00:00Z'),hi=lo+86400000,q={lo,hi};
 const filter=JSON.parse(ee.request('11',q).init.body).filter;
 a.equal(filter.procurementProcessRevealDateBegin,'2026-08-12');
 a.equal(filter.procurementProcessRevealDateEnd,'2026-08-12');
 const row={procurementId:9432085,procurementStatus:'11',procProcessRevealDate:'2026-08-12T07:00:13.013+0300'};
 a.equal(ee.decode(JSON.stringify([row]),'11',q).length,1);
 a.throws(()=>ee.decode(JSON.stringify([row]),'11',{lo:lo-86400000,hi:lo}),/not honoured/);
});
test('Estonia checks native calendar days across midnight and rejects invalid dates',()=>{
 a.equal(ee.calendarDay('2026-08-12T00:30:00.000+0300'),Date.parse('2026-08-12'));
 a.ok(Number.isNaN(ee.calendarDay('2026-02-30')));
 a.ok(Number.isNaN(ee.calendarDay('not-a-date')));
});
