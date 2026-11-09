"""Validate a recorded template review, not the truth of its assertions."""
import argparse,hashlib,json
from pathlib import Path
def validate_review(artifact,template_id,review,profiles):
 errors=[]
 profile=profiles.get(template_id)
 if not profile:return {'status':'HOLD','errors':['Unknown template ID']}
 if review.get('templateId')!=template_id:errors.append('Template ID mismatch')
 if review.get('profileVersion')!=profile['version']:errors.append('Stale profile version')
 if review.get('artifactSha256')!=hashlib.sha256(Path(artifact).read_bytes()).hexdigest():errors.append('Review does not bind to this final artifact')
 for key in ['reviewer','reviewedAt','applicabilityReview','formalPresentationReview']:
  if not isinstance(review.get(key),str) or not review[key].strip():errors.append('Missing '+key)
 checks=review.get('checks',[])
 if not isinstance(checks,list):return {'status':'HOLD','errors':errors+['checks must be a list']}
 expected={x['id'] for x in profile['requirements']}
 ids=[x.get('id') for x in checks if isinstance(x,dict)]
 if len(ids)!=len(checks) or set(ids)!=expected or len(ids)!=len(set(ids)):errors.append('Missing, duplicate or unknown requirement IDs')
 passed=0
 for x in checks:
  if not isinstance(x,dict):continue
  status=x.get('status')
  if status not in ['pass','not-applicable']:errors.append('Unresolved or failed requirement '+str(x.get('id')))
  if not isinstance(x.get('reason'),str) or not x['reason'].strip():errors.append('Missing review reason')
  if status=='pass':
   passed+=1
   for key in ['reportLocation','evidenceReviewed']:
    if not isinstance(x.get(key),str) or not x[key].strip():errors.append('Missing '+key+' for '+str(x.get('id')))
 if not passed:errors.append('No substantive requirement reviewed as applicable')
 return {'status':'HOLD' if errors else 'PASS','errors':errors,'semanticReviewStillRequired':True,'meaning':'Recorded review completeness only; not certification or proof of factual accuracy'}
if __name__=='__main__':
 a=argparse.ArgumentParser();a.add_argument('artifact',type=Path);a.add_argument('--template-id',required=True);a.add_argument('--review',type=Path,required=True);v=a.parse_args()
 try:
  p=Path(__file__).resolve().parent.parent/'assets/report-templates/01_Shared-Standards/template-profiles.json'
  result=validate_review(v.artifact,v.template_id,json.loads(v.review.read_text(encoding='utf-8-sig')),json.loads(p.read_text(encoding='utf-8'))['profiles'])
 except Exception as e:result={'status':'HOLD','errors':[str(e)]}
 print(json.dumps(result,indent=2));raise SystemExit(0 if result['status']=='PASS' else 1)
