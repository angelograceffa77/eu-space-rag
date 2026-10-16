# Romania procurement coverage — 2026-10-13

Completed collection and validation pass with documented gaps; this is not exhaustive national coverage.

## Results

- MASTER: 41075 source records.
- OPEN: 2 source records.
- HISTORY: 42756 source records.
- REVIEW: 32749 source records.
- Confirmed space-related latest records: 8442.
- 149 official archive files parsed; 20903318 source rows scanned (includes overlapping formats), not that many space tenders.
- 3963788 record fields and 52 coverage fields matched Excel against JSONL. All raw evidence paths exist; all archive checksums match.
- All 236 regression tests passed. Other-country snapshots were preserved.

## Reading the outputs

Start with OPEN for verified current opportunities. MASTER contains latest source records, including broad candidates; HISTORY preserves versions. REVIEW contains uncertain scope or insufficient evidence. These views overlap and should not be added together. COVERAGE describes collection limits. For GitHub retrieval, start with GITHUB-READABLE-MANIFEST.json and follow every index and part for exhaustive questions. The small parts reconstruct the original MASTER/HISTORY JSONL byte for byte.

## Open opportunities

- Satellite-equipment spare parts: ADV1551931, military buyer; earlier stated deadline 16 October 2026 at 15:00 Bucharest. The structured field says 16:00; this conflict is retained and should be confirmed with the buyer. The nominal 0.01 RON value is a source placeholder.
- Airport fleet-monitoring equipment/software rental: deadline 22 October 2026 at 15:00 Bucharest; official satellite-services CPV. Two road-vehicle rental notices mentioning GPS remain in REVIEW rather than confirmed OPEN.

## Sources and limits

SEAP/SICAP public notices, direct procurement advertisements, ADR official annual/quarterly archives from 2020 onward, and Romanian Space Agency procurement publications/plan were collected.
- Historical files sometimes omit titles or deadlines. Matching initiation/live evidence restores available titles; unresolved cases and inconsistent extra columns remain flagged for review.
- Archive-only records cannot prove an open submission window. Cross-source records and historical versions can overlap.
- ROSA annual plan is scanned: raw PDF and 14-page OCR are preserved, with a consolidated review record rather than invented individual tender deadlines.
- Keyword/CPV discovery can miss generic titles, document-only specifications, restricted or unpublished purchases. Not every attachment is parsed. Consult COVERAGE and the audit for exact source gaps.

## Regeneration

From the parent National-Portals folder:

```text
node --max-old-space-size=8192 refresh-romania.cjs --from=2020-01-01
```

The entry point and romania-* helpers must stay together with package dependencies, the bundled Python path used by romania-xls.py, and .runtime-python/xlrd. Windows PowerShell supports the official TLS downloads and scanned-plan OCR. Use --resume=RUN_DIR with the same --from and --to dates to resume. Raw data and checksums are under data/Romania. Prior published history is retained and previous final files backed up.

The release was built from successfully executed live source passes, full archive parsing, and full export validation. The complete new one-command refresh has not been repeated from an empty cache. It is installed for future regeneration. No GitHub push was performed. Publish the Romania country files and github-readable parts; the combined EU27 files are local convenience exports and can exceed GitHub size limits.
