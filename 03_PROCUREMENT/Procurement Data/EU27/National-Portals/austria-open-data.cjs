'use strict';
const fs=require('fs'),path=require('path'),cheerio=require('cheerio'),core=require('./core.cjs');
function decodeSource(bytes){const b=Buffer.from(bytes);if(b[0]===255&&b[1]===254)return new TextDecoder('utf-16le').decode(b);if(b[0]===254&&b[1]===255)return new TextDecoder('utf-16be').decode(b);const head=b.subarray(0,160).toString('ascii'),encoding=head.match(/encoding=["']([^"']+)/i)?.[1]||'utf-8';return new TextDecoder(encoding,{fatal:true}).decode(b);}
function parseXML(xml,{id,url,row,lastmod}={}){
 const $=cheerio.load(xml,{xmlMode:true}),els=(name,ctx=$.root())=>ctx.find('*').filter((i,e)=>e.name.split(':').pop()===name),txt=(name,ctx)=>core.clean(els(name,ctx).first().text()),all=(name,ctx)=>els(name,ctx).map((i,e)=>core.clean($(e).text())).get(),root=$.root().children().first(),kind=root[0]?.name?.split(':').pop();
 if(!kind||/html|error/i.test(kind))throw Error('Not a procurement XML document');
 let title,description,buyer,cpv,deadline='',publication='',award=false,planning=false,cancelled=false,value='',currency='',documents=[],scopeDate='';
 if(kind.startsWith('KD_')){
  title=txt('TITLE');description=[...new Set(all('SHORT_DESCR'))].join('\n');buyer=txt('OFFICIALNAME',els('ADDRESS_CONTRACTING_BODY').first());
  cpv=[...new Set(els('CPV_CODE').map((i,e)=>$(e).attr('CODE')).get())].join(' | ');
  const d=txt('DATE_RECEIPT_TENDERS')||txt('DATE_RECEIPT_REQUESTS'),t=txt('TIME_RECEIPT_TENDERS')||txt('TIME_RECEIPT_REQUESTS');deadline=txt('DATETIME_RECEIPT_TENDERS')||txt('DATETIME_RECEIPT_REQUESTS')||d+(d&&t?'T'+t:'');
  award=els('AWARD_CONTRACT').length>0;planning=kind.includes('Z1')&&els('DATE_START_WORK').length>0&&!award;cancelled=els('NO_AWARDED_CONTRACT').length>0||els('PROCUREMENT_DISCONTINUED').length>0;
  const val=els('VAL_TOTAL').first().length?els('VAL_TOTAL').first():els('VAL_ESTIMATED_TOTAL').first();value=core.clean(val.text());currency=val.attr('CURRENCY')||'';
  publication=txt('DATE_FIRST_PUBLICATION')||txt('DATE_PUBLICATION_NOTICE')||txt('DATE_DISPATCH_NOTICE');scopeDate=txt('DATE_CONCLUSION_CONTRACT');documents=all('URL').filter(x=>/^https?:/.test(x)).concat(all('URL_DOCUMENT')) .concat(all('URL_PARTICIPATION'),all('URL_GENERAL'));
 }else if(['ContractNotice','ContractAwardNotice','PriorInformationNotice'].includes(kind)){
  const project=root.children().filter((i,e)=>e.name.split(':').pop()==='ProcurementProject').first();
  title=txt('Name',project);description=[...new Set(all('Description',project).concat(all('Description',els('ProcurementProjectLot'))))].join('\n');
  const party=els('ContractingParty').first(),buyerId=txt('ID',els('PartyIdentification',party));let company=els('Company').filter((i,e)=>txt('ID',els('PartyIdentification',$(e)))===buyerId).first();buyer=txt('Name',els('PartyName',company.length?company:party));
  cpv=[...new Set(all('ItemClassificationCode').filter(x=>/^\d{8}$/.test(x)))].join(' | ');publication=txt('IssueDate').slice(0,10);
  const periods=els('TenderSubmissionDeadlinePeriod').length?els('TenderSubmissionDeadlinePeriod'):els('ParticipationRequestReceptionPeriod');
  const dates=periods.map((i,e)=>{const d=txt('EndDate',$(e)),t=txt('EndTime',$(e));return d.slice(0,10)+(t?'T'+t:'')}).get().filter(Boolean);deadline=[...new Set(dates)].sort()[0]||'';
  award=kind==='ContractAwardNotice';planning=kind==='PriorInformationNotice';cancelled=all('TenderResultCode').some(x=>/cancel|discon/i.test(x));
  const val=els('EstimatedOverallContractAmount').first().length?els('EstimatedOverallContractAmount').first():els('TotalAmount').first();value=core.clean(val.text());currency=val.attr('currencyID')||'';documents=all('URI').filter(x=>/^https?:/.test(x));
 }else throw Error('Unsupported notice XML root: '+kind);
 if(!title)throw Error('Missing XML notice title');
 return {noticeId:id,procedureId:id,title,description:description||title,buyer:buyer||row?.[1]||'',publicationDate:row?.[2]||publication,sourceUpdated:row?.[2]||publication||lastmod?.slice(0,10)||'',scopeDate:!publication&&!row?.[2]?scopeDate:'',deadlineRaw:deadline||row?.[3]||row?.[6]||'',noticeType:award?'award':planning?'planning':deadline||row?.[3]||row?.[6]?'tender':'unknown',sourceStatus:cancelled?'cancelled':award?'awarded':'',cpv,value,currency,documents:[...new Set(documents)],noticeVerified:true,sourceUrl:url?.replace(/^http:\/\/ogd.ankoe/,'https://ogd.ankoe')};
}
async function collectOpenData(dir,state,{from='2020-01-01',to=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Vienna'}).format(new Date())}={}){
 fs.mkdirSync(path.join(dir,'raw'),{recursive:true});const file=path.join(dir,'checkpoint.json'),s=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{feeds:{},details:{},errors:[],requests:0},save=()=>fs.writeFileSync(file,JSON.stringify(s)),blocked=new Set();
 async function get(url){url=url.replace(/^http:\/\/ogd.ankoe/,'https://ogd.ankoe');const f=path.join(dir,'raw',core.hash(url)+'.xml');if(fs.existsSync(f)){const body=fs.readFileSync(f,'utf8');if(!body.includes('\u0000'))return {body,rawFile:f};if(!fs.existsSync(f+'.misdecoded'))fs.copyFileSync(f,f+'.misdecoded');}const host=new URL(url).host;if(blocked.has(host))throw Error('Host access refused earlier; not retried');await new Promise(r=>setTimeout(r,400));const res=await fetch(url,{signal:AbortSignal.timeout(40000)});s.requests++;if(!res.ok){if([401,403,429].includes(res.status))blocked.add(host);throw Error('HTTP '+res.status);}const bytes=Buffer.from(await res.arrayBuffer());fs.writeFileSync(f+'.source',bytes);const body=decodeSource(bytes);fs.writeFileSync(f,body);return {body,rawFile:f};}
 const publishers=[...new Set(Object.keys(state.listings).map(id=>id.slice(0,36)))];
 async function publisherRun(publisher){try{
  const meta=await get('https://www.data.gv.at/api/hub/search/datasets/'+publisher),m=JSON.parse(meta.body),urls=m.result.distributions.flatMap(x=>x.access_url||[]),index=[];
  for(const url of urls){const f=await get(url),$=cheerio.load(f.body,{xmlMode:true});$('item').each((i,e)=>index.push({itemId:$(e).attr('id'),url:$(e).find('url').text(),lastmod:$(e).attr('lastmod'),feed:url,rawFile:f.rawFile}));}
  if(!index.length)throw Error('Unexpected empty publisher index');const map=new Map();for(const item of index){for(const key of [item.itemId,'KD_'+item.itemId,decodeURIComponent(item.url.split('/').at(-1).replace(/\.xml$/,''))])map.set(key,item);}
  const canonicalByUrl=new Map();for(const [id,entry]of Object.entries(state.listings)){if(id.startsWith(publisher)){const item=map.get(id.slice(37));if(item)canonicalByUrl.set(item.url,id);}}const jobs=[];for(const [id,entry]of Object.entries(state.listings)){if(!id.startsWith(publisher)||state.details[id]?.ok||s.details[id]?.ok)continue;const item=map.get(id.slice(37));if(item)jobs.push({id,entry,item});else s.details[id]={ok:false,error:'Notice absent from current official publisher index'};}
  const existing=new Set(jobs.map(j=>j.item.url));for(const item of index){if(item.lastmod?.slice(0,10)>=to&&item.lastmod.slice(0,10)<=to&&!existing.has(item.url)){const id=canonicalByUrl.get(item.url)||publisher+'-'+item.itemId;if(!s.details[id]?.ok&&!Object.keys(state.listings).some(k=>k===id&&state.details[k]?.ok)){jobs.push({id,item});existing.add(item.url);}}}
  s.feeds[publisher]={items:index.length,urls,metadata:meta.rawFile,jobs:jobs.length};save();console.log('publisher',publisher,'index',index.length,'pending',jobs.length);
  for(const {id,entry,item}of jobs){try{const f=await get(item.url),r=parseXML(f.body,{id,url:item.url,row:entry?.row,lastmod:item.lastmod}),date=r.publicationDate||r.scopeDate||r.sourceUpdated;if(date&&date>=from&&date<=to)s.details[id]={ok:true,record:r,rawFile:f.rawFile,feed:item.feed,listingMatched:!!entry};else s.details[id]={ok:true,excludedDate:date,rawFile:f.rawFile};}catch(e){s.details[id]={ok:false,error:e.message,url:item.url};s.errors.push({id,error:e.message,url:item.url});}if(Object.keys(s.details).length%50===0){save();console.log('XML details',Object.keys(s.details).length);} }save();
 }catch(e){s.feeds[publisher]={error:e.message};s.errors.push({publisher,error:e.message});save();}}
 let cursor=0;await Promise.all([0,1,2].map(async()=>{while(cursor<publishers.length)await publisherRun(publishers[cursor++]);}));save();return s;
}
async function recoverPortalDetails(dir,state,xml){
 const {parseNotice,normalizeAT}=require('./austria-public.cjs'),source=require('./sources.cjs').sources.find(x=>x.id==='AT-portal'),audit=[];
 for(const [id,entry]of Object.entries(state.listings)){if(state.details[id]?.ok||xml.details[id]?.ok)continue;const url='https://ausschreibungen.usp.gv.at/at.gv.bmdw.eproc-p/public/'+(entry.row[5]?'notice':'tender')+'-detail?object='+encodeURIComponent(id),rawFile=path.join(dir,'raw',core.hash(url)+'.txt');try{await new Promise(r=>setTimeout(r,2000));const response=await fetch(url,{signal:AbortSignal.timeout(45000)});state.requests++;if(!response.ok)throw Error('HTTP '+response.status);const body=await response.text();fs.writeFileSync(rawFile,body);const r=normalizeAT(parseNotice(body,entry.row),source,rawFile);state.details[id]={ok:true,rawFile,relevance:r.relevance,title:r.title,status:r.status,queries:entry.queries};audit.push({id,ok:true});}catch(e){audit.push({id,error:e.message});if(/HTTP (401|403|429)/.test(e.message))break;}}
 state.xmlFallbackRecovery=audit;fs.writeFileSync(path.join(dir,'checkpoint.json'),JSON.stringify(state));return audit;
}
module.exports={parseXML,collectOpenData,recoverPortalDetails,decodeSource};
