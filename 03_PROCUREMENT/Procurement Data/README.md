# Procurement master: operating guide

The authoritative package is Procurement-Master/manifest.json and the data/index files it references. Only verified, currently open, space-related procurement opportunities are included: core space, space/defence dual use, downstream space applications and other explicitly evidenced space requirements. Counts by buyer and category are in the snapshot manifest. Source text is preserved unchanged; normalized fields and company matches are separate.

For retrieval, count records whose recordType is procurement. Lots are separate parts of a tender, and source_record rows are supporting evidence, not additional opportunities. Use summary.openProcurements and summary.byBuyer for totals. Space categories can overlap and must not be added together. Read every JSONL part referenced by the manifest; never combine the current package with archived snapshots.

Counts and verified status are dated to the snapshot. For a question about what is open now, also compare the current time with each submission deadline: a tender can expire between daily runs. The next successful daily update archives its verified expiry.

Use `npm test` for offline regression checks. Legacy collection/build commands are disabled for the open-space master.

Daily operation: run `node --use-system-ca --max-old-space-size=8192 daily/daily.cjs --publish` from this folder. The local automation runs Monday-Friday at 10:00 Europe/Budapest, starting 21 October 2026. The computer and local execution environment must be available. It discovers new open notices and rechecks existing open tenders regardless of publication date. No 2020 historical backfill is run. An unavailable notice is not considered closed. Unresolved previous open tenders hold publication and preserve the last good master.

Operating folders:
- Procurement-Master: current validated local master, its manifest and searchable JSONL parts. GitHub receives the normalized current/ representation produced by the publisher.
- open-only/controller: source-specific current-notice collectors, coverage checks and candidate export.
- open-only/master: space screening, document evidence, lifecycle verification, company matching, build and daily controller.
- open-only/state: local daily state and reviewed-document bindings; source qualification ledgers document limitations. Runtime state is not published.
- daily: settings, isolated Git publisher, publication allowlist, archive/retention controls and tests.
- master: common validation, JSONL splitting, normalisation and company matching support.
- orchestration: shared locks, atomic state writes and collector support.
- EU27/National-Portals and authority scraper folders: maintained collector code and local dependencies. Generated outputs and caches are archived; only explicitly allowlisted operating files are published.
- node_modules: installed local dependencies; never published.

The company catalogue under ../../05_COMPANIES remains a required external input for company matching. Eligibility is not inferred from technical fit. Recreate dependencies from package-lock files, including the National-Portals browser dependencies; the collectors use installed Microsoft Edge where necessary.

GitHub rule: daily/publication-policy.cjs is the default-deny allowlist. The publisher replaces only 03_PROCUREMENT/Procurement Data on configured main with the validated master and allowlisted operating files. Other repository paths are preserved. Raw downloads, Excel collector exports, caches, checkpoints, candidate masters, personal review state and logs remain local. Publication uses an isolated Git index, never stages the user's working tree and never force-pushes. Use the controller rather than manually committing a local snapshot pointer.

Archive root:
C:\Users\angel\OneDrive\Desktop\knowledge\03_PROCUREMENT\Procurement Data

- open-only/daily-runs: original discovery responses, live checks, reviewed documents and resumable checkpoints for each run.
- open-only/previous-masters and open-only/retired-local-snapshots: superseded master snapshots, archived before removing local copies.
- open-only/completed-packages and open-only/master-snapshots: completed candidate/build audit packages.
- open-only/historical-tenders: compact records of verified closures or expired deadlines from previously open tenders; separate from the open master. No historical backfill.
- open-only/qualification: uncertain/excluded candidates and validation results.
- _maintenance/cutover-2026-10-20: backed-up code and obsolete files moved during cleanup, preserving their relative folder structure.
- _publication: isolated Git repository and publication receipts.
- _retention: managed archive inventory, protected-file checks and deletion receipts.

Retention runs after successful publication, at most once every 14 days. Only registered obsolete units archived at least 14 days earlier are eligible. Current-master evidence, active/resumable run inputs, reviewed-document dependencies and historical tender records with their referenced closure evidence are protected. Failed runs keep their evidence. The archive root and publication Git repository are never swept. Cleanup failures are reported separately from publication success.

Coverage remains partial: restricted/log-in-only systems, incomplete official indexes, ambiguous deadlines/statuses and unavailable technical documents are recorded as gaps. A successful publication does not mean exhaustive coverage of all EU tenders.

### Tenders awaiting recheck
The master includes `recordType: awaiting_recheck` separately from verified open procurements and lots. Never include these records in open counts or imply their saved lastOpenRecord is currently verified. Read summary.awaitingRecheck for the separate count. Last successful records, lots and unchanged source evidence are retained, and their recheck seeds are checked on every daily run until resolved. Missing observations never imply closure. Publication stops if pending tenders exceed five or 5% of previously tracked tenders (one is allowed for small lists). Evidence corruption and other integrity gates still block publication. Reviewed-document downloads receive up to three attempts.
