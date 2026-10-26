NATIONAL SPACE FUNDING — PHASE 4

Location: 04_FUNDING/National-Funding

Purpose
Discover national funding routes in all 27 EU countries and admit only reviewed,
currently open space-related funding into the common Funding-Master.
Country presence does not mean complete coverage or a verified empty result.

Files
sources.json: country-by-country official discovery routes and collection limits.
collect.cjs: public HTML/PDF discovery with immutable evidence and checkpoints.
browser-check.cjs: public-browser fallback for failed or empty source pages.
normalize.cjs: reproducible, evidence-bound national call extraction.
reviews.json: reviewed call identity, relevance, dates and eligibility restrictions.
COUNTRY-COVERAGE.json / .csv: latest validated country coverage and actual errors.
Each country folder: country-specific operating guide; raw downloads stay archived.

How it fits the existing architecture
The shared coordinator runs the national collection after EU, ESA and international
sources. It rechecks reviewed national calls as well as discovering new candidates.
Only a reviewed call with a current invitation, confirmed future deadline, funding
mechanism and evidenced space relevance enters the master. Broad funding portals,
recruitment, purchases, awarded projects and accreditation-only calls are excluded.
National references to existing EU/ESA opportunities are linked instead of creating
another funding opportunity. Distinct national co-funding calls remain distinct.

One uncertain previous call can enter the separate pending queue within the existing
strict limit. Widespread continuity failures block replacement. Missing pages never
prove closure. Fresh supported closure moves a prior opportunity to historical funding.
Answer-time deadline filtering continues to exclude expired calls between collections.

Limits
Discovery is bounded and coverage remains partial. Public websites differ in language,
pagination, JavaScript rendering, access restrictions and document availability.
Regional and defence/downstream programmes are not comprehensively enumerated.
Rolling programmes without a confirmed cutoff are retained for review, not given an
invented deadline. A programme's legal duration is not an application deadline.
Company suggestions show technical overlap only; nationality, consortium requirements,
recipient type, national approval and other eligibility conditions require confirmation.

Archive
C:/Users/angel/OneDrive/Desktop/knowledge/04_FUNDING/National-Funding/<Country>/
  Collection-Runs/<run>: unchanged raw pages/PDFs, text derivatives and checkpoints.
  Browser-Checks/<run>: original responses and separately identified rendered pages.
Shared run manifests, Excel, rejected candidates and validation reports remain under
the archive's funding data folder. No source evidence is modified or deleted.

Operation
Use the existing shared 01_Daily-Update/update.cjs --manual controller.
Use --manual --resume for an interrupted controller; retain checkpoints.
Scheduling, external publication and automatic retention deletion remain disabled.
The prepared publication package is local and is not proof of GitHub publication.
