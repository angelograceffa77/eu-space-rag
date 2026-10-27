import unittest
from euspa_disclosures import row,mapped
class Tests(unittest.TestCase):
 def test_negative_amendment(self):
  r=row({'sha256':'a','url':'u'},2025,['Reference','Title','Contractor','Amount EUR'],['C1','Galileo operations','Company',-100],{},'Amendments');self.assertEqual(r['amountAsPublished'],'-100');self.assertEqual(r['disclosureKind'],'amendment');self.assertIsNone(r['awardDate'])
 def test_zero_not_missing(self):
  r=row({'sha256':'a','url':'u'},2025,['Reference','Title','Contractor','Amount'],['C1','Galileo','Company',0],{},'specific contracts');self.assertEqual(r['amountAsPublished'],'0');self.assertIsNone(r['currency']);self.assertEqual(r['disclosureKind'],'aggregate_specific_contracts')
 def test_incomplete_reference(self):
  self.assertIsNone(mapped(['Reference','Title','Contractor','Amount'],['/LOT1','Galileo','Company','10']))
 def test_nonspace(self):
  self.assertIsNone(mapped(['Reference','Title','Contractor','Amount'],['C1','Catering','Company','10']))
if __name__=='__main__':unittest.main()
