# EU Funding & Tenders collector — Phase 1 item 1

JavaScript collector for Windows and Node.js 22 or newer. It reads the European Commission's public SEDIA search index. CORDIS and awards collection are **not** implemented in this item.

## Install and run in PowerShell

Download `eu-funding-tenders-collector.zip` to your Downloads folder. These commands install the package inside the source-specific EU-Funding-Tenders-Portal directory; they do not require administrator PowerShell. If you already have Node 22+, skip the first command. Restart PowerShell after installing Node.

```powershell
winget install --id OpenJS.NodeJS.LTS --exact --source winget
```

In a new PowerShell window:

```powershell
node --version
npm.cmd --version
$FundingRoot = 'C:\Users\angel\OneDrive\Desktop\knowledge\eu-space-rag\04_FUNDING\EU\EU-Funding-Tenders-Portal'
$FundingZip = Join-Path $env:USERPROFILE 'Downloads\eu-funding-tenders-collector.zip'
New-Item -ItemType Directory -Force -Path $FundingRoot | Out-Null
Expand-Archive -LiteralPath $FundingZip -DestinationPath $FundingRoot
Set-Location -LiteralPath $FundingRoot
npm.cmd ci --ignore-scripts --no-audit --no-fund
npm.cmd test
node .\scrapers\scrape-eu-funding-tenders.js --mode current
```

If the files have already been installed in this location, start at `Set-Location` and skip extraction. Extraction deliberately omits `-Force` to avoid overwriting an existing installation. If `winget` is unavailable, install Node LTS from https://nodejs.org/en/download and reopen PowerShell. `npm.cmd` avoids PowerShell's script execution-policy block; no policy change is needed. Excel itself is not required.

Initial full collection, including available calls opened **or with a deadline** in 2020 through the current UTC year:

```powershell
Set-Location -LiteralPath 'C:\Users\angel\OneDrive\Desktop\knowledge\eu-space-rag\04_FUNDING\EU\EU-Funding-Tenders-Portal'
node .\scrapers\scrape-eu-funding-tenders.js --mode all --since 2020
$LASTEXITCODE
```

Historical backfill separately:

```powershell
node .\scrapers\scrape-eu-funding-tenders.js --mode history --since 2020
```

Bounded smoke test (intentionally partial, exit code 2):

```powershell
node .\scrapers\scrape-eu-funding-tenders.js --mode current --max-pages 2 --out .\smoke-test
node .\scrapers\scrape-eu-funding-tenders.js --mode current --out .\smoke-test --resume
```

Resume an interrupted full run with the **same** mode, dates, page size and output location:

```powershell
node .\scrapers\scrape-eu-funding-tenders.js --mode all --since 2020 --resume
```

Run without `--resume` for a fresh reconciliation. A completed checkpoint does not restart on resume. A partial result caused by source warnings or conflicting versions requires a fresh run once traversal has ended. Resume across a UTC year boundary requires the original `--until YEAR` value. Never run two collector processes in the same output root.

Open the latest attempt's workbook and inspect its status:

```powershell
$FundingRoot = (Get-Location).Path
$FundingPointer = Get-Content -Raw -LiteralPath (Join-Path $FundingRoot 'generated\latest-attempt.json') | ConvertFrom-Json
$FundingSnapshot = Join-Path $FundingRoot $FundingPointer.path
Get-Content -Raw -LiteralPath (Join-Path $FundingSnapshot 'manifest.json')
Invoke-Item -LiteralPath (Join-Path $FundingSnapshot 'funding-master.xlsx')
```

## Arguments

| Argument | Default | Meaning |
|---|---|---|
| `--mode` | `all` | `current`, `history`, or `all` |
| `--since` | `2020` | First historical year, inclusive; cannot precede 2020 |
| `--until` | current UTC year | Last historical year, inclusive |
| `--page-size` | `100` | 1–100 records per API request |
| `--max-pages` | `0` | Maximum committed pages this invocation; 0 means unlimited |
| `--resume` | absent | Continue the selected mode's checkpoint |
| `--out` | package root | Alternative output root; also `FUNDING_OUTPUT_DIR` |

