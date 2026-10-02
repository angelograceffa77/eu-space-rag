'use strict';
// Offline validation: no network, no writes to preserved generated intelligence.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');const {spawnSync}=require('node:child_process');
const readline=require('node:readline');const ExcelJS=require('exceljs');
const root=__dirname, out=path.resolve(process.env.PROCUREMENT_VALIDATION_DIR||path.join(root,'validation-output'));
fs.mkdirSync(out,{recursive:true});
const manifest=JSON.parse(fs.readFileSync(path.join(root,'migration-manifest.json'),'utf8'));
const scripts=manifest.filter(x=>x.new.includes('/scrapers/')&&x.new.endsWith('.js'));
const results=[];
async function run(){
 for(const item of scripts){
  const file=path.resolve(root,'../..',item.new),code=fs.readFileSync(file,'utf8');
  const check=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});assert.equal(check.status,0,check.stderr);
  const requireFile=createRequire(file);const exported=requireFile(file);
  assert.equal(exported.outputDirectory,path.resolve(path.dirname(file),'../generated'));
  const sandbox={require:requireFile,module:{exports:{}},__dirname:path.dirname(file),__filename:file,process:{...process,env:{...process.env,PROCUREMENT_OUTPUT_DIR:out}},console,Buffer,setTimeout,clearTimeout,URL};
  const context=vm.createContext(sandbox);vm.runInContext(code,context,{filename:file});
  const generated=path.resolve(path.dirname(file),'../generated');
  const samples=fs.readdirSync(generated).filter(n=>n.endsWith('.jsonl')&&!n.includes('SOURCE_RAW')&&!n.includes('NOTICE_HISTORY'));
  assert(samples.length>0);const input=fs.createReadStream(path.join(generated,samples[0]));
  const lines=readline.createInterface({input,crlfDelay:Infinity});let row;
  for await(const l of lines){if(l.trim()){row=JSON.parse(l);break;}}
  lines.close();input.destroy();assert(row);
  const target=path.join(out,path.basename(file,'.js')+'.jsonl');
  if(file.includes('/TED/')||file.includes('\\TED\\')){
   vm.runInContext('globalThis.testWriter = (r,f) => writeNormalizedJsonl(r, MASTER_COLUMNS, f);',context);
   context.testWriter([row],target);
   vm.runInContext('globalThis.rawRoundTrip = n => reconstructRawTedJson(splitTedRawJson(n)); globalThis.reconstructLegacy = reconstructRawTedJson;',context);
   const oversized={publicationNumber:'large-fixture',description:'x'.repeat(400000)};
   assert.deepEqual(JSON.parse(context.rawRoundTrip(oversized)),oversized);
   assert.throws(()=>context.reconstructLegacy({publicationNumber:'truncated-fixture',tedRawJSONPart01:'{"a":"',tedRawJSONLength:400000,tedRawJSONTruncated:'YES'}),/Incomplete raw TED payload/);
  }else{
   vm.runInContext('globalThis.testWriter = createJsonl;',context);
   context.testWriter([row],target.replace(/\.jsonl$/,'.xlsx'));
  }
  const restored=fs.readFileSync(fs.existsSync(target)?target:target.replace(/\.jsonl$/,'.part-0001.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.equal(restored.length,1);
  assert(Object.keys(restored[0]).length>5);
  // Check preserved workbook can actually be opened from relocated destination.
  const xlsx=fs.readdirSync(generated).find(n=>n.endsWith('.xlsx'));
  const reader=new ExcelJS.stream.xlsx.WorkbookReader(path.join(generated,xlsx),{worksheets:'emit',sharedStrings:'ignore',styles:'ignore',hyperlinks:'ignore'});
  let sheets=0,rows=0;for await(const ws of reader){sheets++;for await(const r of ws)rows++;}assert(sheets&&rows);
  results.push({script:item.new,status:'PASS',checks:['syntax','dependency load without live execution','default output path','saved-record JSONL exporter round trip','relocated XLSX streaming read'],workbookSheets:sheets,workbookRows:rows,liveVerified:false});
  console.log('PASS',path.basename(file));
 }
 const override=spawnSync(process.execPath,['-e',`const m=require(${JSON.stringify(path.resolve(root,'../..',scripts[0].new))}); if(m.outputDirectory!==${JSON.stringify(out)})process.exit(1)`],{env:{...process.env,PROCUREMENT_OUTPUT_DIR:out},encoding:'utf8'});assert.equal(override.status,0,override.stderr);
 fs.writeFileSync(path.join(out,'scraper-validation.json'),JSON.stringify(results,null,2)+'\n');
 console.log('All seven offline scraper validations passed. These are not live collection tests.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});

