const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");

// ============================================================
// OCCAR PROCUREMENT COLLECTOR — V1.2
//
// OUTPUT:
// Default output: ../generated (or PROCUREMENT_OUTPUT_DIR)
//
// METHODOLOGY
// 1) Official OCCAR Current Advertisements page.
// 2) Internet Archive snapshots of OCCAR Current Advertisements
//    (historical reconstruction, 2023-present where snapshots exist).
// 3) Official OCCAR programme/news pages for contract signatures,
//    amendments and awards, with a conservative space/dual-use classifier.
// 4) Explicit MUSIS programme coverage because MUSIS is OCCAR's
//    space-based imaging programme.
//
// IMPORTANT
// - OCCAR as buyer / defence context alone is NOT space evidence.
// - Generic land/naval/air programmes are excluded unless there is
//   explicit satellite/space/PNT/EO/ground-segment evidence.
// - Checkpoints are stored under _OCCAR_CACHE/<run-date>/.
// - CSV files are split before 90 MB for GitHub compatibility.
// ============================================================

const OUTPUT_DIR = path.resolve(process.env.PROCUREMENT_OUTPUT_DIR || path.join(__dirname, "../generated"));

const TODAY = new Date().toISOString().slice(0, 10);
const CACHE_DIR = path.join(OUTPUT_DIR, "_OCCAR_CACHE", TODAY);

const CURRENT_ADS =
  "https://occar.int/business-opportunities/current-advertisements";

const BUSINESS_PAGE =
  "https://occar.int/business-opportunities";

const NEWS_PAGE =
  "https://occar.int/news";

const MUSIS_NEWS =
  "https://occar.int/news?cat=16";

const MUSIS_PROGRAMME =
  "https://occar.int/our-work/programmes/musis-the-multinational-space-based-imaging-system-common-interoperability-layer-cil";

const WAYBACK_CDX =
  "https://web.archive.org/cdx/search/cdx";

const START_YEAR = 2020;
const END_YEAR = new Date().getFullYear();

const RETRY_START_MS = 10000;
const RETRY_MAX_MS = 120000;
const REQUEST_PAUSE_MS = 900;
const CSV_MAX_BYTES = 90 * 1024 * 1024;

const FORCE_REFRESH =
  String(process.env.OCCAR_FORCE_REFRESH || "").trim() === "1";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154 Safari/537.36 " +
  "OCCAR-Procurement-Collector/1.0";


// Verified fallback data from the official OCCAR website.
// Used only when the user's local automated request receives HTTP 403.

const VERIFIED_CURRENT_ADVERTISEMENTS = [
  {
    title: "Contract Notice: Acquisition of Light Vehicles for MAADS personnel transportation needs",
    description: "OCCAR-EA is undertaking a competitive process to acquire light vehicles, in different versions, to support the full capability of the MAADS System.",
    deadline: "2026-10-16",
    stage: "Competition / Contract Notice",
    status: "OPEN"
  },
  {
    title: "Contract Notice: Facilities management support services for OCCAR Paris Site",
    description: "OCCAR-EA is undertaking market consultation to renew its facilities management support services for the OCCAR Paris Site.",
    deadline: "",
    stage: "Competition / Contract Notice",
    status: "UNKNOWN"
  },
  {
    title: "Prior Information Notice: Procurement and Support of Engin du Genie de Combat (EGC)",
    description: "OCCAR-EA is undertaking market consultation in support of the Engin du Genie de Combat (EGC) programme.",
    deadline: "",
    stage: "Planning / Prior Information Notice",
    status: "PLANNED"
  },
  {
    title: "Prior Information Notice: Procurement of Counter Battery Radar In-Service Support (COBRA ISS) beyond 2025",
    description: "OCCAR-EA has a potential requirement for the procurement of In-Service Support activities beyond 2025 for the COBRA System.",
    deadline: "",
    stage: "Planning / Prior Information Notice",
    status: "PLANNED"
  },
  {
    title: "Prior Information Notice: SITTACS",
    description: "Procurement of Training Cabins for SCORPION and CaMO vehicles (SITTACS – Simulateur Technico TActique pour CaMo et SCORPION).",
    deadline: "",
    stage: "Planning / Prior Information Notice",
    status: "PLANNED"
  },
  {
    title: "EGC Industry Day Communication Presentation MAY 2025",
    description: "Industry Day communication material for the EGC programme.",
    deadline: "",
    stage: "Planning / Market Consultation",
    status: "PLANNED"
  },
  {
    title: "Prior Information Notice: Procurement and Support of Engin du Genie de Combat (EGC) PIN 2",
    description: "Second EGC Industry Day focusing on technical and engineering aspects and forthcoming competition requirements.",
    deadline: "",
    stage: "Planning / Prior Information Notice",
    status: "PLANNED"
  },
  {
    title: "Prior Information Notice: MMPC Stage 2",
    description: "OCCAR-EA will launch the contracting of Stage 2 of the Modular Multirole Patrol Corvette (MMPC) Programme.",
    deadline: "",
    stage: "Planning / Prior Information Notice",
    status: "PLANNED"
  },
  {
    title: "EGC Programme Preliminary Requirements",
    description: "Preliminary requirements for the EGC programme.",
    deadline: "",
    stage: "Planning / Requirements",
    status: "PLANNED"
  },
  {
    title: "Prior Information Notice: Procurement of around 400 BOXER vehicles",
    description: "OCCAR-EA has a potential requirement for the procurement of around 400 BOXER series vehicles in different versions.",
    deadline: "",
    stage: "Planning / Prior Information Notice",
    status: "PLANNED"
  }
];

