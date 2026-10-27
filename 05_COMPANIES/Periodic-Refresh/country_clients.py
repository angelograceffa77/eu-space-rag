"""GLEIF legal-entity discovery, not verified private-client demand. Public API only."""
import pathlib,json,urllib.request,urllib.parse,hashlib,datetime,time,concurrent.futures,argparse,re
AFRICA=dict(x.split(':',1) for x in 'DZ:Algeria|AO:Angola|BJ:Benin|BW:Botswana|BF:Burkina Faso|BI:Burundi|CV:Cabo Verde|CM:Cameroon|CF:Central African Republic|TD:Chad|KM:Comoros|CG:Congo|CD:Democratic Republic of the Congo|CI:CÃ´te d\'Ivoire|DJ:Djibouti|EG:Egypt|GQ:Equatorial Guinea|ER:Eritrea|SZ:Eswatini|ET:Ethiopia|GA:Gabon|GM:Gambia|GH:Ghana|GN:Guinea|GW:Guinea-Bissau|KE:Kenya|LS:Lesotho|LR:Liberia|LY:Libya|MG:Madagascar|MW:Malawi|ML:Mali|MR:Mauritania|MU:Mauritius|MA:Morocco|MZ:Mozambique|NA:Namibia|NE:Niger|NG:Nigeria|RW:Rwanda|ST:Sao Tome and Principe|SN:Senegal|SC:Seychelles|SL:Sierra Leone|SO:Somalia|ZA:South Africa|SS:South Sudan|SD:Sudan|TZ:Tanzania|TG:Togo|TN:Tunisia|UG:Uganda|ZM:Zambia|ZW:Zimbabwe'.split('|'))
def stamp():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(b):return hashlib.sha256(b).hexdigest()
def write(p,x):
 p.parent.mkdir(parents=True,exist_ok=True);t=p.with_suffix(p.suffix+'.tmp');t.write_text(json.dumps(x,ensure_ascii=False,indent=2),encoding='utf-8');t.replace(p)
