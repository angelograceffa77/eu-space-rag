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
for(const [id,adapter] of Object.entries({'FI-portal':'hilma','EE-portal':'estonia','BE-portal':'belgium','RO-portal':'romania'}))Object.assign(sources.find(s=>s.id===id),{adapter});
for(const [id,adapter] of Object.entries({'CZ-portal':'czech','DK-portal':'denmark','HU-portal':'hungary','GR-portal':'greece'}))Object.assign(sources.find(s=>s.id===id),{adapter});
for(const [id,adapter] of Object.entries({"LV-portal":"latvia","PL-portal":"polandSearch"}))Object.assign(sources.find(s=>s.id===id),{adapter});
for(const [id,adapter] of Object.entries({'BG-portal':'bulgaria','HR-portal':'croatia'}))Object.assign(sources.find(s=>s.id===id),{adapter});
for(const [id,adapter] of Object.entries({'SI-portal':'slovenia','IT-portal':'consip','LU-portal':'luxembourg','CY-portal':'eppsLatest','MT-portal':'eppsLatest','LT-portal':'epps'}))Object.assign(sources.find(s=>s.id===id),{adapter});
for(const [id,adapter] of Object.entries({"PT-portal":"portugal","SK-portal":"slovakia","SE-eavrop":"sweden"}))Object.assign(sources.find(s=>s.id===id),{adapter});
Object.assign(sources.find(s=>s.id==="PT-portal"),{adapter:"portugalOpenData",reference:"https://dados.gov.pt/pt/organizations/impic-i-p-instituto-dos-mercados-publicos-do/"});
Object.assign(sources.find(s=>s.id==="PT-space"),{adapter:"portugalSpace"});
Object.assign(sources.find(s=>s.id==="PT-azores"),{url:"https://spaceazores.pt/",allowedHosts:["spaceazores.pt"],seeds:["https://spaceazores.pt/"]});
sources.push({...sources.find(s=>s.id==="CY-portal"),id:"CY-awards",name:"Cyprus Treasury annual awarded-contract exports",adapter:"cyprusAwards",url:"https://www.data.gov.cy/index.php/el/dataset/katalogos-dimosion-symbaseon-poy-katakyrothikan",reference:"https://www.data.gov.cy/index.php/el/dataset/katalogos-dimosion-symbaseon-poy-katakyrothikan"});
Object.assign(sources.find(s=>s.id==="CY-portal"),{adapter:"cyprusBuyers"});
Object.assign(sources.find(s=>s.id==="CY-space"),{adapter:"cyprusBuyers",name:"Cyprus Department of Electronic Communications procurement",url:"https://www.eprocurement.gov.cy/epps/prepareViewCAOrganisation.do?id=1658",seeds:["https://www.eprocurement.gov.cy/epps/prepareViewCAOrganisation.do?id=1658"],allowedHosts:["www.eprocurement.gov.cy"],reference:"https://www.gov.cy/dmrid-dec/en/documents/national-space-strategy/"});
Object.assign(sources.find(s=>s.id==="MT-portal"),{adapter:"eppsBuyers"});
Object.assign(sources.find(s=>s.id==="MT-space"),{adapter:"maltaSpace",reference:"https://xjenzamalta.mt/services/space/"});
module.exports={countries,sources};
Object.assign(sources.find(s=>s.id==='IT-defence'),{adapter:'teledife',url:'https://www.difesa.it/dna/staff/dt/teledife/amministrazione-trasparente/25270.html'});
sources.push({...sources.find(s=>s.id==='IT-space'),id:'IT-suppliers',name:'ASI public supplier portal',adapter:'asiSuppliers',url:'https://app.albofornitori.it/alboeproc/albo_asi',allowedHosts:['app.albofornitori.it'],reference:'https://www.asi.it/bandi-/'});
sources.push({...sources.find(s=>s.id==='IT-portal'),id:'IT-mepa',name:'MePA public RDOs and Altri Bandi',adapter:'mepa',url:'https://www.acquistinretepa.it/opencms/opencms/vetrina_bandi.html?filter=RDO',reference:'https://www.acquistinretepa.it/opencms/opencms/vetrina_bandi.html'});
Object.assign(sources.find(s=>s.id==='SE-portal'),{adapter:'kommers'});
Object.assign(sources.find(s=>s.id==='SE-mercell'),{adapter:'mercellPublic',url:'https://app.mercell.com/search?filter=delivery_place_code%3ASE'});

