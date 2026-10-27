'use strict';
async function collect({getPage,checkpoint,pageSize=100,workers=3,onCheckpoint=()=>{},allowSourceDuplicates=false,onSourceDuplicates=()=>{}}){
 const first=await getPage(0);validate(first,0,null,pageSize);const total=first.total;
 if(checkpoint&&(checkpoint.total!==total||JSON.stringify(checkpoint.companies.slice(0,first.items.length))!==JSON.stringify(first.items)))throw Error('ESA total or initial page changed during download; fresh attempt required');
 const rows=checkpoint?[...checkpoint.companies]:[...first.items];let offset=checkpoint?checkpoint.nextStart:pageSize;
 if(checkpoint&&offset%pageSize!==0&&rows.length!==total)throw Error('Checkpoint page-size boundary mismatch');
 while(rows.length<total){const offsets=Array.from({length:workers},(_,i)=>offset+i*pageSize).filter(x=>x<total);const pages=await Promise.all(offsets.map(getPage));
  for(let i=0;i<pages.length;i++){validate(pages[i],offsets[i],total,pageSize);rows.push(...pages[i].items);}
  offset+=offsets.length*pageSize;onCheckpoint(rows,offset,total);
 }
 const ids=rows.map(r=>r.companyProfileId);if(rows.length!==total||ids.some(x=>x==null))throw Error('Missing profile IDs; fresh attempt required');
 const positions=new Map();ids.forEach((id,i)=>{if(!positions.has(id))positions.set(id,[]);positions.get(id).push(i)});
 const verified=[];for(const [id,indices] of positions){if(indices.length<2)continue;
  const start=Math.floor(indices[0]/pageSize)*pageSize;
  if(!allowSourceDuplicates||indices.some(i=>Math.floor(i/pageSize)*pageSize!==start)||indices.some(i=>JSON.stringify(rows[i])!==JSON.stringify(rows[indices[0]])))throw Error('Unreconciled duplicate profile IDs; fresh attempt required');
  const fresh=await getPage(start);validate(fresh,start,total,pageSize);
  if(JSON.stringify(fresh.items)!==JSON.stringify(rows.slice(start,Math.min(start+pageSize,total))))throw Error('Duplicate source page changed; fresh attempt required');
  verified.push({profileId:id,indices,sourcePageStart:start,classification:'identical_duplicate_in_revalidated_official_page'});
 }
 onSourceDuplicates({sourceRows:rows.length,uniqueProfileIds:positions.size,duplicates:verified});
 const last=await getPage(0);if(last.total!==total||JSON.stringify(last.items)!==JSON.stringify(first.items))throw Error('ESA total or initial page changed during download; fresh attempt required');
 onCheckpoint(rows,offset,total);return rows;
}
function validate(page,offset,total,size){if(!page||!Number.isSafeInteger(page.total)||page.total<0||!Array.isArray(page.items))throw Error('Invalid ESA page');if(total!==null&&page.total!==total)throw Error('ESA total changed during download; fresh attempt required');if(page.items.length!==Math.min(size,page.total-offset))throw Error('Incomplete ESA page; checkpoint preserved');}
module.exports={collect,validate};