No account token or secret is required. `SEDIA` is the public index key used by the Portal.

## Source contract and verification

Official sources:

- Portal: https://ec.europa.eu/info/funding-tenders/opportunities/portal/
- API: https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA
- Frontend inspected on 13 October 2026: https://ec.europa.eu/info/funding-tenders/opportunities/portal/main-4O2KEHOO.js
- Portal purpose: https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/about

The frontend confirms POST multipart parts `query`, `sort`, and `languages`, each with `Content-Type: application/json`; pagination is in URL parameters `pageNumber` (1 based) and `pageSize`. The collector uses `text=***`, English language, and source types `1`, `2`, `8`, as used by the funding frontend. It does not collect the procurement-only type `0`. `sort` is `identifier ASC`. Source status codes: `31094501` forthcoming, `31094502` open, `31094503` closed.

Date ranges use epoch milliseconds with inclusive `gte`/`lte`. The API rejected Elasticsearch's `lt`/`minimum_should_match` combination in live testing; this implementation uses the supported frontend syntax. This is an observed Portal integration contract, **not a promised stable, separately documented public API**. Schema and pagination drift cause an explicit failure.

The search response already exposes descriptions, source actions, deadlines, conditions, links and budgets where indexed. Topic detail URLs returned for an old topic and an initially guessed topic returned HTTP 404 during validation. The collector therefore preserves indexed conditions and document links, makes no claim to have downloaded topic documents, and marks eligibility as unverified. Generated application links are Portal topic links; further-information links remain separate. Records without a topic identifier need review of their source/further-information links.

See `VALIDATION.md` for exact checks and limits, and `evidence/` for source responses and manifests. API success alone is not a coverage claim.

## Scope, classification and statuses

Current mode searches open/forthcoming source statuses across all programmes, without a publication-year restriction. History uses monthly shards, matching **opening date OR any indexed deadline** in selected years, then a separate missing-date shard. An older call whose deadline falls in 2020 qualifies. Calls with both indexed dates before 2020 do not. Undated records are retained for review and are not represented as confirmed post-2020 calls. Monthly shards exceeding 9,000 hits are divided into smaller intervals; unsplittable or oversized current/undated queries fail explicitly. These limits protect against a possible API result window.

All traversed funding records are kept. Rule-based space matches cover upstream, downstream, space science, commercialization, dual-use and enabling technology with explicit space evidence. Generic AI, agriculture, climate, EIC and enabling technologies remain potential candidates for manual review rather than being asserted to be space funding. Exclusions remain in the master and excluded JSONL. This is candidate classification, not an eligibility decision. Read `classification.evidence`, the source description and conditions.

Opportunity status is distinct from run status. Unknown status codes, mixed statuses, stale open deadlines, overdue forthcoming dates and open records lacking deadlines become `uncertain`. Explicit cancellation in source action status becomes `cancelled`; a missed record is never inferred to be cancelled. All deadlines and action objects are retained. `nextDeadline` is only the earliest future indexed deadline, not a guarantee that the first stage remains available. Loans/equity and awards are not inferred; unknown funding mechanisms stay `funding_unspecified`. Source budget strings are not converted into award amounts or assumed to be per-project grants.

Run statuses:

| Status | Meaning |
|---|---|
| `complete` | Requested index traversal exhausted with no detected coverage warnings; not absolute EU completeness |
| `partial` | Bounded/interrupted traversal, source warnings, changing totals, or differing versions of the same source reference |
| `failed` | Failure with no usable records |
| `unexpectedly_empty` | No observed records; never silently accepted as complete |

Exit codes: 0 complete, 2 partial/unexpectedly empty, 1 failed or fatal export/setup error. A completed-checkpoint no-op exits 0 but prints a no-op message and does not claim a new collection.

