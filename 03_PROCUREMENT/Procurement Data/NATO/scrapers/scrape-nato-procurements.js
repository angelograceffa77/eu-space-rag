const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");

// ============================================================
// NATO PROCUREMENT COLLECTOR — V1.3
//
// OUTPUT:
// Default output: ../generated (or PROCUREMENT_OUTPUT_DIR)
//
// NATO-SPECIFIC METHODOLOGY
// 1) NATO central Procurement Opportunities portal:
//    official open opportunities from NATO HQ, ACT, ACO, NSPA and NCIA.
//    Uses the portal's official "Export all" CSV endpoint.
// 2) NCIA procurement bulletin:
//    current procurement opportunities; below €80k may remain Neo-only.
// 3) NATO ACT contracting page:
//    current + archived procurement notices.
// 4) NATO JALLC business-opportunities page:
//    current + past solicitations.
// 5) Internet Archive snapshots of ACT contracting page, 2020-present,
//    to strengthen historical coverage where old archived entries disappear.
//
// IMPORTANT
// - NATO/NCIA/ACT as buyer names are NOT space evidence.
// - Generic defence/cyber/C2 procurements are NOT automatically space.
// - Space relevance requires material satellite/space/PNT/EO/SATCOM evidence.
// - Checkpoints are stored under _NATO_CACHE/<run-date>/.
// - CSV outputs are chunked before 90 MB for GitHub compatibility.
// ============================================================

const OUTPUT_DIR = path.resolve(process.env.PROCUREMENT_OUTPUT_DIR || path.join(__dirname, "../generated"));

const TODAY = new Date().toISOString().slice(0, 10);
const CACHE_DIR = path.join(OUTPUT_DIR, "_NATO_CACHE", TODAY);

const NATO_CENTRAL_PAGE =
  "https://www.nato.int/en/work-with-us/business-and-project-opportunities/procurement-opportunities";

const NATO_CENTRAL_EXPORT =
  "https://www.nato.int/content/nato/en/work-with-us/business-and-project-opportunities/procurement-opportunities/jcr:content/root/container/procurement-listing.export.csv?sortBy=projectTitle&sortOrder=asc&page=1&pageSize=10";

const NCIA_CHECKS = [];

const NCIA_CURRENT =
  "https://www.ncia.nato.int/business/procurement/current-opportunities";

const NCIA_FUTURE =
  "https://www.ncia.nato.int/business/procurement/future-opportunities";

const NCIA_AWARDS =
  "https://www.ncia.nato.int/business/procurement/contract-awards";

const ACT_CONTRACTING =
  "https://www.act.nato.int/opportunities/contracting/";

const JALLC_OPPORTUNITIES =
  "https://www.jallc.nato.int/organization/business-opportunities";

const WAYBACK_CDX =
  "https://web.archive.org/cdx/search/cdx";

const START_YEAR = 2020;
const END_YEAR = new Date().getFullYear();

const REQUEST_PAUSE_MS = 900;
const RETRY_START_MS = 10000;
const RETRY_MAX_MS = 120000;
const CSV_MAX_BYTES = 90 * 1024 * 1024;

const FORCE_REFRESH =
  String(process.env.NATO_FORCE_REFRESH || "").trim() === "1";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154 Safari/537.36 " +
  "NATO-Procurement-Collector/1.0";


