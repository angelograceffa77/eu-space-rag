"""Public client discovery. Python 3 + openpyxl. No outreach, scheduling or publication."""
import argparse, collections, datetime, hashlib, html, json, pathlib, re, shutil, time, urllib.request, urllib.robotparser, urllib.parse, sys
import openpyxl
NOW=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(b): return hashlib.sha256(b).hexdigest()
def write(p,obj):
 p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(obj,ensure_ascii=False,indent=2),encoding='utf-8')
def norm(s): return re.sub(r'\W+','',str(s).lower())
AFRICA=set('Algeria|Angola|Benin|Botswana|Burkina Faso|Burundi|Cabo Verde|Cape Verde|Cameroon|Central African Republic|Chad|Comoros|Congo|Democratic Republic of the Congo|Republic of the Congo|Côte d’Ivoire|Côte d\'Ivoire|Ivory Coast|Djibouti|Egypt|Equatorial Guinea|Eritrea|Eswatini|Ethiopia|Gabon|Gambia|Ghana|Guinea|Guinea-Bissau|Kenya|Lesotho|Liberia|Libya|Madagascar|Malawi|Mali|Mauritania|Mauritius|Morocco|Mozambique|Namibia|Niger|Nigeria|Rwanda|São Tomé and Príncipe|Sao Tome and Principe|Senegal|Seychelles|Sierra Leone|Somalia|South Africa|South Sudan|Sudan|Tanzania|Togo|Tunisia|Uganda|Zambia|Zimbabwe'.split('|'))
# Business use cases are analyst hypotheses, never statements of demand.
RULES=[
 ('agriculture','agricultur|animal source|food production',['earth_observation','satellite_navigation'],'Crop, pasture and irrigation monitoring'),
 ('forestry','forest|paper|timber',['earth_observation'],'Forest inventory, fire exposure and land-use monitoring'),
 ('maritime','water transportation|fish|seafood|shipping',['earth_observation','satellite_navigation','satellite_communications'],'Vessel tracking, route planning and remote connectivity'),
 ('insurance-finance','bank|financ|insurance',['earth_observation','geospatial'],'Asset exposure, flood and crop-risk analysis'),
 ('transport-logistics','transport|freight|logistic|automobil|tires',['satellite_navigation','satellite_communications'],'Fleet positioning and connectivity'),
 ('energy','electric utilities|power producer|gas utilities|renewable|energy',['earth_observation','satellite_communications'],'Asset monitoring and remote-site connectivity'),
 ('mining','mining|mineral',['earth_observation','satellite_navigation'],'Surface-change monitoring and positioning'),
 ('water','water utilities',['earth_observation'],'Catchment, drought and water-quality indicators'),
 ('waste-environment','waste',['earth_observation','satellite_navigation'],'Site monitoring and collection routing'),
 ('construction-infrastructure','construction|building|real estate',['earth_observation','satellite_navigation'],'Site surveying and infrastructure change monitoring'),
 ('food-supply-chains','food|beverage|tobacco',['earth_observation','satellite_navigation'],'Agricultural sourcing exposure and shipment visibility'),
 ('retail-distribution','retail|trading|distributor',['satellite_navigation','geospatial'],'Distribution planning and location analytics'),
 ('tourism-hospitality','hotel|tourism|leisure',['satellite_communications','geospatial'],'Remote-property connectivity and environmental exposure'),
 ('telecommunications','telecommunication',['satellite_communications'],'Terrestrial network resilience; satellite-provider identity requires review'),
 ('healthcare','health|pharmaceut|biotech',['satellite_navigation','satellite_communications'],'Medical logistics and remote-service connectivity'),
 ('manufacturing-materials','equipment|machinery|chemicals|semiconductor|packaging|consumer durables|textile',['earth_observation','satellite_navigation'],'Facility climate exposure and supply-chain visibility'),
 ('professional-services','professional|software|media|education|specialized consumer',['geospatial'],'Geospatial products or customer analytics; indirect fit requires review')]
def classify(sector):
 for key,pattern,caps,use in RULES:
  if re.search(pattern,sector,re.I): return key,caps,use
 return 'unclassified',[],None
