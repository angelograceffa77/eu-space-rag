# EU-27 national space procurement collector

Collect public national procurement notices and space-body procurement pages, with history requested from **1 January 2020** and a separate view of opportunities with future submission deadlines. This is a source-specific collector plus a discovery layer, **not a claim of complete collection from all 27 countries**.

The original prototype is preserved separately in `eu27-national-space-scrapers`. This package separates discovery-only sources, parsed tender candidates and manually reviewed opportunities. Start with `audited-output` for reviewed opportunities and `current-output` for the latest consolidated collection.

## What works in this release

| Source | Collection method | Historical/access limitation |
|---|---|---|
| Austria USP | Public search API, pagination, individual notice pages | Keyword-based; indexed history varies |
| France BOAMP | Public API, reverse chronological year partitions, automatic splitting before the API offset cap | Broad French terms, programmes and CPVs; not a semantic guarantee of all relevant notices |
| Poland BZP | Public API, newest monthly windows first, documented `SearchAfter` cursor, competition/update/result notices | New BZP starts in 2021; 2020 requires legacy BZP or complementary TED data |
| Spain PLACSP | Public Atom feed and its next links; optional automatic official annual ZIP archives | Hosted buyer profiles, excluding minor contracts; archives can be large |
| Netherlands TenderNed | Public recent Atom/RSS and official annual OCDS JSON datasets with `--archives` | Published historical datasets currently end June 2026; current XML API requires credentials |
| Germany | Public daily and monthly eForms ZIPs, with separate lot descriptions and deadlines | Official archive begins December 2022; current-day notices require a live check |
| CNES and France PLACE | Public browser search and pagination | Current keyword/listing coverage; closed archive coverage is incomplete |
| ASI and INAF | ASI procurement categories and linked details; INAF public notice details | ASI categories traversed from 2020; INAF historical search forms remain a gap |
| Spanish Space Agency | Public contracting profile, browser pagination | Profile publication dates are often missing; status and deadline are retained |
| Ireland | Public EPPS advanced title searches, pagination and individual details | Current platform starts May 2023; title searches can miss relevance found only in descriptions |
| Cyprus and Malta | Individual public EPPS notice pages with labelled fields | Discovery is bounded; Malta's advanced search presents a CAPTCHA |
| EU SST | Official open/past procurement tables | Many entries have no publication date; these are explicitly marked undated |
| DLR | Public current tender RSS feeds discovered on DLR's official procurement page | Recent opportunities only; no historical archive coverage claimed |
| Other national portals and space bodies | Linked-page discovery, supplied notice seeds, text-PDF extraction, optional local browser rendering and optional search provider | Discovery-only until a source-specific parser verifies the notice fields; forms, access challenges, scanned PDFs and unlinked archives remain gaps |

The source register includes all 27 EU countries, national space agencies or relevant public bodies, and additional procurement sources including CNES, DLR, ASI, INAF, POLSA and TELEDIFE. Registration is **not** proof of working or complete collection. See `SOURCE-COVERAGE.md` and each run's coverage output.

Sweden has no single national notice database. The register includes several registered advertising databases; it does not imply complete coverage of their paid or restricted content.

## Run on this computer

Requires Node.js 22 or newer. Keep all package files together.

```powershell
npm ci --ignore-scripts
node eu27-national-space-procurements.js --help
```

Quick API/page connectivity test:

```powershell
node eu27-national-space-procurements.js --mode=smoke
```

Normal bounded collection, with the installed Microsoft Edge used to render public JavaScript pages:

```powershell
node eu27-national-space-procurements.js --browser --from=2020-01-01
```

Collect only selected sources:

```powershell
node eu27-national-space-procurements.js --sources=AT-portal,FR-portal,PL-portal,ES-portal,NL-portal,EU-SST --from=2020-01-01
```

Spain, including the official annual archives from 2020 onward:

```powershell
node eu27-national-space-procurements.js --sources=ES-portal --archives --from=2020-01-01 --timeout-ms=120000 --archive-timeout-ms=7200000 --output=./data-spain
```

Archive downloads can take a long time and substantial disk space. They are opt-in. Each archive is retained without extracting archive-controlled filenames onto the filesystem. ZIP members are read as data. Very large XML members are reported as gaps. Spain's server did not support byte-range resumption in the live test. An interrupted download remains as `.part`; complete Atom members can be recovered automatically, with the annual collection explicitly marked incomplete. The default archive timeout is 30 minutes; the example allows two hours per Spanish annual download.

Germany and Netherlands historical collection:

```powershell
node eu27-national-space-procurements.js --sources=DE-portal,NL-portal --archives --from=2020-01-01 --output=./data-history
```

Resume an interrupted run using **the same options and output directory**, adding `--resume`:

```powershell
node eu27-national-space-procurements.js --browser --from=2020-01-01 --resume
```

Completed sources are not fetched again during a resume. Interrupted sources reuse saved response bodies and reprocess their pages. A normal run without `--resume` creates a new timestamped run and refreshes its sources. If a process was forcibly terminated, verify it is no longer running before removing its `.collection.lock` file. Do not run two collectors against the same output directory.

Useful settings:

