const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");
const pdf = require("pdf-parse");

// ============================================================
// ECMWF PROCUREMENT COLLECTOR — V1
//
// OUTPUT:
// Default output: ../generated (or PROCUREMENT_OUTPUT_DIR)
//
// SOURCES
// 1) ECMWF Copernicus current ITTs (CAMS / C3S)
// 2) ECMWF Copernicus Procurement Plan (planned pipeline)
// 3) Archived Copernicus ITT pages via Internet Archive (2020-present)
// 4) ECMWF Destination Earth current ITTs
// 5) ECMWF Destination Earth Past ITTs (includes Contract Award links)
//
// The collector deliberately does NOT treat every ECMWF corporate ITT as
// space-related. Copernicus/DestinE technical tenders are retained; generic
// communication/office/ICT procurement is excluded or sent to manual review.
//
// Checkpoints: _ECMWF_CACHE/<run-date>/
// CSV output is split before 90 MB for normal GitHub use.
// ============================================================

const OUTPUT_DIR = path.resolve(process.env.PROCUREMENT_OUTPUT_DIR || path.join(__dirname, "../generated"));

const TODAY = new Date().toISOString().slice(0, 10);
const CACHE_DIR = path.join(OUTPUT_DIR, "_ECMWF_CACHE", TODAY);

const COPERNICUS_PAGE =
  "https://www.ecmwf.int/en/about/suppliers/copernicus-procurement";

const COPERNICUS_CURRENT =
  "https://www.ecmwf.int/en/about/suppliers/copernicus-procurement/update-itts";

const DESTINE_CURRENT =
  "https://www.ecmwf.int/en/about/suppliers/destine-procurement/update-destine-itts";

const DESTINE_PAST =
  "https://www.ecmwf.int/en/about/suppliers/destine-procurement/past-itts";

const WAYBACK_CDX =
  "https://web.archive.org/cdx/search/cdx";

const START_YEAR = 2020;
const END_YEAR = new Date().getFullYear();

const CSV_MAX_BYTES = 90 * 1024 * 1024;
const WAIT_MS = 900;

const FORCE_REFRESH =
  String(process.env.ECMWF_FORCE_REFRESH || "").trim() === "1";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154 Safari/537.36 " +
  "ECMWF-Procurement-Collector/1.0";

// Verified public Wayback snapshots of the official ECMWF Copernicus ITT page.
// Used only if CDX cannot be reached from the local network.
const VERIFIED_COPERNICUS_SNAPSHOTS = [
  "20201126083520",
  "20211203174159",
  "20231027004242",
  "20231217053506",
  "20240411132715",
  "20240424102745",
  "20240910215245",
  "20241209210357",
  "20250218141127",
  "20250711163419",
  "20260220162418",
  "20260302163157",
  "20260304115022"
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
  const s = clean(v)
    .replace(/~~/g, "")
    .replace(/\(.*?\)/g, " ");

  if (!s) return null;

  // Prefer the last explicit date in strings containing amended deadlines.
  const dates = [...s.matchAll(/\b(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})\b/g)];
  if (dates.length) {
    const m = dates[dates.length - 1];
    const t = Date.parse(`${m[1]} ${m[2]} ${m[3]} UTC`);
    if (Number.isFinite(t)) return new Date(t);
  }

  const t = Date.parse(s);
  if (Number.isFinite(t)) return new Date(t);

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
      wait = Math.min(wait * 2, 120000);
    }
  }
}

// ------------------------------------------------------------
// CLASSIFICATION
// ------------------------------------------------------------

const STRONG_TECH = [
  "atmosphere monitoring", "climate change service",
  "climate data", "climate scenarios", "reanalysis",
  "earth system", "earth systems", "digital twin",
  "greenhouse gas", "ghg", "emission", "emissions",
  "surface flux", "solar radiation", "aerosol",
  "air quality", "atmospheric composition",
  "forecast", "forecasting", "climate adaptation",
  "climate emulator", "climate risk",
  "weather", "earth observation", "satellite",
  "observation", "observational", "data assimilation",
  "machine learning", "modelling", "modeling",
  "attribution", "copernicus", "destination earth"
];

const GENERIC_SUPPORT = [
  "communication services", "communications services",
  "audiovisual", "website", "websites",
  "training material", "training activities",
  "event management", "atlassian",
  "software solutions", "secondary isp",
  "internet service provider"
];

