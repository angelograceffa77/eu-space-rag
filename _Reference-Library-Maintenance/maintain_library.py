import pathlib,os,json,time,hashlib,re,csv,io,html,urllib.parse,argparse,datetime,msvcrt
from zipfile import ZipFile
from pypdf import PdfReader
EXT={'.pdf','.docx','.doc','.html','.htm','.rtf','.txt','.md'}
SKIP={'procurement data','funding data','node_modules','.git','_reference-library','_procurement-process-library','generated','snapshots','cache','checkpoints','logs','state','outputs','output','__pycache__','raw','evidence','collection-runs'}
AREAS=['01_POLICY','02_LAW','03_PROCUREMENT','04_FUNDING']
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def read(p,default=None):return json.loads(p.read_text('utf-8-sig')) if p.exists() else default
def atomic(p,s):
 p.parent.mkdir(parents=True,exist_ok=True);t=p.with_name(p.name+'.maintenance.tmp');t.write_text(s,encoding='utf-8');os.replace(t,p)
def save(p,x):atomic(p,json.dumps(x,ensure_ascii=False,indent=2))
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def slug(s):return re.sub('-+','-',re.sub(r'[<>:"/\\|?*\s\x00-\x1f]+','-',s)).strip(' .-')
def csvtext(rows):
 b=io.StringIO();keys=list(dict.fromkeys(k for x in rows for k in x))
 if keys:
  w=csv.DictWriter(b,fieldnames=keys);w.writeheader();w.writerows([{k:json.dumps(v,ensure_ascii=False) if isinstance(v,(list,dict)) else v for k,v in x.items()} for x in rows])
 return '\ufeff'+b.getvalue()
def scan(root):
 files={}
 for a in AREAS:
  for base,dirs,names in os.walk(root/a):
   dirs[:]=[d for d in dirs if d.lower() not in SKIP and not d.startswith('.') and not (pathlib.Path(base)/d).is_symlink() and not ((pathlib.Path(base)/d).stat().st_file_attributes&0x400)]
   for name in names:
    p=pathlib.Path(base)/name
    if p.suffix.lower() not in EXT or name.startswith(('00-','~$','.')) or name.upper().startswith(('README','AGENTS','REFERENCE-GUIDE','FOLDER-GUIDE')) or name.endswith(('.pdf.txt','.html.txt','.docx.txt','.doc.txt')):continue
    st=p.stat()
    if p.is_symlink() or st.st_file_attributes&0x400:continue
    files[p.relative_to(root).as_posix()]=[st.st_size,st.st_mtime_ns]
 return files
def catalogue_paths(root):
 out=[]
 for a in AREAS:
  idx=root/a/('_Procurement-Process-Library' if a=='03_PROCUREMENT' else '_Reference-Library')
  if (idx/'document-catalogue.json').exists():out.append(idx/'document-catalogue.json')
 for a,f in [('01_POLICY','secondary sources'),('02_LAW','template agreements')]:
  p=root/a/f/'_Reference-Library/document-catalogue.json'
  if p.exists():out.append(p)
 return out
def fullpath(root,cp,x):
 p=x['path'];return root/p if p.split('/')[0] in AREAS else root/'03_PROCUREMENT'/p
