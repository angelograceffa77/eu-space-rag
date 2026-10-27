"""Publish only validated company packages and their explicitly selected operating files."""
import argparse,datetime,hashlib,json,os,pathlib,shutil,subprocess,sys,time
HOME=pathlib.Path(__file__).resolve().parent
ROOT=HOME.parent.parent
ARCHIVE=ROOT.parent/'05_COMPANIES'/'Periodic-Refresh'
def sha(b):return hashlib.sha256(b).hexdigest()
def read(p):return json.loads(p.read_text('utf-8'))
def write(p,x):
 p.parent.mkdir(parents=True,exist_ok=True);t=p.with_suffix(p.suffix+'.tmp');t.write_text(json.dumps(x,indent=2),encoding='utf-8')
 for attempt in range(9):
  try:t.replace(p);break
  except PermissionError:
   if attempt==8:raise
   time.sleep(min(.1*2**attempt,1))
def safe(base,rel):
 p=(base/rel).resolve()
 if not p.is_relative_to(base.resolve()) or p.is_symlink():raise ValueError('Unsafe package path: '+str(p))
 return p
def esa_files(base):
 m=read(base/'esa-companies-manifest.json');folder=safe(base,m.get('pathBase','.'));files=[base/'esa-companies-manifest.json'];count=0
 for key in ['parts','indexParts','searchParts']:
  for row in m.get(key,[]):
   f=safe(folder,row['filename']);b=f.read_bytes()
   if sha(b)!=row['sha256']:raise ValueError('ESA checksum: '+str(f))
   if key=='parts':count+=len([line for line in b.decode('utf-8').split('\n') if line])
   files.append(f)
 if count!=m['totalRecordCount'] or count==0:raise ValueError('ESA count gate')
 return files
def pointer_files(base):
 pointer=read(base/'manifest.json');folder=safe(base,pointer['path']);mf=folder/'manifest.json'
 if sha(mf.read_bytes())!=pointer['manifestSha256']:raise ValueError('Pointer checksum')
 m=read(mf);files=[base/'manifest.json',mf]
 for item in m.get('parts',[])+m.get('searchCompanions',[])+[m.get('coverage'),m.get('sources'),m.get('procurementScope')]:
  if not isinstance(item,dict) or 'file' not in item:continue
  f=safe(folder,item['file']);b=f.read_bytes()
  if sha(b)!=item['sha256']:raise ValueError('Part checksum: '+str(f))
  if 'rows'in item and len([line for line in b.decode('utf-8').split('\n') if line])!=item['rows']:raise ValueError('Part row count')
  files.append(f)
 return files
def inventory():
 c=ROOT/'05_COMPANIES';files=esa_files(c)
 for mod,master in [('Investment-Discovery','Investment-Master'),('Private-Client-Discovery','Client-Master')]:
  files+=pointer_files(c/mod/master)
  for p in (c/mod).rglob('*'):
   rel=p.relative_to(c/mod)
   if any(x.lower() in {'snapshots','node_modules','raw','evidence','local-state','__pycache__'} for x in rel.parts):continue
   if p.is_file() and (p.suffix.lower() in {'.cjs','.js','.py','.ps1','.md'} or p.name in {'RETRIEVAL-GUIDE.txt','ARCHITECTURE.txt'} or (rel.parts[0]=='00_Control' and p.suffix=='.json')):files.append(p)
 for p in HOME.iterdir():
  if p.is_file() and (p.suffix in {'.cjs','.py','.md'} or p.name in {'policy.json','procurement-scope.json','country-discovery.json','requirements.txt'}):files.append(p)
 for name in ['package.json','package-lock.json','esa-companies.js','esa-pagination.cjs','esa-pagination.test.cjs','esa-request.cjs','esa-request.test.cjs','company-export.js','company-export.test.js','company-datasets.json','README.md']:
  if (c/name).exists():files.append(c/name)
 result={}
 for p in files:
  if p.is_symlink() or not p.resolve().is_relative_to(c.resolve()):raise ValueError('Outside company scope')
  b=p.read_bytes()
  if len(b)>=95*1024*1024:raise ValueError('Oversize file')
  result[p.relative_to(ROOT).as_posix()]={'sha256':sha(b),'bytes':len(b)}
 return result
def conflicts():
 return [p for p in [ROOT/'03_PROCUREMENT/Procurement Data/daily/.daily.lock',ROOT/'04_FUNDING/funding data/00_Control/local-state/daily.lock',ROOT/'04_FUNDING/funding data/01_Daily-Update/daily.lock',ROOT.parent/'05_COMPANIES/Investment-Discovery/collection.lock',ROOT/'05_COMPANIES/Private-Client-Discovery/refresh.lock'] if p.exists()]
