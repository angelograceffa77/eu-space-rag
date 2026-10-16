'use strict';
const fs=require('fs'),path=require('path'),cheerio=require('cheerio'),{chromium}=require('playwright-core'),{clean}=require('./core.cjs'),{parseSpanishDetail}=require('./spain-public.cjs');
const TERMS=['satélite','espacial','teledetección','GNSS','Galileo','Copernicus','"observación de la Tierra"','"estación de tierra"','"vigilancia espacial"','satcom'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function documentRows(html){const $=cheerio.load(html);return $('table[id$=tableResultSearch] tr').map((i,e)=>{const a=$(e).find('a[href*="deeplink:detalle_licitacion"]');if(!a.length)return null;return {url:a.attr('href'),description:clean($(e).find('[id$=textColumnaExpedienteResultado]').text()),date:clean($(e).find('[id$=textColumnaDateResultado]').text()),document:$(e).find('a[href*="GetDocumentByIdServlet"]').attr('href')||''};}).get();}
function splitRange(from,to){const days=Math.round((Date.parse(to)-Date.parse(from))/86400000);if(days<1)return [];const middle=new Date(Date.parse(from)+Math.floor(days/2)*86400000).toISOString().slice(0,10),next=new Date(Date.parse(middle)+86400000).toISOString().slice(0,10);return [[from,middle],[next,to]];}
async function placspDocuments(ctx){
 const b=await chromium.launch(process.env.SCRAPER_BROWSER_PATH?{headless:true,executablePath:process.env.SCRAPER_BROWSER_PATH}:{headless:true,channel:'msedge'}),audit=[],candidates=new Map(),done=new Set(),queue=TERMS.map(term=>({term,from:ctx.options.from,to:ctx.options.to}));
 const key=q=>[q.term,q.from,q.to].join('|'),prior=ctx.options.esDocumentDiscoveryDir;
 const save=()=>{fs.writeFileSync(path.join(ctx.rawDir,'ES-document-candidates.json'),JSON.stringify([...candidates.values()],null,2));fs.writeFileSync(path.join(ctx.rawDir,'ES-document-coverage.json'),JSON.stringify(audit,null,2));};
 try{
  if(prior){const old=JSON.parse(fs.readFileSync(path.join(prior,'ES-document-coverage.json')));for(const a of old){const q={...a,from:a.from||ctx.options.from,to:a.to||ctx.options.to};if(q.read===q.reportedTotal&&q.reportedTotal<10000&&!q.error){audit.push({...q,reusedFrom:path.resolve(prior)});done.add(key(q));}}for(const x of JSON.parse(fs.readFileSync(path.join(prior,'ES-document-candidates.json'))))candidates.set(x.url,x);ctx.gap('Explicit same-pass discovery reuse from '+path.resolve(prior));save();}
  const p=await b.newPage();p.setDefaultNavigationTimeout(ctx.options.timeout);
  for(let qi=0;qi<queue.length&&ctx.canFetch();qi++){
   const q=queue[qi];if(done.has(key(q)))continue;let page=1,read=0,total=0,previous='',split=false,error='';
   try{
    ctx.recordRequest();await p.goto('https://contrataciondelestado.es/wps/portal/plataforma/buscador/',{waitUntil:'domcontentloaded',timeout:ctx.options.timeout});
    await p.locator('input[id$=boxSearch]').fill('metadata.file_metadata:'+q.term+',metadata.fecha_busqueda>='+q.from.replaceAll('-','')+',metadata.fecha_busqueda<='+q.to.replaceAll('-',''));
    ctx.recordRequest();await Promise.all([p.waitForNavigation({waitUntil:'domcontentloaded'}),p.locator('input[id$=botonSubmitSearch]').click()]);
    while(ctx.canFetch()){
     const html=await p.content(),$=cheerio.load(html),rows=documentRows(html),signature=rows.map(x=>x.document+x.url+x.date).join('|');
     total=Number(clean($('body').text()).match(/de\s+([\d.,]+)\s+Resultados/i)?.[1]?.replace(/[.,]/g,'')||0);
     if(signature&&signature===previous)throw Error('Repeated document result page');previous=signature;
     ctx.saveRendered('https://contrataciondelestado.es/document-search#'+encodeURIComponent(key(q))+'-'+page,html);
     if(page===1&&total>=10000){const ranges=splitRange(q.from,q.to);if(ranges.length){queue.push(...ranges.map(([from,to])=>({term:q.term,from,to})));split=true;break;}}
     read+=Math.max(0,$('table[id$=tableResultSearch] tr').length-1);for(const row of rows)if(row.url)candidates.set(row.url,row);
     const next=p.locator('input[type=image][src$="/NextButton.gif"]');if(!await next.count()||await next.isDisabled())break;
     ctx.recordRequest();await Promise.all([p.waitForNavigation({waitUntil:'domcontentloaded'}),next.click()]);page++;await sleep(ctx.options.delay);
    }
   }catch(e){error=e.message;ctx.gap('Document query '+key(q)+': '+error);}
   audit.push({...q,pages:page,read,reportedTotal:total,split,error});save();if(!split&&(read<total||total>=10000))ctx.gap('Incomplete or capped document query '+key(q)+': '+read+'/'+total);
  }
  const cache=new Map();for(const dir of [ctx.options.rawCacheDir,prior].filter(Boolean))for(const name of ['ES-detail-index.jsonl','ES-document-detail-index.jsonl']){const f=path.join(dir,name);if(!fs.existsSync(f))continue;for(const line of fs.readFileSync(f,'utf8').trim().split('\n').filter(Boolean)){const x=JSON.parse(line),file=path.join(dir,path.basename(x.rawFile));if(fs.existsSync(file))cache.set(x.url,{...x,file});}}
  const pending=[...candidates.values()];let cursor=0,nextStart=0;
  async function worker(){const d=await b.newPage();d.setDefaultNavigationTimeout(ctx.options.timeout);while(cursor<pending.length&&ctx.canFetch()){const x=pending[cursor++];try{let html,rawFile,retrievedAt;const c=cache.get(x.url);if(c){html=fs.readFileSync(c.file,'utf8');rawFile=ctx.saveRendered(x.url,html);retrievedAt=c.retrievedAt;}else{const start=Math.max(Date.now(),nextStart);nextStart=start+ctx.options.delay;await sleep(Math.max(0,start-Date.now()));if(!ctx.canFetch())break;ctx.recordRequest();await d.goto(x.url,{waitUntil:'domcontentloaded',timeout:ctx.options.timeout});html=await d.content();rawFile=ctx.saveRendered(x.url,html);retrievedAt=new Date().toISOString();}const row=parseSpanishDetail(html,x.url);if(row)ctx.emit(row,rawFile);else ctx.gap('Unrecognized document-linked detail '+x.url);fs.appendFileSync(path.join(ctx.rawDir,'ES-document-detail-index.jsonl'),JSON.stringify({url:x.url,rawFile,retrievedAt,reusedFrom:c?.file||''})+'\n');}catch(e){ctx.gap(x.url+': '+e.message);}}}
  await Promise.all([worker(),worker()]);
 }finally{await b.close();save();}
 ctx.gap('Public document metadata search using ten space terms since 2020. Capped date ranges are split recursively. Contract detail pages verify records; full attachment text is not extracted. Regional-only publications, unindexed documents and other terminology remain gaps.');
 if(ctx.options.rawCacheDir)ctx.gap('Explicit same-pass detail reuse from '+path.resolve(ctx.options.rawCacheDir));if(!ctx.canFetch())ctx.gap('Document search request budget reached');
}
module.exports={placspDocuments,documentRows,splitRange};