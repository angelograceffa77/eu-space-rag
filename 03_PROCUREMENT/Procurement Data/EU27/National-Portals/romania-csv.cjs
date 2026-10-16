'use strict';
const fs=require('fs'),readline=require('readline');
// Some ADR exports use vertical bars as quotes and contain unescaped bars
// inside descriptions. Only a bar followed by a delimiter/end closes a field.
async function* pipeQuotedRows(file){let row=[],field='',quoted=false,started=false;for await(const line of readline.createInterface({input:fs.createReadStream(file,{encoding:'utf8'}),crlfDelay:Infinity})){for(let i=0;i<line.length;i++){const c=line[i],next=line[i+1];if(quoted){if(c==='|'&&(next===','||next===undefined)){quoted=false;}else if(c==='|'&&next==='|'){field+='|';i++;}else field+=c;}else if(c==='|'&&!started){quoted=true;started=true;}else if(c===','){row.push(field);field='';started=false;}else{field+=c;started=true;}}if(quoted){field+='\n';continue;}row.push(field);yield row;row=[];field='';started=false;}if(quoted)throw Error('Unterminated quoted archive record');if(row.length||field){row.push(field);yield row;}}
module.exports={pipeQuotedRows};
