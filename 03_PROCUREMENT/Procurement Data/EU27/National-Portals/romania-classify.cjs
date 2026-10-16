'use strict';
const {classify,fold,normalize,fields}=require('./core.cjs');
function classifyRomania(title,description,cpv,buyer=''){
 const text=fold(title+' '+description),heading=fold(title),withoutAgency=text.replace(/agentia spatiala romana|romanian space agency|institutul (?:de )?stiinte spatiale/g,'');const c=classify(title,withoutAgency,cpv);
 if(/\bgps\b/.test(heading)&&/receptor|sistem|echipament|monitor|localiz|urmar|navig|pozition|abonament|servici/.test(heading)){c.relevance='space';c.spaceEvidence=[c.spaceEvidence,'Dedicated GPS positioning equipment or service'].filter(Boolean).join(' | ');}
 if(/inchiriere (?:de )?(?:autospeciale|vehicule|autovehicule)/.test(heading)&&/\bgps\b/.test(heading)&&!/\b(?:3253|38112100|64214100)/.test(cpv)){c.relevance='possible_space';c.reviewEvidence='Vehicle rental with bundled GPS tracking; a separately procured satellite or navigation service is not established.';}
 if(/telescopic|telescoplic/.test(heading)&&/incarcator|prajini|electroizolan|manipulat|stivuitor|brat|nacel|scara/.test(heading)&&!c.spaceEvidence){c.relevance='possible_space';c.reviewEvidence='Telescopic lifting, access or electrical equipment; no astronomical or space purpose established.';}
 if(/chirurg|medical|oftalm|radioterap|histolog|transcript|microscop|ortoped/.test(heading)&&!/(?:gnss|satcom|spacecraft|satelitar)/.test(heading)&&c.relevance!=='unrelated'){c.relevance='possible_space';c.reviewEvidence='Medical or biological context; search terminology does not establish a space procurement.';}
 if(/servicii hoteliere|servicii catering/.test(heading)){c.relevance='possible_space';c.reviewEvidence='Ancillary hospitality/catering at a space body or event; no substantive space deliverable established.';}
 if(/aparar|unitat(?:ea|e) militar|forte(?:le)? armate/.test(fold(buyer)+' '+text))c.defenceEvidence=[c.defenceEvidence,'Romanian defence buyer or military scope'].filter(Boolean).join(' | ');
 if(c.relevance==='unrelated'&&/agentia spatiala|stiinte spatiale|romanian space agency/.test(fold(buyer))){c.relevance='possible_space';c.reviewEvidence='Space-agency buyer; substantive procurement scope requires review.';}
 return c;
}
function normalizeRomania(x,source,raw,now){const r=normalize(x,source,raw,now);Object.assign(r,classifyRomania(r.title,r.description,r.cpv,r.buyer));if(x.relevanceReviewReason){r.relevance='possible_space';r.reviewEvidence=[r.reviewEvidence,x.relevanceReviewReason].filter(Boolean).join(' | ');}return r;}
module.exports={classifyRomania,normalizeRomania};
