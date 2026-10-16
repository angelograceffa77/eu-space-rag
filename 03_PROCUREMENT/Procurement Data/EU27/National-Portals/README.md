# EU-27 space procurement — GitHub package

This folder contains only the runnable scraper, its dependencies manifest/tests, and dated final Excel and UTF-8 JSONL outputs. Install dependencies locally; do not commit node_modules or the data directory.

## Final outputs

- final-output: dated latest candidates, notice/lot history, automatic open candidates, review records and source coverage. Read validation.json and the newly dated COVERAGE JSONL for each refresh result. FINAL_VALIDATION, COUNTRY_COVERAGE and COUNTRY_REPAIR_PROGRESS document the dated repair audit. The Excel workbook and JSONL have matching fields.
- reviewed-output: dated manual audit with 16 verified core open opportunities, six supporting procurements, two unresolved cases and two exclusions. This is a 1 October 2026 review, not a permanently current list.

The source register covers all 27 member states, but collection is incomplete. Read the COVERAGE JSONL and COUNTRY_REPAIR_PROGRESS.json for current source failures, limitations and completed repair passes. OPEN is automated classification and does not establish bidder eligibility or guarantee that no later amendment exists.

## Finland full refresh

Use `node refresh-finland.cjs` for complete HILMA index screening from January 2020, full selected procedure histories and current-deadline checks. See [FINLAND-REFRESH.md](FINLAND-REFRESH.md) for requirements, resume instructions and coverage limits. The generic Finland adapter remains a smaller discovery scan.

## Estonia full refresh

Use `node refresh-estonia.cjs` for the enhanced Estonia collection, including all available monthly notice/award exports from January 2020, current procedure checks and EIS sources. See [ESTONIA-REFRESH.md](ESTONIA-REFRESH.md) for requirements, resume instructions and coverage limits. The older generic Estonia adapter is a smaller discovery scan and does not reproduce this enhanced collection.

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

The native-portals*.cjs modules add public searches for Belgium, Bulgaria, Croatia, Czechia, Denmark, Estonia, Finland, Greece, Hungary, Latvia, Luxembourg, Poland, Romania, Slovakia and Slovenia. Lithuania uses the public EPPS search, Italy checks the Consip catalogue alongside existing agency collectors, and Sweden collects e-Avrop current search results and recent award notices. Portugal uses official annual BASE open-data exports for contracts, announcements and modifications, plus the Portuguese Space Agency procurement page. Cyprus adds official annual Treasury award exports and publicly linked buyer notice lists; broad national searches still require CAPTCHA. Malta follows public buyer notice lists back to 2020, using the portal-supported 100-row pages, and collects Xjenza Malta PECS call announcements with identified ESA activities. The separate legacy award-PDF site returned HTTP 403 and is not included.

See final-output/COUNTRY_COVERAGE_2026-10-05.md and the accompanying JSON for counts and remaining gaps. Every EU member state now has substantive collected records, but no country is represented as exhaustively collected. Ordinary defence contracts are included only when space evidence is present. Ambiguous document-only hits are retained in REVIEW rather than confirmed OPEN. Greek historical search is split into periods of no more than 180 days.

For a slower national-source refresh, use --concurrency=1 --delay-ms=3500. An interrupted historical JSON API run can explicitly reuse its saved responses with --raw-cache-dir=PATH; use this only when deliberately accepting that cache's retrieval date. Omit it for a fresh query. Request failures retain emitted records and remain visible in COVERAGE. A CAPTCHA, HTTP access block or zero search results does not establish that no tenders exist.

### Annual archive collection

Portugal processes large ZIP/JSON exports. Allow approximately 6 GB Node heap for this source: `node --max-old-space-size=6144 refresh-eu27-national-space-procurements.cjs --sources=PT-portal,PT-space,PT-azores --from=2020-01-01`. The archives can lag live publication; a zero OPEN count is not proof that no tenders are open. Cyprus award exports preserve original publication dates and identify award-event inclusion in dateScope; awards are never counted as open notices.

