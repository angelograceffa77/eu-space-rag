'use strict';
const EC='https://commission.europa.eu/funding-and-tenders/tools-public-buyers/public-procurement-eu-countries_en';
const ESA='https://business.esa.int/national-delegations';
const SST='https://www.eusst.eu/about-us/procurement';
// National portals and national space authorities are separate sources. Discovery is
// deliberately reported as partial: a homepage is not a complete notice inventory.
const countries=[
 ['AT','Austria','Europe/Vienna','https://ausschreibungen.usp.gv.at/','FFG','https://www.ffg.at/en/space','Satellit Raumfahrt Erdbeobachtung Weltraum'],
 ['BE','Belgium','Europe/Brussels','https://www.publicprocurement.be/','BELSPO','https://www.belspo.be/belspo/space/index_en.stm','satellite spatial satelliet ruimtevaart'],
 ['BG','Bulgaria','Europe/Sofia','https://app.eop.bg/today','Space Research and Technology Institute, BAS','https://www.space.bas.bg/','сателит космически спътников'],
 ['HR','Croatia','Europe/Zagreb','https://eojn.hr/','Ministry of Science, Education and Youth','https://mzom.gov.hr/','satelitski svemirski'],
 ['CY','Cyprus','Asia/Nicosia','https://www.eprocurement.gov.cy/','Deputy Ministry of Research, Innovation and Digital Policy','https://www.gov.cy/dmrid-dec/en/documents/european-space-agency-esa/','δορυφορικ διαστημικ'],
 ['CZ','Czechia','Europe/Prague','https://nen.nipez.cz/en/','Ministry of Transport','https://md.gov.cz/','satelit družic kosmick vesmír'],
 ['DK','Denmark','Europe/Copenhagen','https://udbud.dk/','Danish Agency for Higher Education and Science','https://ufsn.dk/english/research-and-innovation/space-and-denmark/','satellit rumfart jordobservation'],
 ['EE','Estonia','Europe/Tallinn','https://riigihanked.riik.ee/','Estonian Business and Innovation Agency','https://eis.ee/','satelliit kosmos kaugseire'],
 ['FI','Finland','Europe/Helsinki','https://www.hankintailmoitukset.fi/en/','Business Finland','https://www.businessfinland.fi/','satelliitti avaruus kaukokartoitus'],
 ['FR','France','Europe/Paris','https://www.boamp.fr/','CNES','https://marches.cnes.fr/','satellite spatial observation de la Terre télédétection'],
 ['DE','Germany','Europe/Berlin','https://oeffentlichevergabe.de/ui/en','DLR','https://www.dlr.de/en/dlr/about-us/organisation/procurement-and-compliance','Satellit Raumfahrt Erdbeobachtung Weltraum'],
 ['GR','Greece','Europe/Athens','https://portal.eprocurement.gov.gr/','Hellenic Space Center','https://hsc.gov.gr/','δορυφορικ διαστημικ τηλεπισκόπηση'],
 ['HU','Hungary','Europe/Budapest','https://ekr.gov.hu/','Hungarian space programme','https://space.kormany.hu/','műhold űrkutatás távérzékelés'],
 ['IE','Ireland','Europe/Dublin','https://www.etenders.gov.ie/','Enterprise Ireland','https://www.enterprise-ireland.com/en/legal/policies-guidelines/procurement-policy','satellite space earth observation'],
 ['IT','Italy','Europe/Rome','https://www.acquistinretepa.it/','ASI','https://www.asi.it/bandi/bandi-asi/','satellit spazial telerilevamento'],
 ['LV','Latvia','Europe/Riga','https://www.eis.gov.lv/','Latvian space programme','https://latviaspace.gov.lv/en/','satelīt kosmos attālinātā izpēte'],
 ['LT','Lithuania','Europe/Vilnius','https://viesiejipirkimai.lt/','Innovation Agency Lithuania','https://inovacijuagentura.lt/','palydov kosmos nuotolinis stebėjimas'],
 ['LU','Luxembourg','Europe/Luxembourg','https://pmp.b2g.etat.lu/','Luxembourg Space Agency','https://space-agency.public.lu/','satellite spatial Raumfahrt'],
 ['MT','Malta','Europe/Malta','https://www.etenders.gov.mt/','Xjenza Malta','https://xjenzamalta.mt/','satellite space satellita spazju'],
 ['NL','Netherlands','Europe/Amsterdam','https://www.tenderned.nl/','Netherlands Space Agency','https://www.nlsa.nl/en/','satelliet ruimtevaart aardobservatie'],
 ['PL','Poland','Europe/Warsaw','https://ezamowienia.gov.pl/','POLSA procurement','https://platformazakupowa.pl/pn/polsa','satelit kosmiczn teledetekcj'],
 ['PT','Portugal','Europe/Lisbon','https://www.base.gov.pt/base4','Portugal Space','https://ptspace.pt/','satélite espacial deteção remota'],
 ['RO','Romania','Europe/Bucharest','https://www.e-licitatie.ro/pub/','Romanian Space Agency','https://rosa.ro/','satelit spațial teledetecție'],
 ['SK','Slovakia','Europe/Bratislava','https://www.uvo.gov.sk/','Slovak Space Office','https://spaceoffice.sk/','satelit družic kozmick vesmír'],
 ['SI','Slovenia','Europe/Ljubljana','https://www.enarocanje.si/','Slovenian Space Office / Ministry','https://www.gov.si/en/topics/space/','satelit vesolj daljinsko zaznavanje'],
 ['ES','Spain','Europe/Madrid','https://contrataciondelestado.es/wps/portal/plataforma','Spanish Space Agency','https://www.aee.gob.es/','satélite espacial teledetección'],
 ['SE','Sweden','Europe/Stockholm','https://www.kommersannons.se/','Swedish National Space Agency','https://www.rymdstyrelsen.se/','satellit rymd fjärranalys']
];
const agencyRefs={AT:'https://www.ffg.at/en/space',BG:'https://www.space.bas.bg/',HR:'https://mzom.gov.hr/',CY:'https://www.research.org.cy/',DK:'https://ufsn.dk/english/research-and-innovation/space-and-denmark/',LV:'https://latviaspace.gov.lv/en/',LT:'https://inovacijuagentura.lt/',MT:'https://xjenzamalta.mt/',NL:'https://www.nlsa.nl/en/',SK:'https://spaceoffice.sk/',RO:SST,PL:SST};
const sources=countries.flatMap(([country,name,timeZone,portal,agency,url,terms])=>[
 {id:country+'-portal',country,name:name+' national procurement',kind:'national_portal',adapter:({FR:'boamp',ES:'placsp',NL:'tenderned',PL:'bzp'})[country]||'web',url,timeZone,terms,reference:EC,...{url:portal},access:'Public access; runtime report determines collection success'},
 {id:country+'-space',country,name:agency,kind:'space_body',adapter:'web',url,timeZone,terms,reference:agencyRefs[country]||ESA,access:'Public pages; tenders must be distinguished from grants, jobs and news'}
]);
const extra=[
 ['FR-place','FR','French state procurement (PLACE)','https://www.marches-publics.gouv.fr/','national_portal',EC],
 ['IT-inaf','IT','INAF procurement','https://www.inaf.it/it/lavora-con-noi/bandi-di-gara','space_body',SST],
 ['IT-defence','IT','TELEDIFE procurement','https://www.difesa.it/amministrazione-trasparente/segredifesa/teledife/publicprocurement/5130.html','defence_body',SST],
 ['PL-polsa','PL','POLSA','https://polsa.gov.pl/','space_body',ESA],
 ['PT-azores','PT','Azores space mission structure','https://portal.azores.gov.pt/pt/web/ema-espaco','space_body',SST],
 ['LT-legacy','LT','Lithuania procurement notices before December 2024','https://cvpp.eviesiejipirkimai.lt/','national_portal','https://vpt.lrv.lt/en/e-public-procurement/'],
 ['LV-iub','LV','Latvia Procurement Monitoring Bureau','https://www.iub.gov.lv/','national_portal',EC],
 ['SE-eavrop','SE','e-Avrop registered procurement database','https://www.e-avrop.com/','registered_portal','https://www.konkurrensverket.se/upphandling/registrerade-annonsdatabaser/annonsdatabasregistret/'],
 ['SE-mercell','SE','Mercell registered procurement database','https://www.mercell.com/upphandlingar','registered_portal','https://www.konkurrensverket.se/upphandling/registrerade-annonsdatabaser/annonsdatabasregistret/'],
 ['EU-SST','EU','EU SST national-entity procurement','https://www.eusst.eu/about-us/procurement','space_body',SST]
];
for(const [id,country,name,url,kind,reference] of extra){const base=sources.find(s=>s.country===country)||{};sources.push({...base,id,country,name,url,kind,reference,adapter:id==='EU-SST'?'eusst':'web',timeZone:base.timeZone||'Europe/Brussels'});}
for(const s of sources){s.allowedHosts=[new URL(s.url).hostname.replace(/^www\./,'')];s.seeds=[s.url];s.coverage='partial';}
Object.assign(sources.find(s=>s.id==='FR-portal'),{reference:'https://www.boamp.fr/pages/donnees-ouvertes-et-api/'});
Object.assign(sources.find(s=>s.id==='AT-portal'),{adapter:'austria',reference:'https://ausschreibungen.usp.gv.at/at.gv.bmdw.eproc-p/public/tenderlist',access:'Public search API discovered in the official portal, plus individual notice pages.'});
Object.assign(sources.find(s=>s.id==='DE-space'),{adapter:'dlr',url:'https://www.dlr.de/en/dlr/about-us/organisation/procurement-and-compliance/procurement',reference:'https://www.dlr.de/en/dlr/about-us/organisation/procurement-and-compliance/procurement',access:'Public current tender RSS feeds linked directly by DLR.'});
Object.assign(sources.find(s=>s.id==='CY-space'),{reference:'https://www.gov.cy/dmrid-dec/en/documents/european-space-agency-esa/'});
Object.assign(sources.find(s=>s.id==='PL-portal'),{reference:'https://ezamowienia.gov.pl/pl/integracja/',access:'Public BZP API. New-system history starts in 2021; 2020 needs legacy BZP/TED.'});
Object.assign(sources.find(s=>s.id==='NL-portal'),{reference:'https://www.tenderned.nl/cms/nl/aanbesteden-in-cijfers/datasets-aanbestedingen',access:'Public recent RSS. Full XML API requires credentials; historical files can be imported.'});
Object.assign(sources.find(s=>s.id==='ES-portal'),{reference:'https://www.hacienda.gob.es/es-ES/GobiernoAbierto/Datos%20Abiertos/Paginas/LicitacionesContratante.aspx',access:'Public paginated Atom; monthly/yearly Atom archives can be imported.'});
Object.assign(sources.find(s=>s.id==='SE-portal'),{kind:'registered_portal',reference:'https://www.upphandlingsmyndigheten.se/en/about-public-procurement/',access:'Sweden has no single national notice database. Registered commercial databases have partial public access.'});
Object.assign(sources.find(s=>s.id==='DE-portal'),{adapter:'germany',reference:'https://oeffentlichevergabe.de/documentation/swagger-ui/opendata/index.html'});
Object.assign(sources.find(s=>s.id==='FR-space'),{adapter:'atexo'});
Object.assign(sources.find(s=>s.id==='IT-inaf'),{url:'https://inaf.ubuy.cineca.it/PortaleAppalti/it/ppgare_bandi_lista.wp',allowedHosts:['inaf.ubuy.cineca.it'],seeds:['https://inaf.ubuy.cineca.it/PortaleAppalti/it/ppgare_bandi_lista.wp']});
Object.assign(sources.find(s=>s.id==='IT-space'),{adapter:'asi'});
Object.assign(sources.find(s=>s.id==='IT-inaf'),{adapter:'inaf'});
Object.assign(sources.find(s=>s.id==='FR-place'),{adapter:'atexo'});
Object.assign(sources.find(s=>s.id==='ES-space'),{adapter:'aee',reference:'https://www.aee.gob.es/Servicios/PerfilContratante.html'});
Object.assign(sources.find(s=>s.id==='IE-portal'),{adapter:'epps',reference:'https://www.etenders.gov.ie/epps/prepareAdvancedSearch.do?type=cftFTS'});
module.exports={countries,sources};
