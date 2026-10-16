const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");
const pdf = require("pdf-parse");

// ============================================================
// FRONTEX PROCUREMENT COLLECTOR — V1.5
// European Border and Coast Guard Agency (Frontex)
//
// OUTPUT:
// Default output: ../generated (or PROCUREMENT_OUTPUT_DIR)
//
// SOURCES
// 1) Official Frontex procurement pages.
// 2) EU Funding & Tenders public Search API, exact Frontex authority ID 47352434.
// 3) Official TED Search API for formal notices and awards, 2020-present.
// 4) Official Frontex Annual Procurement Plans (current 2025/2026 documents).
//
// SPACE / DUAL-USE SCOPE
// Copernicus Border Surveillance Service, satellite imagery/data,
// optical/radar satellite services, Earth Observation, remote sensing,
// GNSS/Galileo/PNT, SATCOM, EUROSUR Fusion Services,
// geospatial/emergency mapping and tightly contextualised ISR/data-fusion work.
//
// Generic aviation, drones, border equipment, IT and security procurement is
// excluded unless there is explicit space/EO/GNSS/SATCOM evidence or a strong
// dual-use geospatial/sensor-fusion context.
//
// Checkpoints: _FRONTEX_CACHE/<run-date>/
// ============================================================

const OUTPUT_DIR = path.resolve(process.env.PROCUREMENT_OUTPUT_DIR || path.join(__dirname, "../generated"));

const TODAY = new Date().toISOString().slice(0, 10);
const CACHE_DIR = path.join(OUTPUT_DIR, "_FRONTEX_CACHE", TODAY);

const START_YEAR = 2020;
const END_YEAR = new Date().getFullYear();
const CSV_MAX_BYTES = 90 * 1024 * 1024;
const WAIT_MS = 850;

const FORCE_REFRESH =
  String(process.env.FRONTEX_FORCE_REFRESH || "").trim() === "1";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154 Safari/537.36 " +
  "Frontex-Procurement-Collector/1.0";

const FRONTEX_LEGAL_ENTITY_ID = "47352434";

const FRONTEX_GENERAL =
  "https://www.frontex.europa.eu/about-frontex/procurement/procurement/general-information/";

const FRONTEX_OPEN_RESTRICTED =
  "https://www.frontex.europa.eu/about-frontex/procurement/procurement/open-restricted-tender-procedures/";

const FRONTEX_LOW_MIDDLE =
  "https://www.frontex.europa.eu/about-frontex/procurement/procurement/low-middle-value-negotiated-procedures/";

const FRONTEX_COPERNICUS =
  "https://www.frontex.europa.eu/what-we-do/copernicus-programme/";

const VERIFIED_PLAN_FALLBACKS = [
  {
    year: 2026,
    reference: "FRONTEX-APP-2026-008",
    originalPlanRow: "8",
    title: "Direct Contract for High Altitude Platform System (HAPS) Pilot Project",
    description:
      "Original Frontex Annual Procurement Plan row: 8. Pilot Project testing and demonstrating the surveillance and connectivity capabilities of High Altitude Platform Systems. Innovation action conducted following the Frontex HAPS research study and market research conducted in the framework of the Frontex Industry Days.",
    requestingService: "CAP/TRANSFORM/INNOVATE",
    estimatedValue: "3500000",
    currency: "EUR",
    sourceURL:
      "https://www.frontex.europa.eu/assets/Procurement/MB_Decision_33_2025_on_APP_2026.pdf",
    concept: "HAPS"
  },
  {
    year: 2025,
    reference: "FRONTEX-APP-2025-011",
    originalPlanRow: "11",
    title: "Framework Contract (FWC) for provision of services for GIS/GEOINT/IMINT consultancy",
    description:
      "Original Frontex Annual Procurement Plan row: 11. Framework contract establishing provision of GIS, GEOINT and IMINT consultancy under Time & Means conditions, including mapping and modelling geospatial data, imagery intelligence data collection, preparation, analysis, interpretation and dissemination of high-quality products.",
    requestingService: "INTEL/FUSION",
    estimatedValue: "3000000",
    currency: "EUR",
    sourceURL:
      "https://www.frontex.europa.eu/assets/Procurement/MB_Decision_25_2025_on_amendment_N2_to_APP_2025.pdf",
    concept: "GEOINT_IMINT"
  }
];


const FT_API =
  "https://api.tech.ec.europa.eu/search-api/prod/rest/search";

const FT_PORTAL =
  `https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/calls-for-tenders?order=DESC&pageNumber=1&pageSize=50&sortBy=startDate&isExactMatch=true&cftPartyLegalEntityId=${FRONTEX_LEGAL_ENTITY_ID}`;

const TED_API =
  "https://api.ted.europa.eu/v3/notices/search";

const TED_BUYER_QUERIES = [
  'buyer-name = "European Border and Coast Guard Agency (FRONTEX)"',
  'buyer-name = "European Border and Coast Guard Agency (Frontex)"',
  'buyer-name = "European Border and Coast Guard Agency"'
];

const TED_FIELDS = [
  "publication-number",
  "publication-date",
  "notice-title",
  "title-proc",
  "description-proc",
  "description-lot",
  "buyer-name",
  "buyer-country",
  "buyer-identifier",
  "form-type",
  "notice-type",
  "notice-subtype",
  "procedure-type",
  "procedure-identifier",
  "classification-cpv",
  "main-classification-proc",
  "additional-classification-proc",
  "estimated-value-proc",
  "estimated-value-cur-proc",
  "deadline",
  "deadline-receipt-tender-date-lot",
  "winner-name",
  "result-value-notice",
  "result-value-cur-notice"
];

const FT_STATUS_CODES = [
  "31094501", // forthcoming
  "31094502", // open
  "31094503"  // closed
];

const FT_DISPLAY_FIELDS = [
  "type",
  "identifier",
  "reference",
  "title",
  "status",
  "caName",
  "startDate",
  "deadlineDate",
  "description",
  "procedureType",
  "contractType",
  "contractBudget",
  "contractBudgetCurrency",
  "cftPartyLegalEntityId",
  "callccm2Id",
  "lastUpdateDate"
];

