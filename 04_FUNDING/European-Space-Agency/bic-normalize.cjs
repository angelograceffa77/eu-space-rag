'use strict';
const io=require('../funding data/00_Control/io.cjs'),{fs,path,json,check}=io;
const national=require('../National-Funding/normalize.cjs');
function load(runRoot){
 const source=json(path.join(runRoot,'esa/sources.json')),registry=json(path.join(__dirname,'bic-reviews.json')),rows=[],reviews={},errors=[];
 for(const [url,review]of Object.entries(registry)){if(review.decision!=='include')continue;
 const page=source.rows.findLast(r=>r.group==='Business-Incubation-Centres'&&r.url===url&&r.centre===review.centre);
 if(!page){errors.push({url,reason:'Reviewed BIC call not retrieved'});continue;}
 try{check(page.directoryEvidence);const n=national.normalize({...page.evidence,directoryEvidence:page.directoryEvidence},review.extraction);rows.push(n);reviews[n.record.canonicalId]={...review,extraction:undefined};}catch(e){errors.push({url,reason:e.message});}
 }
 return {rows,reviews,reports:[{id:'ESA-BIC-reviewed-calls',status:errors.length?'partial':'reviewed_subset',reviewed:rows.length,errors,limitations:['Local incubation programme support; company and regional eligibility are unverified.','Only source-bound reviewed application rounds are admitted. Membership in the ESA directory is not sufficient.','Closing dates without a verified time are conservatively excluded throughout the closing day.']}]};
}
module.exports={load};
