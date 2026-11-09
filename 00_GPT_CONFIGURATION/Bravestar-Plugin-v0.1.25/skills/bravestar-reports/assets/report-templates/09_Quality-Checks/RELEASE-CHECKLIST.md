# Release checklist

Record pass/fail/not-applicable with evidence and reviewer identity. Do not claim human review unless performed.

- Correct organisation, scope, command and template version.
- All required inputs and official uploads present, or report explicitly preliminary.
- Complete relevant GitHub reading documented; unavailable material disclosed.
- Appropriate official verification and exact identities; source restrictions respected.
- Current deadlines, time zones, stages and lots checked; dated totals not called current without filtering.
- Applicable legal status, editions, instrument identifiers and amendments checked.
- Fit, eligibility, capacity and commercial interest separated.
- Amounts and currencies reconciled; missing values not zero; no duplicate totals.
- Contacts evidenced and links inspected.
- Material claims supported; alternatives, conflicts and limits visible.
- Public citations present; internal logs and confidential source paths excluded from client report.
- All placeholder tokens resolved or explicitly marked as open terms in a preliminary contract draft.
- Every rendered page visually reviewed for clipping, blank pages, broken tables and unreadable text.
- AI disclaimer present; contract warning where relevant.
- Final copy saved; recipient and sending authority recorded; no unapproved outreach.
- Sending result verified before marking sent; archive indexed; no duplicate retry.

Outcome: {{pass_or_hold_or_preliminary}}. Findings: {{specific_issues}}. Checked by: {{actual_reviewer_or_automated_check}}. Time: {{timestamp}}.

Mandatory HOLD gates: missing full disclaimer or contact statement; report contains confidence levels; applicable sourced length requirement unmet. Validate each actual final artifact using the packaged Reports scripts/validate_report.py, then inspect every rendered page. Check the chosen format and length under REPORT-FORMATS.md; retain all material relevant findings at the appropriate level of detail. Record character count and any sourced length constraint. Ask format and email-delivery preference when the report is selected; obtain the email only if Yes and final sending permission unless explicit applicable prior authority exists.

## Required report branding and sections
Use the approved astronaut-riding-Ariane image in 01_Shared-Standards/bravestar-logo.png on the cover or first page of every generated report, including editable copies. Preserve its full name, motto and proportions; do not crop, redraw, stretch or substitute it. Embed the image so it remains visible offline. If the image cannot be included, hold final release and explain the limitation. For plain-text delivery, provide a branded PDF or DOCX rather than claiming text contains the image. Visually check that the logo is legible and not clipped.
Use these main sections in this order for both formats:
1. Executive Summary
2. Analysis
3. Sources (where applicable)
4. Conclusion
5. Next Actions and Related Timelines
Put context, relevant evidence, justification and uncertainty within Analysis. Put relevant references in Sources: essential citations for Executive Standard and fuller references for Detailed Report. Omit Sources only when genuinely inapplicable, and record why in the private review; do not omit sources merely to shorten a researched report. State actual deadlines and time zones, or clearly labelled proposed target dates; never invent deadlines. For contracts, use these sections in the accompanying drafting report, not as clauses of the agreement. Standalone annexes belong to the branded report package and retain their appropriate internal structure. Keep the disclaimer and contact statement after the main sections.

## Format-specific content review
Hold release if material content is missing. Executive Standard must support a decision with essential reasoning, critical risks and normally three to five priority actions. Detailed Report must also provide supporting evidence, relevant alternatives and implementation dependencies. Both must retain eligibility restrictions and binding deadlines. Use flexible page targets in REPORT-FORMATS.md; no default character minimum applies. Actual sourced or agreed submission limits remain mandatory. Record content review separately from automated checks.

## Report-specific gate
Check every requirement for the selected command in template-profiles.json. Save status, evidence, report location and reason in a private review bound to the final file SHA-256. Run validate_template_review.py and the final artifact validator. Missing or failed checks hold final release. Not-applicable entries need a scope reason. This verifies recorded review completeness, not the truth of its assertions. Follow REPORT-SPECIFIC-PRACTICE.md for formal presentation and official-form exceptions.