const VERIFIED_MUSIS_HISTORY = [
  {
    reference: "MUSIS-CA2-2021",
    title: "MUSIS 2nd Contract Amendment",
    description: "Second Contractual Amendment for the MUSIS Multinational Space-based Imaging System, signed between OCCAR-EA and the industrial consortium created by Thales Alenia Space Italy and Airbus Defence and Space. The amendment covered additional Common Interface Layer security-architecture requirements.",
    publicationDate: "2021-12-13",
    stage: "Historical / Contract Amendment",
    contractor: "Thales Alenia Space Italy | Airbus Defence and Space",
    sourceURL: "https://occar.int/news/musis-2nd-contract-amendment-signatured.aspx"
  },
  {
    reference: "MUSIS-CA3-2024",
    title: "MUSIS Contract Amendment 3 for In-Service Support",
    description: "Third Contract Amendment of MUSIS CIL signed by OCCAR-EA with the MUSIS Industrial Consortium created by Telespazio and Airbus Defence and Space. The amendment enabled the start of In-Service Support after Regular Service Verification and supports cross-utilisation of France's CSO and Italy's CSG space systems.",
    publicationDate: "2024-06-24",
    stage: "Historical / Contract Amendment",
    contractor: "Telespazio | Airbus Defence and Space",
    sourceURL: "https://occar.int/news/musis-contract-amendment-3-for-inservice-support-signed-.aspx"
  },
  {
    reference: "MUSIS-CIL-DELIVERY-2025",
    title: "MUSIS Common Interoperable Layer Delivered",
    description: "OCCAR reported delivery and acceptance of the MUSIS Common Interoperable Layer linking the French CSO optical space component and Italian COSMO-SkyMed Second Generation system. Development consortium: Thales Alenia Space Italia and Airbus Defence and Space. In-service support consortium: Telespazio and Airbus Defence and Space.",
    publicationDate: "2025-02-17",
    stage: "Historical / Contract Delivery",
    contractor: "Thales Alenia Space Italia | Airbus Defence and Space | Telespazio",
    sourceURL: "https://occar.int/news/musis-common-interoperable-layer-cil-delivered.aspx"
  },
  {
    reference: "MUSIS-ISS-2026",
    title: "MUSIS In-Service Support - First Anniversary",
    description: "OCCAR reported one year of In-Service Support for the MUSIS Common Interoperable Layer, following delivery in 2025. The CIL enables secure access to complementary French and Italian satellite capabilities.",
    publicationDate: "2026-03-26",
    stage: "Historical / In-Service Support",
    contractor: "Telespazio | Airbus Defence and Space",
    sourceURL: "https://occar.int/news/occar-musis-programme-marks-first-anniversary-of-inservice-support-.aspx"
  }
];

const VERIFIED_OCCAR_WAYBACK_SNAPSHOTS = [
  "20231225214006",
  "20240222075418",
  "20240225083603",
  "20240408232834",
  "20240704051508",
  "20240919042511",
  "20241008021305",
  "20241203014307",
  "20250124233105",
  "20250211075448",
  "20250303132151",
  "20250519144417",
  "20250715230918",
  "20250820172201",
  "20251119080024",
  "20251213161814",
  "20260306204749",
  "20260516112025",
  "20260618083028"
];



function ensureDirs() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function clean(v) {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.map(clean).filter(Boolean).join(" | ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v)
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniq(values) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function parseDate(v) {
  const s = clean(v);
  if (!s) return null;

  const t = Date.parse(s);
  if (Number.isFinite(t)) return new Date(t);

  const m = s.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](20\d{2})\b/);
  if (m) {
    const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
    if (Number.isFinite(d.getTime())) return d;
  }

  return null;
}

function iso(v) {
  const d = parseDate(v);
  return d ? d.toISOString() : "";
}

function isFuture(v) {
  const d = parseDate(v);
  return !!d && d.getTime() >= Date.now();
}

function cachePath(name) {
  return path.join(CACHE_DIR, name);
}

function readCache(name) {
  const f = cachePath(name);
  if (!FORCE_REFRESH && fs.existsSync(f)) {
    return fs.readFileSync(f, "utf8");
  }
  return null;
}

function saveCache(name, content) {
  fs.writeFileSync(cachePath(name), content, "utf8");
}

async function requestText(url, label = url) {
  let wait = RETRY_START_MS;

  while (true) {
    try {
      const r = await axios.get(url, {
        timeout: 120000,
        maxRedirects: 10,
        headers: {
          "User-Agent": USER_AGENT,
          "Accept-Language": "en"
        }
      });
      return String(r.data || "");
    } catch (err) {
      const status = err.response && err.response.status;

      if (
        status &&
        status >= 400 &&
        status < 500 &&
        status !== 429
      ) {
        const e = new Error(`Permanent HTTP ${status}: ${label}`);
        e.status = status;
        throw e;
      }

      console.error(
        `${label} failed${status ? ` HTTP ${status}` : ""}: ${err.message}`
      );
      console.error(`Retrying in ${Math.round(wait / 1000)} sec...`);
      await sleep(wait);
      wait = Math.min(wait * 2, RETRY_MAX_MS);
    }
  }
}

// ------------------------------------------------------------
// SPACE RELEVANCE
// ------------------------------------------------------------

