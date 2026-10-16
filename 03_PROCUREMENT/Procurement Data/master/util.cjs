'use strict';
const fs=require('node:fs'),crypto=require('node:crypto'),readline=require('node:readline');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const stable=x=>JSON.stringify(sort(x));function sort(x){if(Array.isArray(x))return x.map(sort);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])]));return x;}
const hashFile=async f=>{const h=crypto.createHash('sha256');for await(const b of fs.createReadStream(f))h.update(b);return h.digest('hex');};
async function* lines(file){let line=0,pending='';const input=fs.createReadStream(file,{encoding:'utf8'});try{for await(const chunk of input){pending+=chunk;let end;while((end=pending.indexOf('\n'))>=0){const text=pending.slice(0,end).replace(/\r$/,'');pending=pending.slice(end+1);line++;if(text.trim())yield {line,text};}}if(pending.trim())yield {line:line+1,text:pending.replace(/\r$/,'')};}finally{input.destroy();}}
function strings(v){if(v===null||v===undefined)return [];if(Array.isArray(v))return v.flatMap(strings);if(typeof v==='object')return Object.values(v).flatMap(strings);return [String(v)];}
const text=v=>strings(v).join(' | ');
const first=(r,keys)=>{for(const k of keys)if(r[k]!==undefined&&r[k]!==null&&r[k]!=='')return r[k];return '';};
const fold=v=>text(v).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
function parseExact(s){return JSON.parse(s,(k,v,context)=>typeof v==='number'&&!Number.isSafeInteger(v)&&Number.isInteger(v)&&context?.source?context.source:v);}
module.exports={sha,stable,hashFile,lines,strings,text,first,fold,parseExact};
