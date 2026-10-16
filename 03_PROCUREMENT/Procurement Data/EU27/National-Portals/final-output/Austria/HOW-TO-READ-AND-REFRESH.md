# Austria: collect and read the outputs

Run from the `National-Portals` folder. The Austria entry point is `refresh-austria.cjs`; retain its supporting modules and the repository's package files.

## Refresh

Requirements: Node.js 22 or newer, installed npm dependencies, PowerShell 7 (`pwsh`), Python with `pypdf`. Set `AT_PYTHON_BIN` to your Python executable if the bundled Codex runtime is unavailable.

```powershell
npm ci
$env:AT_PYTHON_BIN = (Get-Command python).Source
node refresh-austria.cjs
```

A new run collects the Austrian USP search API, the original publisher XML feeds advertised by data.gv.at, and FFG/ASAP pages and original call guides. History begins on 1 January 2020. It uses a new dated raw-data directory, so a normal refresh does not reuse an older run's responses.

To resume an interrupted run, supply the exact run directory printed or created by that run and the same date scope:

```powershell
node refresh-austria.cjs --resume="data\Austria\2026-10-14" --as-of=2026-10-14 --to=2026-10-14
```

Resume reuses preserved responses from that run. It is not a new live refresh. Date scopes cannot be changed within an existing run. Source access failures are recorded; unresolved candidates are not treated as confirmed open tenders.

## Outputs

`final-output/Austria/AT_NATIONAL_SPACE_YYYY-MM-DD.xlsx` contains five worksheets matching the UTF-8 JSONL files with the same date:

- `MASTER`: latest record per source notice/procedure key, including candidates requiring review.
- `OPEN`: verified space records with a future procurement submission deadline. These are notice records; different notices can concern the same underlying procurement.
- `HISTORY`: all retained record versions, including awards and closed tenders.
- `REVIEW`: ambiguous scope, incomplete evidence or unknown publication date. This can overlap OPEN where the deadline is verified but publication date is unknown.
- `COVERAGE`: collection method, source errors and remaining gaps.

`GITHUB-READABLE-MANIFEST.json` points to small, lossless MASTER and HISTORY JSONL parts. Read every part for exhaustive questions. The parts reconstruct the canonical JSONL byte for byte. OPEN, REVIEW and HISTORY are views, not extra unique procurements to add together.

`AUSTRIA_SOURCE_AUDIT.json` records reconciled searches, publisher evidence, excluded candidates and unresolved notices. `validation.json` records workbook/JSONL counts and comparisons. Raw source documents and resumable checkpoints stay under `data/Austria`; they are evidence, not additional final tenders.

## Coverage limits

This is a tested best-effort public-source collection, not a guarantee that every Austrian space-related contract is public or indexed. Removed notices, inaccessible publisher documents, unlinked archives and restricted purchases can remain unavailable. Detailed requirements found only in attachments outside the FFG guides are not exhaustively searched. USP keyword matches can include boilerplate; only substantive extracted scope is used to confirm space relevance.

FFG grant calls are excluded. Separately procured R&D service scopes in the original guides are included. FFG call-opening dates are marked as event dates, not asserted to be the page's publication date. Placeholder qualification dates do not establish an open tender. Where lots have different deadlines, the earliest extracted deadline is used conservatively; consult the original notice for individual lots.

This entry point refreshes Austria's folder only. The combined EU27 convenience workbook requires a separate consolidation step; its other-country records retain their own earlier collection dates. Nothing is automatically committed or pushed to GitHub.
