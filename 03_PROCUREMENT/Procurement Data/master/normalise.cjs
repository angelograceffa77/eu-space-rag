'use strict';
const {sha,first,text,strings,fold}=require('./util.cjs');
function money(raw,currency='',kind='unspecified',scope='unspecified'){
 const original=raw,cur=text(currency).trim().toUpperCase();let code=/^[A-Z]{3}$/.test(cur)?cur:({'€':'EUR','EURO':'EUR','EUROS':'EUR','£':'GBP','ZŁ':'PLN'}[cur]||null);
 if(!code&&/€|\bEUR\b/i.test(text(raw)))code='EUR';
 let s=text(raw).trim(),status='parsed';if(typeof raw==='number')s=Number.isFinite(raw)?String(raw):'';
 else{s=s.replace(/\b(?:EUR|USD|GBP|CZK|PLN|SEK|DKK|RON|HUF|CHF|NOK|BGN)\b/gi,'').replace(/[€£]/g,'').trim();if(/\d[\s\u00a0\u202f]+\d/.test(s)){if(!/^-?\d{1,3}(?:[\s\u00a0\u202f]\d{3})+(?:[.,]\d+)?$/.test(s))status='ambiguous';s=s.replace(/[\s\u00a0\u202f]/g,'');}
 if(s.includes(',')&&s.includes('.')){if(/^\d{1,3}(?:\.\d{3})+,\d+$/.test(s))s=s.replaceAll('.','').replace(',','.');else if(/^\d{1,3}(?:,\d{3})+\.\d+$/.test(s))s=s.replaceAll(',','');else status='ambiguous';}
 else if(/^\d{1,3}(?:[.,]\d{3}){2,}$/.test(s))s=s.replace(/[.,]/g,'');
 else if(/^\d+[.,]\d{3}$/.test(s))status='ambiguous';else if(/^\d+,\d{1,2}$/.test(s))s=s.replace(',','.');}
 if(!/^-?\d+(?:\.\d+)?$/.test(s))status=s?'unparsed':'missing';
 return {originalValue:original,originalCurrency:currency,decimal:status==='parsed'?s:null,currency:code,kind,scope,parseStatus:status,convertedValue:null};
}
function date(raw){const s=text(raw).trim().replace(/([+-]\d{2})(\d{2})$/,'$1:$2');if(!s)return {original:raw||'',value:null,precision:'unknown'};
 if(/^\d{4}-\d{2}-\d{2}(?:[+-]\d\d:\d\d)?$/.test(s)){const v=s.slice(0,10);if(!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)return {original:raw,value:null,precision:'unresolved'};return {original:raw,value:v,precision:'date'};}
 if(/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d\d:\d\d)$/.test(s)&&Number.isFinite(Date.parse(s)))return {original:raw,value:new Date(s).toISOString(),precision:'instant'};
 return {original:raw,value:null,precision:'unresolved'};
}
function status(raw){const s=fold(raw);if(/cancel|annul|withdraw/.test(s))return 'cancelled';if(/award|contract signed|concluded/.test(s))return 'awarded';if(/qualification|purchasing system|dynamic purchasing|supplier admission|dps|\bdis\b/.test(s))return 'admission';if(/consultation|market research|request for information|\brfi\b/.test(s))return 'consultation';if(/plan|intended|forthcoming|prior information/.test(s))return 'planned';if(/closed|expired|ended|archiv/.test(s))return 'closed';if(/open|ongoing|published|active/.test(s))return 'reported_open';return 'unknown';}
function canonicalURL(v){try{const u=new URL(text(v));if(!/^https?:$/.test(u.protocol))return null;u.hash='';for(const k of [...u.searchParams.keys()])if(/^utm_|^fbclid$|^gclid$/i.test(k))u.searchParams.delete(k);u.searchParams.sort();return u.toString().replace(/\/$/,'');}catch{return null;}}
function urlKey(v){const u=canonicalURL(v);if(!u)return null;const p=new URL(u);if(/\.(?:xlsx?|csv|zip|jsonl?|pdf)$/i.test(p.pathname)||/\/(?:dataset|resource|download|opendata)\//i.test(p.pathname))return null;if(/\/detail(?:s)?\/|\/notice\/-?\d|contract_display_\d|[?&](?:id|object|noticeId|resourceId|resourceid|idSourcing)=|\/opportunities\/procurement\/.+|\/tenders\/.+|\/tender-details\/|\/topic-details\//i.test(u))return 'url:'+u;
 if(p.pathname.split('/').filter(Boolean).length>=3&&/\d/.test(p.pathname)&&!/(search|list|archive|page\/\d)/i.test(p.pathname))return 'url:'+u;return null;}
function display(v){return text(v&&typeof v==='object'&&!Array.isArray(v)?(v.eng||v.en||Object.values(v)[0]):v);}
const uniqueText=v=>[...new Set(strings(v))].join(' | ');
function normalize(r,source){const title=display(first(r,['title','noticeTitle','tenderTitle','procedureTitle','notice-title','title-proc'])),description=display(first(r,['description','tenderDescription','description-proc','lotDescription'])),url=text(first(r,['sourceUrl','sourceURL','portalUrl','detailPageUrl','tedUrl'])||r.links?.html?.ENG||r.links?.html?.eng||r.links?.html?.EN||(r.links?.html?Object.values(r.links.html)[0]:''));
 const country=uniqueText(first(r,['countryCode','country','buyerCountry','buyer-country'])),buyer=text(first(r,['buyer','buyerName','contractingAuthority','sourceAuthority','authority','buyer-name']));
 const notice=uniqueText(first(r,['publicationNumber','publication-number','noticeIdentifier','noticeId','id'])),procedure=uniqueText(first(r,['procedureIdentifier','procedure-identifier','procedureId','baseProcedureIdentifier'])),reference=text(first(r,['reference','internalReference','identifier','callIdentifier','tenderNumber','activityNumber','tanumber']));
 const sourceStatus=first(r,['statusAtDownload','availabilityStatus','status','statusLabel','tenderStatus','procedureLifecycleStatus','sourceStatus']),stage=text(first(r,['procurementStage','stage','noticeType','formType','opportunityType','notice-type','form-type']));
 const published=date(first(r,['publicationDate','firstPublicationDate','tenderFirstPublicationDate','postDate','publication-date'])),updated=date(first(r,['sourceUpdated','lastUpdateTime','updateDate','latestRelevantPublicationDate']));
 const deadline=date(first(r,['canonicalSubmissionDeadline','canonicalDeadline','deadline','submissionDeadline','closingDate','deadlineDate','deadlineRaw']));
 const classification=text(first(r,['relevance','relevanceDecision','spaceRelevance','spaceClassification','classification']));
 const relevance=/AUTO_KEEP/i.test(classification)?'space':/unrelated|exclude|non.space/i.test(classification)?'excluded':/possible|review|ambiguous/i.test(classification)?'review':/space|include|relevant/i.test(classification)?'space':'unassessed';
 let lotId=uniqueText(first(r,['lotId','lotIdentifier','lotNumber','lot-identifier','lot-id']));
 const spanishParts=country==='ES'&&source.family==='national'&&['ES-Catalonia','ES-public','ES-documents','ES-agencies'].includes(r.sourceId)?procedure.split('|'):[];
 const spanishCompoundValid=spanishParts.length===(r.sourceId==='ES-Catalonia'?4:2)&&/^[A-Z0-9]{5,20}$/i.test(spanishParts[0])&&/\d/.test(spanishParts[0])&&/\d/.test(spanishParts[1]);
 if(!lotId&&r.sourceId==='ES-Catalonia'&&spanishCompoundValid&&spanishParts[2]&&spanishParts[2]!=='0')lotId=spanishParts[2];
 const keys=[],strong=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 const ted=/TED/i.test(source.family)||/ted\.europa\.eu/i.test(url)||r.recordSource==='TED';
 if(procedure&&/\d/.test(procedure)&&!/[|]/.test(procedure)&&!/^0+$/.test(procedure)){if(strong.test(procedure))keys.push('procedure-uuid:'+procedure.toLowerCase());else keys.push('procedure:'+ (ted?'TED':new URL(canonicalURL(url)||'https://'+source.authority.toLowerCase()+'.invalid').hostname)+':'+procedure);}
 if(/^\d{1,7}-20\d{2}$/.test(notice)&&ted)keys.push('ted-notice:'+notice);
 const ec=reference.match(/\b(?:EC-[A-Z]+|[A-Z]{2,12})\/20\d{2}\/(?:OP|RP|NP|LVP|MVP)\/[A-Z0-9-]+\b/i);if(ec)keys.push('ec-procedure:'+ec[0].toUpperCase());
 if(reference&&/\d/.test(reference)&&['agency-csv','agency-jsonl'].includes(source.family)&&!/^(none|unknown|n\/a|-)$/i.test(reference))keys.push('authority-reference:'+source.authority+':'+reference);
 if(reference&&/\d/.test(reference)&&source.authority==='EUSPA')keys.push('authority-reference:EUSPA:'+reference);
 if(source.family==='national'&&r.sourceId&&notice)keys.push('national-notice:'+r.sourceId+':'+notice);
 if(source.family==='national'){const linked=String(r.documents||'').match(/https:\/\/www\.e-avrop\.com\/[^\s|]+Announcement\.aspx\?id=(\d+)/i);if(r.sourceId==='SE-eavrop'&&/^\d+$/.test(notice))keys.push('swedish-eavrop:'+notice);if(linked)keys.push('swedish-eavrop:'+linked[1]);}
 if(source.family==='national'&&country==='ES'){
  if(spanishCompoundValid&&buyer&&/(?:^|[^0-9])20\d{2}(?:[^0-9]|$)/.test(spanishParts[1]))keys.push('es-buyer-procedure:'+spanishParts[0]+':'+fold(buyer)+':'+spanishParts[1]);
  try{const official=new URL(url);
   if(['contrataciondelestado.es','contrataciondelsectorpublico.gob.es'].includes(official.hostname)&&official.pathname==='/wps/poc'&&official.searchParams.get('uri')==='deeplink:detalle_licitacion'){
    const id=official.searchParams.get('idEvl');if(id&&/^[A-Za-z0-9+/=]+$/.test(id))keys.push('es-placsp-detail:'+id);
   }
   if(['contractaciopublica.cat','www.contractaciopublica.cat'].includes(official.hostname)){
    const id=official.pathname.match(/^\/(?:ca|es|en)\/detall-publicacio\/([0-9a-f-]{36})(?:\/|$)/i)?.[1];if(id&&strong.test(id))keys.push('es-catalonia-publication:'+id.toLowerCase());
   }
  }catch{}
 }
 if(r.parentReference)keys.push('authority-reference:'+source.authority+':'+r.parentReference);
 const uk=urlKey(url);if(uk)keys.push(uk);
 if(source.authority==='ESA'&&reference&&/\d/.test(reference))keys.push('authority-reference:ESA:'+reference);
 if(!keys.length)keys.push('unlinked:'+(source.scope||source.authority+'/'+source.family)+':'+((r.sourceId||country||source.authority)+':'+(notice||sha(JSON.stringify(r)))));
 const values=[];for(const [key,cur,kind]of [['estimated-value-proc','estimated-value-cur-proc','estimate'],['total-value','total-value-cur','total'],['estimatedValue','estimatedCurrency','estimate'],['estimatedTotalProcedureValue','estimatedCurrency','estimate'],['estimatedContractAmount','estimatedCurrency','estimate'],['awardedValue','awardedCurrency','award'],['awardValue','awardCurrency','award'],['value','currency','unspecified'],['totalValue','totalCurrency','total']])if(r[key]!==undefined&&r[key]!=='')values.push(money(r[key],r[cur]||r.currency||'',kind,lotId?'lot':'unspecified'));
 const supplierRaw=first(r,['winnerNames','contractor','winner-name','supplierName']);const suppliers=strings(supplierRaw).flatMap(s=>s.split(/\s+\|\s+|\n/)).map(s=>s.trim()).filter(s=>s&&!/^(none|unknown|n\/a|-)$/i.test(s)).map(name=>({originalName:name,normalizedName:fold(name),originalIdentifiers:first(r,['winnerIdentifiers','supplierIdentifier']),country:text(first(r,['supplierCountry','winnerCountry']))}));
 return {title,description,country,buyer,sourceUrl:url,sourceNoticeId:notice,sourceProcedureId:procedure,reference,identityKeys:[...new Set(keys)],lotId:lotId&&!lotId.includes(' | ')?lotId:null,lotCountOriginal:first(r,['lotCount']),stage,sourceStatus:sourceStatus||'',status:status(text(sourceStatus)+' '+stage),publication:published,updated,deadline,relevance,relevanceOriginal:classification,cpv:strings(first(r,['cpv','cpvCodes','allCPV','mainCpv','mainCPV','classification-cpv'])),values,suppliers,documents:strings(first(r,['documents','documentUrls','documentFiles','xmlUrl','pdfUrl'])),timeZone:r.timeZone||null,retrievedAt:r.retrievedAt||null,rawEvidenceReference:r.rawFile||null,eligibilityEvidence:first(r,['eligibilityEvidence','eligibleCountries']),scope:published.value?(published.value<'2020-01-01'?'before_2020':'from_2020'):'publication_date_unknown',requiredCapability:first(r,['requiredCapability']),lotStructure:'Only explicit lot identifiers can establish separate lots; original lot descriptions remain in source evidence.'};
}
module.exports={normalize,money,date,status,canonicalURL,urlKey};
