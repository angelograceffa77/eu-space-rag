'use strict';
const fs=require('fs');
function rename(from,to){for(let i=0;;i++){try{fs.renameSync(from,to);return}catch(e){if(!['EPERM','EACCES','EBUSY'].includes(e.code)||i===9)throw e;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100*(i+1));}}}
function writeJSON(file,data){fs.writeFileSync(file+'.tmp',JSON.stringify(data,null,2));rename(file+'.tmp',file)}
module.exports={rename,writeJSON};