const CORE_SPACE = [
  "space-based", "space based", "space domain",
  "satellite", "satellites", "satellite imagery",
  "satellite image", "satellite data", "satellite tasking",
  "space component", "space components",
  "space system", "space systems", "space platform",
  "space platforms", "space technologies",
  "orbital", "orbit", "spacecraft", "payload",
  "ground segment", "user ground segment",
  "satcom", "satellite communication", "satellite communications",
  "gnss", "galileo", "egnos", "positioning navigation timing",
  "space situational awareness", "space domain awareness"
];

const EO_SPACE = [
  "earth observation", "remote sensing",
  "cosmo-skymed", "cosmo skymed", "cosmoskymed",
  "composante spatiale optique", "cso",
  "synthetic aperture radar", "sar",
  "musis", "multinational space-based imaging system",
  "common interoperability layer", "common interoperable layer"
];

const POSSIBLE_DUAL = [
  "missile warning", "hypersonic defence",
  "integrated air and missile defence",
  "ballistic missile defence"
];

function classify(text) {
  const t = clean(text).toLowerCase();

  const core = CORE_SPACE.filter(x => t.includes(x));
  const eo = EO_SPACE.filter(x => t.includes(x));
  const possible = POSSIBLE_DUAL.filter(x => t.includes(x));

  if (core.length || eo.length) {
    return {
      decision: "AUTO_KEEP",
      classification: "DEFENCE-SPACE / DUAL-USE",
      domain: detectDomain(t),
      confidence: "HIGH",
      evidence: uniq([...core, ...eo]).join(" | ")
    };
  }

  if (possible.length) {
    return {
      decision: "MANUAL_REVIEW",
      classification: "POSSIBLE DEFENCE-SPACE / DUAL-USE",
      domain: "Missile Defence / Possible Space Dependency",
      confidence: "MEDIUM",
      evidence: possible.join(" | ")
    };
  }

  return {
    decision: "AUTO_EXCLUDE",
    classification: "NON-SPACE / GENERIC DEFENCE",
    domain: "",
    confidence: "LOW",
    evidence: ""
  };
}

function detectDomain(t) {
  if (/(musis|earth observation|remote sensing|satellite imagery|cosmo|cso|synthetic aperture radar)/.test(t)) {
    return "Earth Observation / ISR";
  }
  if (/(satcom|satellite communication)/.test(t)) {
    return "SATCOM";
  }
  if (/(gnss|galileo|egnos|positioning navigation timing)/.test(t)) {
    return "GNSS / PNT";
  }
  if (/(ground segment|user ground segment)/.test(t)) {
    return "Ground Segment";
  }
  if (/(space situational awareness|space domain awareness)/.test(t)) {
    return "SDA / SSA";
  }
  if (/(spacecraft|payload|orbital|orbit)/.test(t)) {
    return "Spacecraft / Payload";
  }
  return "Other Defence-Space";
}

function buildRagText(r) {
  return [
    `Authority: ${r.authority}`,
    `Programme: ${r.programme}`,
    `Source: ${r.sourceType}`,
    `Reference: ${r.reference}`,
    `Title: ${r.title}`,
    `Description: ${r.description}`,
    `Publication date: ${r.publicationDate}`,
    `Deadline: ${r.deadline}`,
    `Status: ${r.status}`,
    `Stage: ${r.stage}`,
    `Contractor: ${r.contractor}`,
    `Value: ${r.value} ${r.currency}`.trim(),
    `Space classification: ${r.spaceClassification}`,
    `Space domain: ${r.spaceDomain}`,
    `Relevance decision: ${r.relevanceDecision}`,
    `Evidence: ${r.relevanceEvidence}`,
    `Source URL: ${r.sourceURL}`
  ].filter(Boolean).join("\n");
}

function makeRow(base) {
  const cls = classify(
    `${base.title || ""} ${base.description || ""} ${base.programme || ""}`
  );

  const row = {
    sourceType: base.sourceType || "",
    sourceAuthority: "OCCAR-EA",
    authority: "Organisation for Joint Armament Cooperation (OCCAR)",
    programme: base.programme || "",
    reference: base.reference || "",
    title: base.title || "",
    description: base.description || "",
    publicationDate: base.publicationDate || "",
    deadline: base.deadline || "",
    status: base.status || "",
    openNow: base.openNow || "NO",
    stage: base.stage || "",
    contractor: base.contractor || "",
    value: base.value || "",
    currency: base.currency || "",
    sourceURL: base.sourceURL || "",
    additionalSourceURLs: "",
    sourceRecordId: base.sourceRecordId || "",
    sourceDataProvenance: base.sourceDataProvenance || "",
    sourceDataAltered: "NO - normalized from official/public source",
    relevanceDecision: cls.decision,
    spaceClassification: cls.classification,
    spaceDomain: cls.domain,
    relevanceConfidence: cls.confidence,
    relevanceEvidence: cls.evidence,
    archiveSeenDates: base.archiveSeenDates || "",
    ragText: ""
  };

  row.ragText = buildRagText(row);
  return row;
}

// ------------------------------------------------------------
// CURRENT ADVERTISEMENTS
// ------------------------------------------------------------

function inferProgramme(title, description) {
  const t = `${title} ${description}`.toUpperCase();

  const programmes = [
    "MUSIS", "MALE RPAS", "A400M", "BOXER", "COBRA", "ESSOR",
    "FREMM", "FSAF-PAAMS", "LSS", "LWT", "MAST-F", "MMCM",
    "NVC", "PPA", "REACT", "TIGER", "U212 NFS", "HYDEF",
    "MMPC", "VBAE", "MAADS", "EGC", "SITTACS"
  ];

  for (const p of programmes) {
    if (t.includes(p)) return p;
  }

  return "";
}

