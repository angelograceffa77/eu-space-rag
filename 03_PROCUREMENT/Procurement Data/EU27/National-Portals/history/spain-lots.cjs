'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const national=process.env.NATIONAL_COLLECTOR_ROOT||path.resolve(__dirname,'..');
const cheerio=require(path.join(national,'node_modules/cheerio')),unzipper=require(path.join(national,'node_modules/unzipper'));
const {parseArchiveFeed}=require(path.join(national,'archives.cjs')),{normalize}=require(path.join(national,'core.cjs')),{portableCRC32}=require(path.join(national,'spain-monthly.cjs'));
async function hashFile(file){const h=crypto.createHash('sha256');for await(const b of fs.createReadStream(file))h.update(b);return h.digest('hex');}
function lotRows(xml,source,rawFile,now){
 const rows=[],unresolved=[];let examined=0;
 const entries=xml.match(/<(?:[\w-]+:)?entry\b[^>]*>[\s\S]*?<\/(?:[\w-]+:)?entry\s*>/g)||[];
 for(const entry of entries){
  if(!/<(?:[\w-]+:)?ProcurementProjectLot\b/.test(entry))continue;
  const parsed=parseArchiveFeed('<feed>'+entry+'</feed>',{...source,adapter:'placsp'});if(!parsed.rows.length)continue;
  const parent=parsed.rows[0];if(source.noticeType)parent.noticeType=source.noticeType;const parentProjection=normalize(parent,source,rawFile,now),doc=cheerio.load(entry,{xml:true}),local=(el,name)=>el.find('*').filter((i,e)=>e.name?.split(':').pop()===name),first=(el,name)=>local(el,name).first().text().trim();
  const lots=doc('*').filter((i,e)=>e.name?.split(':').pop()==='ProcurementProjectLot');let retained=0;const unresolvedBefore=unresolved.length;
  for(const node of lots.toArray()){
   examined++;const el=doc(node),id=el.children().filter((i,e)=>e.name?.split(':').pop()==='ID').first().text().trim(),project=local(el,'ProcurementProject').first();
   const title=first(project,'Name'),description=local(project,'Description').map((i,e)=>doc(e).text().trim()).get().join(' '),cpv=local(project,'ItemClassificationCode').map((i,e)=>doc(e).text().trim()).get().join(' | ');
   let amount=local(project,'EstimatedOverallContractAmount').first(),basis='estimate';if(!amount.length){amount=local(project,'TaxExclusiveAmount').first();basis='budget excluding VAT';}
   const x={...parent,title:title||'Lot '+(id||'without published identifier'),description:[title,description,amount.length?'Source lot '+basis+': '+amount.text().trim()+' '+(amount.attr('currencyID')||'')+'.':''].filter(Boolean).join(' '),cpv,value:amount.text().trim(),currency:amount.attr('currencyID')||'',lotId:id,noticeType:'lot',sourceStatus:'',deadlineRaw:''};
   const r=normalize(x,source,rawFile,now);if(r.relevance==='unrelated'&&parentProjection.relevance==='space'){r.relevance='possible_space';r.reviewEvidence='Space-related parent; lot-specific scope requires review';}if(r.relevance==='unrelated')continue;
   if(!id){unresolved.push({noticeId:parent.noticeId,title,rawFile,reason:'Relevant lot has no explicit source lot identifier'});continue;}
   r.status='unknown';r.statusEvidence='Lot-specific bidding status is not established by this historical lot extraction';rows.push(r);retained++;
  }
  if(retained||unresolved.length>unresolvedBefore){const p=normalize(parent,source,rawFile,now);if(p.relevance==='unrelated'){p.relevance='possible_space';p.reviewEvidence='Parent retained because a separate explicit lot has space relevance';rows.push(p);}}
 }
 return {rows,examined,unresolved};
}
async function extract(file,out,source,now,expectedSha256){
 if(await hashFile(file)!==expectedSha256)throw Error('Archive changed before lot extraction');
 const zip=await unzipper.Open.file(file),temp=out+'.tmp';fs.mkdirSync(path.dirname(out),{recursive:true});const fd=fs.openSync(temp,'w');let members=0,examined=0,retained=0;const unresolved=[];
 try{for(const e of zip.files){if(e.type==='Directory'||!/\.(atom|xml)$/i.test(e.path))continue;if(e.uncompressedSize>64*1024**2)throw Error('XML member exceeds limit');const b=await e.buffer();if(b.length!==e.uncompressedSize||(typeof zlib.crc32==='function'?zlib.crc32(b):portableCRC32(b))!==e.crc32)throw Error('Invalid archive member '+e.path);const parsed=lotRows(b.toString('utf8'),source,file+'#'+e.path,now);for(const r of parsed.rows){fs.writeSync(fd,JSON.stringify(r)+'\n');retained++;}examined+=parsed.examined;unresolved.push(...parsed.unresolved);members++;if(members%100===0)await new Promise(r=>setImmediate(r));}}finally{fs.closeSync(fd);}
 if(!members)throw Error('No archive members');if(await hashFile(file)!==expectedSha256)throw Error('Archive changed during lot extraction');fs.renameSync(temp,out);
 const result={archiveSha256:expectedSha256,recordsSha256:await hashFile(out),members,examined,retained,unresolved,policy:'Only explicit source lot identifiers become lot records. Parent evidence retained for lot-only matches. No lot-level current status or deadline inferred from the parent.'};fs.writeFileSync(out+'.validation.json',JSON.stringify(result,null,2));return result;
}
module.exports={lotRows,extract};
