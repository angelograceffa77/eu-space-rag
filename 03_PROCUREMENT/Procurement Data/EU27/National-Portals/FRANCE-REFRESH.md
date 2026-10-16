# France procurement refresh

Run from this collector folder with Node.js 22 or later, installed project dependencies, and Microsoft Edge:

```powershell
node .\refresh-france.cjs
```

A fresh run creates a timestamped folder under `data\France`. To resume an interrupted run without losing downloaded evidence:

```powershell
node .\refresh-france.cjs --resume="FULL_RUN_FOLDER" --as-of=2026-10-14
```

Use the original run date when resuming. A fresh run is required to refresh live sources on a later date. An optional `--output="FULL_OUTPUT_FOLDER"` changes the destination.

The collector saves validated outputs under `final-output\France`. It preserves the existing 34-field Excel/JSONL structure. MASTER is the latest record per source procedure; HISTORY retains notice versions; OPEN contains verified space-related records with a future submission deadline; REVIEW includes ambiguous scope, conflicting deadlines and retained evidence that was not refreshed. These views overlap and must not be added together. Cross-source duplicates remain traceable, so OPEN source records are not necessarily unique opportunities.

## Sources and method

- BOAMP public API: expanded French/English space, navigation, remote-sensing and adjacent technology terms, relevant CPV strings, and CNES/ONERA searches from 2020 onward. Supplementary French space/rocket terminology is also searched; ambiguous rocket terms are restricted to notice titles because broad language stemming generates unrelated matches. Yearly partitions split below the API offset cap. Each page is saved losslessly as compressed UTF-8 JSON with its checksum, request URL and retrieval time. Counts and pagination reconcile before completion.
- Full eForms, legacy BOAMP, simplified, MAPA and DSP data are parsed. Contract scope is separated from supplier identities and postal addresses. Original records remain available even when normalized descriptions exceed Excel's cell limits.
- Current-deadline eForms procedures receive an additional BOAMP history lookup, including awards that may no longer mention the search terms.
- CNES: all publicly listed current consultations, with reconciled pagination and individual detail pages. The separate public CNES R&D challenge platform is also checked for competitions that lead to CNES contracts; its deadlines are captured in an explicitly UTC browser context.
- PLACE: expanded current searches, reconciled result counts and individual detail pages. Phrase searches may use the portal's broad matching; irrelevant candidates are retained in the exclusion audit.
- Prior unmatched records remain in HISTORY and REVIEW with verification removed. Prior snapshots and raw files are preserved.

The run publishes only after selected-query/detail failures are resolved and all exported Excel fields match JSONL. `FRANCE_SOURCE_AUDIT.json` records query results, excluded candidates and remaining limitations. `GITHUB-READABLE-MANIFEST.json` indexes lossless 128 KiB MASTER/HISTORY parts for text-oriented connectors. Keep the manifest, referenced parts, canonical outputs and scraper modules when publishing; do not publish checkpoints, browser session state or backups.

## Limits

This is broad public-source coverage, not a guarantee of every French procurement. Restricted invitations, unpublished or below-threshold contracts, documents requiring login, and space scope visible only in attachments can be missed. Native closed PLACE/CNES archives are supplemented by BOAMP and prior evidence rather than claimed exhaustive. Legacy procedure links and amendments can prevent confident current-status reconciliation. Multiple lot deadlines, mixed equipment and incidental navigation are retained for review. An agency buyer alone does not establish a substantive space contract.

No account, bid submission or access-control bypass is required. The refresh does not commit or push to GitHub and does not automatically regenerate combined EU27 outputs; those are merged only after country validation.