AFRICA.add('United Republic of Tanzania')
SEEDS=[
 ('Linfox','Australia','logistics','https://www.linfox.com/about-linfox/','privately owned'),
 ('MSC Group','Switzerland','shipping','https://www.mscgroup.com/en/about-us','privately owned'),
 ('NATCO Logistics','South Africa','logistics','https://natco.co.za/about-us/our-company/','privately owned'),
 ('Africa Insurance Company','Ethiopia','insurance','https://africainsurancesc.com/about-us/','privately owned'),
 ('NICE Insurance','Ethiopia','insurance','https://niceinsurance-et.com/about-us/','privately owned'),
 ('Linkham Group','Mauritius','insurance','https://linkham.com/','privately owned'),
 ('ORELYNX Mining & Technical Services','Ghana','mining','https://orelynx-mts.com/about/','privately owned'),
 ('TMK','Nigeria','mining','https://www.tmkmining.ng/about','privately owned'),
 ('M and J Mining','South Africa','mining','https://mjmining.com/about-us/','privately owned'),
 ('Safrica Logistics','South Africa','logistics','https://safrica-logistics.co.za/about-us/','privately owned'),
 ('Wild Africa Logistics','Tanzania','logistics','https://www.wildafricalogistics.com/about','privately owned'),
 ('Meili Logistics','South Africa','logistics','https://meili.co.za/','privately owned'),
 ('SARGE','South Africa','renewable energy','https://www.sarge.co.za/about/','privately owned'),
 ('Phelan Green Group','South Africa','renewable energy','https://phelangreen.com/company/','privately owned'),
 ('Dimsum Energy','South Africa','renewable energy','https://dimsumenergy.com/','privately owned'),
 ('Sahan Seafood','Somalia','seafood','https://sahanseafood.so/about-us/','privately owned'),
 ('Al Habib Fishing Company','Somalia','fishing','https://alhabibfishing.so/about-us/local-roots-global-vision/','privately owned')]
def fetch(url,folder):
 host=urllib.parse.urlsplit(url); robots=f'{host.scheme}://{host.netloc}/robots.txt'
 req=lambda u:urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'GagarinPublicClientResearch/1.0'}),timeout=35)
 try:
  with req(robots) as r: rb=r.read()
 except urllib.error.HTTPError as e:
  if e.code!=404: raise
  rb=b''
 rp=urllib.robotparser.RobotFileParser();rp.parse(rb.decode('utf-8','replace').splitlines())
 if not rp.can_fetch('GagarinPublicClientResearch',url):raise ValueError('robots restriction')
 time.sleep(max(1,rp.crawl_delay('*') or 0))
 with req(url) as r: b=r.read();final=r.url
 p=folder/(sha(url.encode())+'.html');p.write_bytes(b)
 (folder/(sha(url.encode())+'.robots.txt')).write_bytes(rb)
 return b,{'url':url,'finalUrl':final,'checkedAt':NOW(),'archiveFile':str(p),'sha256':sha(b)}
def clean(b):
 s=b.decode('utf-8','replace');s=re.sub(r'<(script|style)\b[^>]*>.*?</\1>',' ',s,flags=re.S|re.I)
 return re.sub(r'\s+',' ',html.unescape(re.sub('<[^>]+>',' ',s)))
def base(id,name,country,sector):
 key,caps,use=classify(sector)
 return dict(id=id,recordType='potential_private_client',name=name,country=country,countryMeaning='source_reported_location_not_operating_footprint',africa=country in AFRICA,sourceSector=sector,businessArea=key,ownership='unknown',nonSpaceBusinessStatus='sector_based_requires_identity_review',buyingIntent='unknown',budget=None,website=None,contactPage=None,operatingStatus='not_verified',useCase={'status':'analyst_hypothesis_not_confirmed_demand','description':use,'capabilityIds':caps},provenance=[])
def parts(folder,kind,rows):
 result=[];chunk=[];size=0
 def flush():
  if not chunk:return
  b=''.join(chunk).encode();file=f'{kind}.part-{len(result)+1:04}.jsonl';(folder/file).write_bytes(b);result.append(dict(file=file,rows=len(chunk),bytes=len(b),sha256=sha(b)))
 for r in rows:
  line=json.dumps(r,ensure_ascii=False,separators=(',',':'))+'\n';n=len(line.encode())
  if chunk and size+n>128*1024:flush();chunk=[];size=0
  chunk.append(line);size+=n
 flush();return result