// Verified space-relevant ACT procurement records extracted from the official
// NATO ACT Contracting page when direct automated access is blocked locally.
// These records are static historical evidence, not a substitute for the
// live NATO central portal. They are refreshed only when this collector is revised.
const VERIFIED_ACT_SPACE_HISTORY = [
  {
    reference: "RFP ACT SACT 20-115",
    title: "Industry input to NATO's fictional operational scenario requiring a commercial satellite communications solution",
    description: "Request for Information (RFI) Call for Industry input to NATO's fictional operational scenario requiring a commercial satellite communications solution.",
    year: 2020,
    deadline: "2021-01-31",
    status: "CLOSED"
  },
  {
    reference: "RFP ACT SACT 20-114",
    title: "Legal Aspects of Space - NATO Legal Gazette Issue 42",
    description: "Request for Information (RFI) Call for Industry and Academia collaboration regarding abstracts and submissions for the NATO Legal Gazette Issue 42, Legal Aspects of Space.",
    year: 2020,
    deadline: "2021-01-15",
    status: "CLOSED"
  },
  {
    reference: "RFI ACT SACT 20-30",
    title: "High Throughput Satellite Development Experiment 2020 (HTS DevEx 20)",
    description: "Request for Information Call for Industry input to NATO's High Throughput Satellite Development Experiment 2020. The page marks the activity as cancelled.",
    year: 2020,
    deadline: "",
    status: "CLOSED"
  },
  {
    reference: "IFIB-ACT-SACT-21-01",
    title: "Innovation Branch Space Studies",
    description: "Space Technologies Horizon Scan Study awarded to Airbus Defence and Space GmbH ($128,490) and Small Satellites in Military Space Operation Study awarded to Space Tec Partners ($127,700).",
    year: 2021,
    deadline: "",
    status: "AWARDED",
    award_company: "Airbus Defence and Space GmbH | Space Tec Partners",
    award_value: "128490 | 127700",
    currency: "USD"
  },
  {
    reference: "IFIB-ACT-SACT-23-01-PART-A-SPACE",
    title: "NATO Space Domain doctrinal, capability, implementation, education and training support",
    description: "Part A labour categories 10-14 included contractor support to NATO Space Domain Doctrinal Development, Capability Development, Implementation, Education and Training. Awards included Brevco Services S.C.S., LA International Computer Consultants Ltd, and Booz Allen Hamilton Inc.",
    year: 2023,
    deadline: "",
    status: "AWARDED",
    award_company: "Brevco Services S.C.S. | LA International Computer Consultants Ltd | Booz Allen Hamilton Inc.",
    award_value: "752724 | 1258875 | 1271649 | 1012312.50 | 1525614",
    currency: "USD"
  },
  {
    reference: "RFI ACT SACT 24-12",
    title: "NATO Space Domain Capability",
    description: "Request for Information for Industry and Academia input to NATO's Space Domain Capability.",
    year: 2024,
    deadline: "2024-05-15",
    status: "CLOSED"
  },
  {
    reference: "RFI ACT SACT 25-80",
    title: "NextGen SATCOM CPP Development",
    description: "Request for Information for NextGen SATCOM CPP Development.",
    year: 2025,
    deadline: "2025-09-29",
    status: "CLOSED"
  },
  {
    reference: "RFP ACT SACT 25-50",
    title: "Enhancing NATO's Space-Based Surveillance: Smart Indicators and Warning Broad Area Detection and Maritime Domain Awareness",
    description: "Request for Proposals for Enhancing NATO's Space-Based Surveillance: Smart Indicators and Warning Broad Area Detection and Maritime Domain Awareness. Awarded to Planet Labs Germany GmbH.",
    year: 2025,
    deadline: "2025-05-30",
    status: "AWARDED",
    award_company: "Planet Labs Germany GmbH",
    award_value: "10796840.27",
    currency: "USD"
  },
  {
    reference: "IFIB ACT SACT 25-45",
    title: "Improving NATO's Strategic Space Posture",
    description: "Invitation for International Bidding for contractor support to improve NATO's Strategic Space Posture. Awarded to Novaspace GmbH.",
    year: 2025,
    deadline: "2025-09-12",
    status: "AWARDED",
    award_company: "Novaspace GmbH",
    award_value: "1330000",
    currency: "USD"
  },
  {
    reference: "NOI ACT SACT 25-45",
    title: "Notification of Intent - Improving NATO's Strategic Space Posture",
    description: "Notification of Intent to issue an IFIB for contractor support to improve NATO's Strategic Space Posture.",
    year: 2025,
    publicationDate: "2025-06-10",
    deadline: "2025-07-22",
    status: "CLOSED"
  },
  {
    reference: "RFI ACT SACT 25-43",
    title: "Next Generation SATCOM Services",
    description: "Request for Information for Next Generation SATCOM Services.",
    year: 2025,
    deadline: "2025-06-30",
    status: "CLOSED"
  }
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
  return String(v).replace(/\s+/g, " ").trim();
}

function uniq(values) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function parseDate(v) {
  const s = clean(v);
  if (!s || s === "—" || s === "-") return null;

  let t = Date.parse(s);
  if (Number.isFinite(t)) return new Date(t);

  let m = s.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](20\d{2})\b/);
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
        headers: {
          "User-Agent": USER_AGENT,
          "Accept-Language": "en"
        },
        maxRedirects: 10
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


async function requestViaJina(url, label = url) {
  const readerUrl =
    "https://r.jina.ai/" + url;

  return requestText(
    readerUrl,
    `${label} via Jina Reader`
  );
}

function markdownToPlainText(md) {
  return clean(
    String(md || "")
      .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[*_#>`~-]+/g, " ")
      .replace(/\|/g, " ")
  );
}

// ------------------------------------------------------------
// CSV parsing
// ------------------------------------------------------------

function parseCsv(text) {
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
      continue;
    }

    if (ch === "," && !quoted) {
      row.push(field);
      field = "";
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some(x => clean(x))) rows.push(row);
      row = [];
      continue;
    }

    field += ch;
  }

  if (field || row.length) {
    row.push(field);
    if (row.some(x => clean(x))) rows.push(row);
  }

  if (!rows.length) return [];

  const headers = rows[0].map(x => clean(x));

  return rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = clean(r[i] || "");
    });
    return obj;
  });
}

// ------------------------------------------------------------
// SPACE / DEFENCE-SPACE RELEVANCE
// ------------------------------------------------------------

const CORE_SPACE = [
  "satellite", "satellites", "satcom", "milsatcom",
  "governmental satellite communications", "satellite communications",
  "satellite communication", "satellite terminal", "satellite terminals",
  "satellite ground station", "ground segment",
  "space domain awareness", "space situational awareness",
  "space surveillance", "space tracking", "space traffic management",
  "space debris", "space weather", "space-based", "space based",
  "spacecraft", "orbital", "orbit", "launch service", "launch vehicle",
  "hosted payload", "satellite payload", "space payload",
  "low earth orbit", "geostationary", "geosynchronous"
];

const PNT_EO = [
  "gnss", "gps", "galileo", "egnos", "pnt",
  "positioning navigation timing", "satellite navigation",
  "earth observation", "remote sensing", "satellite imagery",
  "satellite image", "satellite data", "synthetic aperture radar",
  "copernicus"
];

const DEFENCE_SPACE_CONTEXT = [
  "missile warning", "integrated air and missile defence",
  "beyond line of sight", "b-los", "blos",
  "strategic communications", "tactical communications",
  "joint intelligence surveillance reconnaissance", "jisr",
  "intelligence surveillance reconnaissance", "isr",
  "multi-domain", "multi domain"
];

const GENERIC_DEFENCE = [
  "defence", "defense", "military", "nato",
  "command and control", "c2", "cyber", "cloud",
  "air command", "joint operations", "mission system"
];

const CORPORATE = [
  "catering", "cleaning", "furniture", "travel",
  "leadership development", "e-invoicing", "invoice",
  "occupational health", "human resources", "recruitment",
  "training services", "office supplies", "monitor room",
  "projector", "hard drive", "server", "software license",
  "wireless lan", "wlan", "network switch"
];