function ensureDirs() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function arr(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function clean(v) {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.map(clean).filter(Boolean).join(" | ");
  if (typeof v === "object") {
    if (v.eng) return clean(v.eng);
    if (v.en) return clean(v.en);
    return Object.values(v).map(clean).filter(Boolean).join(" | ");
  }
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

function readCache(name, binary = false) {
  const f = cachePath(name);
  if (!FORCE_REFRESH && fs.existsSync(f)) {
    return fs.readFileSync(f, binary ? undefined : "utf8");
  }
  return null;
}

function saveCache(name, content) {
  fs.writeFileSync(cachePath(name), content);
}

async function getText(url, label = url) {
  let wait = 10000;
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
      if (status && status >= 400 && status < 500 && status !== 429) {
        const e = new Error(`Permanent HTTP ${status}: ${label}`);
        e.status = status;
        throw e;
      }
      console.error(`${label} failed${status ? ` HTTP ${status}` : ""}: ${err.message}`);
      console.error(`Retrying in ${Math.round(wait / 1000)} sec...`);
      await sleep(wait);
      wait = Math.min(wait * 2, 120000);
    }
  }
}

async function getBuffer(url, label = url) {
  let wait = 10000;
  while (true) {
    try {
      const r = await axios.get(url, {
        timeout: 120000,
        maxRedirects: 10,
        responseType: "arraybuffer",
        headers: {
          "User-Agent": USER_AGENT,
          "Accept-Language": "en"
        }
      });
      return Buffer.from(r.data);
    } catch (err) {
      const status = err.response && err.response.status;
      if (status && status >= 400 && status < 500 && status !== 429) {
        const e = new Error(`Permanent HTTP ${status}: ${label}`);
        e.status = status;
        throw e;
      }
      console.error(`${label} failed${status ? ` HTTP ${status}` : ""}: ${err.message}`);
      console.error(`Retrying in ${Math.round(wait / 1000)} sec...`);
      await sleep(wait);
      wait = Math.min(wait * 2, 120000);
    }
  }
}

// ------------------------------------------------------------
// CLASSIFICATION
// ------------------------------------------------------------

const CORE_SPACE = [
  "satellite imagery",
  "satellite images",
  "satellite image",
  "satellite data",
  "satellite service",
  "satellite services",
  "satellite communication",
  "satellite communications",
  "satcom",
  "earth observation",
  "remote sensing",
  "optical satellite",
  "radar satellite",
  "synthetic aperture radar",
  "sar imagery",
  "sentinel",
  "copernicus border surveillance",
  "copernicus security",
  "copernicus",
  "gnss",
  "galileo",
  "egnos",
  "position navigation and timing",
  "position, navigation and timing",
  "pnt",
  "satellite radio frequency emitter detection",
  "satellite rf emitter detection"
];

const DUAL_USE = [
  "eurosur fusion services",
  "eurosur fusion",
  "intelligence surveillance and reconnaissance",
  "isr integration",
  "isr solution",
  "sensor fusion",
  "data fusion",
  "geospatial",
  "geo-spatial",
  "map production",
  "mapping services",
  "border surveillance",
  "maritime surveillance",
  "situational awareness",
  "geospatial intelligence",
  "imagery intelligence",
  "imint",
  "geoint",
  "high altitude pseudo-satellite",
  "high-altitude pseudo-satellite",
  "haps"
];

const MANUAL_ONLY = [
  "drone",
  "drones",
  "unmanned aerial",
  "uas",
  "surveillance aircraft",
  "aerial surveillance",
  "radar",
  "electro-optical",
  "electro optical"
];

const GENERIC_EXCLUDE = [
  "uniform",
  "weapons",
  "ammunition",
  "cleaning",
  "catering",
  "office",
  "translation",
  "insurance",
  "travel",
  "training",
  "medical",
  "vehicle",
  "vehicles",
  "building",
  "construction"
];

function detectDomain(t) {
  if (/copernicus border surveillance|copernicus security|copernicus/.test(t)) {
    return "Copernicus Border Surveillance Service";
  }
  if (/satellite imagery|satellite image|earth observation|remote sensing|sentinel|optical satellite|radar satellite|sar imagery/.test(t)) {
    return "Earth Observation / Satellite Imagery";
  }
  if (/gnss|galileo|egnos|position[, ]+navigation and timing|\bpnt\b/.test(t)) {
    return "GNSS / Galileo / PNT";
  }
  if (/satcom|satellite communication/.test(t)) {
    return "Satellite Communications";
  }
  if (/high[- ]altitude pseudo-satellite|\bhaps\b/.test(t)) {
    return "HAPS / Near-Space Surveillance";
  }
  if (/satellite radio frequency emitter detection|satellite rf emitter detection/.test(t)) {
    return "Satellite RF / Signal Detection";
  }
  if (/geospatial intelligence|imagery intelligence|\bgeoint\b|\bimint\b/.test(t)) {
    return "GEOINT / IMINT";
  }
  if (/eurosur fusion|sensor fusion|data fusion|isr|eurosur/.test(t)) {
    return "EUROSUR / ISR / Data Fusion";
  }
  if (/geospatial|geo-spatial|map production|mapping services/.test(t)) {
    return "Geospatial / Mapping";
  }
  if (/border surveillance|maritime surveillance|situational awareness/.test(t)) {
    return "Border Surveillance / Situational Awareness";
  }
  return "Space-Enabled Border Security";
}

