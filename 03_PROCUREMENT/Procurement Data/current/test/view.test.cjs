'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{currentView}=require('../view.cjs');
test('reading a saved open notice after closing rechecks expiry without changing saved evidence',()=>{
 const r={recordType:'procurement',title:'Satellite',availability:{sourceDerivedStatus:'reported_open',currentStatus:'open_verified',liveVerified:true,deadline:{value:'2026-10-15T10:00:00Z',precision:'instant'}}},before=JSON.stringify(r);
 const v=currentView(r,'2026-10-16T12:00:00Z');assert.equal(v.availability.currentStatus,'deadline_expired');assert.equal(v.availability.liveVerified,false);assert.equal(v.snapshotAvailability.currentStatus,'open_verified');assert.equal(JSON.stringify(r),before);
});
test('current view never upgrades old receipts or resolves conflicting evidence silently',()=>{
 const r={recordType:'procurement',title:'Satellite',availability:{sourceDerivedStatus:'reported_open',currentStatus:'open_verified',deadline:{value:'2026-12-15',precision:'date'}}};assert.equal(currentView(r,'2026-10-15T12:00:00Z').availability.currentStatus,'reported_open_not_live_verified');r.availability.conflictingLatestDeadlines=true;assert.equal(currentView(r,'2026-10-15T12:00:00Z').availability.currentStatus,'unknown');
});