function wholeWord(text, term) {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, "i")
    .test(text);
}

function classify(text) {
  const t = clean(text).toLowerCase();

  // Prevent "airspace" from becoming "space".
  const core = CORE_SPACE.filter(x => t.includes(x));
  const pnt = PNT_EO.filter(x => t.includes(x));
  const context = DEFENCE_SPACE_CONTEXT.filter(x => t.includes(x));
  const generic = GENERIC_DEFENCE.filter(x => t.includes(x));
  const corp = CORPORATE.filter(x => t.includes(x));

  const standaloneSpace =
    wholeWord(t, "space") &&
    !t.includes("airspace") &&
    /(satellite|orbital|domain awareness|situational awareness|payload|launch|spacecraft)/i.test(t);

  if (standaloneSpace) core.push("space");

  if (core.length || pnt.length) {
    return {
      decision: "AUTO_KEEP",
      classification: generic.length
        ? "DEFENCE-SPACE / DUAL-USE"
        : "CORE SPACE",
      domain: detectDomain(t),
      confidence: "HIGH",
      evidence: uniq([...core, ...pnt]).join(" | ")
    };
  }

  if (context.length) {
    return {
      decision: "MANUAL_REVIEW",
      classification: "POSSIBLE DEFENCE-SPACE / DUAL-USE",
      domain: detectDomain(t),
      confidence: "MEDIUM",
      evidence: context.join(" | ")
    };
  }

  return {
    decision: "AUTO_EXCLUDE",
    classification: corp.length
      ? "CORPORATE / NON-SPACE"
      : "NON-SPACE / GENERIC DEFENCE",
    domain: "",
    confidence: "LOW",
    evidence: corp.join(" | ")
  };
}

function detectDomain(t) {
  if (/(satcom|satellite communication|satellite terminal|milsatcom)/.test(t)) return "SATCOM";
  if (/(gnss|gps|galileo|egnos|\bpnt\b|satellite navigation)/.test(t)) return "GNSS / PNT";
  if (/(earth observation|remote sensing|satellite imagery|copernicus|synthetic aperture radar)/.test(t)) return "Earth Observation / SAR";
  if (/(space domain awareness|space situational awareness|space surveillance|space tracking|space debris)/.test(t)) return "SDA / SSA / SST";
  if (/(launch vehicle|launch service|space launch)/.test(t)) return "Launch / Transportation";
  if (/(ground segment|ground station)/.test(t)) return "Ground Segment";
  if (/(spacecraft|satellite payload|space payload|hosted payload|orbital|orbit)/.test(t)) return "Spacecraft / Payload";
  if (/(missile warning)/.test(t)) return "Missile Warning / Space Sensors";
  return "Other Defence-Space";
}

function buildRagText(r) {
  return [
    `Authority: ${r.authority}`,
    `Source: ${r.sourceType}`,
    `Reference: ${r.reference}`,
    `Title: ${r.title}`,
    `Description: ${r.description}`,
    `Opportunity type: ${r.opportunityType}`,
    `Publication/release date: ${r.publicationDate}`,
    `Solicitation release: ${r.solicitationRelease}`,
    `Deadline: ${r.deadline}`,
    `Planned award: ${r.plannedAward}`,
    `Status: ${r.status}`,
    `Stage: ${r.stage}`,
    `Estimated value: ${r.estimatedValue} ${r.currency}`.trim(),
    `Space classification: ${r.spaceClassification}`,
    `Space domain: ${r.spaceDomain}`,
    `Relevance decision: ${r.relevanceDecision}`,
    `Relevance evidence: ${r.relevanceEvidence}`,
    `Source URL: ${r.sourceURL}`
  ].filter(Boolean).join("\n");
}

