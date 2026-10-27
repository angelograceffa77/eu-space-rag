"""Scoped library publisher. Original files are never edited; remote races fail closed."""
import os,pathlib,json,hashlib,subprocess,datetime,msvcrt
AREAS=('01_POLICY','02_LAW','03_PROCUREMENT','04_FUNDING')
OPERATING={'_Reference-Library-Maintenance/maintain_library.py','_Reference-Library-Maintenance/library_publish.py','_Reference-Library-Maintenance/test_sync_integration.py'}
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(b):return hashlib.sha256(b).hexdigest()
def load(p,d=None):return json.loads(p.read_text('utf-8-sig')) if p.exists() else d
def save(p,x):
 p.parent.mkdir(parents=True,exist_ok=True);t=p.with_suffix(p.suffix+'.tmp');t.write_text(json.dumps(x,indent=2),encoding='utf-8');os.replace(t,p)
def permitted(p):
 if p in OPERATING:return True
 s=p.replace('\\','/').split('/')
 return s[0] in AREAS and '..' not in s and not any(x.lower() in {'procurement data','funding data','node_modules','.git','generated','raw','evidence','checkpoints','cache'} for x in s)
def inventory(root):
 result={}
 for area in AREAS:
  base=root/area
  if not base.is_dir():raise ValueError('Library root unavailable: '+area)
  idx=base/('_Procurement-Process-Library' if area=='03_PROCUREMENT' else '_Reference-Library')
  cat=idx/'document-catalogue.json'
  if not cat.is_file():raise ValueError('Catalogue unavailable: '+area)
  paths=set()
  catalogues=[cat]+list(base.glob('*/_Reference-Library/document-catalogue.json'))
  for cp in catalogues:
   for row in load(cp,[]):
    for key in ['path','textCompanion']:
     rel=row.get(key)
     if not rel:continue
     p=root/rel if rel.replace('\\','/').split('/')[0] in AREAS else base/rel
     if not p.is_file():raise ValueError('Indexed file missing: '+str(p))
     paths.add(p)
   for name in ['document-catalogue.json','document-catalogue.jsonl','document-catalogue.csv','all-files-index.csv','entity-coverage.json','entity-coverage.csv','automatic-maintenance.json','filename-register.json','filename-register.csv','unresolved-sources.json','final-validation.json']:
    p=cp.parent/name
    if p.is_file():paths.add(p)
   for name in ['00-DOCUMENT-INDEX.html','00-READ-ME.txt']:
    p=cp.parent.parent/name
    if p.is_file():paths.add(p)
  for p in paths:
   rel=p.relative_to(root).as_posix()
   if not permitted(rel):raise ValueError('Not allowed: '+rel)
   if p.is_symlink():raise ValueError('Symlink: '+rel)
   b=p.read_bytes()
   if len(b)>=95*1024*1024:raise ValueError('Oversize document: '+rel)
   result[rel]={'sha256':sha(b),'bytes':len(b)}
 for rel in OPERATING:
  f=root/rel
  if f.is_symlink() or not f.is_file():raise ValueError('Operating file missing or unsafe')
  b=f.read_bytes();result[rel]={'sha256':sha(b),'bytes':len(b)}
 return result
def safety(previous,current):
 removed=set(previous)-set(current)
 documents=lambda xs:sum(pathlib.Path(p).suffix.lower() in {'.pdf','.doc','.docx','.html','.rtf'} for p in xs)
 n=documents(removed);total=documents(previous)
 if n>10 or (n>2 and n>total*.05):raise ValueError('Mass deletion held for review: '+str(n)+' documents')
 for a in AREAS:
  if any(p.startswith(a+'/') for p in previous) and not any(p.startswith(a+'/') for p in current):raise ValueError('Library unexpectedly empty: '+a)
 return removed
def conflicts(root):
 checks=[root/'03_PROCUREMENT/Procurement Data/daily/.daily.lock',root/'04_FUNDING/funding data/00_Control/local-state/daily.lock',root/'04_FUNDING/funding data/00_Control/local-state/update.lock',root/'05_COMPANIES/Periodic-Refresh/refresh.lock',root.parent/'03_PROCUREMENT/Procurement Data/_publication/.publish.lock',root.parent/'04_FUNDING/_publication/publisher.lock']
 return [str(p) for p in checks if p.exists()]