function detectProgramme(reference, title, sourceType) {
  const t = `${reference} ${title} ${sourceType}`.toUpperCase();

  if (t.includes("CAMS")) return "CAMS";
  if (t.includes("C3S")) return "C3S";
  if (t.includes("DESTINATION EARTH") || /\bDE[_-]/.test(t)) return "Destination Earth";
  if (t.includes("COPERNICUS")) return "Copernicus";
  return "ECMWF";
}

function classify(reference, title, description, programme) {
  const t =
    clean(`${reference} ${title} ${description} ${programme}`)
      .toLowerCase();

  const generic = GENERIC_SUPPORT.filter(x => t.includes(x));
  const strong = STRONG_TECH.filter(x => t.includes(x));

  if (
    (programme === "CAMS" || programme === "C3S" || programme === "Copernicus") &&
    !generic.length
  ) {
    return {
      decision: "AUTO_KEEP",
      classification: "SPACE-ENABLED COPERNICUS SERVICE",
      domain: programme === "CAMS"
        ? "Atmosphere / CAMS"
        : programme === "C3S"
        ? "Climate / C3S"
        : "Copernicus",
      confidence: "HIGH",
      evidence: uniq([programme, ...strong]).join(" | ")
    };
  }

  if (
    programme === "Destination Earth" &&
    strong.length &&
    !generic.length
  ) {
    return {
      decision: "AUTO_KEEP",
      classification: "SPACE-ENABLED EARTH-SYSTEM DIGITAL TWIN",
      domain: "Destination Earth",
      confidence: "HIGH",
      evidence: uniq(["Destination Earth", ...strong]).join(" | ")
    };
  }

  if (
    (programme === "CAMS" ||
     programme === "C3S" ||
     programme === "Copernicus" ||
     programme === "Destination Earth") &&
    generic.length
  ) {
    return {
      decision: "MANUAL_REVIEW",
      classification: "PROGRAMME SUPPORT / INDIRECT SPACE RELEVANCE",
      domain: programme,
      confidence: "MEDIUM",
      evidence: uniq([...generic, ...strong]).join(" | ")
    };
  }

  return {
    decision: "AUTO_EXCLUDE",
    classification: "NON-SPACE / CORPORATE ECMWF PROCUREMENT",
    domain: "",
    confidence: "LOW",
    evidence: generic.join(" | ")
  };
}

