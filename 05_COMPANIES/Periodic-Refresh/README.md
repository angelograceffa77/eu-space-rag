# Company and discovery refresh

This extends the existing company, investment and client directories. It does not replace the procurement or funding architecture.

Run `node --use-system-ca --max-old-space-size=8192 refresh.cjs --publish` from this folder. The controller checks whether six calendar months have elapsed, refuses overlapping collection, resumes saved steps, and publishes only after validation. The Codex automation is `six-month-company-and-discovery-refresh`. This is a local workflow; the computer and Codex must be available.

The sequence is: rebuild procurement scope; collect the ESA company directory; validate and promote its snapshot; refresh ESA startup/incubator and investor discovery; collect country research leads; rebuild client/supplier matching; validate both directories; publish their current manifests, referenced parts and operating files in one isolated Git commit. No force-push or unrelated staging is used. Old published snapshots remain available. Failed or interrupted runs retain checkpoints and the last published packages.

`procurement-scope.json` derives countries and source/job entries from the current procurement registers. Source/job entries are not a count of distinct authorities. Matching geographic scope does not mean every country has equally complete company or investor coverage. Institutional routes are recorded as gaps until actual relevant profiles have been verified.

`country-discovery.json` reports searches across that scope and all 54 African UN member states. GLEIF covers registered legal entities with LEIs, not all businesses. These are research leads: ownership, sector, activity, demand and buying intent remain unverified. A name-based business area is a research hypothesis. Eritrea supplementary sources can remain unavailable; secondary-directory entries are labelled accordingly. Western Sahara is recorded separately as an unresolved territorial source scope.

Runtime state, logs, previous ESA manifests and publication receipts are in the sibling archive `knowledge/05_COMPANIES/Periodic-Refresh`. Raw country responses are in `knowledge/05_COMPANIES/Country-Discovery`. Investment and client evidence keep their existing archive folders. No automatic deletion was added by this extension.

Procurement and funding daily entry points defer while `refresh.lock` exists. A stale lock is recoverable only when its process is confirmed absent; permission errors do not prove a process is dead. A source failure is not evidence that a company has closed. Previously observed investment/client profiles remain separately labelled when not observed again.

Publication status must be read from the verified receipt, not inferred from successful collection. The initial full refresh was started on 27 October 2026; consult archive state for its live outcome.

Dependencies: install Node dependencies in 05_COMPANIES with npm ci, and Python dependencies with pip install -r Periodic-Refresh/requirements.txt. Set policy.json python to the installed Python interpreter. The existing procurement runtime is also required for capability matching and shared validation. Failed ESA inventory attempts are preserved; at most three attempts run, with original pages archived and count, duplicate-ID and first-page checks enforced.