def publish():
 if not read(HOME/'policy.json').get('publicationEnabled'):raise ValueError('Company publication disabled by policy')
 if conflicts():raise ValueError('Daily or directory collection active')
 subprocess.run(['node',str(ROOT/'05_COMPANIES/Investment-Discovery/01_Collectors/validate.cjs')],check=True)
 subprocess.run([sys.executable,str(ROOT/'05_COMPANIES/Private-Client-Discovery/01_Collectors/clients.py'),'validate','--root',str(ROOT/'05_COMPANIES/Private-Client-Discovery')],check=True)
 current=inventory();pub=ARCHIVE/'_publication';pub.mkdir(parents=True,exist_ok=True);bare=pub/'repository.git';work=pub/'worktree';work.mkdir(exist_ok=True)
 env=dict(os.environ,GIT_INDEX_FILE=str(pub/'index'),GIT_WORK_TREE=str(work),GIT_TERMINAL_PROMPT='0',GIT_AUTHOR_NAME='Gagarin Company Publisher',GIT_AUTHOR_EMAIL='gagarin@users.noreply.github.com',GIT_COMMITTER_NAME='Gagarin Company Publisher',GIT_COMMITTER_EMAIL='gagarin@users.noreply.github.com')
 def git(*args,data=None):
  p=subprocess.run(['git','--git-dir='+str(bare),*args],input=data,capture_output=True,env=env,timeout=600)
  if p.returncode:raise RuntimeError(p.stderr.decode(errors='replace'))
  return p.stdout
 if not bare.exists():subprocess.run(['git','init','--bare',str(bare)],check=True)
 remote='https://github.com/angelograceffa77/eu-space-rag.git';git('fetch','--depth=1',remote,'main');parent=git('rev-parse','FETCH_HEAD').decode().strip();git('read-tree',parent)
 # Leave older published snapshots intact. Replace only the current allowlisted files.
 entries=[]
 for rel,meta in sorted(current.items()):
  b=(ROOT/rel).read_bytes()
  if sha(b)!=meta['sha256']:raise ValueError('Inputs changed')
  oid=git('hash-object','-w','--stdin',data=b).decode().strip();entries.append('100644 '+oid+'\t'+rel+'\0')
 git('update-index','-z','--index-info',data=''.join(entries).encode());tree=git('write-tree').decode().strip();changed=[x for x in git('diff-tree','--no-commit-id','--name-only','-r','-z',parent,tree).decode().split('\0') if x]
 if not set(changed)<=set(current):raise ValueError('Unrelated file changes')
 for script in ['scripts/check-git-file-sizes.cjs','03_PROCUREMENT/Procurement Data/daily/check-publication-tree.cjs']:
  subprocess.run(['node',str(ROOT/script)],cwd=ROOT,env=dict(env,GIT_DIR=str(bare)),check=True)
 if inventory()!=current or conflicts():raise ValueError('Inputs changed or another update started')
 commit=parent
 if changed:
  commit=git('commit-tree',tree,'-p',parent,data=b'Update validated company discovery directories and refresh controls\n').decode().strip()
  if git('ls-remote',remote,'refs/heads/main').decode().split()[0]!=parent:raise ValueError('Remote advanced; retry publication')
  git('push',remote,commit+':refs/heads/main')
 if git('ls-remote',remote,'refs/heads/main').decode().split()[0]!=commit:raise ValueError('Remote verification failed')
 receipt={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'published_verified','commit':commit,'files':current,'changed':changed};write(pub/'receipt.json',receipt);print(json.dumps({'commit':commit,'changedFiles':len(changed)}))
def promote(source):
 source=pathlib.Path(source);files=esa_files(source);dest=ROOT/'05_COMPANIES';old=read(dest/'esa-companies-manifest.json');new=read(source/'esa-companies-manifest.json')
 if new['totalRecordCount']<old['totalRecordCount']*.8:raise ValueError('Unexpected ESA inventory drop; preserve last good snapshot')
 for f in files:
  if f.name=='esa-companies-manifest.json':continue
  target=safe(dest,f.relative_to(source));target.parent.mkdir(parents=True,exist_ok=True)
  if target.exists() and sha(target.read_bytes())!=sha(f.read_bytes()):raise ValueError('Immutable snapshot collision')
  if not target.exists():shutil.copy2(f,target)
 write(ARCHIVE/'Previous-ESA-Manifests'/old['generation']/'manifest.json',old)
 write(dest/'esa-companies-manifest.json',new);esa_files(dest)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('action',choices=['publish','inventory','promote-esa']);p.add_argument('--source');a=p.parse_args()
 if a.action=='publish':publish()
 elif a.action=='promote-esa':promote(a.source)
 else:print(json.dumps({'files':len(inventory())}))
