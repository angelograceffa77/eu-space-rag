# Luxembourg procurement refresh

From the National-Portals folder, with Node.js 22+ and the repository dependencies installed:

```powershell
node .\refresh-luxembourg.cjs
```

This creates a new timestamped evidence folder under `data\Luxembourg\YYYY-MM-DD`. Resume an interrupted run using its exact folder and date:

```powershell
node .\refresh-luxembourg.cjs --as-of=2026-10-14 --resume=".\data\Luxembourg\2026-10-14"
```

Resume reuses saved evidence. Omit `--resume` for a fresh live refresh. Do not run two writers against the same run directory. A changed archive count requires a fresh index run; count mismatch is not treated as successful collection.

The collector reconciles all public consultation, award and information listing pages; screens records from 2020 onward; retrieves relevant and future-deadline details through their original public links; extracts available public notice PDFs; and checks LSA, ESRIC and LIST pages. Funding and ESA programme calls are not converted into national tenders.

Final Excel and UTF-8 MASTER, OPEN, HISTORY, REVIEW and COVERAGE JSONL are saved in `final-output\Luxembourg`. MASTER includes candidates. OPEN requires confirmed space relevance, an actual tender, a future deadline and no conflicting procedure restriction. REVIEW includes uncertain geospatial matches and retained prior evidence. Economic satellite accounts, planning notices, awards, DPS admission and placeholder dates such as 2999 are not confirmed OPEN tenders.

The manifest and `github-readable` directory contain lossless small JSONL parts for GitHub retrieval. Publish these together with the workbook, JSONL views, source audit and reusable collector/helper files. Keep raw caches, checkpoints and backups local. `sourceUrl` is the portable official link; `rawFile` refers to local evidence.

Coverage remains partial for unpublished/restricted tenders, unindexed removals, historical attachment-only relevance and bounded agency-site discovery. See COVERAGE and the audit for actual run counts and errors. This command refreshes Luxembourg only; reconcile the combined EU27 output separately.
