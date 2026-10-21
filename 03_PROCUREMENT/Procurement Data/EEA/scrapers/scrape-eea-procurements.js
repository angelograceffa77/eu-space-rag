const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");
const pdf = require("pdf-parse");

// ============================================================
// EEA PROCUREMENT COLLECTOR — V1.3
// European Environment Agency
//
// OUTPUT:
// Default output: ../generated (or PROCUREMENT_OUTPUT_DIR)
//
// SOURCES
// 1) Official TED Search API for formal EEA procurement, 2020-present.
// 2) Official EEA procurement plan 2026 (planned pipeline).
// 3) Official EEA Topic Centre contracting page and anticipated opportunities.
// 4) Official EEA annual awarded-contract PDFs, 2020-present.
//
// SPACE SCOPE
// Copernicus Land Monitoring Service (CLMS), Copernicus In Situ,
// Earth Observation, Sentinel, remote sensing, land-cover mapping,
// CLC+, European Ground Motion Service, geospatial/GIS support.
//
// Generic environmental/IT/corporate procurement is excluded.
// ============================================================

const OUTPUT_DIR = path.resolve(process.env.PROCUREMENT_OUTPUT_DIR || path.join(__dirname, "../generated"));

const TODAY = new Date().toISOString().slice(0, 10);
const CACHE_DIR = path.join(OUTPUT_DIR, "_EEA_CACHE", TODAY);

const TED_API =
  "https://api.ted.europa.eu/v3/notices/search";

const EEA_TENDERS =
  "https://www.eea.europa.eu/en/about/procurement-and-grants/tenders";

const EEA_PROCUREMENT_PLAN =
  "https://www.eea.europa.eu/en/about/procurement-and-grants/procurement-plan-2026.pdf/@@download/file";

const EEA_TOPIC_CENTRES =
  "https://www.eea.europa.eu/en/about/procurement-and-grants/topic-centres-call-for-interest";

const EEA_ANTICIPATED =
  "https://www.eea.europa.eu/en/about/procurement-and-grants/topic-centres-call-for-interest/indicative-contracting-opportunities-010426.pdf/@@download/file";

const EEA_AWARDS =
  "https://www.eea.europa.eu/en/about/procurement-and-grants/contracts-and-grants-awarded";

const VERIFIED_ANNUAL_CONTRACT_PDFS = [
  {
    year: 2020,
    url: "https://www.eea.europa.eu/en/about/procurement-and-grants/contracts-and-grants-awarded/contracts-awarded-by-eea-in-2020.pdf/@@download/file"
  },
  {
    year: 2022,
    url: "https://www.eea.europa.eu/en/about/procurement-and-grants/contracts-and-grants-awarded/list-of-contracts-2022-1.pdf/@@download/file"
  },
  {
    year: 2023,
    url: "https://www.eea.europa.eu/en/about/procurement-and-grants/contracts-and-grants-awarded/list-of-contracts-2022.pdf/@@download/file"
  },
  {
    year: 2024,
    url: "https://www.eea.europa.eu/en/about/procurement-and-grants/contracts-and-grants-awarded/list-of-contracts-2024.pdf/@@download/file"
  },
  {
    year: 2025,
    url: "https://www.eea.europa.eu/en/about/procurement-and-grants/contracts-and-grants-awarded/list-of-contracts-2025.pdf/@@download/file"
  }
];


const START_YEAR = 2020;
const END_YEAR = new Date().getFullYear();

const PAGE_SIZE = 250;
const WAIT_MS = 900;
const CSV_MAX_BYTES = 90 * 1024 * 1024;
const FORCE_REFRESH =
  String(process.env.EEA_FORCE_REFRESH || "").trim() === "1";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154 Safari/537.36 " +
  "EEA-Procurement-Collector/1.0";

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
  "deadline-receipt-tender-time-lot",
  "winner-name",
  "result-value-notice",
  "result-value-cur-notice"
];

const BUYER_QUERIES = [
  'buyer-name = "European Environment Agency"',
  'buyer-name = "European Environment Agency (EEA)"',
  'buyer-name = "EEA — European Environment Agency"'
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
      console.error(`Retrying in ${Math.round(wait/1000)} sec...`);
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
      console.error(`Retrying in ${Math.round(wait/1000)} sec...`);
      await sleep(wait);
      wait = Math.min(wait * 2, 120000);
    }
  }
}


function isPdfBuffer(buffer) {
  return Buffer.isBuffer(buffer) &&
    buffer.length >= 5 &&
    buffer.slice(0, 5).toString("ascii") === "%PDF-";
}

function ensureDownloadUrl(url) {
  if (!url) return "";
  if (/\/@@download\/file(?:$|\?)/i.test(url)) return url;
  if (/\.pdf(?:$|\?)/i.test(url)) {
    return url.replace(/(\.pdf)(\?.*)?$/i, "$1/@@download/file$2");
  }
  return url;
}

