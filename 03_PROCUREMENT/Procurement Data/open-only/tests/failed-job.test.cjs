'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {failedJob}=require('../controller/failed-job.cjs');
test('Adapter failure retains committed observations without declaring successful collection',()=>{
 const d=fs.mkdtempSync(path.join(os.tmpdir(),'failed-evidence-'));try{
 const original=JSON.stringify({state:'running',received:600,pages:[{file:'page.json'}]});fs.writeFileSync(path.join(d,'state.json'),original);
 const r=failedJob(d,Error('EPERM'),['partial']);a.equal(r.received,600);a.equal(r.state,'failed');a.equal(r.checkpointState,'running');a.equal(fs.readFileSync(path.join(d,'state.json'),'utf8'),original);
 }finally{fs.rmSync(d,{recursive:true});}
});
test('Missing checkpoint is zero observations; invalid checkpoint fails closed',()=>{
 const d=fs.mkdtempSync(path.join(os.tmpdir(),'failed-evidence-'));try{
 a.equal(failedJob(d,Error('HTTP failure'),[]).received,0);fs.writeFileSync(path.join(d,'state.json'),JSON.stringify({received:-1,pages:[]}));a.throws(()=>failedJob(d,Error('bad'),[]),/valid committed/);
 fs.writeFileSync(path.join(d,'state.json'),JSON.stringify({received:1,pages:[{file:'../escape'}]}));a.throws(()=>failedJob(d,Error('bad'),[]),/invalid evidence/);
 }finally{fs.rmSync(d,{recursive:true});}
});
