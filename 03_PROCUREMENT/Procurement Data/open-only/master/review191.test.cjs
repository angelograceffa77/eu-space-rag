'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{parseNative}=require('./native.cjs'),{project,classify}=require('./relevance.cjs');
const now='2026-10-20T14:00:00Z',receipt={checkedAt:now};
const fi={id:'EF-59686',contractFolderId:'procedure-1',titleFi:'Hyperspectral camera',descriptionFi:'Required GNSS and IMU for georeferencing',organisationNameFi:'University',deadline:'2026-10-30T10:00:00Z',isCancelled:false,mainType:'ContractNotices',isPlan:false,linkedNotices:null,lots:[{}],includesDynamicPurcharingSystem:false};
function fin(o=fi,count=1){return parseNative(JSON.stringify({'@odata.count':count,value:[o]}),project({job:'national-FI-open',original:fi}),receipt,now);}
test('Finnish exact-identity open notice is parsed',()=>{assert.equal(fin().verified,true);assert.equal(fin().status,'open');assert.equal(classify(project({job:'national-FI-open',original:fi})).decision,'space');});
test('Finnish mismatched identity cannot verify',()=>assert.equal(fin({...fi,id:'EF-OTHER'}).verified,false));
test('Finnish cancelled and changed notices are not open',()=>{assert.equal(fin({...fi,isCancelled:true}).status,'cancelled');assert.notEqual(fin({...fi,linkedNotices:['change']}).status,'open');assert.notEqual(fin(fi,2).status,'open');});
const si={id:1203716,idDosje:688396,naslov:'GNSS equipment',kratekOpis:'Equipment',referencnaStevilka:'ref',datumDoPonudba:'2026-10-29T10:00:00',obrazecStatusNaziv:'Objavljen',idSifPostopekFaza:3,elektronskaPredlozitevURL:'https://example.test/bid',obrazecSklop:[{id:3,naslov:'Brezpilotni letalnik'},{id:4,naslov:'Strežnik za GNSS službo'}]};
function sl(o=si){return parseNative(JSON.stringify(o),project({job:'national-SI-open',original:{idObrazec:1203716,idDosje:688396}}),receipt,now);}
test('Slovenian common deadline and separate lots preserved',()=>{let v=sl();assert.equal(v.verified,true);assert.equal(v.lots.length,2);assert.equal(v.deadline.value,'2026-10-29T09:00:00.000Z');assert.equal(v.lots[0].deadline.value,v.deadline.value);});
test('Slovenian corrected and awarded notices held out',()=>{assert.notEqual(sl({...si,popravljenSPopravkom:'correction'}).status,'open');assert.notEqual(sl({...si,obrazecOddaja:[{}]}).status,'open');assert.equal(sl({...si,id:1}).verified,false);});
test('Generic drone lot is not admitted without document scope',()=>{let p=project({job:'national-SI-open',original:{naslov:'Brezpilotni letalnik'}});assert.notEqual(classify(p).decision,'space');p.description='Podpora sistemom Galileo, GPS, BeiDou in GLONASS ali primerljivim GNSS-sistemom';p.fields.push({field:'description',text:p.description});assert.equal(classify(p).decision,'space');});
test('Danish award and planning stages are retained',()=>{for(let stage of ['result','preplanning','cont-modif'])assert.equal(project({job:'national-DK-open',original:{dataEn:{titel:'GNSS',formulartypeKode:stage}}}).stage,stage);});
const fr={idweb:'26-101039',nomacheteur:'Buyer',nature:'APPEL_OFFRE',etat:'INITIAL',donnees:JSON.stringify({FNSimple:{initial:{communication:{urlDocConsul:'https://example.test/doc',identifiantInterne:'20251900'},procedure:{dateReceptionOffres:'2026-11-10T23:00:00',presOffres:{exigee:''}},natureMarche:{intitule:'Solutions satellitaire',description:'Satellite access subscriptions',lotsMarche:{non:''}}}}})};
function french(o=fr){return parseNative(JSON.stringify({total_count:1,results:[o]}),project({job:'national-FR-open',original:fr}),receipt,now);}
test('French official local deadline has timezone and identity',()=>{assert.equal(french().verified,true);assert.equal(french().deadline.value,'2026-11-10T22:00:00.000Z');});
test('French award or linked amendment cannot be treated as initial open notice',()=>{assert.notEqual(french({...fr,nature:'ATTRIBUTION'}).status,'open');assert.notEqual(french({...fr,annonce_lie:['correction']}).status,'open');assert.equal(french({...fr,idweb:'wrong'}).verified,false);});
const{verifyModel}=require('./verify.cjs');
test('Changed original technical attachment fails verification',()=>assert.throws(()=>verifyModel({open:[],sources:[{documentOrigin:{file:__filename,sha256:'incorrect'}}]}),/Original document archive changed/));

