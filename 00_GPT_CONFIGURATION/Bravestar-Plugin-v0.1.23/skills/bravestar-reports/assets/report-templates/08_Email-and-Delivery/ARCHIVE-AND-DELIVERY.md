# Delivery and archive procedure

This is a procedure template, not an executable email service.

1. Save a recoverable final report before sending; assign report ID and hash.
2. Verify recipient, attachments and explicit authority. Record sending status prepared, sending, sent, delivery_pending or outcome_unknown.
3. If the result is uncertain, inspect the sending account before retrying. Do not send duplicates because an archive step failed.
4. Archive outside the repository under C:/Users/angel/OneDrive/Desktop/knowledge/00_GPT_CONFIGURATION/Report-Archive/Company-Name_Company-ID/YYYY-MM-DD_Report-Type_Report-ID/.
5. Preserve 01_Final-Report, 02_Editable-Version, 03_Evidence-and-Scope, 04_Quality-Review and 05_Delivery-Receipt. Add the report to 00_Archive-Index.
6. Retain exact delivered bytes, template version, evidence references, recipient, actual message ID and delivery result. Mark unavailable archive access pending.
7. No client reports, addresses or inputs in the public template library. No collector-cache retention or deletion without separate authority.

At report selection ask format and whether email delivery is wanted. Obtain or confirm the email address only if Yes. Do not repeat answered questions. Ask permission for the completed final version unless explicit prior authority covers it. Passing quality checks does not authorise sending. Reports older than 14 days are subject to the separate report archive procedure; protect indexes, receipts, evidence, templates and source data.

Report retention: use Europe/Budapest dates. Before deletion inventory actual generated final/editable report artifacts older than 14 days under the exact Report-Archive root; establish generation date from the report package and receipt, not merely a copied file timestamp. Exclude active drafts, unknown dates, links/reparse points, evidence, indexes, receipts and all files outside the root. Recheck resolved paths and inventory immediately before removal. Record deleted paths, dates, hashes and bytes and mark retained index entries as report-file expired. Never remove whole folders recursively merely because their names look old. A local daily cleanup automation runs at 10:30 Europe/Budapest using cleanup_reports.py --apply. It saves receipts and an expired-artifacts index; unknown or active packages are retained.
