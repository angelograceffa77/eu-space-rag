'use strict';
const {root,path,fold}=require('./shared.cjs'),{dateTime,timing}=require('./lifecycle.cjs');
function parse(raw,p,receipt,now){
 const $=require(path.join(root,'node_modules/cheerio')).load(raw),detail=$('.content-details');
 let identity=false,status='unknown',deadline=dateTime(null),title=p.title,description=p.description,buyer=p.buyer,reference=p.reference,proof=[];
 if(detail.length===1){const section=detail.parent(),labels={};detail.find('tr').each((i,e)=>{const c=$(e).find('td');if(c.length===2)labels[c.eq(0).text().replace(/[:\s]+$/,'').trim()]=c.eq(1).text().replace(/\s+/g,' ').trim();});
 title=section.children('h1').text().trim();buyer=labels['Útboðsaðili']||buyer;reference=labels['Númer']||reference;
 description=section.children('p').map((i,e)=>$(e).text()).get().join('\n');
 identity=receipt.url===p.url&&/^https:\/\/utbodsvefur\.is\/[a-z0-9-]+\/$/.test(p.url)&&fold(title)===fold(p.title)&&fold(buyer)===fold(p.buyer)&&Boolean(p.original?.noticeReference)&&reference===p.original.noticeReference;
 const m=labels.Skilafrestur?.match(/^(\d{2})\.(\d{2})\.(\d{4}) kl\. (\d{2}:\d{2})$/);if(m)deadline=dateTime(`${m[3]}-${m[2]}-${m[1]} ${m[4]}`,'Atlantic/Reykjavik');
 const invitation=/óskar eftir tilboði|óskar eftir tilboðum/i.test(description)&&/almennt útboð/i.test(description)&&/Tilboðum skal skilað/i.test(description),ambiguous=/Forauglýsing|Markaðskönnun|RFI|DPS|Gagnvirkt/i.test(labels.Tegund||'')||/afturkallað|fellt niður|stöðvað|hlutatilboð|skipt í .*hluta/i.test(description);
 proof=[JSON.stringify(labels),description];
 if(identity&&m&&invitation&&!ambiguous)status=timing(deadline,now)==='expired'?'deadline_confirmed':'open';
 }
 return {identityMatched:identity,verified:identity&&status!=='unknown'&&Boolean(deadline.value),status,deadline,title,description,buyer,reference,proof,lots:null,checkedAt:receipt.checkedAt,evidence:receipt,scope:'Iceland labelled notice identity and deadline plus explicit public invitation and submission instructions; buyer-platform restrictions and eligibility remain separate'};
}
module.exports={parse};