Object.assign(sources.find(s=>s.id==='SE-space'),{adapter:'swedenSpace'});

sources.push({...sources.find(s=>s.id==='NL-portal'),id:'NL-public',name:'TenderNed public TNS notice service',adapter:'dutchPublic',url:'https://www.tenderned.nl/papi/tenderned-rs-tns/v2/publicaties',reference:'https://data.overheid.nl/dataset/aankondigingen-van-overheidsopdrachten---tenderned'});

Object.assign(sources.find(s=>s.id==='NL-space'),{adapter:'dutchSpace'});

sources.push({...sources.find(s=>s.id==='ES-portal'),id:'ES-public',name:'PLACSP public historical procurement search',adapter:'placspSearch',reference:'https://contrataciondelestado.es/wps/portal/licitaciones'});

sources.push({...sources.find(s=>s.id==='ES-portal'),id:'ES-monthly',name:'PLACSP current-month official archive',adapter:'placspMonthly'});
sources.push({...sources.find(s=>s.id==='ES-portal'),id:'ES-documents',name:'PLACSP public document metadata search',adapter:'placspDocuments',reference:'https://contrataciondelestado.es/wps/portal/AyudaBuscadorDocumental'});
sources.push({...sources.find(s=>s.id==='ES-portal'),id:'ES-Catalonia',name:'Catalonia official PSCP open data',adapter:'catalonia',url:'https://contractaciopublica.cat/',reference:'https://analisi.transparenciacatalunya.cat/d/ybgg-dgi6'});

sources.push({...sources.find(s=>s.id==='ES-portal'),id:'ES-agencies',name:'Spanish space and astronomy bodies current notices',adapter:'placspSearch',reference:'https://contrataciondelestado.es/wps/portal/licitaciones'});

sources.push({...sources.find(s=>s.id==='DE-portal'),id:'DE-live',name:'German public live competition search',adapter:'germanLive'});

Object.assign(sources.find(s=>s.id==='DE-space'),{adapter:'dlrDetailed'});

sources.push({...sources.find(s=>s.id==='DE-live'),id:'DE-cpv',name:'German public live space-category competition search'});

sources.push({...sources.find(s=>s.id==='IE-portal'),id:'IE-archive',name:'OGP official historical procurement open data',adapter:'irishArchive',url:'https://data.gov.ie/dataset/contract-notices-published-on-etenders',reference:'https://data.gov.ie/dataset/contract-notices-published-on-etenders'});

for(const id of ['IE-portal','IE-space'])Object.assign(sources.find(s=>s.id===id),{adapter:'irishPublic'});

sources.push({...sources.find(s=>s.id==='IE-portal'),id:'IE-cpv',name:'Irish live space and astronomy procurement categories'});

Object.assign(sources.find(s=>s.id==='PL-space'),{adapter:'polsaPublic',url:'https://platformazakupowa.pl/pn/polsa/proceedings'});

sources.push({...sources.find(s=>s.id==='PL-portal'),id:'PL-public',name:'Polish public BZP and TED Board search',adapter:'polandBoard'});

sources.push({...sources.find(s=>s.id==='PL-public'),id:'PL-legacy',name:'Polish public legacy-law BZP mirror',url:'https://ezamowienia.gov.pl/bzp-archival-client'});

sources.push({...sources.find(s=>s.id==='PL-space'),id:'PL-CBK',name:'CBK PAN public procurement',adapter:'cbkPublic',url:'https://cbkpan.ezamawiajacy.pl/',reference:'https://cbkpan.pl/o-nas/zamowienia-publiczne/'});

Object.assign(sources.find(s=>s.id==='PL-polsa'),{adapter:'polsaDirectory'});
for(const id of ['LT-portal','LT-space'])Object.assign(sources.find(s=>s.id===id),{adapter:'lithuaniaPublic'});
sources.push({...sources.find(s=>s.id==='LT-portal'),id:'LT-cpv',name:'Lithuanian public space procurement categories'});

Object.assign(sources.find(s=>s.id==='LT-legacy'),{adapter:'lithuaniaLegacy'});

sources.push({...sources.find(s=>s.id==='LT-space'),id:'LT-agency',name:'Innovation Agency pre-commercial procurements',adapter:'lithuaniaAgency'});