function classify(text) {
  const t = clean(text).toLowerCase();

  const core = CORE_SPACE.filter(x => t.includes(x));
  const dual = DUAL_USE.filter(x => t.includes(x));
  const manual = MANUAL_ONLY.filter(x => t.includes(x));
  const generic = GENERIC_EXCLUDE.filter(x => t.includes(x));

  const hasGeointImint =
    /(geospatial intelligence|imagery intelligence|\bgeoint\b|\bimint\b)/.test(t);

  const hasGisPlusIntelligence =
    /\bgis\b/.test(t) && /(geospatial intelligence|imagery intelligence|\bgeoint\b|\bimint\b)/.test(t);

  const hasEurosurContext =
    /eurosur/.test(t) &&
    /(situational awareness|operational cooperation|information exchange|fusion)/.test(t);

  const hasSatelliteRf =
    /satellite (?:radio frequency|rf) emitter detection/.test(t);

  const hasHapsContext =
    /(high[- ]altitude pseudo-satellite|\bhaps\b)/.test(t) &&
    /(border surveillance|situational awareness|data fusion|surveillance)/.test(t);

  // Explicit space/EO/GNSS/SATCOM signals.
  if ((core.length || hasSatelliteRf) && !generic.length) {
    return {
      decision: "AUTO_KEEP",
      classification: "CORE SPACE / SPACE-ENABLED BORDER SECURITY",
      domain: detectDomain(t),
      confidence: "HIGH",
      evidence: uniq([...core, ...(hasSatelliteRf ? ["satellite RF emitter detection"] : []), ...dual]).join(" | ")
    };
  }

  // GEOINT/IMINT and EUROSUR consultancy are strategically relevant dual-use
  // procurement for the Frontex space-security market, even when the title
  // does not explicitly repeat the word satellite.
  if (
    (hasGeointImint || hasGisPlusIntelligence || hasEurosurContext || hasHapsContext) &&
    !generic.length
  ) {
    return {
      decision: "AUTO_KEEP",
      classification: hasHapsContext
        ? "DEFENCE-SPACE / DUAL-USE NEAR-SPACE"
        : "DEFENCE-SPACE / DUAL-USE",
      domain: detectDomain(t),
      confidence: hasHapsContext ? "HIGH" : "MEDIUM",
      evidence: uniq([
        ...dual,
        ...(hasGeointImint ? ["GEOINT/IMINT"] : []),
        ...(hasEurosurContext ? ["EUROSUR contextual relevance"] : []),
        ...(hasHapsContext ? ["HAPS near-space surveillance"] : [])
      ]).join(" | ")
    };
  }

  // Other dual-use procurement needs at least two contextual signals.
  if (dual.length >= 2 && !generic.length) {
    return {
      decision: "AUTO_KEEP",
      classification: "DEFENCE-SPACE / DUAL-USE",
      domain: detectDomain(t),
      confidence: "MEDIUM",
      evidence: dual.join(" | ")
    };
  }

  // Generic aircraft, RPAS, drones, aerostats, radar and thermal/night-vision
  // equipment remain outside the production RAG unless another strong
  // space/EO/geospatial intelligence signal is present.
  if ((dual.length === 1 || manual.length) && !generic.length) {
    return {
      decision: "MANUAL_REVIEW",
      classification: "POSSIBLE DUAL-USE / SURVEILLANCE",
      domain: detectDomain(t),
      confidence: "MEDIUM",
      evidence: uniq([...dual, ...manual]).join(" | ")
    };
  }

  return {
    decision: "AUTO_EXCLUDE",
    classification: "NON-SPACE / GENERIC FRONTEX PROCUREMENT",
    domain: "",
    confidence: "LOW",
    evidence: generic.join(" | ")
  };
}

function makeRow(base) {
  const cls = classify(
    `${base.title || ""} ${base.description || ""} ${base.cpv || ""}`
  );

  const row = {
    sourceType: base.sourceType || "",
    sourceAuthority: "European Border and Coast Guard Agency",
    authority: "European Border and Coast Guard Agency (Frontex)",
    reference: base.reference || "",
    title: base.title || "",
    description: base.description || "",
    publicationDate: base.publicationDate || "",
    deadline: base.deadline || "",
    status: base.status || "",
    openNow: base.openNow || "NO",
    stage: base.stage || "",
    procedureType: base.procedureType || "",
    contractType: base.contractType || "",
    cpv: base.cpv || "",
    estimatedValue: base.estimatedValue || "",
    currency: base.currency || "",
    contractor: base.contractor || "",
    awardValue: base.awardValue || "",
    awardCurrency: base.awardCurrency || "",
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
    ragText: ""
  };

  row.ragText = [
    `Authority: ${row.authority}`,
    `Reference: ${row.reference}`,
    `Title: ${row.title}`,
    `Description: ${row.description}`,
    `Publication date: ${row.publicationDate}`,
    `Deadline: ${row.deadline}`,
    `Status: ${row.status}`,
    `Stage: ${row.stage}`,
    `Procedure type: ${row.procedureType}`,
    `Contract type: ${row.contractType}`,
    `CPV: ${row.cpv}`,
    `Estimated value: ${row.estimatedValue} ${row.currency}`.trim(),
    `Contractor: ${row.contractor}`,
    `Award value: ${row.awardValue} ${row.awardCurrency}`.trim(),
    `Space classification: ${row.spaceClassification}`,
    `Space domain: ${row.spaceDomain}`,
    `Relevance decision: ${row.relevanceDecision}`,
    `Evidence: ${row.relevanceEvidence}`,
    `Source URL: ${row.sourceURL}`
  ].filter(Boolean).join("\n");

  return row;
}

// ------------------------------------------------------------
// OFFICIAL FRONTEX VALIDATION
// ------------------------------------------------------------

async function validateFrontexAuthority() {
  console.log("\n=== Frontex authority/source validation ===");

  let html = readCache("frontex-low-middle.html");
  if (html === null) {
    html = await getText(FRONTEX_LOW_MIDDLE, "Frontex low/middle procurement page");
    saveCache("frontex-low-middle.html", html);
  } else {
    console.log("Frontex procurement page: checkpoint");
  }

  const $ = cheerio.load(html);
  let portalUrl = "";

  $("a[href]").each((_, a) => {
    const href = $(a).attr("href") || "";
    if (
      /funding-tenders/i.test(href) &&
      href.includes(`cftPartyLegalEntityId=${FRONTEX_LEGAL_ENTITY_ID}`)
    ) {
      portalUrl = href;
    }
  });

  const confirmed = !!portalUrl;

  console.log(
    `Frontex Funding & Tenders authority ID confirmed: ${confirmed ? "YES" : "NO"}`
  );
  console.log(`Authority ID: ${FRONTEX_LEGAL_ENTITY_ID}`);

  // Also cache official Copernicus mandate page for source audit.
  let copernicus = readCache("frontex-copernicus.html");
  if (copernicus === null) {
    try {
      copernicus = await getText(FRONTEX_COPERNICUS, "Frontex Copernicus page");
      saveCache("frontex-copernicus.html", copernicus);
    } catch (err) {
      console.log(`Copernicus page warning: ${err.message}`);
    }
  }

  return {
    confirmed,
    url: portalUrl || FT_PORTAL
  };
}

// ------------------------------------------------------------
// FUNDING & TENDERS
// ------------------------------------------------------------

async function ftPost(query, pageNumber) {
  let wait = 10000;

  while (true) {
    try {
      const form = new FormData();

      form.append(
        "query",
        new Blob([JSON.stringify(query)], { type: "application/json" }),
        "query.json"
      );

      form.append(
        "languages",
        new Blob([JSON.stringify(["en"])], { type: "application/json" }),
        "languages.json"
      );

      form.append(
        "sort",
        new Blob(
          [JSON.stringify({ field: "startDate", order: "DESC" })],
          { type: "application/json" }
        ),
        "sort.json"
      );

      form.append(
        "displayFields",
        new Blob([JSON.stringify(FT_DISPLAY_FIELDS)], { type: "application/json" }),
        "displayFields.json"
      );

      const url =
        `${FT_API}?apiKey=SEDIA&text=***&pageSize=100&pageNumber=${pageNumber}`;

      const r = await axios.post(url, form, {
        timeout: 120000,
        maxRedirects: 10,
        headers: {
          "User-Agent": USER_AGENT,
          "Accept": "application/json, text/plain, */*"
        }
      });

      return r.data;
    } catch (err) {
      const status = err.response && err.response.status;

      if (status && status !== 429 && status >= 400 && status < 600) {
        const e = new Error(
          `Funding & Tenders API HTTP ${status}: ${err.message}`
        );
        e.status = status;
        throw e;
      }

      console.error(
        `Funding & Tenders API failed${status ? ` HTTP ${status}` : ""}: ${err.message}`
      );
      console.error(`Retrying in ${Math.round(wait/1000)} sec...`);
      await sleep(wait);
      wait = Math.min(wait * 2, 120000);
    }
  }
}

