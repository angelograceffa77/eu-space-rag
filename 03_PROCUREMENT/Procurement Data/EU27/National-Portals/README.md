# EU-27 space procurement — GitHub package

This folder contains only the runnable scraper, its dependencies manifest/tests, and the latest final Excel and UTF-8 JSONL outputs. Install dependencies locally; do not commit node_modules or the data directory.

## Final outputs

- final-output: 5,423 latest candidates, 7,798 notice/lot versions, 24 automatic open candidates, review records and source coverage. The Excel workbook and JSONL have matching fields.
- reviewed-output: dated manual audit with 16 verified core open opportunities, six supporting procurements, two unresolved cases and two exclusions. This is a 1 October 2026 review, not a permanently current list.

The source register covers all 27 member states, but collection is incomplete: 39 sources remain discovery-only, eight reported failures, and Spain's historical archive is partial. Read the COVERAGE JSONL. OPEN is automated classification and does not establish bidder eligibility or guarantee that no later amendment exists.

## Refresh and regenerate the automatic outputs

Requires Node.js 22 or newer and Microsoft Edge for the browser-based sources. Another Chromium executable can be supplied through SCRAPER_BROWSER_PATH.

```powershell
npm ci --ignore-scripts
npm test
node refresh-eu27-national-space-procurements.cjs --browser --from=2020-01-01
```

refresh-eu27-national-space-procurements.cjs collects updated records, merges them with the bundled historical records, recalculates statuses, and writes a newly dated workbook plus MASTER, HISTORY, OPEN, REVIEW and COVERAGE JSONL into final-output. It reads only the latest dated historical snapshot as its baseline. Prior dated outputs are retained. Errors and incomplete coverage are written into the coverage output. This regeneration needs no files outside this folder, apart from installed dependencies and the browser.

For a selected source:

```powershell
node refresh-eu27-national-space-procurements.cjs --sources=IE-portal --from=2020-01-01
```

To request historical archives as well (large downloads and long runs):

```powershell
node refresh-eu27-national-space-procurements.cjs --sources=DE-portal,NL-portal,ES-portal --archives --from=2020-01-01 --archive-timeout-ms=7200000
```

German monthly exports start December 2022 and contain some older migrated notices. Dutch published historical datasets currently end June 2026. Spanish archives can time out; complete entries in interrupted downloads are recovered and the gap is reported. Portal content and coverage change, so future counts will differ from this snapshot.

The manual reviewed-output files cannot be regenerated as freshly verified by an automatic scrape. Recheck their official links and deadlines before updating that review. Original rawFile/evidenceFiles values are provenance references to the original collection; raw archives and saved web pages are intentionally not included in this clean package. Public sourceUrl/applicationUrl links remain available.

No GitHub push or scheduled task is performed by these scripts.