Object.assign(sources.find(s=>s.id==='DK-portal'),{adapter:'danishPublic'});
sources.push({...sources.find(s=>s.id==='DK-portal'),id:'DK-cpv',name:'Danish public space procurement categories'});
sources.push({...sources.find(s=>s.id==='DK-portal'),id:'DK-buyers',name:'DTU national buyer procurement notices'});
sources.push({...sources.find(s=>s.id==='DK-portal'),id:'DK-archive',name:'Danish official 2022–2024 below-threshold archive',adapter:'danishArchive'});

sources.push({...sources.find(s=>s.id==='DK-space'),id:'DK-DTU',name:'DTU Space Swarm DISC procurements',adapter:'danishSwarm',url:'https://www.space.dtu.dk/english/research-divisions/geomagnetism-and-geospace/projects/swarm/swarm-disc-invitations-to-tender'});

Object.assign(sources.find(s=>s.id==='DK-space'),{adapter:'danishAgency',url:'https://ufsn.dk/forskning-og-innovation/rumomraadet/aktuelt/opslag/aktuelle-opslag/'});

Object.assign(sources.find(s=>s.id==='DK-buyers'),{name:'Danish DTU, DMI and climate-data buyer notices'});

Object.assign(sources.find(s=>s.id==='BE-portal'),{adapter:'belgianPublic'});
sources.push({...sources.find(s=>s.id==='BE-portal'),id:'BE-cpv',name:'Belgian space procurement categories'});
sources.push({...sources.find(s=>s.id==='BE-portal'),id:'BE-buyers',name:'Belgian space, astronomy and Earth-observation buyers'});

Object.assign(sources.find(s=>s.id==='BE-space'),{adapter:'belgianAgency'});

Object.assign(sources.find(s=>s.id==='BG-portal'),{adapter:'bulgarianPublic'});
sources.push({...sources.find(s=>s.id==='BG-portal'),id:'BG-cpv',name:'Bulgarian space procurement categories'});
sources.push({...sources.find(s=>s.id==='BG-portal'),id:'BG-buyers',name:'Bulgarian space and astronomy institute buyers',kind:'space_body'});

Object.assign(sources.find(s=>s.id==='BG-space'),{adapter:'bulgarianAgency',url:'http://www.space.bas.bg/bg/procurement/procurement.html'});
sources.push({...sources.find(s=>s.id==='BG-portal'),id:'BG-legacy',name:'Bulgarian pre-CAIS public register export',adapter:'bulgarianLegacy',url:'https://www.aop.bg/esearch_cases_from_to.php'});

sources.push({...sources.find(s=>s.id==='BG-portal'),id:'BG-open',name:'Bulgarian complete current-open register screening'});

sources.push({...sources.find(s=>s.id==='HR-portal'),id:'HR-archive',name:'Croatian legacy EOJN monthly XML archive',adapter:'croatianArchive',url:'https://eojn.nn.hr/SPIN/application/ipn/Oglasnik/PreuzimanjeObavijesti.aspx'});

Object.assign(sources.find(s=>s.id==='HR-portal'),{adapter:'croatianPublic'});
for(const [id,name]of [['HR-cpv','Croatian space procurement categories'],['HR-buyers','Croatian space, geodesy and research buyers'],['HR-open','Croatian complete published and invitation-stage procedure screening']])sources.push({...sources.find(s=>s.id==='HR-portal'),id,name});

Object.assign(sources.find(s=>s.id==='HR-space'),{adapter:'croatianAgency',url:'https://mzom.gov.hr/pristup-informacijama/javna-nabava/92'});

Object.assign(sources.find(s=>s.id==='LV-iub'),{adapter:'latvianArchive',url:'https://open.iub.gov.lv/data'});

Object.assign(sources.find(s=>s.id==='LV-portal'),{adapter:'latvianPublic'});
for(const [id,name]of [['LV-open','Latvian full announced-procedure screening'],['LV-buyers','Latvian space, science and geospatial buyer searches']])sources.push({...sources.find(s=>s.id==='LV-portal'),id,name});

Object.assign(sources.find(s=>s.id==='LV-space'),{adapter:'latvianAgency',url:'https://www.izm.gov.lv/lv/iepirkumi'});

