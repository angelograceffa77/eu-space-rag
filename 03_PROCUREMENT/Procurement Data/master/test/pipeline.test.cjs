'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {update}=require('../../update-procurement.cjs');
test('one-command pipeline passes collection output to master and retains failure status',async()=>{const root=path.resolve(__dirname,'../..'),calls=[];const result=await update(['--only=example'],root,{run:async o=>{calls.push(['collect',o.runDir]);return {status:'partial-failure'};},build:async o=>{calls.push(['master',o.runDir]);assert.equal(o.root,root);return {generation:'test'};}});assert.deepEqual(calls.map(c=>c[0]),['collect','master']);assert.equal(calls[0][1],calls[1][1]);assert.equal(result.status,'partial-failure');});
test('listing collectors never builds a master',async()=>{let built=false;await update(['--list'],path.resolve(__dirname,'../..'),{run:async()=>({jobs:[]}),build:async()=>{built=true;}});assert.equal(built,false);});
