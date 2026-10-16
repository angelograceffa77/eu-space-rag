const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const {createRequire}=require('module'),{spawnSync}=require('child_process');
const base=path.resolve(__dirname,'../..');
const root=path.join(base,'03_PROCUREMENT','Procurement Data');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'migration-21-manifest.json'),'utf8'));
const output=path.resolve(process.env.PROCUREMENT_VALIDATION_DIR || path.join(__dirname,'validation-output/expanded-21'));fs.mkdirSync(output,{recursive:true});
const results=[];
async function run(){for(const item of manifest.filter(x=>x.script)){
 const file=path.join(base,item.new),code=fs.readFileSync(file,'utf8'),req=createRequire(file);
 const check=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});assert.equal(check.status,0,check.stderr);
 const exported=req(file);assert.equal(exported.outputDirectory,path.resolve(path.dirname(file),'../generated'));
 const isolated=path.join(output,path.basename(file,'.js'));fs.mkdirSync(isolated,{recursive:true});
 const context=vm.createContext({require:req,module:{exports:{}},__dirname:path.dirname(file),__filename:file,process:{...process,env:{...process.env,PROCUREMENT_OUTPUT_DIR:isolated}},console,Buffer,setTimeout,clearTimeout,URL});
 vm.runInContext(code,context,{filename:file});assert.equal(context.module.exports.outputDirectory,isolated);
 let checks=['syntax','real dependency load without starting collection','default destination','output override'];
 if(code.includes('function createJsonl(')){
  const sample=fs.readdirSync(exported.outputDirectory).find(x=>x.endsWith('.jsonl'));
  const row=JSON.parse(fs.readFileSync(path.join(exported.outputDirectory,sample),'utf8').split(/\r?\n/).find(x=>x.trim()));
  context.fixture=[row];context.target=path.join(isolated,'fixture.xlsx');vm.runInContext('createJsonl(fixture,target)',context);
  const jsonl=fs.readdirSync(isolated).find(x=>x.endsWith('.jsonl'));assert(jsonl);
  const restored=JSON.parse(fs.readFileSync(path.join(isolated,jsonl),'utf8').trim());assert.deepEqual(restored,row);
  const ExcelJS=req('exceljs');const book=new ExcelJS.Workbook();const workbook=fs.readdirSync(exported.outputDirectory).find(x=>x.endsWith('.xlsx'));
  await book.xlsx.readFile(path.join(exported.outputDirectory,workbook));assert(book.worksheets.length);
  checks.push('saved-record JSONL exact round trip','relocated workbook read');
 }else{
  vm.runInContext('globalThis.columns=COLUMNS;globalThis.writer=writeCsvChunked;',context);
  const row=Object.fromEntries(Array.from(context.columns,c=>[c,'migration fixture, "quoted" Î©']));
  context.writer('fixture',[row]);const csv=fs.readdirSync(isolated).find(x=>x.endsWith('.csv'));assert(csv);
  const text=fs.readFileSync(path.join(isolated,csv),'utf8');assert(text.includes('""quoted"" Î©'));assert.equal(text.trim().split('\n').length,2);
  assert.equal(vm.runInContext('copyCollector()',context),file);assert(!fs.readdirSync(isolated).some(x=>x.endsWith('.js')));
  checks.push('CSV writer with commas quotes Unicode','no generated source duplicate');
 }
 results.push({script:item.new,status:'PASS',checks,livePipelineVerified:false});console.log('PASS',path.basename(file));
}fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log('PASS all',results.length);}
run().catch(e=>{console.error(e);process.exitCode=1;});
