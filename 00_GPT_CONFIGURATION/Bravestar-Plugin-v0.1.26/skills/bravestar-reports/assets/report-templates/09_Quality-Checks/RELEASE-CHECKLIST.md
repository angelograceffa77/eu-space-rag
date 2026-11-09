# Final release checklist

Record pass, fail or not applicable for each relevant check, with evidence and the actual reviewer. Never claim human review unless it happened.

## Content
- Correct organisation, objective, scope, command, template and profile versions.
- Required inputs and official uploads available; otherwise conclusions remain clearly preliminary.
- Full relevant GitHub and document reading recorded; unread or unavailable material disclosed.
- Official identities, current status, deadlines, time zones, stages and lots checked where required.
- Legal status, editions, instrument identifiers and amendments checked.
- Fit, eligibility, capacity and commercial interest kept separate.
- Amounts and currencies reconciled; missing values not zero; overlapping totals not added.
- Claims supported; contrary evidence, alternatives, assumptions, conflicts and limits visible.
- Contacts and links supported and checked where possible.
- Selected format follows REPORT-FORMATS.md; no padding to meet editorial page targets. Actual sourced or agreed submission limits still apply.
- Every applicable command-profile requirement reviewed. Record its ID, result, report location, evidence and reason. Not-applicable needs a specific scope reason; all checks cannot be exempted.

## Presentation
Apply REPORT-STANDARD.md. Check the logo, required sections, full disclaimer, contact statement and contract warning where needed. Check all pages for clipping, blank pages, broken tables and unreadable text. Check consistency with specialist findings and plain-language readability. Remove unresolved placeholders from final analysis; named open terms may remain in a clearly labelled preliminary contract draft. Keep public citations but exclude confidence ratings, confidential inputs and internal operational records from client files.

## Automatic checks
For each actual final PDF or DOCX report, run:

`validate_report.py FINAL_FILE --format executive-standard|detailed-report --substantive-text REVIEWED_BODY.txt --template-id COMMAND_ID --template-review REVIEW.json`

The reviewed text must match the final file in order. Exclude the cover, contents, repeated headers/footers, bibliography, disclaimer and contact statement from its substantive character count. Review these exclusions manually. Add `--minimum N` and/or `--maximum N` with `--length-source SOURCE` only for genuine sourced or agreed limits.

The final-file checker also runs validate_template_review.py for reports. The private review must match the final file's SHA-256 and current profile version. The standalone checker can be run as:

`validate_template_review.py FINAL_FILE --template-id COMMAND_ID --review REVIEW.json`

For a standalone contract or annex, use `--role contract|annex --length-source REASON`; validate its accompanying report separately. Omit Sources only when genuinely inapplicable and record the reason with `--sources-not-applicable REASON`, never merely to shorten research.

These scripts check structure and recorded review, not the truth of the findings. Factual, legal, visual and readability review remain necessary.

## Manual fallback and hold rules
When the scripts cannot run, perform and record the same checks manually. State which automatic checks were unavailable; do not claim an automatic pass. For formats the scripts cannot inspect, verify the final file and embedded logo manually. A plain-text message is not a branded final report; provide a branded PDF or DOCX.

Unavailable automation alone does not waive a requirement. If the required final-file, evidence or visual checks cannot be completed, keep the output a draft and explain what is pending. Missing logo, required sections, full disclaimer or contact statement; client-facing confidence ratings; failed applicable submission limits; failed or missing substantive review; or unsupported final clearance all block final release. Correct the issue and review the final version again.

## Delivery
Use the orchestrator's sending and archive rules. Retain a recoverable final copy; record recipient and authority; verify sending before marking sent; preserve the receipt and archive index. Check an uncertain outcome before retrying. Do not contact anyone without authority.

Outcome: pass, hold or preliminary. Record specific findings, actual reviewer and timestamp.
