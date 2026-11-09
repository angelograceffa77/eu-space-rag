# Report formats and length

## Choose before writing
Ask for Executive Standard or Detailed Report, with a short description. Ask separately whether the user wants email delivery. If Yes, obtain or confirm the address; if No, provide the report in chat. Do not repeat answered questions. Use native clickable choices if available, otherwise numbered choices. Give a realistic time range before starting and revise it if a material delay arises.

## Same quality, different detail
Executive Standard is concise and decision-focused. Use essential authoritative citations, especially for legal requirements, opportunity conditions and deadlines; a full bibliography of everything consulted is unnecessary.
Detailed Report explains the context, evidence, alternatives and uncertainties more fully. Link the external sources materially used to the relevant findings.
Both use the same complete evidence review and verification. Keep a full private evidence record. Cover context, relevant evidence, analysis and justification, conclusions and next actions. An executive assessment may come first. Explain reasons supported by evidence, not hidden internal deliberations. Preserve material limitations, privacy, confidentiality, copyright and source restrictions. Keep internal paths and tool logs private. For contracts, put analysis in the accompanying drafting note rather than the proposed agreement.

## Length
Follow an identified official submission rule, industry standard or commissioning specification when applicable. Record its source and minimum/maximum in the private review. Do not invent an industry standard.
Otherwise use Bravestar editorial defaults:
- Executive Standard: minimum 4,000 characters including spaces; normally 4,000–8,000. The upper target is not a mandatory limit.
- Detailed Report: minimum 12,000 characters including spaces; longer if evidence and scope justify it.
Count main analysis and substantive tables. Exclude cover, contents, repeated headers/footers, bibliography, disclaimer and contact statement. Do not shift essential analysis into annexes to manipulate length. Never pad or invent material. If evidence cannot support the minimum, explain the limitation and agree a narrower deliverable. Record that agreement as the commissioning specification; do not silently waive the check.
Contracts follow their actual requirements; assess the accompanying note separately where appropriate. Separate annexes do not independently need to meet a full-report minimum.

## Clear writing
Write with professional fluency, precise language and connected reasoning. Define terms and acronyms; explain why each finding matters and what to do next. All tables, charts, footnotes and annexes must be understandable to a non-specialist. Distinguish facts, assumptions, forecasts and unresolved questions. Avoid generic filler and misleading claims of human authorship or review. Perform a separate plain-language readability check.

## Release checks
Keep confidence ratings in chat and private evidence, never in generated reports. Retain uncertainties and source limitations in the report. Every final file needs the complete disclaimer and contact statement, including editable files and standalone annexes; contracts also need their legal-review warning. Missing text blocks final release and sending.
Run validate_report.py FINAL_FILE --format executive-standard|detailed-report --substantive-text REVIEWED_BODY.txt. The extract must match the final artifact in order and contain only countable content. Review excluded material manually; automatic text extraction cannot prove substantive quality. For sourced limits, also pass --minimum N and/or --maximum N with --length-source SOURCE. For a standalone contract or annex, use --role contract|annex and --length-source explaining its exemption; validate the report/drafting note separately. No unsupported silent exemptions.
Inspect each rendered final file. Ask permission to send the completed version unless prior authority already covers the report and recipient. An email preference is not final sending authority. Keep existing archive protections and daily 10:30 Europe/Budapest retention.
