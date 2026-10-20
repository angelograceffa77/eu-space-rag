'use strict';
const fs=require('node:fs'),path=require('node:path');
function load(root){const f=path.join(root,'open-only/policy.json');return fs.existsSync(f)?JSON.parse(fs.readFileSync(f,'utf8')):null;}
function skipDaily(root,now=new Date()){const p=load(root);if(!p)return false;if(p.dailyPaused===true)return true;const day=new Intl.DateTimeFormat('en-CA',{timeZone:p.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);return !!(p.notBeforeDate&&day<p.notBeforeDate)||(p.skipDailyDates||[]).includes(day);}
function assertHistory(root){if(load(root)?.historicalBackfillEnabled===false)throw Error('Historical backfill disabled by the open-only migration policy. Existing evidence is preserved.');}
module.exports={load,skipDaily,assertHistory};