def collect(code,name,folder,max_pages):
 folder.mkdir(parents=True,exist_ok=True);receipt=folder/'receipt.json'
 if receipt.exists():
  old=json.loads(receipt.read_text('utf-8'))
  if old['status'] in ['reconciled_source_subset','bounded_partial']:
   for e in old['pages']:
    if sha(pathlib.Path(e['archiveFile']).read_bytes())!=e['sha256']:raise ValueError('Saved evidence changed')
   return old
 rows=[];pages=[];total=None;seen=set();result={'countryCode':code,'country':name,'pages':pages,'records':rows,'completeCountryCoverage':False}
 try:
  for page in range(1,max_pages+1):
   url='https://api.gleif.org/api/v1/lei-records?'+urllib.parse.urlencode({'filter[entity.legalAddress.country]':code,'filter[entity.category]':'GENERAL','filter[entity.status]':'ACTIVE','page[size]':200,'page[number]':page,'sort':'lei'})
   saved=folder/('page-%04d.json'%page)
   if saved.exists():b=saved.read_bytes()
   else:
    for attempt in range(3):
     try:
      with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'GagarinPublicEntityResearch/1.0'}),timeout=45) as r:b=r.read()
      json.loads(b);saved.write_bytes(b);break
     except Exception:
      if attempt==2:raise
      time.sleep(2**attempt)
   x=json.loads(b);t=x['meta']['pagination']['total']
   if total is not None and t!=total:raise ValueError('Changing source inventory')
   total=t;ev={'url':url,'archiveFile':str(saved),'sha256':sha(b),'checkedAt':stamp()};pages.append(ev)
   for raw in x['data']:
    a=raw['attributes'];e=a['entity'];lei=a['lei']
    if lei in seen:raise ValueError('Duplicate source identity')
    seen.add(lei)
    if e['legalAddress']['country']!=code:raise ValueError('Wrong country returned')
    rows.append({'id':'gleif:'+lei,'recordType':'legal_entity_research_lead','name':e['legalName']['name'],'country':name,'countryCode':code,'africa':code in AFRICA,'legalEntityIdentifier':lei,'registrationIdentifier':e.get('registeredAs'),'legalForm':e.get('legalForm'),'legalStatus':e.get('status'),'sourceCategory':e.get('category'),'sourceUpdatedAt':a.get('registration',{}).get('lastUpdate'),'ownership':'unknown','businessActivity':'unverified','buyingIntent':'unknown','website':None,'provenance':[dict(ev,jsonPointer='/data/'+str(len(rows)%200))]})
   if len(seen)==total:break
   if not x['data']:raise ValueError('Unexpected empty page')
   time.sleep(.3)
  result.update(status='reconciled_source_subset' if len(seen)==total else 'bounded_partial',sourceTotal=total,received=len(seen),limitPages=max_pages,limitation='Only LEI-registered active GENERAL entities; ownership, sector and demand unverified. Not a business census.')
 except Exception as e:result.update(status='failed_partial' if rows else 'failed',error=str(e),received=len(rows),sourceTotal=total)
 write(receipt,result);print(code,result['status'],len(rows),flush=True);return result
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--scope',required=True);ap.add_argument('--archive',required=True);ap.add_argument('--output',required=True);ap.add_argument('--run-id',required=True);a=ap.parse_args()
 scope=json.loads(pathlib.Path(a.scope).read_text());countries={x['code']:x['name'] for x in scope['countries']};countries.update(AFRICA)
 run=pathlib.Path(a.archive)/a.run_id
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:results=list(pool.map(lambda c:collect(c[0],c[1],run/c[0],100 if c[0] in AFRICA else 1),sorted(countries.items())))
 out=pathlib.Path(a.output);out.mkdir(parents=True,exist_ok=True)
 allrows=[r for x in results for r in x['records']]
 # An operating-location lead supplements the country with no LEI results. It is not classified as privately owned.
 url='https://www.zijinmining.com/global/program-detail-71760.htm'
 try:
  with urllib.request.urlopen(url,timeout=35) as response:page=response.read()
  text=page.decode('utf-8',errors='replace')
  if 'Bisha' not in text or 'Eritrea' not in text:raise ValueError('Bisha location evidence changed')
  fp=run/'ER'/'zijin-bisha.html';fp.write_bytes(page)
  allrows.append({'id':'official-operation:zijin-bisha','recordType':'commercial_operation_research_lead','name':'Zijin Mining - Bisha Copper-Zinc Mine operation','country':'Eritrea','countryCode':'ER','africa':True,'legalEntityIdentifier':None,'legalStatus':'unverified','sourceUpdatedAt':None,'ownership':'unknown','businessActivity':'mining','countryMeaning':'operating_location_not_parent_headquarters','provenance':[{'url':url,'archiveFile':str(fp),'sha256':sha(page),'checkedAt':stamp()}]})
 except Exception as e:
  write(run/'ER'/'supplementary-gap.json',{'url':url,'error':str(e)})
  fallback='https://www.goafricaonline.com/er/329853-bisha-mining-company-asmara-erythree'
  try:
   with urllib.request.urlopen(urllib.request.Request(fallback,headers={'User-Agent':'Gagarin-Public-Directory-Research/1.0'}),timeout=35) as response:page=response.read()
   content=page.decode('utf-8',errors='replace').lower()
   if 'bisha' not in content or not any(v in content for v in ['eritrea','erythree','érythrée']):raise ValueError('Secondary directory identity/location unverified')
   fp=run/'ER'/'goafrica-bisha.html';fp.write_bytes(page)
   allrows.append({'id':'secondary-directory:goafrica-bisha','recordType':'legal_entity_research_lead','name':'Bisha Mining Company','country':'Eritrea','countryCode':'ER','africa':True,'legalEntityIdentifier':None,'legalStatus':'unverified','sourceUpdatedAt':None,'ownership':'unknown','businessActivity':'secondary_directory_mining_claim_unverified','countryMeaning':'secondary_directory_reported_address_unverified','provenance':[{'url':fallback,'archiveFile':str(fp),'sha256':sha(page),'checkedAt':stamp()}]})
  except Exception as secondary:write(run/'ER'/'secondary-gap.json',{'url':fallback,'error':str(secondary)})
 b=''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in allrows).encode();(run/'records.jsonl').write_bytes(b)
 summary={'schemaVersion':1,'checkedAt':stamp(),'source':'https://www.gleif.org/en/lei-data/gleif-api','africanCountryDefinition':'54 African UN member states','countryListSource':'https://www.un.org/dgacm/en/content/regional-groups','additionalTerritories':[{'code':'EH','name':'Western Sahara','status':'separate disputed-territory scope; source qualification pending'}],'scopeSha256':scope['scopeSha256'],'countries':[{k:v for k,v in x.items() if k not in ['records','pages']} for x in results],'recordsFile':str(run/'records.jsonl'),'recordsSha256':sha(b),'records':len(allrows),'completeCoverage':False}
 write(out/'country-discovery.json',summary);print(json.dumps({'countries':len(results),'africanCountries':len(AFRICA),'records':len(allrows),'failures':sum(x['status'].startswith('failed') for x in results)}))
if __name__=='__main__':main()
