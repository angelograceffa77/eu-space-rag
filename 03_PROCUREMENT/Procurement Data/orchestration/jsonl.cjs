'use strict';
const fs=require('node:fs'),readline=require('node:readline');
async function* records(file){let line=0;const input=fs.createReadStream(file),rl=readline.createInterface({input,crlfDelay:Infinity});try{for await(const text of rl){line++;if(!text.trim())continue;try{yield JSON.parse(text);}catch(e){throw new Error(`${file}:${line}: ${e.message}`);}}}finally{rl.close();input.destroy();}}
async function read(file){const rows=[];for await(const r of records(file))rows.push(r);return rows;}
module.exports={records,read};
