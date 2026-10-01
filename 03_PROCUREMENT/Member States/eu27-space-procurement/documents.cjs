'use strict';
const PDFParser=require('pdf2json');
function pdfText(buffer){return new Promise((resolve,reject)=>{
 const parser=new PDFParser(null,1);const timer=setTimeout(()=>reject(Error('PDF parsing timed out')),30000);
 parser.on('pdfParser_dataError',e=>{clearTimeout(timer);reject(Error(e.parserError?.message||String(e.parserError||e)));});
 parser.on('pdfParser_dataReady',()=>{clearTimeout(timer);const text=parser.getRawTextContent();if(!text.trim())reject(Error('PDF has no extractable text; OCR required'));else resolve(text);});
 parser.parseBuffer(buffer);
});}
const escape=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function textAsHtml(text){const title=text.split(/\r?\n/).find(x=>x.trim().length>8)||'Procurement document';return '<h1>'+escape(title)+'</h1><main>'+escape(text)+'</main>';}
module.exports={pdfText,textAsHtml};
