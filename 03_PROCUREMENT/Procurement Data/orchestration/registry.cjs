'use strict';
const fs=require('node:fs'),path=require('node:path');
const dedicated={AT:'austria',CZ:'czechia',EE:'estonia',FI:'finland',FR:'france',GR:'greece',HU:'hungary',LU:'luxembourg',RO:'romania',SI:'slovenia',SK:'slovakia'};
function registry(root){const national=path.join(root,'EU27','National-Portals'),{sources,countries}=require(path.join(national,'sources.cjs')),jobs=[];
for(const authority of fs.readdirSync(root).sort()){const dir=path.join(root,authority,'scrapers');if(!fs.existsSync(dir))continue;for(const f of fs.readdirSync(dir).filter(f=>/\.js$/.test(f)).sort())jobs.push({id:authority+'--'+f.replace(/\.js$/,''),kind:'standalone',entry:path.join(dir,f),authority,coverageAssessment:'collector-reported; otherwise unknown'});}
// TED lives one level below EU27.
const ted=path.join(root,'EU27','TED','scrapers');for(const f of fs.readdirSync(ted).filter(f=>/\.js$/.test(f)).sort())jobs.push({id:'EU27-TED--'+f.replace(/\.js$/,''),kind:'standalone',entry:path.join(ted,f),authority:'EU27/TED',coverageAssessment:'collector-reported; otherwise unknown'});
for(const [country,name]of [...countries,['EU','European Union']]){const ids=sources.filter(s=>s.country===country).map(s=>s.id);if(!ids.length)continue;const special=dedicated[country];jobs.push({id:'national-'+country,kind:special?'dedicated':'national',country,name,sources:ids,extraSources:country==='EE'?['EE-archive']:[],entry:path.join(national,special?'refresh-'+special+'.cjs':'collect.cjs'),legacyCLI:['CZ','SK'].includes(country)});}
return jobs;}
function command(job,{runDir,asOf,resume=false,from='2020-01-01',attempt=1,daily=false}){const work=path.join(runDir,'jobs',job.id),output=path.join(work,'output'),raw=path.join(work,job.country==='RO'&&attempt>1?'collection-retry-'+attempt:'collection'),env={PROCUREMENT_OUTPUT_DIR:output,PROCUREMENT_FINAL_OUTPUT_DIR:output};let args=[];
// National collectors apply from to publication dates, including still-open notices.
// Keep the full supported scope so an older open tender cannot disappear from a daily refresh.
if(daily&&job.kind!=='standalone')from='2020-01-01';
if(daily&&job.id.startsWith('EU27-TED--'))Object.assign(env,{PROCUREMENT_FROM_DATE:from,PROCUREMENT_TO_DATE:asOf});
if(job.kind==='dedicated'&&!job.legacyCLI){args=['--resume='+raw,'--output='+path.join(output,job.name)];if(job.country==='RO')args.push('--from='+from,'--to='+asOf,'--archive-dir='+path.join(work,'archives'));else {args.push('--as-of='+asOf);if(job.country==='AT')args.push('--from='+from,'--to='+asOf);}}
else if(job.kind!=='standalone'){args=['--output='+raw,'--from='+from,'--to='+asOf,'--max-pages=10000','--concurrency=1',...(!daily?['--archives']:[])];if(job.kind==='national')args.push('--sources='+job.sources.join(','));if(resume&&fs.existsSync(path.join(raw,'checkpoint.json')))args.push('--resume');if(job.country==='SK')args.push('--sk-archive-dir='+path.join(work,'archives'));}
return {work,output,raw,env,args,entry:job.entry};}
module.exports={registry,command,dedicated};