sources.push({...sources.find(s=>s.id==='CZ-portal'),id:'CZ-rvz',name:'Czech official RVZ and historical VVZ open data',adapter:'czechArchive',url:'https://isvz.nipez.cz/opendata'});

Object.assign(sources.find(s=>s.id==='CZ-portal'),{adapter:'czechPublic'});
Object.assign(sources.find(s=>s.id==='CZ-space'),{adapter:'czechPublic',url:'https://nen.nipez.cz/en/profily-zadavatelu-platne/detail-profilu/mdcr'});

sources.push({...sources.find(s=>s.id==='CZ-portal'),id:'CZ-research',name:'Czech astronomy and Earth-observation research buyer profiles',adapter:'czechAgency',url:'https://www.vhodne-uverejneni.cz/profil/67985815'});
sources.push({...sources.find(s=>s.id==='CZ-portal'),id:'CZ-ufa',name:'Czech Institute of Atmospheric Physics procurement profile',adapter:'czechUfa',url:'https://www.e-zakazky.cz/profil-zadavatele/f56f00fb-93a2-4453-9863-6aaca1b48c5f'});

sources.push({...sources.find(s=>s.id==='CZ-portal'),id:'CZ-cenia',name:'CENIA current NEN procurement profile',adapter:'czechPublic',url:'https://nen.nipez.cz/profil/CENIA'});

sources.push({...sources.find(s=>s.id==='CZ-portal'),id:'CZ-description',name:'Czech NEN subject-description searches',adapter:'czechPublic',url:'https://nen.nipez.cz/en/verejne-zakazky'});

Object.assign(sources.find(s=>s.id==="SK-space"),{adapter:"slovakiaUvo",name:"Slovak space-related institutions — UVO procurement",url:"https://www.uvo.gov.sk/vyhladavanie/vyhladavanie-zakaziek",kind:"national_portal"});
sources.push({...sources.find(s=>s.id==="SK-portal"),id:"SK-uvo",adapter:"slovakiaUvo",name:"Slovakia UVO procedure register and notice histories",url:"https://www.uvo.gov.sk/vyhladavanie/vyhladavanie-zakaziek"});

sources.push({...sources.find(s=>s.id==="SK-space"),id:"SK-astronomy",adapter:"slovakiaAstronomy",kind:"space_body",name:"Slovak Astronomical Institute public procurement register",url:"https://www.astro.sk/rozne/verejne-obstaravanie/zmluvy-zakazky/zakazky/"});

sources.push({...sources.find(s=>s.id==="SK-uvo"),id:"SK-archives",adapter:"slovakiaArchives",name:"Slovakia official procurement bulletin open data",url:"https://data.slovensko.sk/",reference:"https://data.slovensko.sk/datasety"});

sources.push({...sources.find(s=>s.id==="SK-uvo"),id:"SK-live",name:"Slovakia archive-discovered live procedure checks"});

sources.push({...sources.find(s=>s.id==="SK-space"),id:"SK-sario",name:"SARIO and Slovak Space Office procurement pages",adapter:"slovakiaSario",url:"https://www.sario.sk/sk/o-nas/verejne-obstaravanie"});

sources.push({...sources.find(s=>s.id==="SK-uvo"),id:"SK-fallback",adapter:"slovakiaFallback",name:"Slovakia unavailable archive HTML fallback"});

Object.assign(sources.find(s=>s.id==="SK-portal"),{url:"https://evo.isepvo.sk/evoportal/en-us/public/ordersearch/index"});

// Romania expanded source registration.
Object.assign(sources.find(s=>s.id==='RO-portal'),{adapter:'romaniaEnhanced'});
Object.assign(sources.find(s=>s.id==='RO-space'),{adapter:'romaniaRosa',reference:'https://rosa.ro/'});
sources.push({...sources.find(s=>s.id==='RO-portal'),id:'RO-advertisements',name:'Romania SEAP public advertisements',adapter:'romaniaAdvertisements',url:'https://www.e-licitatie.ro/pub/adv-notices/list/1'});
sources.push({...sources.find(s=>s.id==='RO-portal'),id:'RO-archives',name:'Romania ADR official procurement archives',adapter:'romaniaArchives',url:'https://data.gov.ro/'});

// Austria expanded national and FFG source collection.
Object.assign(sources.find(s=>s.id==='AT-portal'),{adapter:'austriaEnhanced'});
Object.assign(sources.find(s=>s.id==='AT-space'),{adapter:'austriaAgency',url:'https://www.ffg.at/weltraum'});

