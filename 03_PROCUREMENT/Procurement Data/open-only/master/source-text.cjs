'use strict';
const {root,path}=require('./shared.cjs');
function sourceText(source){
 if(source.originalFormat==='text')return source.originalText.replace(/\s+/g,' ');
 const cheerio=require(path.join(root,'node_modules/cheerio/dist/commonjs/index.js'));
 return cheerio.load(source.originalText,{xmlMode:source.originalFormat==='xml'}).text().replace(/\s+/g,' ');
}
module.exports={sourceText};
