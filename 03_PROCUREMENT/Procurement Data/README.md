# Procurement Data

Consolidated procurement scrapers, generated intelligence and authority reference documents. Paths are relative to this folder; Node.js 22 or newer is required.

| Folder | Contents |
| --- | --- |
| ESA/scrapers | ESA Match tender actions and ESA Publication tender actions |
| EC-DG-DEFIS/scrapers | Commission Funding & Tenders and TED procurement collection |
| EUSPA/scrapers | Current/planned and closed EUSPA procurements |
| EU27/TED/scrapers | EU27 TED space procurement master, source and notice history |
| EU27/National-Portals | National portal/agency adapters, source register, CLI, refresh, tests and dated snapshots |
| Authority/generated | Existing dated Excel/UTF-8 JSONL intelligence; original contents preserved |
| Authority/reference-documents | Programme plans, contractor lists and source screenshots |
| EU27/National-Portals/final-output | Automatic national portal intelligence and coverage |
| EU27/National-Portals/reviewed-output | Dated manual verification; do not treat as a current automatic scrape |

## Install and validate

Run from this folder:

```powershell
npm ci --ignore-scripts
npm --prefix EU27/National-Portals ci --ignore-scripts
npm test
node smoke-sources.cjs
```

`npm test` runs offline syntax/dependency/path checks, saved-record JSONL export round trips, relocated workbook reads and the national collector's 27 regression tests. `node smoke-sources.cjs` uses each standalone scraper's real request function, with a 25-second bound per source. A source response does not verify full pagination, detail enrichment, completeness, or the complete live export pipeline. Inspect `validation-output/live-source-checks.json` for individual results. Validation writes only to ignored `validation-output`.

## Run a full scraper

```powershell
node ESA/scrapers/scrape-esa-tender-actions.js
node ESA/scrapers/scrape-esa-publication-tenders.js
node EC-DG-DEFIS/scrapers/scrape-dg-defis-ted-procurements.js
node EC-DG-DEFIS/scrapers/scrape-dg-defis-funding-tenders.js
node EUSPA/scrapers/scrape-euspa-current-planned-procurements.js
node EUSPA/scrapers/scrape-euspa-closed-procurements.js
node EU27/TED/scrapers/scrape-eu27-ted-space-procurements.js
node EU27/National-Portals/scrape-eu27-national-space-procurements.js --help
node EU27/National-Portals/refresh-eu27-national-space-procurements.cjs --help
```

Standalone scripts default to their authority's `generated` folder regardless of working directory. Set `PROCUREMENT_OUTPUT_DIR` to isolate a refresh; checkpoint/cache paths follow that destination. Source code remains in `scrapers` and is not copied into generated output. Full live runs may be long and may replace same-day output or resume checkpoints.

National collection supports `--output=DIR`, `--mode=smoke`, source selection and request budgets. Its default collection destination remains `EU27/National-Portals/data`. The refresh wrapper merges the latest dated HISTORY baseline into `final-output`; set `PROCUREMENT_FINAL_OUTPUT_DIR` to test consolidation elsewhere. Browser adapters require Edge/Chromium (`SCRAPER_BROWSER_PATH`), and optional discovery uses `FIRECRAWL_API_KEY`.

## Migration and indexing

`migration-manifest.json` records every original/destination path, original byte count and original SHA-256. Code/docs/manifests intentionally change after moving; all 78 moved intelligence/reference assets retain exact bytes. Dated output names, chunk numbering and provenance content are preserved. Historical rawFile/evidenceFiles references in national output remain provenance, as explained by the national README; the old clean package did not contain those raw archives.

Local `index/manifest.json` source keys and shard file references follow the new layout. All 90,100 existing indexed text chunks are retained; this path migration is not a fresh reindex of the latest intelligence. The index scanner excludes installed dependencies, validation output and runtime caches. No GitHub publication was performed.

See `MIGRATION-REPORT.md`, `preservation-validation.json`, `jsonl-validation.json`, `index-migration-validation.json` and test logs for verification and limits. Existing repository changes, including pre-existing deletions and a modified national workbook, were preserved.
