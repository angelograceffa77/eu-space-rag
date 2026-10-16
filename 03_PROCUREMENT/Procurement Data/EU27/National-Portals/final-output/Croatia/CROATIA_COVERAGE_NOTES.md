# Croatia coverage — 6 October 2026

This is a best-effort repaired pass with explicit outstanding portal gaps, not complete Croatian procurement coverage.

## Collected evidence

- Official legacy EOJN monthly archives: 80 months, January 2020–August 2026; 2,435 daily XML files and 191,442 notices read. Every downloaded monthly archive passed its daily-file reconciliation. September/October legacy archives were not available in the inspected listing.
- Current EOJN: 18 of 28 keyword searches fully paginated and reconciled. The geod search was partly processed. Search results, associated published notice versions and original downloaded documents are preserved locally.
- Open-stage register: all 1,350 listings marked published, and zero invitation-stage listings, enumerated. Expired deadlines are excluded from OPEN. This was a complete listing scan, not a full technical-document review of all 1,350 procedures.
- Additional notice-body screening: 14 of 91 future-dated technical-category candidates checked; 77 remain pending. No extra confirmed open space procurement was established in the completed additional checks.
- Ministry: five procurement pages and 20 published XLSX plan versions inspected, containing 3,985 plan rows and 51 relevant candidate plan-version records before final deduplication. Plans remain outside OPEN.
- Four previously failing detail pages recovered through the normal anonymous home-page session, including both confirmed open tenders.

## Confirmed open opportunities

1. Ministry of Defence: VSAT satelitski link, procedure 102047; EUR 213,000 estimated value; closes 20 October 2026 at 09:30 Croatia local time (07:30 UTC).
2. Croatian Lottery: Usluga satelitskog nadzora vozila, procedure 100448; EUR 64,000 estimated value; closes 20 October 2026 at 13:00 Croatia local time (11:00 UTC).

These were verified against the public register and published notices during this pass. Always revisit the official procedure before acting because deadlines and status can change.

## Remaining gaps and next refresh

The portal returned detail-page HTTP 500 errors, followed by HTTP 429 rate limits. Starting at its home page fixed anonymous-session initialization and recovered some details. Overlapping requests were stopped, a slower collection was tried, and a fresh session was retried three times; the search still did not initialize. The pass was finalized with the successful records rather than silently treating blocked checks as zero results.

- Finish the remaining keyword queries and incomplete geod results; retry missing published-notice/detail records. HR-pending-queries.json lists the unfinished/recovery queries.
- Run the 19 exact procurement-category queries and six buyer queries. These were not run after the sustained portal errors.
- Finish the 77 additional current technical-category notice checks in HR-pending-deep-open-queries.json.
- Recover remaining detail errors listed in the audits. Core register fields and successfully retrieved published notices remain usable; unavailable detail pages are not represented as successful downloads.
- Download later legacy archive months when officially published. Current portal coverage partly bridges the archive period but does not establish an exhaustive match between the two systems.
- Login-restricted technical attachments, unindexed notices, unpublished low-value purchases and any non-public defence procurement remain outside verified coverage. No account or access restriction was bypassed.

The reusable collector now initializes a normal anonymous session through the home page, reuses it for detail pages, retries transient startup failures, and backs off longer after rate limits. Use the Croatia refresh command in the main README, one source process at a time and a fresh output directory. The optional query files support targeted follow-up checks. Historical currencies are not guessed; cancelled, suspended, closed, planning and invitation-only records cannot become OPEN merely from a future date. Space-event hospitality and promotional supplies remain REVIEW candidates.
