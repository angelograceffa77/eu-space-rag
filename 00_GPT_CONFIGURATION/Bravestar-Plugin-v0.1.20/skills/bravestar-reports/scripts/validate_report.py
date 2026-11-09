"""Validate each final deliverable before final release. No email or publication side effects."""
import argparse,json,re,sys,zipfile,xml.etree.ElementTree as ET
from pathlib import Path
DISCLAIMER='This report was generated with artificial intelligence assistance for information and decision-support purposes. It does not replace professional human advice, including legal, financial, investment, tax or technical advice. The sources consulted and cited are not exhaustive, and information may change after the report date. Readers should consult the original authoritative documents, current official notices and relevant professional advisers before making decisions or taking action. Assumptions, unresolved questions and coverage limitations are identified where relevant.'
CONTACT='For further details about this report or Bravestar, please contact angelograceffa77@gmail.com.'
def extract(path):
 if path.suffix.lower()=='.pdf':
  from pypdf import PdfReader
  return '\n'.join(p.extract_text() or '' for p in PdfReader(path).pages)
 if path.suffix.lower()=='.docx':
  with zipfile.ZipFile(path) as z:
   return ' '.join(n.text or '' for name in z.namelist() if re.match(r'word/(document|header\d+|footer\d+)\.xml$',name) for n in ET.fromstring(z.read(name)).iter() if n.tag.endswith('}t'))
 if path.suffix.lower() in ('.txt','.md'):return path.read_text(encoding='utf-8-sig')
 raise ValueError('Unsupported final format; perform and record manual verification')
def validate(text,minimum=None,maximum=None):
 normal=lambda s:re.sub(r'\s+','',s).casefold()
 errors=[]
 if normal(DISCLAIMER) not in normal(text):errors.append('Full disclaimer missing')
 if normal(CONTACT) not in normal(text):errors.append('Contact statement missing')
 if re.search(r'(?im)(confidence\s*(level|rating|score)?\s*[:\-–—]\s*(high|medium|low|\d)|\b(high|medium|low)\s+confidence\b|^\s*(?:#+\s*)?confidence\s*$)',text):errors.append('Client-facing confidence rating/section present')
 if minimum is not None and len(text)<minimum:errors.append('Applicable minimum length not met')
 if maximum is not None and len(text)>maximum:errors.append('Applicable maximum length exceeded')
 return dict(status='HOLD' if errors else 'PASS',characters=len(text),errors=errors,visualReviewRequired=True)
if __name__=='__main__':
 a=argparse.ArgumentParser();a.add_argument('artifact',type=Path);a.add_argument('--minimum',type=int);a.add_argument('--maximum',type=int);a.add_argument('--length-source');v=a.parse_args()
 if (v.minimum is not None or v.maximum is not None) and not v.length_source:a.error('Numerical constraints require --length-source; do not invent an industry standard')
 try:r=validate(extract(v.artifact),v.minimum,v.maximum)
 except Exception as e:r=dict(status='HOLD',errors=[str(e)])
 r['lengthRequirementSource']=v.length_source or 'No authoritative numerical requirement established; detailed completeness review required'
 print(json.dumps(r,indent=2));sys.exit(0 if r['status']=='PASS' else 1)