function ftItems(data) {
  if (!data || typeof data !== "object") return [];

  const candidates = [
    data.results,
    data.items,
    data.data,
    data.response && data.response.results,
    data.response && data.response.docs
  ];

  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }

  if (data.results && typeof data.results === "object") {
    for (const value of Object.values(data.results)) {
      if (Array.isArray(value)) return value;
      if (value && Array.isArray(value.results)) return value.results;
    }
  }

  return [];
}

function ftTotal(data) {
  const values = [
    data && data.total,
    data && data.totalResults,
    data && data.totalCount,
    data && data.response && data.response.total
  ];

  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }

  return null;
}

function normalizeFt(item) {
  const reference =
    clean(item.reference) ||
    clean(item.identifier) ||
    clean(item.callccm2Id);

  const title = clean(item.title);
  const description = clean(item.description);

  const publicationDate = iso(item.startDate);
  const deadline = iso(item.deadlineDate);

  const statusText = clean(item.status).toLowerCase();

  let status = "UNKNOWN";
  let stage = "Funding & Tenders";

  if (/open|submission|31094502/.test(statusText)) {
    status =
      deadline && !isFuture(deadline)
        ? "CLOSED"
        : "OPEN";
    stage =
      status === "OPEN"
        ? "Competition / Open"
        : "Competition / Closed";
  } else if (/forthcoming|planned|31094501/.test(statusText)) {
    status = "PLANNED";
    stage = "Planning / Forthcoming";
  } else if (/closed|31094503/.test(statusText)) {
    status = "CLOSED";
    stage = "Competition / Closed";
  } else if (deadline) {
    status = isFuture(deadline) ? "OPEN" : "CLOSED";
    stage =
      status === "OPEN"
        ? "Competition / Open"
        : "Competition / Closed";
  }

  const identifier =
    clean(item.identifier) ||
    clean(item.callccm2Id) ||
    reference;

  const sourceURL =
    identifier
      ? `https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/tender-details/${encodeURIComponent(identifier)}`
      : FT_PORTAL;

  return makeRow({
    sourceType: "EU Funding & Tenders",
    reference,
    title,
    description,
    publicationDate,
    deadline,
    status,
    openNow: status === "OPEN" ? "YES" : "NO",
    stage,
    procedureType: clean(item.procedureType),
    contractType: clean(item.contractType),
    estimatedValue: clean(item.contractBudget),
    currency: clean(item.contractBudgetCurrency),
    sourceURL,
    sourceRecordId: identifier,
    sourceDataProvenance:
      "Official EU Funding & Tenders Portal public Search API"
  });
}

async function collectFundingTenders() {
  console.log("\n=== EU Funding & Tenders — Frontex authority ===");

  const cache = "funding-tenders-frontex.json";
  const cached = readCache(cache);

  if (cached !== null) {
    const raw = JSON.parse(cached);
    console.log(`Funding & Tenders: checkpoint (${raw.length} raw rows)`);
    return raw.map(normalizeFt);
  }

  const query = {
    bool: {
      must: [
        { terms: { status: FT_STATUS_CODES } },
        { term: { cftPartyLegalEntityId: FRONTEX_LEGAL_ENTITY_ID } }
      ]
    }
  };

  const collected = [];

  try {
    for (let page = 1; page <= 60; page++) {
      const data = await ftPost(query, page);
      const items = ftItems(data);

      if (!items.length) break;

      collected.push(...items);

      const total = ftTotal(data);

      console.log(
        `Funding & Tenders page ${page}: +${items.length}; total ${collected.length}` +
        (total !== null ? ` / ${total}` : "")
      );

      if (
        items.length < 100 ||
        (total !== null && collected.length >= total)
      ) break;

      await sleep(WAIT_MS);
    }
  } catch (err) {
    console.log(`Funding & Tenders API unavailable: ${err.message}`);
  }

  const map = new Map();

  for (const item of collected) {
    const key =
      clean(item.identifier) ||
      clean(item.reference) ||
      clean(item.callccm2Id) ||
      `${clean(item.title)}|${clean(item.startDate)}`;

    if (key && !map.has(key)) map.set(key, item);
  }

  const raw = [...map.values()];
  saveCache(cache, JSON.stringify(raw, null, 2));

  console.log(`Funding & Tenders unique raw rows: ${raw.length}`);

  return raw.map(normalizeFt);
}

// ------------------------------------------------------------
// TED
// ------------------------------------------------------------

async function tedPost(body) {
  let wait = 10000;

  while (true) {
    try {
      const r = await axios.post(TED_API, body, {
        timeout: 120000,
        headers: {
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT
        }
      });
      return r.data;
    } catch (err) {
      const status = err.response && err.response.status;

      if (status && status >= 400 && status < 500 && status !== 429) {
        const e = new Error(`Permanent TED HTTP ${status}`);
        e.status = status;
        throw e;
      }

      console.error(
        `TED API failed${status ? ` HTTP ${status}` : ""}: ${err.message}`
      );
      console.error(`Retrying in ${Math.round(wait/1000)} sec...`);
      await sleep(wait);
      wait = Math.min(wait * 2, 120000);
    }
  }
}

async function collectTedQuery(qi, buyerQuery, year) {
  const cache = `ted-q${qi}-${year}.json`;
  const cached = readCache(cache);

  if (cached !== null) {
    console.log(`TED q${qi} ${year}: checkpoint`);
    return JSON.parse(cached);
  }

  const rows = [];
  let token = "";

  while (true) {
    const body = {
      query:
        `${buyerQuery} AND publication-date >= ${year}0101 AND publication-date <= ${year}1231`,
      limit: 250,
      fields: TED_FIELDS,
      paginationMode: "ITERATION"
    };

    if (token) body.iterationNextToken = token;

    const data = await tedPost(body);
    const notices = arr(data.notices);

    rows.push(...notices);

    console.log(
      `TED q${qi} ${year}: +${notices.length}; total ${rows.length}`
    );

    token = clean(data.iterationNextToken);

    if (!notices.length || !token) break;

    await sleep(WAIT_MS);
  }

  saveCache(cache, JSON.stringify(rows, null, 2));
  return rows;
}