Cyprus refresh automatically renews buyer seeds from official annual award CSVs before checking the linked public buyer notice lists. Broad national search remains CAPTCHA-restricted, and new buyers without prior relevant awards or description-only matches remain a coverage gap. An explicit --raw-cache-dir may reuse saved buyer pages; original retrieval times remain in the raw request log. Omit this option for fresh public-page requests.


Italy adds dedicated public collectors for TELEDIFE historical/current procedure lists, ASI supplier-portal listings, and MePA current RDO/Altri Bandi catalogues. Supplier market surveys remain planning records; research grant calls are excluded. ANAC rejected normal direct/browser requests during the 5 October audit, and INAF historical search displayed a CAPTCHA. Those access gaps are retained in the country audit.


Sweden now searches Kommers public tender, prior-information and award notices with historical search enabled, including both older and eForms detail formats. Mercell uses its anonymous public search and checks the contracting authority country; subscription-only historical filters are not accessed. The Swedish space-agency site search is paginated and records its screening audit. Generic building names, ordinary Swedish words and agency-department names are not sufficient evidence for confirmed space tenders.

The Netherlands adds the official public TNS JSON search (NL-public), which can search beyond the recent RSS window without XML-API credentials. Its notice summaries are stored separately from annual OCDS lot records, so cross-source duplicates are possible. NLSA structured IIC procurement calls use their explicit closing dates for historical scope, rather than website migration dates. Funding guidance, grants, and ordinary news are not treated as open tenders.

Dutch public searches also include verified space-equipment CPV categories and SRON/ASTRON institution names. Broad English search matches are screened before detail retrieval. A Netherlands run can explicitly reuse a raw response folder with --raw-cache-dir=PATH; omit it for fresh queries. Original retrieval timestamps remain in the raw request log. --nl-search-terms accepts a pipe-separated subset for a targeted audit; omit it for the full keyword, institute and CPV pass.

Spain adds national public-form searches by space CPV and space-agency buyer, a public document-metadata search, the current monthly PLACSP archive, and the official Catalonia PSCP dataset. National forms reconcile their pagination totals; document queries split capped date ranges, deduplicate tender links, and retrieve details with a shared request delay. Catalonia preserves lot/winner identities and distinguishes aggregated historical awards from calls for bids. Supplier registration, mixed sports lots and non-space uses of satellite terminology remain review candidates. Regional coverage outside Catalonia and document-only terminology remain gaps.

For the expanded Spain pass:

```powershell
node refresh-eu27-national-space-procurements.cjs --sources=ES-public,ES-documents,ES-monthly,ES-space,ES-Catalonia,ES-agencies --from=2020-01-01 --max-pages=6000 --timeout-ms=120000 --concurrency=1 --delay-ms=1500
```

A deliberate same-pass continuation may use `--es-document-discovery-dir=PATH` for a raw folder containing completed document-search audits and candidate links, plus `--raw-cache-dir=PATH` for already captured Spanish tender details. The collector records reused evidence and original timestamps in its raw audit. Omit both options for a fresh collection. Search recovery preserves completed queries; incomplete searches are repeated. A date-range cap that cannot be split further remains an explicit coverage gap. Large historical searches can take hours.

ES-agencies supplements the broader historical searches with currently published buyer-name searches for AEE, INTA, IAC, IEEC and CDTI. Ordinary institute purchases remain review candidates unless the contract itself has substantive space evidence. A published portal state alone does not establish an unexpired deadline.

### Germany repair and refresh

Germany uses four complementary collectors: `DE-portal` for monthly eForms archives, `DE-live` for anonymous current keyword searches, `DE-cpv` for eight space/astronomy category prefixes, and `DE-space` for DLR RSS listings plus public notice PDFs. Run the live and DLR sources with `--max-pages=2500`; use `--archives` for the monthly source. Start dates earlier than December 2022 cannot establish complete historical coverage: the official bulk archive begins then, although it includes some older migrated notices. Live searches reconcile every returned page against each query's reported total. Cross-source and lot-level duplicates are retained transparently.

The German parser retains participation-request deadlines and treats prior notices explicitly calling for competition as tenders. German telescope terms are included; ancillary websites and ordinary institute building works remain review candidates.