function makeRow(base) {
  const programme =
    base.programme ||
    detectProgramme(
      base.reference || "",
      base.title || "",
      base.sourceType || ""
    );

  const cls = classify(
    base.reference || "",
    base.title || "",
    base.description || "",
    programme
  );

  const row = {
    sourceType: base.sourceType || "",
    sourceAuthority: "European Centre for Medium-Range Weather Forecasts",
    authority: "European Centre for Medium-Range Weather Forecasts (ECMWF)",
    programme,
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

  row.ragText = [
    `Authority: ${row.authority}`,
    `Programme: ${row.programme}`,
    `Source: ${row.sourceType}`,
    `Reference: ${row.reference}`,
    `Title: ${row.title}`,
    `Description: ${row.description}`,
    `Publication date: ${row.publicationDate}`,
    `Deadline: ${row.deadline}`,
    `Status: ${row.status}`,
    `Stage: ${row.stage}`,
    `Contractor: ${row.contractor}`,
    `Value: ${row.value} ${row.currency}`.trim(),
    `Space classification: ${row.spaceClassification}`,
    `Space domain: ${row.spaceDomain}`,
    `Relevance decision: ${row.relevanceDecision}`,
    `Evidence: ${row.relevanceEvidence}`,
    `Source URL: ${row.sourceURL}`
  ].filter(Boolean).join("\n");

  return row;
}

// ------------------------------------------------------------
// TABLE PARSING
// ------------------------------------------------------------

function absoluteUrl(href, base) {
  if (!href) return "";
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

function parseIttTables(html, sourceType, sourceUrl, historical = false) {
  const $ = cheerio.load(html);
  const rows = [];

  $("table").each((_, table) => {
    const headers =
      $(table)
        .find("tr")
        .first()
        .find("th,td")
        .map((__, el) => clean($(el).text()).toLowerCase())
        .get();

    if (!headers.length) return;

    const refIdx = headers.findIndex(h => /reference/.test(h));
    const titleIdx = headers.findIndex(h => /name|title/.test(h));
    const pubIdx = headers.findIndex(h => /published/.test(h));
    const closeIdx = headers.findIndex(h => /closing/.test(h));
    const statusIdx = headers.findIndex(h => /status/.test(h));

    if (refIdx < 0 || titleIdx < 0) return;

    $(table).find("tr").slice(1).each((__, tr) => {
      const cells =
        $(tr)
          .find("td")
          .map((___, el) => clean($(el).text()))
          .get();

      if (!cells.length) return;

      const reference = clean(cells[refIdx] || "")
        .replace(/Change Notice/ig, "")
        .replace(/Corrigendum Notice/ig, "")
        .trim();

      const title = clean(cells[titleIdx] || "");
      if (!reference && !title) return;

      const publicationDate =
        pubIdx >= 0 ? iso(cells[pubIdx]) : "";

      const deadline =
        closeIdx >= 0 ? iso(cells[closeIdx]) : "";

      const pageStatus =
        statusIdx >= 0 ? clean(cells[statusIdx]) : "";

      let status = "";

      if (/contracted|closed|award/i.test(pageStatus)) {
        status = /award|contracted/i.test(pageStatus)
          ? "AWARDED"
          : "CLOSED";
      } else if (historical) {
        status = "CLOSED";
      } else if (deadline) {
        status = isFuture(deadline) ? "OPEN" : "CLOSED";
      } else {
        status = "UNKNOWN";
      }

      const firstLink =
        $(tr).find("a[href]").first().attr("href") || "";

      const awardLink =
        $(tr)
          .find("a[href]")
          .filter((___, a) => /award/i.test(clean($(a).text())))
          .first()
          .attr("href") || "";

      const programme =
        detectProgramme(reference, title, sourceType);

      rows.push(
        makeRow({
          sourceType,
          programme,
          reference,
          title,
          description: clean($(tr).text()),
          publicationDate,
          deadline,
          status,
          openNow: status === "OPEN" ? "YES" : "NO",
          stage:
            status === "AWARDED"
              ? "Historical / Awarded ITT"
              : historical
              ? "Historical / ITT"
              : "Current / ITT",
          contractor: "",
          value: "",
          currency: "",
          sourceURL:
            awardLink
              ? absoluteUrl(awardLink, sourceUrl)
              : firstLink
              ? absoluteUrl(firstLink, sourceUrl)
              : sourceUrl,
          sourceRecordId: reference || title,
          sourceDataProvenance:
            historical
              ? "Official ECMWF historical ITT page"
              : "Official ECMWF current ITT page"
        })
      );
    });
  });

  return rows;
}

// ------------------------------------------------------------
// LIVE CURRENT ITTS
// ------------------------------------------------------------

async function collectPage(url, cache, sourceType, historical = false) {
  let html = readCache(cache);

  if (html === null) {
    html = await getText(url, sourceType);
    saveCache(cache, html);
  } else {
    console.log(`${sourceType}: checkpoint`);
  }

  const rows =
    parseIttTables(
      html,
      sourceType,
      url,
      historical
    );

  console.log(`${sourceType}: ${rows.length} rows`);
  return rows;
}

// ------------------------------------------------------------
// COPERNICUS PROCUREMENT PLAN
// ------------------------------------------------------------

async function collectProcurementPlan() {
  console.log("\n=== ECMWF Copernicus Procurement Plan ===");

  let html = readCache("copernicus-procurement-page.html");

  if (html === null) {
    html = await getText(
      COPERNICUS_PAGE,
      "ECMWF Copernicus procurement page"
    );
    saveCache("copernicus-procurement-page.html", html);
  }

  const $ = cheerio.load(html);
  let pdfUrl = "";

  $("a[href]").each((_, a) => {
    const text = clean($(a).text());
    const href = $(a).attr("href") || "";

    if (
      /Copernicus Procurement Plan/i.test(text) &&
      /\.pdf/i.test(href)
    ) {
      pdfUrl = absoluteUrl(href, COPERNICUS_PAGE);
    }
  });

  if (!pdfUrl) {
    console.log("Copernicus Procurement Plan PDF not found.");
    return [];
  }

  let buffer = readCache("copernicus-procurement-plan.pdf", true);

  if (buffer === null) {
    buffer = await getBuffer(
      pdfUrl,
      "ECMWF Copernicus Procurement Plan"
    );
    saveCache("copernicus-procurement-plan.pdf", buffer);
  }

  let text = "";

  try {
    const parsed = await pdf(buffer);
    text = String(parsed.text || "");
  } catch (err) {
    console.error(`Procurement plan PDF parse failed: ${err.message}`);
    return [];
  }

  const lines =
    text.split(/\r?\n/)
      .map(clean)
      .filter(Boolean);

  const rows = [];
  const seen = new Set();

  // References in the plan generally use CAMS2_xxx / C3S2_xxx conventions.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const refs =
      [...line.matchAll(/\b(?:CAMS\d*|C3S\d*)[_-][A-Za-z0-9_.-]+\b/g)]
        .map(m => m[0]);

    if (!refs.length) continue;

    const context =
      clean(
        lines
          .slice(Math.max(0, i - 1), Math.min(lines.length, i + 4))
          .join(" | ")
      );

    for (const reference of refs) {
      const key = reference.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const programme =
        reference.toUpperCase().startsWith("CAMS")
          ? "CAMS"
          : "C3S";

      rows.push(
        makeRow({
          sourceType: "ECMWF Copernicus Procurement Plan",
          programme,
          reference,
          title: context.slice(0, 1000),
          description: context.slice(0, 4000),
          publicationDate: "",
          deadline: "",
          status: "PLANNED",
          openNow: "NO",
          stage: "Planning / Procurement Plan",
          sourceURL: pdfUrl,
          sourceRecordId: `PLAN-${reference}`,
          sourceDataProvenance:
            "Official ECMWF Copernicus Procurement Plan"
        })
      );
    }
  }

  console.log(`Procurement-plan references extracted: ${rows.length}`);
  return rows;
}

// ------------------------------------------------------------
// WAYBACK COPERNICUS HISTORY
// ------------------------------------------------------------

function fallbackCdx() {
  return [
    ["timestamp","original","statuscode","mimetype","digest"],
    ...VERIFIED_COPERNICUS_SNAPSHOTS.map(ts => [
      ts,
      COPERNICUS_CURRENT,
      "200",
      "text/html",
      `VERIFIED-${ts}`
    ])
  ];
}

async function collectCdx() {
  const cache = "copernicus-wayback-index.json";
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
    url: COPERNICUS_CURRENT,
    from: String(START_YEAR),
    to: String(END_YEAR),
    output: "json",
    fl: "timestamp,original,statuscode,mimetype,digest",
    filter: "statuscode:200",
    collapse: "digest"
  });

  const url = `${WAYBACK_CDX}?${params.toString()}`;

  try {
    const r = await axios.get(url, {
      timeout: 90000,
      headers: { "User-Agent": USER_AGENT }
    });

    const raw = String(r.data || "").trim();

    if (raw.startsWith("[")) {
      const data = JSON.parse(raw);
      if (data.length > 1) {
        saveCache(cache, JSON.stringify(data, null, 2));
        return data;
      }
    }
  } catch (err) {
    const status = err.response && err.response.status;
    console.log(
      `Wayback CDX unavailable${status ? ` HTTP ${status}` : ""}: ${err.message}`
    );
  }

  console.log(
    `Using ${VERIFIED_COPERNICUS_SNAPSHOTS.length} verified Copernicus snapshots.`
  );

  const data = fallbackCdx();
  saveCache(cache, JSON.stringify(data, null, 2));
  return data;
}

