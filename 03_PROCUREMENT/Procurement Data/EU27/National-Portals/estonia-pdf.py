import os, sys

def local_path(value):
    absolute = os.path.abspath(value)
    if os.name == 'nt' and not absolute.startswith('\\\\?\\'):
        return '\\\\?\\UNC\\' + absolute[2:] if absolute.startswith('\\\\') else '\\\\?\\' + absolute
    return absolute
sys.argv[1] = local_path(sys.argv[1])
sys.argv[2] = local_path(sys.argv[2])
import sys,json
from pypdf import PdfReader
pages=[p.extract_text() or '' for p in PdfReader(sys.argv[1]).pages]
with open(sys.argv[2],'w',encoding='utf-8') as f: json.dump({'pages':pages,'text':'\n'.join(pages)},f,ensure_ascii=False)