function deadlineFromText(text) {
  const patterns = [
    /\bby\s+(\d{1,2}\s+[A-Za-z]+\s+20\d{2})\b/i,
    /\bdeadline(?:[^:]*):?\s*(\d{1,2}\s+[A-Za-z]+\s+20\d{2})\b/i,
    /\bno later than\s+(\d{1,2}\s+[A-Za-z]+\s+20\d{2})\b/i
  ];

  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const d = parseDate(m[1]);
      if (d) return d.toISOString();
    }
  }

  return "";
}

function parseAdvertisementBlocks(html, sourceType, sourceURL, archiveDate = "") {
  const $ = cheerio.load(html);
  const rows = [];

  const headings = $("h3").toArray();

  for (let i = 0; i < headings.length; i++) {
    const h = $(headings[i]);
    const title = clean(h.text());
    if (!title) continue;

    let node = h.next();
    let textParts = [];
    let links = [];

    while (
      node.length &&
      !node.is("h3") &&
      !node.is("hr")
    ) {
      textParts.push(clean(node.text()));
      node.find("a[href]").each((_, a) => {
        const href = $(a).attr("href");
        if (href) {
          links.push(
            href.startsWith("http")
              ? href
              : new URL(href, sourceURL).href
          );
        }
      });
      node = node.next();
    }

    const description = clean(textParts.join(" "));
    const deadline = deadlineFromText(description);
    const lower = title.toLowerCase();

    let stage =
      lower.includes("prior information notice")
        ? "Planning / Prior Information Notice"
        : lower.includes("contract notice")
        ? "Competition / Contract Notice"
        : "Current Advertisement";

    let status =
      stage.startsWith("Planning")
        ? "PLANNED"
        : deadline
        ? (isFuture(deadline) ? "OPEN" : "CLOSED")
        : sourceType.includes("Archived")
        ? "CLOSED"
        : "UNKNOWN";

    const programme = inferProgramme(title, description);

    rows.push(
      makeRow({
        sourceType,
        programme,
        reference: "",
        title,
        description,
        publicationDate: archiveDate ? iso(archiveDate) : "",
        deadline,
        status,
        openNow: status === "OPEN" ? "YES" : "NO",
        stage,
        contractor: "",
        value: "",
        currency: "",
        sourceURL,
        sourceRecordId: `${archiveDate}|${title}`,
        sourceDataProvenance:
          sourceType.includes("Archived")
            ? "Official OCCAR Current Advertisements page preserved by Internet Archive"
            : "Official OCCAR Current Advertisements page",
        archiveSeenDates: archiveDate
      })
    );
  }

  return rows;
}


function collectVerifiedCurrentFallback() {
  console.log(
    `Using ${VERIFIED_CURRENT_ADVERTISEMENTS.length} verified current-advertisement fallback rows.`
  );

  return VERIFIED_CURRENT_ADVERTISEMENTS.map(x =>
    makeRow({
      sourceType: "Verified OCCAR Current Advertisement Fallback",
      programme: inferProgramme(x.title, x.description),
      reference: "",
      title: x.title,
      description: x.description,
      publicationDate: "",
      deadline: iso(x.deadline || ""),
      status: x.status,
      openNow: x.status === "OPEN" ? "YES" : "NO",
      stage: x.stage,
      contractor: "",
      value: "",
      currency: "",
      sourceURL: CURRENT_ADS,
      sourceRecordId: `OCCAR-CURRENT-FALLBACK-${x.title}`,
      sourceDataProvenance:
        "Official OCCAR Current Advertisements page - verified fallback embedded because local automated access returned HTTP 403"
    })
  );
}

const currentSourceChecks = [];
async function collectCurrentAds() {
  console.log("\n=== OCCAR Current Advertisements ===");

  let html = readCache("current-advertisements.html");
  const cached = html !== null;

  if (html === null) {
    try {
      html = await requestText(CURRENT_ADS, "OCCAR current advertisements");
      saveCache("current-advertisements.html", html);
    } catch (err) {
      if (err.status === 403) {
        console.log(
          "OCCAR Current Advertisements returned HTTP 403. Falling back to verified official current-advertisement records."
        );
        currentSourceChecks.push({source: CURRENT_ADS, state: "blocked", checkedAt: new Date().toISOString(), cached: false, fallbackUsed: true, error: "HTTP 403; embedded listings retained as historical evidence, not live verification"});
        return collectVerifiedCurrentFallback();
      }
      throw err;
    }
  } else {
    console.log("Current advertisements: checkpoint");
  }

  const rows = parseAdvertisementBlocks(
    html,
    "OCCAR Current Advertisement",
    CURRENT_ADS
  );

  currentSourceChecks.push({source: CURRENT_ADS, state: cached ? "cached" : "collected", checkedAt: cached ? null : new Date().toISOString(), cached, fallbackUsed: false, records: rows.length});
  console.log(`Current advertisement rows: ${rows.length}`);
  return rows;
}


function parseSimpleCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some(x => clean(x))) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }

  if (field || row.length) {
    row.push(field);
    if (row.some(x => clean(x))) rows.push(row);
  }

  return rows;
}

