#!/usr/bin/env node
'use strict';
const fs=require('node:fs');const path=require('node:path');const ExcelJS=require('exceljs');
const {sources,countries}=require('./sources.cjs');const {hash,normalize,latestRecords,fields,statusOf}=require('./core.cjs');const adapters=require('./adapters.cjs');
const {spanishArchives,readArchive}=require('./archives.cjs');const {PublicBrowser}=require('./browser.cjs');
adapters.epps=ctx=>require('./epps.cjs').epps(ctx);
function args(argv){
 const o={from:'2020-01-01',to:new Date().toISOString().slice(0,10),mode:'refresh',pages:2000,webPages:100,depth:3,delay:1200,timeout:45000,searchLimit:20,concurrency:2,output:path.join(__dirname,'data'),sources:'all'};
 const names={'from':'from','to':'to','mode':'mode','max-pages':'pages','web-pages':'webPages','depth':'depth','delay-ms':'delay','timeout-ms':'timeout','search-limit':'searchLimit','concurrency':'concurrency','output':'output','sources':'sources','seeds':'seedsFile','import-dir':'importDir','resume':'resume','discover':'discover','list-sources':'list','help':'help'};
 names['raw-cache-dir']='rawCacheDir';names.archives='archives';names.render='render';names.browser='browser';
 names['archive-timeout-ms']='archiveTimeout';
 for(const a of argv){const m=a.match(/^--([\w-]+)(?:=(.*))?$/);if(!m||!names[m[1]])throw Error('Unknown option: '+a);const k=names[m[1]];o[k]=['resume','discover','list','help','archives','render','browser'].includes(k)?true:m[2];if(o[k]===undefined)throw Error('Use --name=value: '+a);}
 if(!['refresh','smoke'].includes(o.mode))throw Error('mode must be refresh or smoke');
 for(const k of ['pages','webPages','depth','delay','timeout','searchLimit','concurrency']){o[k]=Number(o[k]);if(!Number.isInteger(o[k])||o[k]<0)throw Error('Invalid '+k);}
 if(!o.pages||!o.webPages||!o.timeout||!o.concurrency||o.concurrency>4)throw Error('Positive limits required; concurrency must be 1-4');
 if(o.archiveTimeout!==undefined){o.archiveTimeout=Number(o.archiveTimeout);if(!Number.isInteger(o.archiveTimeout)||o.archiveTimeout<1000)throw Error('Invalid archive timeout');}
 for(const k of ['from','to'])if(!/^\d{4}-\d{2}-\d{2}$/.test(o[k])||new Date(o[k]).toISOString().slice(0,10)!==o[k])throw Error('Invalid '+k+' date');
 if(o.from< '2020-01-01'||o.from>o.to)throw Error('Date range must start in 2020 or later, and from <= to');
 if(o.mode==='smoke'){o.pages=1;o.webPages=1;o.timeout=Math.min(o.timeout,15000);}
 o.output=path.resolve(o.output);if(o.seedsFile)o.seeds=JSON.parse(fs.readFileSync(o.seedsFile,'utf8'));else if(fs.existsSync(path.join(__dirname,'seeds.json')))o.seeds=JSON.parse(fs.readFileSync(path.join(__dirname,'seeds.json'),'utf8'));
 return o;
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function writeJSON(file,data){const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(data,null,2),'utf8');fs.renameSync(temp,file);}
function writeLines(file,rows){const fd=fs.openSync(file+'.tmp','w');try{for(const r of rows)fs.writeSync(fd,JSON.stringify(r)+'\n',null,'utf8');}finally{fs.closeSync(fd);}fs.renameSync(file+'.tmp',file);}
async function request(url,options,init={},binary=false){
 for(let attempt=0;attempt<3;attempt++){
  try{const res=await fetch(url,{...init,headers:{'User-Agent':'EU27SpaceProcurementCollector/1.0 (public procurement research)','Accept':'application/json, application/atom+xml, text/html;q=0.9, */*;q=0.5',...init.headers},signal:AbortSignal.timeout(options.timeout)});
   if((res.status===429||res.status>=500)&&attempt<2){const h=res.headers.get('retry-after');const delay=h?(Number(h)*1000||Date.parse(h)-Date.now()):2000*2**attempt;await res.body?.cancel();await sleep(Math.min(60000,Math.max(1000,delay)));continue;}
   if(!res.ok){await res.body?.cancel();throw Error('HTTP '+res.status);}
   const chunks=[];let bytes=0;for await(const c of res.body){bytes+=c.length;if(bytes>25*1024*1024)throw Error('Response exceeds 25 MiB; use an archive importer');chunks.push(c);}return binary?Buffer.concat(chunks):Buffer.concat(chunks).toString('utf8');
  }catch(e){if(attempt>=2||/HTTP 4\d\d|exceeds/.test(e.message))throw e;await sleep(1000*2**attempt);}
 }
}
async function exportData(dir,rows,coverage,now,options={}){
 fs.mkdirSync(dir,{recursive:true});
 // Keep every notice version in HISTORY. Only consolidate stable procedure IDs
 // within the same source. Cross-portal near-duplicates are retained with provenance.
 const history=[...new Map(rows.map(r=>[r.recordId,r])).values()];
 for(const r of history){if(options.preserveStatus)continue;[r.status,r.statusEvidence]=statusOf(r,now);r.ragText=[r.title,r.description,`Country: ${r.country}; Buyer: ${r.buyer||''}; Status: ${r.status}; Deadline: ${r.deadline||r.deadlineRaw||'unknown'}; Source: ${r.sourceUrl}`].join('\n').slice(0,32000);}
 const latest=latestRecords(history).sort((a,b)=>String(a.deadline||'9999').localeCompare(String(b.deadline||'9999')));
 const confirmed=latest.filter(r=>r.noticeVerified===true&&r.relevance==='space');
 const open=confirmed.filter(r=>r.status==='open');
 const review=latest.filter(r=>r.noticeVerified!==true||r.relevance==='possible_space'||r.dateScope==='unknown_publication_date');
 const base=(options.prefix||'EU27_NATIONAL_SPACE')+'_'+now.toISOString().slice(0,10);
 const sets={MASTER:latest,OPEN:open,HISTORY:history,REVIEW:review};
 for(const [suffix,data] of Object.entries(sets))writeLines(path.join(dir,base+'_'+suffix+'.jsonl'),data);
 writeLines(path.join(dir,base+'_COVERAGE.jsonl'),coverage);
 const wb=new ExcelJS.Workbook();wb.creator='EU27 national procurement collector';
 for(const [name,data] of Object.entries(sets)){const ws=wb.addWorksheet(name);ws.columns=fields.map(key=>({header:key,key,width:['title','sourceUrl','description','ragText'].includes(key)?65:22}));for(const row of data)ws.addRow(row);ws.views=[{state:'frozen',ySplit:1}];ws.autoFilter={from:{row:1,column:1},to:{row:1,column:fields.length}};}
 const ws=wb.addWorksheet('COVERAGE');const keys=['sourceId','country','name','adapter','url','reference','state','requests','records','startedAt','finishedAt','gaps','error'];ws.columns=keys.map(key=>({header:key,key,width:key==='gaps'?100:25}));coverage.forEach(c=>ws.addRow({...c,gaps:c.gaps.join(' | ')}));
 const file=path.join(dir,base+'.xlsx');await wb.xlsx.writeFile(file+'.tmp');fs.renameSync(file+'.tmp',file);
 // Read back the real workbook, not an in-memory model. All normalized fields
 // are shared by JSONL and Excel, including empty values and booleans.
 const read=new ExcelJS.Workbook();await read.xlsx.readFile(file);let compared=0;
 for(const [name,data] of Object.entries(sets)){const sheet=read.getWorksheet(name);if(sheet.actualRowCount!==data.length+1)throw Error('Excel count mismatch: '+name);data.forEach((r,i)=>fields.forEach((k,j)=>{if((sheet.getCell(i+2,j+1).value??'')!==r[k])throw Error(`Excel mismatch ${name} row ${i+2} ${k}`);compared++;}));}
 const summary={createdAt:now.toISOString(),files:[file,...Object.keys(sets).map(k=>path.join(dir,base+'_'+k+'.jsonl')),path.join(dir,base+'_COVERAGE.jsonl')],counts:Object.fromEntries(Object.entries(sets).map(([k,v])=>[k,v.length])),coverageCounts:coverage.reduce((a,c)=>(a[c.state]=(a[c.state]||0)+1,a),{}),excelJsonlFieldsCompared:compared};
 if(!options.singleCountry)summary.countries=await exportCountries(dir,rows,coverage,now);
 writeJSON(path.join(dir,'validation.json'),summary);return summary;
}
async function exportCountries(dir,rows,coverage,now,options={}){
 // Fail explicitly rather than silently dropping records with an unknown country.
 const groups=new Map(countries.map(([code,name])=>[code,name]));
 groups.set('EU','European Union');
 for(const r of [...rows,...coverage])if(!groups.has(r.country))throw Error('Unknown country in export: '+r.country);
 const results={};
 for(const [code,name] of groups){
  const countryRows=rows.filter(r=>r.country===code),countryCoverage=coverage.filter(r=>r.country===code);
  if(code==='EU'&&!countryRows.length&&!countryCoverage.length)continue;
  results[code]=await exportData(path.join(dir,name),countryRows,countryCoverage,now,{singleCountry:true,prefix:code+'_NATIONAL_SPACE',preserveStatus:options.preserveStatus===true});
 }
 return results;
}
async function main(){
 const o=args(process.argv.slice(2));
 if(o.help){console.log('node collect.cjs [--mode=smoke|refresh] [--sources=all|FR-portal,EU-SST] [--from=2020-01-01] [--to=YYYY-MM-DD] [--max-pages=2000] [--web-pages=100] [--depth=3] [--output=DIR] [--resume] [--discover] [--seeds=FILE] [--import-dir=DIR]\nSearch discovery uses optional FIRECRAWL_API_KEY. No credentials are needed by native public adapters.');return;}
 if(o.list){console.log(JSON.stringify(sources,null,2));return;}
 const selected=o.sources==='all'?sources:sources.filter(s=>o.sources.split(',').includes(s.id));if(!selected.length||o.sources!=='all'&&selected.length!==new Set(o.sources.split(',')).size)throw Error('Unknown source ID; use --list-sources');
 fs.mkdirSync(o.output,{recursive:true});
 const checkpoint=path.join(o.output,'checkpoint.json'),identity=hash(JSON.stringify({...o,resume:undefined,output:undefined,seedsFile:undefined}));
 let state={identity,runId:new Date().toISOString().replace(/[:.]/g,'-'),completed:[],rows:[],coverage:[]};
 if(o.resume&&fs.existsSync(checkpoint)){state=JSON.parse(fs.readFileSync(checkpoint,'utf8'));if(state.identity!==identity)throw Error('Resume options differ from checkpoint; use a new output directory.');}
 const dir=path.join(o.output,state.runId);fs.mkdirSync(path.join(dir,'raw'),{recursive:true});
 const lock=path.join(o.output,'.collection.lock');let fd;try{fd=fs.openSync(lock,'wx');}catch{throw Error('Output folder is locked by another run. Check that process before removing .collection.lock.');}fs.writeSync(fd,String(process.pid));fs.closeSync(fd);
 const browser=new PublicBrowser();const now=new Date();const hostTimes=new Map();let cursor=0;
 const liveReports=new Map();let lastProgress=0;
 function progress(force=false){if(!force&&Date.now()-lastProgress<5000)return;lastProgress=Date.now();writeJSON(path.join(o.output,'progress.json'),{runId:state.runId,updatedAt:new Date().toISOString(),sources:[...liveReports.values()]});}
 function save(){writeJSON(checkpoint,state);}
 try{
  const jobs=selected.filter(s=>!state.completed.includes(s.id));
  async function worker(){while(cursor<jobs.length){const source=jobs[cursor++];
   const report={sourceId:source.id,country:source.country,name:source.name,adapter:source.adapter,url:source.url,reference:source.reference,state:'running',requests:0,records:0,startedAt:new Date().toISOString(),finishedAt:'',gaps:[],error:''};
   liveReports.set(source.id,report);progress(true);
   const gathered=[];const ctx={source,options:o,rawDir:path.join(dir,'raw'),recordRequest:()=>{report.requests++;progress();},canFetch:()=>report.requests<o.pages,gap:m=>{if(!report.gaps.includes(m))report.gaps.push(m);},
    get:async url=>{if(!ctx.canFetch())throw Error('Request budget exhausted');report.requests++;progress();const cachedName=source.id+'-'+hash(url).slice(0,20)+'.txt';const cachedPath=path.join(dir,'raw',cachedName);if(o.resume&&fs.existsSync(cachedPath)){const buffer=fs.readFileSync(cachedPath);return {body:buffer.toString('utf8'),buffer,rawFile:'raw/'+cachedName};}const host=new URL(url).hostname;const slot=Math.max(Date.now(),hostTimes.get(host)||0);hostTimes.set(host,slot+o.delay);await sleep(Math.max(0,slot-Date.now()));const buffer=await request(url,o,{},true);const body=buffer.toString('utf8');const name=source.id+'-'+hash(url).slice(0,20)+'.txt';fs.writeFileSync(path.join(dir,'raw',name),buffer);fs.appendFileSync(path.join(dir,'raw','requests.jsonl'),JSON.stringify({sourceId:source.id,url,file:name,retrievedAt:new Date().toISOString()})+'\n');return {body,buffer,rawFile:'raw/'+name};},
    browse:url=>browser.get(url,o.timeout),saveRendered:(url,html)=>{const name=source.id+'-'+hash(url).slice(0,20)+'-rendered.html';fs.writeFileSync(path.join(dir,'raw',name),html,'utf8');return 'raw/'+name;},firecrawl:async(endpoint,payload)=>{const body=await request('https://api.firecrawl.dev/v2/'+endpoint,o,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.FIRECRAWL_API_KEY},body:JSON.stringify(payload)});return JSON.parse(body);},
    emit:(x,rawFile)=>{const r=normalize(x,source,rawFile,now);if(r.relevance==='unrelated')return;if(r.publicationDate&&(r.publicationDate<o.from||r.publicationDate>o.to))return;gathered.push(r);report.records++;progress();}
   };
   console.log(`[${source.id}] collecting ${source.name}`);
   try{const fn={...require("./native-portals-final.cjs"),...require("./native-portals-more.cjs"),...require("./native-portals-extra.cjs"),...require('./native-portals.cjs'),...require('./priority.cjs'),...require('./italy.cjs'),...require('./spain-agency.cjs'),epps:adapters.epps,dlr:adapters.dlr,austria:adapters.austria,boamp:adapters.boamp,bzp:adapters.bzp,placsp:adapters.feed,tenderned:adapters.feed,eusst:adapters.eusst,web:adapters.web}[source.adapter];await fn(ctx);if(o.archives&&o.mode!=='smoke'&&source.adapter==='placsp'){await spanishArchives(ctx,path.join(dir,'raw'));}if(o.archives&&o.mode!=='smoke'&&source.adapter==='tenderned')await require('./netherlands.cjs').dutchArchives(ctx);report.state=source.adapter==='web'&&!gathered.some(r=>r.noticeVerified===true)?'discovery_only':report.gaps.length?'partial':'collected';}
   catch(e){report.state='failed';report.error=e.message;}
   report.finishedAt=new Date().toISOString();state.rows.push(...gathered);state.coverage.push(report);state.completed.push(source.id);save();progress(true);console.log(`[${source.id}] ${report.state}: ${report.records} candidate records, ${report.requests} requests${report.error?' — '+report.error:''}`);
  }}
  await Promise.all(Array.from({length:o.concurrency},worker));
  if(o.importDir){
   // Input names identify the source, e.g. ES-portal__2020-01.atom. Extract ZIPs
   // before import; never execute files or scripts contained in archives.
   for(const file of fs.readdirSync(o.importDir).filter(x=>/\.(xml|atom)$/i.test(x))){const id=file.split('__')[0],source=selected.find(s=>s.id===id);if(!source||!['placsp','tenderned'].includes(source.adapter))throw Error('Import filename must begin with a selected feed source ID and __: '+file);const text=fs.readFileSync(path.join(o.importDir,file),'utf8');const rawFile='raw/import-'+file;fs.writeFileSync(path.join(dir,rawFile),text,'utf8');for(const x of adapters.parseFeed(text,source).rows){const r=normalize(x,source,rawFile,now);if(r.relevance!=='unrelated'&&(!r.publicationDate||r.publicationDate>=o.from&&r.publicationDate<=o.to))state.rows.push(r);}}
  }
  const summary=await exportData(dir,state.rows,state.coverage,new Date());console.log(JSON.stringify(summary,null,2));
 }finally{await browser.close();fs.unlinkSync(lock);}
}
if(require.main===module)main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
module.exports={args,exportData,exportCountries,request,main};
