"""Read-only extraction of preserved procurement evidence; never establishes open status."""
import argparse, hashlib, json, re, os, logging, io
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse
from zipfile import ZipFile
from xml.etree import ElementTree

class TextHTML(HTMLParser):
    def __init__(self):
        super().__init__(); self.text=[]; self.links=[]; self.skip=0
    def handle_starttag(self,tag,attrs):
        if tag in ("script","style"): self.skip+=1
        if tag in ("p","div","br","tr","li","h1","h2","h3"): self.text.append("\n")
        if tag=="a":
            href=dict(attrs).get("href")
            if href:self.links.append(href)
    def handle_endtag(self,tag):
        if tag in ("script","style") and self.skip:self.skip-=1
    def handle_data(self,text):
        if not self.skip:self.text.append(text)

LABEL=re.compile(r"deadline|closing\s+date|submission|termine|scadenza|prorog|date\s+limite|d[eé]lai|frist|abgabe|lehota|iesnieg|termi[nņ]|sista\s+anbudsdag|tenderReceipt|cancel|annull|awarded|aggiudic|zru[sš]|atcel",re.I)
DATE=re.compile(r"\b(?:20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]20\d{2}|\d{1,2}\s+[A-Za-zÀ-ž]+\s+20\d{2})\b")
def extract(data):
    if not data: raise ValueError("Empty original response; requires a separately verified recovery")
    if data.lstrip().startswith((b"{",b"[")):
        return "json",[json.dumps(json.loads(data),ensure_ascii=False,indent=2)],[]
    if data.startswith(b"%PDF-"):
        from pypdf import PdfReader
        import io
        reader=PdfReader(io.BytesIO(data))
        return "pdf",[p.extract_text() or "" for p in reader.pages],[]
    if data.startswith(b"PK"):
        import io
        with ZipFile(io.BytesIO(data)) as z:
            items=z.infolist()
            if sum(i.file_size for i in items)>50*1024*1024:raise ValueError("Expanded document exceeds 50 MiB")
            if "word/document.xml" not in z.namelist():raise ValueError("Unsupported ZIP document")
            root=ElementTree.fromstring(z.read("word/document.xml"))
            return "docx",["\n".join("".join(p.itertext()) for p in root.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p"))],[]
    parser=TextHTML();parser.feed(data.decode("utf-8","replace"))
    return "html",["".join(parser.text)],parser.links
def local_path(value):
    p=str(Path(value).absolute())
    return Path("\\\\?\\"+p) if os.name=="nt" and not p.startswith("\\\\?\\") else Path(p)
def run(inventory,output):
    out=local_path(output);out.mkdir(parents=True,exist_ok=False)
    records=[]
    for item in json.loads(local_path(inventory).read_text(encoding="utf-8")):
        rec={"job":item["job"],"sourceUrl":item["url"],"sourceSha256":item["sha256"],"sourceFile":item["path"],"verifiedOpen":False,"role":"document-evidence-only"}
        try:
            data=local_path(item["path"]).read_bytes()
            if hashlib.sha256(data).hexdigest()!=item["sha256"]:raise ValueError("Original evidence checksum differs")
            warnings=io.StringIO();handler=logging.StreamHandler(warnings);logger=logging.getLogger("pypdf");logger.addHandler(handler)
            try:kind,pages,links=extract(data)
            finally:logger.removeHandler(handler)
            text="\n\n".join(pages);name=item["sha256"]+".txt"
            (out/name).write_text(text,encoding="utf-8")
            rec.update(format=kind,textFile=name,textSha256=hashlib.sha256(text.encode()).hexdigest(),pages=len(pages),textAvailable=bool(text.strip()),requiresOCR=kind=="pdf" and not text.strip(),extractionWarnings=warnings.getvalue().splitlines(),signals=[])
            for page,content in enumerate(pages,1):
                for m in LABEL.finditer(content):
                    snippet=re.sub(r"\s+"," ",content[max(0,m.start()-80):m.end()+220]).strip()
                    rec["signals"].append({"page":page if kind=="pdf" else None,"offset":m.start(),"label":m.group(),"text":snippet,"dateStrings":DATE.findall(snippet)})
            rec["documentLinks"]=sorted(set(urljoin(item["url"],u) for u in links if urlparse(urljoin(item["url"],u)).scheme in ("http","https") and re.search(r"\.(pdf|docx?)(?:[?#]|$)",u,re.I)))
            rec["resolution"]="signals-require-notice-and-lot-verification" if rec["signals"] else "no-explicit-signal-found"
        except Exception as exc:rec.update(error=str(exc),resolution="extraction-failed-unverified")
        records.append(rec)
    body="".join(json.dumps(r,ensure_ascii=False)+"\n" for r in records)
    (out/"document-evidence.jsonl").write_text(body,encoding="utf-8")
    report={"documents":len(records),"extracted":sum("textFile" in r for r in records),"failed":sum("error" in r for r in records),"withSignals":sum(bool(r.get("signals")) for r in records),"sourceFilesUnchanged":True,"jsonlSha256":hashlib.sha256(body.encode()).hexdigest(),"verifiedOpen":False}
    (out/"manifest.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
    print(json.dumps(report))
if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--inventory",required=True);p.add_argument("--output",required=True);a=p.parse_args();run(a.inventory,a.output)
