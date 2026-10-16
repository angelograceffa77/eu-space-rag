const {test}=require('node:test'),assert=require('node:assert/strict'),{parseHU,date}=require('../hungary-parse.cjs');
const base={eljarasAzonosito:'EKR123',eljarasTargy:'GNSS vevők beszerzése',meginditasDatum:[2026,1,1],ajanlatteteliHatarido:[2026,11,1,12,0],eljarasSzakasz:{kod:'EljarasSzakasz.E40'},ajanlatotAdhatBe:'MINDENKI'},p={current:true,queries:['all-current'],detail:{file:'evidence.gz'}},now=new Date('2026-10-14T12:00Z');
const row=(d={},q=p)=>parseHU({...base,...d},[],q,[],now);
test('Public E40 GNSS procurement is open',()=>{assert.equal(row().status,'open');assert.equal(row().relevance,'space')});
test('Invited suppliers excluded from OPEN',()=>assert.equal(row({ajanlatotAdhatBe:'CSAK_MEGHIVOTT'}).status,'invitation_only'));
test('Nobody can bid is not open',()=>assert.equal(row({ajanlatotAdhatBe:'SENKI'}).status,'needs_verification'));
test('Admission is not an open tender',()=>assert.equal(row({eljarasSzakasz:{kod:'EljarasSzakasz.E32'}}).status,'qualification_or_planning'));
test('Award overrides future deadline',()=>assert.equal(row({eljarasSzakasz:{kod:'EljarasSzakasz.E60'}}).status,'awarded'));
test('Withdrawal overrides deadline',()=>assert.equal(row({eljarasSzakasz:{kod:'EljarasSzakasz.E72_VISSZAVONT'}}).status,'cancelled'));
test('Past deadline closes tender',()=>assert.equal(row({ajanlatteteliHatarido:[2026,1,1,12,0]}).status,'closed'));
test('Radar is candidate, not confirmed space',()=>assert.equal(row({eljarasTargy:'Radar beszerzése'}).relevance,'possible_space'));
test('Unrelated current tender excluded',()=>assert.equal(row({eljarasTargy:'Irodabútor'}).relevance,'unrelated'));
test('Hidden search match preserved for review',()=>assert.equal(row({eljarasTargy:'Irodabútor'},{...p,queries:['keyword:GNSS']}).relevance,'possible_space'));
test('Historical summary cannot become live open',()=>assert.equal(row({}, {...p,current:false}).status,'needs_verification'));
test('Hungarian date preserves local time',()=>assert.equal(date([2026,10,14,9,5]),'2026-10-14T09:05'));

