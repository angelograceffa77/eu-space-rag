const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");
const pdf = require("pdf-parse");

// ============================================================
// EU SatCen PROCUREMENT COLLECTOR — V1.1
// European Union Satellite Centre
//
// OUTPUT:
// Default output: ../generated (or PROCUREMENT_OUTPUT_DIR)
//
// METHODOLOGY
// 1) Official TED Search API for formal SatCen procurement notices, 2020-present.
// 2) Official SatCen "Ongoing calls for tender" page for live/open procedures.
// 3) Official SatCen "Low and middle value contracts" page for below-threshold
//    current opportunities that may not be published in TED.
// 4) Official SatCen "Completed calls for tender" page and annual low/middle-value
//    contract PDFs for historical below-threshold procurement, 2020-present.
//
// CHECKPOINTS:
// _SATCEN_CACHE/<run-date>/
//
// OUTPUT:
// GitHub-friendly CSV/JSON. Files are automatically chunked before 90 MB.
// ============================================================

const OUTPUT_DIR = path.resolve(process.env.PROCUREMENT_OUTPUT_DIR || path.join(__dirname, "../generated"));

const TODAY = new Date().toISOString().slice(0, 10);
const CACHE_DIR = path.join(OUTPUT_DIR, "_SATCEN_CACHE", TODAY);

const TED_API =
  "https://api.ted.europa.eu/v3/notices/search";

const ONGOING_URL =
  "https://www.satcen.europa.eu/procurement/ongoing-calls-tender";

const LOW_MIDDLE_URL =
  "https://www.satcen.europa.eu/procurement/low-and-middle-value-contracts";

const COMPLETED_URL =
  "https://www.satcen.europa.eu/procurement/completed-calls-for-tender";

const START_YEAR = 2020;
const END_YEAR = new Date().getFullYear();

// Official SatCen annual low/middle-value award PDFs.
// Used as a fallback if the completed-calls HTML page does not expose links
// to axios/cheerio in the local environment.
const OFFICIAL_ANNUAL_AWARD_PDFS = [
  {
    year: 2020,
    url: "https://www.satcen.europa.eu/keydocuments/List%20of%20low%20and%20medium%20value%20contracts%20awarded%20in%202020_amendment60e856d4531f52000180b132.pdf"
  },
  {
    year: 2021,
    url: "https://www.satcen.europa.eu/keydocuments/List%20of%20low%20and%20medium%20value%20contracts%20awarded%20in%20202162cd9270601f2a0001d77bf3.pdf"
  },
  {
    year: 2022,
    url: "https://www.satcen.europa.eu/keydocuments/List%20of%20low%20and%20medium%20value%20contracts%20awarded%20in%202022649d9315eb04f60001240997.pdf"
  },
  {
    year: 2023,
    url: "https://www.satcen.europa.eu/keydocuments/List%20of%20low%20and%20medium%20value%20contracts%20awarded%20in%202023667ebe69c180facab99e54ce.pdf"
  },
  {
    year: 2024,
    url: "https://www.satcen.europa.eu/keydocuments/List%20of%20middle%20and%20low-value%20contracts%20awarded%20in%202024685a80e108d771430f0ec547.pdf"
  },
  {
    year: 2025,
    url: "https://www.satcen.europa.eu/keydocuments/SatCen%202025%20List%20of%20Low%20and%20Medium%20Value%20Contracts%20Awarded%206a422d523b32b6b65b531b6b.pdf"
  }
];


const PAGE_SIZE = 250;
const WAIT_MS = 1000;
const RETRY_START_MS = 10000;
const RETRY_MAX_MS = 120000;
const CSV_MAX_BYTES = 90 * 1024 * 1024;

const FORCE_REFRESH =
  String(process.env.SATCEN_FORCE_REFRESH || "").trim() === "1";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154 Safari/537.36 " +
  "SatCen-Procurement-Collector/1.0";

const TED_FIELDS = [
  "publication-number",
  "publication-date",
  "notice-title",
  "title-proc",
  "description-proc",
  "description-lot",
  "buyer-name",
  "buyer-country",
  "buyer-legal-type",
  "buyer-identifier",
  "main-activity",
  "form-type",
  "notice-type",
  "notice-subtype",
  "procedure-type",
  "procedure-identifier",
  "contract-nature-main-proc",
  "classification-cpv",
  "main-classification-proc",
  "additional-classification-proc",
  "estimated-value-proc",
  "estimated-value-cur-proc",
  "deadline",
  "deadline-receipt-tender-date-lot",
  "deadline-receipt-tender-time-lot",
  "winner-name",
  "result-value-notice",
  "result-value-cur-notice",
  "links"
];