- `--max-pages=2000`: maximum direct requests per source (default 2000).
- `--web-pages=100`: maximum pages per discovery source (default 100).
- `--depth=3`: maximum linked-page depth.
- `--delay-ms=1200`: minimum spacing between requests to the same host.
- `--concurrency=2`: concurrent sources, maximum 4.
- `--timeout-ms=45000`: ordinary request timeout.
- `--archive-timeout-ms=7200000`: optional Spanish annual-download timeout, in milliseconds.
- `--output=PATH`: separate storage folder.
- `--sources=all` or a comma-separated list of source IDs.
- `--list-sources`: print the register and source references.
- `--seeds=FILE`: JSON object mapping source IDs to arrays of notice URLs.

Limits are always reported. Reaching a limit does not mean history is complete. Increasing a limit can produce a long run, particularly for Poland's unfiltered national notice history.

The optional browser uses a fresh isolated, headless Edge context. It does not use your personal browser profile or log in. On another machine, set `SCRAPER_BROWSER_PATH` to an installed Chromium-compatible browser executable. Access challenges are reported; the scraper does not solve them.

## Optional search and hosted rendering

If you have your own `FIRECRAWL_API_KEY` in the environment:

```powershell
node eu27-national-space-procurements.js --discover --browser
```

`--discover` adds domain-restricted search results to direct collection. Search is capped per query (`--search-limit=20`) and cannot establish exhaustive historical coverage. Localised and international space terms are included. The bundled `seeds.json` contains public notice links discovered on 1 October 2026; they provide starting points, not a continually updated index.

`--render` is an alternative hosted HTML renderer requiring that API key. It is separate from the no-service-key `--browser` option. No API key is included in this package, checkpoint or logs.

## Historical file import

Extract downloaded official Atom/XML archives to a folder and prefix each filename with its source ID and `__`, for example `ES-portal__2020-01.atom` or `NL-portal__2021.xml`:

```powershell
node eu27-national-space-procurements.js --sources=ES-portal,NL-portal --import-dir=C:\path\to\official-atom-files
```

Only feed-shaped Atom/XML is supported by this importer. It does not claim to parse every TenderNed historical spreadsheet or export format. Spain's automatic `--archives` option requires no manual renaming.

## Outputs

Every normal run has its own timestamped folder containing:

- `EU27_NATIONAL_SPACE_YYYY-MM-DD.xlsx`: MASTER, OPEN, HISTORY, REVIEW and COVERAGE worksheets.
- `EU27_NATIONAL_SPACE_YYYY-MM-DD_MASTER.jsonl`: latest candidate record per source/procedure, or per notice where no stable procedure identifier exists.
- `EU27_NATIONAL_SPACE_YYYY-MM-DD_OPEN.jsonl`: space-relevant, structurally verified tender notices with a future submission deadline.
- `EU27_NATIONAL_SPACE_YYYY-MM-DD_HISTORY.jsonl`: retained relevant notice versions.
- `EU27_NATIONAL_SPACE_YYYY-MM-DD_REVIEW.jsonl`: ambiguous relevance, unstructured matches and records without publication dates.
- `EU27_NATIONAL_SPACE_YYYY-MM-DD_COVERAGE.jsonl`: requests, records, limits, errors and gaps by source.
- `raw/`: original response bodies, request provenance, optional rendered pages and archives.
- `validation.json`: output paths, counts and the result of reading back Excel and comparing every normalized field.

All JSONL files are UTF-8, one JSON object per line. Excel and the four record JSONL files share the same 34 normalized fields. Arrays such as CPVs and document links are stored as readable strings. Descriptions are limited to 29,000 characters so they fit in Excel; `textTruncated` identifies truncation and `rawFile` points to the full original source. `ragText` is generated from the normalized record. Excel and JSONL exports are written only after collection, using temporary files followed by rename.

MASTER includes candidates; it is not a list of confirmed tenders only. Grants, planning notices, undated pages and broad downstream applications are labelled explicitly. Check `noticeVerified`, `noticeType`, `relevance` and `status`. `defenceEvidence` identifies explicit defence terms accompanying space relevance; ordinary defence procurement alone does not qualify.

The collector does not infer an open tender from the word “open” in a procedure type. Awards, explicit cancellations and planning notices take precedence over future deadlines. A deadline with only a date is treated conservatively on the closing day. Local times are interpreted in the source's time zone; unparseable deadlines remain unknown.

Duplicate versions are removed by deterministic record identity. Procedure consolidation stays within a source and uses explicit IDs. Cross-portal near-duplicates are intentionally retained because fuzzy title matching could wrongly merge distinct lots or contracts. An incomplete run may miss a subsequent amendment or award; OPEN is based on the collected source evidence, not a guarantee that bidding remains possible.

## Validation and remaining work

```powershell
npm test
```

Tests cover date/time handling, closing-day uncertainty, cancellation/award precedence, multilingual and false-positive matching, source coverage registration, feed parsing, EPPS behavior, cursor pagination and actual Excel/JSONL field equality. Live validation is deliberately bounded; it is not the seven-year harvest. `VALIDATION.md` records what was tested and what remains unsupported.

No existing ESA, EUSPA, DG DEFIS, companies or TED collector is overwritten by this package. No GitHub commit or push is performed.


## Restart update (2026-10-01)

See RESTART-STATUS.md for the current collected scope and remaining gaps. `current-output` is the latest consolidated export; `sample-output` and `refreshed-output` preserve earlier snapshots. `audited-output/VERIFIED_OPPORTUNITIES_2026-10-01.xlsx` separates verified core opportunities, supporting procurements, unresolved cases and exclusions. Its JSONL files use the same review fields. Manual review is a dated check of relevance, status, deadline and application link, not confirmation that a particular bidder meets eligibility conditions. No scheduled jobs are included.
