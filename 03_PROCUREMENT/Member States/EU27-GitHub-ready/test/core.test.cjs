const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {classify,parseDate,statusOf,normalize,latestRecords}=require('../core.cjs');
const {parseFeed,parseSst,parsePage,parseBzp}=require('../adapters.cjs');
const {sources,countries}=require('../sources.cjs');const {exportData,args}=require('../collect.cjs');
const now=new Date('2026-10-01T10:00:00Z');
test('partial ZIP recovery emits complete XML members and omits a truncated member',async()=>{
 const JSZip=require('jszip'),{recoverPartialArchive}=require('../archives.cjs'),dir=fs.mkdtempSync(path.join(__dirname,'space-collector-test-'));
 try{const zip=new JSZip();const feed=i=>'<feed><entry><id>'+i+'</id><title>Satellite communications</title><ContractFolderStatusCode>PUB</ContractFolderStatusCode></entry></feed>';zip.file('one.atom',feed(1));zip.file('two.atom',feed(2));const bytes=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});const firstEnd=30+bytes.readUInt16LE(26)+bytes.readUInt16LE(28)+bytes.readUInt32LE(18),secondOffset=firstEnd+30+bytes.readUInt16LE(firstEnd+26)+bytes.readUInt16LE(firstEnd+28);const file=path.join(dir,'partial.zip');fs.writeFileSync(file,bytes.subarray(0,secondOffset+3));const rows=[],gaps=[];assert.equal(await recoverPartialArchive(file,{adapter:'placsp'},r=>rows.push(r),g=>gaps.push(g)),1);assert.equal(rows.length,1);assert.equal(rows[0].noticeId,'1');assert(gaps.some(g=>/incomplete ZIP member/.test(g)));}finally{assert(dir.startsWith(path.resolve(__dirname)+path.sep));fs.rmSync(dir,{recursive:true,force:true});}
});
test('German eForms buyer references resolve the buyer rather than the review body',()=>{
 const {parseGerman}=require('../priority.cjs');const xml='<ContractNotice><ID>N1</ID><ContractingParty><Party><PartyIdentification><ID>ORG-B</ID></PartyIdentification></Party></ContractingParty><Organization><Company><PartyIdentification><ID>ORG-R</ID></PartyIdentification><PartyName><Name>Review body</Name></PartyName></Company></Organization><Organization><Company><PartyIdentification><ID>ORG-B</ID></PartyIdentification><PartyName><Name>Space buyer</Name></PartyName></Company></Organization><ProcurementProject><Name>Satellite hardware</Name></ProcurementProject></ContractNotice>';
 assert.equal(parseGerman(xml)[0].buyer,'Space buyer');
});
test('Spanish archive prefilter preserves relevant records and rejects truncated feeds',()=>{
 const {parseArchiveFeed}=require('../archives.cjs');
 const xml='<feed>'+['Satellite communications','Servicios GNSS','Teledetección forestal','Office furniture'].map((title,i)=>'<entry><id>'+i+'</id><title>'+title+'</title><ContractFolderStatusCode>PUB</ContractFolderStatusCode><ProcurementProject><Name>'+title+'</Name></ProcurementProject></entry>').join('')+'</feed>';
 const source={adapter:'placsp'},expected=parseFeed(xml,source).rows.filter(r=>classify(r.title,r.description,r.cpv).relevance!=='unrelated');
 const parsed=parseArchiveFeed(xml,source);assert.equal(parsed.scanned,4);assert.deepEqual(parsed.rows.filter(r=>classify(r.title,r.description,r.cpv).relevance!=='unrelated'),expected);assert.throws(()=>parseArchiveFeed(xml.slice(0,-7),source),/Incomplete/);
});
test('EPPS search rows preserve lifecycle status and genuine notice links',()=>{
 const {parseResults}=require('../epps.cjs');const cells=['1','<a href="/epps/cft/prepareViewCfTWS.do?resourceId=42">Satellite communications</a>','42','Buyer','','01/10/2026','09/10/2026','Open','Awarded'];
 const rows=parseResults('<table id="T01"><tbody><tr>'+cells.map(c=>'<td>'+c+'</td>').join('')+'</tr></tbody></table>','https://www.etenders.gov.ie/');assert.equal(rows[0].sourceStatus,'Awarded');assert.equal(rows[0].sourceUrl,'https://www.etenders.gov.ie/epps/cft/prepareViewCfTWS.do?resourceId=42');assert.equal(classify('Satellite news gathering vehicle','').relevance,'space');
});
test('Dutch historical notices preserve lot scope and lifecycle',()=>{
 const {parseRelease}=require('../netherlands.cjs');
 const r={id:'123',ocid:'ocds-example',date:'2026-01-01T10:00:00Z',tag:['award'],buyer:{name:'Public buyer'},tender:{title:'Mixed satellite and office contract',registrationPeriod:{endDate:'2026-11-01T12:00:00+01:00'},lots:[{id:'1',title:'Desks',description:'Office furniture'},{id:'2',title:'Satellite modem',description:'Satellite communications'}]}};
 const rows=parseRelease(r);assert.equal(rows.length,2);assert.equal(rows[0].description,'Office furniture');assert.equal(rows[1].procedureId,'ocds-example|2');assert.equal(rows[1].noticeType,'award');assert.equal(statusOf(rows[1],now)[0],'awarded');
 assert.equal(parseRelease({...r,tag:['tenderCancellation']})[0].sourceStatus,'cancelled');
});
test('INAF search forms are not notices and encoded detail URLs retain their procurement stage',()=>{
 const {parseInaf}=require('../italy.cjs');
 const html='<body>Sezione Dati generali Titolo : Satellite laser tracker - CIG X Tipologia appalto Forniture Indagine di mercato Data scadenza : 02/10/2026 entro le 12:00 Sezione Documentazione</body>';
 assert.equal(parseInaf(html,'https://inaf.ubuy.cineca.it/PortaleAppalti/it/ppgare_bandi_lista.wp'),null);
 const base='https://inaf.ubuy.cineca.it/PortaleAppalti/it/ppgare_bandi_lista.wp?codice=G03227&actionPath=';
 const r=parseInaf(html,base+encodeURIComponent('/ExtStr2/do/FrontEnd/Bandi/view.action'));
 assert.equal(r.noticeId,'G03227');assert.equal(r.deadlineRaw,'02/10/2026 12:00');assert.equal(r.noticeType,'planning');
 assert.equal(parseInaf(html,base+encodeURIComponent('/ExtStr2/do/FrontEnd/Esiti/view.action')).noticeType,'award');
});
test('orbital welding and inflected agency names do not create space relevance',()=>{
 assert.equal(classify('Rohrleitungen orbital geschweißt','').relevance,'unrelated');
 assert.equal(classify('Wetterdrohne','Beschaffung des Deutschen Zentrums für Luft- und Raumfahrt').relevance,'unrelated');
 assert.equal(classify('Nanosatellitenprojekt','').relevance,'space');
});
test('Italian and Spanish closed statuses override a future deadline',()=>{
 const r={noticeType:'tender',noticeVerified:true,deadlineRaw:'2026-11-01',timeZone:'Europe/Rome'};
 for(const sourceStatus of ['Scaduto','Evaluación','Cerrada'])assert.equal(statusOf({...r,sourceStatus},now)[0],'closed');
 for(const sourceStatus of ['Aggiudicato','Resuelta'])assert.equal(statusOf({...r,sourceStatus},now)[0],'awarded');
});
test('German lots keep separate descriptions and submission deadlines',()=>{
 const {parseGerman}=require('../priority.cjs');
 const rows=parseGerman('<ContractNotice><ID>n1</ID><ContractFolderID>p1</ContractFolderID><NoticeTypeCode>cn-standard</NoticeTypeCode><ProcurementProject><Name>Mixed procurement</Name><Description>Satellite and office equipment</Description></ProcurementProject><ProcurementProjectLot><ID>LOT-1</ID><ProcurementProject><Name>Office desks</Name><Description>Furniture</Description></ProcurementProject><TenderSubmissionDeadlinePeriod><EndDate>2026-10-09+02:00</EndDate><EndTime>12:00:00+02:00</EndTime></TenderSubmissionDeadlinePeriod></ProcurementProjectLot></ContractNotice>');
 assert.equal(rows[0].description,'Furniture');assert.equal(rows[0].title,'Office desks');assert.equal(rows[0].procedureId,'p1|LOT-1');assert.equal(rows[0].deadlineRaw,'2026-10-09T12:00:00+02:00');
});
test('French space transport and DLR name variants are distinguished',()=>{
 assert.equal(classify('Transport spatial cryogenique','').relevance,'space');
 assert.equal(classify('FAST LTA products','Das Deutsche Zentrum fur Luft und Raumfahrt').relevance,'unrelated');
});
test('audited live false positives are excluded from confirmed space',()=>{
 assert.equal(classify('Proteómica y espectrómetros de masas','').relevance,'unrelated');
 assert.equal(classify('Supply of an excavator','').relevance,'unrelated');
 assert.notEqual(classify('Acquisition transcriptomique spatiale in-situ par imagerie','').relevance,'space');
 assert.notEqual(classify('ZAKUP KOPARKO-LADOWARKI','system nawigacji satelitarnej').relevance,'space');
 assert.equal(classify('Exhibicion drones luminosos','','60440000').relevance,'unrelated');
 assert.equal(classify('Satellite communications service','','32530000').relevance,'space');
});
test('all 27 EU countries have a portal and space-body source',()=>{assert.equal(countries.length,27);assert.equal(new Set(countries.map(c=>c[0])).size,27);for(const [c] of countries){assert(sources.some(s=>s.country===c&&/portal/.test(s.kind)));assert(sources.some(s=>s.country===c&&s.kind==='space_body'));}});
test('space and defence need separate evidence; ordinary defence is not automatically space',()=>{assert.equal(classify('Satellite military communications','').relevance,'space');assert(classify('Satellite military communications','').defenceEvidence);assert.equal(classify('Military boots and uniforms','').relevance,'unrelated');assert.equal(classify('Forest monitoring','').relevance,'possible_space');assert.equal(classify('Δορυφορικές επικοινωνίες','').relevance,'space');assert.equal(classify('Космически спътник','').relevance,'space');assert.equal(classify('Equipment','','32530000').relevance,'space');});
test('real lexical false positives stay out of confirmed space results',()=>{assert.notEqual(classify('Livraison de repas pour restaurants satellites','').relevance,'space');assert.notEqual(classify('Transcriptomique spatiale','').relevance,'space');assert.equal(classify('Środki do dezynfekcji','kosmetyki').relevance,'unrelated');assert.equal(classify('Budowa strażnicy','Kozminskiego').relevance,'unrelated');});
test('a space-agency buyer alone does not make office procurement space technology',()=>{assert.equal(classify('Geldtransporte für Kantinen','Auftraggeber Deutsches Zentrum für Luft- und Raumfahrt e.V.').relevance,'unrelated');const r=normalize({title:'Office cleaning',noticeVerified:true,noticeType:'tender'},sources.find(s=>s.id==='DE-space'),'raw.json',now);assert.equal(r.relevance,'possible_space');});
test('local European deadlines are converted without using host timezone',()=>{assert.equal(parseDate('09/10/2026 12:00','Europe/Vienna').iso,'2026-10-09T10:00:00.000Z');assert.equal(parseDate('2026-12-09T12:00:00','Europe/Vienna').iso,'2026-12-09T11:00:00.000Z');assert.equal(parseDate('2026-02-31').precision,'invalid');assert.equal(parseDate('not provided').precision,'unparsed');});
test('only dated verified tenders are open; award, cancellation and planning override future dates',()=>{const r={noticeType:'tender',noticeVerified:true,deadlineRaw:'2026-10-09',timeZone:'Europe/Vienna'};assert.equal(statusOf(r,now)[0],'open');assert.equal(statusOf({...r,sourceStatus:'cancelled'},now)[0],'cancelled');assert.equal(statusOf({...r,noticeType:'award'},now)[0],'awarded');assert.equal(statusOf({...r,noticeType:'planning'},now)[0],'planned');assert.equal(statusOf({...r,deadlineRaw:'2026-10-01'},now)[0],'deadline_today_check_time');assert.equal(statusOf({...r,deadlineRaw:'2026-09-30'},now)[0],'closed');assert.equal(statusOf({...r,noticeVerified:false},now)[0],'unknown');assert.equal(statusOf({...r,deadlineRaw:''},now)[0],'unknown');});
test('a later award supersedes a tender only within the same source and procedure',()=>{const a={sourceId:'A',procedureId:'1',publicationDate:'2026-09-01',status:'open'},b={...a,publicationDate:'2026-09-10',status:'awarded'},c={...a,sourceId:'B'};assert.deepEqual(latestRecords([a,b,c]),[b,c]);});
test('namespace-independent Atom parses deadline and pagination',()=>{const xml='<feed xmlns="a"><link rel="next" href="https://example.test/p2"/><entry><id>id1</id><title>Satellite service</title><link href="https://example.test/1"/><updated>2026-10-01</updated><c:ContractFolderStatusCode xmlns:c="c">PUB</c:ContractFolderStatusCode><c:TenderSubmissionDeadlinePeriod xmlns:c="c"><c:EndDate>2026-10-09</c:EndDate><c:EndTime>12:00:00</c:EndTime></c:TenderSubmissionDeadlinePeriod></entry></feed>';const d=parseFeed(xml,{adapter:'placsp'});assert.equal(d.rows.length,1);assert.equal(d.rows[0].deadlineRaw,'2026-10-09T12:00:00');assert.equal(d.next,'https://example.test/p2');assert.equal(d.rows[0].noticeType,'tender');});
test('EU SST prior information is not a bidding opportunity',()=>{const html='<table><tr><th>Title</th><th>Description</th><th>Submission deadline</th><th>More</th></tr><tr><td>Prior Information Notice – Space traffic</td><td>EU SST services</td><td>09/10/2026 12:00 Europe/Vienna</td><td><a href="https://example.test/1">Notice</a></td></tr></table>';const [r]=parseSst(html);assert.equal(r.noticeType,'planning');assert.equal(r.timeZone,'Europe/Vienna');assert.equal(statusOf(r,now)[0],'planned');});
test('generic pages cannot become verified open tenders just by containing a deadline',()=>{const {row}=parsePage('<h1>Satellite tender news</h1><main>Submission deadline: 2026-10-09</main>','https://example.test/news',{});assert.equal(row.noticeVerified,false);assert.equal(statusOf(row,now)[0],'unknown');});
test('EPPS extracts submission deadline rather than clarification deadline',()=>{const html='<dl><dt>Title:</dt><dd>Satellite communications</dd><dt>Description:</dt><dd>Satellite capacity</dd><dt>End of clarification period:</dt><dd>01/09/2026 12:00</dd><dt>Time-limit for receipt of tenders or requests to participate:</dt><dd>09/10/2026 12:00</dd><dt>Date of Publication/Invitation:</dt><dd>30/09/2026 14:00</dd></dl>';const {row}=parsePage(html,'https://www.etenders.gov.ie/epps/cft/prepareViewCfTWS.do?resourceId=42',{timeZone:'Europe/Dublin'});assert.equal(row.deadlineRaw,'09/10/2026 12:00');assert.equal(row.publicationDate,'2026-09-30');assert.equal(row.noticeVerified,true);assert.equal(row.procedureId,'42');});
test('HTML error pages cannot silently pass as empty feeds',()=>{assert.throws(()=>parseFeed('<html><body>Access denied</body></html>',{adapter:'placsp'}),/not an Atom/);});
test('Polish result notices keep procedure ID for lifecycle consolidation',()=>{const r=parseBzp({noticeType:'TenderResultNotice',objectId:'n1',tenderId:'p1',orderObject:'Satellite',htmlBody:'<p>contract</p>'});assert.equal(r.noticeType,'award');assert.equal(r.procedureId,'p1');});
test('BZP follows documented SearchAfter cursor and never invents page numbers',async()=>{const {bzp}=require('../adapters.cjs');const urls=[];await bzp({options:{from:'2026-10-01',to:'2026-10-01'},canFetch:()=>urls.length<2,gap:()=>{},emit:()=>{},get:async u=>{urls.push(u);return {body:JSON.stringify(Array.from({length:100},(_,i)=>({objectId:'id'+i,noticeType:'ContractNotice'}))),rawFile:'raw.json'};}}).catch(e=>{assert.match(e.message,/repeated page/);});assert.equal(new URL(urls[1]).searchParams.get('SearchAfter'),'id99');assert.equal(new URL(urls[1]).searchParams.has('PageNumber'),false);});
test('Excel and UTF8 JSONL share all normalized fields',async()=>{const dir=fs.mkdtempSync(path.join(__dirname,'space-collector-test-'));try{const row=normalize({noticeId:'one',sourceUrl:'https://example.test/1',title:'Δορυφορική υπηρεσία – műhold',description:'Satellite communications',publicationDate:'2026-09-30',deadlineRaw:'2026-10-09',noticeType:'tender',noticeVerified:true},sources[0],'raw/1.txt',now);const report=await exportData(dir,[row],[],now);assert.equal(report.counts.OPEN,1);assert(report.excelJsonlFieldsCompared>100);const open=JSON.parse(fs.readFileSync(report.files.find(f=>f.endsWith('_OPEN.jsonl')),'utf8'));assert.equal(open.title,row.title);}finally{assert(dir.startsWith(path.resolve(__dirname)+path.sep));fs.rmSync(dir,{recursive:true,force:true});}});
test('CLI rejects unsupported options and invalid history range',()=>{assert.throws(()=>args(['--from=2019-01-01']));assert.throws(()=>args(['--sources']));assert.throws(()=>args(['--unexpected=yes']));});
