'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{write}=require('../atomic-state.cjs');
test('temporary Windows sharing failures retry without deleting the saved checkpoint',()=>{
 let attempts=0,writes=0;const waits=[];
 write('state.json',{completed:1},{writeFileSync(){writes++;},renameSync(){if(++attempts<4)throw Object.assign(Error('busy'),{code:'EPERM'});}},ms=>waits.push(ms));
 assert.equal(writes,1);assert.equal(attempts,4);assert.deepEqual(waits,[100,200,400]);
});
test('permanent failure remains bounded and preserves temporary evidence',()=>{
 let attempts=0;assert.throws(()=>write('state.json',{}, {writeFileSync(){},renameSync(){attempts++;throw Object.assign(Error('busy'),{code:'EBUSY'});}},()=>{}),/busy/);assert.equal(attempts,9);
});
test('unrelated filesystem errors fail immediately',()=>{
 let attempts=0;assert.throws(()=>write('state.json',{}, {writeFileSync(){},renameSync(){attempts++;throw Object.assign(Error('missing'),{code:'ENOENT'});}},()=>{}),/missing/);assert.equal(attempts,1);
});
