import tempfile,pathlib,subprocess,unittest,sys,json
sys.path.insert(0,r'C:\Users\angel\OneDrive\Desktop\knowledge\eu-space-rag\_Reference-Library-Maintenance')
import library_publish as p
class Sync(unittest.TestCase):
 def test_local_rename_delete_keeps_unrelated_remote(self):
  with tempfile.TemporaryDirectory() as d:
   base=pathlib.Path(d);root=base/'knowledge'/'repo';root.mkdir(parents=True);state=base/'state';state.mkdir();remote=base/'remote.git';seed=base/'seed'
   real=subprocess.run
   def run(*args,**kw):return real(*args,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,**kw)
   run(['git','init','--bare',str(remote)]);run(['git','init','-b','main',str(seed)])
   for name,body in {'01_POLICY/old.pdf':'old','01_POLICY/deleted.pdf':'deleted','03_PROCUREMENT/Procurement Data/keep.json':'unrelated'}.items():
    f=seed/name;f.parent.mkdir(parents=True,exist_ok=True);f.write_text(body)
   run(['git','-C',str(seed),'add','.']);run(['git','-C',str(seed),'-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','seed']);run(['git','-C',str(seed),'push',str(remote),'main'])
   f=root/'01_POLICY/new.pdf';f.parent.mkdir();f.write_text('old');current={'01_POLICY/new.pdf':{'sha256':p.sha(f.read_bytes()),'bytes':3}};old={'01_POLICY/old.pdf':{},'01_POLICY/deleted.pdf':{}}
   inv,conf=p.inventory,p.conflicts
   def intercepted(args,**kw):
    if args[0]=='node':return subprocess.CompletedProcess(args,0,b'',b'')
    args=[str(remote) if x=='https://github.com/angelograceffa77/eu-space-rag.git' else x for x in args]
    return real(args,**kw)
   p.inventory=lambda _:current;p.conflicts=lambda _:[];subprocess.run=intercepted
   try:p.publish(root,state,old,current)
   finally:p.inventory=inv;p.conflicts=conf;subprocess.run=real
   names=run(['git','--git-dir='+str(remote),'ls-tree','-r','--name-only','main']).stdout.decode().splitlines()
   self.assertEqual(names,['01_POLICY/new.pdf','03_PROCUREMENT/Procurement Data/keep.json'])
   self.assertEqual(json.loads((state/'status.json').read_text())['status'],'published_verified')
if __name__=='__main__':unittest.main()