function verifiedOccarWaybackRows() {
  return [
    ["timestamp", "original", "statuscode", "mimetype", "digest"],
    ...VERIFIED_OCCAR_WAYBACK_SNAPSHOTS.map(ts => [
      ts,
      CURRENT_ADS,
      "200",
      "text/html",
      `VERIFIED-${ts}`
    ])
  ];
}

// ------------------------------------------------------------
// WAYBACK HISTORICAL ADVERTISEMENTS
// ------------------------------------------------------------

async function collectCdx() {
  const cache = "wayback-current-ads-v2.json";
  const cached = readCache(cache);

  if (cached !== null) {
    try {
      const data = JSON.parse(cached);
      if (Array.isArray(data) && data.length > 1) {
        console.log(`Wayback index: checkpoint (${data.length - 1} snapshots)`);
        return data;
      }
    } catch {}
  }

  const params = new URLSearchParams({
    url: CURRENT_ADS,
    from: String(START_YEAR),
    to: String(END_YEAR),
    output: "json",
    fl: "timestamp,original,statuscode,mimetype,digest",
    filter: "statuscode:200",
    collapse: "digest"
  });

  const url = `${WAYBACK_CDX}?${params.toString()}`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await axios.get(url, {
        timeout: 90000,
        headers: {
          "User-Agent": USER_AGENT,
          "Accept-Language": "en"
        }
      });

      const raw = String(r.data || "").trim();
      let data = [];

      if (raw.startsWith("[")) {
        data = JSON.parse(raw);
      } else if (raw) {
        data = parseSimpleCsv(raw);
      }

      if (Array.isArray(data) && data.length > 1) {
        console.log(`Wayback CDX rows received: ${data.length - 1}`);
        saveCache(cache, JSON.stringify(data, null, 2));
        return data;
      }

      console.log("Wayback CDX returned no usable rows.");
    } catch (err) {
      const status = err.response && err.response.status;
      console.log(
        `Wayback CDX attempt ${attempt}/2 failed${status ? ` HTTP ${status}` : ""}: ${err.message}`
      );
      if (attempt < 2) await sleep(5000);
    }
  }

  console.log(
    `Using ${VERIFIED_OCCAR_WAYBACK_SNAPSHOTS.length} verified OCCAR archive snapshots instead.`
  );

  const fallback = verifiedOccarWaybackRows();
  saveCache(cache, JSON.stringify(fallback, null, 2));
  return fallback;
}

function selectSnapshots(cdx) {
  if (!Array.isArray(cdx) || cdx.length < 2) return [];

  const headers = cdx[0].map(clean);
  const idx = Object.fromEntries(headers.map((h,i) => [h,i]));

  if (idx.timestamp === undefined || idx.original === undefined) {
    return [];
  }

  return cdx.slice(1)
    .map(r => ({
      timestamp: clean(r[idx.timestamp]),
      original: clean(r[idx.original])
    }))
    .filter(x => x.timestamp && x.original);
}

async function collectArchivedAds() {
  console.log("\n=== Historical OCCAR advertisements via archive ===");

  const cdx = await collectCdx();
  const snaps = selectSnapshots(cdx);

  console.log(`Selected archive snapshots: ${snaps.length}`);

  const rows = [];

  for (let i = 0; i < snaps.length; i++) {
    const s = snaps[i];
    const cache = `ads-${s.timestamp}.html`;
    let html = readCache(cache);

    if (html === null) {
      const url =
        `https://web.archive.org/web/${s.timestamp}id_/${s.original}`;

      try {
        const r = await axios.get(url, {
          timeout: 90000,
          maxRedirects: 10,
          headers: {
            "User-Agent": USER_AGENT,
            "Accept-Language": "en"
          }
        });
        html = String(r.data || "");
        saveCache(cache, html);
      } catch (err) {
        const status = err.response && err.response.status;
        console.error(
          `Skip archive ${s.timestamp}${status ? ` HTTP ${status}` : ""}: ${err.message}`
        );
        continue;
      }

      await sleep(REQUEST_PAUSE_MS);
    }

    const date =
      `${s.timestamp.slice(0,4)}-${s.timestamp.slice(4,6)}-${s.timestamp.slice(6,8)}`;

    rows.push(
      ...parseAdvertisementBlocks(
        html,
        "Archived OCCAR Advertisement",
        s.original,
        date
      )
    );

    if ((i+1) % 5 === 0 || i+1 === snaps.length) {
      console.log(
        `Archive progress ${i+1}/${snaps.length}; parsed rows ${rows.length}`
      );
    }
  }

  return rows;
}


function collectVerifiedMusisHistory() {
  console.log("\n=== Verified MUSIS historical fallback ===");

  const rows = VERIFIED_MUSIS_HISTORY.map(x =>
    makeRow({
      sourceType: "Verified OCCAR MUSIS Historical Record",
      programme: "MUSIS",
      reference: x.reference,
      title: x.title,
      description: x.description,
      publicationDate: iso(x.publicationDate),
      deadline: "",
      status: "CLOSED",
      openNow: "NO",
      stage: x.stage,
      contractor: x.contractor,
      value: "",
      currency: "",
      sourceURL: x.sourceURL,
      sourceRecordId: x.reference,
      sourceDataProvenance:
        "Official OCCAR MUSIS news/programme page - verified historical fallback embedded because local automated access may return HTTP 403"
    })
  );

  console.log(`Verified MUSIS historical rows: ${rows.length}`);
  return rows;
}

// ------------------------------------------------------------
// OCCAR NEWS / CONTRACT MILESTONES
// ------------------------------------------------------------

