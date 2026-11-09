"""Daily report-only retention. Default is preview; --apply deletes eligible artifacts."""
from pathlib import Path
from datetime import datetime,timedelta,timezone
from zoneinfo import ZoneInfo
import os,json,re,hashlib,argparse,stat
ROOT=Path(r'C:\Users\angel\OneDrive\Desktop\knowledge\00_GPT_CONFIGURATION\Report-Archive')
EXT={'.pdf','.docx','.doc','.txt','.md','.html','.htm','.rtf','.xlsx','.pptx'}
def safe(path,root):
 if not path.resolve().is_relative_to(root.resolve()) or path.resolve()==root.resolve():raise ValueError('Outside archive')
 for item in [path,*path.parents]:
  if item.is_symlink() or getattr(item.lstat(),'st_file_attributes',0)&1024:raise ValueError('Link/reparse point rejected: '+str(item))
  if item==root:break
def inventory(root,now):
 cutoff=now.astimezone(ZoneInfo('Europe/Budapest'))-timedelta(days=14);rows=[];held=[]
 safe(root/'00_Archive-Index',root)
 for company in root.iterdir():
  if not company.is_dir() or company.name.startswith(('00_','_','.')):continue
  safe(company,root)
  for package in company.iterdir():
   if not package.is_dir():continue
   safe(package,root)
   match=re.match(r'^(\d{4}-\d{2}-\d{2})_',package.name)
   if not match:continue
   date=datetime.fromisoformat(match[1]).replace(tzinfo=ZoneInfo('Europe/Budapest'))+timedelta(days=1)
   if date>=cutoff:continue
   if any((package/x).exists() for x in ['.lock','ACTIVE','HOLD']):held.append(str(package));continue
   receipts=package/'05_Delivery-Receipt'
   if not receipts.is_dir() or not any(receipts.glob('*.json')):held.append(str(package));continue
   safe(receipts,root)
   delivered=False
   for receipt in receipts.glob('*.json'):
    safe(receipt,root);r=json.loads(receipt.read_text(encoding='utf-8-sig'))
    delivered |= bool(r.get('gmailMessageId') or r.get('messageId') or r.get('message_id')) and ('sent' in str(r).lower() or 'successful' in str(r).lower())
   if not delivered:held.append(str(package));continue
   for part in ['01_Final-Report','02_Editable-Version']:
    folder=package/part
    if not folder.exists():continue
    safe(folder,root)
    for directory,dirs,files in os.walk(folder,followlinks=False):
     for n in dirs:safe(Path(directory)/n,root)
     for n in files:
      file=Path(directory)/n;safe(file,root)
      if file.suffix.lower() not in EXT:continue
      s=file.stat()
      if datetime.fromtimestamp(max(s.st_mtime,s.st_ctime),timezone.utc)>=cutoff:continue
      rows.append(dict(path=str(file),size=s.st_size,mtime=s.st_mtime_ns,sha256=hashlib.sha256(file.read_bytes()).hexdigest()))
 return rows,held
def run(root,apply=False):
 now=datetime.now(timezone.utc);root=root.absolute()
 if not root.is_dir():raise ValueError('Archive missing')
 safe(root/'00_Archive-Index',root)
 maintenance=root/'00_Archive-Index'/'Retention';maintenance.mkdir(parents=True,exist_ok=True);safe(maintenance,root)
 lock=maintenance/'cleanup.lock';fd=os.open(lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY);os.write(fd,str(os.getpid()).encode());os.close(fd)
 result=dict(at=now.isoformat(),apply=apply,deleted=[],held=[],errors=[])
 receipt=maintenance/(now.strftime('%Y%m%dT%H%M%S%fZ')+'.json')
 try:
  rows,held=inventory(root,now);result.update(candidates=rows,held=held)
  receipt.write_text(json.dumps(result,indent=2),encoding='utf-8')
  if apply:
   for row in rows:
    f=Path(row['path']);safe(f,root);s=f.stat()
    if s.st_size!=row['size'] or s.st_mtime_ns!=row['mtime'] or hashlib.sha256(f.read_bytes()).hexdigest()!=row['sha256']:raise ValueError('File changed: '+str(f))
    package=next(x for x in f.parents if re.match(r'^\d{4}-\d{2}-\d{2}_',x.name))
    if any((package/x).exists() for x in ['.lock','ACTIVE','HOLD']):raise ValueError('Package active')
    f.unlink();result['deleted'].append(row)
    receipt.write_text(json.dumps(result,indent=2),encoding='utf-8')
   with (maintenance/'expired-artifacts.jsonl').open('a',encoding='utf-8') as stream:
    for row in result['deleted']:stream.write(json.dumps(dict(row,expiredAt=now.isoformat()))+'\n')
 except Exception as e:result['errors'].append(str(e));raise
 finally:
  receipt.write_text(json.dumps(result,indent=2),encoding='utf-8');lock.unlink()
 return dict(deletedCount=len(result['deleted']),deletedBytes=sum(x['size'] for x in result['deleted']),heldCount=len(result['held']),receipt=str(receipt))
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');a=parser.parse_args();print(json.dumps(run(ROOT,a.apply)))