For PDFs rejected by the primary reader, optionally install Python with `pypdf` and set `PDF_PYTHON` to that Python executable before refreshing. This fallback reads downloaded public PDFs only. Without it, failed PDFs remain documented coverage gaps and the original RSS record is preserved. Restricted tender packages are not downloaded.

For a routine German refresh after the historical backfill, run the monthly archive separately from the current searches. Keep the current-search start date at 2020 so notices published in earlier months can still be refreshed while bidding remains open. Replace the example month/date with the refresh date:

```powershell
node refresh-eu27-national-space-procurements.cjs --sources=DE-portal --archives --from=2026-10-01 --to=2026-10-05 --max-pages=10 --concurrency=1 --output=work/de-month
node refresh-eu27-national-space-procurements.cjs --sources=DE-live,DE-cpv,DE-space --from=2020-01-01 --to=2026-10-05 --max-pages=2500 --concurrency=1 --output=work/de-current
```

Use new output directories for fresh runs. `--de-search-terms=term1|term2` is available for a targeted investigation; omit it for the full 41-term live sweep. German compound words are included explicitly because the public search does not necessarily treat a shorter word as a prefix. The eight CPV-prefix searches use the portal's category field, independently of keyword matches.

### Ireland repair and refresh

Ireland uses `IE-portal` (48 live title/description searches), `IE-cpv` (space and astronomy category searches), `IE-space` (Enterprise Ireland and DIAS buyer searches), and `IE-archive` (the Office of Government Procurement quarterly public CSV). The archive is attributed to the Office of Government Procurement, licensed CC BY 4.0, and published through https://data.gov.ie/dataset/contract-notices-published-on-etenders. The inspected snapshot extends through June 2026; its original Windows-1252 text is decoded before UTF-8 JSONL export. Each refresh discovers the current resource through official dataset metadata.

Records qualify for historical inclusion through publication, award or cancellation events from 2020. Separate award winners are retained. Old platform summary records survive in the CSV, but legacy attachments unavailable since the old website closed cannot be recovered from this dataset. Quarterly snapshot deadlines alone never establish a currently open opportunity. Live notices retain Irish local publication dates and deadline time zones; consultations and dynamic purchasing systems are distinguished from ordinary tenders.

Run a fresh collection into a new work directory:

```powershell
node refresh-eu27-national-space-procurements.cjs --sources=IE-portal,IE-cpv,IE-space,IE-archive --from=2020-01-01 --max-pages=2500 --concurrency=1 --delay-ms=1500 --output=work/ie-refresh
```

Per-source query reconciliation is saved with raw evidence. For a targeted repair, `--ie-query-file=PATH` accepts a JSON array of objects with `field` (title, description, contractAuthority or cpv) and `term`; omit it for the full standard search. A blocked or unavailable category remains an explicit gap rather than a zero-result assertion.

### Poland repair and refresh

Poland now combines national BZP title/lot searches (`PL-portal`), current full-text BZP/TED mirror searches and historical space-category searches (`PL-public`), the official legacy-law notice mirror (`PL-legacy`), all four POLSA procurement tabs (`PL-space`), and the public CBK PAN procurement tabs (`PL-CBK`). POLSA's accessible profile contains notices from 2020. The legacy-law mirror inspected during this pass contains notices published from 2021 and returned no results for a 2020-only date range; it is not evidence of complete 2020 national coverage. The original legacy search presented an access challenge.

Current full-text discovery searches deadline-bearing notices irrespective of publication year, from the supported 2021 start of the modern platform. Historical title and space-category searches complement that discovery. Public query totals and pagination are reconciled and saved alongside raw evidence. Search errors remain explicit, and an unsuccessful query does not discard successfully collected records. POLSA routine office and infrastructure purchases remain for review unless the actual procurement establishes a space use. Market consultations are separated from bidding opportunities; superseded notices and expired-list entries do not become OPEN from stale deadlines.

```powershell
node refresh-eu27-national-space-procurements.cjs --sources=PL-portal,PL-public,PL-legacy,PL-space,PL-CBK --from=2020-01-01 --max-pages=4000 --concurrency=1 --delay-ms=2600 --output=work/pl-refresh
```

