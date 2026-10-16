'use strict';
const fs=require('node:fs');
function write(file,value,io=fs,pause=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)){
 const temp=file+'.tmp';
 io.writeFileSync(temp,JSON.stringify(value,null,2));
 for(let attempt=0;;attempt++){
  try{io.renameSync(temp,file);return;}
  catch(error){if(!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=8)throw error;pause(Math.min(100*2**attempt,1000));}
 }
}
module.exports={write};