def build(args):
 root=pathlib.Path(args.root);archive=pathlib.Path(args.archive);gen=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H-%M-%S-%fZ');run=archive/'Runs'/gen;run.mkdir(parents=True)
 original=run/'companies-excel.xlsx';shutil.copy2(args.xlsx,original);digest=sha(original.read_bytes());book=openpyxl.load_workbook(original,read_only=True,data_only=True);it=iter(book.active.values);header=next(it);records=[];excluded=[];seen=set()
 for ordinal,row in enumerate(it,2):
  if not row[0]:continue
  d={k:v for k,v in zip(header,row) if k};id='sbti:'+str(d['sbti_id'])
  if id in seen:raise ValueError('Duplicate source identity')
  seen.add(id);r=base(id,d['company_name'],d.get('location'),d.get('sector') or '')
  r.update(identifiers={k:d.get(k) for k in ['sbti_id','lei','isin']},organizationType=d.get('organization_type'),climateTargetStatus=d.get('near_term_status'),sourceUpdatedAt=str(d.get('date_updated')),provenance=[dict(url='https://files.sciencebasedtargets.org/production/files/companies-excel.xlsx',checkedAt=NOW(),archiveFile=str(original),sha256=digest,sheet='Data',row=ordinal)])
  if re.search('Aerospace|Public Agencies',r['sourceSector'],re.I):r['exclusionReason']='space_defence_or_public_agency_sector';excluded.append(r)
  else:records.append(r)
 book.close();errors=[]
 for name,country,sector,url,phrase in SEEDS:
  try:
   replay=pathlib.Path(args.replay_run)/(sha(url.encode())+'.html') if args.replay_run else None
   if replay:
    if not replay.is_file():raise ValueError('Previous collection failed; no reusable page evidence')
    b=replay.read_bytes();target=run/replay.name;shutil.copy2(replay,target);p=dict(url=url,checkedAt=datetime.datetime.fromtimestamp(replay.stat().st_mtime,datetime.timezone.utc).isoformat(),archiveFile=str(target),sha256=sha(b),replayedFrom=str(replay))
   else:b,p=fetch(url,run)
   s=clean(b);m=re.search(r'privately[ -]owned',s,re.I)
   if not m:raise ValueError('Ownership wording not reproduced')
   r=base('web:'+sha(url.encode())[:20],name,country,sector);r.update(website=url,ownership='source_asserts_private_ownership',nonSpaceBusinessStatus='reviewed_business_activity',ownershipEvidence={'excerpt':s[max(0,m.start()-50):m.end()+100],'verification':'official_company_self_description_not_registry_due_diligence'},provenance=[p])
   records.append(r)
  except Exception as e:errors.append({'url':url,'error':str(e)})
 # Supplementary LEI records remain unverified research leads, never verified private buyers.
 discovery_file=root.parent/'Periodic-Refresh'/'country-discovery.json'
 if discovery_file.exists():
  discovery=json.loads(discovery_file.read_text('utf-8'));source=pathlib.Path(discovery['recordsFile']);raw=source.read_bytes()
  if sha(raw)!=discovery['recordsSha256']:raise ValueError('Country discovery checksum')
  for line in raw.decode('utf-8').splitlines():
   lead=json.loads(line);name=lead['name']
   if re.search(r'\b(ministry|government|central bank|university|municipal|foundation|pension fund|trustee|sovereign)\b',name,re.I):continue
   r=base(lead['id'],name,lead['country'],name)
   r.update(recordType='client_research_lead',sourceSector='unverified; name-based research signal only',nonSpaceBusinessStatus='unverified_requires_activity_review',legalEntityIdentifier=lead['legalEntityIdentifier'],countryCode=lead['countryCode'],africa=lead['africa'],legalStatus=lead['legalStatus'],provenance=lead['provenance'],sourceUpdatedAt=lead['sourceUpdatedAt'],countryMeaning=lead.get('countryMeaning','legal_address_country'),businessActivityEvidence=lead.get('businessActivity','unverified'))
   records.append(r)
 # Never silently remove previous profiles merely because they were not observed.
 prior=root/'Client-Master'/'manifest.json'
 if prior.exists():
  pointer=json.loads(prior.read_text('utf-8'));previous=(prior.parent/pointer['path']).resolve()
  if not previous.is_relative_to(prior.parent.resolve()):raise ValueError('Previous path escape')
  if sha((previous/'manifest.json').read_bytes())!=pointer['manifestSha256']:raise ValueError('Previous manifest checksum')
  pm=validate(previous);current_ids={r['id'] for r in records}
  for part in pm['parts']:
   if part['file'].startswith('clients.'):
    for line in (previous/part['file']).read_text('utf-8').splitlines():
     r=json.loads(line)
     if r['id'] not in current_ids:r['observationStatus']='not_observed_this_run_retained_for_review';records.append(r);current_ids.add(r['id'])
 scope_file=root.parent/'Periodic-Refresh'/'procurement-scope.json'
 scope=json.loads(scope_file.read_text('utf-8')) if scope_file.exists() else {'countries':[]}
 names={x['name'] for x in scope['countries']};codes={x['code'] for x in scope['countries']}
 for r in records:r['inProcurementGeographicScope']=r['country'] in names or r.get('countryCode') in codes
 suppliers=[json.loads(l) for l in pathlib.Path(args.suppliers).read_text(encoding='utf-8').splitlines() if l];shutil.copy2(args.suppliers,run/'supplier-input.jsonl')
 # Keep source identities separate; expose possible duplicates instead of silently merging legal entities.
 groups=collections.defaultdict(list)
 for r in records:groups[(norm(r['name']),r['country'])].append(r['id'])
 for r in records:r['possibleDuplicateIds']=[x for x in groups[(norm(r['name']),r['country'])] if x!=r['id']]
 supplier_names={norm(s['name']) for s in suppliers}
 for r in records:
  r['matchingState']='research_lead_ownership_unverified' if r['ownership']=='unknown' else 'private_client_use_case_hypothesis'
  if r['businessArea']=='telecommunications':r['nonSpaceBusinessStatus']='mixed_sector_identity_review_required'
  if norm(r['name']) in supplier_names:r['nonSpaceBusinessStatus']='existing_supplier_name_overlap_review_required'
 out=root/'Client-Master'/'snapshots'/gen;out.mkdir(parents=True)
 pp=parts(out,'clients',records)+parts(out,'excluded',excluded)+parts(out,'supplier-profiles',suppliers)
 views=[]
 for sector,_,caps,use in RULES:
  clients=[r['id'] for r in records if r['businessArea']==sector];matches=[s['id'] for s in suppliers if set(s['capabilities'])&set(caps)]
  views.append(dict(id=sector,clientIds=clients,supplierProfileIds=matches,capabilityIds=caps,useCaseHypothesis=use,matchMeaning='Documented supplier capability versus sector hypothesis; delivery, demand and eligibility unverified'))
 pp+=parts(out,'sector-index',views)
 africa=[{'id':r['id'],'name':r['name'],'country':r['country'],'businessArea':r['businessArea'],'ownership':r['ownership']} for r in records if r['africa']]
 (out/'Africa').mkdir();ap=parts(out/'Africa','clients-index',africa)
 for p in ap:p['file']='Africa/'+p['file']
 pp+=ap
 counts={'clientProfiles':len(records),'sourceAssertedPrivate':sum(r['ownership']!='unknown' for r in records),'ownershipUnverified':sum(r['ownership']=='unknown' for r in records),'excludedProfiles':len(excluded),'africaProfiles':len(africa),'countries':len(set(r['country'] for r in records)),'supplierProfiles':len(suppliers),'businessAreas':len(set(r['businessArea'] for r in records))}
 manifest=dict(schemaVersion=1,generation=gen,asOf=NOW(),counts=counts,parts=pp,coverage='partial_not_exhaustive',sourceFailures=errors,countryCounts=dict(collections.Counter(r['country'] for r in records)),africaCountryCounts=dict(collections.Counter(r['country'] for r in records if r['africa'])),sectorCounts=dict(collections.Counter(r['businessArea'] for r in records)),limitations=['SBTi climate-participant selection bias; not a world business census','Most ownership, space-sector identity, operating status, budgets and buying intentions unverified','Supplier profiles are not deduplicated legal entities','Africa reflects source location, not all companies trading in Africa','No verified purchasing requests in this snapshot','Private ownership is an official website assertion, not independent legal verification'])
 coverage={'scopeSha256':scope.get('scopeSha256'),'countryResults':discovery.get('countries',[]) if discovery_file.exists() else [],'procurementEntities':[dict(entity,coverageStatus='not_a_client_population_source; discovery_scope_only',complete=False) for entity in scope.get('entities',[])],'allAfricanCountriesSearched':54 if discovery_file.exists() else 0,'completeCoverage':False}
 write(out/'procurement-scope-coverage.json',coverage)
 manifest['procurementScope']={'file':'procurement-scope-coverage.json','sha256':sha((out/'procurement-scope-coverage.json').read_bytes())}
 write(out/'manifest.json',manifest);validate(out)
 pointer=dict(schemaVersion=1,path='snapshots/'+gen,manifestSha256=sha((out/'manifest.json').read_bytes()))
 write(root/'Client-Master'/'manifest.tmp',pointer);(root/'Client-Master'/'manifest.tmp').replace(root/'Client-Master'/'manifest.json')
 write(root/'Africa'/'manifest.json',dict(master='../Client-Master/manifest.json',role='Resolve current master then Africa/clients-index shards; no duplicated authoritative records'))
 write(run/'receipt.json',manifest);print(json.dumps(counts));print(json.dumps(errors))
