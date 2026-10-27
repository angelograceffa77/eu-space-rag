import pathlib,tempfile,json,unittest,sys
sys.path.insert(0,r'C:\Users\angel\OneDrive\Desktop\knowledge\eu-space-rag\05_COMPANIES\Periodic-Refresh')
import publish as p
class Periodic(unittest.TestCase):
 def test_path_escape(self):
  with self.assertRaises(ValueError):p.safe(pathlib.Path.cwd(),'../outside')
 def test_unicode_jsonl_and_checksum_gate(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);folder=root/'generation';folder.mkdir();b=(json.dumps({'description':'a\u2028b'},ensure_ascii=False)+'\n').encode();(folder/'part.jsonl').write_bytes(b)
   m={'pathBase':'generation','parts':[{'filename':'part.jsonl','sha256':p.sha(b)}],'totalRecordCount':1};(root/'esa-companies-manifest.json').write_text(json.dumps(m))
   self.assertEqual(len(p.esa_files(root)),2)
   (folder/'part.jsonl').write_bytes(b+b' ')
   with self.assertRaises(ValueError):p.esa_files(root)
 def test_pointer_integrity(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);(root/'manifest.json').write_text(json.dumps({'path':'../../outside','manifestSha256':'bad'}))
   with self.assertRaises(ValueError):p.pointer_files(root)
if __name__=='__main__':unittest.main()
