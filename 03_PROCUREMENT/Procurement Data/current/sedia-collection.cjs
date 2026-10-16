'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{write}=require('../orchestration/atomic-state.cjs');
const epoch=0,horizon=Date.UTC(2100,0,1),day=86400000;
function filterFor(part){if(!part||part.kind==='all')return null;if(part.kind==='outside')return {bool:{must_not:[{range:{startDate:{gte:epoch,lte:horizon-1}}}]}};return {range:{startDate:{gte:part.from,lte:part.to-1}}};}
function split(part){if(part.kind==='all')return [{kind:'range',from:epoch,to:Date.UTC(2020,0,1)},{kind:'range',from:Date.UTC(2020,0,1),to:horizon},{kind:'outside'}];if(part.kind!=='range'||part.to-part.from<=day)throw Error('SEDIA partition remains above the result window; manual source investigation required');const mid=Math.floor((part.from+part.to)/2/day)*day;return [{kind:'range',from:part.from,to:mid},{kind:'range',from:mid,to:part.to}];}
async function collect({terms,size,output,searchPage,accept,windowLimit=9000}){
 const file=path.join(output,'sedia-collection-state.json'),config=JSON.stringify({terms,size,windowLimit,version:1});
 let state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{config,startedAt:new Date().toISOString(),queue:terms.map(term=>({term,kind:'all',page:1,received:0,total:null,fingerprints:[]})),completed:[],records:[],state:'running'};
 if(state.config!==config)throw Error('SEDIA resume configuration differs');
 try{while(state.queue.length){const part=state.queue[0];console.log('SEDIA '+part.term+' '+part.kind+' '+(part.from??'')+' page '+part.page);const data=await searchPage(part.term,part.page,part);
  if(part.total!==null&&data.totalResults!==part.total)throw Error('SEDIA advertised total changed during partition; checkpoint retained');
  if(part.page===1&&data.totalResults>windowLimit){const children=split(part).map(p=>({...p,term:part.term,page:1,received:0,total:null,fingerprints:[]}));state.completed.push({...part,state:'split',total:data.totalResults});state.queue.splice(0,1,...children);write(file,state);continue;}
  part.total??=data.totalResults;const expected=Math.min(size,Math.max(0,part.total-(part.page-1)*size));if(data.results.length!==expected)throw Error('SEDIA partition ended before its advertised total');
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify(data.results)).digest('hex');if(data.results.length&&part.fingerprints.includes(fingerprint))throw Error('Repeated SEDIA result page');
  part.fingerprints.push(fingerprint);part.received+=data.results.length;state.records.push(...data.results.filter(accept));
  if(part.received===part.total){state.completed.push({...part,state:'reconciled',finishedAt:new Date().toISOString()});state.queue.shift();}else part.page++;
  state.state='running';delete state.error;write(file,state);
 }
 state.queryReconciliation=terms.map(term=>{const parts=state.completed.filter(p=>p.term===term),advertised=parts.find(p=>p.kind==='all')?.total,received=parts.filter(p=>p.state==='reconciled').reduce((sum,p)=>sum+p.received,0);return {term,advertised,received,matched:advertised===received};});
 if(state.queryReconciliation.some(q=>!q.matched))throw Error('SEDIA partition union does not match the original advertised query total');
 state.state='reconciled';state.finishedAt=new Date().toISOString();write(file,state);return state.records;
 }catch(e){state.state='partial';state.error=e.message;write(file,state);throw e;}
}
module.exports={collect,filterFor,split};
