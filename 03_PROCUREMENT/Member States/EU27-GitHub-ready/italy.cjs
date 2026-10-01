'use strict';
const cheerio=require('cheerio');const {clean,fold,htmlText,parseDate}=require('./core.cjs');
const categories=['bandi-per-appalti-istituzionali-tecnologici-e-scientifici','bandi-per-contratti-di-funzionamento'];
function italianDate(s){const m=fold(s).match(/(\d{1,2}) (gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre) (\d{4})/);if(!m)return '';return m[3]+'-'+String(['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'].indexOf(m[2])+1).padStart(2,'0')+'-'+m[1].padStart(2,'0');}
function parseAsi(html,url){const $=cheerio.load(html);const rows=$('.element-bando').map((i,e)=>{
 const el=$(e),a=el.find('a[href*="/bandi_e_concorsi/"]').first(),sourceUrl=a.attr('href');if(!sourceUrl)return null;
 const title=clean(a.text()).replace(/^‣\s*/,''),status=clean(el.find('.bando-status').text());
 return {noticeId:sourceUrl,procedureId:sourceUrl,sourceUrl,title,description:clean(el.find('.bando-text').text()),buyer:'Agenzia Spaziale Italiana',publicationDate:italianDate(el.find('.bando-data').text()),deadlineRaw:clean(el.find('.bando-scadenza-data').text()),sourceStatus:/revocat/i.test(status)?'cancelled':/scadut/i.test(status)?'closed':status,noticeType:/indagine di mercato|manifestazione.*interesse/i.test(title)?'planning':'tender',noticeVerified:true};
 }).get();return {rows,next:$('a.next.page-numbers').attr('href')||$('a.page-numbers').filter((i,e)=>clean($(e).text())==='>').attr('href')||''};}
async function asi(ctx){const seen=new Set();for(const category of categories){let url='https://www.asi.it/bandi/bandi-asi/'+category+'/';const visited=new Set();while(url&&ctx.canFetch()){
 if(visited.has(url))throw Error('ASI repeated pagination URL');visited.add(url);
 const {body,rawFile}=await ctx.get(url),data=parseAsi(body,url);if(!data.rows.length)throw Error('ASI listing has no recognized notice cards');
 for(const r of data.rows){if(seen.has(r.noticeId)||r.publicationDate&&r.publicationDate<ctx.options.from)continue;seen.add(r.noticeId);
  if(ctx.canFetch()){try{const detail=await ctx.get(r.sourceUrl),$=cheerio.load(detail.body);$('script,style,header,footer,nav,.sidebar').remove();const content=$('.single-bandi_e_concorsi section.text,article,.entry-content,.post-content').first();r.description=htmlText(content.length?content.html():$('main').html()||detail.body);r.documents=$('a[href]').map((i,e)=>$(e).attr('href')).get().filter(u=>/\.pdf|albofornitori|acquistinretepa|net4market/i.test(u)).join(' | ');ctx.emit(r,detail.rawFile);}catch(e){ctx.gap(r.sourceUrl+': '+e.message);ctx.emit(r,rawFile);}}else ctx.emit(r,rawFile);
 }
 if(data.rows.every(r=>r.publicationDate&&r.publicationDate<ctx.options.from))break;url=data.next;
 }if(url&&!ctx.canFetch())ctx.gap('ASI request budget reached for '+category);}
 ctx.gap('ASI public procurement categories traversed; supplier-platform-only notices and grant calls are outside these categories. Market surveys are planning opportunities, not open bid invitations.');}
function parseInaf(html,url){const u=new URL(url);if(!u.searchParams.get('codice')||!/\/(Bandi|Esiti)\/view\.action$/.test(u.searchParams.get('actionPath')||''))return null;const $=cheerio.load(html);$('script,style,nav,header,footer').remove();const t=clean($('body').text());
 const title=t.match(/Titolo\s*:\s*(.*?)\s*(?:-\s*CIG|Tipologia appalto)/i)?.[1]||'';
 if(!title)return null;const deadline=t.match(/Data scadenza\s*:\s*(\d{2}\/\d{2}\/\d{4})(?:\s+entro le\s+(\d{2}:\d{2}))?/i);
 const description=t.split('Sezione Dati generali')[1]?.split('Sezione Documentazione')[0]||title;
 return {noticeId:new URL(url).searchParams.get('codice')||url,procedureId:new URL(url).searchParams.get('codice')||url,sourceUrl:url,title,description,buyer:t.match(/Denominazione\s*:\s*(.*?)\s*RUP\s*:/i)?.[1]||'INAF',publicationDate:parseDate(t.match(/Data pubblicazione\s*:\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1]||'','Europe/Rome').iso,deadlineRaw:deadline?deadline[1]+(deadline[2]?' '+deadline[2]:''):'',noticeType:/Esiti/.test(u.searchParams.get('actionPath'))?'award':/indagine di mercato|consultazione preliminare/i.test(description)?'planning':'tender',sourceStatus:t.match(/Stato\s*:\s*(.*?)\s*(?:Lotti|Dati aperti|Altri atti|Sezione)/i)?.[1]||'',noticeVerified:true,documents:$('a[href]').map((i,e)=>new URL($(e).attr('href'),url).href).get().filter(u=>/download|document|\.pdf/i.test(u)).join(' | ')};
}
async function inaf(ctx){const queue=[ctx.source.url],seen=new Set();while(queue.length&&ctx.canFetch()){
 const url=queue.shift();if(seen.has(url))continue;seen.add(url);try{const {body,rawFile}=await ctx.get(url),$=cheerio.load(body),r=parseInaf(body,url);if(r)ctx.emit(r,rawFile);
 $('a[href]').each((i,e)=>{const u=new URL($(e).attr('href'),url);u.hash='';for(const key of ['font','skin','request_locale'])u.searchParams.delete(key);if(u.hostname!=='inaf.ubuy.cineca.it')return;if(/\/en\//.test(u.pathname))return;if(/\/(Bandi|Esiti)\/view\.action$/.test(u.searchParams.get('actionPath')||'')||/ppgare_(?:bandi_scaduti|esiti_lista|bandi_archivio)\.wp$/.test(u.pathname)&&!u.searchParams.has('actionPath'))queue.push(u.href);});
 }catch(e){ctx.gap(url+': '+e.message);}}
 ctx.gap('INAF public linked notices collected; historical search forms and procedures before 2024 need separate archive retrieval.');
 if(queue.length)ctx.gap('INAF request budget reached');}
module.exports={asi,inaf,parseAsi,parseInaf};