function makeRow(base) {
  const cls = classify(
    `${base.title || ""} ${base.description || ""} ${base.reference || ""}`
  );

  const row = {
    sourceType: base.sourceType || "",
    sourceAuthority: base.sourceAuthority || "",
    authority: base.authority || "",
    reference: base.reference || "",
    title: base.title || "",
    description: base.description || "",
    opportunityType: base.opportunityType || "",
    publicationDate: base.publicationDate || "",
    solicitationRelease: base.solicitationRelease || "",
    deadline: base.deadline || "",
    plannedAward: base.plannedAward || "",
    status: base.status || "",
    openNow: base.openNow || "NO",
    stage: base.stage || "",
    estimatedValue: base.estimatedValue || "",
    currency: base.currency || "",
    sourceURL: base.sourceURL || "",
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
// NATO CENTRAL PORTAL - OFFICIAL EXPORT ALL
// ------------------------------------------------------------

function fieldByNames(obj, names) {
  const keys = Object.keys(obj);
  for (const name of names) {
    const found = keys.find(k =>
      clean(k).toLowerCase() === name.toLowerCase()
    );
    if (found) return clean(obj[found]);
  }
  return "";
}

function centralDate(value) {
  const m = clean(value).match(/^(\d{1,2})\/([A-Za-z]{3}|\d{1,2})\/(\d{4})$/);
  if (!m) return /^\d{4}-\d{2}-\d{2}$/.test(clean(value)) ? clean(value) : "";
  const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const month = /^\d+$/.test(m[2]) ? Number(m[2]) : months.indexOf(m[2].toLowerCase()) + 1;
  if (month < 1 || month > 12) return "";
  const result = m[3] + '-' + String(month).padStart(2,'0') + '-' + m[1].padStart(2,'0');
  return new Date(result).toISOString().slice(0,10) === result ? result : "";
}

async function collectNatoCentral() {
  console.log("\n=== NATO central procurement portal ===");

  const cache = "nato-central-export.csv";
  let text = readCache(cache);

  if (text === null) {
    text = await requestText(
      NATO_CENTRAL_EXPORT,
      "NATO central procurement export"
    );
    saveCache(cache, text);
  } else {
    console.log("NATO central export: checkpoint");
  }

  const records = parseCsv(text);
  const rows = [];

  for (const x of records) {
    const title = fieldByNames(x, [
      "Opportunity Title",
      "Title",
      "Project Title"
    ]);

    const authority = fieldByNames(x, [
      "Originator",
      "Entity",
      "Authority"
    ]);

    const type = fieldByNames(x, [
      "Opportunity Type",
      "Type"
    ]);

    const reference = fieldByNames(x, [
      "Reference",
      "Reference Number"
    ]);

    const release = fieldByNames(x, [
      "Notification of Procurement Opportunity",
      "Opportunity Release",
      "Release Date",
      "NOPO"
    ]);

    const solicitation = fieldByNames(x, [
      "Planned Solicitation Release",
      "Solicitation Release"
    ]);

    const closing = fieldByNames(x, [
      "Planned Solicitation Closing",
      "Planned Closing Date",
      "Closing Date",
      "Solicitation Closing"
    ]);

    const award = fieldByNames(x, [
      "Planned Contract Award",
      "Contract Award"
    ]);

    const value = fieldByNames(x, [
      "Estimated Value",
      "Value"
    ]);

    const url = fieldByNames(x, [
      "URL",
      "Link",
      "Opportunity URL",
      "Website"
    ]) || NATO_CENTRAL_PAGE;

    if (!title && !reference) continue;

    const deadline = centralDate(closing);
    const open = Boolean(deadline && isFuture(deadline));

    rows.push(
      makeRow({
        sourceType: "NATO Central Procurement Portal",
        sourceAuthority: "NATO",
        authority: authority || "NATO",
        reference,
        title,
        description: "",
        opportunityType: type,
        publicationDate: centralDate(release),
        solicitationRelease: centralDate(solicitation),
        deadline,
        plannedAward: centralDate(award),
        status: deadline ? (open ? "OPEN" : "CLOSED") : "UNKNOWN",
        openNow: open ? "YES" : "NO",
        stage: "Open Opportunity",
        estimatedValue: value,
        currency: fieldByNames(x, ["Currency"]),
        sourceURL: url,
        sourceRecordId: reference || title,
        sourceDataProvenance:
          "Official NATO Procurement Opportunities portal export"
      })
    );
  }

  console.log(`NATO central rows: ${rows.length}`);
  return rows;
}

// ------------------------------------------------------------
// NCIA CURRENT / FUTURE / AWARDS
// ------------------------------------------------------------

function parseHtmlTables(html, sourceType, authority, sourceUrl, stageHint) {
  const $ = cheerio.load(html);
  const rows = [];

  $("table").each((_, table) => {
    const headers =
      $(table)
        .find("tr")
        .first()
        .find("th,td")
        .map((__, el) => clean($(el).text()))
        .get();

    $(table).find("tr").slice(1).each((__, tr) => {
      const cells =
        $(tr)
          .find("td")
          .map((___, el) => clean($(el).text()))
          .get();

      if (!cells.length) return;

      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = cells[i] || "";
      });

      const title =
        fieldByNames(obj, [
          "Opportunity Title",
          "Title"
        ]);

      const reference =
        fieldByNames(obj, [
          "Reference",
          "Reference Number"
        ]);

      if (!title && !reference) return;

      const type =
        fieldByNames(obj, [
          "Opportunity Type",
          "Method",
          "Type"
        ]);

      const value =
        fieldByNames(obj, [
          "Estimated Value",
          "Value"
        ]);

      const release =
        fieldByNames(obj, [
          "Opportunity Release",
          "NOI/RFI/RFQ Release"
        ]);

      const solicitation =
        fieldByNames(obj, [
          "Planned Solicitation Release"
        ]);

      const closing =
        fieldByNames(obj, [
          "Planned Closing Date",
          "Planned Solicitation Closing",
          "Closing Date"
        ]);

      const award =
        fieldByNames(obj, [
          "Planned Contract Award",
          "Contract Award"
        ]);

      const deadline = iso(closing);

      let status = stageHint === "Future" ? "PLANNED" :
        deadline && isFuture(deadline) ? "OPEN" :
        deadline ? "CLOSED" : "UNKNOWN";

      const link =
        $(tr).find("a[href]").first().attr("href") || "";

      rows.push(
        makeRow({
          sourceType,
          sourceAuthority: authority,
          authority,
          reference,
          title,
          description: clean($(tr).text()),
          opportunityType: type,
          publicationDate: iso(release),
          solicitationRelease: iso(solicitation),
          deadline,
          plannedAward: iso(award),
          status,
          openNow: status === "OPEN" ? "YES" : "NO",
          stage: stageHint || "Opportunity",
          estimatedValue: value,
          currency: "EUR",
          sourceURL:
            link.startsWith("http")
              ? link
              : link
              ? new URL(link, sourceUrl).href
              : sourceUrl,
          sourceRecordId: reference || title,
          sourceDataProvenance: `Official ${authority} procurement page`
        })
      );
    });
  });

  return rows;
}

async function collectPageWithTables(url, cache, sourceType, authority, stage) {
  let html = readCache(cache);

  if (html === null) {
    try {
      html = await requestText(url, sourceType);
      saveCache(cache, html);
    } catch (err) {
      NCIA_CHECKS.push({source:sourceType,state:"blocked",error:err.message,url});
      console.error(`${sourceType} skipped: ${err.message}`);
      return [];
    }
  } else {
    console.log(`${sourceType}: checkpoint`);
  }

  const rows = parseHtmlTables(
    html,
    sourceType,
    authority,
    url,
    stage
  );

  NCIA_CHECKS.push({source:sourceType,state:"partial",rows:rows.length,url,error:"Table parsed; pagination and primary details unverified"});
  console.log(`${sourceType}: ${rows.length} table rows`);
  return rows;
}

