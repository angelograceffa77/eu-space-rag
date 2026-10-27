'use strict';
const {dateTime,timing}=require('./lifecycle.cjs');
function endpoint(url){const m=url.match(/^https:\/\/prozorro\.gov\.ua\/uk\/tender\/(UA-\d{4}-\d{2}-\d{2}-\d+-[a-z])$/);if(!m)throw Error('Invalid official Ukrainian tender URL');return 'https://prozorro.gov.ua/api/tenders/'+m[1]+'/details';}
async function fetchDetail(url,net){return net({url:endpoint(url),init:{method:'GET'}});}
function parse(raw,p,receipt,now){const d=JSON.parse(raw);let identity=false,status='unknown',deadline=dateTime(null),lots=null;const id=p.url?.split('/').pop();identity=receipt.url===p.url&&receipt.requestUrl===endpoint(p.url)&&d.tenderID===id&&d.tenderID===p.id&&/^[a-f0-9]{32}$/.test(d.id||'');
 const end=d.tenderPeriod?.endDate;if(typeof end==='string'&&/T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(end))deadline=dateTime(end);
 const cancelled=(d.cancellations||[]).some(c=>c.status==='active'&&(!c.cancellationOf||c.cancellationOf==='tender'));
 if(identity&&deadline.value&&!cancelled&&d.status==='active.tendering')status=timing(deadline,now)==='expired'?'deadline_confirmed':'open';
 // Post-submission phases establish ended bidding only with an explicit elapsed deadline.
 // They do not establish a named winner or an awarded-contract record.
 if(identity&&deadline.value&&!cancelled&&['active.auction','active.qualification','active.awarded','complete','unsuccessful'].includes(d.status)&&timing(deadline,now)==='expired')status='deadline_confirmed';
 if(identity&&d.status==='cancelled')status='cancelled';
 if(identity&&Array.isArray(d.lots))lots=d.lots.filter(l=>l.status==='active').map((l,i)=>({id:l.id,title:l.title||'',description:l.description||'',deadline,values:[],sourcePointer:'/lots/'+d.lots.indexOf(l),deadlineScope:'Official common tender submission deadline'}));
 return {identityMatched:identity,verified:identity&&status!=='unknown'&&Boolean(deadline.value),status,deadline,title:p.title,description:d.description||p.description,buyer:d.procuringEntity?.name||p.buyer,reference:d.tenderID,proof:[JSON.stringify({id:d.id,tenderID:d.tenderID,status:d.status,tenderPeriod:d.tenderPeriod,cancellations:d.cancellations,procurementMethodType:d.procurementMethodType})],lots,checkedAt:receipt.checkedAt,evidence:receipt,scope:'Official public tender detail identity, active.tendering status and explicit offset deadline; participation eligibility remains unverified'};
}
module.exports={endpoint,fetchDetail,parse};
