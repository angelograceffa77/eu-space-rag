'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function assemble({selection,output,day,expectedJobs=[],coverageFiles={}}){
 if(fs.existsSync(output))throw Error('Assembly destination already exists');
 const staged=output+'.pending';if(fs.existsSync(staged))throw Error('Unfinished assembly requires inspection');
 fs.mkdirSync(staged,{recursive:true});const jobs={},sources=[],files=[];
 for(const [job,input] of Object.entries(selection)){
  if(!/^[\w-]+$/.test(job))throw Error('Invalid job identity');
  const root=path.resolve(input),raw=fs.readFileSync(path.join(root,'manifest.json')),m=JSON.parse(raw);
  if(!m.finishedAt||!m.jobs?.[job])throw Error('Source run unfinished or job absent: '+job);
  if((m.day||m.asOf)!==day)throw Error('Mixed collection dates require explicit separate bundle');
  const source=path.join(root,job),target=path.join(staged,job);
  function copyTree(a,b){fs.mkdirSync(b,{recursive:true});for(const e of fs.readdirSync(a,{withFileTypes:true})){if(e.isSymbolicLink())throw Error('Linked evidence is not portable');const from=path.join(a,e.name),to=path.join(b,e.name);if(e.isDirectory())copyTree(from,to);else if(e.isFile()){const bytes=fs.readFileSync(from);fs.writeFileSync(to,bytes,{flag:'wx'});if(sha(fs.readFileSync(to))!==sha(bytes))throw Error('Assembly copy mismatch');files.push({file:path.relative(staged,to).replace(/\\/g,'/'),sha256:sha(bytes),bytes:bytes.length});}}}
  if(fs.existsSync(source))copyTree(source,target);else if(m.jobs[job].state!=='failed')throw Error('Missing source evidence: '+job);
  jobs[job]=m.jobs[job];const sourceCoverage=[];for(const e of m.coverageEvidence||[]){if(!/^coverage\/[\w.-]+\.json$/.test(e.file))throw Error('Unsafe original coverage receipt');const original=path.join(root,e.file);if(!fs.realpathSync(original).startsWith(fs.realpathSync(root)+path.sep))throw Error('Original coverage receipt escapes run');const bytes=fs.readFileSync(original);if(sha(bytes)!==e.sha256)throw Error('Original coverage receipt mismatch');const file='source-coverage/'+sha(raw)+'/'+path.basename(e.file),target=path.join(staged,file);fs.mkdirSync(path.dirname(target),{recursive:true});if(!fs.existsSync(target))fs.writeFileSync(target,bytes,{flag:'wx'});sourceCoverage.push({file,originalFile:e.file,sha256:e.sha256});}sources.push({job,sourceRun:root,manifestSha256:sha(raw),finishedAt:m.finishedAt,coverageEvidence:sourceCoverage});
  const receipts=path.join(staged,'source-manifests');fs.mkdirSync(receipts,{recursive:true});const receipt=sha(raw)+'.json';if(!fs.existsSync(path.join(receipts,receipt)))fs.writeFileSync(path.join(receipts,receipt),raw,{flag:'wx'});
 }
 const coverageEvidence=[];for(const [name,input] of Object.entries(coverageFiles)){if(!/^[\w-]+$/.test(name))throw Error('Invalid coverage evidence name');const bytes=fs.readFileSync(input),file='coverage/'+name+'.json';JSON.parse(bytes);fs.mkdirSync(path.join(staged,'coverage'),{recursive:true});fs.writeFileSync(path.join(staged,file),bytes,{flag:'wx'});coverageEvidence.push({file,sha256:sha(bytes),source:path.resolve(input)});}const missing=expectedJobs.filter(id=>!jobs[id]),manifest={phase:3,asOf:day,coverage:'partial',purpose:'Discovery evidence only; no open-space classification or publication',jobs,missingJobs:missing,sources,coverageEvidence,finishedAt:new Date().toISOString(),published:false};
 fs.writeFileSync(path.join(staged,'manifest.json'),JSON.stringify(manifest,null,2));fs.writeFileSync(path.join(staged,'assembly-files.json'),JSON.stringify(files,null,2));
 require('./export-candidates.cjs').exportCandidates(staged);const validation=require('./verify-candidates.cjs').verify(staged);
 fs.writeFileSync(path.join(staged,'validation.json'),JSON.stringify(validation,null,2));fs.renameSync(staged,output);return {output,rows:validation.rows,jobCount:Object.keys(jobs).length,missingJobs:missing,coverage:'partial',published:false};
}
if(require.main===module){const config=JSON.parse(fs.readFileSync(process.argv[2]));console.log(JSON.stringify(assemble(config),null,2));}
module.exports={assemble};
