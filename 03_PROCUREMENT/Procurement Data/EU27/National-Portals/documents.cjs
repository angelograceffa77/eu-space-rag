'use strict';
const PDFParser=require('pdf2json');
function primaryPdfText(buffer){return new Promise((resolve,reject)=>{
 const parser=new PDFParser(null,1);const timer=setTimeout(()=>reject(Error('PDF parsing timed out')),30000);
 parser.on('pdfParser_dataError',e=>{clearTimeout(timer);reject(Error(e.parserError?.message||String(e.parserError||e)));});
 parser.on('pdfParser_dataReady',()=>{clearTimeout(timer);const text=parser.getRawTextContent();if(!text.trim())reject(Error('PDF has no extractable text; OCR required'));else resolve(text);});
 parser.parseBuffer(buffer);
});}
async function pdfText(buffer){try{return await primaryPdfText(buffer);}catch(original){if(!process.env.PDF_PYTHON)throw original;const {spawn}=require('node:child_process');return new Promise((resolve,reject)=>{const child=spawn(process.env.PDF_PYTHON,['-c',"import sys,io; from pypdf import PdfReader; sys.stdout.buffer.write('\\n'.join(p.extract_text() or '' for p in PdfReader(io.BytesIO(sys.stdin.buffer.read()),strict=False).pages).encode('utf-8'))"],{windowsHide:true});let output='',error='';const timer=setTimeout(()=>{child.kill();reject(Error('Fallback PDF parsing timed out'));},30000);child.stdout.setEncoding('utf8');child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>error+=x);child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);if(code||!output.trim())reject(Error(original.message+'; PDF fallback: '+error.slice(0,300)));else resolve(output);});child.stdin.on('error',()=>{});child.stdin.end(buffer);});}}
const escape=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function textAsHtml(text){const title=text.split(/\r?\n/).find(x=>x.trim().length>8)||'Procurement document';return '<h1>'+escape(title)+'</h1><main>'+escape(text)+'</main>';}
module.exports={pdfText,textAsHtml};
