# Procurement Data
For the current retained-file layout and archive policy, read [FOLDER-GUIDE.txt](FOLDER-GUIDE.txt). Obsolete builds and unneeded exports have been archived; required source inputs, test fixtures and files referenced by the repository index remain. The daily publisher publishes only the validated master package. Automatic daily runs are currently paused.


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

## Expanded authority collectors (2026-10-13)

21 additional authority folders use `AUTHORITY/scrapers` and `AUTHORITY/generated`. Generated data and cache evidence retain original bytes. Run `npm run test:expanded` for 30 offline validations. PDF collectors require the declared pdf-parse 1.1.1 dependency. Tests do not establish full live source coverage.

- `node ECMWF/scrapers/scrape-ecmwf-procurements.js`
- `node EC-DG-AGRI/scrapers/scrape-dg-agri-funding-tenders.js`
- `node EC-DG-AGRI/scrapers/scrape-dg-agri-ted-procurements.js`
- `node EC-DG-CLIMA/scrapers/scrape-dg-clima-funding-tenders.js`
- `node EC-DG-CLIMA/scrapers/scrape-dg-clima-ted-procurements.js`
- `node EC-DG-CONNECT/scrapers/scrape-dg-connect-funding-tenders.js`
- `node EC-DG-CONNECT/scrapers/scrape-dg-connect-ted-procurements.js`
- `node EC-DG-ECHO/scrapers/scrape-dg-echo-funding-tenders.js`
- `node EC-DG-ECHO/scrapers/scrape-dg-echo-ted-procurements.js`
- `node EC-DG-ENV/scrapers/scrape-dg-env-funding-tenders.js`
- `node EC-DG-ENV/scrapers/scrape-dg-env-ted-procurements.js`
- `node EC-DG-HOME/scrapers/scrape-dg-home-funding-tenders.js`
- `node EC-DG-HOME/scrapers/scrape-dg-home-ted-procurements.js`
- `node EC-DG-MARE/scrapers/scrape-dg-mare-funding-tenders.js`
- `node EC-DG-MARE/scrapers/scrape-dg-mare-ted-procurements.js`
- `node EC-DG-MOVE/scrapers/scrape-dg-move-funding-tenders.js`
- `node EC-DG-MOVE/scrapers/scrape-dg-move-ted-procurements.js`
- `node EC-DG-RTD/scrapers/scrape-dg-rtd-funding-tenders.js`
- `node EC-DG-RTD/scrapers/scrape-dg-rtd-ted-procurements.js`
- `node EDA/scrapers/scrape-eda-procurements.js`
- `node JRC/scrapers/scrape-jrc-procurements.js`
- `node EEA/scrapers/scrape-eea-procurements.js`
- `node EMSA/scrapers/scrape-emsa-procurements.js`
- `node EU-SatCen/scrapers/scrape-satcen-procurements.js`
- `node Frontex/scrapers/scrape-frontex-procurements.js`
- `node EUMETSAT/scrapers/scrape-eumetsat-procurements.js`
- `node Eurocontrol/scrapers/scrape-eurocontrol-procurements.js`
- `node ESO/scrapers/scrape-eso-procurements.js`
- `node NATO/scrapers/scrape-nato-procurements.js`
- `node OCCAR/scrapers/scrape-occar-procurements.js`

Set `PROCUREMENT_OUTPUT_DIR` to isolate a run. Existing dated outputs and cache folder names are preserved; source scripts stay in `scrapers`. Original scraper sources are archived in `migration-21-original-scrapers.zip`. See `MIGRATION-21-REPORT.md` and `migration-21-manifest.json`.

