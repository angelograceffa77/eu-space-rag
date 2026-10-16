# Slovenia national procurement refresh

The collector searches the official eNarocanje public API. It preserves raw responses, resumable checkpoints, related notices and source limitations. It collects history from 2020 onward, checks all notices returned by the current-deadline filter, and adds CPV and lot-title searches. It also reviews a bounded set of official Space Office and procurement pages.

Run from this National-Portals folder in PowerShell:

```powershell
node .\refresh-slovenia.cjs
```

Each fresh run gets a new timestamped evidence directory. To resume this verified snapshot:

```powershell
node .\refresh-slovenia.cjs --as-of=2026-10-14 --resume=".\data\Slovenia\2026-10-14"
```

Resume reuses saved responses: it is not a new live refresh. For current information, use the first command and a new run directory. Dates use Slovenia's timezone.

## Outputs

Files are published under `final-output/Slovenia` after Excel and JSONL values have been compared:

- `SI_NATIONAL_SPACE_YYYY-MM-DD.xlsx`
- Matching `_MASTER.jsonl`, `_OPEN.jsonl`, `_HISTORY.jsonl`, `_REVIEW.jsonl`, `_COVERAGE.jsonl`
- `GITHUB-READABLE-MANIFEST.json` and its `github-readable` parts
- `SLOVENIA_SOURCE_AUDIT.json` and `validation.json`

MASTER contains the latest record for each procedure. HISTORY retains notice versions. OPEN is a strict subset with a verified future deadline and confirmed space relevance. REVIEW includes broad or uncertain matches. These views overlap and must not be added together.

Keep the scraper helpers and existing package dependencies with `refresh-slovenia.cjs`: `slovenia-index.cjs`, `slovenia-details.cjs`, `slovenia-parse.cjs`, `slovenia-agency.cjs`, `slovenia-documents.cjs`, `slovenia-github.cjs`, `hungary-files.cjs`, `core.cjs`, `romania-large-export.cjs` and its dependencies. Install dependencies with the repository's existing lockfile. No GitHub push is performed.

## Limits

Coverage remains partial. Migrated legacy notices can lack descriptions in the public API. Historical attachment-only relevance, restricted defence notices and removed/unpublished procurements can remain missing. Current confirmed space tenders have public DOCX archives checked where available; attachments in other formats are preserved or reported as unsupported, not silently declared reviewed. Full legacy and attachment extraction is not claimed.

Year boundaries can overlap in the source date filter. Notices are deduplicated by official ID. Purchasing-system admission, voluntary transparency, post-award changes, corrected notices and medical “satellite centres” are excluded from confirmed open space tenders. Broad geospatial, institutional and incidental GPS matches remain review items.

The full EU27 workbook is a separately consolidated snapshot. Running this country collector does not automatically overwrite the combined workbook or other countries.