Use a new work directory for each fresh run. A targeted recovery can provide `--pl-query-file=PATH`: national BZP searches use objects with `term` and `type`; Board searches use `field`, `term` and `ongoing`. The standard query set runs when this option is omitted. `--raw-cache-dir=PATH` is supported by the national BZP title collector for explicit reuse of raw pages collected in the same repair pass, with original evidence retained. Broad national completeness, unindexed buyer portals and restricted attachments remain outside the verified coverage claim.

The Polish TED mirror's official procedure identifier is used to group successive notice versions, so a later deadline replaces the earlier version in MASTER/OPEN while both remain in HISTORY. Legal boilerplate about international space programmes does not establish space relevance. Incidental vehicle GPS, hotel satellite TV, grounds maintenance at a space institute and space-themed playground equipment remain review candidates. The inspected CBK profile starts in May 2024; earlier CBK coverage relies on the other collected sources and is not claimed complete.

### Lithuania repair and refresh

Lithuania uses the current CVP IS platform (introduced in December 2024), the older CVPP archive, Innovation Agency/FTMC buyer searches, and the Innovation Agency pre-commercial procurement index. The national collector searches both titles and descriptions in Lithuanian and English, plus specific space/navigation/astronomy procurement categories. Current searches reconcile the visible result totals; legacy searches exhaust their published pagination. Both archive title/description searches and the available category searches include records from 2020. The legacy portal warns that category searches do not cover international notices fully, so keyword searches remain necessary.

```powershell
node refresh-eu27-national-space-procurements.cjs --sources=LT-portal,LT-cpv,LT-space,LT-legacy,LT-agency --from=2020-01-01 --max-pages=4000 --concurrency=1 --delay-ms=1500 --output=work/lt-refresh
```

Use a new output directory for each refresh. Optional `--lt-query-file=PATH` accepts `{field,term}` objects: current-platform fields are `title`, `description`, `contractAuthority`, or `cpv`; legacy fields are `1` (title), `2` (description), `3` (buyer), or `cpv`. Without this option the full standard search runs.

The current portal's days/hours countdown is excluded from deadline parsing; the explicitly dated closing time takes priority. Closed, awarded and cancelled workspaces and market consultations cannot become open tender opportunities from an old future date. Publication days retain the Lithuanian calendar date. Historical procedure summaries with future deadlines are retained outside OPEN unless the current bidding stage is verified. Steam-tracing pipes and telescopic handlers are not space procurements. The agency's pre-commercial listing is checked separately, including its current DOCX/PDF specifications, and its displayed status does not override an expired deadline. Restricted attachments and unpublished or unindexed procurements remain coverage limits.

Lithuanian current-platform keyword, category and buyer results share the same procedure identity in MASTER/OPEN, so the same procurement appears once. HISTORY preserves the source records that support it.

Current Lithuanian open candidates additionally inspect the portal's anonymous public document packages and extract named PDF/DOCX technical specifications. This can identify GNSS equipment absent from short notice summaries. Missing packages, unsupported specification formats and download failures remain explicit gaps. Original ZIP/Office/PDF bytes are retained as raw evidence.

### Denmark repair and refresh

Denmark uses public Udbud search and full notice details, the official March 2022–November 2024 below-threshold archive, DTU/DMI/Klimadatastyrelsen buyer searches, DTU Space Swarm DISC, and an audit of UFSN space-support calls. English and Danish keywords, specific space/navigation/astronomy categories, and buyer searches are fully paginated and reconciled with published totals. Current retrieved national search notices begin in 2023; this does not establish coverage of national 2020–2022 procurement. Swarm includes tenders with activity from 2020.

```powershell
node refresh-eu27-national-space-procurements.cjs --sources=DK-portal,DK-cpv,DK-buyers,DK-archive,DK-DTU,DK-space --from=2020-01-01 --max-pages=3000 --concurrency=1 --delay-ms=1200 --output=work/dk-refresh
```

