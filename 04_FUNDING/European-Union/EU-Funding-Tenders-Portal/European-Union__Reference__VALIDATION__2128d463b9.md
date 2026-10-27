# Validation — 13 October 2026

Tested on Windows with Node.js 24.18.0 and ExcelJS 4.4.0.

## Results

- JavaScript syntax check: passed.
- Six automated regression tests: passed. They cover source status/date conflicts, space classification and exclusions, fallback IDs, cancellation, historical/undated query construction, invalid CLI inputs, malformed API responses, partial-run export, checkpoint resume, canonical deduplication, Excel read-back, retained prior records, repeated-page detection, and unexpectedly empty responses refusing complete publication.
- Official frontend inspected directly. Multipart JSON parts, funding types, numeric date ranges and status codes confirmed from source. Official API returned version 2.155.
- Full live **current** traversal: 12 pages, 1,198 indexed records, 1,096 canonical opportunities; 102 duplicate variants merged. Coverage ledger exhausted, no API warnings or total drift. Final status **complete** for this requested index traversal.
- Full live **2020** traversal: all 12 monthly queries plus the undated-review query; 3,231 indexed occurrences, 1,201 canonical opportunities; 2,030 overlap/index duplicates merged. Final status **complete** for this requested scope. This includes undated candidates requiring review; it is not 1,201 confirmed 2020 space calls.
- Both live traversals produced JSONL, GitHub-sized part files, manifests, checksummed original responses and Excel workbooks. Final exports were reconstructed from the same saved original pages after correcting missing-checksum comparison; no source records were fabricated. Offline resume separately confirmed the next page is requested rather than restarting page 1.

## Limits

- The entire 2020–2026 backfill was **not** executed. The successful full-year test proves the monthly/undated request and pipeline for 2020; it does not establish complete live coverage for later historical years. Use the documented `--mode all --since 2020` command to collect them.
- Live index traversal is not a snapshot transaction. Unchanged totals do not prove absence of shifts/omissions. Fresh reconciliation remains necessary.
- API responses contained duplicate index/action variants, sometimes without checksums. Missing checksums are not treated as version changes; populated fields and mixed source statuses are retained conservatively. Distinct known checksums for the same source reference mark the run partial.
- A guessed modern topic-detail URL and the API-returned URL for `BG-07-2015` returned HTTP 404. Detail-document collection and eligibility verification are explicitly unavailable in this item. Indexed conditions/actions/links are preserved.
- The initial historical query containing `lt` and `minimum_should_match` returned HTTP 400; the supported `gte`/`lte` and `bool.should` syntax passed live tests. The missing-date query passed live testing with `must_not` date ranges.
- The initial Node fetch/undici client crashed during live current traversal. Final code uses the core HTTPS client and completed both traversals successfully.
- Restricted sandbox temp-folder rename tests initially failed with Windows EPERM. The same tests passed outside that temp-folder restriction; regular workspace exports passed. No unsafe fallback was introduced for file publication.
- Final live workbooks were read back programmatically; every master-row canonical ID matches JSONL. All raw-page and part-file SHA-256 values were recomputed and matched. The current run has 70 rule-matched space candidates and 631 review candidates; the 2020 run has 86 rule-matched space candidates and 372 review candidates. These are automated classifications, not manually verified eligibility.
- Live Excel read-back exposed one XML-invalid source character; final export sanitizes XML-invalid characters only in Excel. Current workbook: one sanitized cell, zero clipped cells. 2020 workbook: zero sanitized cells, four clipped cells. JSONL preserves full text. The regression suite also exercises an invalid control character.
- Microsoft Excel GUI layout was not inspected; eligibility and classifier precision were not manually adjudicated for every record.
- No CORDIS data, awards, beneficiaries, other portals, scheduler, or GitHub publication were added.

## Evidence

`evidence/official-frontend-contract.json` contains source URL, hash and selected official frontend excerpts. `evidence/current/` and `evidence/history-2020/` preserve the full validated runs, including raw pages and snapshot outputs. Their relative manifest evidence paths resolve from the respective run root. They are validation datasets, not evidence that the full 2020+ backfill has been performed. See each `generated/latest-complete.json` pointer and its snapshot manifest for exact counts and checksums.