async function collectNcia() {
  console.log("\n=== NCIA procurement ===");

  const current = await collectPageWithTables(
    NCIA_CURRENT,
    "ncia-current.html",
    "NCIA Current Opportunities",
    "NATO Communications and Information Agency (NCIA)",
    "Current Opportunity"
  );

  const future = await collectPageWithTables(
    NCIA_FUTURE,
    "ncia-future.html",
    "NCIA Future Opportunities",
    "NATO Communications and Information Agency (NCIA)",
    "Future"
  );

  const awards = await collectPageWithTables(
    NCIA_AWARDS,
    "ncia-awards.html",
    "NCIA Contract Awards",
    "NATO Communications and Information Agency (NCIA)",
    "Award"
  );

  return [...current, ...future, ...awards];
}

// ------------------------------------------------------------
// ACT CONTRACTING PAGE
// ------------------------------------------------------------

function extractRefs(text) {
  const patterns = [
    /\b(?:NOPO|RFP|RFQ|IFIP|IFIB|RFIP|RFI|NOI)\s+ACT\s+(?:SACT|JFTC)\s+\d{2}[-\/]\d{1,3}[A-Z]?\b/gi,
    /\b(?:NOPO|RFP|RFQ|IFIP|IFIB|RFIP|RFI|NOI)-ACT-(?:SACT|JFTC)-\d{2}-\d{1,3}[A-Z]?\b/gi,
    /\b(?:NOPO|RFP|RFQ)-\d{4}-JALLC-\d{3}\b/gi
  ];

  const out = [];
  for (const p of patterns) {
    for (const m of text.matchAll(p)) out.push(clean(m[0]));
  }
  return uniq(out);
}

function referenceYear(ref) {
  const m = clean(ref).match(/\b(20\d{2}|\d{2})\b/);
  if (!m) return 0;
  let y = Number(m[1]);
  if (y < 100) y += 2000;
  return y;
}

function extractNearbyBlock(text, ref, max = 2500) {
  const idx = text.toLowerCase().indexOf(ref.toLowerCase());
  if (idx < 0) return ref;
  return clean(text.slice(idx, idx + max));
}

function deadlineFromBlock(block) {
  const candidates = [
    /Bid closing date\s*:\s*(.+?)(?:Click here|Anticipated|$)/i,
    /closing date\s*:\s*([0-9]{1,2}\s+[A-Za-z]+\s+20\d{2})/i,
    /deadline for submission\s*:\s*(.+?)(?:Click here|$)/i
  ];

  for (const p of candidates) {
    const m = block.match(p);
    if (m) {
      const d = parseDate(m[1]);
      if (d) return d.toISOString();
    }
  }

  const dateMatches =
    [...block.matchAll(/\b\d{1,2}\s+[A-Za-z]+\s+20\d{2}\b/g)]
      .map(m => parseDate(m[0]))
      .filter(Boolean)
      .sort((a,b) => a - b);

  return dateMatches.length
    ? dateMatches[dateMatches.length - 1].toISOString()
    : "";
}

function titleFromActBlock(block, ref) {
  let s = clean(block)
    .replace(new RegExp(
      "^" + ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*",
      "i"
    ), "");

  s = s.replace(
    /^(Notification of Procurement Opportunity|Request for Proposal|Request for Quotation|Request for Information|Invitation for International Proposal)\s*/i,
    ""
  );

  return clean(
    (s.match(/(.+?)(?:Issue date|Bid closing date|Period of Performance|Type of Contract|Click here)/i) || [])[1] || s
  ).slice(0, 800);
}

async function collectAct() {
  const result = await require("../act-refresh.cjs").run(module.exports);
  NCIA_CHECKS.push(...result.currentSourceChecks);
  return result.records;
}

// ------------------------------------------------------------
// JALLC CURRENT + PAST
// ------------------------------------------------------------

async function collectJallc() {
  console.log("\n=== NATO JALLC procurement ===");

  let html = readCache("jallc.html");

  let sourceFormat = "html";

  if (html === null) {
    const jinaCached = readCache("jallc-jina.md");

    if (jinaCached !== null) {
      html = jinaCached;
      sourceFormat = "markdown";
      console.log("JALLC reader fallback: checkpoint");
    }
  }

  if (html === null) {
    try {
      html = await requestText(JALLC_OPPORTUNITIES, "JALLC procurement");
      saveCache("jallc.html", html);
    } catch (err) {
      if (err.status === 403) {
        console.log(
          "JALLC procurement returned HTTP 403. Trying a text-reader fallback for the same official JALLC page."
        );

        try {
          html = await requestViaJina(
            JALLC_OPPORTUNITIES,
            "JALLC procurement"
          );
          sourceFormat = "markdown";
          saveCache("jallc-jina.md", html);
        } catch (fallbackErr) {
          console.log(
            `JALLC fallback unavailable: ${fallbackErr.message}. Skipping JALLC.`
          );
          return [];
        }
      } else {
        throw err;
      }
    }
  } else if (sourceFormat === "html") {
    console.log("JALLC: checkpoint");
  }

  const text =
    sourceFormat === "markdown"
      ? markdownToPlainText(html)
      : clean(cheerio.load(html)("body").text());
  const refs =
    uniq([
      ...extractRefs(text),
      ...[...text.matchAll(/\b(?:RFP|RFQ)[-\s]?(?:20\d{2})[-\s]JALLC[-\s]\d{3}\b/gi)]
        .map(m => clean(m[0]))
    ]);

  const rows = [];

  for (const ref of refs) {
    const year = referenceYear(ref);
    if (year && year < START_YEAR) continue;

    const block = extractNearbyBlock(text, ref, 1800);
    const deadline = deadlineFromBlock(block);
    const status =
      deadline
        ? (isFuture(deadline) ? "OPEN" : "CLOSED")
        : /Past Solicitations/i.test(text)
        ? "CLOSED"
        : "UNKNOWN";

    rows.push(
      makeRow({
        sourceType: "NATO JALLC Business Opportunities",
        sourceAuthority: "NATO Joint Analysis and Lessons Learned Centre",
        authority: "NATO JALLC",
        reference: ref,
        title: titleFromActBlock(block, ref),
        description: block,
        opportunityType: clean(ref).split(/[-\s]/)[0],
        publicationDate: "",
        solicitationRelease: "",
        deadline,
        plannedAward: "",
        status,
        openNow: status === "OPEN" ? "YES" : "NO",
        stage: status === "CLOSED" ? "Historical / Past Solicitation" : "Current Solicitation",
        estimatedValue: "",
        currency: "",
        sourceURL: JALLC_OPPORTUNITIES,
        sourceRecordId: ref,
        sourceDataProvenance: "Official NATO JALLC procurement page"
      })
    );
  }

  console.log(`JALLC procurement rows: ${rows.length}`);
  return rows;
}

