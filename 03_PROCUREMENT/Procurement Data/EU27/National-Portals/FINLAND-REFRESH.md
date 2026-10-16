# Finland full procurement refresh

Run from this National-Portals folder with Node.js 22 or newer and the installed package dependencies:

```powershell
node .\refresh-finland.cjs
```

Resume the same collection without discarding saved source responses:

```powershell
node .\refresh-finland.cjs --resume="FULL_RUN_DIRECTORY" --as-of=YYYY-MM-DD
```

The command creates a new timestamped run under data/Finland by default. Resume reuses its evidence; start a new run for a fresh live snapshot. No API subscription or browser sign-in is needed for the public endpoints used by this collector.

The collector screens every available HILMA index record from January 2020 through the collection date. It reconciles yearly result counts and all pages, then retrieves complete legacy or eForms procedure histories for substantive space candidates, all indexed future-deadline candidates, and relevant Finnish space-administration/research buyers. Finland's administration is distributed across several institutions; buyer screening includes Business Finland, FMI, Maanmittauslaitos, Traficom, TEM, VTT and the National Emergency Supply Agency. Official institutional pages are preserved separately.

Outputs are saved in final-output/Finland:

- FI_NATIONAL_SPACE_DATE.xlsx, with matching MASTER, OPEN, HISTORY, REVIEW and COVERAGE JSONL.
- MASTER: latest retained record per identified procedure. HISTORY: retained notice versions. The two views must not be added together.
- OPEN: verified space relevance, a tender invitation and an unexpired deadline. Direct awards, market consultations, qualification systems and unverified notices are not confirmed-open tenders.
- REVIEW: uncertain relevance, qualification/admission, multiple lot deadlines or retained prior evidence needing verification.
- GITHUB-READABLE-MANIFEST.json and github-readable/: lossless small MASTER/HISTORY JSONL parts with checksums. Read every referenced part for exhaustive questions.
- FINLAND_SOURCE_AUDIT.json and validation.json: source routes, exclusion evidence, count reconciliation and Excel/JSONL field comparisons.

Raw index pages and complete notices are retained as lossless compressed JSON under data/Finland. Source URLs in each record link to the official notice. Excel and JSONL preserve the established 34-field schema. Publication is staged and validated; matching prior final files are backed up before replacement. Unresolved index or selected-procedure failures stop final publication. Background institutional-page access failures are recorded as coverage gaps.

Coverage limits: this is a complete pass through the available index, not a claim to capture every Finnish procurement. Removed or restricted notices, below-threshold purchases outside HILMA, and scope disclosed only inside attachments may be missed. Multi-lot notices are aggregated and require checking the original lot terms. Legacy and eForms procedure identifiers use distinct namespaces; related procedures are not collapsed solely because their titles match. Procurement plans, grants and international ESA calls are not converted into Finnish open tenders. Source content can change between requests.

Use the Finland entry point above for this enhanced collection. The older generic adapter is a smaller discovery scan. Keep the collector modules, shared core/export modules, package files, this guide and final-output/Finland for reuse/publication. Do not publish node_modules, backups, checkpoints or raw downloads by default. This command refreshes Finland only; combined EU27 files are reconciled separately. It does not push to GitHub.
