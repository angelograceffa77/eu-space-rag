'use strict';
const cheerio=require('cheerio');
const unzipper=require('unzipper');
const {clean,fold,classify}=require('./core.cjs');
const nodes=(r,n)=>r.find('*').filter((i,e)=>e.name?.split(':').pop()===n);
const val=(r,n)=>clean(nodes(r,n).first().text());
function parseGerman(xml){
 const $=cheerio.load(xml,{xml:true}),root=$.root(),doc=root.children().first();
 const project=doc.children().filter((i,e)=>e.name?.split(':').pop()==='ProcurementProject').first();
 const notice=doc.children().filter((i,e)=>e.name?.split(':').pop()==='ID').text();
 const type=val(root,'NoticeTypeCode'),kind=/^can-|result|award/.test(type)?'award':/^pin-|planning/.test(type)?'planning':'tender';
 const lots=nodes(root,'ProcurementProjectLot');
 const contracting=nodes(root,'ContractingParty').first();let buyer=val(contracting,'Name');
 if(!buyer){const buyerId=val(nodes(contracting,'PartyIdentification').first(),'ID');if(buyerId){const organization=nodes(root,'Organization').filter((i,e)=>val(nodes($(e),'PartyIdentification').first(),'ID')===buyerId).first();buyer=val(nodes(organization,'PartyName').first(),'Name');}}
 const scopes=lots.length?lots.toArray().map(e=>$(e)):[root];
 return scopes.map(lot=>{
  const period=nodes(lot,'TenderSubmissionDeadlinePeriod').first();
  const date=val(period,'EndDate').slice(0,10),time=val(period,'EndTime');
  const lotId=lot===root?'':val(lot,'ID');
  const cpv=[...new Set(nodes(lot,'ItemClassificationCode').map((i,e)=>$(e).text()).get())].join(' | ');
  const lotProject=nodes(lot,'ProcurementProject').first();
  const title=val(lotProject,'Name')||val(project,'Name')||val(lot,'Name');
  return {noticeId:notice+'|'+lotId,procedureId:(val(root,'ContractFolderID')||notice)+'|'+lotId,title,description:val(lotProject,'Description')||val(project,'Description'),sourceUrl:'https://oeffentlichevergabe.de/ui/de/notices/'+notice,buyer,publicationDate:(val(root,'RequestedPublicationDate')||val(root,'IssueDate')).slice(0,10),sourceUpdated:val(root,'IssueDate').slice(0,10)+'T'+(val(root,'IssueTime')||'00:00:00'),deadlineRaw:date?(time?date+'T'+time:date):'',noticeType:kind,sourceStatus:type,noticeVerified:true,cpv,documents:[...new Set(nodes(lot,'URI').map((i,e)=>$(e).text()).get())].join(' | ')};
 });
}
async function germany(ctx){
 if(ctx.options.archives)return germanyMonthly(ctx);
 const start=ctx.options.from<'2022-12-01'?'2022-12-01':ctx.options.from;
 let end=new Date(ctx.options.to+'T00:00:00Z');const today=new Date().toISOString().slice(0,10);
 if(ctx.options.to>=today)end=new Date(Date.parse(today)-86400000);
 if(ctx.options.from<start)ctx.gap('Official German monthly/daily archive starts December 2022; later exports can contain older migrated notices, but complete 2020-November 2022 coverage cannot be established.');
 ctx.gap('Bulk export is available through yesterday; today needs a separate live portal check.');
 for(;end.toISOString().slice(0,10)>=start&&ctx.canFetch();end.setUTCDate(end.getUTCDate()-1)){
  const day=end.toISOString().slice(0,10),url='https://oeffentlichevergabe.de/api/notice-exports?pubDay='+day+'&format=eforms.zip';
  const {buffer,rawFile}=await ctx.get(url),zip=await unzipper.Open.buffer(buffer);
  for(const f of zip.files){if(!/\.xml$/i.test(f.path))continue;if(f.uncompressedSize>16*1024*1024)throw Error('Oversized German notice XML');
   for(const x of parseGerman((await f.buffer()).toString('utf8')))ctx.emit(x,rawFile+'#'+f.path);
  }
 }
 if(end.toISOString().slice(0,10)>=start)ctx.gap('German daily archive request budget reached at '+end.toISOString().slice(0,10));
}
async function germanyMonthly(ctx){
 const fs=require('node:fs'),path=require('node:path'),{download}=require('./archives.cjs');
 const start=(ctx.options.from<'2022-12-01'?'2022-12-01':ctx.options.from).slice(0,7);
 let month=ctx.options.to.slice(0,7);
 if(ctx.options.from<'2022-12-01')ctx.gap('German official archive starts December 2022; later exports can contain older migrated notices, but complete 2020-November 2022 coverage cannot be established.');
 while(month>=start&&ctx.canFetch()){
  const url='https://oeffentlichevergabe.de/api/notice-exports?pubMonth='+month+'&format=eforms.zip';
  const file=path.join(ctx.rawDir,'DE-eforms-'+month+'.zip');ctx.recordRequest();
  if(!fs.existsSync(file)){console.log('[DE-portal] archive '+month);await download(url,file,Math.max(ctx.options.timeout,300000));}
  const zip=await unzipper.Open.file(file);let scanned=0;
  for(const f of zip.files){if(!/\.xml$/i.test(f.path))continue;if(f.uncompressedSize>16*1024*1024){ctx.gap('Oversized notice '+f.path);continue;}
   const xml=(await f.buffer()).toString('utf8');scanned++;
   // Broad lexical prefilter only saves XML parsing; final normalized records
   // still undergo the same substantive classification used by daily exports.
   if(!/satellit|satelit|satcom|gnss|egnos|copernicus|galileo|cubesat|smallsat|nanosat|space(?:craft|port|flight|borne|[- ]based| surveillance| traffic| debris)|earth observation|remote sensing|launch vehicle|ground (?:segment|station)|orbital|in-orbit|raumfahrt|weltraum|erdbeobacht|fernerkund|spazial|telerilev|teledetec|teledetek|avaru|kosm|kozm|vesmir|vesolj|svemir|rumfart|ruimtevaart|aardobserv|rymd|fjarranalys|palydov|kaugseire|kaukokartoit|muhold|urkutat|taverzekel|spatial|geospatial|geo.information|\bgis\b|lidar|radar|hyperspectral|multispectral|wildfire|forest monitoring|environmental monitoring|quantum communication|laser ranging|telescop|astronom|bodenstation|\beu\s*sst\b|34712\d{3}|3563[12]\d{3}|3253\d{4}|38112100|38235000|60510000/iu.test(xml))continue;
   for(const r of parseGerman(xml))ctx.emit(r,file+'#'+f.path);
  }
  console.log('[DE-portal] '+month+': scanned '+scanned+' notices');
  let d=new Date(month+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()-1);month=d.toISOString().slice(0,7);
 }
 if(month>=start)ctx.gap('German month budget reached before '+month);
 ctx.gap('Current month export stops at yesterday; today requires a live portal check.');
}
function frenchDate(box){
 const months=['jan','fev','mar','avr','mai','juin','juil','aou','sep','oct','nov','dec'];
 const m=months.findIndex(x=>fold(box.find('.month').text()).startsWith(x));
 const d=clean(box.find('.day').text()),y=clean(box.find('.year').text()),time=clean(box.find('.time').text());
 return m>=0&&d&&y?y+'-'+String(m+1).padStart(2,'0')+'-'+d.padStart(2,'0')+(time?'T'+time:''):'';
}
function parseAtexo(html,url){
 const $=cheerio.load(html);return $('.item_consultation').map((i,e)=>{
  const el=$(e),href=el.find('a[href*="/entreprise/consultation/"]').filter((i,a)=>!$(a).attr('href').includes('echanges')).first().attr('href');
  if(!href)return null;
  const title=clean(el.find('.objet-line .truncate').text()),description=clean(el.find('[id$="panelBlocObjet"] .small').text());
  const id=href.match(/consultation\/(\d+)/)?.[1];
  return {noticeId:id,procedureId:id,title,description,buyer:clean(el.find('[id$="panelBlocDenomination"] .small').text()),sourceUrl:new URL(href,url).href,publicationDate:frenchDate(el.find('.cons_ref')).slice(0,10),deadlineRaw:frenchDate(el.find('.cons_dateEnd')),noticeVerified:true,noticeType:/\brfi\b|request for information|consultation preliminaire/i.test(fold(title+' '+description))?'planning':'tender'};
 }).get();
}
async function atexo(ctx){
 // Use the public listing, then its real browser pagination controls.
 const terms=ctx.source.id==='FR-place'?['satellite','spatial','GNSS','Copernicus','Galileo','télédétection']:[''];
 const {chromium}=require('playwright-core');
 const browser=await chromium.launch(process.env.SCRAPER_BROWSER_PATH?{headless:true,executablePath:process.env.SCRAPER_BROWSER_PATH}:{headless:true,channel:'msedge'});
 try{const page=await browser.newPage();for(const term of terms){if(!ctx.canFetch())break;
  const url=new URL(term?'/espace-entreprise/search?keyWord='+encodeURIComponent(term):'/?page=Entreprise.EntrepriseAdvancedSearch&AllCons',ctx.source.url).href;
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:ctx.options.timeout});
  let previous='';
  for(let n=1;n<=ctx.options.webPages&&ctx.canFetch();n++){
   ctx.recordRequest?.();
   if(!await page.locator('.item_consultation').count()){
    const text=await page.locator('body').innerText();
    if(/aucun.*r[eé]sultat|0 r[eé]sultat/i.test(text)){ctx.saveRendered(url,await page.content());break;}
    throw Error('No recognized procurement listing: '+url);
   }
   const html=await page.content(),rows=parseAtexo(html,url),ids=rows.map(r=>r.noticeId).join('|');
   if(!rows.length)throw Error('Listing markup found but no notice links parsed');if(ids===previous)throw Error('ATE XO pagination did not advance');previous=ids;
   const raw=ctx.saveRendered(url+'&collectorPage='+n,html);for(const x of rows)ctx.emit(x,raw);
   const next=page.locator('[id*="PagerTop"] a').filter({has:page.locator('.fa-angle-right, .fa-chevron-right')});
   // The native controls expose their accessible next-page title.
   const candidates=page.locator('a[title="Page suivante"], a[title="Suivant"], a[title="Aller à la page suivante"]');
   const control=await candidates.count()?candidates.first():next.first();
   if(!await control.count())break;
   if(n===ctx.options.webPages){ctx.gap('Listing page budget reached');break;}
   await control.click();await page.waitForLoadState('domcontentloaded');await page.waitForTimeout(ctx.options.delay);
  }}
 }finally{await browser.close();}
 ctx.gap('Current public consultations collected; closed consultation archive requires separate history integration.');
}
module.exports={germany,parseGerman,atexo,parseAtexo};
