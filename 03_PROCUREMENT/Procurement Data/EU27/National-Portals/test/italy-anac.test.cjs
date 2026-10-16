'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{parseNotice}=require('../italy-anac.cjs'),{normalize,latestRecords}=require('../core.cjs');
const source={id:'IT-anac',name:'ANAC',country:'IT',timeZone:'Europe/Rome'},notice={idAvviso:'notice-1',idAppalto:'procedure-1',attivo:true,tipologia:'BANDI',dataPubblicazione:'2026-10-15T06:00:00Z',dataScadenza:'2026-11-15T10:00:00Z',templates:[{lingua:'it',template:{metadata:{titolo:'Satellite monitoring'},sections:[{fields:{soggetti_sa:[{denominazione_amministrazione:'Public buyer'}]}},{items:[{tipo_oggetto:'lotto',cig:'CIG-1',descrizione:'Satellite imagery',valore_complessivo_stimato:100},{tipo_oggetto:'lotto',cig:'CIG-2',descrizione:'Satellite processing',valore_complessivo_stimato:200}]}]}}]};
test('ANAC lots retain separate stable identities through national normalization and consolidation',()=>{
 const rows=parseNotice(notice).map(x=>normalize(x,source,'raw/fixture.json',new Date('2026-10-15T12:00:00Z')));assert.equal(rows.length,2);assert.notEqual(rows[0].recordId,rows[1].recordId);assert.equal(latestRecords(rows).length,2);assert.deepEqual(rows.map(x=>x.lotId),['CIG-1','CIG-2']);assert.equal(rows[0].currency,'');
});
test('superseded ANAC notices cannot become ordinary open tenders from a future deadline alone',()=>{
 const row=normalize(parseNotice({...notice,nuovoAvviso:true})[0],source,'raw/fixture.json',new Date('2026-10-15T12:00:00Z'));assert.notEqual(row.status,'open');assert.equal(row.noticeVerified,false);
});
