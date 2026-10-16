import os, sys

def local_path(value):
    absolute = os.path.abspath(value)
    if os.name == 'nt' and not absolute.startswith('\\\\?\\'):
        return '\\\\?\\UNC\\' + absolute[2:] if absolute.startswith('\\\\') else '\\\\?\\' + absolute
    return absolute
sys.argv[1] = local_path(sys.argv[1])
import sys, os, json, zipfile, xml.etree.ElementTree as ET

def emit(name,index,values):
    sys.stdout.write(json.dumps({'sheet':name,'row':index,'values':values},ensure_ascii=True,separators=(',',':'))+'\n')
with open(sys.argv[1], 'rb') as source:
    zip_container = source.read(4) == b'PK\x03\x04'
if zip_container:
    ns={'table':'urn:oasis:names:tc:opendocument:xmlns:table:1.0','office':'urn:oasis:names:tc:opendocument:xmlns:office:1.0','text':'urn:oasis:names:tc:opendocument:xmlns:text:1.0'}
    attr=lambda prefix,key:'{'+ns[prefix]+'}'+key
    with zipfile.ZipFile(sys.argv[1]) as z, z.open('content.xml') as stream:
        name='';index=0
        for event,e in ET.iterparse(stream,events=('start','end')):
            if event=='start' and e.tag==attr('table','table'):
                name=e.get(attr('table','name'),'Sheet');index=0
            if event=='end' and e.tag==attr('table','table-row'):
                values=[]
                for c in e:
                    if c.tag not in (attr('table','table-cell'),attr('table','covered-table-cell')):continue
                    text=' '.join(''.join(p.itertext()) for p in c.iter(attr('text','p')))
                    typ=c.get(attr('office','value-type'));v=text
                    if typ in ('float','currency','percentage'):
                        try:v=float(c.get(attr('office','value'),text))
                        except ValueError:pass
                    elif typ=='date':
                        date=c.get(attr('office','date-value'),'')
                        if len(date)>=10 and date[:4].isdigit():v=date
                    count=int(c.get(attr('table','number-columns-repeated'),'1'))
                    values.extend([v]*min(count,4096))
                while values and values[-1]=='':values.pop()
                repeat=int(e.get(attr('table','number-rows-repeated'),'1'))
                if values:
                    for _ in range(min(repeat,1000000)):
                        index+=1;emit(name,index,values)
                else:index+=repeat
                e.clear()
else:
    sys.path.insert(0,os.environ.get('RO_PYTHON_LIB',os.path.join(os.path.dirname(__file__),'.runtime-python')))
    import xlrd
    book=xlrd.open_workbook(sys.argv[1],on_demand=True,logfile=sys.stderr)
    for name in book.sheet_names():
        sheet=book.sheet_by_name(name)
        for i in range(sheet.nrows):emit(name,i+1,sheet.row_values(i))
        book.unload_sheet(name)
    book.release_resources()

