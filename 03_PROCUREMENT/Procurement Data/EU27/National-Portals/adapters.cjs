'use strict';
const cheerio=require('cheerio');
const {clean,fold,htmlText,classify,procurement,parseDate}=require('./core.cjs');
const {pdfText,textAsHtml}=require('./documents.cjs');
const local=(root,name)=>root.find('*').filter((i,e)=>e.name?.split(':').pop()===name);
const first=(root,name)=>clean(local(root,name).first().text());
function parseFeed(xml,source){
 const $=cheerio.load(xml,{xml:true});const entries=$('*').filter((i,e)=>['entry','item'].includes(e.name?.split(':').pop()));const rows=[];
 if(!$('*').filter((i,e)=>['feed','rss'].includes(e.name?.split(':').pop())).length)throw Error('Response is not an Atom/RSS feed');
 for(const e of entries.toArray()){
  const el=$(e);const es=source.adapter==='placsp';const content=first(el,'content')||first(el,'summary')||first(el,'description');
  const link=local(el,'link').filter((i,e)=>!$(e).attr('rel')||$(e).attr('rel')==='alternate').first();
  const title=first(el,'title');const url=link.attr('href')||link.text()||first(el,'guid');
  let deadline='',status='',kind='unknown',publication=first(el,'published')||first(el,'pubDate');
  if(es){
   status=first(el,'ContractFolderStatusCode');
   kind=['ADJ','RES'].includes(status)?'award':status==='PRE'?'planning':'tender';
   const period=local(el,'TenderSubmissionDeadlinePeriod').first();deadline=first(period,'EndDate');const time=first(period,'EndTime');if(deadline&&time)deadline+='T'+time;
   const issueDates=local(el,'IssueDate').map((i,x)=>$(x).text()).get().filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x)).sort();publication=issueDates[0]||'';
  }else if(source.adapter==='dlr'){
   deadline=htmlText(content).match(/(?:Angebotsfrist|Abgabefrist|Teilnahmefrist|Frist.*?Angebot)\s*:?\s*(\d{1,2}\.\d{1,2}\.\d{4}(?:\s+\d{1,2}:\d{2})?)/i)?.[1]||'';
   kind=/market consultation|markterkundung|prior information/i.test(title+' '+htmlText(content))?'planning':'tender';status=/widerruf|annull/i.test(title)?'cancelled':'';
  }else{
   deadline=content.match(/Sluitingsdatum:\s*([^|]+)/i)?.[1]?.trim()||'';
   const type=content.match(/Type publicatie:\s*([^|]+)/i)?.[1]?.trim()||'';
   // EForms 16-24 are competition; 25-40 results. Unknown forms need review.
   const n=Number(type.match(/^EF(\d+)$/)?.[1]);kind=n>=16&&n<=24?'tender':n>=25&&n<=40?'award':n>=1&&n<=9?'planning':'unknown';status=type;
  }
  const project=local(el,'ProcurementProject').first();
  rows.push({noticeId:first(el,'id')||url,procedureId:es?first(el,'id'):'',title,sourceUrl:url,
   description:es?clean([first(project,'Name'),...local(project,'Description').map((i,e)=>$(e).text()).get(),content].join(' ')):htmlText(content),
   buyer:es?first(local(el,'LocatedContractingParty').first(),'Name'):first(local(el,'author').first(),'name'),
   publicationDate:/^\d{4}-\d{2}-\d{2}/.test(publication)?publication.slice(0,10):Number.isFinite(Date.parse(publication))?new Date(publication).toISOString().slice(0,10):'',sourceUpdated:first(el,'updated'),deadlineRaw:deadline,sourceStatus:status,noticeType:kind,noticeVerified:true,
   cpv:es?[...new Set(local(el,'ItemClassificationCode').map((i,e)=>$(e).text()).get())].join(' | '):'',value:es?first(el,'EstimatedOverallContractAmount'):'',currency:es?local(el,'EstimatedOverallContractAmount').first().attr('currencyID')||'':'',
   documents:es?local(el,'URI').map((i,e)=>$(e).text()).get().join(' | '):''});
 }
 const next=$('*').filter((i,e)=>e.name?.split(':').pop()==='link'&&$(e).attr('rel')==='next').first().attr('href')||'';
 return {rows,next};
}
function parseBoamp(x){
 let data={};try{data=JSON.parse(x.donnees||'{}');}catch{}
 const text=JSON.stringify(data);const description=htmlText(Object.values(data.OBJET||{}).filter(x=>typeof x==='string').join(' '))||htmlText(text);
 const status=[x.nature,x.etat,x.sousnature].filter(Boolean).join(' ');
 return {noticeId:x.idweb,procedureId:x.contractfolderid||'',sourceUrl:x.url_avis||`https://www.boamp.fr/pages/avis/?q=idweb:${x.idweb}`,title:x.objet,description,buyer:x.nomacheteur,publicationDate:x.dateparution,deadlineRaw:x.datelimitereponse,sourceStatus:status,
  noticeType:/ATTRIBUTION/.test(x.nature)?'award':/PREINFORMATION/.test(x.nature)?'planning':/APPEL_OFFRE|RECTIFICATIF/.test(x.nature)?'tender':'unknown',noticeVerified:true,cpv:[...new Set(text.match(/\b\d{8}(?:-\d)?\b/g)||[])].join(' | ')};
}
function parseBzp(x){
 const kind=['ContractNotice','SmallContractNotice','CompetitionNotice','ConcessionNotice'].includes(x.noticeType)?'tender':['TenderResultNotice','CompetitionResultNotice','ConcessionAgreementNotice'].includes(x.noticeType)?'award':x.noticeType==='NoticeUpdateNotice'?'amendment':'unknown';
 return {noticeId:x.objectId||x.noticeNumber,procedureId:x.tenderId,sourceUrl:`https://ezamowienia.gov.pl/mo-client-board/bzp/notice-details/id/${x.objectId}`,title:x.orderObject,description:htmlText(x.htmlBody),buyer:x.organizationName,publicationDate:x.publicationDate?.slice(0,10),sourceUpdated:x.publicationDate,deadlineRaw:x.submittingOffersDate,sourceStatus:x.procedureResult||x.noticeType,noticeType:kind,noticeVerified:true,cpv:x.cpvCode};
}
async function boamp(ctx){
 const terms=['satellite','spatial','spatiale','CNES','GNSS','EGNOS','Galileo','Copernicus','télédétection','observation de la terre','34712000','35631000','32530000','38235000'];
 const filter='('+terms.map(t=>`search(${JSON.stringify(t)})`).join(' OR ')+')';
 // Reverse yearly partitions prioritize recent notices; split any partition above
 // the ODS 10,000-row offset cap instead of silently dropping old records.
 async function range(from,to){
  let offset=0,total;
  while(ctx.canFetch()){
   const u=new URL('https://www.boamp.fr/api/explore/v2.1/catalog/datasets/boamp/records');
   u.search=new URLSearchParams({where:`dateparution >= date'${from}' AND dateparution < date'${to}' AND ${filter}`,order_by:'dateparution desc, idweb desc',limit:'100',offset:String(offset)});
   const {body,rawFile}=await ctx.get(u.href);const d=JSON.parse(body);if(!Array.isArray(d.results))throw Error('BOAMP response missing results');
   total=d.total_count;
   if(total>9900){const a=Date.parse(from),b=Date.parse(to);if(b-a<=86400000)throw Error('BOAMP one-day partition exceeds offset cap');const mid=new Date(a+Math.floor((b-a)/86400000/2)*86400000).toISOString().slice(0,10);await range(mid,to);await range(from,mid);return;}
   for(const x of d.results)ctx.emit(parseBoamp(x),rawFile);
   offset+=d.results.length;
   if(offset>=total)return;
   if(!d.results.length)throw Error(`BOAMP ended early at ${offset} of ${total}`);
  }
  ctx.gap('Page budget reached in BOAMP partition '+from+' to '+to);
 }
 for(let y=Number(ctx.options.to.slice(0,4));y>=Number(ctx.options.from.slice(0,4))&&ctx.canFetch();y--){await range(y+'-01-01',Math.min(y+1,9999)+'-01-01');}
 ctx.gap('BOAMP keyword/CPV retrieval is broad but not an exhaustive semantic search of all French procurement.');
 if(!ctx.canFetch())ctx.gap('BOAMP request budget exhausted; the requested historical range may be incomplete.');
}
async function bzp(ctx){
 // BZP requires a notice type and both dates. Iterate newest monthly windows first.
 // Updates and awards are retained to prevent obsolete competitions appearing open.
 let cursor=new Date(ctx.options.to+'T00:00:00Z');cursor.setUTCDate(cursor.getUTCDate()+1);
 const start=new Date((ctx.options.from<'2021-01-01'?'2021-01-01':ctx.options.from)+'T00:00:00Z');
 const types=['ContractNotice','SmallContractNotice','CompetitionNotice','ConcessionNotice','NoticeUpdateNotice','TenderResultNotice','CompetitionResultNotice','ConcessionAgreementNotice'];
 while(cursor>start&&ctx.canFetch()){
  const from=new Date(Date.UTC(cursor.getUTCFullYear(),cursor.getUTCMonth(),1));if(from>=cursor)from.setUTCMonth(from.getUTCMonth()-1);if(from<start)from.setTime(start.getTime());
  for(const type of types){let searchAfter='',last='';while(ctx.canFetch()){
   const u=new URL('https://ezamowienia.gov.pl/mo-board/api/v1/notice');u.search=new URLSearchParams({NoticeType:type,PublicationDateFrom:from.toISOString(),PublicationDateTo:cursor.toISOString(),PageSize:'100',...(searchAfter?{SearchAfter:searchAfter}:{})});
   const {body,rawFile}=await ctx.get(u.href);const rows=JSON.parse(body);if(!Array.isArray(rows))throw Error('BZP response is not an array');
   const ids=rows.map(r=>r.objectId).join('|');if(ids&&ids===last)throw Error('BZP repeated page: pagination not advancing');last=ids;
   for(const x of rows)ctx.emit(parseBzp(x),rawFile);if(rows.length<100)break;searchAfter=rows.at(-1).objectId;if(!searchAfter)throw Error('BZP missing pagination cursor');
  }}cursor.setTime(from.getTime());
 }
 if(!ctx.canFetch())ctx.gap('BZP page budget reached; monthly history is incomplete.');
 if(ctx.options.from<'2021-01-01')ctx.gap('BZP new system does not cover 2020: use legacy BZP or complementary TED data.');
}
async function feed(ctx){
 let url=ctx.source.adapter==='placsp'?'https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3.atom':'https://www.tenderned.nl/papi/tenderned-rs-tns/rss/laatste-publicatie.rss';
 const visited=new Set();
 while(url&&ctx.canFetch()){
  if(visited.has(url))throw Error('Feed repeated next link');visited.add(url);
  const {body,rawFile}=await ctx.get(url);const d=parseFeed(body,ctx.source);for(const x of d.rows)ctx.emit(x,rawFile);
  url=d.next?new URL(d.next,url).href:'';
  if(ctx.options.archives&&ctx.source.adapter==='placsp')break;
 }
 if(url)ctx.gap('Feed page budget reached before end of pagination.');
 ctx.gap(ctx.source.adapter==='placsp'?'PLACSP current Atom feed is not the complete 2020 archive. Import downloaded annual/monthly Atom archives with --import-dir.':'TenderNed RSS covers recent publications only. Historical XML files can be supplied with --import-dir; the full XML API requires credentials.');
}
function parseSst(html){
 const $=cheerio.load(html);const rows=[];
 $('table').each((i,table)=>{
  const head=$(table).find('tr').first().text();if(!/Title/.test(head)||!/Description/.test(head))return;
  const isOpen=/Submission deadline/.test(head);
  $(table).find('tr').slice(1).each((j,tr)=>{const cells=$(tr).find('td');if(cells.length<3)return;const title=clean(cells.eq(0).text()),description=clean(cells.eq(1).text());const anchor=cells.last().find('a').first();const url=anchor.attr('href')||'';
   const kind=/prior information|market information/i.test(title)?'planning':/call for proposals|cascade funding/i.test(description)?'grant':'tender';
   rows.push({noticeId:url||title,sourceUrl:url||'https://www.eusst.eu/about-us/procurement',title,description,deadlineRaw:isOpen?clean(cells.eq(2).text()).replace(/Europe\/\w+/,'').trim():'',timeZone:cells.eq(2).text().match(/Europe\/\w+/)?.[0]||'Europe/Brussels',noticeType:kind,sourceStatus:isOpen?'listed open':'past',noticeVerified:true});
  });
 });return rows;
}
async function eusst(ctx){const {body,rawFile}=await ctx.get(ctx.source.url);for(const r of parseSst(body))ctx.emit(r,rawFile);ctx.gap('EU SST list has no publication dates for many entries; retain them with an unknown date scope.');}
async function dlr(ctx){
 const {body}=await ctx.get(ctx.source.url);const $=cheerio.load(body);const feeds=[...new Set($('a[href]').map((i,e)=>$(e).attr('href')).get().filter(u=>/^https:\/\/www\.subreport-elvis\.de\/elvis\/secure\/rss\.pl\?id=\d+$/.test(u)))];
 if(!feeds.length)throw Error('DLR page no longer exposes the expected public ELViS feeds');
 for(const url of feeds){if(!ctx.canFetch()){ctx.gap('DLR feed budget reached');break;}const {body,rawFile}=await ctx.get(url);for(const r of parseFeed(body,ctx.source).rows)ctx.emit({...r,buyer:'Deutsches Zentrum für Luft- und Raumfahrt (DLR)'},rawFile);}
 ctx.gap('DLR linked RSS feeds cover current advertised opportunities only; they do not provide the 2020 archive.');
}
async function austria(ctx){
 const base='https://ausschreibungen.usp.gv.at/at.gv.bmdw.eproc-p/public/';const seen=new Set();
 for(const term of ['Satellit','Raumfahrt','Weltraum','Erdbeobachtung','Fernerkundung','GNSS','EGNOS','Copernicus','Galileo','Space','EU SST','Weltraumüberwachung']){
  let offset=0;while(ctx.canFetch()){
   const url=base+'api/tenderlist?'+new URLSearchParams({q:term,start:String(offset),length:'100',draw:'1',orderColumn:'2',orderDir:'desc'});
   const response=await ctx.get(url);const data=JSON.parse(response.body);if(!Array.isArray(data.data))throw Error('Austrian search response missing rows');
   for(const row of data.data){if(seen.has(row[4])||row[2]<ctx.options.from||row[2]>ctx.options.to)continue;seen.add(row[4]);const sourceUrl=base+(row[5]?'notice':'tender')+'-detail?object='+encodeURIComponent(row[4]);
    let description='',rawFile=response.rawFile,kind=row[3]?'tender':'unknown',status='';
    if(ctx.canFetch()){try{const detail=await ctx.get(sourceUrl);rawFile=detail.rawFile;description=htmlText(detail.body);if(/Bekanntgabe von vergebenen|vergebene Auftr[aä]ge|Auftragsvergabe|Ergebnisbekanntmachung/i.test(description)){kind='award';status='awarded';}if(/Widerruf|Annullierung/i.test(description))status='cancelled';}catch(e){ctx.gap(sourceUrl+': '+e.message);}}
    ctx.emit({noticeId:row[4],sourceUrl,title:row[0],description,buyer:row[1],publicationDate:row[2],deadlineRaw:row[3]||'',sourceStatus:status,noticeType:kind,noticeVerified:true},rawFile);
   }
   offset+=data.data.length;if(offset>=data.recordsFiltered)break;if(!data.data.length)throw Error('Austrian search ended before reported count');
  }
  if(!ctx.canFetch()){ctx.gap('Austrian page budget reached during keyword '+term);break;}
 }
 ctx.gap('Austrian keyword searches cover indexed publications; historical completeness depends on the source.');
}
function parsePage(html,url,source){
 const $=cheerio.load(html);$('script,style,nav,header,footer,noscript').remove();
 const title=clean($('h1').first().text()||$('title').text());const main=$('main,article,[role=main]').first();const text=clean((main.length?main:$('body')).text());
 const labels=/\b(?:submission deadline|deadline for receipt|closing date|tender deadline|date limite (?:de remise|de r[eé]ception|de r[eé]ponse)|schlusstermin|angebotsfrist|abgabefrist|plazo de presentaci[oó]n|scadenza|termin składania ofert|sluitingsdatum|anbudsfrist)\s*[:\-]?\s*(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?)?|\d{1,2}[./-]\d{1,2}[./-]\d{4}(?:\s+\d{1,2}:\d{2})?)/i;
 const deadline=text.match(labels)?.[1]||'';
 const date=$('meta[property="article:published_time"]').attr('content')||'';
 const links=[];$('a[href]').each((i,a)=>{try{const u=new URL($(a).attr('href'),url);if(!/^https?:$/.test(u.protocol))return;u.hash='';links.push({url:u.href,text:clean($(a).text())});}catch{}});
 if(/\/epps\/cft\/prepareViewCfTWS\.do/.test(url)){
  const pairs=[];$('dt').each((i,e)=>pairs.push([fold($(e).text()),clean($(e).next('dd').text())]));
  const value=re=>pairs.find(([k])=>re.test(k))?.[1]||'';
  const eTitle=value(/^(title|τιτλος|pavadinimas)\s*:/);
  const due=value(/time-limit for receipt of tenders|προθεσμια παραλαβης των προσφορων|pasiulymu.*pateikimo.*termin/);
  const publication=value(/date of publication|ημερομηνια δημοσιευσης|paskelbimo data/);
  const award=value(/^(date of award|award date|ημερομηνια αναθεσης)\s*:/);
  if(eTitle)return {row:{noticeId:new URL(url).searchParams.get('resourceId'),procedureId:new URL(url).searchParams.get('resourceId'),sourceUrl:url,title:eTitle,description:value(/^(description|περιγραφη|aprasymas)\s*:/),buyer:value(/name of contracting authority|ονομα αναθετουσας αρχης/),publicationDate:parseDate(publication,source.timeZone).iso.slice(0,10),deadlineRaw:due,noticeType:award?'award':'tender',noticeVerified:true,sourceStatus:award?'awarded':'',cpv:value(/cpv/),value:value(/estimated value/),currency:/estimated value.*eur/i.test(pairs.map(p=>p[0]).join(' '))?'EUR':''},links};
 }
 const kind=/call for proposals|grant funding|bourse|scholarship|vacanc|recruitment|emploi/i.test(title)?'non_tender':/prior information|pre-information|market consultation/i.test(title)?'planning':procurement.test(title)||/notice|tender|detail|consultation|appalt|licitaci|oglosze/i.test(url)?'tender':'unknown';
 // Unstructured pages remain candidates even when they have procurement words.
 // Only an individually identified notice with an explicitly labelled deadline
 // is eligible for open classification; listing pages stay in review.
 const isListing=links.filter(l=>procurement.test(l.text)).length>8;
 const sourceStatus=/cancel|annul|withdraw|adjudic|awarded/i.test(title)?title:'';
 return {row:{noticeId:url,sourceUrl:url,title,description:text,publicationDate:date.slice(0,10),deadlineRaw:deadline,noticeType:kind,noticeVerified:false,sourceStatus},links};
}
function allowed(url,source){try{const h=new URL(url).hostname.replace(/^www\./,'');return source.allowedHosts.some(x=>h===x||h.endsWith('.'+x));}catch{return false;}}
async function web(ctx){
 const seeds=[...ctx.source.seeds,...(ctx.options.seeds?.[ctx.source.id]||[])];
 if(ctx.options.discover){
  if(!process.env.FIRECRAWL_API_KEY)ctx.gap('Search discovery requested but FIRECRAWL_API_KEY is not set. Direct crawling still runs.');
  else{
   const words=['satellite GNSS Copernicus Galileo',ctx.source.terms||'space earth observation','space defence dual use'];
   for(const term of words){const query=`site:${ctx.source.allowedHosts[0]} (${term.split(' ').join(' OR ')}) (tender OR procurement OR contract) after:${ctx.options.from}`;
    const result=await ctx.firecrawl('search',{query,limit:ctx.options.searchLimit,sources:['web']});
    const rows=result.data?.web||[];for(const r of rows)if(allowed(r.url,ctx.source))seeds.push(r.url);
   }
   ctx.gap('Search discovery is index-based, capped per query, and does not enumerate all historical notices.');
  }
 }
 const queue=[...new Set(seeds)].map(url=>({url,depth:0})),seen=new Set();let fetched=0;
 while(queue.length&&ctx.canFetch()&&fetched<ctx.options.webPages){
  const item=queue.shift();if(seen.has(item.url)||!allowed(item.url,ctx.source))continue;seen.add(item.url);
  if(/\.(zip|docx?|xlsx?|png|jpg|gif)(?:[?#]|$)/i.test(item.url)){ctx.gap('Document needs extraction: '+item.url);continue;}
  try{
   const response=await ctx.get(item.url);let {body,rawFile}=response;
   const isPdf=body.startsWith('%PDF');if(isPdf)body=textAsHtml(await pdfText(response.buffer));
   if(/access denied|verify you are human|captcha|just a moment/i.test(body.slice(0,12000))&&body.length<30000)throw Error('Access challenge');
   fetched++;
   if(!isPdf&&ctx.options.browser){const rendered=await ctx.browse(item.url);body=rendered.html;rawFile=ctx.saveRendered(item.url,body);}
   if(!isPdf&&ctx.options.render){
    if(!process.env.FIRECRAWL_API_KEY)ctx.gap('Rendered-page collection needs FIRECRAWL_API_KEY; used direct HTML only.');
    else{const rendered=await ctx.firecrawl('scrape',{url:item.url,formats:['html'],onlyMainContent:false});if(rendered.data?.html){body=rendered.data.html;rawFile=ctx.saveRendered(item.url,body);}else ctx.gap('Renderer returned no HTML: '+item.url);}
   }
   const {row,links}=parsePage(body,item.url,ctx.source);const relevant=classify(row.title,row.description);
   const individualNotice=/\/notices\/[a-f0-9-]{20,}|\/today\/\d+|\/notice\/\d+|[?&](?:resourceId|idBando|noticeId)=/i.test(item.url);
   if(relevant.relevance!=='unrelated'&&(row.noticeVerified||individualNotice||procurement.test(row.title)||row.deadlineRaw||isPdf&&procurement.test(row.description)))ctx.emit(row,rawFile);
   if(item.depth<ctx.options.depth){
    const next=links.filter(l=>allowed(l.url,ctx.source)&&!seen.has(l.url)&&(procurement.test(l.text+' '+l.url)||classify(l.text,'').relevance!=='unrelated'||/cft|opportunit|next|suivant|weiter|volgende|successiv|siguiente|page=|page\/|start=|offset=/i.test(l.text+' '+l.url)));
    next.sort((a,b)=>Number(classify(b.text,'').relevance!=='unrelated')-Number(classify(a.text,'').relevance!=='unrelated'));
    queue.push(...next.map(l=>({url:l.url,depth:item.depth+1})));
   }
   if(!isPdf&&!links.length&&body.length<15000)ctx.gap('Page may require JavaScript rendering: '+item.url);
  }catch(e){ctx.gap(item.url+': '+e.message);}
 }
 if(queue.length)ctx.gap('Web traversal budget reached; '+queue.length+' queued links remain.');
 if(!fetched)throw Error('No source pages retrieved; see coverage gaps for HTTP/access errors.');
 ctx.gap('Generic public-page extraction is partial. Login, JavaScript forms, document-only notices and unlinked archives require additional adapters or reviewed seeds.');
}
module.exports={boamp,bzp,feed,eusst,austria,dlr,web,parseFeed,parseBoamp,parseBzp,parseSst,parsePage};