function tedDeadline(n) {
  const dates = [
    ...arr(n["deadline-receipt-tender-date-lot"]),
    ...arr(n["deadline"])
  ]
    .map(clean)
    .filter(Boolean)
    .map(parseDate)
    .filter(Boolean)
    .sort((a,b) => a-b);

  return dates.length
    ? dates[dates.length - 1].toISOString()
    : "";
}

function normalizeTed(n) {
  const title =
    clean(n["title-proc"]) ||
    clean(n["notice-title"]);

  const description =
    clean(n["description-proc"]) ||
    clean(n["description-lot"]);

  const cpv =
    uniq([
      ...arr(n["classification-cpv"]),
      ...arr(n["main-classification-proc"]),
      ...arr(n["additional-classification-proc"])
    ]).join(" | ");

  const form = clean(n["form-type"]).toLowerCase();
  const deadline = tedDeadline(n);
  const winner = uniq(arr(n["winner-name"])).join(" | ");

  let status = "UNKNOWN";
  let stage = clean(n["form-type"]);

  if (form === "result" || winner) {
    status = "CLOSED";
    stage = "Result / Award";
  } else if (form === "planning") {
    status = "PLANNED";
    stage = "Planning / PIN";
  } else if (deadline) {
    status = isFuture(deadline) ? "OPEN" : "CLOSED";
    stage =
      status === "OPEN"
        ? "Competition / Open"
        : "Competition / Closed";
  }

  const pub = clean(n["publication-number"]);

  return makeRow({
    sourceType: "TED",
    reference:
      clean(n["procedure-identifier"]) || pub,
    title,
    description,
    publicationDate: iso(n["publication-date"]),
    deadline,
    status,
    openNow: status === "OPEN" ? "YES" : "NO",
    stage,
    procedureType: clean(n["procedure-type"]),
    cpv,
    estimatedValue: clean(n["estimated-value-proc"]),
    currency: clean(n["estimated-value-cur-proc"]),
    contractor: winner,
    awardValue: clean(n["result-value-notice"]),
    awardCurrency: clean(n["result-value-cur-notice"]),
    sourceURL:
      pub
        ? `https://ted.europa.eu/en/notice/-/detail/${pub}`
        : "",
    sourceRecordId: pub,
    sourceDataProvenance: "Official TED Search API"
  });
}

async function collectTed() {
  console.log("\n=== Frontex formal procurement via TED ===");

  const notices = [];

  for (let qi = 0; qi < TED_BUYER_QUERIES.length; qi++) {
    for (let year = START_YEAR; year <= END_YEAR; year++) {
      try {
        const part =
          await collectTedQuery(qi + 1, TED_BUYER_QUERIES[qi], year);

        notices.push(...part);
      } catch (err) {
        console.log(
          `TED q${qi+1} ${year} skipped: ${err.message}`
        );
      }
    }
  }

  const map = new Map();

  for (const n of notices) {
    const pub = clean(n["publication-number"]);
    if (pub && !map.has(pub)) map.set(pub, n);
  }

  const rows = [...map.values()].map(normalizeTed);

  console.log(`TED unique notices: ${rows.length}`);

  return rows;
}

// ------------------------------------------------------------
// FRONTEX ANNUAL PROCUREMENT PLANS
// ------------------------------------------------------------

async function collectPlanLinks() {
  let html = readCache("frontex-general.html");

  if (html === null) {
    html = await getText(FRONTEX_GENERAL, "Frontex procurement general page");
    saveCache("frontex-general.html", html);
  } else {
    console.log("Frontex general procurement page: checkpoint");
  }

  const $ = cheerio.load(html);
  const links = [];

  $("a[href]").each((_, a) => {
    const text = clean($(a).text());
    const href = $(a).attr("href") || "";

    if (
      /annual procurement plan/i.test(text) &&
      /\.pdf/i.test(href)
    ) {
      const year =
        Number((text.match(/\b20(25|26)\b/) || [])[0]);

      if (year >= 2025 && year <= 2026) {
        links.push({
          year,
          text,
          url: href.startsWith("http")
            ? href
            : new URL(href, FRONTEX_GENERAL).href
        });
      }
    }
  });

  // Keep latest amendment per year first, but parse all documents because
  // amendments sometimes contain only changed rows.
  return links;
}

function planRowsFromText(text, sourceURL, label, year) {
  const lines =
    String(text || "")
      .split(/\r?\n/)
      .map(clean)
      .filter(Boolean);

  // PDF extraction from Frontex plans breaks table cells across line/pipe
  // boundaries. Build a normalized text stream for robust token matching.
  const full =
    clean(lines.join(" | "))
      .replace(/\s*\|\s*/g, " ")
      .replace(/\s+/g, " ");

  const concepts = [
    {
      key: "HAPS",
      test: /\bHAPS\b|High[- ]?Altitude Platform System/i,
      title: "High Altitude Platform System (HAPS) pilot project for border surveillance and connectivity"
    },
    {
      key: "GEOINT_IMINT",
      test: /\bGEOINT\b|\bIMINT\b|Geospatial Intelligence|Imagery Intelligence/i,
      title: "Framework contract for GIS/GEOINT/IMINT consultancy services"
    },
    {
      key: "SHIPBORNE_UAS_FUSION",
      test: /shipborne.*(?:VTOL|UAS).*data fusion|data fusion.*shipborne/i,
      title: "Shipborne VTOL UAS deployment with data-fusion and integration services"
    },
    {
      key: "SATELLITE_RF",
      test: /satellite.*(?:radio frequency|RF).*emitter detection/i,
      title: "Satellite radio-frequency emitter detection services"
    },
    {
      key: "COPERNICUS",
      test: /\bCopernicus\b/i,
      title: "Copernicus Border Surveillance / Security services"
    },
    {
      key: "SATELLITE_EO",
      test: /satellite imagery|satellite images|earth observation|remote sensing|optical satellite|radar satellite/i,
      title: "Satellite imagery / Earth Observation services"
    },
    {
      key: "EUROSUR",
      test: /\bEUROSUR\b/i,
      title: "EUROSUR consultancy / fusion / situational-awareness services"
    },
    {
      key: "ISR_FUSION",
      test: /intelligence surveillance and reconnaissance|\bISR\b|sensor fusion|data fusion/i,
      title: "ISR / sensor-fusion / data-fusion services"
    },
    {
      key: "GNSS",
      test: /\bGNSS\b|\bGalileo\b|\bEGNOS\b|\bPNT\b|position[, ]+navigation and timing/i,
      title: "GNSS / Galileo / PNT-related procurement"
    },
    {
      key: "SATCOM",
      test: /\bSATCOM\b|satellite communication/i,
      title: "Satellite communications procurement"
    }
  ];

  const rows = [];

  for (const c of concepts) {
    const match = full.match(c.test);
    if (!match) continue;

    const idx = match.index || 0;
    const context =
      clean(
        full.slice(
          Math.max(0, idx - 900),
          Math.min(full.length, idx + 2600)
        )
      );

    const cls = classify(`${c.title} ${context}`);

    if (cls.decision === "AUTO_EXCLUDE") continue;

    rows.push(
      makeRow({
        sourceType: "Frontex Annual Procurement Plan",
        reference: "",
        title: c.title,
        description: context.slice(0, 6000),
        publicationDate: `${year}-01-01T00:00:00.000Z`,
        deadline: "",
        status: "PLANNED",
        openNow: "NO",
        stage: "Planning / Annual Procurement Plan",
        sourceURL,
        sourceRecordId: `PLAN|${year}|${c.key}`,
        sourceDataProvenance:
          `Official Frontex Annual Procurement Plan (${label})`
      })
    );
  }

  return rows;
}

