"""Reproducible annual-table disclosures, separate from dated individual award counts."""
import pathlib,json,re,hashlib,datetime,argparse
import pdfplumber
def sha(b):return hashlib.sha256(b).hexdigest()
def clean(v):return re.sub(r'\s+',' ',v or '').strip()
def extract(receipt):
 rows=[];gaps=[];seen=set()
 for ev in receipt['sources']:
  if ev['status']!='downloaded_document' or ev['sha256'] in seen:continue
  seen.add(ev['sha256']);b=pathlib.Path(ev['file']).read_bytes()
  if sha(b)!=ev['sha256']:raise ValueError('Original document changed')
  if ev['entity']=='EUSPA':
   from euspa_disclosures import extract as euspa_extract
   rr,gg=euspa_extract(ev);rows.extend(rr);gaps.extend(gg);continue
  with pdfplumber.open(ev['file']) as pdf:
   text='\n'.join(p.extract_text() or '' for p in pdf.pages)
   year=re.search(r'Annual\s+List\s+of\s+(?:Specific\s+)?Contracts\s+(202\d)',text,re.I)
   if not year:gaps.append({'source':ev['url'],'reason':'Not an identified annual contract list; grants remain separate'});continue
   year=int(year[1]);header=None
   for pi,page in enumerate(pdf.pages):
    for ti,table in enumerate(page.extract_tables()):
     for ri,cells in enumerate(table):
      labels=[clean(x).lower() for x in cells]
      if ev['entity']=='EDA' and year==2020 and 'contractors-2020-sc.pdf' in ev['url'] and len(labels)==7 and labels[4:7]==['subject','contractor','value']:labels[1]='framework contract reference number';labels[2]='merged header'
      if any('contractor' in x for x in labels) and any('subject' in x or 'description' in x for x in labels):header=labels;continue
      if not header or len(cells)!=len(header):continue
      def col(pattern):return next((clean(cells[i]) for i,h in enumerate(header) if re.search(pattern,h)),None)
      title=col('subject|description');winner=col('^contractor(?: name)?$');ref=col('reference');amount=col('value|amount')
      if not all([title,winner,ref,amount]) or not re.search(r'\d',ref):continue
      if not re.search(r'satellit|satcom|copernicus|earth observation|GNSS|geoint|spacecraft|remote sensing|defence in space|geohub',title+' '+ref,re.I):continue
      rows.append({'id':'annual:'+ev['entity']+':'+str(year)+':'+sha((ev['sha256']+str(pi)+str(ti)+str(ri)).encode())[:20],'recordType':'annual_contract_disclosure','buyer':ev['entity'],'reportingYear':year,'awardDate':None,'dateMeaning':'Annual reporting year; exact award date not established','contractReference':ref,'description':title,'contractorNameAsPublished':winner,'amountAsPublished':amount,'currency':'EUR' if any('euro' in x for x in header) or '€' in amount else None,'valueMeaning':'Source annual disclosure; may be combined specific contracts or amendments. Not allocated to consortium members; do not sum with TED awards.','excludedFromOpenCount':True,'excludedFromDatedAwardCount':True,'sourceUrl':ev['url'],'evidence':ev,'sourcePointer':{'page':pi+1,'table':ti+1,'row':ri+1},'sourceHeaders':header,'sourceCells':cells,'companyIdentityVerified':False})
 return rows,gaps
def main():
 p=argparse.ArgumentParser();p.add_argument('--receipt');p.add_argument('--verify',action='store_true');p.add_argument('--output',required=True);a=p.parse_args();
 if a.verify:
  out=pathlib.Path(a.output);m=json.loads((out/'manifest.json').read_text());receipt=pathlib.Path(m['inputReceipt']['file']);raw=receipt.read_bytes()
  if sha(raw)!=m['inputReceipt']['sha256']:raise ValueError('Receipt changed')
  expected,_=extract(json.loads(raw));actual=[]
  for part in m['parts']:
   f=(out/part['file']).resolve()
   if not f.is_relative_to(out.resolve()):raise ValueError('Path escape')
   b=f.read_bytes()
   if sha(b)!=part['sha256'] or len(b)!=part['bytes']:raise ValueError('Part integrity')
   actual.extend(json.loads(line) for line in b.decode().split('\n') if line)
  if actual!=expected or len(actual)!=m['records']:raise ValueError('Original table extraction differs')
  print('Annual disclosures reproduced from original documents: '+str(len(actual)));return
 rows,gaps=extract(json.loads(pathlib.Path(a.receipt).read_text()));out=pathlib.Path(a.output);out.mkdir(parents=True,exist_ok=True);generation=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%f');prefix='snapshots/'+generation+'/';folder=out/'snapshots'/generation;folder.mkdir(parents=True);parts=[];chunk=[];size=0
 if not rows:raise ValueError('No qualified disclosure rows; prior package retained')
 prior=out/'manifest.json'
 if prior.exists() and len(rows)<json.loads(prior.read_text())['records']*.8:raise ValueError('Unexpected disclosure loss; prior package retained')
 def flush():
  if not chunk:return
  b=('\n'.join(chunk)+'\n').encode();name='disclosures.part-'+str(len(parts)+1).zfill(4)+'.jsonl';(folder/name).write_bytes(b);parts.append({'file':prefix+name,'rows':len(chunk),'sha256':sha(b),'bytes':len(b)})
 for r in rows:
  line=json.dumps(r,ensure_ascii=False)
  if size+len(line.encode())>180000:flush();chunk=[];size=0
  chunk.append(line);size+=len(line.encode())+1
 flush();m={'dataset':'annual_contract_disclosures','inputReceipt':{'file':a.receipt,'sha256':sha(pathlib.Path(a.receipt).read_bytes())},'asOf':datetime.datetime.now(datetime.timezone.utc).isoformat(),'records':len(rows),'parts':parts,'excludedFromOpenCount':True,'excludedFromDatedAwardCount':True,'completeCoverage':False,'gaps':gaps,'retrievalRule':'Use annual reporting year, not an invented award date. Keep distinct from individual dated awards and prevent double counting.'};(out/'manifest.tmp').write_text(json.dumps(m,indent=2),encoding='utf-8');(out/'manifest.tmp').replace(out/'manifest.json');print(json.dumps({'disclosures':len(rows),'parts':len(parts),'unqualifiedDocuments':len(gaps)}))
if __name__=='__main__':main()
