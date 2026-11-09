# Sending, archiving and report cleanup

The orchestrator owns these steps. This document is a procedure, not an email service or a running schedule.

## Sending authority
The orchestrator's menu rules collect the format and email preference. Asking for email delivery or giving an address is not final sending authority. Before sending, identify the completed report and recipient and ask permission, unless an explicit earlier instruction or standing authority already covers that recipient and final report. Record that authority. Never guess an address. Passing quality checks does not authorise sending.

## Send and verify
Save a recoverable final copy first. Assign its report ID and hash. Check the recipient and attachments, then send the final PDF and requested editable files. Record prepared, sending, sent, delivery_pending or outcome_unknown. Only claim success after confirmation; keep the actual message ID or receipt. If the outcome is uncertain, check the sending account before retrying. If sending fails, mark delivery pending.

## Archive
Use C:/Users/angel/OneDrive/Desktop/knowledge/00_GPT_CONFIGURATION/Report-Archive/Company-Name_Company-ID/YYYY-MM-DD_Report-Type_Report-ID/.

Keep 01_Final-Report, 02_Editable-Version, 03_Evidence-and-Scope, 04_Quality-Review and 05_Delivery-Receipt. Add the report to 00_Archive-Index. Preserve the exact delivered bytes, template version, scope, evidence, quality checks, recipient, message ID and delivery result. If local access is unavailable, mark archiving pending. If archiving fails after sending, retry the archive step without resending. Explain the limitation. Confirm the report, recipient, sending result and archive location to the user.

Do not publish confidential reports, email addresses or private inputs to public GitHub or the template library.

## Daily cleanup at 10:30 Europe/Budapest
The authorised local cleanup uses Report-Templates/08_Email-and-Delivery/cleanup_reports.py --apply. It removes only completed, delivered final/editable report files older than 14 days. Local computer/app access is required; publishing a plugin does not itself run cleanup.

Before deleting, inventory eligible files under the exact Report-Archive root. Establish generation dates from the package and receipt, not just copied-file timestamps. Protect active drafts, undelivered packages, unknown dates, active markers, changed files, links/reparse points, evidence, indexes, receipts, templates, source libraries, collector evidence and unrelated archives. Check resolved paths and the inventory again immediately before removal. Never sweep the archive or delete whole folders because their names look old.

Record deleted paths, dates, hashes and bytes in a receipt and mark the retained index entries as report-file expired. The cleanup maintains an expired-artifacts index. This rule does not change procurement/funding retention and does not authorise collector-cache deletion.
