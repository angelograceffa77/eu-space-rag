"""Read official EUSPA annual tables without inventing dates or allocating amounts."""
import re,pathlib,hashlib,zipfile,urllib.parse,xml.etree.ElementTree as ET
import pdfplumber,openpyxl

def clean(x):return re.sub(r"\s+"," ",str(x) if x is not None else "").strip()
def relevant(s):return bool(re.search(r"satellit|satcom|copernicus|earth observation|E?GNSS|EGNOS|Galileo|spacecraft|remote sensing|space programme|space traffic|\bGSMC\b|\bGRC\b|SBAS|SAR/Galileo",s,re.I))
def mapped(header,cells):
 def pick(pattern):return next((i for i,h in enumerate(header) if re.search(pattern,clean(h),re.I)),None)
 indices=[pick(r"reference|contract ref|^ref[.#]?$"),pick(r"^subject(?: of (?:the )?contract)?$|^title$"),pick(r"^contractor(?: name|/counterpart)?$"),pick(r"value|amount")]
 if any(i is None or i>=len(cells) for i in indices):return None
 ref,title,winner,amount=[clean(cells[i]) for i in indices]
 if not ref or not re.search(r"\d",ref) or ref.upper().startswith('/LOT') or not title or not winner or not relevant(title+" "+ref):return None
 return ref,title,winner,amount,indices

def row(ev,year,header,cells,pointer,context,formats=None):
 m=mapped(header,cells)
 if not m:return None
 ref,title,winner,amount,ix=m
 currency='EUR' if '€' in amount or re.search(r"euro|EUR",clean(header[ix[3]])) or formats and '€' in formats[ix[3]] else None
 kind='amendment' if re.search(r'amend|modification',context,re.I) else 'aggregate_specific_contracts' if re.search(r'aggregat|specific contracts|interinstitutional',context,re.I) else 'annual_contract_disclosure'
 return dict(id='annual:EUSPA:'+str(year)+':'+hashlib.sha256((ev['sha256']+str(pointer)).encode()).hexdigest()[:20],recordType='annual_contract_disclosure',buyer='EUSPA',reportingYear=year,awardDate=None,dateMeaning='Annual reporting year only; not an exact award date',contractReference=ref,description=title,contractorNameAsPublished=winner,amountAsPublished=amount or None,currency=currency,disclosureKind=kind,valueMeaning='Annual source amount; amendments and aggregated contracts are not new awards. Do not sum with TED or other versions.',excludedFromOpenCount=True,excludedFromDatedAwardCount=True,sourceUrl=ev['url'],evidence=ev,sourcePointer=pointer,sourceFields={str(i):cells[i] for i in ix},sourceHeaders={str(i):header[i] for i in ix},amountNumberFormat=formats[ix[3]] if formats else None,companyIdentityVerified=False)

def extract(ev):
 p=pathlib.Path(ev['file']);out=[];gaps=[]
 if p.suffix=='.xlsx':
  # Ignore styled empty columns, but reject substantive data beyond the supported schema.
  ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
  with zipfile.ZipFile(p) as z:
   for name in z.namelist():
    if re.fullmatch(r'xl/worksheets/sheet\d+.xml',name):
     for c in ET.fromstring(z.read(name)).findall('.//m:c',ns):
      letters=re.match('[A-Z]+',c.attrib.get('r','A1'))[0];col=0
      for v in letters:col=col*26+ord(v)-64
      if col>32 and (c.find('m:v',ns) is not None or c.find('m:is',ns) is not None):raise ValueError('Unexpected populated column outside annual schema')
  y=re.search(r'(?<![0-9])202\d(?![0-9])',urllib.parse.unquote(ev['url']));
  if not y:return [],[{'source':ev['url'],'reason':'Unidentified reporting year'}]
  year=int(y[0]);w=openpyxl.load_workbook(p,read_only=True,data_only=True)
  for sheet in w:
   header=None
   for ri,rr in enumerate(sheet.iter_rows(max_col=32),1):
    cells=[c.value for c in rr];formats=[c.number_format or '' for c in rr]
    if any('contractor' in clean(v).lower() for v in cells) and any(clean(v).lower() in ['title','subject','subject of contract'] for v in cells):header=cells;continue
    if header:
     r=row(ev,year,header,cells,{'sheet':sheet.title,'row':ri},sheet.title,formats)
     if r:out.append(r)
  w.close()
 else:
  with pdfplumber.open(p) as pdf:
   first=' '.join((p.extract_text() or '') for p in pdf.pages[:2]);y=re.search(r'(?:EUSPA|GSA)\s+(202\d)\s+List',first,re.I)
   if not y:return [],[{'source':ev['url'],'reason':'Unidentified EUSPA reporting year'}]
   year=int(y[1]);header=None;section="annual contract disclosure"
   for pi,page in enumerate(pdf.pages,1):
    heading=(page.extract_text() or '')[:250]
    if re.search(r'list of.*amend|amendments to|modifications of',heading,re.I):section='amendment'
    elif re.search(r'list of specific|aggregate amount|interinstitutional',heading,re.I):section='aggregate specific contracts'
    elif re.search(r'list of contractors|contracts from',heading,re.I):section='annual contract disclosure'
    context=section
    settings={'snap_x_tolerance':8,'snap_y_tolerance':3} if year==2021 else {}
    for ti,table in enumerate(page.extract_tables(settings),1):
     for ri,cells in enumerate(table,1):
      if any('contractor' in clean(v).lower() for v in cells) and any('subject' in clean(v).lower() for v in cells):header=cells;continue
      if header and len(header)==len(cells):
       r=row(ev,year,header,cells,{'page':pi,'table':ti,'row':ri},context)
       if r:
        r['sourcePointer']['tableSettings']=settings;out.append(r)
   gaps.append({'source':ev['url'],'reason':'PDF extraction is partial; split rows and unmatched table layouts require review. No missing row is treated as zero.'})
 return out,gaps
