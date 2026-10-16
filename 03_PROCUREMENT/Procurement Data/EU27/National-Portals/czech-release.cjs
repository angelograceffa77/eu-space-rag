'use strict';
const {normalize,latestRecords,fold,statusOf}=require('./core.cjs');
function nenId(r){return [r.sourceUrl,r.procedureId,r.noticeId,String(r.description||'').match(/External identifiers:.*?NEN:\s*(N\d{3}[-/]\d{2}[-/]V\d+)/i)?.[1]||''].join(' ').match(/N\d{3}[-/]\d{2}[-/]V\d+/i)?.[0]?.replace(/\//g,'-').toUpperCase()||'';}
function finalizeCzech(input,sources,now=new Date()){
 const rows=input.map(x=>{const s=sources.find(s=>s.id===x.sourceId);if(!s||s.country!=='CZ')throw Error('Czech release contains unknown/foreign source');const r=normalize({...x,sourceStatus:require('./czech-archive.cjs').state(x.sourceStatus)},s,x.rawFile,now);r.retrievedAt=x.retrievedAt||now.toISOString();return r;}).filter(r=>r.relevance!=='unrelated');
 const current=latestRecords(rows.filter(r=>r.sourceId!=='CZ-rvz')),byId=new Map(current.map(r=>[nenId(r),r]).filter(([id])=>id)),byTitle=new Map();
 for(const r of current){const key=fold(r.title)+'|'+fold(r.buyer),a=byTitle.get(key)||[];a.push(r);byTitle.set(key,a);}
 const audit=[];
 for(const r of latestRecords(rows).filter(r=>r.sourceId==='CZ-rvz'&&r.status==='open')){
  const matches=[...new Map((byTitle.get(fold(r.title)+'|'+fold(r.buyer))||[]).map(x=>[nenId(x)||x.sourceUrl,x])).values()],m=byId.get(nenId(r))||(matches.length===1?matches[0]:undefined),fresh=m&&m.retrievedAt.slice(0,10)===now.toISOString().slice(0,10);
  if(fresh&&m.noticeVerified){const old=r.deadlineRaw;r.sourceStatus=m.sourceStatus;r.deadlineRaw=m.deadlineRaw;r.deadline=m.deadline;r.deadlinePrecision=m.deadlinePrecision;r.noticeType=m.noticeType;r.description+=' Current portal verification: '+m.sourceUrl+'; verified '+m.retrievedAt+'; archive deadline: '+old+'.';[r.status,r.statusEvidence]=statusOf(r,now);audit.push({recordId:r.recordId,sourceUrl:r.sourceUrl,currentUrl:m.sourceUrl,status:r.status,deadline:r.deadline,verified:true});}
  else{r.noticeVerified=false;r.reviewEvidence=[r.reviewEvidence,'Future deadline appears in a monthly archive; no matching same-day live notice verified.'].filter(Boolean).join(' | ');[r.status,r.statusEvidence]=statusOf(r,now);audit.push({recordId:r.recordId,sourceUrl:r.sourceUrl,verified:false,reason:'No matching current public detail; retained for review outside OPEN'});}
 }
 return {rows,audit};
}
module.exports={finalizeCzech,nenId};
async function verifyArchiveLive(rows,sources,rawDir,options={},now=new Date()){
 const fs=require('fs'),path=require('path'),{parseDetail}=require('./czech-public.cjs'),source=sources.find(s=>s.id==='CZ-description'),seen=new Set(rows.filter(r=>r.sourceId!=='CZ-rvz'&&r.noticeVerified&&r.retrievedAt?.slice(0,10)===now.toISOString().slice(0,10)).map(nenId).filter(Boolean)),audit=[],added=[];
 const pending=latestRecords(rows.filter(r=>r.sourceId==='CZ-rvz').map(r=>normalize(r,sources.find(s=>s.id===r.sourceId),r.rawFile,now))).filter(r=>r.status==='open'&&nenId(r));fs.mkdirSync(rawDir,{recursive:true});
 for(const r of pending){const id=nenId(r);if(seen.has(id))continue;seen.add(id);const url='https://nen.nipez.cz/en/verejne-zakazky/detail-zakazky/'+id;try{await new Promise(resolve=>setTimeout(resolve,options.delay??1200));const response=await fetch(url,{headers:{'User-Agent':'EU27SpaceProcurementCollector/1.0 (public procurement research)'},signal:AbortSignal.timeout(options.timeout||90000)});if(!response.ok)throw Error('HTTP '+response.status);const html=await response.text(),file=path.resolve(rawDir,'CZ-live-verification-'+id+'.html');fs.writeFileSync(file,html);const record=normalize(parseDetail(html,url),source,file,now);added.push(record);audit.push({url,parsed:true,rawFile:file,recordId:record.recordId});}catch(e){audit.push({url,parsed:false,error:e.message});}}
 return {rows:[...rows,...added],audit};
}
module.exports.verifyArchiveLive=verifyArchiveLive;
