'use strict';
const fs=require('fs'),path=require('path');
function files(root){const out=[];for(const name of ['Awarded-Contracts','Planned-Procurement']){const prefix='Lifecycle-Data/'+name,dir=path.join(root,prefix);if(!fs.existsSync(path.join(dir,'manifest.json')))continue;const m=require('./package.cjs').verify(dir),pointer=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));for(const rel of ['manifest.json',pointer.path+'/manifest.json',...m.files.map(x=>pointer.path+'/'+x.file)])out.push({source:path.join(dir,rel),target:prefix+'/'+rel});}return out;}
module.exports={files};
