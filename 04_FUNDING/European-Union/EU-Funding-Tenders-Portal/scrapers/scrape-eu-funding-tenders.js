#!/usr/bin/env node
'use strict';
// Phase 1 item 1. Node 22+; npm install from the package directory.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');
const API = 'https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA';
const PORTAL = 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/';
const VERSION = '1.0.0';
const sha = x => crypto.createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');
const arr = x => x == null ? [] : Array.isArray(x) ? x : [x];
const clean = x => arr(x).map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join('\n').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const first = x => clean(arr(x)[0]);
const pause = ms => new Promise(r => setTimeout(r, ms));
// Use the stable core HTTPS client, avoiding platform-specific fetch/undici parser failures.
async function httpFetch(url,options) {
  const boundary='----EUFunding'+crypto.randomBytes(16).toString('hex');const chunks=[];
  for(const [name,blob]of options.body.entries()){chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${name}.json"\r\nContent-Type: application/json\r\n\r\n`));chunks.push(Buffer.from(await blob.arrayBuffer()),Buffer.from('\r\n'));}
  chunks.push(Buffer.from(`--${boundary}--\r\n`));const body=Buffer.concat(chunks);
  return new Promise((resolve,reject)=>{const req=https.request(url,{method:'POST',headers:{...options.headers,'Content-Type':`multipart/form-data; boundary=${boundary}`,'Content-Length':body.length,'Accept-Encoding':'identity',Connection:'close'},signal:options.signal},res=>{const data=[];res.on('data',b=>data.push(b));res.on('error',reject);res.on('end',()=>resolve(new Response(Buffer.concat(data),{status:res.statusCode,headers:res.headers})));});req.on('error',reject);req.end(body);});
}
function dates(x) { return arr(x).map(v => {const n = typeof v === 'number' ? v : Date.parse(String(v)); return Number.isFinite(n) ? new Date(n).toISOString() : null;}).filter(Boolean).sort(); }
function classify(r) {
  const m = r.metadata || {};
  // Do not search boilerplate support links: they can mention unrelated space programmes.
  const text = clean([m.identifier,m.title,m.callTitle,r.content,m.description,m.descriptionByte,m.keywords,m.tags,m.destinationDescription,m.missionDescription]).toLowerCase();
  const groups = {
    upstream: /\b(spacecraft|satellites?|launchers?|space propulsion|space robotics|in.orbit|ground segment|space debris|space surveillance|space situational awareness|space traffic|payloads?)\b/g,
    downstream: /\b(earth observation|copernicus|galileo|egnos|gnss|satellite navigation|satellite communications?|satcom|space.derived|space.based|pnt)\b/g,
    science: /\b(astronomy|astrophysics|planetary science|microgravity|space exploration|space science)\b/g,
    commercialization: /\b(cassini|space startups?|space entrepreneurs?|space commercialisation|space commercialization)\b/g,
    explicit_space: /\b(space technology|space systems?|space sector|space industr(?:y|ies)|outer space|space infrastructure)\b|(?:horizon|h2020)[\w-]*-space-/g
  };
  const evidence = []; const categories = [];
  for (const [category,re] of Object.entries(groups)) {const hits = [...new Set(text.match(re) || [])]; if(hits.length){categories.push(category); evidence.push(...hits);}}
  const defence = /\b(defen[cs]e|military|dual.use|secure communications|isr)\b/.test(text);
  const enabling = /\b(quantum|cybersecurity|semiconductors?|advanced materials|artificial intelligence|optical communications|autonomous systems)\b/.test(text);
  const sector = /\b(agriculture|forestry|wildfire|climate|maritime|transport|energy|logistics|insurance|disaster|smart cities)\b/.test(text);
  if(categories.length){if(defence)categories.push('dual_use');if(enabling)categories.push('enabling');if(sector)categories.push('space_enabled_application');return {decision:'relevant',categories,evidence:[...new Set(evidence)],method:'rules-v1',confidence:'evidence_based_candidate'};}
  if(enabling || sector || /\b(space|eic|accelerator|deep.tech)\b/.test(text)) return {decision:'review',categories:['potential_space_eligibility'],evidence:[],method:'rules-v1',confidence:'unconfirmed',reason:'Potential application or broad eligibility; no explicit space evidence.'};
  return {decision:'excluded',categories:[],evidence:[],method:'rules-v1',confidence:'unconfirmed',reason:'No rule matched; retained for audit.'};
}
function normalize(r, checkedAt, evidenceFile) {
  if(!r || typeof r !== 'object' || !r.metadata) throw new Error('Missing record metadata');
  const m=r.metadata, identifier=first(m.identifier), type=first(m.type);
  const sourceReference=String(r.reference || first(m.REFERENCE) || '');
  const canonicalId='eu-ft:'+(identifier ? `topic:${identifier.toUpperCase()}` : `type:${type}:ref:${sourceReference || sha(r)}`);
  const statusCodes=arr(m.status).map(String), unique=[...new Set(statusCodes)];
  const labels={'31094501':'forthcoming','31094502':'open','31094503':'closed'};
  let status=unique.length===1 ? labels[unique[0]] || 'uncertain' : 'uncertain';
  const actions=arr(m.actions).flatMap(v=>{try{return arr(typeof v==='string'?JSON.parse(v):v);}catch{return [];}});
  const explicitCancellation=actions.some(a=>/^(cancelled|canceled|withdrawn)$/i.test(a?.status?.description || a?.status?.abbreviation || ''));
  if(explicitCancellation) status='cancelled';
  const deadlines=dates(m.deadlineDate), openings=dates(m.startDate), warnings=[];
  const future=deadlines.filter(d=>d>checkedAt);
  if(status==='open' && deadlines.length && !future.length){warnings.push('Source says open but all indexed deadlines have passed.');status='uncertain';}
  if(status==='forthcoming' && openings.length && openings[0]<checkedAt){warnings.push('Source says forthcoming but indexed opening date has passed.');status='uncertain';}
  if(status==='open' && !deadlines.length){warnings.push('No parseable deadline; rolling eligibility must be checked.');status='uncertain';}
  const actionText=clean([m.typesOfAction,actions.map(a=>a.types)]);
  const mechanism=/\bprize\b/i.test(actionText)?'prize':/\bprocurement|tender\b/i.test(actionText)?'procurement':/\bgrant|ria|innovation action|research and innovation|csa\b/i.test(actionText)?'grant':'funding_unspecified';
  const sourceUrl=r.url || first(m.url);
  return {schemaVersion:1,canonicalId,identifier:identifier||null,sourceReference,source:'EU Funding & Tenders Portal',sourceType:type,mechanism,title:clean(m.title)||clean(m.callTitle)||clean(r.content)||clean(r.summary),callIdentifier:first(m.callIdentifier)||null,programmeCode:first(m.frameworkProgramme)||null,programmePeriod:first(m.programmePeriod)||null,status,sourceStatusCodes:statusCodes,openings,deadlines,nextDeadline:future[0]||null,deadlineModel:first(m.deadlineModel)||null,description:clean(m.description)||clean(m.descriptionByte),actionText,
    budgetSource:arr(m.budget),budgetMeaning:'Source budget field; not an award or guaranteed per-project amount',eligibilityText:clean(m.beneficiaryAdministration)||clean(m.topicConditions)||null,eligibilityVerified:false,
    topicConditionsHtml:arr(m.topicConditions),actions,linksSource:arr(m.links),furtherInformation:arr(m.furtherInformation),classification:classify(r),sourceUrl,applicationUrl:identifier?`${PORTAL}screen/opportunities/topic-details/${encodeURIComponent(identifier.toLowerCase())}`:null,lastChecked:checkedAt,evidenceFile,sourceChecksum:r.checksum||null,warnings};
}
function queryFor(shard) {
  const must=[{terms:{type:['1','2','8']}}];
  if(shard.kind==='current') must.push({terms:{status:['31094501','31094502']}});
  else if(shard.kind==='dated') must.push({bool:{should:['startDate','deadlineDate'].map(f=>({range:{[f]:{gte:shard.from,lte:shard.to-1}}}))}});
  else must.push({bool:{must_not:['startDate','deadlineDate'].map(f=>({range:{[f]:{gte:0}}}))}});
  must.push({terms:{language:['en']}});return {bool:{must}};
}
function makeShards(mode,since,until) {
  const result=[];
  if(mode!=='history') result.push({id:'current',kind:'current'});
  if(mode!=='current') {
    for(let y=since;y<=until;y++)for(let month=0;month<12;month++)result.push({id:`history-${y}-${String(month+1).padStart(2,'0')}`,kind:'dated',from:Date.UTC(y,month,1),to:Date.UTC(y,month+1,1)});
    result.push({id:'undated-review',kind:'undated'});
  }
  return result;
}
async function atomic(file,value) {await fs.mkdir(path.dirname(file),{recursive:true});const tmp=file+'.tmp';await fs.writeFile(tmp,typeof value==='string'?value:JSON.stringify(value,null,2));await fs.rename(tmp,file);}
async function read(file,fallback) {try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
async function request(shard,page,size,fetcher=httpFetch) {
  const u=new URL(API);for(const [k,v]of Object.entries({text:'***',pageSize:size,pageNumber:page}))u.searchParams.set(k,String(v));
  let error;
  for(let attempt=0;attempt<5;attempt++) {
    const form=new FormData();for(const[k,v]of Object.entries({query:queryFor(shard),sort:{order:'ASC',field:'identifier'},languages:['en']}))form.append(k,new Blob([JSON.stringify(v)],{type:'application/json'}),k+'.json');
    try {
      const response=await fetcher(u,{method:'POST',body:form,headers:{Accept:'application/json',Referer:PORTAL,'User-Agent':`EUFundingCollector/${VERSION}`},signal:AbortSignal.timeout(60000)});
      if(!response.ok){const err=new Error(`HTTP ${response.status}: ${(await response.text()).slice(0,200)}`);err.permanent=response.status<500 && ![408,429].includes(response.status);err.retryAfter=response.headers.get('retry-after');throw err;}
      const raw=await response.text();const data=JSON.parse(raw);
      if(!Array.isArray(data.results)||!Number.isInteger(data.totalResults)||data.totalResults<0||data.pageNumber!==page||data.pageSize!==size) {const e=new Error('API schema/pagination mismatch');e.permanent=true;throw e;}
      return {data,raw,url:String(u)};
    }catch(e){error=e;if(e.permanent)break;if(attempt<4){const seconds=Number(e.retryAfter);const dateDelay=Date.parse(e.retryAfter)-Date.now();await pause(Math.min(60000,Math.max(1000,Number.isFinite(seconds)?seconds*1000:Number.isFinite(dateDelay)?dateDelay:1000*2**attempt))+Math.random()*300);}}
  }
  throw error;
}
function options(argv) {
  const o={mode:'all',since:2020,until:new Date().getUTCFullYear(),pageSize:100,maxPages:0,resume:false,out:path.resolve(process.env.FUNDING_OUTPUT_DIR||path.join(__dirname,'..'))};
  for(let i=0;i<argv.length;i++){const k=argv[i];if(k==='--resume'){o.resume=true;continue;}if(k==='--help'){o.help=true;continue;}const names={'--mode':'mode','--since':'since','--until':'until','--page-size':'pageSize','--max-pages':'maxPages','--out':'out'};if(!names[k]||!argv[i+1]||argv[i+1].startsWith('--'))throw new Error(`Unknown/missing argument: ${k}`);const name=names[k],v=argv[++i];o[name]=['since','until','pageSize','maxPages'].includes(name)?Number(v):v;}
  if(!['all','current','history'].includes(o.mode)||!Number.isInteger(o.since)||o.since<2020||!Number.isInteger(o.until)||o.until<o.since||o.until>2100||!Number.isInteger(o.pageSize)||o.pageSize<1||o.pageSize>100||!Number.isInteger(o.maxPages)||o.maxPages<0)throw new Error('Invalid mode, date range, page size, or limit');o.out=path.resolve(o.out);return o;
}
async function exportData(root,runId,records,manifest) {
  const dir=path.join(root,'generated','snapshots',runId);await fs.mkdir(dir,{recursive:true});
  const views={master:records,open:records.filter(r=>r.status==='open'&&r.classification.decision==='relevant'),forthcoming:records.filter(r=>r.status==='forthcoming'&&r.classification.decision==='relevant'),historical:records.filter(r=>r.status==='closed'&&r.classification.decision==='relevant'),'manual-review':records.filter(r=>r.classification.decision==='review'||r.status==='uncertain'||r.historicalScope==='undated'),'space-relevant':records.filter(r=>r.classification.decision==='relevant'),excluded:records.filter(r=>r.classification.decision==='excluded')};
  manifest.files=[];
  for(const [name,rows] of Object.entries(views)){
    const lines=rows.map(r=>JSON.stringify(r)+'\n');await fs.writeFile(path.join(dir,`funding-${name}.jsonl`),lines.join(''));
    // Full records in bounded GitHub-readable parts. Never truncate a record.
    let chunk='',count=0,index=0;const flush=async()=>{if(!chunk)return;const file=`funding-${name}.part-${String(++index).padStart(4,'0')}.jsonl`;await fs.writeFile(path.join(dir,file),chunk);manifest.files.push({view:name,file,records:count,bytes:Buffer.byteLength(chunk),sha256:sha(chunk)});chunk='';count=0;};
    for(const line of lines){if(chunk&&Buffer.byteLength(chunk)+Buffer.byteLength(line)>128*1024)await flush();chunk+=line;count++;}await flush();
  }
  const ExcelJS=require('exceljs');const workbook=new ExcelJS.Workbook();workbook.creator='EU Funding Collector';
  const columns=['canonicalId','title','status','classification','categories','mechanism','callIdentifier','programmeCode','openings','deadlines','nextDeadline','budgetSource','eligibilityText','description','applicationUrl','sourceUrl','lastChecked','warnings','evidenceFile'];
  // Excel is a readable projection; full long fields remain in JSONL.
  let clipped=0,sanitized=0;
  for(const name of ['master','open','forthcoming','historical','manual-review']){
    const sheet=workbook.addWorksheet(name,{views:[{state:'frozen',ySplit:1}]});sheet.columns=columns.map(key=>({header:key,key,width:['title','eligibilityText','description'].includes(key)?55:26}));
    for(const r of views[name]){const row={...r,classification:r.classification.decision,categories:r.classification.categories.join(', ')};for(const key of columns){let v=row[key];if(Array.isArray(v))v=v.join('\n');if(v==null)v='';v=String(v);const safe=[...v].filter(c=>{const n=c.codePointAt(0);return n===9||n===10||n===13||(n>=32&&n<=0xd7ff)||(n>=0xe000&&n<=0xfffd)||(n>=0x10000&&n<=0x10ffff);}).join('');if(safe!==v)sanitized++;v=safe;if(v.length>32767){v=v.slice(0,32700).replace(/[\uD800-\uDBFF]$/,'')+' [TRUNCATED IN EXCEL; see JSONL]';clipped++;}row[key]=v;}sheet.addRow(row);}
    sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF16324F'}};sheet.autoFilter={from:'A1',to:{row:Math.max(1,sheet.rowCount),column:columns.length}};
  }
  manifest.excelClippedCells=clipped;manifest.excelSanitizedCells=sanitized;await workbook.xlsx.writeFile(path.join(dir,'funding-master.xlsx'));await atomic(path.join(dir,'manifest.json'),manifest);
  // The pointer is the commit boundary. Partial runs never replace latest-complete.
  const pointer={runId,status:manifest.status,path:path.relative(root,dir).replace(/\\/g,'/'),manifest:'manifest.json'};
  await atomic(path.join(root,'generated','latest-attempt.json'),pointer);
  if(manifest.status==='complete')await atomic(path.join(root,'generated','latest-complete.json'),pointer);
  return dir;
}
async function main(argv=process.argv.slice(2),fetcher=httpFetch) {
  const o=options(argv);if(o.help){console.log('node scrapers/scrape-eu-funding-tenders.js --mode all|current|history --since 2020 --until YEAR --page-size 100 --max-pages 0 --out DIRECTORY --resume');return;}
  const config={version:VERSION,mode:o.mode,since:o.since,until:o.until,pageSize:o.pageSize};const configHash=sha(config);const checkpointFile=path.join(o.out,'checkpoints',`${o.mode}.json`);
  await fs.mkdir(path.join(o.out,'checkpoints'),{recursive:true});
  let state=o.resume?await read(checkpointFile,null):null;
  if(o.resume&&!state)throw new Error('No checkpoint exists; run without --resume first.');
  if(state&&state.configHash!==configHash)throw new Error('Resume options/version do not match checkpoint. Use the original mode/date range/page size.');
  if(state?.done){console.log('Checkpoint already finished. Run without --resume to refresh.');return;}
  if(!state)state={runId:new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(3).toString('hex'),configHash,config,shards:makeShards(o.mode,o.since,o.until),shardIndex:0,page:1,pages:[],ledger:[],startedAt:new Date().toISOString()};
  const rawDir=path.join(o.out,'raw',state.runId);await fs.mkdir(rawDir,{recursive:true});
  // Exclusive lock prevents simultaneous writers. A crashed process leaves a lock to inspect.
  const lockFile=path.join(o.out,'checkpoints','collector.lock');let lock;
  try{lock=await fs.open(lockFile,'wx');await lock.writeFile(JSON.stringify({pid:process.pid,runId:state.runId,startedAt:new Date().toISOString()}));}catch(e){if(e.code==='EEXIST')throw new Error(`Collector lock exists: ${lockFile}. Verify its PID is no longer running before removing it.`);throw e;}
  let fatal=null,pagesThisRun=0;
  try{
    await atomic(checkpointFile,state);
    while(state.shardIndex<state.shards.length){
      if(o.maxPages&&pagesThisRun>=o.maxPages)break;
      const shard=state.shards[state.shardIndex];const response=await request(shard,state.page,o.pageSize,fetcher);const d=response.data;
      let ledger=state.ledger.find(x=>x.id===shard.id);
      if(!ledger){ledger={id:shard.id,totalAtStart:d.totalResults,received:0,complete:false,warnings:[]};state.ledger.push(ledger);}
      if(d.totalResults!==ledger.totalAtStart && !ledger.warnings.includes('Total changed during pagination'))ledger.warnings.push('Total changed during pagination');
      if(d.warnings?.length)ledger.warnings.push(...d.warnings.map(clean));
      if(d.results.length>o.pageSize)throw new Error('API returned more than page size');
      if(!d.results.length && ledger.received<ledger.totalAtStart)throw new Error('Unexpected empty page before advertised total');
      const fingerprint=sha(d.results.map(r=>[r.reference,r.checksum]));
      if(d.results.length && state.pages.some(p=>p.shard===shard.id&&p.fingerprint===fingerprint))throw new Error('Repeated page detected');
      // Result-window protection: subdivide a date shard before committing its first page.
      if(state.page===1 && d.totalResults>9000){
        if(shard.kind!=='dated'||shard.to-shard.from<=86400000)throw new Error('Shard exceeds safe result window; cannot establish coverage.');
        const mid=Math.floor((shard.from+shard.to)/2);state.shards.splice(state.shardIndex,1,{...shard,id:shard.id+'a',to:mid},{...shard,id:shard.id+'b',from:mid});state.ledger=state.ledger.filter(x=>x.id!==shard.id);await atomic(checkpointFile,state);continue;
      }
      for(const r of d.results)normalize(r,new Date().toISOString(),'pending'); // Reject malformed page before checkpoint advancement.
      const filename=`${shard.id}-page-${String(state.page).padStart(5,'0')}.json`;const file=path.join(rawDir,filename);
      // Replayed uncommitted pages may replace the pending file; committed evidence is never overwritten.
      await atomic(file,response.raw);const checkedAt=new Date().toISOString();
      state.pages.push({shard:shard.id,file:path.relative(o.out,file).replace(/\\/g,'/'),sha256:sha(response.raw),fingerprint,checkedAt,requestUrl:response.url,query:queryFor(shard),records:d.results.length});
      ledger.received+=d.results.length;pagesThisRun++;
      if(state.page*o.pageSize>=d.totalResults){ledger.complete=true;state.shardIndex++;state.page=1;}else state.page++;
      await atomic(checkpointFile,state);console.log(`${shard.id}: ${ledger.received}/${d.totalResults}`);await pause(350);
    }
  }catch(e){fatal=e;console.error(e.message);} 
  try{
    const map=new Map();const originals=new Map();let duplicates=0;const conflicts=[];
    for(const p of state.pages){const raw=await fs.readFile(path.join(o.out,p.file),'utf8');if(sha(raw)!==p.sha256)throw new Error(`Evidence checksum mismatch: ${p.file}`);for(const r of JSON.parse(raw).results){let normalized=normalize(r,p.checkedAt,p.file);normalized.historicalScope=p.shard==='undated-review'?'undated':null;const prior=map.get(normalized.canonicalId);if(prior){duplicates++;if(prior.sourceChecksum && normalized.sourceChecksum && prior.sourceChecksum!==normalized.sourceChecksum && prior.sourceReference===normalized.sourceReference)conflicts.push(normalized.canonicalId);const old=originals.get(normalized.canonicalId);const merged={...r,checksum:r.checksum||old.checksum,metadata:{...r.metadata}};for(const [k,v]of Object.entries(old.metadata)){if(!arr(merged.metadata[k]).length)merged.metadata[k]=v;else if(['deadlineDate','startDate','keywords','tags','typesOfAction','actions','status'].includes(k))merged.metadata[k]=[...new Set([...arr(v),...arr(merged.metadata[k])])];}normalized=normalize(merged,p.checkedAt,p.file);originals.set(normalized.canonicalId,merged);normalized.evidenceFiles=[...new Set([...(prior.evidenceFiles||[prior.evidenceFile]),p.file])];if(prior.historicalScope==='undated'||p.shard==='undated-review')normalized.historicalScope='undated';}else originals.set(normalized.canonicalId,r);map.set(normalized.canonicalId,normalized);}}
    // Retain previous canonical records, but never keep an unobserved record actionable.
    const previous=await read(path.join(o.out,'generated','latest-complete.json'),null);let retained=0;
    if(previous){const previousRoot=path.resolve(o.out,previous.path);if(!previousRoot.startsWith(path.resolve(o.out)+path.sep))throw new Error('Unsafe previous snapshot path');const lines=(await fs.readFile(path.join(previousRoot,'funding-master.jsonl'),'utf8')).trim().split('\n').filter(Boolean);for(const line of lines){const r=JSON.parse(line);if(!map.has(r.canonicalId)){r.previousStatus=r.status;r.status='uncertain';r.warnings=[...(r.warnings||[]),'Not observed in this run; preserved, not evidence of withdrawal.'];r.retainedFromPrevious=true;map.set(r.canonicalId,r);retained++;}}}
    const records=[...map.values()].sort((a,b)=>a.canonicalId.localeCompare(b.canonicalId));
    const exhausted=state.shardIndex===state.shards.length;
    const gaps=[];if(!exhausted)gaps.push('Pagination incomplete; resume checkpoint.');if(state.ledger.some(x=>x.warnings.length))gaps.push('API warnings or changing totals during pagination.');if(conflicts.length)gaps.push('Source versions changed across overlapping shards.');
    const known=state.ledger.filter(x=>x.complete).reduce((a,x)=>a+x.received,0);
    const observed=map.size-retained;
    const status=!observed?(fatal?'failed':'unexpectedly_empty'):fatal||gaps.length?'partial':'complete';
    const manifest={schemaVersion:1,collectorVersion:VERSION,runId:state.runId,status,config,startedAt:state.startedAt,finishedAt:new Date().toISOString(),error:fatal?.message||null,gaps,scope:'Public English SEDIA funding types 1,2,8. Historical startDate OR deadlineDate in selected years; undated retained for review.',absoluteHistoricalCompleteness:false,detailDocumentsDownloaded:false,awardsCollected:false,source:API,ledger:state.ledger,pages:state.pages,counts:{records:records.length,observed,retained,duplicates,changedVersions:conflicts.length,completedShardRecords:known},limitations:['No CORDIS awards/beneficiaries collection in item 1.','Eligibility, budgets and multiple-stage deadlines require topic-document review.','Records with both dates before 2020 are outside backfill scope; undated records are not asserted to be post-2020.','Live pagination is not a transaction; rerun periodically to reconcile.','complete means the requested index traversal passed coverage checks, not all EU funding is known.']};
    manifest.conflictingCanonicalIds=[...new Set(conflicts)];const dir=await exportData(o.out,state.runId,records,manifest);
    state.done=exhausted&&!fatal;state.status=status;await atomic(checkpointFile,state);await atomic(path.join(o.out,'logs',`${state.runId}.json`),manifest);console.log(JSON.stringify({status,records:records.length,output:dir},null,2));if(status!=='complete')process.exitCode=status==='failed'?1:2;
    return {manifest,records,dir};
  } finally {await lock.close();await fs.unlink(lockFile);}
}
module.exports={classify,normalize,queryFor,makeShards,request,options,main,exportData};
if(require.main===module)main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});

