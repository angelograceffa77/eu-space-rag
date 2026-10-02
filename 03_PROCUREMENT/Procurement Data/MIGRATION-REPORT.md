# Procurement reorganization — 2 October 2026

Completed in `C:\Users\angel\OneDrive\Desktop\knowledge\eu-space-rag`.

105 files (717,086,712 bytes) moved, with SHA-256 verification immediately after each move. The 78 generated intelligence/reference assets remain byte-for-byte unchanged after all edits. All 105 original file paths are absent, and all five empty original roots were removed. No additional unique data was deleted. Existing working-tree changes, including the already modified national workbook and previously deleted legacy package/ZIP, were preserved. Nothing was committed or pushed.

## Final layout

```text
03_PROCUREMENT/Procurement Data/
  ESA/{scrapers,generated,reference-documents}/
  EC-DG-DEFIS/{scrapers,generated}/
  EUSPA/{scrapers,generated,reference-documents}/
  EU27/
    TED/{scrapers,generated,reference-documents}/
    National-Portals/
      adapters and source register
      scrape-eu27-national-space-procurements.js
      refresh-eu27-national-space-procurements.cjs
      test/
      final-output/
      reviewed-output/
      package.json, package-lock.json, README.md
  README.md, MIGRATION-REPORT.md
  migration-manifest.json, code-changes.json
  package.json, package-lock.json, .gitignore
  validate-scrapers.cjs, smoke-sources.cjs
  validation summaries and test logs
  validation-output/ (ignored, isolated test products)
```

Installed node_modules are ignored. The accompanying `procurement-final-tree.txt` enumerates every persistent file, omitting dependency installations and ephemeral validation outputs.

## Root mapping and deleted originals

All old paths below are relative to `03_PROCUREMENT`; all destinations are beneath its new `Procurement Data` root.

| Old root | New root |
| --- | --- |
| ESA/Operational documents/Procurement Data | ESA |
| EU/DG DEFIS/Procurement Data | EC-DG-DEFIS |
| EUSPA/Procurement Data | EUSPA |
| Member States/EU27-GitHub-ready | EU27/National-Portals |
| Member States/Procurement Data | EU27/TED |

Standalone scraper names use `scrape-<authority>-<content>.js`. Code, generated snapshots and reference documents have separate directories. Existing intelligence names already identify source/content/date, so they retain their dated names and part numbering. Reference documents use normalized source-prefixed filenames, including `esa-gstp-element-1-compendia-2026-2028.pdf`.

The full 105-row old-to-new mapping with original checksums/byte counts is in `procurement-old-to-new.csv` and repository `migration-manifest.json`. `procurement-deleted-originals.txt` lists every removed original path; these removals are moves, not deletions of unique content.

## Code and dependency changes

- Replaced seven machine-specific output paths with scraper-relative `../generated` defaults and `PROCUREMENT_OUTPUT_DIR` overrides. Checkpoint and TED cache paths follow these destinations.
- Made seven standalone scripts safe to import, while retaining their normal direct execution. Exported `main` and resolved output directory for runtime validation. Top-level failure handlers signal failure to the process.
- Renamed the national CLI and refresh wrapper, updated README commands, and added `PROCUREMENT_FINAL_OUTPUT_DIR` for isolated refresh/consolidation validation. Relative national module imports and its `data`, `final-output` and `reviewed-output` layout remain valid.
- Removed automatic copying of the TED script into generated data, which would have recreated duplicate source files.
- Added a shared, locked dependency manifest (Axios, Cheerio, ExcelJS) plus repeatable offline and bounded live validation commands; installed the national collector's locked dependencies, including playwright-core.
- Updated the repository README and new procurement README. Excluded validation output/runtime/cache directories from the RAG scanner and Git tracking.
- Updated 29,391 stored index file references and manifest source paths. Recomputed shard byte/chunk metadata. All 90,100 indexed content chunks remain; this is a path migration, not a fresh reindex of the latest generated datasets.
- Fixed a discovered TED raw export defect: notices exceeding twelve 30,000-character Excel cells were truncated when reconstructed into raw JSONL. Future exports retain overflow for the raw JSONL; incomplete legacy payloads now fail explicitly. Regression validation confirms a 400,000-character notice round trip and rejection of an incomplete legacy payload. Existing source evidence remains unchanged.

`code-changes.json` lists changed existing files. New setup, validation, documentation and evidence files are visible in the final tree.

