# Greece procurement refresh

Run in this National-Portals folder with Node.js 22 or later and the existing package dependencies installed.

```powershell
node .\refresh-greece.cjs
```

This creates a fresh timestamped collection folder and writes validated results to `final-output\Greece`. It searches from 2020 through the collection date. It does not push to GitHub.

To resume the completed/incomplete 14 October 2026 collection using its verified checkpoints:

```powershell
node .\refresh-greece.cjs --resume=".\data\Greece\2026-10-14" --as-of=2026-10-14
```

For a new live refresh, use the first command without `--resume`. A resumed run intentionally reuses its saved responses; it is not a new live snapshot.

## Files

- `GR_NATIONAL_SPACE_YYYY-MM-DD.xlsx`: MASTER, OPEN, HISTORY, REVIEW and COVERAGE sheets.
- Matching UTF-8 JSONL files: the same normalized substantive fields and records.
- `GITHUB-READABLE-MANIFEST.json` and indexed MASTER/HISTORY parts: lossless, smaller text files for connector retrieval.
- `GREECE_SOURCE_AUDIT.json`: query counts, exclusions, agency coverage and document checks.
- `validation.json`: workbook readback and record/field checks.

The country runner uses `greece-collect.cjs`, `greece-extra.cjs`, `greece-reconcile.cjs`, `greece-parse.cjs`, `greece-files.cjs`, `greece-github.cjs` and existing shared `core.cjs`, `native-portals.cjs`, `romania-large-export.cjs` and their dependencies. Keep the National-Portals package together when migrating the scraper.

## Coverage and interpretation

The official KIMDIS API supplies title searches, space-related procurement categories, Hellenic Space Center and three research/aerospace buyer searches, and all indexed future-deadline notices published since 2020. Searches use short date windows, check pagination, and subdivide inconsistent category results. Greek and English HSC announcement archives are also collected.

OPEN contains confirmed space scope and a future deadline, excluding direct-award invitations. Relevant ongoing candidates receive linked-act and PDF checks. REVIEW preserves ambiguous geospatial/radar scope and agency announcements with unverified dates. Historical and raw evidence is retained, including excluded candidates in the audit.

Coverage remains partial: restricted/unpublished procurement, historical description-only matches outside the selected categories/buyers, standalone sources outside KIMDIS, and unsearched attachment-only scope may remain missing. Agency website migration dates do not establish a tender's original date. No claim of universal national coverage is made.

Country refresh does not automatically rewrite the combined EU27 workbook. The combined snapshot was reconciled separately for this delivery so other countries retain their existing results.