Use a fresh output directory. Optional `--dk-query-file=PATH` accepts objects with `field` (text, cpv or buyer) and `term`. National keyword, category and buyer records share official procedure identifiers for MASTER/OPEN; HISTORY retains the source notices. Detailed notices retain document links and buyer-country evidence. Foreign and EU-institution buyers are excluded from Danish national coverage and retained in an exclusion audit. Future tender deadlines trigger public amendment-relation checks.

Swarm calls for ideas are planning, and UFSN national funding/endorsement calls and ESA referrals are audited outside OPEN. Missing historical publication dates remain unknown; a known historical closing date can establish activity within the requested period. Natural-language calendar dates do not shift with the computer timezone. Aircraft-service satellite context, coastal missile terminology and incidental GPS timing remain review candidates. Unindexed historical notices, restricted attachments and procurement outside the inspected public sources remain gaps.

Buyer identifiers are verified against [DTU supplier information](https://www.space.dtu.dk/english/about-us/for-suppliers), [DMI contact information](https://www.dmi.dk/kontakt/), and [Klimadatastyrelsen](https://www.klimadatastyrelsen.dk/om-klimadatastyrelsen).

### Belgium repair and refresh

Belgium uses the federal public e-Procurement search, including indexed migrated notices from 2020, published workspace versions and their notice XML. Searches cover English, French, Dutch and German terminology, specific space/navigation/astronomy procurement categories, and BELSPO, BIRA-IASB, the Royal Observatory, RMI, VITO, the National Geographic Institute and Urania buyer identifiers, plus a targeted Centre Spatial de Liège phrase. Multi-word terms are quoted to reduce unrelated full-text matches. Each query reconciles the published total against all fetched pages.

```powershell
node refresh-eu27-national-space-procurements.cjs --sources=BE-portal,BE-cpv,BE-buyers,BE-space --from=2020-01-01 --max-pages=4000 --concurrency=1 --delay-ms=1200 --output=work/be-refresh
```

Use a fresh output directory. Optional `--be-query-file=PATH` accepts objects with `field` (text, cpv or buyer) and `term`. The anonymous public session renews if its token expires. No supplier login is required for the collected endpoints. Published versions retain their own identifiers and historical deadlines; the newest version uses the current submission deadline. Official dossier IDs group keyword, category and buyer results in MASTER/OPEN. Future-deadline notices and selected buyer workspaces also check public procurement history for subsequent notices.

XML adds CPV codes, contract values and tender-document links. Foreign/international authorities identified by the notice are excluded from Belgian national coverage with an audit. An institute name by itself does not establish a space contract. BELSPO research funding, jobs and ESA referrals are audited outside national tender records. [VITO supplier information](https://vito.be/en/contact) directs bidders to the same federal platform. Unindexed legacy notices, restricted attachments and unpublished low-value purchases remain gaps.


### Bulgaria repair and refresh

Bulgaria combines CAIS EOP multilingual keyword and CPV searches with the SRTI and astronomy institute buyer profiles, public published-notice details and the pre-migration AOP register export. Explicit cancellations and suspensions override future deadlines; market consultations are planning records. All search result totals are reconciled. The legacy XLS export is read using the pinned SheetJS dependency distributed by its official CDN, while final workbooks remain generated by ExcelJS.

```text
node refresh-eu27-national-space-procurements.cjs --sources=BG-open,BG-portal,BG-cpv,BG-buyers,BG-legacy,BG-space --from=2020-01-01 --max-pages=5000 --concurrency=1 --delay-ms=1200 --output=work/bg-refresh
```

The SRTI site uses its working HTTP address. Legacy record lookup currently reports a database error, and its abbreviated listings remain review candidates. Public institute pages and the final coverage notes document the remaining gaps.

Bulgarian open review candidates also receive public PDF/DOC/DOCX technical-document checks (up to 20 selected files, 30 MB each). A generic GNSS regulation citation alone does not promote a candidate to OPEN. Parsed text and document-level errors remain in raw audit files. The legacy XLS reader and Word document reader are included in package.json/package-lock.json.


### Croatia repair and refresh

Croatia combines current EOJN procedures and all their published notice versions with the official monthly legacy XML archives and Ministry of Science, Education and Youth procurement pages and procurement plans. Searches use Croatian and English terms, exact space/navigation/astronomy categories, and six relevant ministry, geodesy, meteorology and research buyers. Every result page is checked against the published total. The open-procedure sweep additionally reads notice bodies for future-dated technical categories whose titles do not establish space relevance.

```text
node refresh-eu27-national-space-procurements.cjs --sources=HR-open,HR-portal,HR-cpv,HR-buyers,HR-archive,HR-space --from=2020-01-01 --max-pages=5000 --concurrency=1 --delay-ms=3500 --timeout-ms=90000 --output=work/hr-refresh
```

Use a fresh output directory. Optional `--hr-query-file=PATH` accepts objects with `field` (text, cpv, buyer, status or id), `term`, and optional `force` to read an individual procedure's published notices. The public session starts at the home page before opening procedure search and is reused for detail and published-notice downloads. Transient session startup failures are retried; no supplier login is required for these public records.

Historical notices retain their own identifiers, dates and deadlines. The latest version receives the public register's current status and deadline. Cancellation, suspension, closure and invitation-only participation cannot be classified as an open tender; an amended notice is open only with a verified current published stage and a future deadline. Current search sources share procedure identities in MASTER/OPEN; HISTORY retains notice versions and source observations. Legacy procedure identifiers have a separate namespace.

Legacy monthly ZIPs are read without executing their contents; nested daily ZIP/XML record counts are audited. Historical currencies remain unknown when the official XML does not specify them. Ministry procurement-plan versions remain planning records outside OPEN. Space-event catering and promotional supplies require review. Restricted technical attachments, unpublished purchases, unindexed procedures and months not yet published in the legacy archive remain documented coverage gaps.


### Latvia repair and refresh

Latvia combines EIS public keyword and buyer searches, the announced-procedure register, IUB daily JSON and legacy compressed XML archives from 2020, and ministry/university procurement listings. Current EIS detail links use the stable ProcurementIdentifier; ProcurementId identifies a notice version and must not be substituted into the detail URL. Search results with generic titles still receive detail checks when returned by a space keyword. Announced procedures with future-dated deadlines also receive detail checks on fresh runs. Radio astronomy, GNSS, Latvian remote-sensing terminology and geospatial applications are covered.

```text
node refresh-eu27-national-space-procurements.cjs --sources=LV-portal,LV-open,LV-buyers,LV-iub,LV-space --from=2020-01-01 --max-pages=5000 --concurrency=1 --delay-ms=1800 --timeout-ms=90000 --output=work/lv-refresh
```

Use a fresh output directory. Optional --lv-query-file=PATH accepts text, buyer, status or targeted id query objects; apply it to one intended source only. The official archive's directory listings drive downloads; listed days and parsing failures are audited. The JSON feed replaced XML in stages, so both formats are retained. Substantive notice and lot data are normalized; independent JSON lots retain their own identities and deadlines. Missing currencies are not inferred, and whole-notice totals are not multiplied across lots. Planned-contract forms used for below-threshold competitions remain tenders; prior information, consultations and qualification notices remain outside OPEN. Surgical satellite lamps, ancillary satellite events and telescopic loaders are not confirmed space procurements.

Ministry and university records supplement EIS/IUB. ESA/EUSPA and funding referrals on the space-office site are audited without being relabelled as Latvian national tenders. Restricted documents and missing original table subjects remain explicit gaps. See the country coverage notes for actual reconciliation results and current access limitations.

Legacy IUB notice types and numeric currency codes follow the official XML dictionary. Contract-award and contract-period modification notices stay outside OPEN. Price-band thresholds are not reported as estimated contract values.

### Czechia repair and country-only refresh

Czechia combines fully paginated public NEN searches, Ministry of Transport and CENIA buyer profiles, ASU/CzechGlobe/CENIA research profiles, the Institute of Atmospheric Physics public listing, and official ISVZ RVZ/VVZ machine-readable archives from 2020. JSON ZIPs are streamed rather than loaded as one large string. Annual/monthly exports and the different standard/defence CSV schemas are handled separately. Lot identities, submission deadlines, source status and currencies are preserved; inactive deadlines, clarification deadlines, qualification systems and dynamic purchasing-system admission do not become open tenders.

```text
node refresh-czechia.cjs --from=2020-01-01 --max-pages=10000 --concurrency=1 --delay-ms=1200 --timeout-ms=90000 --output=data/czechia-refresh
```

Use a fresh working output directory for each refresh. The command writes the final Czech workbook and five UTF-8 JSONL files under `final-output/Czechia`, without collecting another country. Other-country and combined snapshots have their own export dates and per-record retrieval timestamps. The workbook sheets and JSONL sets are MASTER, OPEN, HISTORY, REVIEW and COVERAGE. HISTORY retains source notice versions; MASTER consolidates within a source. Cross-source copies remain attributable to their original publishers and must not be counted as distinct opportunities automatically.

`czech-release.cjs` reconciles future-dated archive records against current public notices. Unmatched archive opportunities and listing-only records stay outside confirmed OPEN. Missing publication dates remain blank, with REVIEW flags. A year encoded in an older UFA identifier is used only to select the historical collection scope, never fabricated into a publication date. Old UFA routes that return the portal homepage are detected as unavailable details.

Optional `--cz-query-file=PATH` accepts `{name, url}` listing queries or `{name, url, detail:true}` targeted public-detail checks. Apply it to one intended NEN source at a time. `--raw-cache-dir=PATH` on the archive collector reuses a manifest of previously downloaded official files; audit provenance records the original download date. Fresh default runs download the archives again. No NIPEZ frontend API or supplier login is required.

The national export has a publication lag; inaccessible Tender Arena profiles, restricted attachments, unpublished purchases and tenders lacking searchable space terminology remain explicit limitations. See `final-output/Czechia/CZECHIA_COVERAGE_NOTES.md` and the dated audit files for the actual collection results, current access failures and latest archive period.

Czech NEN subject-description searches use both accented and folded variants. Public search can still omit a known phrase found in a direct notice; archive supplementation and direct deadline verification therefore remain necessary. Restricted procedures use the participation deadline for public entry, with later tender deadlines retained in the description. Invitation-only procedures remain outside OPEN.


## Slovakia refresh

Run `node refresh-slovakia.cjs --from=2020-01-01` from this folder. This entry point refreshes Slovakia only and writes dated Excel plus MASTER, OPEN, HISTORY, REVIEW and COVERAGE UTF-8 JSONL files under `final-output/Slovakia`. It also writes a release audit. It does not commit or push.

Sources include EVO, UVO national procedure searches and linked notice histories, SARIO and research-institution profiles, the Astronomical Institute purchase register, and official UVO JSON/XML bulletins from the national open-data catalogue. Archive-discovered future deadlines are checked against live procedure pages; unconfirmed archive deadlines remain in REVIEW. Broad or incidental space references are reviewed separately from confirmed space opportunities.

Raw evidence and resumable checkpoints are stored under `data/slovakia`; downloaded bulletins are cached under `data/slovakia-bulletins` (the initial 2020–2026 collection is approximately 13 GB). Existing bulletin checksums and original retrieval dates are retained. Use `--sk-archive-dir=PATH` to reuse a different bulletin cache. Use `--output=PATH` for a separate collection checkpoint. Use `--resume` only with the same collection options. The dated coverage file records incomplete searches, unavailable archives and other source limits; these outputs do not establish exhaustive coverage of unpublished or document-only procurements.

The Slovakia refresh uses `--sk-current-only` for national-register checks: it fetches the latest dated notice and retains older notice headers for audit. Historical backfill comes from the complete available JSON/XML bulletin collection and HTML recovery of defective distributions. Direct `collect.cjs` runs without this flag still fetch linked notice histories.


## France full refresh

Use `node refresh-france.cjs` for the expanded BOAMP history, current PLACE/CNES tenders and public CNES R&D contract challenges. See [FRANCE-REFRESH.md](FRANCE-REFRESH.md) for resume options, output views and documented coverage limits. The generic adapter alone does not reproduce this expanded pass.