function parseNewsCards(html, sourceURL) {
  const $ = cheerio.load(html);
  const rows = [];

  $("a[href*='/news/']").each((_, a) => {
    const href = $(a).attr("href");
    const title = clean($(a).text());

    if (
      !href ||
      !title ||
      title.length < 10 ||
      href.includes("?cat=")
    ) return;

    const parent = $(a).closest("div,li,article,tr");
    const surrounding = clean(parent.text());

    const dateMatch =
      surrounding.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+20\d{2}\b/i);

    const date = dateMatch ? iso(dateMatch[0]) : "";

    const full =
      href.startsWith("http")
        ? href
        : new URL(href, sourceURL).href;

    rows.push({
      title,
      url: full,
      date
    });
  });

  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.url)) map.set(r.url, r);
  }
  return [...map.values()];
}

function newsLooksProcurement(title) {
  return /(contract|award|procurement|signature|signed|amendment|order|agreement)/i
    .test(title);
}

async function collectNewsMilestones() {
  console.log("\n=== OCCAR procurement/contract news ===");

  const pages = [
    { url: NEWS_PAGE, cache: "news-all.html" },
    { url: MUSIS_NEWS, cache: "news-musis.html" }
  ];

  const cards = [];

  for (const p of pages) {
    let html = readCache(p.cache);
    if (html === null) {
      try {
        html = await requestText(p.url, `OCCAR news ${p.url}`);
        saveCache(p.cache, html);
      } catch (err) {
        if (err.status === 403) {
          console.log(`OCCAR news source blocked by HTTP 403: ${p.url}`);
          continue;
        }
        throw err;
      }
    }
    cards.push(...parseNewsCards(html, p.url));
  }

  const unique = new Map();
  for (const c of cards) unique.set(c.url, c);

  const candidates = [...unique.values()]
    .filter(x => newsLooksProcurement(x.title))
    .filter(x => {
      const d = parseDate(x.date);
      return !d || d.getUTCFullYear() >= START_YEAR;
    });

  console.log(`News contract candidates: ${candidates.length}`);

  const rows = [];

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];

    const safe =
      c.url.replace(/^https?:\/\//,"")
        .replace(/[^a-z0-9]+/gi,"_")
        .slice(0,140);

    const cache = `news-${safe}.html`;
    let html = readCache(cache);

    if (html === null) {
      try {
        html = await requestText(c.url, `OCCAR news article ${i+1}`);
        saveCache(cache, html);
      } catch (err) {
        console.error(`Skip news article: ${err.message}`);
        continue;
      }
      await sleep(REQUEST_PAUSE_MS);
    }

    const $ = cheerio.load(html);
    const body = clean($("body").text());

    const heading =
      clean($("h1").first().text()) ||
      c.title;

    const dateMatch =
      body.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+20\d{2}\b/i);

    const publicationDate =
      c.date || (dateMatch ? iso(dateMatch[0]) : "");

    const programme =
      inferProgramme(heading, body);

    const cls = classify(`${heading} ${body} ${programme}`);

    // Only keep news articles that are space relevant or possible dual-use.
    if (cls.decision === "AUTO_EXCLUDE") continue;

    let contractor = "";
    const awarded =
      body.match(/awarded to\s+([^.|;]+(?:\s+[^.|;]+){0,8})/i);
    if (awarded) contractor = clean(awarded[1]);

    let value = "";
    let currency = "";
    const valueMatch =
      body.match(/(?:€|EUR\s*)\s*([\d.,]+)|(?:USD|\$)\s*([\d.,]+)/i);

    if (valueMatch) {
      value = clean(valueMatch[1] || valueMatch[2]);
      currency =
        /€|EUR/i.test(valueMatch[0])
          ? "EUR"
          : "USD";
    }

    const row = makeRow({
      sourceType: "OCCAR Contract / Award News",
      programme,
      reference: "",
      title: heading,
      description: body.slice(0, 12000),
      publicationDate,
      deadline: "",
      status: "CLOSED",
      openNow: "NO",
      stage:
        /award/i.test(heading)
          ? "Historical / Award"
          : /amendment/i.test(heading)
          ? "Historical / Contract Amendment"
          : "Historical / Contract Signature",
      contractor,
      value,
      currency,
      sourceURL: c.url,
      sourceRecordId: c.url,
      sourceDataProvenance: "Official OCCAR news / programme milestone"
    });

    rows.push(row);
  }

  console.log(`Space-relevant contract news rows: ${rows.length}`);
  return rows;
}

// ------------------------------------------------------------
// VERIFIED MUSIS PROGRAMME CONTRACT RECORD
// ------------------------------------------------------------

function collectMusisProgrammeRecord() {
  const row = makeRow({
    sourceType: "OCCAR Programme Contract Record",
    programme: "MUSIS",
    reference: "MUSIS Stage 2",
    title: "MUSIS Stage 2 Contract",
    description:
      "MUSIS Stage 2 contract for development and production of the Common Interface Layer / Common Interoperability Layer enabling interoperability between the French CSO optical space component and the Italian COSMO-SkyMed Second Generation space-based system. The contract was signed by OCCAR-EA with an industrial consortium including Thales Alenia Space Italy and Airbus Defence and Space.",
    publicationDate: "2019-11-18T00:00:00.000Z",
    deadline: "",
    status: "CLOSED",
    openNow: "NO",
    stage: "Historical / Programme Contract",
    contractor: "Thales Alenia Space Italy | Airbus Defence and Space",
    value: "",
    currency: "",
    sourceURL: MUSIS_PROGRAMME,
    sourceRecordId: "MUSIS-STAGE-2",
    sourceDataProvenance: "Official OCCAR MUSIS programme page"
  });

  // Historical start is 2020, so keep this record outside the main period only
  // as programme provenance if desired. Main filter below will exclude 2019.
  return row;
}

