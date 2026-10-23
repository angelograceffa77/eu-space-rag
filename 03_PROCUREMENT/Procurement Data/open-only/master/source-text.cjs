'use strict';
const {root,path}=require('./shared.cjs');
function sourceText(source){
 if(source.originalFormat==='json'){const values=[];function walk(v){if(typeof v==='string')values.push(v);else if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')Object.values(v).forEach(walk);}walk(JSON.parse(source.originalText));return values.join(' ').replace(/\s+/g,' ');}
 if(source.originalFormat==='text')return source.originalText.replace(/\s+/g,' ');
 const cheerio=require(path.join(root,'node_modules/cheerio/dist/commonjs/index.js'));
 return cheerio.load(source.originalText,{xmlMode:source.originalFormat==='xml'}).text().replace(/\s+/g,' ');
}
module.exports={sourceText};
