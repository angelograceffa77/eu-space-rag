'use strict';
const fs=require('node:fs'),path=require('node:path'),{hashFile}=require('../master/util.cjs');
function reconciledEmpty(s){return s.state==='reconciled'&&Array.isArray(s.records)&&s.records.length===0&&Array.isArray(s.queryReconciliation)&&s.queryReconciliation.length>0&&s.queryReconciliation.every(q=>q.matched===true&&q.advertised===0&&q.received===0);}
async function receipt(outputs){const item=outputs.find(x=>path.basename(x.file)==='sedia-collection-state.json');if(!item)return null;if(await hashFile(item.file)!==item.sha256)throw Error('Empty-result evidence changed');return reconciledEmpty(JSON.parse(fs.readFileSync(item.file)))?{file:item.file,sha256:item.sha256,kind:'reconciled_sedia_zero'}:null;}
async function verify(job){if(!job.emptyResult||!['validated','partial','unassessed'].includes(job.state))return false;const r=job.emptyResult;if(r.kind!=='reconciled_sedia_zero'||await hashFile(r.file)!==r.sha256)throw Error('Invalid empty-result receipt');return reconciledEmpty(JSON.parse(fs.readFileSync(r.file)));}
module.exports={reconciledEmpty,receipt,verify};