sources.push({...sources.find(s=>s.id==='IT-portal'),id:'IT-anac',name:'Italy ANAC national legal-publication portal',adapter:'italyAnac',url:'https://pubblicitalegale.anticorruzione.it/bandi'});

sources.push({...sources.find(s=>s.id==="CY-portal"),id:"CY-published",name:"Cyprus all-buyer published-notice catalogue",adapter:"cyprusPublished",url:"https://www.eprocurement.gov.cy/epps/notices/viewPublishedNotices.do",reference:"https://www.eprocurement.gov.cy/epps/notices/viewPublishedNotices.do"});
sources.push({...sources.find(s=>s.id==='CY-published'),id:'CY-published-created',name:'Cyprus all-buyer catalogue creation-date reconciliation',sortField:'dateCreated'});

sources.push({...sources.find(s=>s.id==="MT-portal"),id:"MT-published",name:"Malta all-buyer published-notice catalogue",adapter:"cyprusPublished",url:"https://www.etenders.gov.mt/epps/notices/viewPublishedNotices.do",reference:"https://www.etenders.gov.mt/epps/notices/viewPublishedNotices.do"});
sources.push({...sources.find(s=>s.id==="MT-published"),id:"MT-published-created",name:"Malta all-buyer creation-date reconciliation",sortField:"dateCreated"});

for(const [id,name,url,adapter] of [["SE-clira","Clira public procurement catalogue","https://public.clira.io/upphandling","cliraPublic"],["SE-konstpool","Konstpool public procurement calls","https://konstpool.se/sv/","konstpoolPublic"]])sources.push({...sources.find(s=>s.id==="SE-portal"),id,name,url,adapter,reference:"https://www.konkurrensverket.se/upphandling/registrerade-annonsdatabaser/annonsdatabasregistret/"});

Object.assign(sources.find(s=>s.id==="SE-eavrop"),{adapter:"swedenDetailed"});

sources.push({...sources.find(s=>s.id==='PL-CBK'),id:'PL-CBK-archive',name:'CBK PAN historical SmartPZP profile',adapter:'cbkArchive',url:'https://portal.smartpzp.pl/cbkpan/',reference:'https://cbkpan.pl/o-nas/zamowienia-publiczne/'});

sources.push({...sources.find(s=>s.id==='PL-CBK'),id:'PL-CBK-documents',name:'CBK PAN recovered historical documents',adapter:'cbkHistoricalDocuments',url:'https://cbkpan.pl/o-nas/zamowienia-publiczne/'});

sources.push({...sources.find(s=>s.id==='IT-inaf'),id:'IT-INAF-Rome-history',name:'INAF Rome historical procurement disclosures',adapter:'inafRomeArchive',url:'https://www.oa-roma.inaf.it/bandi-di-gara/'});

sources.push({...sources.find(s=>s.id==='IT-inaf'),id:'IT-INAF-Arcetri-history',name:'INAF Arcetri historical procurement disclosures',adapter:'inafArcetriArchive',url:'https://www.arcetri.inaf.it/articoli/amministrazione-trasparente/informazionitabellariannualisuproceduredigaraecontratti'});

sources.push({...sources.find(s=>s.id==='IT-inaf'),id:'IT-INAF-IAPS-history',name:'INAF IAPS public procurement directory',adapter:'inafIapsHistory',url:'https://www.iaps.inaf.it/index.php/it/amministrazione-trasparente/bandi-di-gara'});

sources.push({...sources.find(s=>s.id==='IT-inaf'),id:'IT-INAF-Capodimonte-history',name:'INAF Capodimonte historical procurement documents',adapter:'inafCapodimonteHistory',url:'https://www.oacn.inaf.it/uffici-e-servizi-generali/amministrazione-trasparente-archivio/'});

// Each institutional supplement cites its own official directory.
for(const s of sources.filter(s=>/^IT-INAF-(Rome|Arcetri|IAPS|Capodimonte)-history$/.test(s.id)))s.reference=s.url;

sources.push({...sources.find(s=>s.id==='IT-INAF-IAPS-history'),id:'IT-INAF-IAPS-annual',name:'INAF IAPS annual contract disclosures',adapter:'inafIapsAnnual'});
