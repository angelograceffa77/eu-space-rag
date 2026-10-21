'use strict';
const{timing}=require('./lifecycle.cjs');
function currentView(record,asOf=new Date().toISOString()){const a=record.availability,age=Date.parse(asOf)-Date.parse(a.checkedAt),fresh=Number.isFinite(age)&&age>=0&&age<=86400000,open=fresh&&timing(a.deadline,asOf)==='future';if(open)return {...record,snapshotAvailability:a,availability:{...a,asOf}};return {...record,snapshotAvailability:a,availability:{...a,asOf,currentStatus:'requires_recheck',liveVerified:false,reason:'Stored verification is stale or the deadline needs a fresh source check. This is not a closure determination.'},snapshotCompanyMatching:record.companyMatching,companyMatching:{...record.companyMatching,state:'requires_recheck',candidates:[]}};}
module.exports={currentView};
