# Open space funding master

Read `manifest.json` first, then the manifest at its `path`. Verify the manifest checksum and read every listed JSONL part. These parts are one dataset; do not combine them with older snapshots or collector exports.

Only `funding_opportunity` records belong in the open-funding count. Before answering, compare each record's `availability.deadline` with the current time. Exclude elapsed deadlines and label them **deadline passed—awaiting recheck**. For date-only deadlines, follow `deadlineRule`: exclude throughout the closing day in Europe/Brussels. Snapshot totals describe `asOf`, not necessarily the current minute.

`awaiting_recheck` records are separate, uncertain opportunities. They are not verified open and are not confirmed closed. `project_context` records describe CORDIS projects and partners; awards are never open funding opportunities. Historical transitions remain in the local audit archive.

Include core space, space/defence dual use and evidenced downstream space applications. A generic programme open to all technologies is not automatically a space-funding opportunity. Read `spaceRelevance`, the original source record and any reviewed documents. Resolved deadline conflicts retain both the original portal values and the controlling applicant-guide evidence.

Company suggestions indicate documented capability overlap only. They do not establish eligibility, consortium composition, nationality requirements, capacity or willingness to apply.

Coverage is partial. Read the manifest's coverage and limitations before making completeness claims. Restricted systems, unlisted cascade funding and ambiguous application conditions can leave gaps. Missing observations never establish closure. Local absolute evidence paths identify preserved audit files; those raw files are deliberately not included in GitHub publication.

The local reader is `02_Quality-and-Matching/verify.cjs --list`. Publication is a separately enabled action; package preparation does not mean GitHub was updated.

Company matching update (24 October 2026)
Company suggestions retain source excerpts, explicit requirement wording, missing capability evidence, source age and eligibility questions. A score is not a probability of winning. Missing evidence does not mean a company is incapable. Legal eligibility, certification, capacity and bidding intent remain unknown unless separately evidenced.
Planned-opportunity shortlists are preparation only and must never appear as open opportunities. Award winners are linked to company profiles only with verified identity evidence; name-only matches remain review leads. Verified relevant contract awards may break equal technical scores, but a consortium value is not the revenue of each member.
Company matching refresh dates do not replace official opportunity status/deadline verification dates. Preserve answer-time deadline checks. Public company website enrichment uses unchanged original evidence and excludes Dealroom.