// ------------------------------------------------------------
// WAYBACK ACT HISTORICAL RECONSTRUCTION
// ------------------------------------------------------------

async function collectWaybackIndex() {
  const cache = "act-wayback-index.json";
  const cached = readCache(cache);

  if (cached !== null) {
    try {
      const data = JSON.parse(cached);
      if (Array.isArray(data) && data.length > 1) {
        console.log(
          `ACT Wayback index: checkpoint (${data.length - 1} snapshots)`
        );
        return data;
      }
    } catch {}
  }

  const params = new URLSearchParams({
    url: ACT_CONTRACTING,
    from: String(START_YEAR),
    to: String(END_YEAR),
    output: "json",
    fl: "timestamp,original,statuscode,mimetype,digest",
    filter: "statuscode:200",
    collapse: "digest"
  });

  const url = `${WAYBACK_CDX}?${params.toString()}`;

  try {
    const raw = await requestText(url, "ACT Wayback CDX");
    const trimmed = raw.trim();

    let data;

    if (trimmed.startsWith("[")) {
      data = JSON.parse(trimmed);
    } else {
      data = parseCsv(trimmed);
      // convert object rows into expected array shape when CSV
      if (data.length) {
        const headers = Object.keys(data[0]);
        data = [
          headers,
          ...data.map(x => headers.map(h => x[h]))
        ];
      } else {
        data = [];
      }
    }

    if (Array.isArray(data) && data.length > 1) {
      saveCache(cache, JSON.stringify(data, null, 2));
      return data;
    }
  } catch (err) {
    console.error(`ACT Wayback index unavailable: ${err.message}`);
  }

  return [];
}

function selectMonthlySnapshots(cdx) {
  if (!Array.isArray(cdx) || cdx.length < 2) return [];

  const headers = cdx[0].map(clean);
  const idx = Object.fromEntries(headers.map((h,i) => [h,i]));

  if (idx.timestamp === undefined || idx.original === undefined) {
    return [];
  }

  const seen = new Set();
  const out = [];

  for (const r of cdx.slice(1)) {
    const ts = clean(r[idx.timestamp]);
    const original = clean(r[idx.original]);
    if (!ts || !original) continue;

    const month = ts.slice(0,6);
    if (seen.has(month)) continue;
    seen.add(month);

    out.push({ timestamp: ts, original });
  }

  return out;
}

async function collectActWayback() {
  console.log("\n=== ACT historical snapshots 2020-present ===");

  const cdx = await collectWaybackIndex();
  const snaps = selectMonthlySnapshots(cdx);

  console.log(`Selected ACT archive snapshots: ${snaps.length}`);

  const rows = [];

  for (let i = 0; i < snaps.length; i++) {
    const s = snaps[i];
    const cache = `act-wayback-${s.timestamp}.html`;

    let html = readCache(cache);

    if (html === null) {
      const url =
        `https://web.archive.org/web/${s.timestamp}id_/${s.original}`;

      try {
        html = await requestText(url, `ACT archive ${s.timestamp}`);
        saveCache(cache, html);
      } catch (err) {
        console.error(`Skip ACT snapshot ${s.timestamp}: ${err.message}`);
        continue;
      }

      await sleep(REQUEST_PAUSE_MS);
    }

    const $ = cheerio.load(html);
    const text = clean($("body").text());
    const refs = extractRefs(text);

    const snapshotDate =
      `${s.timestamp.slice(0,4)}-${s.timestamp.slice(4,6)}-${s.timestamp.slice(6,8)}`;

    for (const ref of refs) {
      const year = referenceYear(ref);
      if (year && year < START_YEAR) continue;

      const block = extractNearbyBlock(text, ref);
      const deadline = deadlineFromBlock(block);

      rows.push(
        makeRow({
          sourceType: "Archived NATO ACT Contracting",
          sourceAuthority: "NATO Allied Command Transformation",
          authority: "NATO Allied Command Transformation (ACT)",
          reference: ref,
          title: titleFromActBlock(block, ref),
          description: block,
          opportunityType: clean(ref).split(/\s|-/)[0],
          publicationDate: "",
          solicitationRelease: "",
          deadline,
          plannedAward: "",
          status: deadline && isFuture(deadline) ? "OPEN" : "CLOSED",
          openNow: "NO",
          stage: "Historical / Archived",
          estimatedValue: "",
          currency: "",
          sourceURL: s.original,
          sourceRecordId: `${snapshotDate}|${ref}`,
          sourceDataProvenance:
            "Official NATO ACT procurement page preserved by Internet Archive",
          archiveSeenDates: snapshotDate
        })
      );
    }

    if ((i + 1) % 12 === 0 || i + 1 === snaps.length) {
      console.log(
        `ACT archive progress ${i+1}/${snaps.length}; parsed rows ${rows.length}`
      );
    }
  }

  return rows;
}


