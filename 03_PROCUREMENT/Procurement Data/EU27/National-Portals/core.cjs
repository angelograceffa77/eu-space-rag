'use strict';
const crypto=require('node:crypto');
const cheerio=require('cheerio');
const clean=s=>String(s??'').replace(/\s+/g,' ').trim();
const fold=s=>clean(s).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
const hash=s=>crypto.createHash('sha256').update(String(s)).digest('hex');
function htmlText(s){const $=cheerio.load(String(s||''));$('script,style,nav,header,footer,noscript').remove();return clean($.text());}
// Stems include all EU official-language families. Broad applications are retained
// as review candidates; an agency's name alone does not prove a space contract.
const strong=/\b(satellit\w*|satelit\w*|satelit|satcom|gnss|egnos|copernicus|galileo|cubesat\w*|smallsat\w*|spacecraft|spaceport|spaceflight|spaceborne|space[- ]based|space surveillance|space traffic|space debris|earth observation|remote sensing|launch vehicle|ground segment|ground station|orbital|in-orbit|raumfahrt\w*|weltraum\w*|erdbeobacht\w*|fernerkund\w*|spazial\w*|telerilev\w*|teledetec\w*|teledetek\w*|avaru\w*|kosm\w*|kozm\w*|vesmir\w*|vesolj\w*|svemir\w*|rumfart\w*|ruimtevaart\w*|aardobserv\w*|rymd\w*|fjarranalys\w*|palydov\w*|kaugseire|kaukokartoit\w*|muhold\w*|urkutat\w*|taverzekel\w*|spatiale?s?|spatiali|observation de la terre|observacion de la tierra|observacao da terra)\b|δορυφορ|διαστημικ|διαστημο|τηλεπισκοπ|сателит|космич|спътник/giu;
const broad=/\b(geospatial|geo[- ]information|gis|lidar|radar|hyperspectral|multispectral|wildfire|forest monitoring|environmental monitoring|quantum communication|laser ranging|telescop\w*|astronom\w*)\b/giu;
const defence=/\b(defen[cs]e|military|dual[- ]use|counterspace|armed forces|verteidigung|militar\w*|difesa|defesa|obron\w*|honved\w*)\b/giu;
const procurement=/tender|procurement|contract notice|invitation to bid|march[eé]|appel d.offres|ausschreibung|vergabe|licitaci|contrataci|appalt|gara|zam[oó]wie|przetarg|hankin|riigihank|pirkim|iepirk|beszerz|διαγωνισ|προκήρυξ|поръч|nabav|naročil|obstar[aá]v|udbud|upphandl|aanbested|konkurrenc|concurso|achizi/i;
function classify(title,description,cpv=''){
 const t=fold(title+' '+description).replace(/deutsch(?:e|es|en) zentrum(?:s)? fur luft-? und raumfahrt(?: e\.?v\.?)?/g,'').replace(/bundesministerium(?:s)? fur forschung,? technologie und raumfahrt/g,'').replace(/orbital(?:ly)? (?:geschwei\w*|weld\w*)/g,'').replace(/agenzia spaziale italiana/g,'').replace(/agencia espacial espanola/g,''),found=[...new Set(t.match(strong)||[])],b=[...new Set(t.match(broad)||[])];
 const hits=found.filter(h=>{
  if(/^kosm|^kozm/.test(h)&&!/^(kosmicz|kosmick|kosmisk|kosmos|kosmonaut|kozmick)/.test(h))return false;
  if(/^(satellites?|spatiale?s?|galileo|copernicus)$/.test(h)){
   // Satellite kitchens, spatial transcriptomics and schools named Galileo are
   // frequent real false positives. Keep weak matches for review, not OPEN.
   const escaped=h.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
   const nearby=new RegExp('.{0,70}\\b'+escaped+'\\b.{0,70}','g');
   const clear=(t.match(nearby)||[]).some(x=>/orbit|aerospac|aerospat|satcom|gnss|egnos|space|telecom|communication|telemetry|navigation|imager|imag[ei]n|meteorolog|weather|earth|terre|payload|lanceur|spatial launch|terre|observation|tracking|surveillance|antenne|antenna|downlink/.test(x));
   if(!clear){b.push('ambiguous: '+h);return false;}
  }
  return true;
 });
 if(/transport spatial|centre spatial guyanais|bodenstation|satellitenprojekt|nanosatellit|instrumentation spatiale|stazioni di terra|in orbita/.test(t))hits.push('explicit space transport or ground infrastructure');
 if(/satellite news gathering/.test(t))hits.push('satellite news gathering');
 if(/\beu\s*sst\b/i.test(t))hits.push('EU SST');
 const codes=String(cpv).match(/\b(?:34712\d{3}|35631\d{3}|35632\d{3}|3253\d{4}|38112100|38235000|60510000)\b/g)||[];
 // Aerial services include ordinary drone shows. Biological spatial imaging
 // and navigation fitted to construction machinery are not space contracts.
 const heading=fold(title);
 if(/transcriptom|proteom|histolog|cellular|cellulaire/.test(heading)&&!/satellit|spacecraft|gnss|orbit/.test(heading)){
  if(hits.length||codes.length||b.length)b.push('Spatial biology, not demonstrated space procurement');hits.length=0;codes.length=0;
 }
 if(/koparko|excavator|backhoe|bulldozer|kanalinspektionsfahrzeug/.test(heading)&&!/gnss|satellit|satelit|navigation/.test(heading)){
  if(hits.length||codes.length||b.length)b.push('Navigation appears incidental to construction machinery');hits.length=0;codes.length=0;
 }
 if(/ladestandere|galeria satelit|satellit.{0,12}(kitchen|kuche|urgentni center)|softwares? satelites|program.{0,15}satellit/.test(heading)||(/\brymd\b/.test(t)&&!hits.some(h=>h!=='rymd')&&!codes.length)){
  b.push('Ambiguous name or non-space use of the search term');hits.length=0;codes.length=0;
 }
 return {relevance:hits.length||codes.length?'space':b.length?'possible_space':'unrelated',spaceEvidence:[...hits,...codes].join(' | '),defenceEvidence:[...new Set(t.match(defence)||[])].join(' | '),reviewEvidence:b.join(' | ')};
}
function localDate(date,timeZone){return new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
function parseDate(raw,timeZone='Europe/Brussels'){
 const s=clean(raw);if(!s)return {iso:'',precision:'missing'};
 let m=s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/);
 if(!m){const d=s.match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);if(d)m=[d[0],d[3],d[2].padStart(2,'0'),d[1].padStart(2,'0'),d[4],d[5]];}
 if(!m)return {iso:'',precision:'unparsed'};
 const [y,mo,d,h,mi,sec]=Array.from({length:6},(_,i)=>Number(m[i+1]|| (i===1||i===2?1:0)));
 const utc=Date.UTC(y,mo-1,d,h,mi,sec);
 if(new Date(utc).getUTCMonth()!==mo-1||h>23||mi>59||sec>59)return {iso:'',precision:'invalid'};
 if(!m[4])return {iso:`${m[1]}-${m[2]}-${m[3]}`,precision:'date'};
 if(m[7]){const n=Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]||'00'}${m[7]}`);return Number.isFinite(n)?{iso:new Date(n).toISOString(),precision:'instant'}:{iso:'',precision:'invalid'};}
 let guess=utc;
 for(let i=0;i<3;i++){const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(guess)).map(p=>[p.type,p.value]));const represented=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);guess+=utc-represented;}
 return {iso:new Date(guess).toISOString(),precision:'local_time',timeZone};
}
function statusOf(r,now=new Date()){
 const s=fold(r.sourceStatus),kind=r.noticeType;
 if(/cancel|annul|anulad|desist|uniewaz|widerruf|revocat/.test(s))return ['cancelled','explicit source status'];
 if(kind==='award'||/awarded|attribution|adjudicad|aggiudicat|formaliz|resuelt|resolved|rozstrzygn/.test(s))return ['awarded','award notice or source status'];
 if(kind==='planning')return ['planned','prior information / planning notice'];
 if(kind==='grant'||kind==='job')return ['not_procurement',kind];
 if(/^(closed|past|ended|resolved|res|ev|anul|scaduto|chiusa|conclusa|evaluacion|cerrada)$/.test(s))return ['closed','explicit source status'];
 const date=parseDate(r.deadlineRaw,r.timeZone);
 if(date.iso){
   const today=localDate(now,r.timeZone||'Europe/Brussels');
   if(date.precision==='date'){
     if(date.iso<today)return ['closed','submission date passed'];
     if(date.iso===today)return ['deadline_today_check_time','source gives no closing time'];
   }else if(new Date(date.iso)<=now)return ['closed','submission deadline passed'];
   if(r.noticeVerified&&kind==='tender')return ['open','future submission deadline on a procurement notice'];
 }
 return ['unknown','no verified future deadline; review source'];
}
const fields=['recordId','country','sourceId','sourceName','sourceUrl','noticeId','procedureId','title','description','buyer','publicationDate','sourceUpdated','deadlineRaw','deadline','deadlinePrecision','timeZone','noticeType','sourceStatus','status','statusEvidence','relevance','spaceEvidence','defenceEvidence','reviewEvidence','cpv','value','currency','documents','noticeVerified','dateScope','textTruncated','rawFile','retrievedAt','ragText'];
function normalize(x,source,rawFile,now=new Date()){
 const r={country:source.country,sourceId:source.id,sourceName:source.name,timeZone:source.timeZone||'Europe/Brussels',...x};
 r.title=clean(r.title);r.description=clean(r.description);r.textTruncated=r.description.length>29000;r.description=r.description.slice(0,29000);
 Object.assign(r,classify(r.title,r.description,r.cpv));
 if(x.relevanceReviewReason&&r.relevance!=='unrelated'){r.relevance='possible_space';r.reviewEvidence=[r.reviewEvidence,x.relevanceReviewReason].filter(Boolean).join(' | ');}
 if(r.relevance==='unrelated'&&source.kind==='space_body'&&r.noticeVerified===true&&['tender','planning'].includes(r.noticeType)){
  r.relevance='possible_space';r.reviewEvidence='Procurement by a space body; substantive space relevance needs review';
 }
 const date=parseDate(r.deadlineRaw,r.timeZone);r.deadline=date.iso;r.deadlinePrecision=date.precision;
 [r.status,r.statusEvidence]=statusOf(r,now);
 r.dateScope=r.publicationDate?'dated':'unknown_publication_date';
 r.rawFile=rawFile;r.retrievedAt=now.toISOString();r.recordId=hash(source.id+'|'+(r.noticeId||r.sourceUrl)+'|'+(r.sourceUpdated||r.publicationDate||'')).slice(0,24);
 r.ragText=[r.title,r.description,`Country: ${r.country}; Buyer: ${r.buyer||''}; Status: ${r.status}; Deadline: ${r.deadline||r.deadlineRaw||'unknown'}; Source: ${r.sourceUrl}`].join('\n').slice(0,32000);
 // XML parsers can return substrings backed by a multi-megabyte feed string.
 // Detach normalized records so retaining a small result does not retain that feed.
 return JSON.parse(JSON.stringify(Object.fromEntries(fields.map(k=>[k,r[k]??'']))));
}
function latestRecords(rows){
 const map=new Map();
 for(const r of rows){const key=r.sourceId+'|'+(r.procedureId||r.noticeId||r.sourceUrl);const prev=map.get(key);const stamp=r.sourceUpdated||r.publicationDate||'';const old=prev&&(prev.sourceUpdated||prev.publicationDate||'');
  if(!prev||stamp>old||(stamp===old&&['cancelled','awarded','closed'].includes(r.status)))map.set(key,r);
 }
 return [...map.values()];
}
module.exports={clean,fold,hash,htmlText,classify,procurement,parseDate,statusOf,normalize,latestRecords,fields};