// ------------------------------------------------------------
// SPACE CLASSIFICATION
// ------------------------------------------------------------

const STRONG = [
  "copernicus land monitoring service",
  "copernicus land monitoring",
  "clms",
  "copernicus in situ",
  "copernicus in-situ",
  "earth observation",
  "remote sensing",
  "sentinel",
  "satellite",
  "european ground motion service",
  "ground motion service",
  "clc+",
  "corine land cover",
  "land cover",
  "land use",
  "high resolution layer",
  "image mosaics",
  "geospatial",
  "geo-spatial",
  "gis consultancy",
  "geo-statistical validation",
  "product validation",
  "copernicus reference data access node",
  "corda",
  "copernicus and geo and eurogeo",
  "cross-cutting consultancy services",
  "vegetated land cover",
  "non-vegetated land cover",
  "eo and geospatial"
];

const SUPPORT = [
  "in-situ data",
  "in situ data",
  "data integration",
  "spatial data",
  "mapping",
  "reference data"
];

const GENERIC = [
  "canteen", "catering", "office",
  "audit", "financial", "insurance",
  "translation", "cleaning", "travel",
  "recruitment", "human resources"
];

function classify(text) {
  const t = clean(text).toLowerCase();
  const strong = STRONG.filter(x => t.includes(x));
  const support = SUPPORT.filter(x => t.includes(x));
  const generic = GENERIC.filter(x => t.includes(x));

  if (strong.length && !generic.length) {
    return {
      decision: "AUTO_KEEP",
      classification: "SPACE-ENABLED COPERNICUS / EARTH OBSERVATION",
      domain: detectDomain(t),
      confidence: "HIGH",
      evidence: uniq([...strong, ...support]).join(" | ")
    };
  }

  if (support.length && !generic.length) {
    return {
      decision: "MANUAL_REVIEW",
      classification: "POSSIBLE COPERNICUS / GEOSPATIAL SUPPORT",
      domain: detectDomain(t),
      confidence: "MEDIUM",
      evidence: support.join(" | ")
    };
  }

  return {
    decision: "AUTO_EXCLUDE",
    classification: "NON-SPACE / GENERIC EEA PROCUREMENT",
    domain: "",
    confidence: "LOW",
    evidence: generic.join(" | ")
  };
}

function detectDomain(t) {
  if (/copernicus reference data access node|\bcorda\b/.test(t)) return "Copernicus Reference Data / CORDA";
  if (/copernicus and geo and eurogeo|cross-cutting consultancy services/.test(t)) return "Copernicus In Situ / GEO";
  if (/ground motion/.test(t)) return "European Ground Motion Service";
  if (/clc\+|corine land cover/.test(t)) return "Land Cover / CLC+";
  if (/high resolution layer|vegetated land|non-vegetated/.test(t)) return "High Resolution Layers";
  if (/earth observation|remote sensing|sentinel|satellite/.test(t)) return "Earth Observation";
  if (/in[- ]?situ/.test(t)) return "Copernicus In Situ";
  if (/geospatial|geo-spatial|gis|mapping/.test(t)) return "Geospatial / GIS";
  if (/copernicus land monitoring|clms/.test(t)) return "Copernicus Land Monitoring Service";
  return "Land Monitoring / EO Support";
}

function makeRow(base) {
  const cls = classify(`${base.title || ""} ${base.description || ""}`);

  const row = {
    sourceType: base.sourceType || "",
    sourceAuthority: "European Environment Agency",
    authority: "European Environment Agency (EEA)",
    reference: base.reference || "",
    title: base.title || "",
    description: base.description || "",
    publicationDate: base.publicationDate || "",
    deadline: base.deadline || "",
    status: base.status || "",
    openNow: base.openNow || "NO",
    stage: base.stage || "",
    procedureType: base.procedureType || "",
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
// TED FORMAL PROCUREMENT
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
      console.error(`TED API failed${status ? ` HTTP ${status}` : ""}: ${err.message}`);
      console.error(`Retrying in ${Math.round(wait/1000)} sec...`);
      await sleep(wait);
      wait = Math.min(wait * 2, 120000);
    }
  }
}