function snapshotsFromCdx(cdx) {
  if (!Array.isArray(cdx) || cdx.length < 2) return [];

  const headers = cdx[0].map(clean);
  const ti = headers.indexOf("timestamp");
  const oi = headers.indexOf("original");

  if (ti < 0 || oi < 0) return [];

  return cdx.slice(1)
    .map(r => ({
      timestamp: clean(r[ti]),
      original: clean(r[oi])
    }))
    .filter(x => x.timestamp && x.original);
}

async function collectArchivedCopernicus() {
  console.log("\n=== Archived Copernicus ITTs ===");

  const cdx = await collectCdx();
  const snaps = snapshotsFromCdx(cdx);

  console.log(`Selected Copernicus snapshots: ${snaps.length}`);

  const rows = [];

  for (let i = 0; i < snaps.length; i++) {
    const s = snaps[i];
    const cache = `copernicus-${s.timestamp}.html`;

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
        console.log(
          `Skip snapshot ${s.timestamp}${status ? ` HTTP ${status}` : ""}: ${err.message}`
        );
        continue;
      }

      await sleep(WAIT_MS);
    }

    const date =
      `${s.timestamp.slice(0,4)}-${s.timestamp.slice(4,6)}-${s.timestamp.slice(6,8)}`;

    const parsed =
      parseIttTables(
        html,
        "Archived ECMWF Copernicus ITT",
        s.original,
        true
      );

    for (const r of parsed) {
      r.archiveSeenDates = date;
      r.sourceRecordId =
        `${date}|${r.reference || r.title}`;
    }

    rows.push(...parsed);

    console.log(
      `Copernicus archive ${i+1}/${snaps.length}; parsed rows ${rows.length}`
    );
  }

  return rows;
}

