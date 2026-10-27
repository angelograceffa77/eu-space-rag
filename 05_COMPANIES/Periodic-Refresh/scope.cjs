'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
function scope(repo){
 const p=path.join(repo,'03_PROCUREMENT/Procurement Data'),n=require(path.join(p,'EU27/National-Portals/sources.cjs'));
 const ex=JSON.parse(fs.readFileSync(path.join(p,'open-only/controller/extended-country-scope.json')));
 const countries=new Map(n.countries.map(c=>[c[0],{code:c[0],name:c[1],portal:c[3]}]));
 for(const c of ex.jurisdictions)countries.set(c.code,{code:c.code,name:c.country,portal:c.portal});
 for(const [code,name] of [['GB','United Kingdom'],['CH','Switzerland'],['NO','Norway']])if(!countries.has(code))countries.set(code,{code,name});
 const entities=n.sources.map(s=>({id:s.id,name:s.name,country:s.country,url:s.url,kind:'registered_procurement_source'}));
 for(const e of fs.readdirSync(p,{withFileTypes:true}))if(e.isDirectory()&&fs.existsSync(path.join(p,e.name,'scrapers')))entities.push({id:e.name,name:e.name,kind:'institutional_procurement_collector'});
 const intake=require(path.join(p,'open-only/controller/intake.cjs'));
 const jobs=intake.jobs(new Date().toISOString().slice(0,10));
 for(const j of jobs)if(!entities.some(e=>e.id===j.id))entities.push({id:j.id,name:j.name||j.id,country:j.country||null,url:j.url||null,kind:'active_procurement_job'});
 const result={schemaVersion:1,source:'current procurement registers and intake jobs',countries:[...countries.values()],entities,completeCoverage:false};
 result.scopeSha256=crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex');return result;
}
function write(repo,out){const s=scope(repo);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(s,null,2));return s;}
module.exports={scope,write};
if(require.main===module){const s=write(process.argv[2],process.argv[3]);console.log(JSON.stringify({countries:s.countries.length,entities:s.entities.length,scopeSha256:s.scopeSha256}));}
