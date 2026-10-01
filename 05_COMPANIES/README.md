# ESA company exports

Start every query with `05_COMPANIES/esa-companies-manifest.json`.
Resolve its `parts`, `indexParts`, `searchParts`, and `workbook` filenames under
`05_COMPANIES/<pathBase>/`. Read that manifest once per query to pin a consistent
snapshot. Never sum the legacy exports and snapshots together.

The manifest reports directory profile/record counts (including business units,
not distinct legal companies), unique/missing/duplicate profile IDs, countries,
SMEs, legal entities, source date, generation time, source file hashes, and each
part's filename, record count, byte size, and SHA-256 checksum.

* `ESA_Companies_*.part-*.jsonl`: complete records, in original order, UTF-8,
  one JSON object per line. Each file is at most 131,072 bytes (128 KiB).
* `companies-index.part-*.jsonl`: compact name/country/ID entries and exact
  full-record part/line pointers, also capped at 128 KiB.
* `companies-search.part-*.txt`: full fields in readable text with short lines,
  capped at 128 KiB. These are discovery aids, not an additional dataset.
* `ESA_Companies_YYYY-MM-DD.xlsx`: retains All Companies, SMEs, Legal Entities,
  columns and formatting. XLSX is for spreadsheet use, not connector queries.
* Manifest: at most 256 KiB, checked before publication.

For exact country counts use `countryCounts`. For exhaustive filters, read every
full-record part listed in the manifest. GitHub search is not exhaustive and
connector indexing/permissions can vary. Small files remove the previous size
obstacle; they do not guarantee indexing. JSONL may still have long lines, so the
short-line text companion improves search eligibility.

GitHub documents size and line restrictions here:
https://docs.github.com/en/search-github/github-code-search/about-github-code-search

## Run (from repository root)

```powershell
node 05_COMPANIES/esa-companies.js
node --test 05_COMPANIES/company-export.test.js
```

To migrate the existing three files without scraping or modifying them:

```powershell
$env:ESA_SOURCE_DATE = '2026-10-01'
node 05_COMPANIES/esa-companies.js --from-jsonl 05_COMPANIES/ESA_Companies_2026-10-01.part-0001.jsonl 05_COMPANIES/ESA_Companies_2026-10-01.part-0002.jsonl 05_COMPANIES/ESA_Companies_2026-10-01.part-0003.jsonl
Remove-Item Env:ESA_SOURCE_DATE
```

`ESA_OUTPUT_DIR` optionally selects an isolated output directory. Offline imports
preserve the JSONL record values exactly and do not consume/delete checkpoints.
Pass all source parts explicitly in order; offline import cannot detect omitted
files. Set `ESA_SOURCE_DATE` to the actual source snapshot date, not the rebuild date.

## Publication and compatibility

All output is built in a private staging folder. JSONL is parsed back and every
part is size/count/checksum validated; XLSX writing must finish successfully.
Then the whole directory is renamed to an immutable `snapshot-*` directory and
the root manifest is replaced with one same-filesystem rename. Consumers using
the root manifest see either the old complete snapshot or the new complete one.
Existing root XLSX/JSONL and prior snapshots are retained unchanged. New outputs
use the same dated XLSX and JSONL naming pattern inside the snapshot directory;
consumers that assume root-level latest files must switch to manifest paths.

Failures leave the previous manifest untouched. A crash after the directory
rename can leave an unreferenced complete snapshot; it is deliberately retained.
This is atomic visibility, not a power-loss durability guarantee. Avoid concurrent
live scrapes sharing a checkpoint. Publish the snapshot and its root manifest in
the **same Git commit** so GitHub readers receive a consistent version. This script
does not commit or push. Do not upload staged output or checkpoints.

Incomplete pages, changing API totals, count mismatches, and missing/duplicate
profile IDs prevent live publication. Resume checkpoints are validated and saved
through a temporary-file rename. A changing directory may require moving the old
checkpoint aside and restarting a fresh scrape; no automatic data deletion occurs.
