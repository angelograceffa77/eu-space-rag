import sys,json,io
from pypdf import PdfReader
sys.stdout.buffer.write(json.dumps([p.extract_text() or '' for p in PdfReader(io.BytesIO(sys.stdin.buffer.read()),strict=False).pages],ensure_ascii=False).encode('utf-8'))
