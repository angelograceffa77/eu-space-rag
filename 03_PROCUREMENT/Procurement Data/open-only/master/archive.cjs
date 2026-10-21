'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function inventory(root){
 const out=[];function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.isSymbolicLink())throw Error('Unexpected symbolic link: '+e.name);const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(e.isFile()){const b=fs.readFileSync(p);out.push({file:path.relative(root,p),bytes:b.length,sha256:sha(b)});}else throw Error('Unexpected file type');}}walk(root);return out.sort((a,b)=>a.file.localeCompare(b.file));
}
function archiveTree(source,destination){
 if(fs.existsSync(destination))throw Error('Immutable archive already exists: '+destination);
 const before=inventory(source);fs.mkdirSync(destination,{recursive:true});
 for(const e of before){const p=path.join(destination,e.file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.copyFileSync(path.join(source,e.file),p,fs.constants.COPYFILE_EXCL);}
 const after=inventory(destination),sourceAfter=inventory(source);
 if(JSON.stringify(before)!==JSON.stringify(after)||JSON.stringify(before)!==JSON.stringify(sourceAfter))throw Error('Independent archive or source inventory differs');
 return {source:path.resolve(source),destination,files:before.length,bytes:before.reduce((n,x)=>n+x.bytes,0),inventory:before,verifiedAt:new Date().toISOString()};
}
module.exports={sha,inventory,archiveTree};
