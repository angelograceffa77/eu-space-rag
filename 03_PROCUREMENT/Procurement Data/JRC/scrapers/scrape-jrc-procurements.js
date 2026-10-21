const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");

// ============================================================
// JRC PROCUREMENT COLLECTOR — V1.1
// European Commission Joint Research Centre (JRC)
//
// OUTPUT:
// Default output: ../generated (or PROCUREMENT_OUTPUT_DIR)
//
// SOURCES
// 1) EU Funding & Tenders public Search API, exact JRC authority ID 47352548.
//    Covers open, forthcoming/planned and closed procedures, including
//    middle/low-value prior advertisements exposed by the portal.
// 2) Official TED Search API for the formal procurement lifecycle and awards.
// 3) Official JRC "Work with us" page as authority/provenance validation.
//
// SCOPE
// Non-DEFIS JRC procurement with genuine space relevance:
// Copernicus / Earth Observation / satellite data, remote sensing,
// GNSS / Galileo / EGNOS / PNT, satcom, space-borne receivers,
// geospatial emergency mapping and tightly related dual-use science/technology.
//
// Research-infrastructure "calls for proposals" are intentionally NOT mixed
// into this procurement dataset.
// ============================================================

const OUTPUT_DIR = path.resolve(process.env.PROCUREMENT_OUTPUT_DIR || path.join(__dirname, "../generated"));

const TODAY = new Date().toISOString().slice(0, 10);
const CACHE_DIR = path.join(OUTPUT_DIR, "_JRC_CACHE", TODAY);

const START_YEAR = 2020;
const END_YEAR = new Date().getFullYear();
const CSV_MAX_BYTES = 90 * 1024 * 1024;
const WAIT_MS = 850;

const FORCE_REFRESH =
  String(process.env.JRC_FORCE_REFRESH || "").trim() === "1";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154 Safari/537.36 " +
  "JRC-Procurement-Collector/1.0";

const JRC_LEGAL_ENTITY_ID = "47352548";

const JRC_WORK_WITH_US =
  "https://joint-research-centre.ec.europa.eu/work-us_en";

const FT_API =
  "https://api.tech.ec.europa.eu/search-api/prod/rest/search";

const FT_PORTAL =
  `https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/calls-for-tenders?order=DESC&pageNumber=1&pageSize=50&sortBy=startDate&isExactMatch=true&cftPartyLegalEntityId=${JRC_LEGAL_ENTITY_ID}`;

const TED_API =
  "https://api.ted.europa.eu/v3/notices/search";

