# Czechia — completed repair and refresh, 2026-10-13

This is the completed best-effort Czech repair pass, with the limitations below. It is not a claim of exhaustive coverage of every published or unpublished national purchase. Other countries were not collected during this pass.

## Final files and counts

- MASTER: 2,938 latest source records; 1,136 have confirmed space relevance under the documented classification rules.
- HISTORY: 5,583 source notice versions.
- OPEN: 11 source records representing 6 distinct verified opportunities. Cross-source copies are retained for provenance.
- REVIEW: 1,897 records needing relevance, date or source-detail review.
- Excel/JSONL comparison: 354,586 field values matched when the saved workbook was read back. UTF-8 and country isolation were checked separately.
- Workbook: CZ_NATIONAL_SPACE_2026-10-13.xlsx; matching UTF-8 JSONL files: CZ_NATIONAL_SPACE_2026-10-13_{MASTER,OPEN,HISTORY,REVIEW,COVERAGE}.jsonl.

REVIEW can overlap confirmed space relevance when a publication date is missing; it is not a mutually exclusive remainder. Undated candidates remain explicitly marked for review and do not establish dated historical coverage.

## Sources checked

- ISVZ RVZ/VVZ: 65 official archive files, 1,270,148 archive entries processed, 0 unparsed entries and 0 failed archive files. Entry counts include repeated observations and are not unique tenders.
- Historical scope: 2020 onward; annual 2024/2025 and monthly January–September 2026 RVZ exports, plus 2020–2024 standard and defence VVZ CSVs. September remains the latest published monthly archive.
- All 65 saved archive files were checked against live source metadata on 13 October. Four compressed-transport size differences were resolved by matching fresh decoded-body SHA-256 hashes. Original raw downloads remain unchanged.
- NEN national portal: 31 keyword searches; all completed pagination checks: true. Additional subject-description searches, direct future-deadline verification, and Ministry of Transport/CENIA profiles supplement title-based discovery.
- ASU, CzechGlobe and CENIA E-ZAK: 491 detail pages checked. Source pagination audits and access details are under audit/2026-10-13.
- Institute of Atmospheric Physics: 57/57 listing entries reconciled; 6 relevant-period detail routes unavailable. Three potentially relevant listing-only entries remain unverified in REVIEW, with blank publication dates.

## Repairs

- Added streamed archive parsing, annual/monthly discovery and the separate defence CSV schema; preserved lot-level identities, values and valid submission deadlines.
- Added complete NEN pagination, buyer hyperlink extraction, public research profiles and subject-description searches.
- Corrected inactive/clarification deadlines, failed proceedings, purchasing-system plans, explicit currencies, and misleading GPS/street-name matches.
- Reconciled future-dated archive records against same-day live notices; unmatched archived opportunities remain outside confirmed OPEN.
- Preserved source provenance and raw-file references. No GitHub commit or push was performed.

## Remaining limitations

- VZLU Tender Arena displayed a 403 Forbidden page. National RVZ/VVZ provide historical supplementation, but live October completeness on that profile is unverified.
- Six older Atmospheric Physics detail links returned the portal homepage. Relevant titles are preserved as review-only records; dates and technical scope were not invented.
- Monthly export lag, restricted attachments, unpublished purchases, missing source fields and procurement descriptions lacking searchable space terminology prevent a guarantee of exhaustive coverage.
- NEN subject search omitted a known Czech phrase present in a direct notice, including its accent-free variant. Archive supplementation and direct live checks recovered that opportunity, but search-result reconciliation alone does not prove complete full-text indexing.
- Cross-portal copies and notice versions must not be counted as separate commercial opportunities without checking their identifiers.

## Regenerate Czechia only

Run `node refresh-czechia.cjs --from=2020-01-01 --max-pages=10000 --concurrency=1 --delay-ms=1200 --timeout-ms=90000 --output=data/czechia-refresh-NEW-DATE` from the scraper folder. Use a new working directory for each run. The final Czech files are written to final-output/Czechia.

Official source catalogues: [ISVZ open data](https://isvz.nipez.cz/opendata), [NEN](https://nen.nipez.cz/en/verejne-zakazky), [ASU profile](https://www.vhodne-uverejneni.cz/profil/67985815), [CzechGlobe](https://zakazky.czechglobe.cz/contract_index.html), [CENIA](https://ezak.mzp.cz/profile_display_4.html), [Atmospheric Physics profile](https://www.e-zakazky.cz/profil-zadavatele/f56f00fb-93a2-4453-9863-6aaca1b48c5f).

Validation: all 216 regression tests passed. All 565 referenced Czech raw files exist; all confirmed OPEN deadlines were in the future at release. The combined dataset passed UTF-8 and country-isolation checks across 28 workbooks and 140 JSONL files, with 2,608,650 field comparisons recorded.

Czechia is closed for this repair pass. Slovakia has not been started and requires the user’s permission.