const BUYER_QUERIES = [
  'buyer-name = "European Union Satellite Centre"',
  'buyer-name = "European Union Satellite Centre (Satcen)"',
  'buyer-name = "European Union Satellite Centre (SatCen)"'
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

function flatten(v) {
  if (v === undefined || v === null) return "";
  if (
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean"
  ) return String(v);

  if (Array.isArray(v)) return v.map(flatten).join(" ");

  if (typeof v === "object") {
    if (v.eng) return flatten(v.eng);
    if (v.ita) return flatten(v.ita);
    if (v.fra) return flatten(v.fra);
    if (v.spa) return flatten(v.spa);
    if (v.deu) return flatten(v.deu);
    return Object.values(v).map(flatten).join(" ");
  }

  return "";
}

function clean(v) {
  return flatten(v)
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniq(values) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function firstNumber(v) {
  for (const x of arr(v)) {
    const n = Number(x);
    if (Number.isFinite(n)) return n;
  }
  return "";
}

function parseDate(v) {
  const s = clean(v);
  if (!s) return null;

  const t = Date.parse(s);
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

function readCache(name, binary = false) {
  const file = cachePath(name);
  if (!FORCE_REFRESH && fs.existsSync(file)) {
    return fs.readFileSync(file, binary ? undefined : "utf8");
  }
  return null;
}

function saveCache(name, content) {
  fs.writeFileSync(cachePath(name), content);
}

async function withRetry(fn, label) {
  let wait = RETRY_START_MS;

  while (true) {
    try {
      return await fn();
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

async function getText(url, label = url) {
  return withRetry(async () => {
    const r = await axios.get(url, {
      responseType: 'text', transformResponse: [value => value],
      timeout: 120000,
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "en"
      }
    });
    return String(r.data || "");
  }, label);
}

async function getBuffer(url, label = url) {
  return withRetry(async () => {
    const r = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 120000,
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "en"
      }
    });
    return Buffer.from(r.data);
  }, label);
}

// ------------------------------------------------------------
// SPACE RELEVANCE
// ------------------------------------------------------------

const CORE = [
  "satellite imagery", "satellite image", "satellite images",
  "satellite data", "satellite acquisition", "satellite acquisitions",
  "satellite catalogue", "satellite catalog",
  "earth observation", "remote sensing",
  "geospatial intelligence", "geoint",
  "imagery intelligence", "imint",
  "copernicus", "sentinel",
  "in-orbit", "in orbit", "on-board data processing",
  "onboard data processing", "space-representative",
  "space based", "space-based",
  "synthetic aperture radar", "sar simulator",
  // NOTE: authority-name terms such as "SatCen" or "Satellite Centre"
  // are intentionally NOT relevance evidence. Otherwise ordinary
  // corporate procurements would be misclassified as space.
];

const MISSION_SUPPORT = [
  "geospatial products", "digital mapping",
  "reference mapping", "mapping products",
  "geohub", "multisource analytical",
  "electronic tasking", "tasking tool",
  "blaze terra", "envi", "sarscape",
  "geospatial software", "geospatial solution",
  "image processing", "imagery exploitation",
  "digital twin of the earth",
  "ai framework for imint", "artificial intelligence framework for imint",
  "operational protocols"
];

const CORPORATE = [
  "catering", "cleaning", "language courses",
  "workstations", "monitors", "laptops", "peripherals",
  "telephone lines", "travel agency", "office furniture",
  "network switches", "firewall", "palo alto", "gitlab",
  "red hat", "commvault", "citrix", "splunk enterprise",
  "tenable", "insurance", "medical services",
  "electrical systems", "photovoltaic", "security systems",
  "public address system", "structured network cabling",
  "servers and provision", "server maintenance"
];

function classify(text, cpv = "") {
  const t = clean(text).toLowerCase();

  const core = CORE.filter(x => t.includes(x));
  const mission = MISSION_SUPPORT.filter(x => t.includes(x));
  const corp = CORPORATE.filter(x => t.includes(x));

  const cpvs = clean(cpv);
  const geoCpv =
    /\b(71354100|72316000|73200000|73210000|73100000)\b/.test(cpvs);

  if (core.length) {
    return {
      decision: "AUTO_KEEP",
      classification: "CORE SPACE / GEOINT",
      domain: detectDomain(t),
      confidence: "HIGH",
      evidence: uniq([...core, geoCpv ? "supporting CPV" : ""]).join(" | ")
    };
  }

  if (mission.length && !corp.length) {
    return {
      decision: "AUTO_KEEP",
      classification: "SPACE-ENABLED / MISSION SUPPORT",
      domain: detectDomain(t),
      confidence: "HIGH",
      evidence: mission.join(" | ")
    };
  }

  if (mission.length && corp.length) {
    return {
      decision: "MANUAL_REVIEW",
      classification: "POSSIBLE SPACE MISSION SUPPORT",
      domain: detectDomain(t),
      confidence: "MEDIUM",
      evidence: uniq([...mission, ...corp]).join(" | ")
    };
  }

  return {
    decision: "AUTO_EXCLUDE",
    classification: "CORPORATE / NON-SPACE",
    domain: "",
    confidence: "LOW",
    evidence: corp.join(" | ")
  };
}

function detectDomain(t) {
  if (/(copernicus|sentinel|earth observation|satellite imagery|remote sensing)/.test(t)) {
    return "Earth Observation / Copernicus";
  }
  if (/(geoint|geospatial intelligence|imint|imagery intelligence)/.test(t)) {
    return "GEOINT / IMINT";
  }
  if (/(synthetic aperture radar|sar simulator|sarscape)/.test(t)) {
    return "SAR";
  }
  if (/(on-board data processing|onboard data processing|in-orbit|in orbit)/.test(t)) {
    return "On-board / In-orbit Processing";
  }
  if (/(mapping|geospatial products|geohub|digital twin)/.test(t)) {
    return "Geospatial / Mapping";
  }
  return "Space Mission Support";
}

function buildRagText(r) {
  return [
    `Authority: ${r.authority}`,
    `Source: ${r.sourceType}`,
    `Reference: ${r.reference}`,
    `Title: ${r.title}`,
    `Description: ${r.description}`,
    `Publication date: ${r.publicationDate}`,
    `Deadline: ${r.deadline}`,
    `Status: ${r.status}`,
    `Stage: ${r.stage}`,
    `CPV: ${r.cpv}`,
    `Estimated value: ${r.estimatedValue} ${r.currency}`.trim(),
    `Winner/Contractor: ${r.contractor}`,
    `Space classification: ${r.spaceClassification}`,
    `Space domain: ${r.spaceDomain}`,
    `Relevance decision: ${r.relevanceDecision}`,
    `Relevance evidence: ${r.relevanceEvidence}`,
    `Source URL: ${r.sourceURL}`
  ].filter(Boolean).join("\n");
}

// ------------------------------------------------------------
// TED
// ------------------------------------------------------------

async function tedPost(body) {
  return withRetry(async () => {
    const r = await axios.post(
      TED_API,
      body,
      {
        timeout: 120000,
        headers: {
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT
        }
      }
    );
    return r.data;
  }, "TED API");
}

function tedQuery(buyerQuery, year) {
  return (
    `${buyerQuery} ` +
    `AND publication-date >= ${year}0101 ` +
    `AND publication-date <= ${year}1231`
  );
}

function tedCacheName(queryIndex, year) {
  return `ted-${queryIndex}-${year}.json`;
}

async function collectTedQuery(queryIndex, buyerQuery, year) {
  const name = tedCacheName(queryIndex, year);
  const cached = readCache(name);

  if (cached !== null) {
    console.log(`TED q${queryIndex} ${year}: checkpoint`);
    return JSON.parse(cached);
  }

  const rows = [];
  let nextToken = "";

  while (true) {
    const body = {
      query: tedQuery(buyerQuery, year),
      limit: PAGE_SIZE,
      fields: TED_FIELDS,
      paginationMode: "ITERATION"
    };

    if (nextToken) body.iterationNextToken = nextToken;

    const data = await tedPost(body);
    const notices = arr(data.notices);

    rows.push(...notices);

    nextToken = clean(data.iterationNextToken);

    console.log(
      `TED q${queryIndex} ${year}: +${notices.length}, total ${rows.length}`
    );

    if (!notices.length || !nextToken) break;
    await sleep(WAIT_MS);
  }

  saveCache(name, JSON.stringify(rows, null, 2));
  return rows;
}

function tedDeadline(n) {
  const dates = [
    ...arr(n["deadline-receipt-tender-date-lot"]),
    ...arr(n["deadline"])
  ].map(clean).filter(Boolean);

  const times =
    arr(n["deadline-receipt-tender-time-lot"])
      .map(clean)
      .filter(Boolean);

  const candidates = [];

  for (let i = 0; i < dates.length; i++) {
    const d = dates[i];
    const t = times[i] || times[0] || "";

    candidates.push(
      t && /^\d{4}-\d{2}-\d{2}$/.test(d)
        ? `${d}T${t}`
        : d
    );
  }

  const parsed = candidates
    .map(raw => ({ raw, d: parseDate(raw) }))
    .filter(x => x.d)
    .sort((a,b) => a.d - b.d);

  return parsed.length
    ? parsed[parsed.length - 1].d.toISOString()
    : "";
}

function normalizeTed(n) {
  const title =
    clean(n["title-proc"]) ||
    clean(n["notice-title"]);

  const description =
    clean(n["description-proc"]) ||
    clean(n["description-lot"]);

  const cpv = uniq([
    ...arr(n["classification-cpv"]),
    ...arr(n["main-classification-proc"]),
    ...arr(n["additional-classification-proc"])
  ]).join(" | ");

  const form = clean(n["form-type"]).toLowerCase();
  const deadline = tedDeadline(n);

  const winner =
    uniq(arr(n["winner-name"])).join(" | ");

  let status = "";
  let stage = "";

  if (form === "result" || winner) {
    status = "CLOSED";
    stage = "Result / Award";
  } else if (form === "planning") {
    status = "PLANNED";
    stage = "Planning";
  } else if (deadline) {
    status = isFuture(deadline) ? "OPEN" : "CLOSED";
    stage = status === "OPEN" ? "Competition / Open" : "Competition / Closed";
  } else {
    status = "UNKNOWN";
    stage = clean(n["form-type"]);
  }

  const url =
    `https://ted.europa.eu/en/notice/-/detail/${clean(n["publication-number"])}`;

  const cls = classify(`${title} ${description}`, cpv);

  const row = {
    sourceType: "TED",
    sourceAuthority: "Publications Office / TED",
    authority: "European Union Satellite Centre",
    reference:
      clean(n["procedure-identifier"]) ||
      clean(n["publication-number"]),
    internalReference: "",
    title,
    description,
    publicationDate: iso(n["publication-date"]),
    deadline,
    status,
    openNow: status === "OPEN" ? "YES" : "NO",
    stage,
    procedureType: clean(n["procedure-type"]),
    cpv,
    estimatedValue: firstNumber(n["estimated-value-proc"]),
    currency: clean(n["estimated-value-cur-proc"]),
    contractor: winner,
    awardValue: firstNumber(n["result-value-notice"]),
    awardCurrency: clean(n["result-value-cur-notice"]),
    sourceURL: url,
    sourceRecordId: clean(n["publication-number"]),
    sourceDataProvenance: "Official TED API",
    sourceDataAltered: "NO - normalized from official TED fields",
    relevanceDecision: cls.decision,
    spaceClassification: cls.classification,
    spaceDomain: cls.domain,
    relevanceConfidence: cls.confidence,
    relevanceEvidence: cls.evidence,
    ragText: ""
  };

  row.ragText = buildRagText(row);
  return row;
}

async function collectTed() {
  console.log("\n=== TED formal SatCen procurement 2020-present ===");

  const notices = [];

  for (let qi = 0; qi < BUYER_QUERIES.length; qi++) {
    for (let year = START_YEAR; year <= END_YEAR; year++) {
      const part = await collectTedQuery(
        qi + 1,
        BUYER_QUERIES[qi],
        year
      );
      notices.push(...part);
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
// SatCen ongoing formal calls
// ------------------------------------------------------------

function parseMoney(text) {
  const m = clean(text).match(
    /(?:€\s*)?([\d.,]+)\s*EUR|([\d.,]+)\s*€/i
  );
  return m ? clean(m[1] || m[2]) : "";
}

function parsePageDate(text, label) {
  const re = new RegExp(
    `${label}\\s*:?\\s*(\\d{1,2}[\\/.-]\\d{1,2}[\\/.-]20\\d{2}(?:\\s*-?\\s*\\d{1,2}:\\d{2})?)`,
    "i"
  );
  const m = clean(text).match(re);
  return m ? iso(m[1]) : "";
}

const currentSourceChecks=[];
async function currentApi(kind){try{const result=await require('../../current/satcen.cjs').collect(kind,{readCache,saveCache,getText,cheerio});currentSourceChecks.push(result.check);return result.rows.map(r=>{const cls=classify(r.title+' '+r.description,r.cpv);const row={...r,authority:'European Union Satellite Centre',sourceAuthority:'European Union Satellite Centre',relevanceDecision:cls.decision,spaceClassification:cls.classification,spaceDomain:cls.domain,relevanceConfidence:cls.confidence,relevanceEvidence:cls.evidence};row.ragText=buildRagText(row);return row;});}catch(e){currentSourceChecks.push({source:kind,state:'failed',checkedAt:new Date().toISOString(),error:e.message});console.error('SatCen current API failed: '+e.message);return [];}}
async function collectOngoing(){return currentApi('ongoing');}
async function collectLowMiddleCurrent(){return currentApi('low-middle');}

async function collectOngoingLegacy() {
  console.log("\n=== SatCen ongoing calls ===");

  const cache = "satcen-ongoing.html";
  let html = readCache(cache);

  if (html !== null) {
    console.log("Ongoing page: checkpoint");
  } else {
    html = await getText(ONGOING_URL, "SatCen ongoing");
    saveCache(cache, html);
  }

  const $ = cheerio.load(html);
  const text = clean($("body").text());

  const refs =
    [...text.matchAll(/\bSATCEN\/20\d{2}\/OP\/\d{4}\b/gi)]
      .map(m => m[0]);

  const rows = [];

  for (const ref of uniq(refs)) {
    const start = text.toUpperCase().indexOf(ref.toUpperCase());
    const next = text.toUpperCase().indexOf("SATCEN/20", start + ref.length);
    const block = text.slice(start, next > start ? next : start + 7000);

    const before = text.slice(Math.max(0, start - 500), start);
    const title =
      clean(before.split(/PPMT REFERENCE/i)[0].split(/\s{2,}/).pop()) ||
      clean(block.split(/PPMT REFERENCE/i)[0]);

    const internal =
      (block.match(/INTERNAL REFERENCE\s*:\s*([A-Z0-9\/.-]+)/i) || [])[1] || "";

    const description =
      clean(
        (block.match(/Description(?: of the procurement)?\s*:\s*(.+?)(?:Estimated total value|Duration of the contract|Procurement documents)/i) || [])[1]
      );

    const cpv =
      (block.match(/Main CPV code\s*:\s*(\d{8})/i) || [])[1] || "";

    const deadline = parsePageDate(block, "Deadline for receipt of tenders");
    const publicationDate =
      parsePageDate(block, "Launch date");

    const cls = classify(`${title} ${description}`, cpv);

    const row = {
      sourceType: "SatCen Website - Ongoing",
      sourceAuthority: "European Union Satellite Centre",
      authority: "European Union Satellite Centre",
      reference: ref,
      internalReference: internal,
      title,
      description,
      publicationDate,
      deadline,
      status: deadline && isFuture(deadline) ? "OPEN" : "UNKNOWN",
      openNow: deadline && isFuture(deadline) ? "YES" : "NO",
      stage: "Competition / Open",
      procedureType:
        /open procedure/i.test(block) ? "Open Procedure" : "",
      cpv,
      estimatedValue: parseMoney(block),
      currency: "EUR",
      contractor: "",
      awardValue: "",
      awardCurrency: "",
      sourceURL: ONGOING_URL,
      sourceRecordId: ref,
      sourceDataProvenance: "Official SatCen procurement website",
      sourceDataAltered: "NO - normalized from official SatCen page",
      relevanceDecision: cls.decision,
      spaceClassification: cls.classification,
      spaceDomain: cls.domain,
      relevanceConfidence: cls.confidence,
      relevanceEvidence: cls.evidence,
      ragText: ""
    };

    row.ragText = buildRagText(row);
    rows.push(row);
  }

  console.log(`Ongoing calls parsed: ${rows.length}`);
  return rows;
}

// ------------------------------------------------------------
// SatCen current low/middle value opportunities
// ------------------------------------------------------------

async function collectLowMiddleCurrentLegacy() {
  console.log("\n=== SatCen low/middle-value current opportunities ===");

  const cache = "satcen-low-middle.html";
  let html = readCache(cache);

  if (html !== null) {
    console.log("Low/middle page: checkpoint");
  } else {
    html = await getText(LOW_MIDDLE_URL, "SatCen low/middle");
    saveCache(cache, html);
  }

  const $ = cheerio.load(html);
  const body = clean($("body").text());

  if (/There are no pending procedures currently/i.test(body)) {
    console.log("No pending low/middle-value procedures.");
    return [];
  }

  const rows = [];

  // The page exposes one or more blocks headed with OPEN.
  const parts = body.split(/Low and middle value contract OPEN/i).slice(1);

  for (let i = 0; i < parts.length; i++) {
    const block = parts[i].slice(0, 8000);

    const title =
      clean(
        (block.match(/(?:Check if interested\s*)?(.+?)(?:I\.\s*Description|Description of the contract)/i) || [])[1]
      );

    if (!title) continue;

    const description =
      clean(
        (block.match(/I\.\s*Description of the contract\s*(.+?)(?:II\.|Maximum estimated value|Contract signature|Deadline|$)/i) || [])[1]
      );

    const deadline =
      parsePageDate(block, "Deadline") ||
      parsePageDate(block, "Closing date");

    const cls = classify(`${title} ${description}`, "");

    const row = {
      sourceType: "SatCen Website - Low/Middle Value",
      sourceAuthority: "European Union Satellite Centre",
      authority: "European Union Satellite Centre",
      reference: "",
      internalReference: "",
      title,
      description,
      publicationDate: "",
      deadline,
      status: deadline ? (isFuture(deadline) ? "OPEN" : "CLOSED") : "OPEN",
      openNow: deadline ? (isFuture(deadline) ? "YES" : "NO") : "YES",
      stage: "Negotiated / Below-threshold",
      procedureType: "Low/Middle Value",
      cpv: "",
      estimatedValue: parseMoney(block),
      currency: "EUR",
      contractor: "",
      awardValue: "",
      awardCurrency: "",
      sourceURL: LOW_MIDDLE_URL,
      sourceRecordId: title,
      sourceDataProvenance: "Official SatCen procurement website",
      sourceDataAltered: "NO - normalized from official SatCen page",
      relevanceDecision: cls.decision,
      spaceClassification: cls.classification,
      spaceDomain: cls.domain,
      relevanceConfidence: cls.confidence,
      relevanceEvidence: cls.evidence,
      ragText: ""
    };

    row.ragText = buildRagText(row);
    rows.push(row);
  }

  console.log(`Current low/middle-value rows: ${rows.length}`);
  return rows;
}

// ------------------------------------------------------------
// Annual awarded low/middle-value PDFs 2020-present
// ------------------------------------------------------------

async function completedPageLinks() {
  const cache = "satcen-completed.html";
  let html = readCache(cache);

  if (html === null) {
    html = await getText(COMPLETED_URL, "SatCen completed");
    saveCache(cache, html);
  } else {
    console.log("Completed page: checkpoint");
  }

  const $ = cheerio.load(html);
  const out = [];

  $("a[href$='.pdf'], a[href*='.pdf?']").each((_, el) => {
    const href = $(el).attr("href");
    const text = clean($(el).text());

    if (!href || !/low|middle|medium/i.test(text + " " + href)) return;

    const full =
      href.startsWith("http")
        ? href
        : `https://www.satcen.europa.eu${href.startsWith("/") ? "" : "/"}${href}`;

    const year =
      Number((text.match(/\b(20\d{2})\b/) || href.match(/\b(20\d{2})\b/) || [])[1]);

    if (year >= START_YEAR && year <= END_YEAR) {
      out.push({ year, url: full, title: text });
    }
  });

  if (!out.length) {
    console.log(
      "Completed-calls page exposed no PDF links to the local parser; using verified official annual-PDF URLs."
    );

    return OFFICIAL_ANNUAL_AWARD_PDFS
      .filter(x => x.year >= START_YEAR && x.year <= END_YEAR)
      .map(x => ({
        year: x.year,
        url: x.url,
        title: `SatCen annual awarded low/middle-value contracts ${x.year}`
      }));
  }

  return out.sort((a,b) => a.year - b.year);
}

function extractAmount(segment) {
  const matches =
    [...clean(segment).matchAll(/([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*€/g)];

  if (!matches.length) return "";

  return matches[matches.length - 1][1];
}

function historicalSegments(text) {
  const t = String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ");

  const refRe =
    /\b(?:TC|OS|AP|OP)\/\d{1,3}\/\d{2}\b/gi;

  const matches = [...t.matchAll(refRe)];
  const out = [];

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end =
      i + 1 < matches.length
        ? matches[i + 1].index
        : Math.min(t.length, start + 2500);

    out.push({
      reference: matches[i][0],
      segment: clean(t.slice(start, end))
    });
  }

  return out;
}

function subjectFromSegment(segment, ref) {
  let s = clean(segment)
    .replace(new RegExp(`^${ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i"), "");

  // Remove trailing amount and contractor-like tail only conservatively.
  s = s.replace(
    /\s+[\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?\s*€.*$/i,
    ""
  );

  return clean(s).slice(0, 1800);
}

async function collectHistoricalLowMiddle() {
  console.log("\n=== SatCen historical low/middle-value awards ===");

  const links = await completedPageLinks();
  console.log(`Annual award PDFs found: ${links.length}`);

  const rows = [];

  for (const item of links) {
    const pdfCache = `low-middle-${item.year}.pdf`;
    let buffer = readCache(pdfCache, true);

    if (buffer === null) {
      buffer = await getBuffer(item.url, `SatCen ${item.year} award PDF`);
      saveCache(pdfCache, buffer);
      await sleep(WAIT_MS);
    } else {
      console.log(`PDF ${item.year}: checkpoint`);
    }

    const textCache = `low-middle-${item.year}.txt`;
    let text = readCache(textCache);

    if (text === null) {
      const parsed = await pdf(buffer);
      text = String(parsed.text || "");
      saveCache(textCache, text);
    }

    const segments = historicalSegments(text);

    console.log(
      `SatCen ${item.year}: ${segments.length} contract-reference segments`
    );

    for (const seg of segments) {
      const subject = subjectFromSegment(seg.segment, seg.reference);
      const cls = classify(subject, "");

      // Exclude repeated specific-contract/modification occurrences only at
      // dedup stage; keep raw evidence now.
      const row = {
        sourceType: "SatCen Annual Low/Middle Award List",
        sourceAuthority: "European Union Satellite Centre",
        authority: "European Union Satellite Centre",
        reference: seg.reference.toUpperCase(),
        internalReference: seg.reference.toUpperCase(),
        title: subject,
        description: seg.segment.slice(0, 5000),
        publicationDate: `${item.year}-12-31T00:00:00.000Z`,
        deadline: "",
        status: "CLOSED",
        openNow: "NO",
        stage: "Historical / Awarded",
        procedureType: "Low/Middle Value or Specific Contract",
        cpv: "",
        estimatedValue: extractAmount(seg.segment),
        currency: "EUR",
        contractor: "",
        awardValue: extractAmount(seg.segment),
        awardCurrency: "EUR",
        sourceURL: item.url,
        sourceRecordId: `${item.year}|${seg.reference}`,
        sourceDataProvenance: "Official SatCen annual awarded-contract PDF",
        sourceDataAltered: "NO - normalized from official SatCen PDF text",
        relevanceDecision: cls.decision,
        spaceClassification: cls.classification,
        spaceDomain: cls.domain,
        relevanceConfidence: cls.confidence,
        relevanceEvidence: cls.evidence,
        ragText: ""
      };

      row.ragText = buildRagText(row);
      rows.push(row);
    }
  }

  return rows;
}

// ------------------------------------------------------------
// MERGE / OUTPUT
// ------------------------------------------------------------

function normalizeRef(v) {
  return clean(v).toUpperCase().replace(/\s+/g, "");
}

function keyFor(r) {
  const ref = normalizeRef(r.internalReference || r.reference);
  if (ref) {
    return `${ref}|${clean(r.title).toLowerCase().slice(0,120)}`;
  }

  if (r.sourceURL && r.title) {
    return `${clean(r.title).toLowerCase().slice(0,180)}|${r.sourceURL}`;
  }

  return `${r.sourceType}|${clean(r.title).toLowerCase()}`;
}

function mergeRows(rows) {
  const map = new Map();

  const priority = r =>
    r.sourceType === "SatCen Website - Ongoing" ? 40 :
    r.sourceType === "SatCen Website - Low/Middle Value" ? 35 :
    r.sourceType === "TED" ? 30 :
    10;

  for (const r of rows) {
    const key = keyFor(r);
    const cur = map.get(key);

    if (!cur) {
      map.set(key, { ...r });
      continue;
    }

    const primary = priority(r) > priority(cur) ? { ...r } : { ...cur };
    const secondary = priority(r) > priority(cur) ? cur : r;

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
  "internalReference",
  "title",
  "description",
  "publicationDate",
  "deadline",
  "status",
  "openNow",
  "stage",
  "procedureType",
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
    const suffix = part === 1 ? "" : `_part${String(part).padStart(2,"0")}`;
    const file = path.join(
      OUTPUT_DIR,
      `${base}_${TODAY}${suffix}.csv`
    );
    fs.writeFileSync(file, content, "utf8");
    files.push(file);
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
  const rows = [
    [
      "TED",
      TED_API,
      "Formal SatCen procurement notices, planning, competition, change and award lifecycle",
      "2020-present"
    ],
    [
      "SatCen Ongoing Calls",
      ONGOING_URL,
      "Current formal calls and current operational deadlines",
      "Live"
    ],
    [
      "SatCen Low/Middle Value",
      LOW_MIDDLE_URL,
      "Current below-threshold negotiated opportunities",
      "Live"
    ],
    [
      "SatCen Completed Calls",
      COMPLETED_URL,
      "Annual awarded low/middle-value contracts and completed procurement references",
      "2020-present annual lists"
    ]
  ];

  const file = path.join(
    OUTPUT_DIR,
    `SatCen_Procurement_Sources_${TODAY}.csv`
  );

  const csv =
    `"sourceType","url","purpose","coverage"\n` +
    rows.map(r => r.map(esc).join(",")).join("\n") +
    "\n";

  fs.writeFileSync(file, csv, "utf8");
  return file;
}

function copyCollector() { return __filename; }

async function main() {
  ensureDirs();

  console.log("==============================================");
  console.log("EU SatCen PROCUREMENT COLLECTOR V1.1");
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log(`Checkpoint: ${CACHE_DIR}`);
  console.log(`Historical start: ${START_YEAR}`);
  console.log("==============================================");

  const ted = await collectTed();
  const ongoing = await collectOngoing();
  const lowCurrent = await collectLowMiddleCurrent();
  const lowHistorical = await collectHistoricalLowMiddle();

  if (!ongoing.length && ted.some(r => r.openNow === "YES")) {
    console.log(
      "NOTE: SatCen ongoing webpage produced 0 parsed rows locally, but TED contains current/open SatCen notices. TED remains the formal current-source fallback."
    );
  }

  const all = mergeRows([
    ...ted,
    ...ongoing,
    ...lowCurrent,
    ...lowHistorical
  ]).sort((a,b) => {
    const da = parseDate(a.publicationDate);
    const db = parseDate(b.publicationDate);
    return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
  });

  const relevant = all.filter(
    r =>
      r.relevanceDecision === "AUTO_KEEP" ||
      r.relevanceDecision === "MANUAL_REVIEW"
  );

  const ragReady = relevant.filter(
    r => r.relevanceDecision === "AUTO_KEEP"
  );

  const manual = relevant.filter(
    r => r.relevanceDecision === "MANUAL_REVIEW"
  );

  const open = relevant
    .filter(r => r.openNow === "YES")
    .sort((a,b) => {
      const da = parseDate(a.deadline);
      const db = parseDate(b.deadline);
      return (da ? da.getTime() : Number.MAX_SAFE_INTEGER) -
             (db ? db.getTime() : Number.MAX_SAFE_INTEGER);
    });

  const historical = relevant.filter(
    r => r.openNow !== "YES" && r.status !== "PLANNED"
  );

  const planned = relevant.filter(
    r => r.status === "PLANNED"
  );

  const files = [];
  files.push(...writeCsvChunked("SatCen_Procurement_All", all));
  files.push(...writeCsvChunked("SatCen_Space_Procurement_RAG", ragReady));
  files.push(...writeCsvChunked("SatCen_Open_Space_Procurement", open));
  files.push(...writeCsvChunked("SatCen_Planned_Space_Procurement", planned));
  files.push(...writeCsvChunked("SatCen_Space_Procurement_Historical", historical));
  files.push(...writeCsvChunked("SatCen_Space_Manual_Review", manual));
  files.push(writeSources());
  files.push(copyCollector());

  const summary = {
    runDate: TODAY,
    historicalStart: START_YEAR,
    sourceCounts: {
      ted: ted.length,
      ongoingWebsite: ongoing.length,
      currentSourceChecks,
      currentLowMiddleWebsite: lowCurrent.length,
      historicalLowMiddlePdfSegments: lowHistorical.length
    },
    totalUniqueProcurementRecords: all.length,
    spaceRelevantIncludingManualReview: relevant.length,
    ragReadySpace: ragReady.length,
    openSpace: open.length,
    plannedSpace: planned.length,
    historicalSpace: historical.length,
    manualReview: manual.length,
    methodology: [
      "Official TED Search API for formal SatCen procurement, 2020-present",
      "Official SatCen Ongoing Calls page for live formal procedures",
      "Official SatCen Low and Middle Value page for current below-threshold opportunities",
      "Official SatCen annual low/middle-value awarded-contract PDFs for historical below-threshold coverage"
    ],
    limitation:
      "Annual awarded low/middle-value PDFs are historical award lists rather than original tender notices. PDF rows are normalized from extracted text and preserve the source PDF URL. Formal open/current procedures are anchored on TED if the SatCen ongoing webpage cannot be parsed locally. Authority-name strings are not treated as space-relevance evidence."
  };

  const summaryFile = path.join(
    OUTPUT_DIR,
    `SatCen_Procurement_Summary_${TODAY}.json`
  );

  fs.writeFileSync(
    summaryFile,
    JSON.stringify(summary, null, 2),
    "utf8"
  );

  files.push(summaryFile);

  console.log("\n==============================================");
  console.log("EU SatCen PROCUREMENT COLLECTION COMPLETE");
  console.log(`TED records: ${ted.length}`);
  console.log(`Current formal website calls: ${ongoing.length}`);
  console.log(`Current low/middle-value opportunities: ${lowCurrent.length}`);
  console.log(`Historical low/middle PDF segments: ${lowHistorical.length}`);
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
  console.error("\nEU SatCen PROCUREMENT COLLECTOR FAILED");
  console.error(err.stack || err.message || err);
  process.exit(1);
});

module.exports = { main, outputDirectory: OUTPUT_DIR };