def tick(root,state):
 state=state/'publication';state.mkdir(parents=True,exist_ok=True)
 cfg=load(state/'policy.json',{})
 if not cfg.get('enabled'):return
 if conflicts(root):return
 current=inventory(root);old=load(state/'baseline.json')
 if old is None:save(state/'baseline.json',current);save(state/'status.json',{'status':'baseline_initialized','at':now()});return
 if current==old:return
 safety(old,current)
 pending=load(state/'pending.json')
 if pending!=current:save(state/'pending.json',current);return
 with (state/'publication.lock').open('a+b') as handle:
  handle.write(b'0');handle.flush();handle.seek(0)
  try:msvcrt.locking(handle.fileno(),msvcrt.LK_NBLCK,1)
  except OSError:return
  publish(root,state,old,current)
def publish(root,state,previous,current):
 archive=root.parent/'03_PROCUREMENT/Procurement Data/_publication/library-maintenance';archive.mkdir(parents=True,exist_ok=True)
 bare=archive/'repository.git';work=archive/'worktree';work.mkdir(exist_ok=True)
 env=os.environ.copy();env.update(GIT_INDEX_FILE=str(archive/'index'),GIT_WORK_TREE=str(work),GIT_TERMINAL_PROMPT='0')
 def git(*args,input=None):
  p=subprocess.run(['git','--git-dir='+str(bare),*args],input=input,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env,timeout=600)
  if p.returncode:raise RuntimeError(p.stderr.decode(errors='replace'))
  return p.stdout
 if not bare.exists():subprocess.run(['git','init','--bare',str(bare)],check=True,stdout=subprocess.DEVNULL)
 remote='https://github.com/angelograceffa77/eu-space-rag.git'
 git('fetch','--depth=1',remote,'main');parent=git('rev-parse','FETCH_HEAD').decode().strip();git('read-tree',parent)
 remove=safety(previous,current)
 managed=set(previous)|set(current)
 if not all(permitted(p) for p in managed):raise ValueError('Unsafe baseline path')
 git('update-index','--force-remove','-z','--stdin',input=('\0'.join(sorted(managed))+'\0').encode())
 entries=[]
 for p,v in sorted(current.items()):
  b=(root/p).read_bytes()
  if sha(b)!=v['sha256']:raise ValueError('File changed during publication')
  oid=git('hash-object','-w','--stdin',input=b).decode().strip();entries.append('100644 '+oid+'\t'+p+'\0')
 git('update-index','-z','--index-info',input=''.join(entries).encode());tree=git('write-tree').decode().strip()
 changed=[p for p in git('diff-tree','--no-commit-id','--name-only','-r','-z',parent,tree).decode().split('\0') if p]
 if not set(changed)<=managed:raise ValueError('Unrelated paths changed')
 for script in ['scripts/check-git-file-sizes.cjs','03_PROCUREMENT/Procurement Data/daily/check-publication-tree.cjs']:
  subprocess.run(['node',str(root/script)],env=dict(env,GIT_DIR=str(bare)),cwd=root,check=True,timeout=120)
 if current!=inventory(root) or conflicts(root):raise ValueError('Inputs changed or daily workflow started; retry later')
 commit=parent
 if changed:
  env.update(GIT_AUTHOR_NAME='Gagarin Library Publisher',GIT_AUTHOR_EMAIL='gagarin@users.noreply.github.com',GIT_COMMITTER_NAME='Gagarin Library Publisher',GIT_COMMITTER_EMAIL='gagarin@users.noreply.github.com')
  commit=git('commit-tree',tree,'-p',parent,input=b'Update reference documents and indexes\n').decode().strip()
  if git('ls-remote',remote,'refs/heads/main').decode().split()[0]!=parent:raise ValueError('Remote advanced; retry')
  git('push',remote,commit+':refs/heads/main')
 if git('ls-remote',remote,'refs/heads/main').decode().split()[0]!=commit:raise ValueError('Remote verification failed')
 receipt={'status':'published_verified' if changed else 'unchanged_verified','at':now(),'commit':commit,'files':len(current),'changed':changed,'removed':sorted(remove)}
 save(archive/(datetime.datetime.now().strftime('%Y%m%dT%H%M%S')+'-receipt.json'),receipt);save(state/'status.json',receipt);save(state/'baseline.json',current)
