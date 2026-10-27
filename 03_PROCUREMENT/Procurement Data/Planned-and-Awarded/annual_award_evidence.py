"""Archive annual award lists; uncertain table relations stay outside verified awards."""
import datetime,hashlib,html,json,pathlib,re,urllib.request,urllib.parse,io,sys
from pypdf import PdfReader
ROOT=pathlib.Path(__file__).resolve().parent
REPO=ROOT.parents[2]
ARCHIVE=REPO.parent/'03_PROCUREMENT/Procurement Data/Planned-and-Awarded/Annual-Lists'
def sha(b):return hashlib.sha256(b).hexdigest()
def links(b,url):
 return [(urllib.parse.urljoin(url,html.unescape(u)),re.sub('<[^>]+>',' ',html.unescape(t)).strip()) for u,t in re.findall(r'<a\b[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>',b.decode('utf-8',errors='replace'),re.I|re.S)]
def main():
 run=ARCHIVE/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S');run.mkdir(parents=True)
 queue=[('EEA','https://www.eea.europa.eu/en/about/procurement-and-grants/contracts-and-grants-awarded',0)]+[('EDA','https://eda.europa.eu/procurement/other-notices/annual-list-of-contractors-'+str(y),0) for y in range(2020,datetime.date.today().year)]
 queue += [('EDA','https://eda.europa.eu/docs/default-source/procurement-library/'+name,0) for name in ['annual-list-of-contractors-2020.pdf','annual-list-of-contractors-2020-sc.pdf','annual-list-of-contracts-2025.pdf?Status=Master','annual-list-of-specific-contracts-2025.pdf?Status=Master']]
 seen=set();results=[];pending=[]
 while queue and len(seen)<80:
  entity,url,depth=queue.pop(0)
  if url in seen:continue
  seen.add(url)
  try:
   req=urllib.request.Request(url,headers={'User-Agent':'Gagarin-Public-Award-Archive/1.0'})
   with urllib.request.urlopen(req,timeout=25) as r:b=r.read(20*1024*1024+1);final=r.url
   if len(b)>20*1024*1024:raise ValueError('Response too large')
   ext='.pdf' if b.startswith(b'%PDF') else '.html';f=run/(sha(b)+ext)
   if not f.exists():f.write_bytes(b)
   ev={'entity':entity,'url':url,'finalUrl':final,'file':str(f),'sha256':sha(b),'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'downloaded_document' if ext=='.pdf' else 'downloaded_listing'};results.append(ev)
   if ext=='.pdf':
    for i,page in enumerate(PdfReader(io.BytesIO(b)).pages):
     text=page.extract_text() or ''
     if re.search(r'satellit|copernicus|earth observation|GNSS|geoint|spacecraft|remote sensing',text,re.I):pending.append({'entity':entity,'recordType':'annual_award_document_requires_table_review','page':i+1,'text':text,'evidence':ev,'excludedFromOpenCount':True,'excludedFromVerifiedAwardCount':True,'reason':'Winner, amount, date and contract/lot relation must be verified; annual year is not an exact award date.'})
   elif depth<2:
    for link,label in links(b,final):
     if urllib.parse.urlparse(link).hostname!=urllib.parse.urlparse(url).hostname:continue
     target=urllib.parse.urlparse(link).path.rsplit('/',1)[-1]+' '+label
     if not re.search(r'202[0-9]',target):continue
     if 'grant' in target.lower():continue
     if re.search(r'contract.*award|list.of.contract|annual.list|@@download|/download',target,re.I):queue.append((entity,link,depth+1))
  except Exception as e:results.append({'entity':entity,'url':url,'status':'failed','error':str(e)})
 report={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'from':'2020-01-01','sources':results,'pendingDocumentPages':len(pending),'verifiedAwardsAdded':0,'complete':False,'remainingQueue':len(queue),'traversalBoundReached':bool(queue)}
 (run/'pending.jsonl').write_text(''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in pending),encoding='utf-8');(run/'receipt.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
 (ROOT/'annual-list-coverage.json').write_text(json.dumps({**report,'archiveRun':str(run)},indent=2),encoding='utf-8');print(json.dumps({'sources':len(results),'documents':sum(x['status']=='downloaded_document' for x in results),'pendingPages':len(pending),'failed':sum(x['status']=='failed' for x in results)}))
if __name__=='__main__':main()