async function collectPlans() {
  console.log("\n=== Frontex Annual Procurement Plans ===");

  const links = await collectPlanLinks();
  console.log(`Procurement plan PDFs found: ${links.length}`);

  const candidates = [];

  for (let i = 0; i < links.length; i++) {
    const l = links[i];
    const cache = `plan-${l.year}-${i}.pdf`;

    let buffer = readCache(cache, true);

    if (buffer === null) {
      try {
        buffer = await getBuffer(l.url, `Frontex plan ${l.year}`);
        saveCache(cache, buffer);
      } catch (err) {
        console.log(`Skip plan ${l.url}: ${err.message}`);
        continue;
      }
      await sleep(WAIT_MS);
    }

    if (
      buffer.length < 5 ||
      buffer.slice(0,5).toString("ascii") !== "%PDF-"
    ) {
      console.log(`Skip non-PDF plan response: ${l.url}`);
      continue;
    }

    try {
      const parsed = await pdf(buffer);
      const part =
        planRowsFromText(parsed.text, l.url, l.text, l.year);

      candidates.push(...part);

      console.log(
        `Plan ${i+1}/${links.length} (${l.year}); parsed concept candidates cumulative ${candidates.length}`
      );
    } catch (err) {
      console.log(`Plan parse failed ${l.url}: ${err.message}`);
    }
  }

  // Build one canonical record per year+concept from parsed PDF content.
  const map = new Map();

  for (const r of candidates) {
    const key = clean(r.sourceRecordId);
    if (!key) continue;

    if (!map.has(key)) {
      map.set(key, { ...r });
      continue;
    }

    const cur = map.get(key);

    cur.description =
      uniq([cur.description, r.description]).join(" || ").slice(0,12000);

    cur.additionalSourceURLs =
      uniq([cur.additionalSourceURLs, cur.sourceURL, r.sourceURL]).join(" | ");

    if (/amendment/i.test(r.sourceDataProvenance) || /amendment/i.test(r.sourceURL)) {
      cur.sourceURL = r.sourceURL;
      cur.sourceDataProvenance = r.sourceDataProvenance;
    }

    map.set(key, cur);
  }

  // pdf-parse can split Frontex table text in ways that make token matching
  // unreliable. Add a tiny verified fallback set from the official plans.
  // These rows are used only if the same year/concept was not recovered.
  for (const f of VERIFIED_PLAN_FALLBACKS) {
    const key = `PLAN|${f.year}|${f.concept}`;

    if (map.has(key)) continue;

    const currentYear = new Date().getUTCFullYear();

    const status =
      f.year >= currentYear ? "PLANNED" : "HISTORICAL_PLAN";

    const stage =
      f.year >= currentYear
        ? "Planning / Annual Procurement Plan"
        : "Historical / Annual Procurement Plan";

    const row =
      makeRow({
        sourceType: "Frontex Annual Procurement Plan",
        reference: f.reference,
        title: f.title,
        description:
          `${f.description} Requesting service: ${f.requestingService}.`,
        publicationDate: `${f.year}-01-01T00:00:00.000Z`,
        deadline: "",
        status,
        openNow: "NO",
        stage,
        estimatedValue: f.estimatedValue,
        currency: f.currency,
        sourceURL: f.sourceURL,
        sourceRecordId: key,
        sourceDataProvenance:
          `Verified official Frontex Annual Procurement Plan fallback; original APP row ${f.originalPlanRow || f.reference}`
      });

    map.set(key, row);

    console.log(
      `Added verified plan fallback ${f.year} ${f.concept}: ${f.title}`
    );
  }

  const rows = [...map.values()];

  console.log(`Annual-plan canonical rows after concept dedup/fallback: ${rows.length}`);

  return rows;
}

// ------------------------------------------------------------
// TED PROCEDURE GROUPING
// ------------------------------------------------------------

function tedProcedureKey(r) {
  const ref = clean(r.reference).toUpperCase();
  if (ref) return `REF|${ref}`;

  return `TITLE|${clean(r.title).toLowerCase().slice(0,180)}`;
}

function tedNoticePriority(r) {
  if (/Result|Award/i.test(r.stage) || clean(r.contractor)) return 50;
  if (r.openNow === "YES") return 40;
  if (r.status === "PLANNED") return 30;
  if (/Competition/i.test(r.stage)) return 20;
  return 10;
}

