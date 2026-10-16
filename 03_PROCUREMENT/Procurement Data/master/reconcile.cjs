'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function load(file,root,sources){
 if(!file)return {assess(){},evidenceFiles:[],refreshPerformed:false,summary:null};
 const plan=JSON.parse(fs.readFileSync(file,'utf8'));if(plan.schemaVersion!==1)throw Error('Unsupported reconciliation plan');
 const evidenceFiles=[path.resolve(file)],selected=new Set();
 for(const input of plan.inputs){const p=path.resolve(root,input.path);if(!p.startsWith(path.resolve(root)+path.sep))throw Error('Input outside procurement root');if(hash(p)!==input.sha256)throw Error('Reconciliation input checksum mismatch '+p);selected.add(p);const existing=sources.find(s=>path.resolve(s.path)===p);const source={...input,path:p,expectedSha256:input.sha256,group:'reconciled/'+input.authority+'/'+input.family};if(existing)Object.assign(existing,source);else sources.push(source);}
 for(const item of plan.evidence||[]){const p=path.resolve(root,item.path);if(hash(p)!==item.sha256)throw Error('Assessment evidence changed '+p);evidenceFiles.push(p);}
 return {evidenceFiles,refreshPerformed:true,summary:{plan:path.relative(root,file).replaceAll('\\','/'),planSha256:hash(file),selectedInputs:plan.inputs.length,policy:plan.policy,dailyRefresh:plan.dailyRefresh||null},assess(n,source,original){
  n.projectionPriority=source.priority||0;
  const replaced=(plan.supersededScopes||[]).some(rule=>(!rule.authority||rule.authority===source.authority)&&(!rule.family||rule.family===source.family)&&(!rule.country||n.country===rule.country)&&(!rule.buyerPattern||new RegExp(rule.buyerPattern,'i').test(n.buyer+' '+original.authority+' '+original.sourceType)));
  n.evidenceOnly=Boolean(source.evidenceOnly||(source.conditionalEvidenceOnly&&new RegExp(source.conditionalEvidenceOnly,'i').test(n.buyer+' '+original.authority+' '+original.sourceType))||replaced&&!selected.has(path.resolve(source.path)));
  if(n.evidenceOnly)n.projectionPriority=-1;
  if(source.exclusionLedger){n.relevance='excluded';n.projectionPriority=100;n.assessmentReason=original.reason;n.evidenceOnly=false;}
  if(plan.dailyRefresh){const observed=Date.parse(original.retrievedAt||original.collectedAt||original.scrapedAt||'');const sourceAllowed=!source.allowedFreshSourceIds||source.allowedFreshSourceIds.includes(original.sourceId);if(!sourceAllowed){n.evidenceOnly=true;n.projectionPriority=-1;}const rawPath=typeof original.rawFile==='string'&&original.rawFile?(path.isAbsolute(original.rawFile)?original.rawFile:path.resolve(path.dirname(source.path),original.rawFile)):null;const observedThisRun=!!source.dailyEvidenceRoot&&!!rawPath&&path.resolve(rawPath).toLowerCase().startsWith(path.resolve(source.dailyEvidenceRoot).toLowerCase()+path.sep)&&fs.existsSync(rawPath);const fresh=sourceAllowed&&!!source.dailyFresh&&(source.family!=='national'||observedThisRun||Number.isFinite(observed)&&observed>=Date.parse(source.collectionStartedAt)-300000);n.dailyRefresh={asOf:plan.dailyRefresh.asOf,fresh,collectionStatus:sourceAllowed&&source.allowedFreshSourceIds?.length?'partial_source_success':source.runState||'previous_evidence',jobStatus:source.runState||'previous_evidence',notSeenDoesNotMeanClosed:true};if(source.dailyFresh&&!fresh)n.projectionPriority=Math.min(n.projectionPriority,0);if(source.exclusionLedger)n.projectionPriority=Number.MAX_SAFE_INTEGER-1;}
  n.reconciliation={selected: selected.has(path.resolve(source.path)),evidenceOnly:n.evidenceOnly,sourceFile:source.id};
 }};
}
module.exports={load};
