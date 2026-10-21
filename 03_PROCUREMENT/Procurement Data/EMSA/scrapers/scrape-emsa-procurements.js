const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");
const pdf = require("pdf-parse");
const xlsx = require("xlsx");

// ============================================================
// EMSA PROCUREMENT COLLECTOR — V1.2
//
// OUTPUT:
// Default output: ../generated (or PROCUREMENT_OUTPUT_DIR)
//
// METHODOLOGY
// 1) Official EMSA ongoing Calls for Tenders page.
// 2) Official EMSA archived calls page (2016-today; production filtered 2020-present).
// 3) Official EMSA Awarded Contracts page and annual XLSX/PDF contract lists.
// 4) Space/EO classifier tuned for maritime satellite services:
//    CleanSeaNet, Copernicus Maritime Surveillance, SAR/optical imagery,
//    SAT-AIS, satellite communications and related EO products.
//
// IMPORTANT
// - Generic maritime/IT procurement is NOT space-relevant.
// - Space relevance requires explicit satellite/EO/SAR/SAT-AIS/SATCOM evidence.
// - Checkpoints are stored under _EMSA_CACHE/<run-date>/.
// - CSV files are split before 90 MB for GitHub compatibility.
// ============================================================

const OUTPUT_DIR = path.resolve(process.env.PROCUREMENT_OUTPUT_DIR || path.join(__dirname, "../generated"));

const TODAY = new Date().toISOString().slice(0, 10);
const CACHE_DIR = path.join(OUTPUT_DIR, "_EMSA_CACHE", TODAY);

const CURRENT_CALLS =
  "https://www.emsa.europa.eu/procurement/calls.html";

const ARCHIVE_CALLS =
  "https://www.emsa.europa.eu/tender-archives/current.html";

const AWARDED_CONTRACTS =
  "https://www.emsa.europa.eu/tender-archives/awarded-contracts.html";

const START_YEAR = 2020;
const END_YEAR = new Date().getFullYear();

const CSV_MAX_BYTES = 90 * 1024 * 1024;
const WAIT_MS = 800;
const RETRY_START_MS = 10000;
const RETRY_MAX_MS = 120000;

const FORCE_REFRESH =
  String(process.env.EMSA_FORCE_REFRESH || "").trim() === "1";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154 Safari/537.36 " +
  "EMSA-Procurement-Collector/1.0";

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

