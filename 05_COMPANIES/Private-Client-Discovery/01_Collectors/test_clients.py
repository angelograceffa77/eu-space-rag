import unittest, tempfile, pathlib, json
from clients import classify,base,parts,sha,AFRICA,validate
class Tests(unittest.TestCase):
 def test_agriculture(self):self.assertEqual(classify('Food Production - Agricultural Production')[0],'agriculture')
 def test_maritime(self):self.assertEqual(classify('Water Transportation - Ports and Services')[0],'maritime')
 def test_insurance(self):self.assertIn('earth_observation',classify('Banks, Diverse Financials, Insurance')[1])
 def test_africa(self):self.assertTrue(base('x','x','Kenya','mining')['africa']);self.assertFalse(base('x','Africa Business','Switzerland','mining')['africa'])
 def test_unknown_ownership(self):self.assertEqual(base('x','x','Kenya','mining')['ownership'],'unknown')
 def test_not_demand(self):self.assertEqual(base('x','x','Kenya','mining')['buyingIntent'],'unknown')
 def test_unknown_sector(self):self.assertEqual(classify('unclear')[1],[])
 def test_no_generic_software(self):self.assertNotIn('software',classify('Software and Services')[1])
 def test_tanzania_alias(self):self.assertTrue(base('x','x','United Republic of Tanzania','mining')['africa'])
 def test_tamper_rejected(self):
  with tempfile.TemporaryDirectory(dir=pathlib.Path(__file__).parent) as d:
   p=pathlib.Path(d);rows=[base('x','x','Kenya','mining')];ps=parts(p,'clients',rows);(p/'manifest.json').write_text(json.dumps({'parts':ps,'counts':{'clientProfiles':1}}));validate(p);(p/ps[0]['file']).write_text('{}\n')
   with self.assertRaises(AssertionError):validate(p)
 def test_utf8_shards(self):
  with tempfile.TemporaryDirectory(dir=pathlib.Path(__file__).parent) as d:
   p=pathlib.Path(d);rows=[{'id':str(i),'name':'é'*1000} for i in range(200)];manifest=parts(p,'test',rows);self.assertGreater(len(manifest),1);self.assertEqual(sum(x['rows'] for x in manifest),200)
   for x in manifest:self.assertEqual(sha((p/x['file']).read_bytes()),x['sha256']);self.assertLessEqual(x['bytes'],128*1024)
if __name__=='__main__':unittest.main()
