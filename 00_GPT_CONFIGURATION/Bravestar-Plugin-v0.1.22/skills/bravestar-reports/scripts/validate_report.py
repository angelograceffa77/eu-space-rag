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
def validate(text,body,report_format,minimum=None,maximum=None,length_source=None,role='report'):
 normal=lambda s:re.sub(r'\s+','',s).casefold()
 errors=[]
 if normal(DISCLAIMER) not in normal(text):errors.append('Full disclaimer missing')
 if normal(CONTACT) not in normal(text):errors.append('Contact statement missing')
 if re.search(r'(?im)(confidence\s*(level|rating|score)?\s*[:\-–—]\s*(high|medium|low|\d)|\b(high|medium|low)\s+confidence\b|^\s*(?:#+\s*)?confidence\s*$)',text):errors.append('Client-facing confidence rating/section present')
 if report_format not in ('executive-standard','detailed-report'):errors.append('Choose a report format')
 if role not in ('report','contract','annex'):errors.append('Invalid document role')
 if (minimum is not None or maximum is not None or role!='report') and not length_source:errors.append('A sourced requirement or documented exemption is required')
 if minimum is not None and minimum<0 or maximum is not None and maximum<0:errors.append('Negative length constraint')
 if minimum is not None and maximum is not None and minimum>maximum:errors.append('Conflicting length limits')
 if role=='report' and not body.strip():errors.append('Reviewed substantive text is required')
 # Match each selected content line in order; permit whitespace changes from PDF wrapping.
 remaining=normal(text)
 for line in body.splitlines():
  part=normal(line)
  if not part:continue
  at=remaining.find(part)
  if at<0:errors.append('Substantive extract does not match final artifact');break
  remaining=remaining[at+len(part):]
 if normal(DISCLAIMER) in normal(body) or normal(CONTACT) in normal(body):errors.append('Exclude disclaimer/contact from substantive count')
 count=len(body.strip())
 required=minimum if minimum is not None else (None if role!='report' or maximum is not None else (4000 if report_format=='executive-standard' else 12000))
 if required is not None and count<required:errors.append('Substantive minimum length not met')
 if maximum is not None and count>maximum:errors.append('Substantive maximum length exceeded')
 if role=='contract' and normal('Initial draft—professional legal review required before use or signature.') not in normal(text):errors.append('Contract warning missing')
 return dict(status='HOLD' if errors else 'PASS',substantiveCharacters=count,format=report_format,minimum=required,maximum=maximum,lengthRequirementSource=length_source or 'Bravestar editorial default, not an industry standard',errors=errors,visualReviewRequired=True,readabilityReviewRequired=True,substantiveSelectionReviewRequired=True)
if __name__=='__main__':
 a=argparse.ArgumentParser();a.add_argument('artifact',type=Path);a.add_argument('--format',required=True,choices=['executive-standard','detailed-report']);a.add_argument('--substantive-text',type=Path,required=True);a.add_argument('--minimum',type=int);a.add_argument('--maximum',type=int);a.add_argument('--length-source');a.add_argument('--role',default='report',choices=['report','contract','annex']);v=a.parse_args()
 try:r=validate(extract(v.artifact),v.substantive_text.read_text(encoding='utf-8-sig'),v.format,v.minimum,v.maximum,v.length_source,v.role)
 except Exception as e:r=dict(status='HOLD',errors=[str(e)])
 print(json.dumps(r,indent=2));sys.exit(0 if r['status']=='PASS' else 1)
