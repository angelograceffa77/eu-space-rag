# EU-27 space procurement — GitHub package

This folder contains only the runnable scraper, its dependencies manifest/tests, and dated final Excel and UTF-8 JSONL outputs. Install dependencies locally; do not commit node_modules or the data directory.

## Final outputs

- final-output: 7,403 latest candidates, 10,458 notice/lot versions, 34 automatic open candidates (5 October 2026), review records and source coverage. The Excel workbook and JSONL have matching fields.
- reviewed-output: dated manual audit with 16 verified core open opportunities, six supporting procurements, two unresolved cases and two exclusions. This is a 1 October 2026 review, not a permanently current list.

The source register covers all 27 member states, but collection is incomplete: 24 sources remain discovery-only, six reported failures, and several national historical archives remain partial. Read the COVERAGE JSONL. OPEN is automated classification and does not establish bidder eligibility or guarantee that no later amendment exists.

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


### Country folders

Both collection and consolidated refresh now retain the combined EU27 outputs and also write one folder per country under the output directory (for example, final-output/France/). Each folder contains CODE_NATIONAL_SPACE_YYYY-MM-DD.xlsx and matching UTF-8 _MASTER, _OPEN, _HISTORY, _REVIEW and _COVERAGE.jsonl files, plus validation.json. All 27 country folders are generated, including empty datasets; an empty dataset does not establish absence of tenders or complete coverage. Country codes remain unchanged inside records. EU-wide sources use European Union/ and the EU prefix. Coverage is filtered to the corresponding country; existing coverage limitations remain.

The refresh command automatically regenerates these folders. Combined files remain available for historical merging and compatibility. Splitting an existing snapshot is not a fresh collection and does not re-verify source websites.

### Native portal repairs (5 October 2026)

The native-portals*.cjs modules add public searches for Belgium, Bulgaria, Croatia, Czechia, Denmark, Estonia, Finland, Greece, Hungary, Latvia, Luxembourg, Poland, Romania, Slovakia and Slovenia. Lithuania uses the public EPPS search, Italy checks the Consip catalogue alongside existing agency collectors, and Sweden collects e-Avrop current search results and recent award notices. Portugal uses the public BASE interface, but the final snapshot contains only the saved first contract-search response because subsequent requests were blocked. Cyprus and Malta collect individually accessible seeded notices while broad searches require CAPTCHA.

See final-output/COUNTRY_COVERAGE_2026-10-05.md and the accompanying JSON for counts and remaining gaps. Every EU member state now has substantive collected records, but no country is represented as exhaustively collected. Ordinary defence contracts are included only when space evidence is present. Ambiguous document-only hits are retained in REVIEW rather than confirmed OPEN. Greek historical search is split into periods of no more than 180 days.

For a slower national-source refresh, use --concurrency=1 --delay-ms=3500. An interrupted historical JSON API run can explicitly reuse its saved responses with --raw-cache-dir=PATH; use this only when deliberately accepting that cache's retrieval date. Omit it for a fresh query. Request failures retain emitted records and remain visible in COVERAGE. A CAPTCHA, HTTP access block or zero search results does not establish that no tenders exist.
