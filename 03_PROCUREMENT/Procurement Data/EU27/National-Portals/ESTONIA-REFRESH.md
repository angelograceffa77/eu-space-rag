# Estonia collector

Run from this National-Portals folder with Node.js 22+, installed npm dependencies and Microsoft Edge. EIS PDF parsing also requires Python with pypdf; set EE_PYTHON_BIN to your Python executable if needed.

Fresh collection (history from January 2020 plus current register status):

```powershell
node .\refresh-estonia.cjs
```

Resume an interrupted run using the same collection date and directory:

```powershell
node .\refresh-estonia.cjs --resume="FULL_RUN_DIRECTORY" --as-of=YYYY-MM-DD
```

A fresh run creates a new timestamped directory under data/Estonia. Resume reuses its raw evidence and checkpoints and is not a new live refresh. Final files are staged and Excel/JSONL cells compared before publication. The prior final snapshot is backed up before replacing same-named files. A failed download, parse, query, detail retrieval or export prevents final publication.

Outputs are under final-output/Estonia:

- EE_NATIONAL_SPACE_DATE.xlsx: MASTER, OPEN, HISTORY, REVIEW and COVERAGE sheets.
- Matching UTF-8 JSONL for each sheet. MASTER contains the latest record per procedure; HISTORY preserves notice versions; OPEN requires verified space relevance and a current deadline; REVIEW contains uncertain scope or status. These views overlap and must not be added together.
- GITHUB-READABLE-MANIFEST.json and github-readable/: lossless small MASTER/HISTORY parts, with hashes and indexes. Read all parts for exhaustive questions.
- ESTONIA_SOURCE_AUDIT.json and validation.json: source coverage, excluded candidates, counts and cell-comparison results.

Collection methods: official monthly XML notices and awards; authenticated-by-normal-anonymous-session public RHR search and current general-info; EIS procurement page, annual procurement plan, and Space Estonia page. Public searches reaching 500 rows are recursively split by publication date. Estonian/English space terms, space/sensing CPVs, current procedure states, relevant buyers and future archive deadlines supplement each other. Current procedure details take precedence over older notice versions. Qualification systems and invitation-only stages do not establish an open public tender.

Coverage remains partial: restricted, removed or unpublished purchases and space relevance found only in attachments may be missing. Broad radar, surveying and incidental GPS results require review. Agency plans are not active tender invitations; EIS links international opportunities to ESA/EUSPA/EUMETSAT, which belong to their separate collectors. The EIS attachment labelled current is dated 2022 in the source URL and is preserved as historical evidence.

For GitHub publish the scraper modules and their shared dependencies, package files, this guide, and final-output/Estonia. Retain raw evidence locally. Do not upload backups, checkpoints, browser state, node_modules or raw archive downloads by default. This entry point refreshes Estonia only; combined EU27 exports are reconciled separately.
