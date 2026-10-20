'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {classify,project}=require('./relevance.cjs');const assess=(text,job='ted-test')=>classify({job,title:text,description:'',fields:[{field:'title',text}]});
test('Greek time period is not space',()=>assert.notEqual(assess('Υπηρεσίες καθαριότητας για ΔΙΑΣΤΗΜΑ 24 ΜΗΝΩΝ').decision,'space'));
test('Romanian monthly payments are not lunar missions',()=>assert.notEqual(assess('Contractele se vor încheia lunar sau trimestrial').decision,'space'));
test('Genuine lunar missions remain space',()=>assert.equal(assess('Lunar surface exploration mission').decision,'space'));
for(const text of ['Développement pour le transport spatial','Integrated model of a space composite system','CEMS meteo data collection','CEMS hydro data collection','RobSim-Space robotic vacuum simulator','TELESCOPE AND A BUILDING-DOME AT THE MONTSEC OBSERVATORY'])test('Documented scope: '+text,()=>assert.equal(assess(text).decision,'space'));
test('Greek naval satellite service is dual use space defence',()=>assert.ok(assess('Δορυφορικές Επικοινωνίες SPACE-X STARLINK επ’ ωφελεία Πολεμικών Πλοίων').categories.includes('dual_use_space_defence')));
test('ESA topical teams do not crash evidence extraction',()=>assert.equal(assess('EXPLORATION SCIENCE TOPICAL TEAMS','institution-ESA-issued-cfp').decision,'space'));
