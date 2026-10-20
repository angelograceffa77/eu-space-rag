'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=process.env.PROCUREMENT_ROOT||String.raw`C:\Users\angel\OneDrive\Desktop\knowledge\eu-space-rag\03_PROCUREMENT\Procurement Data`;
const sha=s=>crypto.createHash('sha256').update(s).digest('hex'),flat=v=>v==null?'':typeof v==='string'?v:typeof v==='number'?String(v):Array.isArray(v)?v.map(flat).filter(Boolean).join(' | '):Object.values(v).map(flat).filter(Boolean).join(' | '),first=(o,keys)=>{for(const k of keys)if(o?.[k]!=null&&flat(o[k]))return o[k];return '';},fold=s=>flat(s).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
module.exports={fs,path,root,sha,flat,first,fold};