def discover(root,p):
 title=p.stem;ids=re.findall(r'CELEX[_ :]*[0-9][A-Z0-9]+(?:-\d{8})?',title,re.I);text=''
 if p.suffix.lower()=='.pdf':
  pdf=PdfReader(p);assert len(pdf.pages)>0;text=(pdf.pages[0].extract_text() or '')[:4000]
 elif p.suffix.lower()=='.docx':
  with ZipFile(p) as z:assert 'word/document.xml' in z.namelist()
 if re.fullmatch(r'(download|document|file|scan|[0-9_-]+)(?:\s*\(\d+\))?',title,re.I) and text:
  title=next((s.strip() for s in text.splitlines() if 20<len(s.strip())<180),title)
 rel=p.relative_to(root);parts=rel.parts;entity='Da-verificare'
 for marker in ['National law','Member States','National-Funding','Other-European-Countries']:
  if marker in parts and parts.index(marker)+1<len(parts)-1:entity=parts[parts.index(marker)+1]
 for label in ['ESA','EUSPA','European-Space-Agency','European-Union','EUMETSAT','NATO','ECMWF','EUREKA']:
  if label in parts:entity=label
 typ='Reference'
 if 'secondary sources' in parts:typ='Secondary-Source'
 elif 'template agreements' in parts:typ='Agreement-Template'
 h=digest(p)
 if '__' in p.stem:
  tokens=p.stem.split('__');entity=tokens[0];title=' '.join(tokens[2:-1]) or title
  target=p
 else:
  prefix=slug(entity)+'__'+typ+'__'+('-'.join(slug(i) for i in ids)+'__' if ids else '')
  room=max(12,245-len(str(p.parent))-len(prefix)-len(p.suffix)-14)
  target=p.with_name(prefix+slug(title)[:room]+'__'+h[:10]+p.suffix.lower())
 return target,dict(title=title,description='Documento aggiunto automaticamente; verificare titolo, ente, tipo, fonte e versione.',entities=[entity],documentType=typ,officialIdentifiers=ids,originalPath=rel.as_posix(),originalFilename=p.name,sha256=h,sourceUrls=[],role='automatic_metadata_requires_review',retrievedAt=None,detectedAt=now(),textCompanion=None)
def render(root,cp,rows):
 base=cp.parent.parent;body=[]
 for x in rows:
  p=fullpath(root,cp,x);href=urllib.parse.quote(os.path.relpath(p,base).replace('\\','/'),safe='/')
  values=[' | '.join(x.get('entities',[])) or x.get('entityLabel',''),x.get('documentType','Reference'),x.get('title',p.stem),' | '.join(x.get('officialIdentifiers',[])),x.get('originalFilename','')]
  body.append('<tr><td>'+html.escape(values[0])+'</td><td>'+html.escape(values[1])+'</td><td><a href="'+href+'">'+html.escape(values[2])+'</a><p>'+html.escape(x.get('description',''))+'</p></td><td>'+html.escape(values[3])+'</td><td>'+html.escape(values[4])+'</td></tr>')
 links='<a href="'+cp.parent.name+'/document-catalogue.csv">CSV</a> Â· <a href="'+cp.parent.name+'/document-catalogue.jsonl">JSONL</a>'
 for extra in ['entity-coverage.csv','all-files-index.csv','automatic-maintenance.json']:
  if (cp.parent/extra).exists():links+=' Â· <a href="'+cp.parent.name+'/'+extra+'">'+extra+'</a>'
 for folder in ['secondary sources','template agreements']:
  if (base/folder/'00-DOCUMENT-INDEX.html').exists():links+=' Â· <a href="'+urllib.parse.quote(folder)+'/00-DOCUMENT-INDEX.html">'+folder+'</a>'
 page='<!doctype html><html lang="it"><meta charset="utf-8"><title>Indice documenti</title><style>body{font:16px system-ui;margin:2rem}td,th{padding:10px;vertical-align:top;text-align:left;border-bottom:1px solid #ddd}input{width:80%;padding:12px}p{font-size:14px}</style><h1>'+html.escape(base.name)+'</h1><p>'+str(len(rows))+' documenti e riferimenti disponibili. Aggiornato '+now()+'. Metadati automatici da verificare; nessuna certificazione della validitÃ  giuridica.</p><p>'+links+'</p><input id="q" aria-label="Cerca" placeholder="Ente, titolo, identificatore o vecchio nome"><table><thead><tr><th>Ente</th><th>Tipo</th><th>Documento</th><th>Identificatori</th><th>Nome originale</th></tr></thead><tbody>'+''.join(body)+'</tbody></table><script>document.getElementById("q").oninput=e=>document.querySelectorAll("tbody tr").forEach(r=>r.hidden=!r.textContent.toLowerCase().includes(e.target.value.toLowerCase()));</script></html>'
 atomic(base/'00-DOCUMENT-INDEX.html',page)
