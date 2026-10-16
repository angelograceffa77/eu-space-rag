from pypdf import PdfReader
import sys, json, os

def local_path(value):
    absolute = os.path.abspath(value)
    if os.name == 'nt' and not absolute.startswith('\\\\?\\'):
        return '\\\\?\\UNC\\' + absolute[2:] if absolute.startswith('\\\\') else '\\\\?\\' + absolute
    return absolute

r = PdfReader(local_path(sys.argv[1]))
pages = [{'page': i + 1, 'text': p.extract_text() or ''} for i, p in enumerate(r.pages)]
with open(local_path(sys.argv[2]), 'w', encoding='utf-8') as f:
    json.dump({'pages': pages, 'text': '\n'.join(p['text'] for p in pages)}, f, ensure_ascii=False)