// ------------------------------------------------------------
// VERIFIED ACT SPACE HISTORY FALLBACK
// ------------------------------------------------------------

function collectVerifiedActSpaceHistory() {
  console.log("\n=== Verified ACT space-history fallback ===");

  const rows = VERIFIED_ACT_SPACE_HISTORY.map(x => {
    const deadline = iso(x.deadline || "");
    const publicationDate = iso(
      x.publicationDate || `${x.year}-01-01`
    );

    return makeRow({
      sourceType: "Verified NATO ACT Historical Space Record",
      sourceAuthority: "NATO Allied Command Transformation",
      authority: "NATO Allied Command Transformation (ACT)",
      reference: x.reference,
      title: x.title,
      description: x.description,
      opportunityType:
        clean(x.reference).split(/\s|-/)[0],
      publicationDate,
      solicitationRelease: "",
      deadline,
      plannedAward: "",
      status: x.status || "CLOSED",
      openNow: "NO",
      stage:
        x.status === "AWARDED"
          ? "Historical / Awarded"
          : "Historical / Archived",
      estimatedValue: x.award_value || "",
      currency: x.currency || "",
      sourceURL: ACT_CONTRACTING,
      sourceRecordId: `ACT-VERIFIED-${x.year}-${x.reference}`,
      sourceDataProvenance:
        "Official NATO ACT Contracting page - verified historical space record embedded as fallback because local automated access returned HTTP 403",
      archiveSeenDates: ""
    });
  });

  // Preserve award values/companies in the description/rag text.
  for (let i = 0; i < rows.length; i++) {
    const seed = VERIFIED_ACT_SPACE_HISTORY[i];
    if (seed.award_company) {
      rows[i].description =
        `${rows[i].description} Awarded company/companies: ${seed.award_company}.`;
    }
    if (seed.award_value) {
      rows[i].description =
        `${rows[i].description} Award value(s): ${seed.award_value} ${seed.currency || ""}.`;
    }
    rows[i].ragText = buildRagText(rows[i]);
  }

  console.log(`Verified ACT space-history rows: ${rows.length}`);
  return rows;
}

// ------------------------------------------------------------
// MERGE / OUTPUT
// ------------------------------------------------------------

function normRef(v) {
  return clean(v)
    .toUpperCase()
    .replace(/[\s_]+/g, "-")
    .replace(/--+/g, "-");
}

function keyFor(r) {
  const ref = normRef(r.reference);
  if (ref) return `REF|${ref}`;
  return `TITLE|${clean(r.title).toLowerCase()}`;
}

function sourcePriority(r) {
  if (r.sourceType === "NATO Central Procurement Portal") return 50;
  if (r.sourceType === "NCIA Current Opportunities") return 45;
  if (r.sourceType === "NCIA Future Opportunities") return 44;
  if (r.sourceType === "NATO ACT Contracting") return 40;
  if (r.sourceType === "NATO JALLC Business Opportunities") return 35;
  if (r.sourceType === "NCIA Contract Awards") return 30;
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
      sourcePriority(r) > sourcePriority(cur)
        ? { ...r }
        : { ...cur };

    const secondary =
      sourcePriority(r) > sourcePriority(cur)
        ? cur
        : r;

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

    // Preserve OPEN status from a live/current source over an archived copy.
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
  "reference",
  "title",
  "description",
  "opportunityType",
  "publicationDate",
  "solicitationRelease",
  "deadline",
  "plannedAward",
  "status",
  "openNow",
  "stage",
  "estimatedValue",
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

function line(r) {
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
    const l = line(r);
    const b = Buffer.byteLength(l, "utf8");

    if (bytes + b > CSV_MAX_BYTES && bytes > Buffer.byteLength(header)) {
      flush();
    }

    content += l;
    bytes += b;
  }

  if (content !== header || !files.length) flush();
  return files;
}

