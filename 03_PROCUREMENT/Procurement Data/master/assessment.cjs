'use strict';
// Derived assessments only. Never changes source text or establishes legal eligibility.
function requirements(fields, extract) {
  const out=[];
  for(const f of fields) {
    if(typeof f.text!=='string')continue;
    for(const sentence of f.text.matchAll(/[^.!?\n]+[.!?]?/g)) {
      const text=sentence[0], cue=/\b(must|required|shall|mandatory|essential|obligatoire|exige|requis|muss|erforderlich|obbligatorio|obligatorio)\b/i.test(text)?'mandatory_wording':/\b(preferred|desirable|optional|preferably|souhaitable|wünschenswert)\b/i.test(text)?'preferred_wording':'mentioned';
      for(const hit of extract([{...f,text}]).values())out.push({...hit,start:hit.start+sentence.index,end:hit.end+sentence.index,excerptStart:hit.excerptStart+sentence.index,requirementLevel:cue,interpretation:'Textual cue only; inspect full specification and exceptions.'});
    }
  }
  return out;
}
function eligibility(fields) {
  const checks=[];
  const rules=[['country_or_establishment',/\b(nationality|established in|registered in|eligible countries|member states|nationalit[eé]|[eé]tabli[se]? dans)\b/i],['certification_or_security',/\b(certif(?:ied|ication)|ISO\s?\d+|security clearance|habilitat|accreditation)\b/i],['financial_capacity',/\b(turnover|financial capacity|financial standing|chiffre d.affaires)\b/i],['consortium_or_entity_type',/\b(consorti(?:um|a)|SMEs?|non.?profit|for.profit|universit|research organisations?)\b/i]];
  for(const f of fields)if(typeof f.text==='string')for(const m of f.text.matchAll(/[^.!?\n]+[.!?]?/g))for(const [criterion,re]of rules)if(re.test(m[0]))checks.push({criterion,state:'unknown',field:f.field,sourceRecordId:f.sourceRecordId||null,jsonPointer:f.jsonPointer||null,start:m.index,end:m.index+m[0].length,text:m[0],...(f.origin?{origin:f.origin}:{})});
  return {state:'unknown',verified:false,checks,meaning:'Requirements detected for review; company compliance has not been established.'};
}
function decorate(result,fields,catalog,extract,asOf) {
  const req=requirements(fields,extract),byId=new Map();
  for(const h of req) {const old=byId.get(h.capabilityId);const weights={mandatory_wording:3,preferred_wording:2,mentioned:1};if(!old||weights[h.requirementLevel]>weights[old.requirementLevel])byId.set(h.capabilityId,h);}
  const e=eligibility(fields);
  return {...result,assessmentVersion:'2026-10-24.1',requirements:[...byId.values()],eligibilityAssessment:e,
    candidates:(result.candidates||[]).map(c=>{
      const matched=new Set((c.matchedCapabilities||c.capabilities||[]).map(x=>x.capabilityId||x.fundingEvidence?.capabilityId));
      const missing=[...byId.values()].filter(x=>!matched.has(x.capabilityId));
      const evidence=(c.matchedCapabilities||c.capabilities||[]).map(x=>x.companyEvidence).filter(Boolean);
      return {...c,eligibilityAssessment:{state:'unknown',verified:false,requiredChecks:[...new Set(e.checks.map(x=>x.criterion))]},
        requirementCoverage:{matched:[...byId.values()].filter(x=>matched.has(x.capabilityId)).map(x=>({capabilityId:x.capabilityId,level:x.requirementLevel})),missingEvidence:missing.map(x=>({capabilityId:x.capabilityId,level:x.requirementLevel})),missingEvidenceDoesNotMeanIncapable:true},
        evidenceQuality:{hasSourceExcerpts:evidence.length>0,companySourceDate:catalog?.sourceDate||null,companySourceOlderThan90Days:!catalog?.sourceDate||Date.parse(asOf)-Date.parse(catalog.sourceDate)>90*86400000,assessedAt:asOf,websiteEvidenceDates:[...new Set(evidence.map(x=>x.origin?.checkedAt).filter(Boolean))],selfReportedCapabilities:true},
        explanation:{whySuggested:(c.matchedCapabilities||c.capabilities||[]).map(x=>x.label||x.companyEvidence?.label).filter(Boolean),mustVerify:['Eligibility and mandatory qualifications','Current capacity and relevant delivery experience','Willingness to bid or participate'],notAWinProbability:true}};
    })};
}
module.exports={requirements,eligibility,decorate};
