'use strict';
const fs=require('node:fs');const path=require('node:path');const {Readable,Transform}=require('node:stream');const {pipeline}=require('node:stream/promises');const unzipper=require('unzipper');
const cheerio=require('cheerio');const {parseFeed}=require('./adapters.cjs');
// A deliberately broad prefilter avoids building a DOM for every unrelated
// notice in large Spanish archives. Full records still pass parseFeed and the
// normal relevance classifier; XML containing numeric entities is kept too.
function parseArchiveFeed(xml,source){
 if(source.adapter!=='placsp')return parseFeed(xml,source);
 if(!/<(?:[\w-]+:)?feed\b/.test(xml)||!/<\/(?:[\w-]+:)?feed>\s*$/.test(xml))throw Error('Incomplete archive Atom feed');
 const entries=xml.match(/<(?:[\w-]+:)?entry\b[^>]*>[\s\S]*?<\/(?:[\w-]+:)?entry\s*>/g)||[];
 const relevant=/sat|spac|spat|espaci|gnss|egnos|copernicus|galileo|orbit|earth|remote|launch|ground|raum|weltraum|erdbeob|fernerkund|telerilev|teledetec|avaru|kosm|kozm|vesmir|vesolj|svemir|rumfart|ruimte|aardobserv|rymd|fjarranalys|palydov|kaugseire|kaukokartoit|muhold|urkutat|taverzekel|observation|observaci|observac|geospatial|geo.information|\bgis\b|lidar|radar|hyperspectral|multispectral|wildfire|forest|environmental|quantum|laser|telescop|astronom|bodenstation|stazioni|\bsst\b|δορυφορ|διαστημ|τηλεπισκοπ|сателит|космич|спътник|34712\d{3}|3563[12]\d{3}|3253\d{4}|38112100|38235000|60510000|&#/iu;
 const selected=entries.filter(e=>relevant.test(e.normalize('NFKD').replace(/\p{M}/gu,''))||/spazial|teledetek/i.test(e));
 return {rows:selected.length?parseFeed('<feed>'+selected.join('')+'</feed>',source).rows:[],scanned:entries.length};
}
// ZIP entries are never extracted to paths supplied by the archive. Each Atom
// member is read as data and its original archive/member provenance is retained.
async function readArchive(file,source,emit,gap,limit=Infinity){
 const directory=await unzipper.Open.file(file);let count=0;
 for(const entry of directory.files){if(!/\.(atom|xml)$/i.test(entry.path)||entry.type==='Directory')continue;if(count>=limit){gap('Archive member budget reached: '+file);break;}
  if(entry.uncompressedSize>64*1024*1024){gap('Archive member exceeds 64 MiB: '+entry.path);continue;}
  const chunks=[];let bytes=0;for await(const chunk of entry.stream()){bytes+=chunk.length;if(bytes>64*1024*1024)throw Error('Inflated XML member exceeds 64 MiB');chunks.push(chunk);}
  for(const r of parseArchiveFeed(Buffer.concat(chunks).toString('utf8'),source).rows)emit(r,file+'#'+entry.path);count++;
 }return count;
}
async function download(url,destination,timeout){
 const response=await fetch(url,{signal:AbortSignal.timeout(timeout),headers:{'User-Agent':'EU27SpaceProcurementCollector/1.0'}});if(!response.ok)throw Error('Archive HTTP '+response.status);
 let bytes=0;const counter=new Transform({transform(chunk,enc,cb){bytes+=chunk.length;cb(bytes>4*1024**3?Error('Archive exceeds 4 GiB'):null,chunk);}});
 await pipeline(Readable.fromWeb(response.body),counter,fs.createWriteStream(destination+'.part'));fs.renameSync(destination+'.part',destination);
}
async function recoverPartialArchive(file,source,emit,gap){
 const zlib=require('node:zlib'),fd=fs.openSync(file,'r'),size=fs.fstatSync(fd).size,header=Buffer.alloc(30);let count=0,position=0;
 try{while(position+30<=size){
  fs.readSync(fd,header,0,30,position);if(header.readUInt32LE(0)!==0x04034b50)break;
  const flags=header.readUInt16LE(6),method=header.readUInt16LE(8),compressedSize=header.readUInt32LE(18),uncompressedSize=header.readUInt32LE(22),nameLength=header.readUInt16LE(26),offset=position+30+nameLength+header.readUInt16LE(28);
  // Official observed archives have sizes in local headers. Do not guess entry
  // boundaries for encrypted, descriptor-based or ZIP64 partial members.
  if(flags&9||![0,8].includes(method)||compressedSize===0xffffffff)throw Error('Unsupported partial ZIP header');
  if(offset+compressedSize>size){gap('Trailing incomplete ZIP member omitted');break;}
  const nameBuffer=Buffer.alloc(nameLength);fs.readSync(fd,nameBuffer,0,nameLength,position+30);const name=nameBuffer.toString('utf8');position=offset+compressedSize;
  if(!/\.(atom|xml)$/i.test(name))continue;
  if(uncompressedSize>64*1024*1024||compressedSize>64*1024*1024){gap('Oversized partial member '+name);continue;}
  const compressed=Buffer.alloc(compressedSize);if(fs.readSync(fd,compressed,0,compressedSize,offset)!==compressedSize)throw Error('Incomplete compressed member');
  const buf=method===8?zlib.inflateRawSync(compressed,{maxOutputLength:64*1024*1024}):compressed;
  if(buf.length!==uncompressedSize)throw Error('Partial member size mismatch');
  if(typeof zlib.crc32==='function'&&zlib.crc32(buf)!==header.readUInt32LE(14))throw Error('Partial member CRC mismatch');
  const parsed=parseArchiveFeed(buf.toString('utf8'),source);for(const r of parsed.rows)emit(r,file+'#'+name);count++;
  if(count%100===0)console.log('[ES-portal] recovered '+count+' complete archive members');
  await new Promise(resolve=>setImmediate(resolve));
 }}catch(e){gap('Partial archive ended: '+e.message);}finally{fs.closeSync(fd);}
 gap('Recovered '+count+' complete members from an interrupted archive; the annual dataset is incomplete.');return count;
}
async function spanishArchives(ctx,dir){
 const {body}=await ctx.get('https://www.hacienda.gob.es/es-ES/GobiernoAbierto/Datos%20Abiertos/Paginas/LicitacionesContratante.aspx');const $=cheerio.load(body);const years=new Map();
 $('a[href]').each((i,a)=>{const url=$(a).attr('href');const m=url.match(/licitacionesPerfilesContratanteCompleto3_(\d{4})\.zip$/);if(m&&m[1]>=ctx.options.from.slice(0,4)&&m[1]<=ctx.options.to.slice(0,4)&&new URL(url).hostname==='contrataciondelsectorpublico.gob.es')years.set(m[1],url);});
 if(!years.size)throw Error('No official Spanish annual archives discovered');
 for(const [year,url] of [...years].sort((a,b)=>b[0].localeCompare(a[0]))){
  const file=path.join(dir,'PLACSP-'+year+'.zip');console.log('[ES-portal] historical archive '+year);
  if(!fs.existsSync(file))try{await download(url,file,ctx.options.archiveTimeout||30*60*1000);}catch(e){
   ctx.gap('Spanish annual download failed for '+year+': '+e.message);
   if(fs.existsSync(file+'.part')&&fs.statSync(file+'.part').size){await recoverPartialArchive(file+'.part',ctx.source,ctx.emit,ctx.gap);ctx.gap('Remaining historical years were not downloaded after archive interruption.');return;}
   throw e;
  }
  await readArchive(file,ctx.source,ctx.emit,ctx.gap);
 }
 ctx.gap('Archive coverage is for profiles hosted on PLACSP, excluding minor contracts; historical source membership varies.');
}
module.exports={readArchive,spanishArchives,download,parseArchiveFeed,recoverPartialArchive};
