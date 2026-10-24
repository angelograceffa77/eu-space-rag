'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const origin='https://in-tendhost.co.uk',pageUrl=origin+'/eso/aspx/Tenders/Current';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function searchUrl(page=1){const u=new URL(origin+'/eso/aspx/Services/Projects.svc/GetProjects');for(const[k,v]of Object.entries({strMode:'Current',searchvalue:'',bUseSearch:false,OrderBy:'Title',OrderDirection:'ASC',iPage:page,iPageSize:10,bOnlyWithCorrespondenceAllowed:false,iCustomerFilter:0,iOptInStatus:-1}))u.searchParams.set(k,String(v));return u.href;}
function parse(raw,url){
 const u=new URL(url),expected=new URL(searchUrl(Number(u.searchParams.get('iPage'))));
 if(u.origin!==origin||u.pathname!==expected.pathname||u.searchParams.size!==expected.searchParams.size||[...expected.searchParams].some(([k,v])=>u.searchParams.get(k)!==v))throw Error('ESO current scope changed');
 const payload=JSON.parse(raw),d=payload.d||payload,page=Number(u.searchParams.get('iPage'));
 if(d.Error||!Number.isSafeInteger(page)||page<1||!Array.isArray(d.Data)||!Number.isSafeInteger(d.RecordCount)||d.RecordCount<0||d.PageSize!==10||!Number.isSafeInteger(d.PageCount)||d.PageCount!==Math.max(1,Math.ceil(d.RecordCount/10))&&!(d.RecordCount===0&&d.PageCount===0))throw Error('ESO current listing schema changed');
 if(d.Data.length!==Math.min(10,Math.max(0,d.RecordCount-(page-1)*10)))throw Error('ESO page count mismatch');
 const rows=d.Data.map(x=>{if(!Number.isSafeInteger(x.ProjectID)||x.ProjectID<1||!x.Title||!x.Reference)throw Error('ESO identity missing');return {reference:String(x.ProjectID),title:x.Title,description:x.Description||'',buyer:x.Customer||'European Southern Observatory',sourceUrl:origin+'/eso/aspx/ProjectManage/'+x.ProjectID,stage:/Advanced Information|scheduled to be issued|will be released/i.test(x.Type+' '+x.Description)?'prior information':'unverified procurement stage',status:'unverified',sourceRow:x,cells:[x.Reference,x.Title,x.Description||'',x.Type||''],links:[]};});
 if(new Set(rows.map(r=>r.reference)).size!==rows.length)throw Error('ESO duplicate identity');
 return {rows,reportedTotal:d.RecordCount,nextUrl:page<d.PageCount?searchUrl(page+1):null};
}
async function collect(j,dir,options){
 fs.mkdirSync(dir,{recursive:true});const response=await fetch(pageUrl,{signal:AbortSignal.timeout(45000)}),raw=Buffer.from(await response.arrayBuffer());
 const hash=sha(raw),name='scope-'+hash+'.html';if(!fs.existsSync(path.join(dir,name)))fs.writeFileSync(path.join(dir,name),raw,{flag:'wx'});
 if(response.status!==200||response.url!==pageUrl||!raw.includes(Buffer.from("var vLastMode = 'Current'")))throw Error('ESO public current page unavailable or scope changed');
 const cookie=response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 const result=await require('./institution-intake.cjs').collect(j,dir,{...options,fetchPage:req=>{const u=new URL(req.url);if(u.origin!==origin||u.pathname!=='/eso/aspx/Services/Projects.svc/GetProjects')throw Error('ESO session cannot leave the public listing');return options.fetchPage({...req,init:{method:'GET',headers:{'content-type':'application/json; charset=utf-8',cookie}}});}});
 result.scopeEvidence=[...(result.scopeEvidence||[]),{file:name,sha256:hash,url:pageUrl,retrievedAt:new Date().toISOString()}].filter((p,i,a)=>a.findIndex(q=>q.sha256===p.sha256)===i);
 result.scopeWarnings=['Current catalogue includes advance information and selective supplier invitations.','DateDocsAvailableUntil is not a verified bid deadline; no current row is automatically admitted as open.','Login-only documents and invitation status remain unavailable to the public collector.'];
 require('../../orchestration/atomic-state.cjs').write(path.join(dir,'state.json'),result);return result;
}
function jobs(day){return [{id:'institution-ESO-current',kind:'esoCurrent',day,parser:'eso-current',url:searchUrl(),limitations:['Official public Current catalogue, no keyword or publication-date filter; source counts reconciled.','Candidate discovery only: future/closed-selective procedures and access deadlines are not verified open bidding.','Account-only invitations and documents remain gaps.']}];}
module.exports={parse,collect,jobs,searchUrl};