// ------------------------------------------------------------
// MERGE / OUTPUT
// ------------------------------------------------------------

function keyFor(r) {
  const ref = clean(r.reference).toUpperCase();

  if (ref) return `REF|${ref}`;

  return `TITLE|${clean(r.title).toLowerCase().slice(0,180)}`;
}

function priority(r) {
  if (/Current/.test(r.sourceType)) return 50;
  if (/Past/.test(r.sourceType)) return 45;
  if (/Procurement Plan/.test(r.sourceType)) return 35;
  if (/Archived/.test(r.sourceType)) return 20;
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

    primary.archiveSeenDates =
      uniq([
        primary.archiveSeenDates,
        cur.archiveSeenDates,
        r.archiveSeenDates
      ]).join(" | ");

    if (cur.openNow === "YES" || r.openNow === "YES") {
      const live =
        cur.openNow === "YES" ? cur : r;

      primary.status = "OPEN";
      primary.openNow = "YES";
      primary.deadline = live.deadline || primary.deadline;
    } else if (
      cur.status === "AWARDED" ||
      r.status === "AWARDED"
    ) {
      primary.status = "AWARDED";
      primary.openNow = "NO";
    }

    primary.ragText = [
      `Authority: ${primary.authority}`,
      `Programme: ${primary.programme}`,
      `Source: ${primary.sourceType}`,
      `Reference: ${primary.reference}`,
      `Title: ${primary.title}`,
      `Description: ${primary.description}`,
      `Publication date: ${primary.publicationDate}`,
      `Deadline: ${primary.deadline}`,
      `Status: ${primary.status}`,
      `Stage: ${primary.stage}`,
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

function writeSources() {
  const rows = [
    [
      "Copernicus current ITTs",
      COPERNICUS_CURRENT,
      "Current CAMS/C3S Invitations to Tender",
      "Current"
    ],
    [
      "Copernicus Procurement Plan",
      COPERNICUS_PAGE,
      "Planned CAMS/C3S competitive procurement",
      "Current plan"
    ],
    [
      "Archived Copernicus ITTs",
      COPERNICUS_CURRENT,
      "Historical reconstruction via archived official page",
      "2020-present where snapshots exist"
    ],
    [
      "Destination Earth current ITTs",
      DESTINE_CURRENT,
      "Current Destination Earth Invitations to Tender",
      "Current"
    ],
    [
      "Destination Earth past ITTs",
      DESTINE_PAST,
      "Past ITTs and Contract Award Notice links",
      "2022-present"
    ]
  ];

  const f =
    path.join(
      OUTPUT_DIR,
      `ECMWF_Procurement_Sources_${TODAY}.csv`
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
  console.log("ECMWF PROCUREMENT COLLECTOR V1");
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log(`Checkpoint: ${CACHE_DIR}`);
  console.log(`Historical start: ${START_YEAR}`);
  console.log("==============================================");

  console.log("\n=== Current Copernicus ITTs ===");
  const currentCopernicus =
    await collectPage(
      COPERNICUS_CURRENT,
      "copernicus-current.html",
      "ECMWF Current Copernicus ITT",
      false
    );

  const plan =
    await collectProcurementPlan();

  const archivedCopernicus =
    await collectArchivedCopernicus();

  console.log("\n=== Current Destination Earth ITTs ===");
  const currentDestine =
    await collectPage(
      DESTINE_CURRENT,
      "destine-current.html",
      "ECMWF Current Destination Earth ITT",
      false
    );

  console.log("\n=== Past Destination Earth ITTs ===");
  const pastDestine =
    await collectPage(
      DESTINE_PAST,
      "destine-past.html",
      "ECMWF Past Destination Earth ITT",
      true
    );

  const all =
    mergeRows([
      ...currentCopernicus,
      ...plan,
      ...archivedCopernicus,
      ...currentDestine,
      ...pastDestine
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
        /Planning/.test(r.stage)
    );

  const historical =
    relevant.filter(
      r =>
        r.openNow !== "YES" &&
        r.status !== "PLANNED"
    );

  const files = [];

  files.push(...writeCsvChunked("ECMWF_Procurement_All", all));
  files.push(...writeCsvChunked("ECMWF_Space_Procurement_RAG", ragReady));
  files.push(...writeCsvChunked("ECMWF_Open_Space_Procurement", open));
  files.push(...writeCsvChunked("ECMWF_Planned_Space_Procurement", planned));
  files.push(...writeCsvChunked("ECMWF_Space_Procurement_Historical", historical));
  files.push(...writeCsvChunked("ECMWF_Space_Manual_Review", manual));
  files.push(writeSources());
  files.push(copyCollector());

  const summary = {
    runDate: TODAY,
    historicalStart: START_YEAR,
    sourceCounts: {
      currentCopernicus: currentCopernicus.length,
      copernicusPlan: plan.length,
      archivedCopernicusBeforeDedup: archivedCopernicus.length,
      currentDestinationEarth: currentDestine.length,
      pastDestinationEarth: pastDestine.length
    },
    totalUniqueProcurementRecords: all.length,
    spaceRelevantIncludingManualReview: relevant.length,
    ragReadySpace: ragReady.length,
    openSpace: open.length,
    plannedSpace: planned.length,
    historicalSpace: historical.length,
    manualReview: manual.length,
    methodology: [
      "Official ECMWF Copernicus current ITT page",
      "Official ECMWF Copernicus Procurement Plan",
      "Archived snapshots of the official Copernicus ITT page from 2020-present",
      "Official ECMWF Destination Earth current ITTs",
      "Official ECMWF Destination Earth Past ITTs with Contract Award Notice links",
      "Conservative classifier retaining technical CAMS/C3S/Destination Earth procurements while separating generic communication/training/programme-support procurement"
    ],
    limitations: [
      "Copernicus historical reconstruction depends on the public snapshots available for the ECMWF ITT page; it is not guaranteed to contain every short-lived historical publication.",
      "The Copernicus Procurement Plan is a planning document; dates and scope may change before formal publication.",
      "Destination Earth is treated as space-enabled Earth-system infrastructure, but generic communications/audiovisual/training procurements are kept outside the main RAG unless manually reviewed.",
      "Contract Award links are retained where published on ECMWF pages; detailed winner/value extraction is not attempted in V1."
    ]
  };

  const summaryFile =
    path.join(
      OUTPUT_DIR,
      `ECMWF_Procurement_Summary_${TODAY}.json`
    );

  fs.writeFileSync(
    summaryFile,
    JSON.stringify(summary, null, 2),
    "utf8"
  );

  files.push(summaryFile);

  console.log("\n==============================================");
  console.log("ECMWF PROCUREMENT COLLECTION COMPLETE");
  console.log(`Current Copernicus ITTs: ${currentCopernicus.length}`);
  console.log(`Copernicus plan rows: ${plan.length}`);
  console.log(`Archived Copernicus rows before dedup: ${archivedCopernicus.length}`);
  console.log(`Current Destination Earth ITTs: ${currentDestine.length}`);
  console.log(`Past Destination Earth ITTs: ${pastDestine.length}`);
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
  console.error("\nECMWF PROCUREMENT COLLECTOR FAILED");
  console.error(err.stack || err.message || err);
  process.exit(1);
});

module.exports = { main, outputDirectory: OUTPUT_DIR };
