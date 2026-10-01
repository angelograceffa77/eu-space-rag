# Release validation

2026-10-01T19:52:29.715Z

- 27 automated tests passed; all application JavaScript files passed syntax checks.
- Latest collection: {"MASTER":5423,"OPEN":24,"HISTORY":7798,"REVIEW":3509}. 569636 actual Excel cell values matched the corresponding JSONL fields.
- Manual audit: {"AUDIT":26,"VERIFIED_OPEN":16,"SUPPORTING_OPEN":6,"REVIEW":2,"EXCLUDED":2}. 676 actual Excel cell values matched.
- Tests cover date conversion, lifecycle precedence, lot separation, search-form false positives, namespace-aware feed records, archive filtering, pagination, relevance errors and workbook parity.
- Source responses and archives are retained in the workspace work directory. Large raw archives are excluded from the ZIP; 46 selected official-page audit files are bundled with a portable provenance index.
- Spanish recovery encountered a memory limit. Normalized records now detach strings from large XML buffers, and the recovery run saves intermediate records. Any residual errors appear in the coverage output.
- OPEN is automated source-based classification; only the dated audited list has received the manual checks recorded there. Eligibility and future amendments require checking the linked official notice.
- Complete EU-27 and 2020-onward coverage is not claimed. See SOURCE-COVERAGE.md and RESTART-STATUS.md.
