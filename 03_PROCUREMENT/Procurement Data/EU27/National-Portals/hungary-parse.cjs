'use strict';
const {normalize,fold}=require('./core.cjs');
const source={id:'HU-portal',country:'HU',name:'Hungary EKR public procurement register',timeZone:'Europe/Budapest'};
const strong=/muhold|satellit|\bgnss\b|\bgps\b|urkutat|urtechn|ureszkoz|urf elvetel|urfelvetel|uridojar|foldmegfigyel|copernicus|galileo|egnos|spacecraft|cubesat|satcom/;
const broad=/taverzek|radar|lidar|hiperspektr|multispektr|teleszk|csillagasz|geodez|terinformat|remote sensing|earth observation/;
function date(a){if(!Array.isArray(a)||a.length<3)return '';return a.slice(0,3).map((n,i)=>i?String(n).padStart(2,'0'):n).join('-')+(a.length>=5?'T'+String(a[3]).padStart(2,'0')+':'+String(a[4]).padStart(2,'0'):'');}
function parseHU(d,lots,p,documents=[],now=new Date()){
const lotText=(d.tovabbiReszList||[]).map(x=>`Lot ${x.reszSzama}: ${x.reszElnevezes}`).join('\n'),scope=d.eljarasTargy+'\n'+lotText,cpv=[d.foCpvKod?.kod,...lots.flatMap(x=>[...(x.foCpvList||[]),...(x.tovabbiCpvList||[])].map(c=>typeof c==='string'?c:c.kod))].filter(Boolean).join(' | '),buyer=(d.ajanlatkeroList||[]).map(x=>x.szervezetValtozat?.nev).filter(Boolean).join(' | '),stage=d.eljarasSzakasz?.kod||'',stageText=d.eljarasSzakasz?.ertekEn||d.eljarasSzakasz?.ertekHu||stage;
const excerpts=documents.flatMap(x=>x.text.split(/\r?\n/).filter(t=>strong.test(fold(t))||broad.test(fold(t)))).slice(0,90).join('\n');
const x={noticeId:d.eljarasAzonosito,procedureId:d.eljarasAzonosito,title:d.eljarasTargy,description:[lotText,'Source stage: '+stageText,'Participation: '+d.ajanlatotAdhatBe,excerpts?'Document search excerpts (context requires review):\n'+excerpts:''].filter(Boolean).join('\n'),buyer,cpv,publicationDate:date(d.meginditasDatum),sourceUpdated:date(d.meginditasDatum),deadlineRaw:date(d.ajanlatteteliHatarido),noticeType:'tender',noticeVerified:true,sourceUrl:'https://ekr.gov.hu/eljarastar/eljaras/'+d.eljarasAzonosito,sourceStatus:stage,documents:documents.map(x=>x.file),currency:'HUF'};
if(/E60$/.test(stage)){x.noticeType='award';x.sourceStatus='awarded';}else if(/VISSZAVONT/.test(stage))x.sourceStatus='cancelled';else if(/EREDMENYTELEN|E50$|EPK80|E33$/.test(stage))x.sourceStatus='closed';else if(d.ajanlatotAdhatBe==='CSAK_MEGHIVOTT')x.sourceStatus='invitation_only';
const r=normalize(x,source,p.detail.file,now),f=fold(scope),special=/\b(?:3253\d{4}|34712\d{3}|35631\d{3}|38112100|60510000|64214100)-\d\b/.test(cpv);
r.relevance=strong.test(f)||special?'space':broad.test(f)||strong.test(fold(excerpts))||broad.test(fold(excerpts))?'possible_space':'unrelated';
if(r.relevance==='unrelated'&&p.queries.some(q=>!q.startsWith('all-current')))r.relevance='possible_space';
if(r.relevance==='unrelated'&&/csillagasz|urkutat|wigner/.test(fold(buyer)))r.relevance='possible_space';
if(r.relevance==='possible_space')r.reviewEvidence='Keyword, document excerpt, geospatial/astronomy scope or buyer is a candidate only; substantive satellite/space application requires review.';
if(r.relevance==='space')r.spaceEvidence='Explicit space/GNSS/satellite title or lot scope, or specific space procurement CPV';
if(/E20$|E30$|E32$/.test(stage)){r.status='qualification_or_planning';r.statusEvidence=stageText+'; admission/planning is not a confirmed open tender';}
else if(r.status==='open'&&(d.ajanlatotAdhatBe!=='MINDENKI'||!p.current||!/E40$/.test(stage))){r.status='needs_verification';r.statusEvidence='Public current bidding not confirmed by source stage and eligibility';}
if(r.status==='open'&&/withdraw|cancel|visszavont/i.test(lotText)){r.status='needs_verification';r.statusEvidence='Mixed or withdrawn lots require individual eligibility checks';}
r.ragText=[r.title,r.description,`Country: HU; Buyer: ${buyer}; Status: ${r.status}; Deadline: ${r.deadline}; Source: ${r.sourceUrl}`,r.reviewEvidence].join('\n').slice(0,32000);return r;}
module.exports={parseHU,date,strong,broad};