def tick(root,state,initialize=False):
 st=read(state/'state.json',{});files=scan(root);previous=st.get('files',{});pending=st.get('pending',{});events=[];errors=[]
 cps=catalogue_paths(root);cats={p:read(p,[]) for p in cps};versions={p:p.stat().st_mtime_ns for p in cps}
 known={fullpath(root,cp,x).relative_to(root).as_posix():x for cp,rows in cats.items() for x in rows}
 if initialize and not st:save(state/'state.json',dict(files=files,pending={},initializedAt=now()));return {'initialized':True,'baselineFiles':len(files)}
 journal=read(state/'pending-additions.json',[])
 additions=[x for x in journal if (root/x['path']).exists()];moves={}
 for rel,sig in files.items():
  if rel in known or rel in previous or any(x['path']==rel for x in additions):continue
  if pending.get(rel)!=sig:continue
  p=root/rel
  try:
   target,x=discover(root,p)
   renamed=[(old,r) for old,r in known.items() if old.split('/')[0]==rel.split('/')[0] and not (root/old).exists() and r.get('sha256')==x['sha256']]
   if len(renamed)==1:
    old,r=renamed[0];x=dict(r);x['previousLocalPaths']=list(dict.fromkeys(r.get('previousLocalPaths',[])+[old]));x['renamedAt']=now();target=p
    if x.get('textCompanion'):
     companion=root/x['textCompanion'] if x['textCompanion'].split('/')[0] in AREAS else root/'03_PROCUREMENT'/x['textCompanion']
     if not companion.exists():x['textCompanion']=None
   assert p.stat().st_size==sig[0] and p.stat().st_mtime_ns==sig[1]
   assert target.resolve().is_relative_to((root/rel.split('/')[0]).resolve())
   if target!=p and target.exists():raise ValueError('Collisione: destinazione giÃ  esistente')
   x['path']=target.relative_to(root).as_posix()
   journal.append(x);save(state/'pending-additions.json',journal)
   if target!=p:
    if target.exists():raise ValueError('Collisione: destinazione giÃ  esistente')
    p.rename(target);moves[rel]=target.relative_to(root).as_posix()
    companion=p.with_name(p.name+'.txt')
    if companion.exists() and not target.with_name(target.name+'.txt').exists():companion.rename(target.with_name(target.name+'.txt'))
   x['path']=target.relative_to(root).as_posix();additions.append(x);events.append(dict(action='added',old=rel,new=x['path'],sha256=x['sha256']))
  except Exception as e:errors.append(dict(path=rel,error=str(e)))
 for cp,rows in cats.items():
  dirty=state/'dirty'/cp.relative_to(root)
  out=[];changed=dirty.exists();scope=cp.parent.parent;isproc=scope.name=='03_PROCUREMENT'
  for x in rows:
   p=fullpath(root,cp,x);rel=p.relative_to(root).as_posix()
   if not p.exists():events.append(dict(action='removed_from_index',path=rel,catalogue=str(cp)));changed=True;continue
   # Update modified originals but never rename a known operationally referenced file.
   if rel in files and previous.get(rel)!=files[rel] and pending.get(rel)==files[rel]:
    try:
     h=digest(p)
     if h!=x.get('sha256'):x['sha256']=h;x['contentChangedAt']=now();x['role']='changed_content_requires_review';changed=True
    except OSError:pass
   if x.get('textCompanion'):
    t=pathlib.Path(x['textCompanion']);t=root/t if t.parts[0] in AREAS else root/'03_PROCUREMENT'/t
    if not t.exists():x['textCompanion']=None;changed=True
   out.append(x)
  for x in additions:
   if (root/x['path']).is_relative_to(scope) and not any(fullpath(root,cp,r)==root/x['path'] for r in out):
    y=dict(x)
    if isproc:y['path']=(root/y['path']).relative_to(scope).as_posix()
    out.append(y);changed=True
  if not changed:continue
  if cp.stat().st_mtime_ns!=versions[cp]:raise RuntimeError('Catalogo modificato da un altro processo; nuovo tentativo al prossimo controllo')
  for x in out:assert fullpath(root,cp,x).is_file()
  save(dirty,dict(startedAt=now()))
  save(state/'previous-catalogues'/cp.relative_to(root),rows)
  save(cp,out);atomic(cp.with_suffix('.jsonl'),''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in out));atomic(cp.with_suffix('.csv'),csvtext(out))
  save(cp.parent/'automatic-maintenance.json',dict(updatedAt=now(),documents=len(out),missingIndexedFiles=[],note='Solo integritÃ  e presenza dei file; non verifica legale.'))
  # Keep coverage rows, removing only stale local file references.
  covp=cp.parent/'entity-coverage.json'
  if covp.exists():
   cov=read(covp,[])
   for row in cov:
    if isinstance(row.get('paths'),str):
     matching=[x['path'] for x in out if row.get('entity') in x.get('entities',[]) or row.get('entity')==x.get('entityLabel')]
     row['paths']=' | '.join(matching);row['documents']=len(matching)
     if not matching:row['status']='no_local_reference_available'
    for k in ['entityReferences','nationalContext','nationalReferences','sharedReferences','discoveryPages']:
     if isinstance(row.get(k),list):
      row[k]=[v for v in row[k] if not isinstance(v,str) or v.startswith('http') or (root/v).exists() or (scope/v).exists()]
    row['filePresenceCheckedAt']=now();row['coverageReviewRequired']=True
   save(covp,cov);atomic(covp.with_suffix('.csv'),csvtext(cov))
  inventory=[]
  for base,dirs,names in os.walk(scope):
   dirs[:]=[d for d in dirs if d.lower() not in {'procurement data','funding data','node_modules','.git','generated','snapshots','cache','checkpoints'} and not (pathlib.Path(base)/d).is_symlink()]
   for name in names:
    fp=pathlib.Path(base)/name
    if not fp.is_symlink():inventory.append(dict(path=fp.relative_to(root).as_posix(),role='document_or_support_file'))
  atomic(cp.parent/'all-files-index.csv',csvtext(inventory))
  render(root,cp,out)
  report=cp.parent/'final-validation.json'
  if report.exists():
   old=read(report,{});old.update(catalogueDocumentsAndReferences=len(out),lastAutomaticUpdate=now(),priorAuditCountsMayBeHistorical=True);save(report,old)
  dirty.unlink(missing_ok=True)
 if events:
  with (state/'events.jsonl').open('a',encoding='utf-8') as f:
   for e in events:f.write(json.dumps(dict(at=now(),**e),ensure_ascii=False)+'\n')
 # Unready files must remain pending, not become part of the accepted baseline.
 accepted={k:(v if pending.get(k)==v else previous.get(k,v)) for k,v in files.items() if k in previous or k in known}
 for x in additions:
  p=root/x['path'];accepted[x['path']]=[p.stat().st_size,p.stat().st_mtime_ns]
 save(state/'state.json',dict(files=accepted,pending=files,updatedAt=now()))
 save(state/'pending-additions.json',[])
 result=dict(checkedAt=now(),pid=os.getpid(),events=len(events),errors=errors);save(state/'status.json',result);return result
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--root',required=True);ap.add_argument('--state',required=True);ap.add_argument('--initialize',action='store_true');ap.add_argument('--watch',action='store_true');ap.add_argument('--interval',type=int,default=60);a=ap.parse_args();root=pathlib.Path(a.root).resolve();state=pathlib.Path(a.state);state.mkdir(parents=True,exist_ok=True)
 with (state/'process.lock').open('a+b') as lock:
  lock.seek(0);lock.write(b'0');lock.flush();lock.seek(0)
  try:msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
  except OSError:return
  while True:
   if (state/'PAUSE').exists():break
   try:
    result=tick(root,state,a.initialize);a.initialize=False
    try:
     import library_publish
     library_publish.tick(root,state)
    except Exception as publish_error:
     save(state/'publication'/'status.json',dict(status='held',at=now(),error=str(publish_error)))
    if not a.watch:print(json.dumps(result));break
   except Exception as e:
    save(state/'status.json',dict(checkedAt=now(),pid=os.getpid(),error=str(e)))
    if not a.watch:raise
   if (state/'PAUSE').exists():break
   time.sleep(max(5,a.interval))
if __name__=='__main__':main()