function groupTedByProcedure(rows) {
  const groups = new Map();

  for (const r of rows) {
    const key = tedProcedureKey(r);
    const cur = groups.get(key);

    if (!cur) {
      groups.set(key, {
        ...r,
        tedNoticeCount: "1",
        tedNoticeURLs: clean(r.sourceURL),
        tedPublicationNumbers: clean(r.sourceRecordId)
      });
      continue;
    }

    const primary =
      tedNoticePriority(r) > tedNoticePriority(cur)
        ? { ...r }
        : { ...cur };

    const secondary =
      tedNoticePriority(r) > tedNoticePriority(cur)
        ? cur
        : r;

    for (const k of Object.keys(primary)) {
      if (!clean(primary[k]) && clean(secondary[k])) {
        primary[k] = secondary[k];
      }
    }

    primary.tedNoticeCount =
      String(
        Number(cur.tedNoticeCount || 1) +
        Number(r.tedNoticeCount || 1)
      );

    primary.tedNoticeURLs =
      uniq([
        cur.tedNoticeURLs,
        cur.sourceURL,
        r.sourceURL
      ]).join(" | ");

    primary.tedPublicationNumbers =
      uniq([
        cur.tedPublicationNumbers,
        cur.sourceRecordId,
        r.sourceRecordId
      ]).join(" | ");

    if (cur.openNow === "YES" || r.openNow === "YES") {
      const live = cur.openNow === "YES" ? cur : r;
      primary.status = "OPEN";
      primary.openNow = "YES";
      primary.deadline = live.deadline || primary.deadline;
      primary.stage = "Competition / Open";
    } else if (
      /Result|Award/i.test(cur.stage) ||
      /Result|Award/i.test(r.stage) ||
      clean(cur.contractor) ||
      clean(r.contractor)
    ) {
      primary.status = "CLOSED";
      primary.openNow = "NO";
      primary.stage = "Result / Award";
    } else if (
      cur.status === "PLANNED" ||
      r.status === "PLANNED"
    ) {
      primary.status = "PLANNED";
      primary.openNow = "NO";
      primary.stage = "Planning / PIN";
    }

    primary.contractor =
      uniq([cur.contractor, r.contractor]).join(" | ");

    primary.awardValue =
      uniq([cur.awardValue, r.awardValue]).join(" | ");

    primary.awardCurrency =
      uniq([cur.awardCurrency, r.awardCurrency]).join(" | ");

    const cls =
      classify(
        `${primary.title} ${primary.description} ${primary.cpv}`
      );

    primary.relevanceDecision = cls.decision;
    primary.spaceClassification = cls.classification;
    primary.spaceDomain = cls.domain;
    primary.relevanceConfidence = cls.confidence;
    primary.relevanceEvidence = cls.evidence;

    groups.set(key, primary);
  }

  return [...groups.values()];
}

// ------------------------------------------------------------
// MERGE / OUTPUT
// ------------------------------------------------------------

function keyFor(r) {
  const ref = clean(r.reference).toUpperCase();
  if (ref) return `REF|${ref}`;

  if (
    r.sourceType === "Frontex Annual Procurement Plan" &&
    clean(r.sourceRecordId)
  ) {
    return clean(r.sourceRecordId).toUpperCase();
  }

  return (
    `TITLE|${clean(r.title).toLowerCase().slice(0,180)}` +
    `|${clean(r.publicationDate).slice(0,10)}`
  );
}

function priority(r) {
  if (r.sourceType === "EU Funding & Tenders") return 70;
  if (r.sourceType === "TED") return 60;
  if (r.sourceType === "Frontex Annual Procurement Plan") return 40;
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
      priority(r) > priority(cur)
        ? { ...r }
        : { ...cur };

    const secondary =
      priority(r) > priority(cur)
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

    if (cur.openNow === "YES" || r.openNow === "YES") {
      const live = cur.openNow === "YES" ? cur : r;
      primary.status = "OPEN";
      primary.openNow = "YES";
      primary.deadline = live.deadline || primary.deadline;
      primary.stage = "Competition / Open";
    } else if (
      cur.status === "PLANNED" ||
      r.status === "PLANNED"
    ) {
      primary.status = "PLANNED";
      primary.openNow = "NO";
    }

    const cls =
      classify(
        `${primary.title} ${primary.description} ${primary.cpv}`
      );

    primary.relevanceDecision = cls.decision;
    primary.spaceClassification = cls.classification;
    primary.spaceDomain = cls.domain;
    primary.relevanceConfidence = cls.confidence;
    primary.relevanceEvidence = cls.evidence;

    primary.ragText = [
      `Authority: ${primary.authority}`,
      `Reference: ${primary.reference}`,
      `Title: ${primary.title}`,
      `Description: ${primary.description}`,
      `Publication date: ${primary.publicationDate}`,
      `Deadline: ${primary.deadline}`,
      `Status: ${primary.status}`,
      `Stage: ${primary.stage}`,
      `Procedure type: ${primary.procedureType}`,
      `Contract type: ${primary.contractType}`,
      `CPV: ${primary.cpv}`,
      `Estimated value: ${primary.estimatedValue} ${primary.currency}`.trim(),
      `Contractor: ${primary.contractor}`,
      `Award value: ${primary.awardValue} ${primary.awardCurrency}`.trim(),
      `Space classification: ${primary.spaceClassification}`,
      `Space domain: ${primary.spaceDomain}`,
      `Relevance decision: ${primary.relevanceDecision}`,
      `Evidence: ${primary.relevanceEvidence}`,
      `Source URL: ${primary.sourceURL}`
    ].filter(Boolean).join("\n");

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
  "publicationDate",
  "deadline",
  "status",
  "openNow",
  "stage",
  "procedureType",
  "contractType",
  "cpv",
  "estimatedValue",
  "currency",
  "contractor",
  "awardValue",
  "awardCurrency",
  "spaceClassification",
  "spaceDomain",
  "relevanceDecision",
  "relevanceConfidence",
  "relevanceEvidence",
  "sourceURL",
  "additionalSourceURLs",
  "sourceRecordId",
  "sourceDataProvenance",
  "sourceDataAltered",
  "tedNoticeCount",
  "tedNoticeURLs",
  "tedPublicationNumbers",
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

    const f =
      path.join(
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

    if (
      bytes + b > CSV_MAX_BYTES &&
      bytes > Buffer.byteLength(header)
    ) {
      flush();
    }

    content += line;
    bytes += b;
  }

  if (content !== header || !files.length) flush();

  return files;
}

function writeSources(authority) {
  const rows = [
    [
      "Frontex procurement general page",
      FRONTEX_GENERAL,
      "Official procurement rules and Annual Procurement Plan links",
      "Current"
    ],
    [
      "Frontex Funding & Tenders authority page",
      authority.url || FT_PORTAL,
      `Exact authority ID ${FRONTEX_LEGAL_ENTITY_ID}`,
      authority.confirmed ? "Confirmed" : "Not automatically confirmed"
    ],
    [
      "Frontex open/restricted procedures",
      FRONTEX_OPEN_RESTRICTED,
      "Official confirmation that formal tenders are published in OJEU and EU Funding & Tenders",
      "Current"
    ],
    [
      "Frontex low/middle value procedures",
      FRONTEX_LOW_MIDDLE,
      "Official low/middle value procurement route via EU Funding & Tenders",
      "Current"
    ],
    [
      "Frontex Copernicus programme",
      FRONTEX_COPERNICUS,
      "Official source defining Frontex Copernicus Border Surveillance Service and optical/radar satellite use",
      "Current"
    ],
    [
      "TED",
      TED_API,
      "Formal Frontex procurement lifecycle and awards",
      `${START_YEAR}-present`
    ]
  ];

  const f =
    path.join(
      OUTPUT_DIR,
      `Frontex_Procurement_Sources_${TODAY}.csv`
    );

  const csv =
    `"sourceType","url","purpose","coverage"\n` +
    rows.map(r => r.map(esc).join(",")).join("\n") +
    "\n";

  fs.writeFileSync(f, csv, "utf8");
  return f;
}