def validate(folder):
 m=json.loads((folder/'manifest.json').read_text(encoding='utf-8'));ids=set();counts=collections.Counter()
 if m.get('procurementScope'):
  meta=m['procurementScope'];f=(folder/meta['file']).resolve();assert f.is_relative_to(folder.resolve());assert sha(f.read_bytes())==meta['sha256']
 for p in m['parts']:
  f=(folder/p['file']).resolve()
  if not f.is_relative_to(folder.resolve()):raise ValueError('Path escape')
  b=f.read_bytes();assert sha(b)==p['sha256'];lines=b.decode('utf-8').splitlines();assert len(lines)==p['rows'];assert len(b)==p['bytes']
  for l in lines:
   r=json.loads(l)
   if p['file'].startswith('clients.'):
    assert r['id'] not in ids;ids.add(r['id']);assert r['buyingIntent']=='unknown';assert r['useCase']['status']=='analyst_hypothesis_not_confirmed_demand';counts['clients']+=1
 assert counts['clients']==m['counts']['clientProfiles']
 return m
def query(root,sector=None,africa=False,private=False,supplier=None):
 root=pathlib.Path(root);base=root/'Client-Master';p=json.loads((base/'manifest.json').read_text(encoding='utf-8'));folder=(base/p['path']).resolve();assert folder.is_relative_to(base.resolve());assert sha((folder/'manifest.json').read_bytes())==p['manifestSha256'];m=validate(folder);sectors=None
 if supplier:
  sectors=set()
  for part in m['parts']:
   if part['file'].startswith('sector-index.'):
    for l in (folder/part['file']).read_text(encoding='utf-8').splitlines():
     r=json.loads(l)
     if supplier in r['supplierProfileIds']:sectors.add(r['id'])
 for part in m['parts']:
  if part['file'].startswith('clients.'):
   for l in (folder/part['file']).read_text(encoding='utf-8').splitlines():
    r=json.loads(l)
    if sector and r['businessArea']!=sector:continue
    if africa and not r['africa']:continue
    if private and (r['ownership']=='unknown' or r['nonSpaceBusinessStatus']!='reviewed_business_activity'):continue
    if sectors is not None and r['businessArea'] not in sectors:continue
    print(json.dumps(r,ensure_ascii=False))
if __name__=='__main__':
 sys.stdout.reconfigure(encoding='utf-8')
 p=argparse.ArgumentParser();p.add_argument('command',choices=['build','query','validate']);p.add_argument('--root',required=True);p.add_argument('--archive');p.add_argument('--xlsx');p.add_argument('--suppliers');p.add_argument('--replay-run');p.add_argument('--sector');p.add_argument('--africa',action='store_true');p.add_argument('--private-only',action='store_true');p.add_argument('--include-unverified',action='store_true');p.add_argument('--supplier');a=p.parse_args()
 if a.command=='build':build(a)
 elif a.command=='query':query(a.root,a.sector,a.africa,a.private_only or not a.include_unverified,a.supplier)
 else:
  base=pathlib.Path(a.root)/'Client-Master';pointer=json.loads((base/'manifest.json').read_text(encoding='utf-8'));folder=base/pointer['path'];assert sha((folder/'manifest.json').read_bytes())==pointer['manifestSha256'];print(json.dumps(validate(folder)['counts']))
