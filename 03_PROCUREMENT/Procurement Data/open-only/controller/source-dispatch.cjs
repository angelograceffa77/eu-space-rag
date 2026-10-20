'use strict';
async function dispatch(jobs,workers,action){
 if(!Number.isInteger(workers)||workers<1||workers>3)throw Error('Invalid dispatch worker count');
 const pending=[...jobs],active=new Set(),waiting=[];
 const wake=()=>{for(const resolve of waiting.splice(0))resolve();};
 const results=await Promise.allSettled(Array.from({length:workers},async()=>{
  while(pending.length){
   const index=pending.findIndex(j=>!active.has(j.kind));
   if(index<0){await new Promise(resolve=>waiting.push(resolve));continue;}
   const [job]=pending.splice(index,1);active.add(job.kind);
   try{await action(job);}finally{active.delete(job.kind);wake();}
  }
 }));
 const failure=results.find(r=>r.status==='rejected');if(failure)throw failure.reason;
}
module.exports={dispatch};