## Files and data integrity

```text
EU/EU-Funding-Tenders-Portal/
  package.json, package-lock.json, README.md, VALIDATION.md
  scrapers/scrape-eu-funding-tenders.js
  tests/collector.test.js
  evidence/                        validation evidence, not a production dataset
  raw/<run-id>/*.json               original API page responses
  checkpoints/<mode>.json           query signature, next page, evidence hashes
  logs/<run-id>.json                coverage/status report
  generated/latest-attempt.json     latest result, including partial
  generated/latest-complete.json    only updated after a complete traversal/export
  generated/snapshots/<run-id>/
    funding-master.xlsx
    funding-master.jsonl
    funding-open.jsonl
    funding-forthcoming.jsonl
    funding-historical.jsonl
    funding-manual-review.jsonl
    funding-space-relevant.jsonl
    funding-excluded.jsonl
    funding-<view>.part-0001.jsonl, ...
    manifest.json
```

JSONL is authoritative. Excel contains a readable projection with frozen/filterable headers; exceptionally long text is visibly clipped at Excel's cell limit and the manifest counts clipped cells. XML-invalid characters are removed only from the Excel projection and counted in `excelSanitizedCells`. The original/full content stays in JSONL and raw evidence. Workbook sheets are master, open, forthcoming, historical and manual-review. The master includes excluded records for audit. Open/forthcoming/historical views require confirmed space evidence and the corresponding status; review is separate.

Part files target 128 KiB without splitting/truncating records. One record larger than that limit occupies its own oversized part. A view with zero records has an empty aggregate JSONL and no parts. Use the manifest's view, count, filename, byte length and SHA-256 when indexing on GitHub. The manifest is generated from the same canonical records as Excel. Nothing is pushed to GitHub automatically.

Canonical keys prefer topic identifier, falling back to source type/reference. Duplicate action/index variants are merged with populated source fields retained; original variants remain in raw pages. Evidence pointers list contributing pages. Overlapping date shards are deduplicated. This key can support later source reconciliation, but cross-portal fuzzy matching is not yet implemented. Previous **complete** snapshots are merged forward; unseen records are retained as uncertain with their previous status and original last-check time. Partial datasets never replace `latest-complete.json`. Live index pagination can shift during a run; totals, repeat pages, warnings and version changes are checked, but a stable total cannot prove zero omissions. Periodic fresh reconciliation is necessary.

Each committed page is written before checkpoint advancement. Resume verifies raw checksums before exporting. Snapshot output is committed through a small pointer after JSONL, Excel and manifest succeed. An interrupted export can be reconstructed by resuming from raw pages. Existing snapshots are retained. Do not delete raw/checkpoint files needed by unfinished runs.

## Troubleshooting

- **Lock left after Ctrl+C or crash:** read `checkpoints\collector.lock`, check its PID with `Get-Process -Id PID -ErrorAction SilentlyContinue`, and remove only that lock after confirming the process is gone. Then resume. A new process can reuse a PID; inspect the process name/start time. Do not remove the lock while another collector is running.
- **Network, 429 or server errors:** five bounded attempts, 60-second per-request timeout, exponential backoff/Retry-After. Permanent 4xx/schema errors stop immediately. Review manifest error and resume after the cause is resolved.
- **Excel open/OneDrive sync:** close the workbook and allow sync to settle. Exports use versioned folders; Windows rename errors remain visible instead of falling back to unsafe publication.
- **No latest-complete pointer:** inspect latest-attempt; coverage checks did not authorize a complete snapshot.
- **Large Excel/memory usage:** JSONL is authoritative, but the export loads canonical records into memory. Use a 64-bit Node installation; retain sufficient disk space for raw and versioned snapshots. No automatic retention cleanup occurs.
- **API changes:** check the saved response and official frontend; update the adapter and rerun tests. Never mark a failed API traversal successful manually.

Scope stops here. CORDIS requires the next item and permission.

