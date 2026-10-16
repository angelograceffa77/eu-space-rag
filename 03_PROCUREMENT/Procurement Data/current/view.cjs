'use strict';
const {evaluate}=require('./lifecycle.cjs');
function currentView(record,asOf=new Date().toISOString()){
 if(!['procurement','lot'].includes(record.recordType)||!record.availability)return record;
 const saved=record.availability,n={title:record.title,stage:saved.opportunityType||saved.sourceDerivedStatus,sourceStatus:saved.sourceDerivedStatus,status:saved.sourceDerivedStatus,deadline:saved.deadline};
 const availability={...saved,...evaluate(n,asOf)};
 if(saved.stale){availability.currentStatus='stale_unverified';availability.liveVerified=false;availability.reason='No fresh source observation in the daily run.';}
 if(saved.evidenceOnly){availability.currentStatus='unknown';availability.liveVerified=false;availability.reason='Superseded source evidence; current state not established.';}
 if(saved.conflictingLatestSourceStatuses||saved.conflictingLatestDeadlines||saved.lifecycleConflict){availability.currentStatus='unknown';availability.reason='Latest source evidence conflicts; verification required.';availability.liveVerified=false;}
 const matching=record.companyMatching;const eligible=['open_verified','reported_open_not_live_verified'].includes(availability.currentStatus);
 return {...record,snapshotAvailability:saved,availability,...(matching&&!eligible?{snapshotCompanyMatching:matching,companyMatching:{...matching,state:'not_current_open_tender',candidates:[],suppressedAt:asOf,reason:'Current deadline or lifecycle no longer supports an open-tender shortlist.'}}:{})};
}
module.exports={currentView};
