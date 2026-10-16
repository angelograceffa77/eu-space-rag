# Hungary procurement refresh

Run from this National-Portals folder with Node.js 22 or later and the existing dependencies installed:

```powershell
node .\refresh-hungary.cjs
```

Each fresh run has a new timestamped folder under `data\Hungary\YYYY-MM-DD`. To resume an interrupted run, use its original date and exact folder:

```powershell
node .\refresh-hungary.cjs --as-of=2026-10-14 --resume=".\data\Hungary\2026-10-14"
```

Resume reuses evidence; it is not a new live refresh. Omit `--resume` for fresh searches. Do not run two collectors against the same run folder. Existing final outputs remain until search/detail checks and Excel/JSONL validation succeed. Previously published files are backed up under the run's `previous-final` folder.

Outputs are in `final-output\Hungary`: the dated Excel workbook and MASTER, OPEN, HISTORY, REVIEW and COVERAGE UTF-8 JSONL files. MASTER is the latest candidate set, not a list of confirmed space contracts. OPEN contains only confirmed space records with current public bidding and a future deadline. REVIEW includes unconfirmed geospatial, radar, astronomy and full-text search matches. Qualification/DPS admission and invitation-only procedures are not OPEN.

`GITHUB-READABLE-MANIFEST.json` points to lossless small MASTER/HISTORY parts. Upload the workbook, JSONL views, manifest, referenced `github-readable` folder, source audit and this reusable collector with its helpers. Do not upload raw collection caches, checkpoints or backup directories. Canonical records link to official source URLs; `rawFile` is a local evidence path, not a portable GitHub URL.

Coverage: official EKR current register plus Hungarian/English keywords and validated official CPV dictionary codes, history from 2020; full selected procedure and lot metadata; selected public notice PDFs; official Hungarian space/research/defence procurement pages. Record counts reconcile for each query, but historical keyword screening and agency discovery are not exhaustive national coverage. Archive HTTP 403, inaccessible pages, missing PDFs and restricted procedures are disclosed in COVERAGE and the source audit.

The country runner changes Hungary only. The combined EU27 snapshot must be reconciled separately after a country refresh; it is not automatically refreshed by this command.
