'use strict';
const fs=require('node:fs'),path=require('node:path'),cheerio=require('cheerio');
const {classify,clean}=require('./core.cjs'),{parsePage}=require('./adapters.cjs');
const base='https://www.eprocurement.gov.cy/epps/notices/viewPublishedNotices.do';
function date(value){const m=clean(value).match(/^(\d{2})\/(\d{2})\/(\d{4})/);return m?`${m[3]}-${m[2]}-${m[1]}`:'';}
function parseListing(html,url){
 const $=cheerio.load(html),rows=[];
 $('#T01 tbody tr').each((i,tr)=>{const cells=$(tr).find('td'),a=cells.eq(0).find('a[href*="viewPublishedContractNotice.do"]').first();if(!a.length)return;const noticeUrl=new URL(a.attr('href'),url),resourceId=noticeUrl.searchParams.get('resourceId');if(!resourceId)return;rows.push({resourceId,noticeId:noticeUrl.searchParams.get('noticeId')||'',noticeUrl:noticeUrl.href,type:clean(a.text()),title:clean(cells.eq(1).text()),createdDate:date(cells.eq(2).text()),language:clean(cells.eq(3).text()),publishedState:clean(cells.eq(4).text()),publicationDate:date(cells.eq(5).text())});});
 const text=clean($('.table-pagination').first().text()),totalText=text.match(/([\d,.]+)\s*(?:συνολικών|(?:results\s+in\s+)?total)/i)?.[1],total=totalText?Number(totalText.replace(/[,.]/g,'')):null;
 const next=$('#nextNav[href]:not([disabled])').first().attr('href');let nextUrl=next?new URL(next,url).href:null;
 if(nextUrl&&(new URL(nextUrl).origin!==new URL(url).origin||new URL(nextUrl).pathname!==new URL(url).pathname))throw Error('Unexpected published-list pagination target');
 if(total===null||!Number.isInteger(total)||(!rows.length&&total!==0))throw Error('Unrecognized ePPS public published-notice listing');
 return {rows,total,nextUrl};
}
async function cyprusPublished(ctx){
 const base=ctx.source.url?.includes("/epps/notices/viewPublishedNotices.do")?ctx.source.url:"https://www.eprocurement.gov.cy/epps/notices/viewPublishedNotices.do";
 const cache=new Map();let cached=0,liveSupplement=0;
 if(ctx.options.rawCacheDir)for(const line of fs.readFileSync(path.join(ctx.options.rawCacheDir,'requests.jsonl'),'utf8').split('\n').filter(Boolean)){const item=JSON.parse(line);if(item.sourceId===ctx.source.id)cache.set(item.url,item);}
 async function get(url){if(!ctx.options.rawCacheDir)return ctx.get(url);const item=cache.get(url);if(!item){if(process.env.PROCUREMENT_REPLAY_FETCH_MISSING==='1'&&['/epps/cft/prepareViewCfTWS.do','/epps/notices/viewPublishedContractNotice.do'].includes(new URL(url).pathname)){liveSupplement++;return ctx.get(url);}throw Error('Requested URL absent from explicit raw capture: '+url);}if(path.basename(item.file)!==item.file)throw Error('Invalid cached filename');ctx.recordRequest();cached++;const body=fs.readFileSync(path.join(ctx.options.rawCacheDir,item.file));fs.writeFileSync(path.join(ctx.rawDir,item.file),body);fs.appendFileSync(path.join(ctx.rawDir,'requests.jsonl'),JSON.stringify({...item,cacheReusedAt:new Date().toISOString()})+'\n');return {buffer:body,body:body.toString('utf8'),rawFile:'raw/'+item.file};}
 const sortField=ctx.source.sortField||'datePublished';if(!['datePublished','dateCreated'].includes(sortField))throw Error('Unsupported published-list sort');
 let url=base+'?d-446978-s='+sortField+'&d-446978-o=1&d-446978-n=1&d-446978-p=1&T01_ps=100';
 const seenPages=new Set(),seenNotices=new Set(),seenDetails=new Set(),totals=new Set(),errors=[];
 const audit={source:base,sortField,startedAt:new Date().toISOString(),pages:0,listedRows:0,uniqueNotices:0,duplicateListingRows:0,matchedProcedures:0,detailsVerified:0,publicNoticePdfs:0,publicNoticePdfErrors:[],detailErrors:errors,stoppedBefore2020:false,completeListing:false,missingPublicationDates:0,missingTitles:0,publicationYears:{}};
 const index=path.join(ctx.rawDir,ctx.source.id+'-index.jsonl');let previousDate=null,ordered=true;
 try{while(url&&ctx.canFetch()){
  const r=await get(url),page=parseListing(r.body,url),signature=page.rows.map(x=>x.noticeUrl).join('|');
  if(seenPages.has(signature)&&page.rows.length)throw Error('Repeated ePPS published-list page');seenPages.add(signature);totals.add(page.total);audit.pages++;audit.listedRows+=page.rows.length;
  for(const item of page.rows){
   fs.appendFileSync(index,JSON.stringify({...item,listingUrl:url,rawFile:r.rawFile})+'\n');
   if(!item.title)audit.missingTitles++;
   const year=item.publicationDate.slice(0,4)||'unknown';audit.publicationYears[year]=(audit.publicationYears[year]||0)+1;
   if(!item.publicationDate)audit.missingPublicationDates++;
   const orderingDate=sortField==='dateCreated'?item.createdDate:item.publicationDate;
   if(orderingDate){if(previousDate&&orderingDate>previousDate)ordered=false;previousDate=orderingDate;}
   if(seenNotices.has(item.noticeUrl)){audit.duplicateListingRows++;continue;}seenNotices.add(item.noticeUrl);
   const scopeDate=item.publicationDate||item.createdDate;
   if(scopeDate&&(scopeDate<ctx.options.from||scopeDate>ctx.options.to))continue;
   if(classify(item.title,'').relevance==='unrelated'||seenDetails.has(item.resourceId))continue;
   if(!ctx.canFetch()){ctx.gap('Request budget reached before all matching details were fetched');break;}
   seenDetails.add(item.resourceId);audit.matchedProcedures++;
   const detailUrl=new URL('/epps/cft/prepareViewCfTWS.do?resourceId='+encodeURIComponent(item.resourceId),base).href;
   try{const detail=await get(detailUrl),row=parsePage(detail.body,detailUrl,ctx.source).row;if(!row.noticeVerified)throw Error(/name=["']username|Enter Username &amp; Password|Enter Username & Password/i.test(detail.body)?'Tender workspace requires login':'No recognized tender detail fields');
    // Keep original publication data; scope can include a later published amendment/award.
    ctx.emit({...row,scopeDate:scopeDate||row.publicationDate,sourceUpdated:item.publicationDate||row.sourceUpdated},detail.rawFile);audit.detailsVerified++;
   }catch(e){errors.push({resourceId:item.resourceId,url:detailUrl,error:e.message});ctx.gap('Published-notice detail '+item.resourceId+': '+e.message);let fallback={noticeId:item.noticeId,procedureId:item.resourceId,title:item.title,sourceUrl:item.noticeUrl,publicationDate:item.publicationDate,scopeDate,noticeType:/award|συναφθείσας/i.test(item.type)?'award':'tender',sourceStatus:item.publishedState,noticeVerified:false},fallbackRaw=r.rawFile;
    if(ctx.source.country==='MT'&&ctx.canFetch())try{const doc=await get(item.noticeUrl),buffer=doc.buffer||Buffer.from(doc.body);if(buffer.subarray(0,4).toString()!=='%PDF')throw Error('Public notice response is not PDF');const text=await require('./documents.cjs').pdfText(buffer);if(text.length<100||!/contract|procurement|tender/i.test(text))throw Error('No recognized procurement text in PDF');fallback={...fallback,...publicPdfFields(text),documents:item.noticeUrl};fallbackRaw=doc.rawFile;audit.publicNoticePdfs++;}catch(pdfError){audit.publicNoticePdfErrors.push({resourceId:item.resourceId,error:pdfError.message});ctx.gap('Public notice PDF '+item.resourceId+': '+pdfError.message);}
    ctx.emit(fallback,fallbackRaw);}
  }
  audit.uniqueNotices=seenNotices.size;
  const old=page.rows.length&&page.rows.every(x=>{const d=sortField==='dateCreated'?x.createdDate:x.publicationDate;return d&&d<ctx.options.from;});
  if(old&&ordered){audit.stoppedBefore2020=true;break;}
  url=page.nextUrl;if(!url)audit.completeListing=true;
 }
 if(url&&!audit.stoppedBefore2020)ctx.gap('Published-notice traversal stopped before the requested range was exhausted');
 if(totals.size>1)ctx.gap('Published-notice advertised total changed during collection; pagination may have shifted');
 if(audit.duplicateListingRows)ctx.gap(audit.duplicateListingRows+' repeated listing rows across pages; stable total alone does not prove complete coverage. Combine publication-date and creation-date passes.');
 if(!ordered)ctx.gap('Published dates were not monotonically descending; all accessible pages were traversed instead of applying a date cutoff');
 if(audit.completeListing&&totals.size===1&&audit.uniqueNotices!==[...totals][0])ctx.gap('Unique listing notice count does not match advertised total');
 ctx.gap('All-buyer public published-notice catalogue screened by title, with matching tender details fetched. This is independent of CAPTCHA-protected search. Description-only and attachment-only matches, unpublished notices and restricted documents remain outside discovery. Publication events and raw pages are retained separately; publication does not mean bidding is open.');
 if(audit.missingPublicationDates)ctx.gap(audit.missingPublicationDates+' listing rows have no publication date; creation date was used only for scope filtering, without changing source publication dates.');
 if(audit.missingTitles)ctx.gap(audit.missingTitles+' listing rows have no title, so their relevance could not be screened; their metadata and source pages are retained in the listing index.');
 }finally{if(cached)ctx.gap(cached+' saved responses reprocessed from the explicitly supplied fresh capture; original retrieval timestamps retained. '+liveSupplement+' previously uncaptured matching details requested live under the explicit supplement option.');audit.cachedResponses=cached;audit.liveSupplementRequests=liveSupplement;audit.finishedAt=new Date().toISOString();audit.advertisedTotals=[...totals];audit.descendingDates=ordered;audit.nextUrl=url;fs.writeFileSync(path.join(ctx.rawDir,ctx.source.id+'-reconciliation.json'),JSON.stringify(audit,null,2));}
}
function publicPdfFields(text){
 const normalized=text.replace(/\u00ad/g,'-').replace(/\u00a0/g,' '),lots=new Set(normalized.match(/LOT-\d+/g)||[]);
 const closedWithoutWinner=/No winner was chosen and the competition is closed/i.test(normalized)&&lots.size<=1;
 return {description:text,noticeVerified:false,...(closedWithoutWinner?{noticeType:'result',sourceStatus:'closed'}:{})};
}
module.exports={cyprusPublished,parseListing,publicPdfFields};
