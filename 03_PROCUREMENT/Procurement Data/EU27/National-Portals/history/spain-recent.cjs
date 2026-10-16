'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const national=process.env.NATIONAL_COLLECTOR_ROOT||path.resolve(__dirname,'..');
const cheerio=require(path.join(national,'node_modules/cheerio')),{normalize}=require(path.join(national,'core.cjs'));
const {parseHistoryFeed}=require('./spain-supplemental.cjs'),{lotRows}=require('./spain-lots.cjs');
const specs={hosted:{page:'LicitacionesContratante',prefix:'licitacionesPerfilesContratanteCompleto3',id:'ES-history'},aggregated:{page:'LicitacionesAgregacion',prefix:'PlataformasAgregadasSinMenores',id:'ES-history-aggregated'},minor:{page:'ContratosMenores',prefix:'contratosMenoresPerfilesContratantes',id:'ES-history-minor'},inhouse:{page:'EncargosMediosPropios',prefix:'EMP_SectorPublico',id:'ES-history-inhouse',noticeType:'in_house_assignment'},consultation:{page:'ConsultasPreliminaresMercado',prefix:'CPM_SectorPublico',id:'ES-history-consultation',noticeType:'consultation'}};
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
async function hashFile(file){const h=crypto.createHash('sha256');for await(const b of fs.createReadStream(file))h.update(b);return h.digest('hex');}
function dates(xml){const entries=xml.match(/<(?:[\w-]+:)?entry\b[^>]*>[\s\S]*?<\/(?:[\w-]+:)?entry\s*>/g)||[],values=entries.map(e=>e.match(/<(?:[\w-]+:)?updated\b[^>]*>([^<]+)</)?.[1]||'');const valid=values.filter(x=>Number.isFinite(Date.parse(x)));return {entries:entries.length,valid:valid.length,min:valid.length?new Date(Math.min(...valid.map(Date.parse))).toISOString():null,max:valid.length?new Date(Math.max(...valid.map(Date.parse))).toISOString():null};}
function validateFeed(text){const doc=cheerio.load(text,{xml:true}),root=doc.root().children().first();if(root[0]?.name?.split(':').pop()!=='feed')throw Error('Response is not an Atom feed');return doc;}
function allowed(url){return ['contrataciondelsectorpublico.gob.es','contrataciondelestado.es'].includes(new URL(url).hostname);}
function atomic(file,value){const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(value,null,2));fs.renameSync(temp,file);}
async function collect(run,dataset,cutoff,maxPages=100){
 const spec=specs[dataset];if(!spec||(!/^\d{4}-\d{2}-\d{2}$/.test(cutoff)||!Number.isFinite(Date.parse(cutoff+'T00:00:00Z'))))throw Error('Invalid recent-feed configuration');
 const dir=path.join(run,'recent-feed'),stateFile=path.join(dir,'state.json');fs.mkdirSync(dir,{recursive:true});
 if(fs.existsSync(stateFile)){const saved=JSON.parse(fs.readFileSync(stateFile));if(saved.state==='complete_window'&&saved.cutoff===cutoff){for(const f of saved.files)if(await hashFile(f.file)!==f.sha256)throw Error('Saved recent feed changed');return saved;}}
 const lock=path.join(dir,'.lock'),fdLock=fs.openSync(lock,'wx');fs.writeSync(fdLock,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));fs.closeSync(fdLock);
 const stamp=new Date().toISOString().replace(/[:.]/g,'-'),capture=path.join(dir,stamp);fs.mkdirSync(capture);const out=path.join(capture,'ES_RECENT_UPDATES.jsonl'),fd=fs.openSync(out+'.tmp','w');
 const state={dataset,cutoff,capture,startedAt:new Date().toISOString(),state:'running',pages:[],files:[],records:0,unresolvedLots:[],coverageLimits:['Public feed update window, not independent live confirmation of bidding availability.','Live pagination is not an atomic snapshot. Raw pages and timestamps are preserved.']};atomic(stateFile,state);
 try{
  const catalogue='https://www.hacienda.gob.es/es-ES/GobiernoAbierto/Datos%20Abiertos/Paginas/'+spec.page+'.aspx',res=await fetch(catalogue,{signal:AbortSignal.timeout(60000)});if(!res.ok)throw Error('Catalogue HTTP '+res.status);const catBytes=Buffer.from(await res.arrayBuffer()),html=catBytes.toString('utf8'),catFile=path.join(capture,'catalogue.html');fs.writeFileSync(catFile,catBytes);state.files.push({file:catFile,sha256:sha(catBytes)});
  const doc=cheerio.load(html);let url=doc('a[href]').map((i,e)=>new URL(doc(e).attr('href'),catalogue).href).get().find(u=>allowed(u)&&new URL(u).pathname.endsWith('/'+spec.prefix+'.atom'));if(!url)throw Error('Official current-feed link absent');
  const visited=new Set(),source={id:spec.id,name:'PLACSP annual public procurement archives',country:'ES',timeZone:'Europe/Madrid',adapter:'placsp',noticeType:spec.noticeType};let finished=false;
  for(let page=1;url&&page<=maxPages;page++){
   if(!allowed(url)||visited.has(url))throw Error('Unexpected or repeated feed URL');visited.add(url);
   const response=await fetch(url,{signal:AbortSignal.timeout(240000)});if(!response.ok)throw Error('Feed HTTP '+response.status);const bytes=Buffer.from(await response.arrayBuffer()),text=bytes.toString('utf8');if(bytes.length>64*1024**2)throw Error('Feed exceeds size limit');
   const raw=path.join(capture,'page-'+String(page).padStart(4,'0')+'.atom');fs.writeFileSync(raw,bytes);state.files.push({file:raw,sha256:sha(bytes)});
   validateFeed(text);const parsed=parseHistoryFeed(text,source),span=dates(text),now=new Date();if(parsed.scanned!==span.entries)throw Error('Feed entry counts differ');if(page===1&&!span.entries)throw Error('Unexpectedly empty initial recent feed');
   const combined=parsed.rows.map(x=>normalize(x,source,raw,now)).filter(r=>r.relevance!=='unrelated');const lots=lotRows(text,source,raw,now);combined.push(...lots.rows);state.unresolvedLots.push(...lots.unresolved);
   for(const r of combined){if(r.sourceUpdated&&Number.isFinite(Date.parse(r.sourceUpdated))&&Date.parse(r.sourceUpdated)<Date.parse(cutoff+'T00:00:00Z'))continue;fs.writeSync(fd,JSON.stringify(r)+'\n');state.records++;}
   const xml=cheerio.load(text,{xml:true}),next=xml('*').filter((i,e)=>e.name?.split(':').pop()==='link'&&xml(e).attr('rel')==='next').first().attr('href');
   state.pages.push({url,raw,sha256:sha(bytes),retrievedAt:now.toISOString(),lastModified:response.headers.get('last-modified'),...span});atomic(stateFile,state);console.log(JSON.stringify({dataset,page,entries:span.entries,oldest:span.min,records:state.records}));
   if(!next||!span.entries||(span.valid===span.entries&&span.max?.slice(0,10)<cutoff)){finished=true;break;}url=new URL(next,url).href;await new Promise(r=>setTimeout(r,500));
  }
  if(!finished)throw Error('Recent-feed page limit reached before historical overlap');
  fs.closeSync(fd);fs.renameSync(out+'.tmp',out);state.files.push({file:out,sha256:await hashFile(out)});state.recordsFile=out;state.finishedAt=new Date().toISOString();state.state='complete_window';atomic(stateFile,state);atomic(path.join(capture,'state.json'),state);return state;
 }catch(e){try{fs.closeSync(fd);}catch{}state.state='partial';state.error=e.stack;state.finishedAt=new Date().toISOString();atomic(stateFile,state);atomic(path.join(capture,'state.json'),state);throw e;}finally{fs.unlinkSync(lock);}
}
if(require.main===module){const [run,dataset,cutoff]=process.argv.slice(2);collect(path.resolve(run),dataset,cutoff).then(x=>console.log(JSON.stringify({dataset,state:x.state,records:x.records,pages:x.pages.length}))).catch(e=>{console.error(e.stack);process.exitCode=1;});}
module.exports={collect,dates,allowed,validateFeed};
