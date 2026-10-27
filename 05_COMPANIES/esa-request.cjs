'use strict';
function requester({request,save=()=>{},sleep=ms=>new Promise(r=>setTimeout(r,ms)),size=100}){
 async function page(start,n,attempt=0){try{const data=await request(start,n);save(start,n,data);return data;}catch(e){const status=e.response?.status;const transient=!status||status===429||status>=500;if(!transient)throw e;if(attempt<1){await sleep(10000);return page(start,n,attempt+1);}if(n<=10)throw e;
  const records=[];let total=null;for(let offset=start;offset<start+n&&(total===null||offset<total);offset+=10){const data=await page(offset,10);if(total!==null&&data.total!==total)throw Error('ESA total changed during download; fresh attempt required');total=data.total;if(!Number.isSafeInteger(total)||!Array.isArray(data.items)||data.items.length!==Math.min(10,total-offset))throw Error('Incomplete ESA fallback page');records.push(...data.items);await sleep(500);}return {total,items:records};}}
 return start=>page(start,size);
}
module.exports={requester};
