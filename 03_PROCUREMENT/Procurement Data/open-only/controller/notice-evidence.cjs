'use strict';
const crypto=require('crypto'),sha=s=>crypto.createHash('sha256').update(s).digest('hex');
function dayValue(v){if(typeof v!=='string')return null;let m=v.match(/^(\d{4})-(\d{2})-(\d{2})/);if(!m){const n=v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);if(n)m=[n[0],n[3],n[2].padStart(2,'0'),n[1].padStart(2,'0')];}if(!m)return null;const d=m.slice(1).join('-');return Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d?d:null;}
function inspect(r,day){const o=r.original||r.extracted||{},fields=[],job=r.job;let id=null,terminal=false,scope='unsupported-native-schema';
 function add(field,value){for(const [index,v]of (Array.isArray(value)?value:[value]).entries())if(v!==undefined&&v!==null&&v!=='')fields.push({field,index,original:v,calendarDay:dayValue(v)});}
 if(job.startsWith('ted-')){scope='ted-lot-deadline-fields';id=o['publication-number'];add('deadline-receipt-tender-date-lot',o['deadline-receipt-tender-date-lot']);}
 else if(job==='national-SK-JOSEPHINE-current'){scope='josephine-labelled-submission-column';id=o.reference;add('cells[6]',o.cells?.[6]);}
 else if(job==='national-SK-EKS-current'){scope='eks-native-offer-deadline';id=o.IdVirtual;add('LehotaNaPredkladaniePonuk',o.LehotaNaPredkladaniePonuk);}
 else if(job==='national-RO-advertisements-recent'){scope='romania-advertisement-native-deadline';id=o.advNoticeId;add('tenderReceiptDeadline',o.tenderReceiptDeadline);}
 else if(job.startsWith('national-LV-IUB-')){scope='iub-native-notice';id=o.identifier;if(o.type==='competition')add('date',o.date);else scope='iub-noncompetition-or-version-requires-detail';}
 else if(job==='national-SE-Mercell-current'){scope='mercell-native-notice';id=o.id;add('deadline',o.deadline);terminal=['Awarded','Cancelled','DeadlinePassed'].includes(o.tenderStatus);}
 else if(job==='national-RO-open'){scope='romania-deadline-range-lots-unresolved';id=o.noticeId;add('minTenderReceiptDeadline',o.minTenderReceiptDeadline);add('maxTenderReceiptDeadline',o.maxTenderReceiptDeadline);}
 else if(job==='national-PL-open'){scope='poland-native-notice';id=o.objectId||o.moIdentifier;add('submittingOffersDate',o.submittingOffersDate);if(o.outdated===true)scope='poland-superseded-version-requires-current-notice';}
 else if(job==='national-HR-open'){scope='croatia-native-notice';id=o.Id;add('SubmissionDeadline',o.SubmissionDeadline);}
 else if(job==='national-LV-open'){scope='latvia-eis-native-notice';id=o.Id;add('LastStagePlannedProposalSubmissionTime',o.LastStagePlannedProposalSubmissionTime);}
 else if(job.startsWith('institution-ESA-issued-')){scope='esa-issued-native-notice';id=o.id;add('closingDate',o.closingDate);terminal=o.isCancelled===true||o.isArchived===true;}
 else if(job==='national-AT-USP-current'&&Array.isArray(o)){scope='austria-index-deadline-fields';id=o[4];if(o[5]){add('[6]',o[6]);add('[7]',o[7]);}else add('[3]',o[3]);}
 const dates=fields.map(x=>x.calendarDay).filter(Boolean),invalid=fields.some(x=>x.calendarDay===null);
 let decision=scope==='unsupported-native-schema'?'native_parser_required':invalid?'unparsed_deadline_requires_review':!dates.length?'undated_requires_detail':dates.some(x=>x>day)?'future_deadline_candidate':dates.some(x=>x===day)?'deadline_today_requires_time_check':'elapsed_in_observed_source';
 if(job==='national-SE-Mercell-current'&&o.tenderStatus==='NoTimeLimit'&&!dates.length)decision='native_open_ended_requires_admission_check';
 if(terminal)decision=dates.some(x=>x>=day)?'terminal_status_deadline_conflict':'terminal_native_status';
 return {sourceObservationId:sha(JSON.stringify([job,r.evidence,sha(JSON.stringify(o))])),job,nativeIdentity:id==null?null:String(id),originalRecordSha256:sha(JSON.stringify(o)),sourceEvidence:r.evidence,scope,deadlineEvidence:fields,decision,verifiedOpen:false,spaceRelevance:'not_assessed',statusEffect:'No master change; missing observations never imply closure'};
}
function compare(previous,current){const index=rows=>{const m=new Map();for(const r of rows){if(r.nativeIdentity===null)continue;const key=r.job+'|'+r.nativeIdentity;if(!m.has(key))m.set(key,new Map());m.get(key).set(r.originalRecordSha256,r.sourceObservationId);}return m;},a=index(previous),b=index(current),events=[];
 for(const key of new Set([...a.keys(),...b.keys()])){const old=a.get(key),now=b.get(key);let change=!old?'newly_observed':!now?'not_observed_in_new_snapshot':JSON.stringify([...old.keys()].sort())===JSON.stringify([...now.keys()].sort())?'unchanged':'source_version_changed';if(change==='unchanged'&&now.size===1)continue;events.push({sourceIdentity:key,change,previousVersions:old?[...old.keys()]:[],currentVersions:now?[...now.keys()]:[],conflictingCurrentVersions:(now?.size||0)>1,statusEffect:'none',requiresRecheck:change==='not_observed_in_new_snapshot'||(now?.size||0)>1});}return events;}
module.exports={dayValue,inspect,compare};