function yearOf(v) {
  const d = parseDate(v);
  return d ? d.getUTCFullYear() : 0;
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

async function requestBuffer(url, label = url) {
  let wait = RETRY_START_MS;

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

const STRONG_SPACE = [
  "satellite image", "satellite images", "satellite imagery",
  "satellite data", "satellite-based", "satellite based",
  "satellite communication", "satellite communications",
  "satcom", "sat-ais", "sat ais", "satellite ais",
  "earth observation", "remote sensing",
  "synthetic aperture radar", "sar imagery",
  "optical sensors", "very high resolution optical",
  "sentinel-1", "sentinel-2", "sentinel 1", "sentinel 2",
  "copernicus maritime surveillance",
  "cleanseanet", "clean sea net",
  "vessel detection via satellite",
  "satellite tasking"
];


// Historical EMSA framework/reference seeds confirmed from official EMSA
// calls and awarded-contract reporting. These allow specific contracts and
// order forms to be recovered even when the annual award row uses a shortened
// subject that does not repeat "satellite" or "Earth Observation".
const SPACE_REFERENCE_SEEDS = [
  "2018/EMSA/OP/06/2018",
  "2019/EMSA/SPNEG/2/2019",
  "2022/EMSA/OP/1/2022",
  "2023/EMSA/SPNEG/1/2023",
  "EMSA/OP/1/2022",
  "EMSA/2025/OP/0027",
  "EMSA/2026/OP/0002"
];

function normalizeReference(v) {
  return clean(v)
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/\\/g, "/");
}

function matchesSpaceReference(text, dynamicRefs = []) {
  const t = normalizeReference(text);

  const refs = uniq([
    ...SPACE_REFERENCE_SEEDS,
    ...dynamicRefs
  ]).map(normalizeReference);

  return refs.some(ref => ref && t.includes(ref));
}

const SPACE_SERVICES = [
  "maritime surveillance",
  "value added products",
  "value-added products",
  "oil spill detection",
  "ship detection",
  "vessel detection",
  "maritime domain awareness"
];

const POSSIBLE = [
  "rpas", "remotely piloted aircraft",
  "ais", "automatic identification system",
  "geospatial", "mapping"
];

function classify(text) {
  const t = clean(text).toLowerCase();

  const strong = STRONG_SPACE.filter(x => t.includes(x));
  const svc = SPACE_SERVICES.filter(x => t.includes(x));
  const possible = POSSIBLE.filter(x => t.includes(x));

  if (strong.length) {
    return {
      decision: "AUTO_KEEP",
      classification: "SPACE-ENABLED APPLICATION / EARTH OBSERVATION",
      domain: detectDomain(t),
      confidence: "HIGH",
      evidence: uniq([...strong, ...svc]).join(" | ")
    };
  }

  if (svc.length && possible.length) {
    return {
      decision: "MANUAL_REVIEW",
      classification: "POSSIBLE SPACE-ENABLED MARITIME SURVEILLANCE",
      domain: detectDomain(t),
      confidence: "MEDIUM",
      evidence: uniq([...svc, ...possible]).join(" | ")
    };
  }

  return {
    decision: "AUTO_EXCLUDE",
    classification: "NON-SPACE / GENERIC EMSA PROCUREMENT",
    domain: "",
    confidence: "LOW",
    evidence: ""
  };
}

function detectDomain(t) {
  if (/(synthetic aperture radar|sar imagery|sentinel-1)/.test(t)) {
    return "SAR / Earth Observation";
  }
  if (/(very high resolution optical|optical sensors|sentinel-2)/.test(t)) {
    return "Optical Earth Observation";
  }
  if (/(sat-ais|sat ais|satellite ais)/.test(t)) {
    return "SAT-AIS";
  }
  if (/(satcom|satellite communication)/.test(t)) {
    return "SATCOM";
  }
  if (/(copernicus maritime surveillance)/.test(t)) {
    return "Copernicus Maritime Surveillance";
  }
  if (/(cleanseanet|clean sea net|oil spill detection)/.test(t)) {
    return "CleanSeaNet / Pollution Monitoring";
  }
  if (/(earth observation|remote sensing|satellite imagery|satellite image)/.test(t)) {
    return "Earth Observation";
  }
  return "Maritime Space-Enabled Services";
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
    `${base.title || ""} ${base.description || ""}`
  );

  const row = {
    sourceType: base.sourceType || "",
    sourceAuthority: "European Maritime Safety Agency",
    authority: "European Maritime Safety Agency (EMSA)",
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
    sourceDataAltered: "NO - normalized from official EMSA source",
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

// ------------------------------------------------------------
// HTML TABLE PARSING
// ------------------------------------------------------------

function absoluteUrl(href, base) {
  if (!href) return "";
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

function parseCallTable(html, sourceType, sourceUrl, archived = false) {
  const $ = cheerio.load(html);
  const rows = [];

  $("table tr").each((i, tr) => {
    if (i === 0) return;

    const cells = $(tr).find("td");
    if (cells.length < 3) return;

    const descCell = cells.eq(0);
    const titleText = clean(descCell.text());
    const publication = clean(cells.eq(1).text());
    const deadlineText = clean(cells.eq(2).text());

    if (!titleText) return;

    const refMatch =
      titleText.match(/\bEMSA\/[A-Z0-9/.-]+\b/i);

    const reference = refMatch ? clean(refMatch[0]) : "";

    let title =
      reference
        ? clean(titleText.replace(reference, ""))
        : titleText;

    const href =
      descCell.find("a[href]").first().attr("href") || "";

    let derivedReference = reference;

    if (!derivedReference && href) {
      const m =
        href.match(/emsa[-/](20\d{2})[-/](op|spneg|neg|cpneg)[-/](\d{3,4})/i);

      if (m) {
        derivedReference =
          `EMSA/${m[1]}/${m[2].toUpperCase()}/${m[3]}`;
      }
    }

    const deadline = iso(deadlineText);
    let status =
      archived
        ? "CLOSED"
        : deadline
        ? (isFuture(deadline) ? "OPEN" : "CLOSED")
        : "UNKNOWN";

    rows.push(
      makeRow({
        sourceType,
        reference: derivedReference,
        title,
        description: titleText,
        publicationDate: iso(publication),
        deadline,
        status,
        openNow: status === "OPEN" ? "YES" : "NO",
        stage: archived ? "Historical / Archived Call" : "Current / Open Call",
        contractor: "",
        value: "",
        currency: "",
        sourceURL: href ? absoluteUrl(href, sourceUrl) : sourceUrl,
        sourceRecordId: derivedReference || title,
        sourceDataProvenance:
          archived
            ? "Official EMSA archived Calls for Tenders page"
            : "Official EMSA ongoing Calls for Tenders page"
      })
    );
  });

  return rows;
}

async function collectCurrentCalls() {
  console.log("\n=== EMSA current Calls for Tenders ===");

  let html = readCache("current-calls.html");

  if (html === null) {
    html = await requestText(CURRENT_CALLS, "EMSA current calls");
    saveCache("current-calls.html", html);
  } else {
    console.log("Current calls: checkpoint");
  }

  const rows = parseCallTable(
    html,
    "EMSA Current Call",
    CURRENT_CALLS,
    false
  );

  console.log(`Current call rows: ${rows.length}`);
  return rows;
}

async function collectArchivedCalls() {
  if(require('../../daily/scope.cjs').active())return [];
  console.log("\n=== EMSA archived Calls for Tenders ===");

  const all = [];
  const seen = new Set();

  for (let start = 0; start <= 500; start += 20) {
    const cacheName = `archived-calls-start-${start}.html`;
    let html = readCache(cacheName);

    if (html === null) {
      const url =
        start === 0
          ? ARCHIVE_CALLS
          : `${ARCHIVE_CALLS}?start=${start}`;

      html = await requestText(
        url,
        `EMSA archived calls start=${start}`
      );
      saveCache(cacheName, html);
      await sleep(WAIT_MS);
    } else {
      console.log(`Archived calls start=${start}: checkpoint`);
    }

    const pageRows = parseCallTable(
      html,
      "EMSA Archived Call",
      start === 0 ? ARCHIVE_CALLS : `${ARCHIVE_CALLS}?start=${start}`,
      true
    );

    if (!pageRows.length) {
      console.log(`Archived calls start=${start}: no rows, stopping.`);
      break;
    }

    let added = 0;
    let oldestYear = 9999;

    for (const r of pageRows) {
      const y = yearOf(r.publicationDate);
      if (y) oldestYear = Math.min(oldestYear, y);

      const key =
        `${normalizeReference(r.reference)}|${clean(r.title).toLowerCase()}`;

      if (!seen.has(key)) {
        seen.add(key);
        all.push(r);
        added++;
      }
    }

    console.log(
      `Archived calls start=${start}: ${pageRows.length} rows, ${added} new; total ${all.length}`
    );

    // EMSA archive is descending. Once a whole page is older than 2020,
    // there is no need to continue.
    const pageYears =
      pageRows
        .map(r => yearOf(r.publicationDate))
        .filter(Boolean);

    if (
      pageYears.length &&
      pageYears.every(y => y < START_YEAR)
    ) {
      console.log("Reached pre-2020 archive rows; stopping pagination.");
      break;
    }
  }

  const filtered =
    all.filter(r => {
      const y = yearOf(r.publicationDate);
      return !y || y >= START_YEAR;
    });

  console.log(`Archived call rows 2020-present: ${filtered.length}`);
  return filtered;
}

// ------------------------------------------------------------
// AWARDED CONTRACTS
// ------------------------------------------------------------

function extractAwardLinks(html) {
  const $ = cheerio.load(html);
  const links = [];

  $("a[href]").each((_, a) => {
    const href = $(a).attr("href") || "";
    const text = clean($(a).text());

    if (!href) return;

    const combined = `${text} ${href}`;

    if (!/\b20(20|21|22|23|24|25)\b/.test(combined)) return;

    if (
      !/contract|specific|order|modification|reporting/i.test(combined)
    ) return;

    let fileType = "";
    if (/\.xlsx?\b/i.test(text)) fileType = "xlsx";
    else if (/\.xls\b/i.test(text)) fileType = "xls";
    else if (/\.pdf\b/i.test(text)) fileType = "pdf";
    else if (/reporting/i.test(text)) fileType = "xlsx";

    links.push({
      text,
      url: absoluteUrl(href, AWARDED_CONTRACTS),
      fileType
    });
  });

  const map = new Map();
  for (const x of links) map.set(x.url, x);
  return [...map.values()];
}

function awardCandidateText(text, dynamicRefs = []) {
  const t = clean(text);

  const directKeyword =
    /(satellite imagery|satellite images|satellite image|satellite data|satellite services|satellite licence|satellite license|earth observation|remote sensing|synthetic aperture radar|SAR imagery|Sentinel-1|Sentinel-2|SAT-AIS|sat ais|Copernicus Maritime Surveillance|CleanSeaNet|TerraSAR|TanDEM-X|COSMO-SkyMed|very high resolution optical|optical earth observation|optical EO)/i.test(t);

  const refMatch =
    matchesSpaceReference(t, dynamicRefs);

  return directKeyword || refMatch;
}

function parseAwardText(text, sourceURL, label, dynamicRefs = []) {
  const rows = [];
  const lines = String(text || "")
    .split(/\r?\n/)
    .map(clean)
    .filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Critical precision rule:
    // the SAME extracted line must contain either explicit space/EO evidence
    // or a known space-framework reference. Neighbouring rows may only enrich
    // the description after the row has qualified.
    if (!awardCandidateText(line, dynamicRefs)) continue;

    const context =
      clean(
        lines
          .slice(Math.max(0, i - 1), Math.min(lines.length, i + 2))
          .join(" | ")
      );

    const refMatch =
      line.match(
        /\b(?:20\d{2}\/)?EMSA\/(?:OP|SPNEG|NEG|CPNEG)\/[A-Z0-9./-]+\b/i
      ) ||
      context.match(
        /\b(?:20\d{2}\/)?EMSA\/(?:OP|SPNEG|NEG|CPNEG)\/[A-Z0-9./-]+\b/i
      );

    const amountMatch =
      line.match(/EUR\s*[\d.,]+|€\s*[\d.,]+/i) ||
      context.match(/EUR\s*[\d.,]+|€\s*[\d.,]+/i);

    rows.push(
      makeRow({
        sourceType: "EMSA Awarded Contract",
        reference: refMatch ? clean(refMatch[0]) : "",
        title: line.slice(0, 1200),
        description: context,
        publicationDate: "",
        deadline: "",
        status: "CLOSED",
        openNow: "NO",
        stage: "Historical / Awarded Contract",
        contractor: "",
        value: amountMatch
          ? clean(amountMatch[0]).replace(/EUR|€/gi, "").trim()
          : "",
        currency: amountMatch ? "EUR" : "",
        sourceURL,
        sourceRecordId: `${label}|${i}`,
        sourceDataProvenance: "Official EMSA awarded-contract publication"
      })
    );
  }

  return rows;
}

function xlsxAwardRows(buffer, link, dynamicRefs = []) {
  const wb = xlsx.read(buffer, { type: "buffer" });
  const rows = [];

  for (const sheetName of wb.SheetNames) {
    const data = xlsx.utils.sheet_to_json(
      wb.Sheets[sheetName],
      { header: 1, defval: "" }
    );

    for (let i = 0; i < data.length; i++) {
      const row = data[i].map(clean);
      const line = clean(row.join(" | "));

      // Same-row qualification only: avoids one satellite row contaminating
      // adjacent unrelated contracts in annual reporting tables.
      if (!awardCandidateText(line, dynamicRefs)) continue;

      const refMatch =
        line.match(
          /\b(?:20\d{2}\/)?EMSA\/(?:OP|SPNEG|NEG|CPNEG)\/[A-Z0-9./-]+\b/i
        );

      const amountCell =
        row.find(x => /(?:EUR|€)\s*[\d.,]+/i.test(x)) || "";

      const amountMatch =
        amountCell.match(/(?:EUR|€)\s*([\d.,]+)/i);

      // Preserve the complete official row. Choose title as the longest
      // descriptive cell and contractor as a shorter entity-like cell.
      const textual =
        row.filter(x =>
          x &&
          !/EMSA\//i.test(x) &&
          !/(?:EUR|€)\s*[\d.,]+/i.test(x) &&
          !/^\d+$/.test(x)
        );

      const title =
        [...textual].sort((a,b) => b.length - a.length)[0] ||
        line.slice(0, 1200);

      const contractor =
        textual.find(x =>
          x !== title &&
          x.length >= 3 &&
          x.length <= 180 &&
          !/(specific contract|order form|framework|contract|subject|description|date|amount)/i.test(x)
        ) || "";

      rows.push(
        makeRow({
          sourceType: "EMSA Awarded Contract",
          reference: refMatch ? clean(refMatch[0]) : "",
          title: title.slice(0, 1200),
          description: line.slice(0, 5000),
          publicationDate: "",
          deadline: "",
          status: "CLOSED",
          openNow: "NO",
          stage: "Historical / Awarded Contract",
          contractor,
          value: amountMatch ? clean(amountMatch[1]) : "",
          currency: amountMatch ? "EUR" : "",
          sourceURL: link.url,
          sourceRecordId: `${link.text}|${sheetName}|${i}`,
          sourceDataProvenance: "Official EMSA awarded-contract publication"
        })
      );
    }
  }

  return rows;
}

async function parseAwardFile(link, index, dynamicRefs = []) {
  let ext = clean(link.fileType).toLowerCase();

  if (!ext) {
    const extMatch = link.url.match(/\.(pdf|xlsx?|xls)(?:$|\?)/i);
    ext = extMatch ? extMatch[1].toLowerCase() : "";
  }

  // EMSA download URLs often end in .html even though the linked file is PDF/XLSX.
  if (!ext) {
    if (/\.pdf/i.test(link.text)) ext = "pdf";
    else if (/\.xlsx?/i.test(link.text) || /reporting/i.test(link.text)) ext = "xlsx";
  }

  const cacheName =
    `award-${String(index).padStart(2,"0")}.${ext || "bin"}`;

  let buffer = readCache(cacheName, true);

  if (buffer === null) {
    try {
      buffer = await requestBuffer(link.url, `EMSA award file ${index+1}`);
      saveCache(cacheName, buffer);
    } catch (err) {
      console.error(`Skip award file ${link.url}: ${err.message}`);
      return [];
    }
    await sleep(WAIT_MS);
  }

  // Detect actual file signature when extension metadata is ambiguous.
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b
  ) {
    ext = "xlsx";
  } else if (
    buffer.slice(0,5).toString("ascii") === "%PDF-"
  ) {
    ext = "pdf";
  }

  if (ext === "pdf") {
    try {
      const parsed = await pdf(buffer);
      return parseAwardText(
        parsed.text,
        link.url,
        link.text,
        dynamicRefs
      );
    } catch (err) {
      console.error(`PDF parse failed ${link.url}: ${err.message}`);
      return [];
    }
  }

  if (ext === "xlsx" || ext === "xls") {
    try {
      return xlsxAwardRows(
        buffer,
        link,
        dynamicRefs
      );
    } catch (err) {
      console.error(`XLS/XLSX parse failed ${link.url}: ${err.message}`);
      return [];
    }
  }

  console.error(`Unknown award file type: ${link.text}`);
  return [];
}

async function collectAwards(dynamicRefs = []) {
  if(require('../../daily/scope.cjs').active())return [];
  console.log("\n=== EMSA awarded contracts ===");

  let html = readCache("awarded-contracts.html");

  if (html === null) {
    html = await requestText(AWARDED_CONTRACTS, "EMSA awarded contracts");
    saveCache("awarded-contracts.html", html);
  } else {
    console.log("Awarded-contracts page: checkpoint");
  }

  const links = extractAwardLinks(html);
  console.log(`Award files 2020-2025 found: ${links.length}`);

  const rows = [];

  for (let i = 0; i < links.length; i++) {
    const part = await parseAwardFile(links[i], i, dynamicRefs);
    rows.push(...part);

    if ((i + 1) % 5 === 0 || i + 1 === links.length) {
      console.log(
        `Award files processed ${i+1}/${links.length}; space candidate rows ${rows.length}`
      );
    }
  }

  return rows;
}

// ------------------------------------------------------------
// MERGE / OUTPUT
// ------------------------------------------------------------

function keyFor(r) {
  if (r.sourceType === "EMSA Awarded Contract" && clean(r.sourceRecordId)) {
    return `AWARD|${clean(r.sourceRecordId).toLowerCase()}`;
  }

  if (clean(r.reference)) {
    return `REF|${clean(r.reference).toUpperCase()}|${clean(r.title).toLowerCase().slice(0,100)}`;
  }

  return `TITLE|${clean(r.title).toLowerCase().slice(0,180)}`;
}

function priority(r) {
  if (r.sourceType === "EMSA Current Call") return 50;
  if (r.sourceType === "EMSA Archived Call") return 40;
  if (r.sourceType === "EMSA Awarded Contract") return 30;
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
      "EMSA Current Calls",
      CURRENT_CALLS,
      "Official ongoing calls for tender; open procedures may link to Funding & Tenders",
      "Current"
    ],
    [
      "EMSA Archived Calls",
      ARCHIVE_CALLS,
      "Official archived calls for tender",
      "2016-today; production filtered 2020-present"
    ],
    [
      "EMSA Awarded Contracts",
      AWARDED_CONTRACTS,
      "Annual awarded contracts, specific contracts, order forms and modifications",
      "2004-2025; production extraction 2020-present"
    ]
  ];

  const f = path.join(
    OUTPUT_DIR,
    `EMSA_Procurement_Sources_${TODAY}.csv`
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
  console.log("EMSA PROCUREMENT COLLECTOR V1.2");
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log(`Checkpoint: ${CACHE_DIR}`);
  console.log(`Historical start: ${START_YEAR}`);
  console.log("==============================================");

  const current = await collectCurrentCalls();
  const archived = await collectArchivedCalls();

  const dynamicSpaceRefs =
    uniq(
      [...current, ...archived]
        .filter(r => r.relevanceDecision === "AUTO_KEEP")
        .map(r => r.reference)
        .filter(Boolean)
    );

  console.log(
    `Space procurement references available for award matching: ${dynamicSpaceRefs.length}`
  );

  const awards = await collectAwards(dynamicSpaceRefs);

  const all =
    mergeRows([
      ...current,
      ...archived,
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
        /planning|prior information/i.test(r.stage)
    );

  const historical =
    relevant.filter(
      r =>
        r.openNow !== "YES" &&
        r.status !== "PLANNED"
    );

  const files = [];
  files.push(...writeCsvChunked("EMSA_Procurement_All", all));
  files.push(...writeCsvChunked("EMSA_Award_Candidates_Audit", awards));
  files.push(...writeCsvChunked("EMSA_Space_Procurement_RAG", ragReady));
  files.push(...writeCsvChunked("EMSA_Open_Space_Procurement", open));
  files.push(...writeCsvChunked("EMSA_Planned_Space_Procurement", planned));
  files.push(...writeCsvChunked("EMSA_Space_Procurement_Historical", historical));
  files.push(...writeCsvChunked("EMSA_Space_Manual_Review", manual));
  files.push(writeSources());
  files.push(copyCollector());

  const summary = {
    runDate: TODAY,
    historicalStart: START_YEAR,
    sourceCounts: {
      currentCalls: current.length,
      archivedCalls2020Present: archived.length,
      spaceAwardCandidatesAfterPrecisionFilter: awards.length
    },
    totalUniqueProcurementRecords: all.length,
    spaceRelevantIncludingManualReview: relevant.length,
    ragReadySpace: ragReady.length,
    openSpace: open.length,
    plannedSpace: planned.length,
    historicalSpace: historical.length,
    manualReview: manual.length,
    methodology: [
      "Official EMSA ongoing Calls for Tenders page",
      "Official EMSA archived Calls for Tenders page with full pagination to 2020",
      "Official EMSA Awarded Contracts page and annual XLSX/PDF contract lists with same-row keyword/reference qualification to prevent cross-row false positives",
      "Conservative maritime-space classifier tuned to satellite imagery, EO, SAR/optical, SAT-AIS, SATCOM, CleanSeaNet and Copernicus Maritime Surveillance"
    ],
    limitations: [
      "Open procedures may have their full procurement documentation hosted on the EU Funding & Tenders Portal; EMSA pages preserve the procurement reference and link.",
      "Awarded-contract annual files have heterogeneous layouts; V1.1 combines keyword matching with known/dynamically discovered space framework references so specific contracts and order forms can be recovered even when their subject is abbreviated.",
      "Generic maritime surveillance, RPAS and AIS procurements are not treated as space unless explicit satellite/EO/SATCOM evidence is present."
    ]
  };

  const summaryFile = path.join(
    OUTPUT_DIR,
    `EMSA_Procurement_Summary_${TODAY}.json`
  );

  fs.writeFileSync(
    summaryFile,
    JSON.stringify(summary, null, 2),
    "utf8"
  );

  files.push(summaryFile);

  console.log("\n==============================================");
  console.log("EMSA PROCUREMENT COLLECTION COMPLETE");
  console.log(`Current call rows: ${current.length}`);
  console.log(`Archived call rows 2020-present: ${archived.length}`);
  console.log(`Space award candidate rows after precision filter: ${awards.length}`);
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
  console.error("\nEMSA PROCUREMENT COLLECTOR FAILED");
  console.error(err.stack || err.message || err);
  process.exit(1);
});

module.exports = { main, outputDirectory: OUTPUT_DIR };
