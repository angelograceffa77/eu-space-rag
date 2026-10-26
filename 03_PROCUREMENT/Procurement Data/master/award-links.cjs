'use strict';
// Conservative identity reconciliation. A name match is a review lead, never a verified winner link.
function nameKey(s){return String(s||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();}
function identifierKey(s){return String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');}
const indexes=new WeakMap();
function lookup(catalog,key){if(!catalog)return [];if(!indexes.has(catalog)){const index=new Map();for(const p of catalog.profiles.values()){const k=nameKey(p.name);if(!index.has(k))index.set(k,[]);index.get(k).push(p);}indexes.set(catalog,index);}return indexes.get(catalog).get(key)||[];}
function linkWinner(winner,catalog){
  const candidates=[];
  for(const p of lookup(catalog,nameKey(winner.name))){
    // ESA entity codes are not national registration/VAT identifiers and must never be compared as such.
    const proof=(p.verifiedLegalIdentifiers||[]).find(x=>x.scheme&&(x.scheme===winner.identifierScheme||!winner.identifierScheme&&x.exactNameAndIdentifierReviewed===true)&&identifierKey(x.value)===identifierKey(winner.identifier)&&x.evidence?.sourceUrl&&x.evidence?.sha256);
    candidates.push({profileKey:p.key,entityId:p.entityId,entityCode:p.entityCode,name:p.name,country:p.country,identityVerified:!!proof,method:proof?'same_typed_legal_identifier':'exact_name_only_requires_identity_review',...(proof?{evidence:proof.evidence}:{})});
  }
  const verified=candidates.filter(x=>x.identityVerified),legalIds=new Set(verified.map(x=>String(x.entityId)));
  return {companyDatabaseIdentityVerified:verified.length>0&&legalIds.size===1,companyDatabaseLinks:candidates.slice(0,20),candidateCount:candidates.length,identityReviewRequired:!verified.length||legalIds.size!==1,experienceMayInfluenceRanking:verified.length>0&&legalIds.size===1,meaning:'Award winner is reported by the source. Catalogue identity remains separate; name-only matches cannot establish experience or eligibility.'};
}
function attach(record,catalog){return {...record,winners:(record.winners||[]).map(w=>({...w,...linkWinner(w,catalog)}))};}
module.exports={nameKey,identifierKey,linkWinner,attach};