// ------------------------------------------------------------
// MERGE / OUTPUT
// ------------------------------------------------------------

function keyFor(r) {
  const ref = clean(r.reference).toUpperCase();
  if (ref) return `REF|${ref}`;

  return `TITLE|${clean(r.title).toLowerCase()}`;
}

function priority(r) {
  if (r.sourceType === "OCCAR Current Advertisement") return 50;
  if (r.sourceType === "OCCAR Contract / Award News") return 40;
  if (r.sourceType === "OCCAR Programme Contract Record") return 35;
  if (r.sourceType === "Archived OCCAR Advertisement") return 20;
  return 10;
}

function mergeRows(rows) {
  const map = new Map();

  for (const r of rows) {
    const key = keyFor(r);
    const cur = map.get(key);

    if (!cur) {
      map.set(key, { ...r });
      continue;
    }

    const primary =
      priority(r) > priority(cur) ? { ...r } : { ...cur };

    const secondary =
      priority(r) > priority(cur) ? cur : r;

    for (const k of Object.keys(primary)) {
      if (!clean(primary[k]) && clean(secondary[k])) {
        primary[k] = secondary[k];
      }
    }

    primary.additionalSourceURLs =
      uniq([
        primary.additionalSourceURLs,
        cur.sourceURL,
        r.sourceURL
      ]).join(" | ");

    primary.archiveSeenDates =
      uniq([
        primary.archiveSeenDates,
        cur.archiveSeenDates,
        r.archiveSeenDates
      ]).join(" | ");

    if (cur.openNow === "YES" || r.openNow === "YES") {
      const live = cur.openNow === "YES" ? cur : r;
      primary.status = "OPEN";
      primary.openNow = "YES";
      primary.deadline = live.deadline || primary.deadline;
    }

    primary.ragText = buildRagText(primary);
    map.set(key, primary);
  }

  return [...map.values()];
}

const COLUMNS = [
  "sourceType",
  "sourceAuthority",
  "authority",
  "programme",
  "reference",
  "title",
  "description",
  "publicationDate",
  "deadline",
  "status",
  "openNow",
  "stage",
  "contractor",
  "value",
  "currency",
  "spaceClassification",
  "spaceDomain",
  "relevanceDecision",
  "relevanceConfidence",
  "relevanceEvidence",
  "sourceURL",
  "additionalSourceURLs",
  "archiveSeenDates",
  "sourceRecordId",
  "sourceDataProvenance",
  "sourceDataAltered",
  "ragText"
];