function writeSources() {
  const sources = [
    [
      "NATO Central Procurement Opportunities",
      NATO_CENTRAL_PAGE,
      "Official open procurement opportunities from NATO HQ, ACT, ACO, NSPA and NCIA",
      "Current"
    ],
    [
      "NCIA Current Opportunities",
      NCIA_CURRENT,
      "NCIA current procurement bulletin; public notifications generally above EUR 80k",
      "Current"
    ],
    [
      "NCIA Future Opportunities",
      NCIA_FUTURE,
      "Forecasted/planned NCIA opportunities where publicly accessible",
      "Future"
    ],
    [
      "NCIA Contract Awards",
      NCIA_AWARDS,
      "NCIA contract-award bulletin",
      "Awards"
    ],
    [
      "NATO ACT Contracting",
      ACT_CONTRACTING,
      "ACT current and archived procurement notices",
      "Current and historical"
    ],
    [
      "NATO JALLC Business Opportunities",
      JALLC_OPPORTUNITIES,
      "JALLC current and past solicitations",
      "Current and historical"
    ],
    [
      "Internet Archive - ACT",
      ACT_CONTRACTING,
      "Historical snapshots of official ACT contracting page",
      "2020-present where snapshots exist"
    ],
    [
      "Verified ACT Space History Fallback",
      ACT_CONTRACTING,
      "Verified space-relevant historical ACT records embedded when local ACT/Wayback access is blocked",
      "2020-present, curated space-relevant subset"
    ]
  ];

  const f = path.join(
    OUTPUT_DIR,
    `NATO_Procurement_Sources_${TODAY}.csv`
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
  if (process.env.NATO_ONLY_ACT === "1") return require("../act-refresh.cjs").run(module.exports);
  if (process.env.NATO_ONLY_NCIA === "1") return require("../ncia-refresh.cjs").run(module.exports);

  console.log("==============================================");
  console.log("NATO PROCUREMENT COLLECTOR V1.3");
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log(`Checkpoint: ${CACHE_DIR}`);
  console.log(`Historical start: ${START_YEAR}`);
  console.log("==============================================");

  const central = await collectNatoCentral();
  const ncia = await collectNcia();
  const act = await collectAct();
  const jallc = await collectJallc();
  const actArchive =
    act.length
      ? []
      : await collectActWayback();

  if (act.length) {
    console.log(
      "ACT current page includes archived procurements; separate Wayback layer skipped to avoid duplicates."
    );
  }

  const verifiedActSpace =
    collectVerifiedActSpaceHistory();

  const all =
    mergeRows([
      ...central,
      ...ncia,
      ...act,
      ...jallc,
      ...actArchive,
      ...verifiedActSpace
    ])
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
    relevant
      .filter(r => r.openNow === "YES")
      .sort((a,b) => {
        const da = parseDate(a.deadline);
        const db = parseDate(b.deadline);
        return (da ? da.getTime() : Number.MAX_SAFE_INTEGER) -
               (db ? db.getTime() : Number.MAX_SAFE_INTEGER);
      });

  const planned =
    relevant.filter(
      r =>
        r.status === "PLANNED" ||
        /future|planned/i.test(r.stage)
    );

  const historical =
    relevant.filter(
      r =>
        r.openNow !== "YES" &&
        r.status !== "PLANNED"
    );

  const files = [];
  files.push(...writeCsvChunked("NATO_Procurement_All", all));
  files.push(...writeCsvChunked("NATO_Space_Procurement_RAG", ragReady));
  files.push(...writeCsvChunked("NATO_Open_Space_Procurement", open));
  files.push(...writeCsvChunked("NATO_Planned_Space_Procurement", planned));
  files.push(...writeCsvChunked("NATO_Space_Procurement_Historical", historical));
  files.push(...writeCsvChunked("NATO_Space_Manual_Review", manual));
  files.push(writeSources());
  files.push(copyCollector());

  const summary = {
    runDate: TODAY,
    historicalStart: START_YEAR,
    currentSourceChecks: NCIA_CHECKS,
    sourceCounts: {
      natoCentral: central.length,
      ncia: ncia.length,
      act: act.length,
      jallc: jallc.length,
      actArchivedBeforeDedup: actArchive.length,
      verifiedActSpaceFallback: verifiedActSpace.length
    },
    totalUniqueProcurementRecords: all.length,
    spaceRelevantIncludingManualReview: relevant.length,
    ragReadySpace: ragReady.length,
    openSpace: open.length,
    plannedSpace: planned.length,
    historicalSpace: historical.length,
    manualReview: manual.length,
    methodology: [
      "NATO central Procurement Opportunities portal export for current opportunities from NATO HQ, ACT, ACO, NSPA and NCIA",
      "NCIA current/future/award procurement bulletins",
      "Official NATO ACT contracting page",
      "Official NATO JALLC business-opportunities page",
      "Internet Archive snapshots of official ACT contracting page from 2020-present where available",
      "Verified ACT space-relevant historical fallback records embedded from the official ACT Contracting page when local HTTP 403/Wayback blocks prevent retrieval",
      "High-recall but conservative space classifier; NATO/defence terms alone are never sufficient"
    ],
    limitations: [
      "NCIA opportunities at or below EUR 80,000 may be available only in Neo and therefore may not appear on the public bulletin.",
      "NATO central portal is focused on open opportunities, so complete historical coverage across every NATO body is not guaranteed.",
      "NCIA, ACT or JALLC public pages may return HTTP 403 to local automated requests. ACT and JALLC use a text-reader fallback against the same official public page when direct retrieval is blocked; NCIA is skipped if blocked.",
      "The embedded ACT fallback is a curated space-relevant historical subset, not a complete archive of every ACT procurement.",
      "NSPA historical procurement is not fully exposed through the NATO central open-opportunities portal; further NSPA-specific integration may be needed for exhaustive historical coverage."
    ]
  };

  const summaryFile = path.join(
    OUTPUT_DIR,
    `NATO_Procurement_Summary_${TODAY}.json`
  );

  fs.writeFileSync(
    summaryFile,
    JSON.stringify(summary, null, 2),
    "utf8"
  );

  files.push(summaryFile);

  console.log("\n==============================================");
  console.log("NATO PROCUREMENT COLLECTION COMPLETE");
  console.log(`NATO central rows: ${central.length}`);
  console.log(`NCIA rows: ${ncia.length}`);
  console.log(`ACT rows: ${act.length}`);
  console.log(`JALLC rows: ${jallc.length}`);
  console.log(`ACT archived rows before dedup: ${actArchive.length}`);
  console.log(`Verified ACT space-history fallback rows: ${verifiedActSpace.length}`);
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

module.exports = { main, outputDirectory: OUTPUT_DIR, collectNatoCentral, centralDate, parseHtmlTables, parseCsv, makeRow, buildRagText };

if (require.main === module) main().catch(err => {
  console.error("\nNATO PROCUREMENT COLLECTOR FAILED");
  console.error(err.stack || err.message || err);
  process.exit(1);
});