function copyCollector() { return __filename; }

async function main() {
  ensureDirs();

  console.log("==============================================");
  console.log("FRONTEX PROCUREMENT COLLECTOR V1.5");
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log(`Checkpoint: ${CACHE_DIR}`);
  console.log(`Historical start: ${START_YEAR}`);
  console.log("==============================================");

  const authority =
    await validateFrontexAuthority();

  const ft =
    await collectFundingTenders();

  const ted =
    await collectTed();

  const tedProcedures =
    groupTedByProcedure(ted);

  console.log(
    `TED procedure groups after lifecycle dedup: ${tedProcedures.length}`
  );

  const plans =
    await collectPlans();

  const all =
    mergeRows([
      ...ft,
      ...tedProcedures,
      ...plans
    ])
    .filter(r => {
      const d = parseDate(r.publicationDate);
      return !d || d.getUTCFullYear() >= START_YEAR;
    })
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
    ragReady.filter(
      r => r.openNow === "YES"
    );

  const planned =
    ragReady.filter(
      r =>
        r.status === "PLANNED" &&
        !/Historical/i.test(r.stage)
    );

  const historical =
    ragReady.filter(
      r =>
        r.openNow !== "YES" &&
        r.status !== "PLANNED"
    );

  const awards =
    ragReady.filter(
      r =>
        /Result|Award/i.test(r.stage) ||
        !!clean(r.contractor)
    );

  const files = [];

  files.push(...writeCsvChunked("Frontex_Procurement_All", all));
  files.push(...writeCsvChunked("Frontex_TED_Notice_Audit", ted));
  files.push(...writeCsvChunked("Frontex_TED_Procedure_Groups", tedProcedures));
  files.push(...writeCsvChunked("Frontex_Space_Procurement_RAG", ragReady));
  files.push(...writeCsvChunked("Frontex_Open_Space_Procurement", open));
  files.push(...writeCsvChunked("Frontex_Planned_Space_Procurement", planned));
  files.push(...writeCsvChunked("Frontex_Space_Procurement_Historical", historical));
  files.push(...writeCsvChunked("Frontex_Space_Awards_Suppliers", awards));
  files.push(...writeCsvChunked("Frontex_Space_Manual_Review", manual));
  files.push(writeSources(authority));
  files.push(copyCollector());

  const summary = {
    runDate: TODAY,
    historicalStart: START_YEAR,
    fundingTendersLegalEntityId:
      FRONTEX_LEGAL_ENTITY_ID,
    authorityIdConfirmedFromOfficialFrontexPage:
      authority.confirmed,
    sourceCounts: {
      fundingTenders: ft.length,
      tedRawNotices: ted.length,
      tedProcedureGroups: tedProcedures.length,
      annualPlanCandidates: plans.length
    },
    totalUniqueProcurementRecords:
      all.length,
    spaceRelevantIncludingManualReview:
      relevant.length,
    ragReadySpace:
      ragReady.length,
    openSpace:
      open.length,
    plannedSpace:
      planned.length,
    historicalSpace:
      historical.length,
    awardSupplierSpace:
      awards.length,
    manualReview:
      manual.length,
    methodology: [
      "Official Frontex procurement pages used to confirm Funding & Tenders authority identifier 47352434 and procurement publication channels",
      "Official EU Funding & Tenders public Search API for Frontex open, forthcoming/planned and closed procurement, including low/middle-value procedures",
      "Official TED Search API for formal Frontex notices and contract-award data from 2020-present using Frontex-specific buyer names",
      "Official Frontex Annual Procurement Plans for planned space/dual-use pipeline, using parser-based concept extraction plus a minimal verified fallback for official HAPS 2026 and GIS/GEOINT/IMINT 2025 entries when pdf-parse cannot recover table text reliably",
      "Official Frontex Copernicus programme page used to define operational relevance: Copernicus Border Surveillance Service, optical/radar satellites, EUROSUR Fusion Services and external EO suppliers",
      "Calibrated classifier separating core space/EO from generic aviation/drones while retaining Frontex-specific GEOINT/IMINT, contextual EUROSUR and HAPS near-space procurement as dual-use space-security intelligence"
    ],
    limitations: [
      "Annual Procurement Plans are planning documents and may be amended; the collector parses both base plans and amendments when linked by Frontex.",
      "Generic drones, aircraft, aerostats, radar and border-surveillance equipment is not automatically classified as space; GEOINT/IMINT, contextual EUROSUR, satellite-RF detection and HAPS near-space surveillance are treated as relevant dual-use space-security procurement.",
      "Research grants, prize contests, Requests for Information and innovation studies are not treated as procurement unless they appear in the formal procurement sources.",
      "TED notice history is grouped by procedure reference before semantic use; raw notices are retained separately for audit.",
      "The local pdf-parse library can fail to preserve Frontex procurement-plan table tokens. V1.5 therefore uses a minimal verified fallback for two official plan entries (HAPS 2026 and GIS/GEOINT/IMINT 2025); historical-plan rows are not counted as currently planned opportunities."
    ]
  };

  const summaryFile =
    path.join(
      OUTPUT_DIR,
      `Frontex_Procurement_Summary_${TODAY}.json`
    );

  fs.writeFileSync(
    summaryFile,
    JSON.stringify(summary, null, 2),
    "utf8"
  );

  files.push(summaryFile);

  console.log("\n==============================================");
  console.log("FRONTEX PROCUREMENT COLLECTION COMPLETE");
  console.log(`Funding & Tenders records: ${ft.length}`);
  console.log(`TED raw notices: ${ted.length}`);
  console.log(`TED procedure groups: ${tedProcedures.length}`);
  console.log(`Annual-plan candidate rows: ${plans.length}`);
  console.log(`All unique procurement records: ${all.length}`);
  console.log(`Space relevant incl. manual review: ${relevant.length}`);
  console.log(`RAG-ready space: ${ragReady.length}`);
  console.log(`OPEN space: ${open.length}`);
  console.log(`PLANNED space: ${planned.length}`);
  console.log(`Historical space: ${historical.length}`);
  console.log(`Award/supplier space: ${awards.length}`);
  console.log(`Manual review: ${manual.length}`);
  console.log("\nGenerated files:");

  for (const f of files) console.log(f);

  console.log("==============================================\n");
}

if (require.main === module) main().catch(err => {
  console.error("\nFRONTEX PROCUREMENT COLLECTOR FAILED");
  console.error(err.stack || err.message || err);
  process.exit(1);
});

module.exports = { main, outputDirectory: OUTPUT_DIR };
