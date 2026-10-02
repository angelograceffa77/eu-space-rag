'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module'),{spawnSync}=require('node:child_process');
const root=__dirname;
if(process.argv[2]==='--worker'){
 const file=path.resolve(root,process.argv[3]),req=createRequire(file),context=vm.createContext({require:req,module:{exports:{}},__filename:file,__dirname:path.dirname(file),process,console,Buffer,URL,FormData,Blob,setTimeout,clearTimeout});
 vm.runInContext(fs.readFileSync(file,'utf8'),context,{filename:file});
 const name=path.basename(file);
 let expression=name.includes('publication')?'getPage(ESA_URL,0)':name.includes('tender-actions')?'getPage(0)':name.includes('funding-tenders')?'searchPage("DEFIS",1)':name.includes('dg-defis-ted')?'getPage(\'PD >= 20260930 AND PD <= 20261002\',1)':name.includes('eu27-ted')?'postTED({query:"PD >= 20260930 AND PD <= 20261002",fields:["publication-number"],page:1,limit:1,paginationMode:"PAGE_NUMBER"},{retryClientErrors:false})':name.includes('closed')?'getHtml(CLOSED_PROCUREMENT_URL)':'getHtml(PROCUREMENT_URL)';
 // Derive closed page URL from the scraper's actual configuration name.
 if(name.includes('closed'))expression='getHtml(CLOSED_URL)';
 Promise.resolve(vm.runInContext(expression,context)).then(value=>{
  if(!value||typeof value!=='object'&&typeof value!=='string')throw Error('Unexpected empty source response');
  if(typeof value==='string'&&!/<html|<!doctype/i.test(value))throw Error('Expected HTML');
  console.log('LIVE_SOURCE_RESPONSE',JSON.stringify({type:typeof value,keys:typeof value==='object'?Object.keys(value):[],bytes:typeof value==='string'?value.length:JSON.stringify(value).length}));process.exit(0);
 }).catch(e=>{console.error(e.message);process.exit(1);});
}else{
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'migration-manifest.json'),'utf8'));
 const results=manifest.filter(x=>x.new.includes('/scrapers/')&&x.new.endsWith('.js')).map(item=>{
  const file=path.relative(root,path.resolve(root,'../..',item.new));const r=spawnSync(process.execPath,[__filename,'--worker',file],{timeout:25000,encoding:'utf8'});
  const result={script:item.new,command:`node smoke-sources.cjs --worker "${file}"`,status:r.status===0?'source-response-pass':'not-verified',exitCode:r.status,reason:r.error?.message||r.stderr||'',output:r.stdout,fullCollectionVerified:false};console.log(path.basename(file),result.status,result.reason.slice(0,160));return result;
 });fs.mkdirSync(path.join(root,'validation-output'),{recursive:true});fs.writeFileSync(path.join(root,'validation-output/live-source-checks.json'),JSON.stringify(results,null,2)+'\n');
}

