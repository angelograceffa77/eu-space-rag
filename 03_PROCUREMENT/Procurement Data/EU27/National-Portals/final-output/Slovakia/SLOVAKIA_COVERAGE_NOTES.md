# Slovakia procurement coverage — 2026-10-13

Completed collection and validation pass, with the limits below. This is not a claim that every Slovak procurement is covered.

## Results

- MASTER: 1638 latest source records; 406 classified as confirmed space-related.
- HISTORY: 2339 retained source versions.
- OPEN: 2 source records representing 1 distinct procedure IDs.
- REVIEW: 1251 uncertain or insufficiently verified records.
- Excel/JSONL comparison: 177820 fields matched; all referenced raw files exist.

Counts are source records, not necessarily unique procurements across portals. Use SK_OPEN_OPPORTUNITIES_2026-10-13.json for the deduplicated open-procedure list. Dates are source dates; a current export does not make an old notice current.

## Sources and recovery

- UVO national register: 31 keyword/CPV queries, 31 reconciled, 499 unique procedure listings. Procedure details and latest dated live notices were collected for in-scope candidates, with older notice headers retained and historical records supplied by the full bulletin archive; explicit non-space matches and pre-2020 listings are audited.
- Official open-data catalogue: 1834 downloaded JSON/XML bulletin files, 245096 notice entries, 2020 onward. All 1,834 downloaded files passed SHA-256 verification. No archive parse errors.
- Two defective catalogue downloads (131/2026 HTTP 404 and 202/2023 malformed URL) recovered through their official HTML bulletins. All 121 notice pages parsed, including 17 individual summary awards; no additional space candidate found.
- SARIO: all 61 buyer-profile listings reconciled. A name-search discrepancy of 21 listings was resolved through the direct profile.
- EVO, Astronomical Institute purchase register, SARIO/Slovak Space Office procurement pages, Institute of Experimental Physics and Institute of Earth Sciences buyer searches were checked.

## Interpretation and remaining limits

- Open status requires a verified future submission/participation deadline and relevant live evidence. The UVO label “active” alone is not sufficient. Archive-only future dates stay in review until live verification.
- Historical summary awards are preserved separately. An award is never presented as an open invitation. Astronomy category entries without tender detail remain in review.
- 2543 administrative or unsupported archive entries remain in raw evidence without normalized records.
- 0 national detail/notice errors are listed in the dated source audit. Consult COVERAGE for exact per-source limitations.
- Keyword/CPV indexing can miss generic titles, document-only requirements, unpublished or restricted purchases. Attached files are not exhaustively parsed or OCR-processed. SARIO linked-document inventory is retained for follow-up; title discovery is not full-document coverage.
- Archived and live records can overlap. Historical versions are evidence, not additional open opportunities.

## Files and regeneration

The workbook and JSONL files contain matching MASTER, OPEN, HISTORY, REVIEW and COVERAGE views. Start with OPEN for current opportunities and MASTER for latest source records. HISTORY preserves versions; REVIEW lists uncertain scope or evidence.

From the National-Portals folder, run:

```text
node refresh-slovakia.cjs --from=2020-01-01 --output=data/slovakia-refresh --sk-archive-dir=data/slovakia-bulletins
```

The refresh entry point and source adapters are installed in the parent National-Portals folder. It preserves prior published history. Failed source runs do not replace the final country snapshot. The entry point passed a bounded three-procedure cached-response/export check; this release combines the individually executed live source passes and full archive parse.

Raw files remain in the collection workspace and archive cache (approximately 13 GB). The final output contains provenance paths and audit reports, not duplicate raw archives. No GitHub push was performed.
