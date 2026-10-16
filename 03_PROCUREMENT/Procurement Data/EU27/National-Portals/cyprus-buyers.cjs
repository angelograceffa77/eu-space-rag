'use strict';
const fs=require('fs'),path=require('path'),cheerio=require('cheerio');
const {classify,clean}=require('./core.cjs'),{parsePage}=require('./adapters.cjs');
function nextNoticePages(html,url){const $=cheerio.load(html);return $('#nextNav[href]:not([disabled])').map((i,e)=>new URL($(e).attr('href'),url).href).get();}
function listingDates(html){const $=cheerio.load(html);return $('a[href*="viewPublishedContractNotice.do"]').map((i,e)=>{const m=clean($(e).closest('tr').find('td').last().text()).match(/^(\d{2})\/(\d{2})\/(\d{4})/);return m?m[3]+'-'+m[2]+'-'+m[1]:'';}).get();}
function beforeStart(dates,from){return dates.length>0&&dates.every((d,i)=>d&&d<from&&(!i||d<=dates[i-1]));}
async function cyprusBuyers(ctx){
 const origin=new URL(ctx.source.url).origin;
 const profiles=new Set(),seenDetails=new Set(),seenLists=new Set(),queue=[],seeds=[...new Set([...(ctx.source.seeds||[]),...(ctx.options.seeds?.[ctx.source.id]||[])])],cache=new Map();let unrecognized=0,cached=0;
 if(ctx.options.rawCacheDir){const log=path.join(ctx.options.rawCacheDir,'requests.jsonl');if(fs.existsSync(log))for(const line of fs.readFileSync(log,'utf8').trim().split('\n').filter(Boolean)){const x=JSON.parse(line);if(x.sourceId===ctx.source.id)cache.set(x.url,x);}}
 async function get(url){const old=cache.get(url),file=old&&path.join(ctx.options.rawCacheDir,old.file);if(file&&fs.existsSync(file)){ctx.recordRequest();cached++;const buffer=fs.readFileSync(file);fs.writeFileSync(path.join(ctx.rawDir,old.file),buffer);fs.appendFileSync(path.join(ctx.rawDir,'requests.jsonl'),JSON.stringify({...old,cacheReusedAt:new Date().toISOString()})+'\n');return {body:buffer.toString('utf8'),buffer,rawFile:'raw/'+old.file};}return ctx.get(url);}
 async function detail(url){if(seenDetails.has(url)||!ctx.canFetch())return;seenDetails.add(url);try{const r=await get(url),$=cheerio.load(r.body),row=parsePage(r.body,url,ctx.source).row;if(row.noticeVerified)ctx.emit(row,r.rawFile);else unrecognized++;$('a[href*="prepareViewCAOrganisation.do"]').each((i,e)=>profiles.add(new URL($(e).attr('href'),url).href));}catch(e){ctx.gap('Public detail '+url+': '+e.message);}}
 // Refresh the buyer seed register from the same official annual exports used
 // for award history. Failure keeps the bundled public seeds usable.
 if(ctx.source.id==='CY-portal'&&!ctx.options.seedsFile)try{await require('./cyprus-open-data.cjs').cyprusAwards({...ctx,emit:r=>{if(!seeds.includes(r.sourceUrl))seeds.push(r.sourceUrl);},gap:m=>{if(!m.startsWith('Official annual award CSVs checked'))ctx.gap('Award seed discovery: '+m);}});}catch(e){ctx.gap('Award seed discovery failed; bundled seeds retained: '+e.message);}
 for(const url of seeds){if(url.includes('prepareViewCfTWS.do'))await detail(url);else if(url.includes('prepareViewCAOrganisation.do'))profiles.add(url);else if(url.includes('viewPublishedContractNotice.do')){const id=new URL(url).searchParams.get('resourceId');if(id)await detail(origin+'/epps/cft/prepareViewCfTWS.do?resourceId='+id);}}
 for(const url of profiles){if(!ctx.canFetch())break;try{const r=await get(url),$=cheerio.load(r.body);$('a[href*="viewPublishedNotices.do"]').each((i,e)=>{const u=new URL($(e).attr('href'),url);u.searchParams.set('d-446978-s','datePublished');u.searchParams.set('d-446978-o','1');u.searchParams.set('d-446978-n','1');if(['MT','CY'].includes(ctx.source.country))u.searchParams.set('T01_ps','100');queue.push(u.href);});}catch(e){ctx.gap('Buyer profile '+url+': '+e.message);}}
 let index=0;while(index<queue.length&&ctx.canFetch()){
  const url=queue[index++],u=new URL(url),key=(u.searchParams.get('authorityId')||'')+'|'+(u.searchParams.get('d-446978-p')||'1');if(seenLists.has(key))continue;seenLists.add(key);
  try{const r=await get(url),$=cheerio.load(r.body);for(const e of $('a[href*="viewPublishedContractNotice.do"]').toArray()){const a=$(e),href=new URL(a.attr('href'),url),title=clean(a.closest('tr').find('td').eq(1).text());if(classify(title,'').relevance==='unrelated')continue;const id=href.searchParams.get('resourceId');if(id)await detail(origin+'/epps/cft/prepareViewCfTWS.do?resourceId='+id);}
   if(!beforeStart(listingDates(r.body),ctx.options.from))queue.push(...nextNoticePages(r.body,url));
  }catch(e){ctx.gap('Published buyer notices '+url+': '+e.message);}
 }
 if(index<queue.length)ctx.gap('Buyer-notice request budget reached before all linked pages were checked');
 if(unrecognized)ctx.gap(unrecognized+' seeded or linked detail pages did not expose a recognized public notice; these pages are not counted as verified notices.');
 if(cached)ctx.gap(cached+' responses explicitly reused from the supplied raw cache; original retrieval timestamps are preserved in requests.jsonl.');
 fs.writeFileSync(path.join(ctx.rawDir,ctx.source.id+'-buyer-reconciliation.json'),JSON.stringify({seedDetails:seeds.length,detailsChecked:seenDetails.size,buyerProfiles:profiles.size,listPages:seenLists.size,unrecognized,cached,remainingQueued:queue.length-index},null,2));
 ctx.gap(ctx.source.country==='MT'?'Public linked buyer notice lists were checked from bundled official notice and buyer-profile seeds, newest first back to the requested start date. National search requires CAPTCHA. Unseeded buyers, description-only matches and unpublished notices remain gaps. The separate contracts.gov.mt annual award-PDF archive returned HTTP 403 through direct and browser access during the 5 October 2026 audit and is not included by this adapter.':ctx.source.id==='CY-space'?'The Department of Electronic Communications public procurement profile was checked through linked notices back to the requested start date. Its separate gov.cy information pages returned HTTP 403 during this audit. Description-only matches, other agencies and ESA PECS calls are not exhaustive in this buyer-profile route.':'Public buyer profiles and notice lists identified through 2020 onward award seeds were followed in descending publication order back to the requested start date. National CAPTCHA-restricted search was not used. New buyers absent from the award exports and description-only matches remain outside this route.');
}
module.exports={cyprusBuyers,eppsBuyers:cyprusBuyers,nextNoticePages,listingDates,beforeStart};