## Commands actually run and results

Commands below ran from the new procurement root unless specified otherwise.

| Command / check | Actual result |
| --- | --- |
| `npm install --ignore-scripts --no-audit --no-fund` | Shared dependencies installed, lockfile generated |
| `npm ci --ignore-scripts --no-audit --no-fund` in EU27/National-Portals | Locked national dependencies installed |
| `node --check <file>` for each moved JS/CJS file | 22 passed |
| `npm test` | All seven offline standalone validations and all 27 national regression tests passed |
| `node smoke-sources.cjs` | All seven standalone real source-request functions returned responses within their bounds |
| National CLI `--help` | Passed |
| National refresh wrapper `--help` | Passed |
| Isolated national refresh smoke command below | Completed, exported/re-read workbooks and JSONL; France and Poland coverage both partial, zero candidates |
| Root repository `npm test` | Existing server/index-manager/index-worker syntax suite passed |
| Hash verification of preserved intelligence/reference files | 78 passed; all original file paths absent |
| JSONL record parsing | 41 files scanned; 51,443 valid records, one pre-existing truncated raw record |
| Index shard validation | All shards parse; 90,100 chunks retained; no old procurement-root references remain in index |

The national live command was:

```powershell
$env:PROCUREMENT_FINAL_OUTPUT_DIR = Join-Path (Get-Location) 'validation-output/national-consolidated'
node EU27/National-Portals/refresh-eu27-national-space-procurements.cjs --mode=smoke --sources=FR-portal,PL-portal --from=2026-10-01 --to=2026-10-02 --timeout-ms=5000 --delay-ms=0 --output=validation-output/national-live
```

The refresh wrapper invokes the real collector. Both sources made one request; the explicit smoke page budgets limited coverage. The zero-row live smoke export does not demonstrate a positive live candidate result; the regression suite independently verifies nonempty normalized Excel/JSONL export consistency. The isolated refresh output had no historical baseline; merging the entire retained historical snapshot was not live-verified.

Offline standalone checks actually loaded each scraper's dependencies, asserted default/override output resolution, ran its real JSONL writer against a saved record, parsed its output, and streamed a relocated workbook. These checks do not run every step of `main`.

## Per-scraper live verification limits

| Scraper | Tested successfully | What remains unverified |
| --- | --- | --- |
| ESA Publication | Offline runtime/export/workbook; one real first-page source request | Full pagination, ESA/non-ESA complete collection and final live workbook generation |
| ESA Match tender actions | Offline runtime/export/workbook; one real first-page source request | Complete pagination and final live generation |
| DG DEFIS Funding & Tenders | Offline runtime/export/workbook; one real search request | All search terms, deduplication and complete final live generation |
| DG DEFIS TED | Offline runtime/export/workbook; one real TED query | Full date/history collection and final live generation |
| EUSPA closed | Offline runtime/export/workbook; real closed-list HTML request | All detail pages/enrichment and final live generation |
| EUSPA current/planned | Offline runtime/export/workbook; real procurement HTML request | Full list parsing/detail enrichment and final live generation |
| EU27 TED master | Offline runtime/export/workbook, oversized raw regression; one real TED query | All country/year/deadline passes, cache resume and full live master generation |
| EU27 national collector and refresh | 27 regressions, CLI validation, real FR/PL smoke collection and isolated consolidation | All other native/browser/discovery adapters, complete historical archives and full historical refresh merge |

Full historical refreshes were not performed: the checks were bounded to validate relocation without replacing retained dated intelligence or running exhaustive multi-country history/browser/archive jobs. These are explicit testing limits; no claim is made that every complete scraper pipeline has been live-verified.

## Existing data issue

`EU27/TED/generated/EU27_TED_SOURCE_RAW_2026-10-01.part-0002.jsonl`, line 1, contains a 360,000-character truncated notice (publication `711084-2024`). Its original checksum matches the migration manifest, proving the reorganization did not create the truncation. It lacks the end of the payload and cannot be reconstructed from that raw line. The generator defect is fixed for future collections, but this existing record still requires retrieval from TED to restore a complete source payload. It was preserved rather than silently rewritten, removed or fabricated.

Historic national `rawFile`/`evidenceFiles` values remain provenance references. The original GitHub-ready package intentionally lacked those archives; this migration does not claim to restore them. Index content remains from its previous build and may contain pre-existing stale source entries; only procurement path relocation was handled.
