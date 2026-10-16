'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {normalize}=require('../normalise.cjs'),{buildEntity}=require('../entities.cjs');
const source={id:'fixture',family:'national',authority:'EU27',scope:'national'},companies={byName:new Map(),byCode:new Map()},asOf='2026-10-15T10:00:00Z';
function entity(records){return buildEntity('test',records.map((r,i)=>({id:'r'+i,original:JSON.stringify(r),normalised:JSON.stringify(normalize(r,source))})),companies,asOf)[0];}
test('master excludes expired Czech GNSS and Swedish supplier admission from ordinary open tenders',()=>{
 assert.equal(entity([{title:'GNSS',status:'OPEN',deadline:'2026-10-13'}]).availability.currentStatus,'deadline_expired');
 assert.equal(entity([{title:'DIS - Upphandling inom satellitkommunikationsutrustning',status:'OPEN',deadline:'2027-12-31'}]).availability.currentStatus,'admission');
});
test('newer cancellation wins over older open notice without rewriting either',()=>{
 const rows=[{title:'Satellite',status:'OPEN',publicationDate:'2026-10-01',deadline:'2026-12-01'},{title:'Satellite',status:'CANCELLED',publicationDate:'2026-10-14'}],original=JSON.stringify(rows);
 assert.equal(entity(rows).availability.currentStatus,'cancelled');assert.equal(JSON.stringify(rows),original);
});
test('same-date conflicting deadlines and statuses cannot produce an open conclusion',()=>{
 const row={title:'Satellite',status:'OPEN',publicationDate:'2026-10-14',deadline:'2026-12-01'};
 assert.equal(entity([row,{...row,deadline:'2026-12-15'}]).availability.currentStatus,'unknown');
 assert.equal(entity([row,{...row,status:'CLOSED'}]).availability.currentStatus,'unknown');
});
test('numeric timezone offsets parse without changing the source string',()=>{
 const row={title:'Satellite',deadline:'2026-10-14T15:00:00+0000',status:'OPEN'};
 const result=entity([row]);assert.equal(result.availability.currentStatus,'deadline_expired');assert.equal(result.availability.deadline.original,row.deadline);
});