async function collectTedQuery(qi, buyerQuery, year) {
  const cache = `ted-${qi}-${year}.json`;
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
      limit: PAGE_SIZE,
      fields: TED_FIELDS,
      paginationMode: "ITERATION"
    };

    if (token) body.iterationNextToken = token;

    const data = await tedPost(body);
    const notices = arr(data.notices);
    rows.push(...notices);

    console.log(`TED q${qi} ${year}: +${notices.length}, total ${rows.length}`);

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
  ].map(clean).filter(Boolean);

  const parsed =
    dates.map(x => parseDate(x)).filter(Boolean).sort((a,b) => a-b);

  return parsed.length
    ? parsed[parsed.length-1].toISOString()
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

  let status = "";
  let stage = "";

  if (form === "result" || winner) {
    status = "CLOSED";
    stage = "Result / Award";
  } else if (form === "planning") {
    status = "PLANNED";
    stage = "Planning / PIN";
  } else if (deadline) {
    status = isFuture(deadline) ? "OPEN" : "CLOSED";
    stage = status === "OPEN" ? "Competition / Open" : "Competition / Closed";
  } else {
    status = "UNKNOWN";
    stage = clean(n["form-type"]);
  }

  return makeRow({
    sourceType: "TED",
    reference:
      clean(n["procedure-identifier"]) ||
      clean(n["publication-number"]),
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
      `https://ted.europa.eu/en/notice/-/detail/${clean(n["publication-number"])}`,
    sourceRecordId: clean(n["publication-number"]),
    sourceDataProvenance: "Official TED Search API"
  });
}

