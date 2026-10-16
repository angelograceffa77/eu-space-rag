'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
function receiptFileValid(receipt){try{return /^[a-f0-9]{64}$/i.test(receipt.evidenceSha256)&&fs.statSync(receipt.evidenceFile).isFile()&&crypto.createHash('sha256').update(fs.readFileSync(receipt.evidenceFile)).digest('hex')===receipt.evidenceSha256;}catch{return false;}}
const plain=v=>String(v||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
function stageOf(r){const title=plain(r.title),kind=plain(r.noticeType||r.stage),s=plain(r.sourceStatus||r.status),t=title+' '+kind+' '+s;
 if(/cancel|annul|withdraw|anulad|desist|uniewaz|widerruf|revocat|ακυρω/.test(s))return 'cancelled';
 if(/award|contract signed|concluded|attribution|adjudicad|aggiudicat|formaliz|rozstrzygn|ανατεθει/.test(s+' '+kind))return 'awarded';
 if(/suspend|paused/.test(s))return 'suspended';
 if(/invitation.only/.test(s))return 'invitation_only';
 if(kind==='in_house_assignment')return 'in_house_assignment';
 if(/mini.competition|specific contract|call.off|avrop fran/.test(title))return 'tender';
 if(/dynamic purchasing system|dynamiskt inkopssystem|systeme d.acquisition dynamique|dynamisches beschaffungssystem|sistema dinamico de adquisicion|dinamicni nabavni sistem|dynamisch aankoopsysteem|dinamikus beszerzesi rendszer|sistema dinamico di acquisizione|homologacion de (?:proveedores|empresas)|registro de proveedores|sistema de clasificacion de proveedores|supplier admission|\badmission\b|qualification|^dis\b|\bdps\b/.test(t))return 'admission';
 if(/market consultation|\bconsultation\b|market research|request for information|\brfi\b/.test(t))return 'consultation';
 if(/planning|planned|intended|forthcoming|prior information/.test(t))return 'planned';
 if(/grant|job vacancy/.test(kind))return 'not_procurement';
 return 'tender';
}
function localDay(asOf,timeZone){try{return new Intl.DateTimeFormat('en-CA',{timeZone:timeZone||'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(asOf));}catch{return null;}}
function evaluate(n,asOf=new Date().toISOString(),receipt=null){const stage=stageOf({title:n.title,stage:n.stage,sourceStatus:n.sourceStatus}),deadline=n.deadline||{value:null,precision:'unknown'},day=localDay(asOf,n.timeZone),instant=deadline.value&&deadline.precision==='instant',dateOnly=deadline.value&&deadline.precision==='date',expired=instant?Date.parse(deadline.value)<=Date.parse(asOf):dateOnly&&day?deadline.value<day:false;
 const evidenceFresh=receipt?.identityMatched===true&&receiptFileValid(receipt)&&Number.isFinite(Date.parse(receipt.checkedAt))&&Date.parse(receipt.checkedAt)<=Date.parse(asOf)&&Date.parse(asOf)-Date.parse(receipt.checkedAt)<=86400000;
 let currentStatus='unknown',reason='No verified current submission evidence';
 if(['cancelled','awarded','suspended','invitation_only','not_procurement','in_house_assignment'].includes(stage)){currentStatus=stage;reason='Explicit source lifecycle state';}
 else if(n.status==='closed'){currentStatus='closed';reason='Explicit closed source state';}
 else if(expired){currentStatus='deadline_expired';reason='Submission deadline has passed';}
 else if(['admission','consultation','planned'].includes(stage)){currentStatus=stage;reason='Separate opportunity type; not an ordinary open tender';}
 else if(dateOnly&&deadline.value===day){currentStatus='deadline_today_check_time';reason='Closing date is today; source does not supply a closing time';}
 else if(n.status==='reported_open'){
   currentStatus=evidenceFresh&&receipt.status==='open'&&receipt.deadline===deadline.value&&deadline.value?'open_verified':'reported_open_not_live_verified';
   reason=currentStatus==='open_verified'?'Identity, open state and deadline verified against saved live evidence':'Source reports open; current submission state is not independently verified';
 }
 return {sourceDerivedStatus:n.status,currentStatus,opportunityType:stage,deadline,asOf,liveVerified:currentStatus==='open_verified',checkedAt:evidenceFresh?receipt.checkedAt:null,verification:receipt||null,reason};
}
module.exports={stageOf,evaluate,localDay};
