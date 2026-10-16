SPAIN HISTORICAL ARCHIVES — PHASE 5

Run from EU27/National-Portals with the existing Node dependencies installed.

Collect a dataset:
  node history/spain-history.cjs --dataset=hosted --from=2020-01-01 --to=2026-10-15 --output="C:/path/to/a/new/run"

Dataset choices: hosted, aggregated, minor, inhouse, consultation.
Use a different output folder for each dataset. Annual archives are discovered
from the official Spanish Ministry of Finance catalogue; URLs are not guessed.
The inhouse and consultation catalogues start with the 2022 annual archive.
The inhouse 2022 archive also includes records from July 2021.
The date bounds select annual archive years, not an exact day-level snapshot.
An annual archive can contain updates to procurements originally begun earlier.

Resume with precisely the same command and output folder after an interrupted
process has stopped. Never remove .history.lock while its recorded process is
running. Completed years are verified and skipped. Interrupted downloads are
preserved, then restarted: the source does not provide a verified byte-resume
capability. Keep sufficient disk space for source ZIPs and failed attempts.

For every annual partition:
- raw ZIP and HTTP response metadata are retained.
- every XML/Atom member is checked for size and CRC integrity.
- all entries pass a broad prefilter; candidates pass the maintained classifier.
- retained space and review candidates are written as UTF-8 JSONL.
- history-state.json records completion, errors, counts and SHA-256 checksums.
- source files are not modified by the export step.

After all selected dataset runs stop:
  node history/export-spain-history.cjs "C:/path/to/hosted-run" "C:/path/to/aggregated-run" "C:/path/to/minor-run" "C:/path/to/inhouse-run" "C:/path/to/consultation-run"

The export preserves the existing Spain history and adds newly collected
versions in a new immutable .procurement-runs/phase5-spain-export-* directory.
It produces paired Excel and JSONL MASTER, OPEN, HISTORY, REVIEW and COVERAGE
outputs, with automatic cell-value comparison and an input/checksum audit.
Changed derived classifications/statuses are listed in history-reconciliation.json.
Distinct substantive versions are retained. Only repeated identical substantive
versions are deduplicated. Original ZIPs and per-year JSONL remain unchanged.

OPEN means a source-derived candidate with a future deadline, not an independent
live confirmation. General supplier registration, consultations and internal
assignments are not ordinary open tenders. Review candidates remain separate.
A complete published annual archive does not establish complete country coverage:
unpublished procurements, nonparticipating portals, restricted notices, missing
source descriptions and semantic-discovery limitations remain possible gaps.

No command here pushes to GitHub or activates a daily schedule.
The final export also extracts explicit tender lots from the saved ZIPs, if this
has not already been done. It writes separate lot-records/* JSONL files and their
validation audits. Native lot identifiers and lot-specific amounts are preserved.
A lot's current status/deadline is not inferred from the parent tender. Lots whose
own scope is unclear remain review candidates; missing native identifiers are
listed as unresolved in the audit. The original per-year records and ZIPs stay
unchanged. This second pass can add processing time but requires no new downloads.

Recent feed overlap (run after annual collection and before the final export):
  node history/spain-recent.cjs "C:/path/to/hosted-run" hosted 2026-10-10
Repeat for each dataset, using its own run folder and dataset name. Choose a
cutoff earlier than the annual archive's last update so that the feeds overlap.
This is a separate command; the annual collector does not run it automatically.
Raw Atom pages, retrieval timestamps and checksums are preserved. Pagination
must reach the overlap boundary or the end of the feed; a page limit or request
failure is reported as partial. The export includes completed recent windows.
If recent-feed-required.json is present, export refuses an incomplete window.
Recent public-feed updates still do not independently confirm bidding access.
