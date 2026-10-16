'use strict';
const crypto=require('node:crypto');
const cheerio=require('cheerio');
const clean=s=>String(s??'').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,'').replace(/\s+/g,' ').trim();
const fold=s=>clean(s).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
const hash=s=>crypto.createHash('sha256').update(String(s)).digest('hex');
function htmlText(s){const $=cheerio.load(String(s||''));$('script,style,nav,header,footer,noscript').remove();return clean($.text());}
// Stems include all EU official-language families. Broad applications are retained
// as review candidates; an agency's name alone does not prove a space contract.
const strong=/\b(satellit\w*|satelliet\w*|satelit\w*|satelit|satcom|vsat|gnss|egnos|copernicus|galileo|cubesat\w*|smallsat\w*|nanosatelit\w*|espaciais|espacial(?:es|s)?|spacecraft|spaceport|spaceflight|spaceborne|space[- ]based|space surveillance|space traffic|space debris|earth observation|remote sensing|launch vehicle|ground segment|ground station|orbital|in-orbit|raumfahrt\w*|weltraum\w*|erdbeobacht\w*|fernerkund\w*|spazial\w*|telerilev\w*|teledetec\w*|teledetek\w*|avaru\w*|kosm\w*|kozm\w*|vesmir\w*|vesolj\w*|svemir\w*|rumfart\w*|jordobservation\w*|fjernmaling\w*|rumbaseret\w*|rumteknologi\w*|ruimtevaart\w*|aardobserv\w*|rymd\w*|fjarranalys\w*|palydov\w*|kaugseire|kaukokartoit\w*|muhold\w*|urkutat\w*|taverzekel\w*|spatiale?s?|spatiali|observation de la terre|observacion de la tierra|observacao da terra)\b|δορυφορ|διαστημικ|διαστημο|τηλεπισκοπ|сателит|космич|спътник|гнсс/giu;
const broad=/\b(geospatial|geo[- ]information|gis|lidar\w*|radar\w*|hyperspectral|multispectral|wildfire|forest monitoring|environmental monitoring|quantum communication|laser ranging|telescop\w*|teleskop\w*|telescoop\w*|grondstation\w*|astronom\w*)\b/giu;
const defence=/\b(defen[cs]e|defensie|military|dual[- ]use|counterspace|armed forces|verteidigung|militar\w*|difesa|defesa|obron\w*|gynyb\w*|karin\w*|honved\w*|obran\w*|vojn\w*)\b|отбран(?:а|ител)[а-я]*|военн[а-я]*|двоина употреба/giu;
const procurement=/tender|procurement|contract notice|invitation to bid|march[eé]|appel d.offres|ausschreibung|vergabe|licitaci|contrataci|appalt|gara|zam[oó]wie|przetarg|hankin|riigihank|pirkim|iepirk|beszerz|διαγωνισ|προκήρυξ|поръч|nabav|naročil|obstar[aá]v|udbud|upphandl|aanbested|konkurrenc|concurso|achizi/i;
function classify(title,description,cpv=''){
 const t=fold(title+' '+String(description||'').replace(/\bAwardee:[\s\S]*$/i,'')).replace(/satel·lit/g,'satelit').replace(/\bgps (?=coordinates|souradnice)/g,'site ').replace(/институт за космич(?:ески|ски) изследвания и технологии(?: при българска академия на науките| - бан| – бан)?/g,'').replace(/spatial resolution|resolution spatiale|spatial dimensions?/g,'geometric resolution').replace(/deutsch(?:e|es|en) zentrum(?:s)? fur luft-? und raumfahrt(?: e\.?v\.?)?/g,'').replace(/bundesministerium(?:s)? fur forschung,? technologie und raumfahrt/g,'').replace(/orbital(?:ly)? (?:geschwei\w*|weld\w*)/g,'').replace(/agenzia spaziale italiana/g,'').replace(/polsk(?:a|iej) agencj(?:a|i|e) kosmiczn(?:a|ej)/g,'').replace(/centrum badan kosmicznych(?: pan)?/g,'').replace(/wspo[lł]prac[ae] (?:miedzynarodow\w*|miedzyrzadow\w*) w ramach programow kosmicznych/g,'').replace(/czesci statkow powietrznych,? kosmicznych i smig[lł]owcow|statki powietrzne i kosmiczne|samoloty,? statki kosmiczne i smig[lł]owce/g,'').replace(/kosmoso (?:g\.|gatv\w*)/g,'').replace(/letadla a kosmicke lode|letadla,? kosmicke lode a vrtulniky/g,'').replace(/aircraft and spacecraft|aircraft,? spacecraft and helicopters|luftfartøjer og rumfartøjer/g,'').replace(/(?:institut (?:royal )?(?:belge )?d.aeronomie spatiale(?: de belgique)?|centre spatial de liege)/g,'').replace(/agencia espacial espanola/g,''),found=[...new Set(t.match(strong)||[])],b=[...new Set(t.match(broad)||[])];
 if(/spatial resolution|resolution spatiale|spatial dimensions?/.test(fold(title+' '+description)))b.push('Spatial resolution describes imaging geometry; a space application requires separate evidence');
 if(/centre spatial de liege|institut (?:royal )?(?:belge )?d.aeronomie spatiale/.test(fold(title+' '+description)))b.push('Space institution named; actual procurement scope needs review');
 if(/czesci statkow powietrznych,? kosmicznych i smig[lł]owcow|statki powietrzne i kosmiczne|samoloty,? statki kosmiczne i smig[lł]owce/.test(fold(title+' '+description)))b.push('Broad aviation and space category does not establish the procured item is space-related');
 if(/aircraft and spacecraft|aircraft,? spacecraft and helicopters|luftfartøjer og rumfartøjer/.test(fold(title+' '+description)))b.push('Broad aviation category requires confirmation of the actual space item');
 if(/дистанционн(?:и|о|ите|ото) (?:изследвания|наблюдение|зондиране)|наблюдение на земята/.test(t))found.push('Bulgarian Earth observation or remote sensing');if(/(?<![а-я])(?:лидар|георадар|радар|телескоп(?!ич)|астроном|хиперспектрал|мултиспектрал|навигац|радиолокац)/.test(t))b.push('Bulgarian remote sensing, navigation or astronomy candidate');
 if(/геодез/.test(fold(title).replace(/(?:националния |национален )?институт по геофизика,? геодезия и география/g,'')))b.push('Dedicated Bulgarian geodetic surveying scope requires GNSS or space evidence');
 if(/daljinsk\w* istraziv|promatranj\w* zemlje|opazanj\w* zemlje/.test(t))found.push('Croatian Earth observation or remote sensing');if(/geoprostor|geoinform|geodez|geodet|\brtk\b|hiperspektr|multispektr/.test(fold(title)))b.push('Croatian geospatial or surveying scope requires space evidence');
 if(/ionosond|antenni pole|wind profiler/.test(t))b.push('Czech upper-atmosphere or antenna research requires technical scope review');
 if(/dalekohled/.test(t)&&/observator|exoplanet|hvezdn|astronom/.test(t))found.push('Czech astronomical telescope');
 if(/\bdruzic\w*|dalkov\w* pruzkum|pozorovani zeme/.test(t))found.push('Czech satellite or Earth observation scope');
 if(/talizpet|attalinat\w* izpet|\bzemes novero/.test(t))found.push('Latvian Earth observation or remote sensing');
 if(/radioteleskop|radioastronom|\blofar\b/.test(t))found.push('Radio astronomy telescope or LOFAR infrastructure');
 if(/παρατηρησ(?:η|ης|εων) (?:της )?γης/.test(t))found.push('Greek Earth observation');
 if(/γεωχωρ|γεωδαι/.test(t))b.push('Greek geospatial or geodetic scope; space application requires review');
 const hits=found.filter(h=>{
  if(/^rymd/.test(h)&&/^(rymde|rymdena)$/.test(h))return false;
  if(/^satelliten(?:seiten|websites|standorte|kuchen)/.test(h)){b.push('Satellite means an ancillary website or facility');return false;}
  if(/^satellietkeuken/.test(h)){b.push('Non-space satellite kitchen');return false;}
  if(h==='orbital'&&!/satellit|satelit|space|espaco|espaci|aerospac|payload|launch|lancament|debris/.test(t)){b.push('ambiguous: orbital');return false;}
  if(/^satelitpasakum/.test(h)){b.push('Satellite event means an ancillary conference event');return false;}
  if(/^kosmonaut/.test(h)&&(/\b(?:ulice|ulici|ul\.|namesti|trida|tr\.|zs|ms|skola|skolu|olomouc)\s+kosmonautu\b|\bkosmonautu\s+\d/.test(t)||(/komunikac|chodnik|vodoinstalac|uklid|pojisten|kancelarskeho papiru|revizi|kabel/.test(fold(title))&&!/kosmonaut/.test(fold(title)))))return false;
  if(/^kosm|^kozm/.test(h)&&!/^(kosmicz|kosmick|kosmisk|kosmin|kosmos|kosmonaut|kozmick)/.test(h))return false;
  if(/^(satellites?|spatiale?s?|espacial(?:es|s)?|espaciais|galileo|copernicus)$/.test(h)){
   // Satellite kitchens, spatial transcriptomics and schools named Galileo are
   // frequent real false positives. Keep weak matches for review, not OPEN.
   const escaped=h.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
   const nearby=new RegExp('.{0,70}\\b'+escaped+'\\b.{0,70}','g');
   const clear=(t.match(nearby)||[]).some(x=>/orbit|espaco|lancamento|satelit|aerospac|aerospat|satcom|vsat|gnss|egnos|space|telecom|communication|telemetry|navigation|imager|imag[ei]n|meteorolog|weather|earth|terre|payload|lanceur|spatial launch|terre|observation|tracking|surveillance|antenne|antenna|downlink/.test(x));
   if(!clear){b.push('ambiguous: '+h);return false;}
  }
  return true;
 });
 if(/(?:recolector\w*|recollidor\w*|camio(?:n)?|vehicle|llum|fals sostre|radioterapia|hospital|orquesta).{0,55}satelit|satelit\w*.{0,35}(?:radioterapia|hospital|quirofan|acustic)|orquesta los satelites/.test(t)&&!/comunicacio|telecomunicacio|gnss|satcom|observacion de la tierra/.test(fold(title))){b.push('Non-space Spanish satellite equipment, facility or orchestra');hits.length=0;}
 if(/transport spatial|centre spatial guyanais|bodenstation|satellitenprojekt|nanosatellit|instrumentation spatiale|stazioni di terra|in orbita/.test(t))hits.push('explicit space transport or ground infrastructure');
 if(/servicios espaciales|vigilancia espacial|seguimiento espacial|basura espacial|segmento espacial|estacion(?:es)? terrena(?:s)?|observacion de la tierra|observacio de la terra/.test(t))hits.push('explicit Spanish/Catalan space infrastructure or observation');
 if(/sounding rocket|rocket engine test|cryogenic propulsion rocket|space propulsion/.test(t))hits.push('Space rocket propulsion or sounding rocket applications');
 if(/garo palydov/.test(t)&&!/(?:gnss|satcom|kosmin|palydovin(?:io|iu) rys)/.test(t)){b.push('Steam tracing piping uses a non-space satellite term');hits.length=0;}if(/satellite news gathering/.test(t))hits.push('satellite news gathering');
 if(/satellite (?:imag(?:e|es|ery)|capacity|gateway|data|services|track(?:ing|ed)|communications?)\b/.test(t))hits.push('explicit satellite products or services');
 if(/\b(?:telescop(?:e|es|i|is|io|ios)|teleskop(?:e|en)?)\b/.test(t)&&/observator|astronom/.test(t))hits.push('astronomical telescope or observatory instrument');
 if(/телескоп/.test(t)&&/астроном|обсерватор/.test(t))hits.push('Bulgarian astronomical telescope');
 if(/transient search telescope/.test(t))hits.push('astronomical transient search telescope');
 if(/\bgps\b/.test(t)&&/receiver|tracking|navigation|fleet|vehicle|monitor|prijimac|navigac|sledovan|souradnic|polohov|sturesan|ieric|iekart|koordinat|autotransport|uztver|izsekosan|sekosan|poziciones|prijem|prijam|pracenj|vozil|pozicionir|sporing|positionering|fladestyring|modtager|lokaliz|nawig|pojazd|imtu|sekim|navigacij|vietos nustat|приемни[кц]|проследяване|навигац|автопарк|автомобил|мониторинг|устройства|δεκτ|εντοπισ|πλοηγ|γεωδαιτ|οχημα/.test(t))hits.push('GPS positioning or navigation');
 if(/\bssac-pl\b|\bstk\b.{0,80}\bodtk\b/.test(t))hits.push('Space surveillance control or orbit determination software');if(/\beu\s*sst\b/i.test(t))hits.push('EU SST');
 if(/satelit/.test(t)&&/(?:operaciju|kirurg|medicin|arstniec).{0,70}(?:lamp|satelit)|lamp.{0,45}satelit/.test(fold(title))&&!/gnss|satcom|kosmos/.test(t)){b.length=0;hits.length=0;}
 const codes=String(cpv).match(/\b(?:34712\d{3}|35631\d{3}|35632\d{3}|3253\d{4}|38112100|38235000|60510000|64214100)\b/g)||[];
 // Aerial services include ordinary drone shows. Biological spatial imaging
 // and navigation fitted to construction machinery are not space contracts.
 const heading=fold(title);
 for(let i=b.length-1;i>=0;i--)if(/^teleskop(?:schiebe|element|stapler|zylinder|kran)/.test(b[i])||(/^teleskop/.test(b[i])&&/hubarbeitsbuhn|sportgerat|trennwand|brandschutztor/.test(heading)&&!/observator|astronom/.test(t)))b.splice(i,1);
 if(/teleskop/.test(heading)&&/krautuv|iekravej|kop[eė]c/.test(heading)&&!hits.length&&!codes.length)b.length=0;if(/geldtransporte/.test(heading)&&hits.length&&!hits.some(x=>!/^raumfahrt/.test(x))&&!codes.length){b.push('Cash transport at a space organisation; no substantive space service demonstrated');hits.length=0;}
 if(/sanierung brandschutz luft- und raumfahrt|institutsgebaude fur luft- und raumfahrttechnik/.test(t)&&!/satellit|gnss|satcom|spacecraft|raumfahrtmission/.test(heading)){b.push('Ordinary building work at an aerospace institute; specific space relevance requires review');hits.length=0;codes.length=0;}
 if(/homologacion de (?:proveedores|empresas)|registro de proveedores|sistema de clasificacion de proveedores/.test(heading)||(/equipamiento deportivo|material deportivo/.test(heading)&&!/gnss|gps|satcom|satelit/.test(heading))){if(hits.length||codes.length||b.length)b.push('Supplier qualification or mixed sporting lots; specific space procurement requires review');hits.length=0;codes.length=0;}
 if(/\bpecs\b/.test(t)&&/european space agency|space activit/.test(t))hits.push('ESA PECS space activities');
 if(/teleskop/.test(heading)&&/manipulator|nakladac|zebrik|plosin|schodist/.test(heading)&&!hits.length&&!codes.length)b.length=0;
 if(/teleskopsk\w* (?:utovarivac|vilicar|samopodizac)|телескопичен товарач|телескопични товарачи/.test(heading)&&!hits.length&&!codes.length)b.length=0;
 if(/usluge restorana|posluzivanja (?:hranom|pica)|catering|promotivnog materijala|organizacije dogadanja/.test(heading)&&/svemir/.test(heading)&&!codes.length){b.push('Ancillary catering or promotional supplies for a named space programme; review scope');hits.length=0;}
 if(/holster/.test(heading)&&/radar/.test(heading)&&!hits.length&&!codes.length)b.length=0;
 if(!hits.length&&!codes.length&&/telescopic (?:cranes?|ramp)|orbital (?:implants|seater)|sterile swabs/.test(heading))b.length=0;
 if(/υποβρυχι|underwater|subsea/.test(heading)&&!/satellit|satelit|δορυφορ|gnss|spacecraft/.test(heading)){
  if(hits.length||codes.length||b.length)b.push('Underwater equipment without demonstrated satellite or space relevance');hits.length=0;codes.length=0;
 }
 if(/satellitens fsk|institutionen for system och rymdteknik/.test(t)&&!/satellit|gnss|satcom|rymd/.test(heading)){b.push('Space terminology appears in an organisation or building name');hits.length=0;codes.length=0;}
 if(/transcriptom|proteom|histolog|cellular|cellulaire|microscop/.test(heading)&&!/satellit|spacecraft|gnss|orbit/.test(heading)){
  if(hits.length||codes.length||b.length)b.push('Spatial biology, not demonstrated space procurement');hits.length=0;codes.length=0;
 }
 if(/forenz/.test(heading)&&/apple/.test(heading)&&!/(?:gnss|gps|satelit|spacecraft)/.test(heading)&&codes.length){b.push('Generic Apple forensic equipment; source GPS CPV does not establish a dedicated space procurement');hits.length=0;codes.length=0;}
 if(/svozu a likvidace odpadu|odvoz odpadu/.test(heading)&&!/gps|gnss|satelit/.test(heading)&&(hits.length||codes.length)){b.push('Position tracking is incidental to waste collection');hits.length=0;codes.length=0;}
 if(/odpadow|odpady|akcja zima|zimowym utrzymaniu|ciagnika|samochodu operacyjnego|rehabilitacyjnych|placow zabaw|budowa budynku|budowy obiektow|czystosci przystankow/.test(heading)&&!/gps|gnss|satelit|kosmiczn|orbit|satcom/.test(heading)&&(hits.length||codes.length)){b.push('Space terminology describes incidental equipment, amenities or a theme within a non-space procurement');hits.length=0;codes.length=0;}if(/koszenia terenu|sprzatanie pomieszczen|ochrona fizyczna obiektow/.test(heading)&&(hits.length||codes.length)){b.push('Routine grounds, cleaning or guarding services at a named space facility');hits.length=0;codes.length=0;}if(/zimowe utrzymanie|odsniezani|utrzymanie drog/.test(heading)&&!/gps|gnss|satelit|monitoring/.test(heading)&&!codes.length&&hits.length){b.push('Position tracking is incidental to road maintenance; review the actual space procurement scope');hits.length=0;}if(/koparko|excavator|backhoe|bulldozer|kanalinspektionsfahrzeug/.test(heading)&&!/gnss|satellit|satelit|navigation/.test(heading)){
  if(hits.length||codes.length||b.length)b.push('Navigation appears incidental to construction machinery');hits.length=0;codes.length=0;
 }
 if(/residuos urbanos.{0,25}satelite|central de recogida neumatica.{0,120}satelit|ladestandere|galeria satelit|satellit.{0,12}(kitchen|kuche|urgentni center)|softwares? satelites|program.{0,15}satellit/.test(heading)||(/\brymd\b/.test(t)&&!hits.some(h=>h!=='rymd')&&!codes.length)){
  if(hits.length||codes.length||b.length)b.push('Ambiguous name or non-space use of the search term');hits.length=0;codes.length=0;
 }
 return {relevance:hits.length||codes.length?'space':b.length?'possible_space':'unrelated',spaceEvidence:[...hits,...codes].join(' | '),defenceEvidence:[...new Set(t.match(defence)||[])].join(' | '),reviewEvidence:b.join(' | ')};
}
function localDate(date,timeZone){return new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
function parseDate(raw,timeZone='Europe/Brussels'){
 const s=clean(raw);if(!s)return {iso:'',precision:'missing'};
 let m=s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/);
 if(!m){const d=s.match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);if(d)m=[d[0],d[3],d[2].padStart(2,'0'),d[1].padStart(2,'0'),d[4],d[5],d[6]];}
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
 const opportunityType=require('../../current/lifecycle.cjs').stageOf({...r,sourceStatus:[r.sourceStatus,/qualification|admission/.test(r.status||'')?r.status:''].filter(Boolean).join(' ')});
 if(/cancel|annul|anulad|desist|uniewaz|widerruf|revocat|ακυρω/.test(s))return ['cancelled','explicit source status'];
 if(s==='invitation_only')return ['invitation_only','source restricts participation to invited suppliers'];
 if(/suspend|paused/.test(s))return ['suspended','explicit source suspension'];
 if(kind==='in_house_assignment')return ['in_house_assignment','Internal assignment; not a public bidding opportunity'];
 if(kind==='award'||/awarded|attribution|adjudicad|aggiudicat|formaliz|resuelt|resolved|rozstrzygn|ανατεθει/.test(s))return ['awarded','award notice or source status'];
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
   if(['admission','consultation'].includes(opportunityType))return [opportunityType,'Separate participation or consultation opportunity; not an ordinary tender'];
   if(r.noticeVerified&&(kind==='tender'||kind==='amendment'&&s==='published_current'))return ['open','future submission deadline on a procurement notice'];
 }
 if(['admission','consultation'].includes(opportunityType))return [opportunityType,'Separate participation or consultation opportunity; not an ordinary tender'];
 return ['unknown','no verified future deadline; review source'];
}
const fields=['recordId','country','sourceId','sourceName','sourceUrl','noticeId','procedureId','title','description','buyer','publicationDate','sourceUpdated','deadlineRaw','deadline','deadlinePrecision','timeZone','noticeType','sourceStatus','status','statusEvidence','relevance','spaceEvidence','defenceEvidence','reviewEvidence','cpv','value','currency','documents','noticeVerified','dateScope','textTruncated','rawFile','retrievedAt','ragText','lotId'];
function normalize(x,source,rawFile,now=new Date()){
 const r={country:source.country,sourceId:source.id,sourceName:source.name,timeZone:source.timeZone||'Europe/Brussels',...x};
 if(/^T\d{2}:/.test(r.sourceUpdated||''))r.sourceUpdated=r.publicationDate||'';
 if(Array.isArray(r.documents))r.documents=r.documents.join(' | ');r.title=clean(r.title);r.description=clean(r.description);r.textTruncated=r.description.length>29000;r.description=r.description.slice(0,29000);
 Object.assign(r,classify(r.title,r.description,r.cpv));
 if(source.id==='SE-eavrop'&&classify(r.title,'',r.cpv).relevance!=='space'&&r.relevance!=='unrelated'){r.relevance='possible_space';r.reviewEvidence='Space term appears only in a document search excerpt; verify that the contract itself concerns space services.';}
 if(source.country==='BE'&&r.relevance==='space'&&/grasrobots|robotmaaier|grasmaaier|maairobot|tondeuse/i.test(r.title)&&!/gnss|gps|satellit|satelliet/i.test(r.title)){r.relevance='possible_space';r.reviewEvidence='GPS is incorporated in grounds-maintenance machinery; review whether a substantive space product or service is being procured.';}
 if(source.country==='BG'&&r.relevance==='space'&&/зимно поддържане|снегопочиств|сметосъбиране/i.test(r.title)&&!/gnss|gps|спътник|сателит/i.test(r.title)){r.relevance='possible_space';r.reviewEvidence='GPS tracking is incidental to road or waste services; verify a substantive satellite product or service.';}
 if(source.country==='DK'&&r.relevance==='space'&&/Integrated Geomodel|Eddy Covariance System/i.test(r.title)){r.relevance='possible_space';r.reviewEvidence='Geological spatial modelling or incidental GPS timing; substantive space contract scope requires review.';}
 if(source.country==='DK'&&r.relevance==='space'&&/airborne maritime pollution surveillance|helicopter (?:service|logistics)|kystmissilforsvar/i.test(r.title)){r.relevance='possible_space';r.reviewEvidence='Aircraft logistics or coastal missile scope; space terminology alone does not establish a separately procured satellite or space service.';}
 if(x.relevanceReviewReason&&r.relevance!=='unrelated'){r.relevance='possible_space';r.reviewEvidence=[r.reviewEvidence,x.relevanceReviewReason].filter(Boolean).join(' | ');}
 if(r.relevance==='unrelated'&&source.country==='BE'&&/a[eé]ronom|aeronomy|sterrenwacht|observatoire royal|royal meteorological|koninklijk meteorologisch|institut royal m[eé]t[eé]orologique|politique scientifique|wetenschapsbeleid|^VITO(?: \||$)/i.test(r.buyer)){r.relevance='possible_space';r.reviewEvidence='Space or astronomy institution buyer; the actual procurement needs evidence of a space application.';}
 if(r.relevance==='unrelated'&&source.id==='NL-public'&&/\bSRON\b|\bASTRON\b|Netherlands Space (?:Office|Agency)/i.test(r.buyer+' '+r.description)){r.relevance='possible_space';r.reviewEvidence='Known space institute mentioned; substantive space relevance requires review';}
 if(r.relevance==='unrelated'&&source.country==='ES'&&/agencia espacial espanola|instituto nacional de tecnica aeroespacial|instituto de astrofisica de canarias|institut d.estudis espacials de catalunya|instituto de astrofisica de andalucia|centro de astrobiologia/.test(fold(r.buyer))){r.relevance='possible_space';r.reviewEvidence='Space or astronomy institute buyer; substantive contract relevance requires review';}
 if(r.relevance==='unrelated'&&source.kind==='space_body'&&r.noticeVerified===true&&['tender','planning'].includes(r.noticeType)){
  r.relevance='possible_space';r.reviewEvidence='Procurement by a space body; substantive space relevance needs review';
 }
 const date=parseDate(r.deadlineRaw,r.timeZone);r.deadline=date.iso;r.deadlinePrecision=date.precision;
 [r.status,r.statusEvidence]=statusOf(r,now);
 r.dateScope=x.scopeDate?'event_date:'+x.scopeDate:String(x.dateScope||'').startsWith('event_date:')?x.dateScope:r.publicationDate?'dated':'unknown_publication_date';
 r.rawFile=rawFile;r.retrievedAt=now.toISOString();r.recordId=hash(source.id+'|'+(r.noticeId||r.sourceUrl)+'|'+(r.sourceUpdated||r.publicationDate||'')+(r.lotId?'|lot:'+r.lotId:'')).slice(0,24);
 r.ragText=[r.title,r.description,`Country: ${r.country}; Buyer: ${r.buyer||''}; Status: ${r.status}; Deadline: ${r.deadline||r.deadlineRaw||'unknown'}; Source: ${r.sourceUrl}`].join('\n').slice(0,32000);
 // XML parsers can return substrings backed by a multi-megabyte feed string.
 // Detach normalized records so retaining a small result does not retain that feed.
 return JSON.parse(JSON.stringify(Object.fromEntries(fields.map(k=>[k,typeof r[k]==='string'?r[k].replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,''):r[k]??'']))));
}
function swedishIdentity(r){if(r.sourceId==='SE-eavrop'&&/^\d+$/.test(r.noticeId||''))return 'eavrop:'+r.noticeId;const url=String(r.documents||'').match(/https:\/\/www\.e-avrop\.com\/[^\s|]+Announcement\.aspx\?id=(\d+)/i);return url?'eavrop:'+url[1]:null;}
function latestRecords(rows){
 const map=new Map(),swedishAliases=new Map();for(const r of rows){const key=swedishIdentity(r);if(key)swedishAliases.set(r.sourceId+'|'+r.noticeId,key);}
 for(const r of rows){const namespace=['CY-portal','CY-space','CY-published','CY-published-created'].includes(r.sourceId)?'CY-current':['SE-eavrop','SE-mercell'].includes(r.sourceId)?'SE-current':['MT-portal','MT-published','MT-published-created'].includes(r.sourceId)?'MT-current':['EE-portal','EE-archive'].includes(r.sourceId)?'EE-current':['LV-portal','LV-open','LV-buyers'].includes(r.sourceId)?'LV-current':['LT-portal','LT-cpv','LT-space'].includes(r.sourceId)?'LT-current':['DK-portal','DK-cpv','DK-buyers'].includes(r.sourceId)?'DK-current':['BE-portal','BE-cpv','BE-buyers'].includes(r.sourceId)?'BE-current':['BG-portal','BG-cpv','BG-buyers','BG-space','BG-open'].includes(r.sourceId)?'BG-current':['HR-portal','HR-cpv','HR-buyers','HR-open'].includes(r.sourceId)?'HR-current':r.sourceId;const key=namespace+'|'+(swedishAliases.get(r.sourceId+'|'+r.noticeId)||r.procedureId||r.noticeId||r.sourceUrl)+(r.lotId?'|lot:'+r.lotId:'');const prev=map.get(key);const stamp=r.sourceUpdated||r.publicationDate||'';const old=prev&&(prev.sourceUpdated||prev.publicationDate||'');
  if(namespace==='SE-current'&&prev&&r.sourceId!==prev.sourceId){const primary=r.sourceId==='SE-eavrop'?r:prev,secondary=r.sourceId==='SE-mercell'?r:prev;if(primary.publicationDate&&String(primary.retrievedAt||'')>=String(secondary.sourceUpdated||secondary.publicationDate||'')){map.set(key,primary);continue;}}
  if(namespace==='EE-current'&&prev&&r.sourceId!==prev.sourceId){if(r.sourceId==='EE-portal'&&String(r.retrievedAt)>=String(prev.retrievedAt)){map.set(key,r);continue;}if(prev.sourceId==='EE-portal'&&String(prev.retrievedAt)>=String(r.retrievedAt))continue;}
  const sameNoticeNewer=prev&&r.noticeId&&r.noticeId===prev.noticeId&&r.retrievedAt!==prev.retrievedAt;
  if(!prev||stamp>old||(stamp===old&&(sameNoticeNewer?String(r.retrievedAt||'')>String(prev.retrievedAt||''):['cancelled','awarded','closed'].includes(r.status))))map.set(key,r);
 }
 return [...map.values()];
}
module.exports={clean,fold,hash,htmlText,classify,procurement,parseDate,statusOf,normalize,latestRecords,fields};





