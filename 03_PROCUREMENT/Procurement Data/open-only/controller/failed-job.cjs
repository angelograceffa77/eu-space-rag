'use strict';
const fs=require('fs'),path=require('path');
// Preserve the count of committed evidence after an adapter throws. Raw pages
// and their parsed counts must still pass the independent candidate verifier.
function failedJob(dir,error,limitations){
 const file=path.join(dir,'state.json');
 if(!fs.existsSync(file))return {state:'failed',received:0,error:error.message,limitations};
 const s=JSON.parse(fs.readFileSync(file));
 const received=s.listing?s.rows?.length:s.received;
 if(!Number.isSafeInteger(received)||received<0)throw Error('Failed job checkpoint has no valid committed record count');
 if(!s.listing&&(!Array.isArray(s.pages)||s.pages.some(p=>typeof p.file!=='string'||path.basename(p.file)!==p.file)))throw Error('Failed job checkpoint has invalid evidence references');
 return {state:'failed',received,total:s.total??null,countBasis:s.countBasis||'committed-checkpoint-requires-verification',error:error.message,limitations,checkpointState:s.state,checkpointRecovery:true};
}
module.exports={failedJob};