const TED_BUYER_QUERIES = [
  'buyer-name = "European Commission, Joint Research Centre (JRC)"',
  'buyer-name = "European Commission, Joint Research Centre"',
  'buyer-name = "European Commission - Joint Research Centre"'
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

// Funding & Tenders status codes commonly used by the Portal.
// We request all three states and normalize them from returned labels/dates.
const FT_STATUS_CODES = [
  "31094501", // forthcoming
  "31094502", // open for submission
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

function readCache(name) {
  const f = cachePath(name);
  if (!FORCE_REFRESH && fs.existsSync(f)) {
    return fs.readFileSync(f, "utf8");
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

      console.error(
        `${label} failed${status ? ` HTTP ${status}` : ""}: ${err.message}`
      );
      console.error(`Retrying in ${Math.round(wait/1000)} sec...`);
      await sleep(wait);
      wait = Math.min(wait * 2, 120000);
    }
  }
}

// ------------------------------------------------------------
// CLASSIFICATION
// ------------------------------------------------------------

const CORE_SPACE = [
  "satellite",
  "space-borne",
  "space borne",
  "spaceborne",
  "space service volume",
  "spacecraft",
  "orbital",
  "satcom",
  "satellite communication",
  "satellite communications",
  "satellite navigation",
  "gnss",
  "galileo",
  "egnos",
  "position navigation and timing",
  "position, navigation and timing",
  "pnt",
  "synthetic aperture radar",
  "sar imagery",
  "sentinel-1",
  "sentinel-2",
  "sentinel-3"
];

const EO_COPERNICUS = [
  "copernicus",
  "earth observation",
  "remote sensing",
  "satellite imagery",
  "satellite images",
  "satellite data",
  "global human settlement layer",
  "ghsl",
  "emergency mapping",
  "rapid mapping",
  "risk and recovery mapping",
  "geospatial intelligence"
];

const DUAL_USE_GEO = [
  "unmanned aerial",
  "uas mapping",
  "drone mapping",
  "geospatial",
  "geo-spatial",
  "gis",
  "mapping services",
  "disaster risk management",
  "emergency management",
  "crisis mapping",
  "radio spectrum",
  "wireless communications"
];

const GENERIC_FALSE_POSITIVE = [
  "office supplies",
  "cleaning",
  "canteen",
  "catering",
  "translation",
  "insurance",
  "travel agency",
  "human resources",
  "recruitment",
  "building works",
  "maintenance of buildings"
];

function detectDomain(t) {
  if (/gnss|galileo|egnos|position[, ]+navigation and timing|\bpnt\b|space service volume/.test(t)) {
    return "GNSS / Galileo / PNT";
  }
  if (/satcom|satellite communication/.test(t)) {
    return "Satellite Communications";
  }
  if (/copernicus|earth observation|remote sensing|satellite imagery|sentinel|ghsl/.test(t)) {
    return "Copernicus / Earth Observation";
  }
  if (/emergency mapping|rapid mapping|risk and recovery mapping|disaster risk management|emergency management/.test(t)) {
    return "Emergency / Disaster Mapping";
  }
  if (/unmanned aerial|uas mapping|drone mapping/.test(t)) {
    return "UAS / Dual-Use Geospatial";
  }
  if (/geospatial|geo-spatial|\bgis\b|mapping services/.test(t)) {
    return "Geospatial / GIS";
  }
  if (/radio spectrum|wireless communications/.test(t)) {
    return "Spectrum / Wireless";
  }
  return "Space-Enabled Science & Technology";
}

function classify(text) {
  const t = clean(text).toLowerCase();

  const generic =
    GENERIC_FALSE_POSITIVE.filter(x => t.includes(x));

  const core =
    CORE_SPACE.filter(x => t.includes(x));

  const eo =
    EO_COPERNICUS.filter(x => t.includes(x));

  const dual =
    DUAL_USE_GEO.filter(x => t.includes(x));

  if ((core.length || eo.length) && !generic.length) {
    return {
      decision: "AUTO_KEEP",
      classification:
        core.length
          ? "CORE SPACE / SPACE-ENABLED"
          : "SPACE-ENABLED COPERNICUS / EARTH OBSERVATION",
      domain: detectDomain(t),
      confidence: "HIGH",
      evidence: uniq([...core, ...eo, ...dual]).join(" | ")
    };
  }

  // Dual-use/geospatial is kept only when at least two contextual signals
  // coexist. One generic word such as "mapping" is not enough.
  if (dual.length >= 2 && !generic.length) {
    return {
      decision: "AUTO_KEEP",
      classification: "DUAL-USE / SPACE-ADJACENT GEOSPATIAL",
      domain: detectDomain(t),
      confidence: "MEDIUM",
      evidence: dual.join(" | ")
    };
  }

  if (dual.length === 1 && !generic.length) {
    return {
      decision: "MANUAL_REVIEW",
      classification: "POSSIBLE DUAL-USE / GEOSPATIAL",
      domain: detectDomain(t),
      confidence: "MEDIUM",
      evidence: dual.join(" | ")
    };
  }

  return {
    decision: "AUTO_EXCLUDE",
    classification: "NON-SPACE / GENERIC JRC PROCUREMENT",
    domain: "",
    confidence: "LOW",
    evidence: generic.join(" | ")
  };
}

function makeRow(base) {
  const cls =
    classify(
      `${base.title || ""} ${base.description || ""} ${base.cpv || ""}`
    );

  const row = {
    sourceType: base.sourceType || "",
    sourceAuthority: "European Commission Joint Research Centre",
    authority: "European Commission - Joint Research Centre (JRC)",
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
// OFFICIAL JRC AUTHORITY PAGE
// ------------------------------------------------------------

async function validateJrcAuthority() {
  console.log("\n=== JRC authority/source validation ===");

  let html = readCache("jrc-work-with-us.html");

  if (html === null) {
    html = await getText(JRC_WORK_WITH_US, "JRC Work with us");
    saveCache("jrc-work-with-us.html", html);
  } else {
    console.log("JRC Work with us: checkpoint");
  }

  const $ = cheerio.load(html);

  let tenderUrl = "";

  $("a[href]").each((_, a) => {
    const text = clean($(a).text());
    const href = $(a).attr("href") || "";

    if (/calls for tender/i.test(text) && /funding-tenders/i.test(href)) {
      tenderUrl = href;
    }
  });

  const ok =
    tenderUrl.includes(`cftPartyLegalEntityId=${JRC_LEGAL_ENTITY_ID}`);

  console.log(`JRC Funding & Tenders authority ID confirmed: ${ok ? "YES" : "NO"}`);
  console.log(`Authority ID: ${JRC_LEGAL_ENTITY_ID}`);

  return {
    confirmed: ok,
    url: tenderUrl || FT_PORTAL
  };
}

// ------------------------------------------------------------
// FUNDING & TENDERS SEARCH API
// ------------------------------------------------------------

async function ftPost(query, pageNumber) {
  let wait = 10000;

  while (true) {
    try {
      const form = new FormData();

      form.append(
        "query",
        new Blob(
          [JSON.stringify(require('../../daily/scope.cjs').sediaQuery(query))],
          { type: "application/json" }
        ),
        "query.json"
      );

      form.append(
        "languages",
        new Blob(
          [JSON.stringify(["en"])],
          { type: "application/json" }
        ),
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
        new Blob(
          [JSON.stringify(FT_DISPLAY_FIELDS)],
          { type: "application/json" }
        ),
        "displayFields.json"
      );

      const url =
        `${FT_API}?apiKey=SEDIA&text=***&pageSize=100&pageNumber=${pageNumber}`;

      const r =
        await axios.post(
          url,
          form,
          {
            timeout: 120000,
            maxRedirects: 10,
            headers: {
              "User-Agent": USER_AGENT,
              "Accept": "application/json, text/plain, */*"
            }
          }
        );

      return r.data;
    } catch (err) {
      const status = err.response && err.response.status;

      // The F&T API occasionally returns 400/500 for schema changes.
      // Do not loop forever: TED remains the formal fallback.
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

  // Common corporate-search shape: results is nested by key.
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

  const publicationDate =
    iso(item.startDate);

  const deadline =
    iso(item.deadlineDate);

  const statusText =
    clean(item.status).toLowerCase();

  let status = "UNKNOWN";
  let stage = "Funding & Tenders";

  if (
    /open|submission|31094502/.test(statusText)
  ) {
    status =
      deadline && !isFuture(deadline)
        ? "CLOSED"
        : "OPEN";
    stage =
      status === "OPEN"
        ? "Competition / Open"
        : "Competition / Closed";
  } else if (
    /forthcoming|planned|31094501/.test(statusText)
  ) {
    status = "PLANNED";
    stage = "Planning / Forthcoming";
  } else if (
    /closed|31094503/.test(statusText)
  ) {
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
  console.log("\n=== EU Funding & Tenders — JRC authority ===");

  const cache = "funding-tenders-jrc.json";
  const cached = readCache(cache);

  if (cached !== null) {
    const rows = JSON.parse(cached);
    console.log(`Funding & Tenders: checkpoint (${rows.length} raw rows)`);
    return rows.map(normalizeFt);
  }

  // The portal link identifies JRC with legal entity ID 47352548.
  // Corporate Search has changed field names historically, so V1 tries
  // both the exact legal-entity field and the authority-name fallback.
  const queries = [
    {
      bool: {
        must: [
          { terms: { status: FT_STATUS_CODES } },
          { term: { cftPartyLegalEntityId: JRC_LEGAL_ENTITY_ID } }
        ]
      }
    },
    {
      bool: {
        must: [
          { terms: { status: FT_STATUS_CODES } },
          { match_phrase: { caName: "JRC - Joint Research Centre" } }
        ]
      }
    }
  ];

  let collected = [];
  let succeeded = false;

  for (let qi = 0; qi < queries.length; qi++) {
    const qrows = [];

    try {
      for (let page = 1; page <= 50; page++) {
        const data = await ftPost(queries[qi], page);
        const items = ftItems(data);

        if (!items.length) break;

        qrows.push(...items);

        const total = ftTotal(data);

        console.log(
          `Funding & Tenders q${qi+1} page ${page}: +${items.length}; total ${qrows.length}` +
          (total !== null ? ` / ${total}` : "")
        );

        if (
          items.length < 100 ||
          (total !== null && qrows.length >= total)
        ) break;

        await sleep(WAIT_MS);
      }

      if (qrows.length) {
        collected.push(...qrows);
        succeeded = true;
      }
    } catch (err) {
      console.log(`Funding & Tenders query ${qi+1} unavailable: ${err.message}`);
    }
  }

  if (!succeeded) {
    console.log(
      "Funding & Tenders API returned no usable JRC rows. " +
      "TED will remain the formal procurement backbone for this run."
    );
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

  const rows = [...map.values()];
  saveCache(cache, JSON.stringify(rows, null, 2));

  console.log(`Funding & Tenders unique raw rows: ${rows.length}`);
  return rows.map(normalizeFt);
}

// ------------------------------------------------------------
// TED
// ------------------------------------------------------------

async function tedPost(body) {
  let wait = 10000;

  while (true) {
    try {
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
        require('../../daily/scope.cjs').active()?require('../../daily/scope.cjs').ted(buyerQuery):`${buyerQuery} AND publication-date >= ${year}0101 AND publication-date <= ${year}1231`,
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

  const form =
    clean(n["form-type"]).toLowerCase();

  const deadline =
    tedDeadline(n);

  const winner =
    uniq(arr(n["winner-name"])).join(" | ");

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

  const pub =
    clean(n["publication-number"]);

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
  console.log("\n=== JRC formal procurement via TED ===");

  const notices = [];

  for (let qi = 0; qi < TED_BUYER_QUERIES.length; qi++) {
    for (let year = require('../../daily/scope.cjs').active()?END_YEAR:START_YEAR; year <= END_YEAR; year++) {
      try {
        const part =
          await collectTedQuery(
            qi + 1,
            TED_BUYER_QUERIES[qi],
            year
          );
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

  const rows =
    [...map.values()].map(normalizeTed);

  console.log(`TED unique notices: ${rows.length}`);
  return rows;
}


function tedProcedureKey(r) {
  const ref = clean(r.reference).toUpperCase();
  if (ref) return `REF|${ref}`;

  const title = clean(r.title).toLowerCase().slice(0, 180);
  return `TITLE|${title}`;
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

    // Preserve strongest lifecycle facts across all notices.
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
    } else if (cur.status === "PLANNED" || r.status === "PLANNED") {
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

    primary.additionalSourceURLs =
      uniq([
        primary.additionalSourceURLs,
        cur.sourceURL,
        r.sourceURL
      ]).join(" | ");

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

  const out = [...groups.values()];

  for (const r of out) {
    r.ragText = [
      `Authority: ${r.authority}`,
      `Reference: ${r.reference}`,
      `Title: ${r.title}`,
      `Description: ${r.description}`,
      `Publication date: ${r.publicationDate}`,
      `Deadline: ${r.deadline}`,
      `Status: ${r.status}`,
      `Stage: ${r.stage}`,
      `TED notice count: ${r.tedNoticeCount}`,
      `Contractor: ${r.contractor}`,
      `Award value: ${r.awardValue} ${r.awardCurrency}`.trim(),
      `Space classification: ${r.spaceClassification}`,
      `Space domain: ${r.spaceDomain}`,
      `Relevance decision: ${r.relevanceDecision}`,
      `Evidence: ${r.relevanceEvidence}`,
      `Source URL: ${r.sourceURL}`
    ].filter(Boolean).join("\n");
  }

  return out;
}

// ------------------------------------------------------------
// MERGE / OUTPUT
// ------------------------------------------------------------

function keyFor(r) {
  const ref =
    clean(r.reference).toUpperCase();

  if (ref) return `REF|${ref}`;

  return (
    `TITLE|${clean(r.title).toLowerCase().slice(0,180)}` +
    `|${clean(r.publicationDate).slice(0,10)}`
  );
}

function priority(r) {
  if (r.sourceType === "EU Funding & Tenders") return 60;
  if (r.sourceType === "TED") return 50;
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

    // Preserve authoritative live status if either official source is open.
    if (cur.openNow === "YES" || r.openNow === "YES") {
      const live =
        cur.openNow === "YES" ? cur : r;

      primary.status = "OPEN";
      primary.openNow = "YES";
      primary.deadline =
        live.deadline || primary.deadline;
      primary.stage = "Competition / Open";
    } else if (
      cur.status === "PLANNED" ||
      r.status === "PLANNED"
    ) {
      primary.status = "PLANNED";
      primary.openNow = "NO";
      primary.stage =
        primary.stage || "Planning / Forthcoming";
    }

    // Re-run classifier after merge because one source may contain a richer
    // description than the other.
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
  const s =
    v === undefined || v === null
      ? ""
      : String(v);

  return `"${s.replace(/"/g, '""')}"`;
}

function csvLine(r) {
  return COLUMNS.map(c => esc(r[c])).join(",") + "\n";
}

function writeCsvChunked(base, rows) {
  const header =
    COLUMNS.map(esc).join(",") + "\n";

  let content = header;
  let bytes =
    Buffer.byteLength(header, "utf8");

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
    bytes =
      Buffer.byteLength(header, "utf8");
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

  if (content !== header || !files.length) {
    flush();
  }

  return files;
}

function writeSources(authority) {
  const rows = [
    [
      "JRC official authority page",
      JRC_WORK_WITH_US,
      `Confirms JRC tender portal authority ID ${JRC_LEGAL_ENTITY_ID}`,
      authority.confirmed ? "Confirmed" : "Not automatically confirmed"
    ],
    [
      "EU Funding & Tenders",
      authority.url || FT_PORTAL,
      "Current, forthcoming/planned and closed JRC procurement including middle/low-value prior advertisements",
      "Current portal dataset"
    ],
    [
      "TED",
      TED_API,
      "Formal JRC procurement lifecycle, notices and awards",
      `${START_YEAR}-present`
    ]
  ];

  const f =
    path.join(
      OUTPUT_DIR,
      `JRC_Procurement_Sources_${TODAY}.csv`
    );

  const csv =
    `"sourceType","url","purpose","coverage"\n` +
    rows
      .map(r => r.map(esc).join(","))
      .join("\n") +
    "\n";

  fs.writeFileSync(f, csv, "utf8");
  return f;
}

function copyCollector() { return __filename; }

async function main() {
  ensureDirs();

  console.log("==============================================");
  console.log("JRC PROCUREMENT COLLECTOR V1.1");
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log(`Checkpoint: ${CACHE_DIR}`);
  console.log(`Historical start: ${START_YEAR}`);
  console.log("==============================================");

  const authority =
    await validateJrcAuthority();

  const ft =
    await collectFundingTenders();

  const ted =
    await collectTed();

  const tedProcedures =
    groupTedByProcedure(ted);

  console.log(`TED procedure groups after lifecycle dedup: ${tedProcedures.length}`);

  const all =
    mergeRows([
      ...ft,
      ...tedProcedures
    ])
    .filter(r => {
      const d =
        parseDate(r.publicationDate);

      return (
        !d ||
        d.getUTCFullYear() >= START_YEAR
      );
    })
    .sort((a,b) => {
      const da =
        parseDate(
          a.publicationDate || a.deadline
        );

      const db =
        parseDate(
          b.publicationDate || b.deadline
        );

      return (
        (db ? db.getTime() : 0) -
        (da ? da.getTime() : 0)
      );
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
        r.status === "PLANNED" ||
        /Planning|Forthcoming/i.test(r.stage)
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

  files.push(
    ...writeCsvChunked(
      "JRC_Procurement_All",
      all
    )
  );

  files.push(
    ...writeCsvChunked(
      "JRC_TED_Notice_Audit",
      ted
    )
  );

  files.push(
    ...writeCsvChunked(
      "JRC_TED_Procedure_Groups",
      tedProcedures
    )
  );

  files.push(
    ...writeCsvChunked(
      "JRC_Space_Procurement_RAG",
      ragReady
    )
  );

  files.push(
    ...writeCsvChunked(
      "JRC_Open_Space_Procurement",
      open
    )
  );

  files.push(
    ...writeCsvChunked(
      "JRC_Planned_Space_Procurement",
      planned
    )
  );

  files.push(
    ...writeCsvChunked(
      "JRC_Space_Procurement_Historical",
      historical
    )
  );

  files.push(
    ...writeCsvChunked(
      "JRC_Space_Awards_Suppliers",
      awards
    )
  );

  files.push(
    ...writeCsvChunked(
      "JRC_Space_Manual_Review",
      manual
    )
  );

  files.push(
    writeSources(authority)
  );

  files.push(
    copyCollector()
  );

  const summary = {
    runDate: TODAY,
    historicalStart: START_YEAR,
    jrcFundingTendersLegalEntityId:
      JRC_LEGAL_ENTITY_ID,
    authorityIdConfirmedFromOfficialJrcPage:
      authority.confirmed,
    sourceCounts: {
      fundingTenders: ft.length,
      tedRawNotices: ted.length,
      tedProcedureGroups: tedProcedures.length
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
      "Official JRC Work with us page used to validate the Funding & Tenders authority identifier 47352548",
      "Official EU Funding & Tenders public Search API for JRC current, forthcoming/planned and closed procurement, including middle/low-value prior advertisements when exposed by the portal",
      "Official TED Search API for formal JRC notices and contract-award data from 2020-present using only Commission/JRC-specific buyer names; TED notices are grouped by procurement procedure before entering the semantic dataset",
      "Conservative space classifier focused on Copernicus/Earth Observation, satellite data/services, remote sensing, GNSS/Galileo/EGNOS/PNT, satcom and tightly contextualized dual-use geospatial/emergency-mapping procurement"
    ],
    limitations: [
      "Research-infrastructure calls for proposals, including open access to JRC laboratories, are opportunities but are not procurement and are intentionally excluded from this procurement dataset.",
      "Generic JRC science, environmental, laboratory, corporate IT and building procurement is not treated as space procurement without explicit space/EO/GNSS or strong dual-use geospatial evidence.",
      "If the Funding & Tenders corporate Search API changes its authority field schema, V1.1 falls back to Commission/JRC-specific TED procedure groups and reports the missing F&T layer in the console.",
      "A generic TED buyer-name search for 'Joint Research Centre' is intentionally excluded because it over-matches unrelated buyers and contaminates recent years."
    ]
  };

  const summaryFile =
    path.join(
      OUTPUT_DIR,
      `JRC_Procurement_Summary_${TODAY}.json`
    );

  fs.writeFileSync(
    summaryFile,
    JSON.stringify(summary, null, 2),
    "utf8"
  );

  files.push(summaryFile);

  console.log("\n==============================================");
  console.log("JRC PROCUREMENT COLLECTION COMPLETE");
  console.log(`Funding & Tenders records: ${ft.length}`);
  console.log(`TED raw notices: ${ted.length}`);
  console.log(`TED procedure groups: ${tedProcedures.length}`);
  console.log(`All unique procurement records: ${all.length}`);
  console.log(`Space relevant incl. manual review: ${relevant.length}`);
  console.log(`RAG-ready space: ${ragReady.length}`);
  console.log(`OPEN space: ${open.length}`);
  console.log(`PLANNED space: ${planned.length}`);
  console.log(`Historical space: ${historical.length}`);
  console.log(`Award/supplier space: ${awards.length}`);
  console.log(`Manual review: ${manual.length}`);
  console.log("\nGenerated files:");

  for (const f of files) {
    console.log(f);
  }

  console.log("==============================================\n");
}

if (require.main === module) main().catch(err => {
  console.error("\nJRC PROCUREMENT COLLECTOR FAILED");
  console.error(err.stack || err.message || err);
  process.exit(1);
});

module.exports = { main, outputDirectory: OUTPUT_DIR };