async function collectTed() {
  console.log("\n=== EEA formal procurement via TED ===");

  const notices = [];

  for (let qi = 0; qi < BUYER_QUERIES.length; qi++) {
    for (let year = require('../../daily/scope.cjs').active()?END_YEAR:START_YEAR; year <= END_YEAR; year++) {
      const part =
        await collectTedQuery(qi+1, BUYER_QUERIES[qi], year);
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
// PDF PLANNING SOURCES
// ------------------------------------------------------------

async function extractPdfText(url, cacheName, label) {
  let buffer = readCache(cacheName, true);

  if (buffer === null) {
    buffer = await getBuffer(url, label);
    saveCache(cacheName, buffer);
  }

  try {
    const parsed = await pdf(buffer);
    return String(parsed.text || "");
  } catch (err) {
    console.error(`${label} parse failed: ${err.message}`);
    return "";
  }
}

function planningRowsFromText(text, sourceType, sourceURL) {
  const lines =
    String(text || "")
      .split(/\r?\n/)
      .map(clean)
      .filter(Boolean);

  const rows = [];
  const seen = new Set();

  for (let i = 0; i < lines.length; i++) {
    if (
      !/(copernicus|earth observation|remote sensing|ground motion|clms|land monitoring|geospatial|geo-spatial|in[- ]situ)/i.test(lines[i])
    ) continue;

    const context =
      clean(
        lines
          .slice(Math.max(0, i-2), Math.min(lines.length, i+5))
          .join(" | ")
      );

    const key = context.toLowerCase().slice(0,500);
    if (seen.has(key)) continue;
    seen.add(key);

    const ref =
      (context.match(/\bEEA\/[A-Z0-9/.-]+\b/i) || [])[0] || "";

    const deadline =
      (context.match(/\b\d{1,2}[\/.-]\d{1,2}[\/.-]20\d{2}\b/) || [])[0] || "";

    rows.push(
      makeRow({
        sourceType,
        reference: clean(ref),
        title: lines[i].slice(0,1200),
        description: context.slice(0,5000),
        publicationDate: "",
        deadline: iso(deadline),
        status: "PLANNED",
        openNow: "NO",
        stage: "Planning / Procurement Pipeline",
        sourceURL,
        sourceRecordId: `${sourceType}|${i}`,
        sourceDataProvenance: `Official EEA planning document`
      })
    );
  }

  return rows;
}

async function collectPlanning() {
  console.log("\n=== EEA procurement planning ===");

  const planText =
    await extractPdfText(
      EEA_PROCUREMENT_PLAN,
      "procurement-plan-2026.pdf",
      "EEA Procurement Plan 2026"
    );

  const anticipatedText =
    await extractPdfText(
      EEA_ANTICIPATED,
      "anticipated-contracting-2026.pdf",
      "EEA anticipated contracting opportunities 2026"
    );

  const rows = [
    ...planningRowsFromText(
      planText,
      "EEA Procurement Plan",
      EEA_PROCUREMENT_PLAN
    ),
    ...planningRowsFromText(
      anticipatedText,
      "EEA Anticipated Contracting Opportunity",
      EEA_ANTICIPATED
    )
  ];

  console.log(`Planning rows: ${rows.length}`);
  return rows;
}

// ------------------------------------------------------------
// TOPIC CENTRE CURRENT PAGE
// ------------------------------------------------------------

async function collectTopicCentrePage() {
  console.log("\n=== EEA Topic Centre contracting ===");

  let html = readCache("topic-centres.html");

  if (html === null) {
    html = await getText(EEA_TOPIC_CENTRES, "EEA Topic Centres");
    saveCache("topic-centres.html", html);
  } else {
    console.log("Topic Centre page: checkpoint");
  }

  const $ = cheerio.load(html);
  const body = clean($("body").text());

  const rows = [];

  // The page is text/table-like rather than a stable HTML table. Detect the
  // known EEA Topic Centre references and inspect a wide surrounding window.
  const refs =
    uniq(
      [...body.matchAll(/\bEEA\/[A-Z]{2,4}\/TC\/\d{2}\/\d{3}\b/g)]
        .map(m => m[0])
    );

  for (const reference of refs) {
    const idx = body.indexOf(reference);
    if (idx < 0) continue;

    const before = body.slice(Math.max(0, idx - 1200), idx);
    const after = body.slice(idx, Math.min(body.length, idx + 1400));
    const context = clean(`${before} ${after}`);

    if (
      !/(copernicus land monitoring service|copernicus|in situ|in-situ|earth observation|geospatial)/i
        .test(context)
    ) continue;

    let title = "";

    if (/copernicus land monitoring service/i.test(context)) {
      title =
        "Topic Centre on support to the implementation of the Copernicus Land Monitoring Service and In situ coordination";
    } else {
      title =
        clean(
          before
            .split(/EEA\/[A-Z]{2,4}\/TC\/\d{2}\/\d{3}/i)
            .pop()
        ).slice(-700);
    }

    // Capture dd/mm/yyyy hh:mm CET/CEST when present.
    const deadlineMatch =
      after.match(
        /\b(\d{1,2}\/\d{1,2}\/20\d{2})\s+\d{1,2}:\d{2}\s+(?:CEST|CET)\b/i
      );

    const deadline =
      deadlineMatch ? iso(deadlineMatch[1]) : "";

    const status =
      deadline
        ? (isFuture(deadline) ? "OPEN" : "CLOSED")
        : "UNKNOWN";

    // Prefer the actual Funding & Tenders link nearest the matching reference.
    let sourceURL = EEA_TOPIC_CENTRES;

    $("a[href]").each((_, a) => {
      const href = $(a).attr("href") || "";
      const text = clean($(a).text());

      if (
        sourceURL === EEA_TOPIC_CENTRES &&
        /Copernicus Land Monitoring Service/i.test(text)
      ) {
        sourceURL = href;
      }
    });

    rows.push(
      makeRow({
        sourceType: "EEA Topic Centre Call",
        reference,
        title,
        description: context.slice(0, 5000),
        publicationDate: "",
        deadline,
        status,
        openNow: status === "OPEN" ? "YES" : "NO",
        stage: "Current / Topic Centre Contracting",
        sourceURL,
        sourceRecordId: reference,
        sourceDataProvenance: "Official EEA Topic Centre contracting page"
      })
    );
  }

  // Defensive fallback for the current CLMS/In Situ call if HTML structure
  // changes but the official page still contains the published wording.
  if (
    !rows.some(r => r.reference === "EEA/DTL/TC/26/001") &&
    /Topic Centre on support to the implementation of the Copernicus Land Monitoring Service and In situ coordination/i.test(body)
  ) {
    rows.push(
      makeRow({
        sourceType: "EEA Topic Centre Call",
        reference: "EEA/DTL/TC/26/001",
        title:
          "Topic Centre on support to the implementation of the Copernicus Land Monitoring Service and In situ coordination",
        description:
          "Official EEA Topic Centre call supporting implementation of the Copernicus Land Monitoring Service and In situ coordination.",
        publicationDate: "",
        deadline: "2026-10-12T00:00:00.000Z",
        status: isFuture("2026-10-12") ? "OPEN" : "CLOSED",
        openNow: isFuture("2026-10-12") ? "YES" : "NO",
        stage: "Current / Topic Centre Contracting",
        sourceURL:
          "https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/tender-details/757ab711-4ddf-4c73-94bb-af886276ca5d-CN",
        sourceRecordId: "EEA/DTL/TC/26/001",
        sourceDataProvenance: "Official EEA Topic Centre contracting page"
      })
    );
  }

  console.log(`Topic Centre space rows: ${rows.length}`);
  return rows;
}

// ------------------------------------------------------------
// ANNUAL AWARDED CONTRACTS
// ------------------------------------------------------------

async function awardPdfLinks() {
  let html = readCache("awards-page.html");

  if (html === null) {
    html = await getText(EEA_AWARDS, "EEA contracts awarded");
    saveCache("awards-page.html", html);
  }

  const $ = cheerio.load(html);
  const links = [];

  $("a[href]").each((_, a) => {
    const href = $(a).attr("href") || "";
    const text = clean($(a).text());
    const combined = `${text} ${href}`;

    // Explicitly reject grant files: V1 accidentally downloaded them.
    if (/grant[-_ ]agreements?|annual list of grant agreements?/i.test(combined)) return;

    if (!/contract/i.test(combined)) return;
    if (!/\.pdf/i.test(href)) return;

    const y =
      Number(
        (
          text.match(/\b20(20|21|22|23|24|25)\b/) ||
          href.match(/\b20(20|21|22|23|24|25)\b/) ||
          []
        )[0]
      );

    if (y >= START_YEAR && y <= 2025) {
      links.push({
        year: y,
        text,
        url: ensureDownloadUrl(
          href.startsWith("http")
            ? href
            : new URL(href, EEA_AWARDS).href
        )
      });
    }
  });

  // Merge in verified direct file URLs. This also recovers years where the
  // page exposes a wrapper link that axios otherwise downloads as HTML.
  for (const x of VERIFIED_ANNUAL_CONTRACT_PDFS) {
    links.push({
      year: x.year,
      text: `Annual List of Contracts ${x.year}`,
      url: x.url
    });
  }

  const map = new Map();

  for (const x of links) {
    // Keep one direct file per year/URL; prefer @@download/file forms.
    const key = `${x.year}|${x.url.replace(/\/@@download\/file.*$/i, "")}`;
    const cur = map.get(key);

    if (!cur || /\/@@download\/file/i.test(x.url)) {
      map.set(key, x);
    }
  }

  return [...map.values()]
    .filter(x => !/grant[-_ ]agreements?|annual list of grant agreements?/i.test(`${x.text} ${x.url}`))
    .sort((a,b) => a.year - b.year);
}

function awardRowsFromText(text, sourceURL, year) {
  const lines =
    String(text || "")
      .split(/\r?\n/)
      .map(clean)
      .filter(Boolean);

  const rows = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (
      !/(copernicus|clms|earth observation|remote sensing|ground motion|clc\+|land cover|high resolution layer|geospatial|geo-spatial|gis consultancy|product validation|sentinel)/i.test(line)
    ) continue;

    const context =
      clean(
        lines
          .slice(Math.max(0, i-2), Math.min(lines.length, i+3))
          .join(" | ")
      );

    const ref =
      (context.match(/\bEEA\/[A-Z0-9/.-]+\b/i) || [])[0] || "";

    const amount =
      (context.match(/(?:EUR|€)\s*[\d.,]+|[\d.,]+\s*(?:EUR|€)/i) || [])[0] || "";

    rows.push(
      makeRow({
        sourceType: "EEA Awarded Contract",
        reference: clean(ref),
        title: line.slice(0,1200),
        description: context.slice(0,5000),
        publicationDate: `${year}-12-31T00:00:00.000Z`,
        deadline: "",
        status: "CLOSED",
        openNow: "NO",
        stage: "Historical / Awarded Contract",
        contractor: "",
        awardValue: clean(amount).replace(/EUR|€/gi,"").trim(),
        awardCurrency: amount ? "EUR" : "",
        sourceURL,
        sourceRecordId: `${year}|${i}`,
        sourceDataProvenance: "Official EEA annual list of contracts"
      })
    );
  }

  return rows;
}

async function collectAwards() {
  if(require('../../daily/scope.cjs').active())return [];
  console.log("\n=== EEA annual awarded contracts ===");

  const links = await awardPdfLinks();
  console.log(`Annual contract PDFs found: ${links.length}`);
  for (const l of links) {
    console.log(`  - ${l.year}: ${l.url}`);
  }

  const rows = [];
  const processed = new Set();

  for (let i = 0; i < links.length; i++) {
    const l = links[i];

    if (processed.has(l.url)) continue;
    processed.add(l.url);

    const cache = `contracts-v12-${l.year}-${i}.pdf`;
    let buffer = readCache(cache, true);

    if (buffer === null) {
      try {
        buffer = await getBuffer(l.url, `EEA contracts ${l.year}`);
        saveCache(cache, buffer);
      } catch (err) {
        console.error(`Skip ${l.url}: ${err.message}`);
        continue;
      }
      await sleep(WAIT_MS);
    }

    if (!isPdfBuffer(buffer)) {
      const preview =
        buffer.slice(0, 80).toString("utf8").replace(/\s+/g, " ");

      console.error(
        `Skip non-PDF response for ${l.year}: ${l.url} [${preview.slice(0,60)}]`
      );
      continue;
    }

    try {
      const parsed = await pdf(buffer);
      const part =
        awardRowsFromText(parsed.text, l.url, l.year);

      rows.push(...part);

      console.log(
        `Award file ${i+1}/${links.length} (${l.year}); space candidate rows ${rows.length}`
      );
    } catch (err) {
      console.error(`PDF parse failed ${l.url}: ${err.message}`);
    }
  }

  return rows;
}


function normalizeAwardReference(reference, description = "") {
  let s = clean(reference);

  if (!s) {
    const m = clean(description).match(
      /\bEEA\/[A-Z]{2,5}\/(?:R0\/)?\d{2}\/\d{3}(?:\/LOT\s*\d+|\/LOT\d+|-\d+)?\b/i
    );
    s = m ? m[0] : "";
  }

  if (!s) return "";

  // Cut contractor/company text that PDF extraction glued to the reference.
  // Preserve legitimate /LOT n and -n suffixes.
  const m = s.match(
    /\bEEA\/[A-Z]{2,5}\/(?:R0\/)?\d{2}\/\d{3}(?:\/LOT\s*\d+|\/LOT\d+|-\d+)?/i
  );

  if (m) return clean(m[0]).replace(/\s+/g, " ").toUpperCase();

  return s.toUpperCase().slice(0, 80);
}

function extractAwardAmount(text) {
  const s = clean(text);
  const matches = [...s.matchAll(/\b(\d{1,3}(?:[ .]\d{3})*(?:[,.]\d{2}))\b/g)];
  if (!matches.length) return "";
  return matches[matches.length - 1][1].replace(/ /g, "");
}

function extractAwardContractor(description, title, reference) {
  const d = clean(description);
  const t = clean(title);
  const ref = clean(reference);

  let x = d;

  if (ref) x = x.replace(ref, " ");
  if (t) x = x.replace(t, " ");

  x = x
    .replace(/\b\d{1,3}(?:[ .]\d{3})*(?:[,.]\d{2})\b/g, " ")
    .replace(/\bEEA\/[A-Z0-9/.-]+\b/ig, " ")
    .replace(/\s+/g, " ")
    .trim();

  // PDF rows often place contractor immediately before the subject.
  const parts =
    d.split("|")
      .map(clean)
      .filter(Boolean);

  for (const p of parts) {
    if (
      p === t ||
      /copernicus|earth observation|remote sensing|land cover|ground motion|high resolution|geospatial|gis|corda|in situ|in-situ|geo and eurogeo/i.test(p) ||
      /\bEEA\/[A-Z0-9/.-]+/i.test(p) ||
      /^\d[\d .,.]*$/.test(p)
    ) continue;

    if (
      p.length >= 3 &&
      p.length <= 180 &&
      /(?:AG|AS|A\/S|SA|SAS|GMBH|SRL|SPA|BV|LTD|LIMITED|OY|AB|NV|SL|S\.L\.|S\.A\.|CONSORTIUM|UNIVERSITY|INSTITUTE|INSTITUT|GESELLSCHAFT|SPACETEC|GEOVILLE|MAGELLIUM|VISIOTERRA|BILBOMATICA|GAF|ATKINS)/i.test(p)
    ) {
      return p;
    }
  }

  return "";
}

function groupAwardRows(awardRows) {
  const candidates =
    awardRows.filter(
      r =>
        r.relevanceDecision === "AUTO_KEEP" ||
        r.relevanceDecision === "MANUAL_REVIEW"
    );

  const groups = new Map();

  for (const r of candidates) {
    const normalizedReference =
      normalizeAwardReference(r.reference, r.description);

    const year =
      clean(r.publicationDate).slice(0,4) ||
      ((clean(r.sourceRecordId).match(/\b20\d{2}\b/) || [])[0] || "");

    const titleKey =
      clean(r.title)
        .toLowerCase()
        .replace(/\s+/g, " ")
        .slice(0,180);

    const key =
      normalizedReference
        ? `REF|${normalizedReference}`
        : `TITLE|${year}|${titleKey}`;

    const cur = groups.get(key);

    const contractor =
      extractAwardContractor(
        r.description,
        r.title,
        normalizedReference || r.reference
      );

    const amount =
      clean(r.awardValue) ||
      extractAwardAmount(r.description);

    if (!cur) {
      groups.set(key, {
        ...r,
        reference: normalizedReference || clean(r.reference),
        contractor,
        awardValue: amount,
        awardCurrency: amount ? "EUR" : clean(r.awardCurrency),
        sourceRecordId: key,
        additionalSourceURLs: clean(r.sourceURL),
        description: clean(r.description),
        awardFragmentsMerged: "1"
      });
      continue;
    }

    const titles =
      uniq([cur.title, r.title]);

    const descriptions =
      uniq([cur.description, r.description]);

    const contractors =
      uniq([cur.contractor, contractor]);

    const values =
      uniq([cur.awardValue, amount]);

    cur.title = titles.join(" | ").slice(0, 1800);
    cur.description = descriptions.join(" || ").slice(0, 12000);
    cur.contractor = contractors.join(" | ");
    cur.awardValue = values.join(" | ");
    cur.awardCurrency = cur.awardValue ? "EUR" : "";
    cur.additionalSourceURLs =
      uniq([cur.additionalSourceURLs, r.sourceURL]).join(" | ");
    cur.awardFragmentsMerged =
      String(Number(cur.awardFragmentsMerged || 1) + 1);

    // Prefer AUTO_KEEP if any fragment clearly qualifies.
    if (r.relevanceDecision === "AUTO_KEEP") {
      cur.relevanceDecision = "AUTO_KEEP";
      cur.relevanceConfidence = "HIGH";
    }

    groups.set(key, cur);
  }

  const out = [...groups.values()];

  for (const r of out) {
    r.ragText = [
      `Authority: ${r.authority}`,
      `Reference: ${r.reference}`,
      `Title: ${r.title}`,
      `Description: ${r.description}`,
      `Publication date: ${r.publicationDate}`,
      `Status: ${r.status}`,
      `Stage: ${r.stage}`,
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
  if (r.sourceType === "EEA Awarded Contract" && r.sourceRecordId) {
    return `AWARD|${r.sourceRecordId}|${clean(r.title).toLowerCase().slice(0,80)}`;
  }

  const ref = clean(r.reference).toUpperCase();
  if (ref) return `REF|${ref}`;

  return `TITLE|${clean(r.title).toLowerCase().slice(0,180)}`;
}

function priority(r) {
  if (r.sourceType === "EEA Topic Centre Call") return 60;
  if (r.sourceType === "TED") return 50;
  if (r.sourceType === "EEA Procurement Plan") return 40;
  if (r.sourceType === "EEA Anticipated Contracting Opportunity") return 35;
  if (r.sourceType === "EEA Awarded Contract") return 30;
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

    if (cur.openNow === "YES" || r.openNow === "YES") {
      const live = cur.openNow === "YES" ? cur : r;
      primary.status = "OPEN";
      primary.openNow = "YES";
      primary.deadline = live.deadline || primary.deadline;
    } else if (cur.status === "PLANNED" || r.status === "PLANNED") {
      primary.status = "PLANNED";
    }

    primary.ragText = [
      `Authority: ${primary.authority}`,
      `Reference: ${primary.reference}`,
      `Title: ${primary.title}`,
      `Description: ${primary.description}`,
      `Publication date: ${primary.publicationDate}`,
      `Deadline: ${primary.deadline}`,
      `Status: ${primary.status}`,
      `Stage: ${primary.stage}`,
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
  "awardFragmentsMerged",
  "ragText"
];

function esc(v) {
  const s = v === undefined || v === null ? "" : String(v);
  return `"${s.replace(/"/g,'""')}"`;
}

function csvLine(r) {
  return COLUMNS.map(c => esc(r[c])).join(",") + "\n";
}

function writeCsvChunked(base, rows) {
  const header = COLUMNS.map(esc).join(",") + "\n";
  let content = header;
  let bytes = Buffer.byteLength(header,"utf8");
  let part = 1;
  const files = [];

  const flush = () => {
    const suffix =
      part === 1 ? "" : `_part${String(part).padStart(2,"0")}`;

    const f =
      path.join(
        OUTPUT_DIR,
        `${base}_${TODAY}${suffix}.csv`
      );

    fs.writeFileSync(f, content, "utf8");
    files.push(f);

    part++;
    content = header;
    bytes = Buffer.byteLength(header,"utf8");
  };

  for (const r of rows) {
    const line = csvLine(r);
    const b = Buffer.byteLength(line,"utf8");

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
    ["TED", TED_API, "Formal EEA procurement lifecycle", "2020-present"],
    ["EEA Procurement Plan", EEA_PROCUREMENT_PLAN, "Planned EEA procurement", "2026"],
    ["EEA Topic Centres", EEA_TOPIC_CENTRES, "Current Topic Centre contracting", "Current"],
    ["EEA Anticipated Contracting Opportunities", EEA_ANTICIPATED, "Indicative pipeline", "2026"],
    ["EEA Awarded Contracts", EEA_AWARDS, "Annual lists of contracts", "2020-2025"]
  ];

  const f =
    path.join(
      OUTPUT_DIR,
      `EEA_Procurement_Sources_${TODAY}.csv`
    );

  const csv =
    `"sourceType","url","purpose","coverage"\n` +
    rows.map(r => r.map(esc).join(",")).join("\n") +
    "\n";

  fs.writeFileSync(f,csv,"utf8");
  return f;
}

function copyCollector() { return __filename; }

async function main() {
  ensureDirs();

  console.log("==============================================");
  console.log("EEA PROCUREMENT COLLECTOR V1.3");
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log(`Checkpoint: ${CACHE_DIR}`);
  console.log(`Historical start: ${START_YEAR}`);
  console.log("==============================================");

  const ted = await collectTed();
  const planning = await collectPlanning();
  const topic = await collectTopicCentrePage();
  const awards = await collectAwards();

  const all =
    mergeRows([
      ...ted,
      ...planning,
      ...topic,
      ...awards
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

  // Primary procurement RAG: formal procurement + planning + current Topic
  // Centre calls only. Annual award-PDF fragments belong in the dedicated
  // supplier/award intelligence layer below.
  const procurementRelevant =
    relevant.filter(
      r => r.sourceType !== "EEA Awarded Contract"
    );

  const ragReady =
    procurementRelevant.filter(
      r => r.relevanceDecision === "AUTO_KEEP"
    );

  const manual =
    relevant.filter(
      r => r.relevanceDecision === "MANUAL_REVIEW"
    );

  const open =
    procurementRelevant.filter(
      r => r.openNow === "YES"
    );

  const planned =
    procurementRelevant.filter(
      r =>
        r.status === "PLANNED" ||
        /Planning/.test(r.stage)
    );

  const historical =
    procurementRelevant.filter(
      r =>
        r.openNow !== "YES" &&
        r.status !== "PLANNED"
    );

  const groupedAwards =
    groupAwardRows(awards);

  const awardRagReady =
    groupedAwards.filter(
      r => r.relevanceDecision === "AUTO_KEEP"
    );

  const files = [];

  files.push(...writeCsvChunked("EEA_Procurement_All", all));
  files.push(...writeCsvChunked("EEA_Space_Procurement_RAG", ragReady));
  files.push(...writeCsvChunked("EEA_Open_Space_Procurement", open));
  files.push(...writeCsvChunked("EEA_Planned_Space_Procurement", planned));
  files.push(...writeCsvChunked("EEA_Space_Procurement_Historical", historical));
  files.push(...writeCsvChunked("EEA_Space_Manual_Review", manual));
  files.push(...writeCsvChunked("EEA_Space_Awards_Suppliers", awardRagReady));
  files.push(...writeCsvChunked("EEA_Award_Candidates_Audit", awards));
  files.push(writeSources());
  files.push(copyCollector());

  const summary = {
    runDate: TODAY,
    historicalStart: START_YEAR,
    sourceCounts: {
      ted: ted.length,
      planning: planning.length,
      topicCentreSpace: topic.length,
      awardCandidateRows: awards.length
    },
    totalUniqueProcurementRecords: all.length,
    spaceRelevantIncludingManualReview: relevant.length,
    ragReadySpace: ragReady.length,
    groupedSpaceAwardsSuppliers: awardRagReady.length,
    openSpace: open.length,
    plannedSpace: planned.length,
    historicalSpace: historical.length,
    manualReview: manual.length,
    methodology: [
      "Official TED Search API for formal EEA procurement from 2020-present",
      "Official EEA Procurement Plan 2026",
      "Official EEA Topic Centre contracting page with explicit CLMS/In Situ call extraction",
      "Official EEA anticipated contracting opportunities 2026",
      "Official EEA annual lists of contracts 2020-2025 using verified direct-download URLs and PDF signature validation; annual award fragments are grouped into a separate supplier/award intelligence layer rather than mixed into the primary procurement RAG",
      "Conservative classifier focused on CLMS, Copernicus In Situ, Earth Observation, Sentinel, land-cover mapping, European Ground Motion Service and geospatial/GIS procurement"
    ],
    limitations: [
      "EEA above-threshold tender documents are managed through the EU Funding & Tenders Portal; TED provides the formal public procurement lifecycle backbone.",
      "The EEA procurement plan and anticipated contracting lists are indicative and may change before formal publication.",
      "Annual contract PDFs have heterogeneous table layouts; grant-agreement files are excluded, direct PDF bytes are validated before parsing, raw fragments are preserved in the audit output, and production award/supplier records are grouped by normalized EEA reference or year/title fallback.",
      "Generic environmental data, corporate IT and non-EO environmental procurement are not included in the production space RAG."
    ]
  };

  const summaryFile =
    path.join(
      OUTPUT_DIR,
      `EEA_Procurement_Summary_${TODAY}.json`
    );

  fs.writeFileSync(
    summaryFile,
    JSON.stringify(summary,null,2),
    "utf8"
  );

  files.push(summaryFile);

  console.log("\n==============================================");
  console.log("EEA PROCUREMENT COLLECTION COMPLETE");
  console.log(`TED records: ${ted.length}`);
  console.log(`Planning rows: ${planning.length}`);
  console.log(`Topic Centre space rows: ${topic.length}`);
  console.log(`Award candidate rows: ${awards.length}`);
  console.log(`All unique procurement records: ${all.length}`);
  console.log(`Space relevant incl. manual review: ${relevant.length}`);
  console.log(`RAG-ready procurement space: ${ragReady.length}`);
  console.log(`Grouped award/supplier space records: ${awardRagReady.length}`);
  console.log(`OPEN space: ${open.length}`);
  console.log(`PLANNED space: ${planned.length}`);
  console.log(`Historical space: ${historical.length}`);
  console.log(`Manual review: ${manual.length}`);
  console.log("\nGenerated files:");
  for (const f of files) console.log(f);
  console.log("==============================================\n");
}

if (require.main === module) main().catch(err => {
  console.error("\nEEA PROCUREMENT COLLECTOR FAILED");
  console.error(err.stack || err.message || err);
  process.exit(1);
});

module.exports = { main, outputDirectory: OUTPUT_DIR };