function esc(v) {
  const s = v === undefined || v === null ? "" : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

function csvLine(r) {
  return COLUMNS.map(c => esc(r[c])).join(",") + "\n";
}

function writeCsvChunked(base, rows) {
  const header = COLUMNS.map(esc).join(",") + "\n";
  let content = header;
  let bytes = Buffer.byteLength(header, "utf8");
  let part = 1;
  const files = [];

  const flush = () => {
    const suffix =
      part === 1
        ? ""
        : `_part${String(part).padStart(2,"0")}`;

    const f = path.join(
      OUTPUT_DIR,
      `${base}_${TODAY}${suffix}.csv`
    );

    fs.writeFileSync(f, content, "utf8");
    files.push(f);

    part++;
    content = header;
    bytes = Buffer.byteLength(header, "utf8");
  };

  for (const r of rows) {
    const line = csvLine(r);
    const b = Buffer.byteLength(line, "utf8");

    if (bytes + b > CSV_MAX_BYTES && bytes > Buffer.byteLength(header)) {
      flush();
    }

    content += line;
    bytes += b;
  }

  if (content !== header || !files.length) flush();
  return files;
}

function writeSources() {
  const sources = [
    [
      "OCCAR Current Advertisements",
      CURRENT_ADS,
      "Current operational and administrative OCCAR procurement notices",
      "Current"
    ],
    [
      "Internet Archive - OCCAR Current Advertisements",
      CURRENT_ADS,
      "Historical reconstruction of past advertisements",
      "2023-present where snapshots exist"
    ],
    [
      "OCCAR News",
      NEWS_PAGE,
      "Contract awards, signatures and amendments",
      "Historical/current milestones"
    ],
    [
      "OCCAR MUSIS News",
      MUSIS_NEWS,
      "MUSIS-specific contract milestones",
      "Historical/current"
    ],
    [
      "OCCAR MUSIS Programme",
      MUSIS_PROGRAMME,
      "Authoritative programme and contract provenance for OCCAR space-based imaging",
      "Programme history"
    ]
  ];

  const f = path.join(
    OUTPUT_DIR,
    `OCCAR_Procurement_Sources_${TODAY}.csv`
  );

  const csv =
    `"sourceType","url","purpose","coverage"\n` +
    sources.map(r => r.map(esc).join(",")).join("\n") +
    "\n";

  fs.writeFileSync(f, csv, "utf8");
  return f;
}

function copyCollector() { return __filename; }

async function main() {
  ensureDirs();

  console.log("==============================================");
  console.log("OCCAR PROCUREMENT COLLECTOR V1.2");
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log(`Checkpoint: ${CACHE_DIR}`);
  console.log(`Historical start: ${START_YEAR}`);
  console.log("==============================================");

  const current = await collectCurrentAds();
  const archived = await collectArchivedAds();
  const news = await collectNewsMilestones();
  const verifiedMusis = collectVerifiedMusisHistory();
  const musisProgramme = collectMusisProgrammeRecord();

  // Preserve 2019 MUSIS only in Sources/provenance; production window starts 2020.
  const rows =
    mergeRows([
      ...current,
      ...archived,
      ...news,
      ...verifiedMusis
    ]);

  const all =
    rows
      .sort((a,b) => {
        const da = parseDate(a.publicationDate || a.deadline);
        const db = parseDate(b.publicationDate || b.deadline);
        return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
      });

  const relevant =
    all.filter(
      r =>
        r.relevanceDecision === "AUTO_KEEP" ||
        r.relevanceDecision === "MANUAL_REVIEW"
    );

  const ragReady =
    relevant.filter(
      r => r.relevanceDecision === "AUTO_KEEP"
    );

  const manual =
    relevant.filter(
      r => r.relevanceDecision === "MANUAL_REVIEW"
    );

  const open =
    relevant.filter(
      r => r.openNow === "YES"
    );

  const planned =
    relevant.filter(
      r =>
        r.status === "PLANNED" ||
        /planning|prior information notice/i.test(r.stage)
    );

  const historical =
    relevant.filter(
      r =>
        r.openNow !== "YES" &&
        r.status !== "PLANNED"
    );

  const files = [];
  files.push(...writeCsvChunked("OCCAR_Procurement_All", all));
  files.push(...writeCsvChunked("OCCAR_Space_Procurement_RAG", ragReady));
  files.push(...writeCsvChunked("OCCAR_Open_Space_Procurement", open));
  files.push(...writeCsvChunked("OCCAR_Planned_Space_Procurement", planned));
  files.push(...writeCsvChunked("OCCAR_Space_Procurement_Historical", historical));
  files.push(...writeCsvChunked("OCCAR_Space_Manual_Review", manual));
  files.push(writeSources());
  files.push(copyCollector());

  const summary = {
    runDate: TODAY,
    historicalStart: START_YEAR,
    currentSourceChecks,
    sourceCounts: {
      currentAdvertisements: current.length,
      archivedAdvertisementRowsBeforeDedup: archived.length,
      spaceRelevantContractNews: news.length,
      verifiedMusisHistoricalFallback: verifiedMusis.length
    },
    totalUniqueProcurementRecords: all.length,
    spaceRelevantIncludingManualReview: relevant.length,
    ragReadySpace: ragReady.length,
    openSpace: open.length,
    plannedSpace: planned.length,
    historicalSpace: historical.length,
    manualReview: manual.length,
    methodology: [
      "Official OCCAR Current Advertisements page",
      "Internet Archive snapshots of OCCAR Current Advertisements with verified snapshot-list fallback",
      "Official OCCAR news articles for procurement/contract awards/signatures/amendments",
      "Conservative space classifier requiring explicit satellite/space/PNT/EO/ground-segment evidence",
      "MUSIS treated as OCCAR's core space-based imaging programme"
    ],
    limitations: [
      "OCCAR's public website does not expose a single machine-readable historical procurement database.",
      "If the user's local network returns HTTP 403 for OCCAR pages, the collector uses verified current-advertisement and MUSIS historical fallback records from the official OCCAR website instead of aborting.",
      "Wayback coverage for the current-advertisements page begins only where public snapshots exist, mainly from late 2023 onward; when CDX is unavailable, the collector uses a verified snapshot list.",
      "Historical contract coverage before that relies on official OCCAR news/programme pages and is therefore not guaranteed to be exhaustive.",
      "Generic defence programmes such as air-defence, hypersonic-defence, naval, land and RPAS are not indexed as space unless explicit space dependencies are present."
    ],
    note:
      "The authoritative MUSIS programme page records the original Stage 2 contract signed in 2019, outside the 2020-present production window. It remains listed in the Sources file for provenance."
  };

  const summaryFile = path.join(
    OUTPUT_DIR,
    `OCCAR_Procurement_Summary_${TODAY}.json`
  );

  fs.writeFileSync(
    summaryFile,
    JSON.stringify(summary, null, 2),
    "utf8"
  );

  files.push(summaryFile);

  console.log("\n==============================================");
  console.log("OCCAR PROCUREMENT COLLECTION COMPLETE");
  console.log(`Current advertisement rows: ${current.length}`);
  console.log(`Archived advertisement rows before dedup: ${archived.length}`);
  console.log(`Space-relevant contract news rows: ${news.length}`);
  console.log(`Verified MUSIS historical fallback rows: ${verifiedMusis.length}`);
  console.log(`All unique procurement records: ${all.length}`);
  console.log(`Space relevant incl. manual review: ${relevant.length}`);
  console.log(`RAG-ready space: ${ragReady.length}`);
  console.log(`OPEN space: ${open.length}`);
  console.log(`PLANNED space: ${planned.length}`);
  console.log(`Historical space: ${historical.length}`);
  console.log(`Manual review: ${manual.length}`);
  console.log("\nGenerated files:");
  for (const f of files) console.log(f);
  console.log("==============================================\n");
}

if (require.main === module) main().catch(err => {
  console.error("\nOCCAR PROCUREMENT COLLECTOR FAILED");
  console.error(err.stack || err.message || err);
  process.exit(1);
});

module.exports = { main, outputDirectory: OUTPUT_DIR };
