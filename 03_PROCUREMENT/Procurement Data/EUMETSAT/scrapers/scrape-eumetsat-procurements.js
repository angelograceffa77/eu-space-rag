const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");

// ============================================================
// EUMETSAT PROCUREMENT COLLECTOR — V1.3
// Current + Intended + Historical reconstruction from archived EUMITS pages
//
// OUTPUT:
// Default output: ../generated (or PROCUREMENT_OUTPUT_DIR)
//
// SOURCES
// 1) EUMITS current ITTs (official, public)
// 2) EUMITS intended ITTs (official, public)
// 3) Internet Archive snapshots of the official EUMITS current ITT page
//    from 2020-present, used only to reconstruct historical public listings.
//
// WHY ARCHIVE SNAPSHOTS?
// EUMITS documentation states closed ITTs remain visible in the current list
// only for a short period after closure. The Wayback layer therefore preserves
// historical public EUMITS listings without inventing tender content.
//
// CHECKPOINTS
// _EUMETSAT_CACHE/<run-date>/
//
// OUTPUT TYPES
// CSV + JSON only, automatically kept GitHub-friendly.
// ============================================================

const OUTPUT_DIR = path.resolve(process.env.PROCUREMENT_OUTPUT_DIR || path.join(__dirname, "../generated"));

const TODAY = new Date().toISOString().slice(0, 10);
const CACHE_DIR = path.join(OUTPUT_DIR, "_EUMETSAT_CACHE", TODAY);

const CURRENT_URL =
  "https://eumits.eumetsat.int/pub/pub_citt_list.jsf";

const INTENDED_URL =
  "https://eumits.eumetsat.int/pub/pub_iitt_list.jsf";

const WAYBACK_CDX =
  "https://web.archive.org/cdx/search/cdx";

const START_YEAR = 2020;
const END_YEAR = new Date().getFullYear();

// Verified Internet Archive snapshots of the official EUMITS current-ITT page.
// Used only as a fallback when the CDX index returns no rows from the user's network.
// The live CDX query remains the preferred method for future refreshes.
const VERIFIED_WAYBACK_SNAPSHOTS = [
  "20200814100940",
  "20201031033010",
  "20210123130201",
  "20210418163910",
  "20210615054136",
  "20210804045732",
  "20210926023343",
  "20211024174228",
  "20211127043835",
  "20220124125200",
  "20220523164244",
  "20220811134321",
  "20220928212657",
  "20230127153539",
  "20230130035808",
  "20230326080713",
  "20230610165445",
  "20230922002916",
  "20231129205351",
  "20240225073253",
  "20240525224932",
  "20240616174049",
  "20240718223439",
  "20240806162500",
  "20240912211553",
  "20241005145106",
  "20241102011032",
  "20241211180540",
  "20250119052021",
  "20250212130207",
  "20250316084702",
  "20250521133929",
  "20250622202531",
  "20250712153956",
  "20250806234704",
  "20250822052912",
  "20250912023414",
  "20251010021937",
  "20251111231304",
  "20251209112935",
  "20260121023808",
  "20260213094554",
  "20260316110850",
  "20260414114040",
  "20260510080746",
  "20260611230500"
];


const RETRY_START_MS = 10000;
const RETRY_MAX_MS = 120000;
const REQUEST_PAUSE_MS = 900;
const CSV_MAX_BYTES = 90 * 1024 * 1024;

const FORCE_REFRESH =
  String(process.env.EUMETSAT_FORCE_REFRESH || "").trim() === "1";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154 Safari/537.36 " +
  "EUMETSAT-Procurement-Collector/1.0";

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
  if (!s) return null;

  let t = Date.parse(s);
  if (Number.isFinite(t)) return new Date(t);

  const months = {
    january:0,february:1,march:2,april:3,may:4,june:5,
    july:6,august:7,september:8,october:9,november:10,december:11
  };

  let m = s.match(/\b(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const mon = months[m[2].toLowerCase()];
    if (mon !== undefined) {
      return new Date(Date.UTC(
        Number(m[3]), mon, Number(m[1]),
        Number(m[4] || 0), Number(m[5] || 0), 0
      ));
    }
  }

  m = s.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (m) {
    return new Date(Date.UTC(Number(m[1]), Number(m[2])-1, Number(m[3])));
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

function loadCache(name) {
  const file = cachePath(name);
  if (!FORCE_REFRESH && fs.existsSync(file)) {
    return fs.readFileSync(file, "utf8");
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
      console.error(`Retrying in ${Math.round(wait/1000)} sec...`);
      await sleep(wait);
      wait = Math.min(wait * 2, RETRY_MAX_MS);
    }
  }
}

// ------------------------------------------------------------
// SPACE / MISSION RELEVANCE
// ------------------------------------------------------------

const CORE_SPACE = [
  "satellite", "spacecraft", "space-based", "space based",
  "ground station", "ground stations", "ground segment",
  "satellite operations", "spacecraft operations",
  "leo-to-geo", "inter-satellite", "inter satellite",
  "geosynchronous", "geostationary", "polar orbit",
  "meteorological satellite", "satellite data",
  "direct broadcasting", "satellite reception",
  "payload", "orbital", "orbit determination",
  "metop", "meteosat", "mtg", "eps-sg"
];

const EO_SPACE = [
  "earth observation", "remote sensing", "copernicus",
  "sentinel", "destination earth", "meteorological data",
  "weather data", "climate data", "atmospheric data",
  "ocean data", "land data"
];

const MISSION_SUPPORT = [
  "mission development", "mission operations",
  "operations engineering", "data processing",
  "product generation", "instrument processing",
  "calibration", "validation", "iv&v", "system engineering",
  "flight dynamics", "ground systems", "ground segment",
  "satellite control", "mission control",
  "operational optical data", "dissemination",
  "data lake", "near real time", "near-real-time"
];

const CORPORATE = [
  "catering", "cleaning", "chiller", "chillers",
  "videography", "office furniture", "insurance",
  "audit service", "legal service", "recruitment",
  "facility management", "building maintenance",
  "multimedia", "corporate communication"
];

function classify(text) {
  const t = clean(text).toLowerCase();

  const core = CORE_SPACE.filter(x => t.includes(x));
  const eo = EO_SPACE.filter(x => t.includes(x));
  const mission = MISSION_SUPPORT.filter(x => t.includes(x));
  const corp = CORPORATE.filter(x => t.includes(x));

  if (core.length) {
    return {
      decision: "AUTO_KEEP",
      classification: "CORE SPACE",
      domain: detectDomain(t),
      confidence: "HIGH",
      evidence: uniq(core).join(" | ")
    };
  }

  if (eo.length) {
    return {
      decision: "AUTO_KEEP",
      classification: "SPACE-ENABLED / EARTH OBSERVATION",
      domain: detectDomain(t),
      confidence: "HIGH",
      evidence: uniq(eo).join(" | ")
    };
  }

  if (mission.length && !corp.length) {
    return {
      decision: "AUTO_KEEP",
      classification: "SPACE MISSION SUPPORT",
      domain: detectDomain(t),
      confidence: "MEDIUM",
      evidence: uniq(mission).join(" | ")
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
    evidence: uniq(corp).join(" | ")
  };
}

function detectDomain(t) {
  if (/(ground station|ground segment|satellite reception|direct broadcasting)/.test(t)) return "Ground Segment";
  if (/(copernicus|sentinel|earth observation|remote sensing)/.test(t)) return "Earth Observation";
  if (/(spacecraft operations|satellite operations|mission control|flight dynamics)/.test(t)) return "Spacecraft Operations";
  if (/(inter-satellite|inter satellite|leo-to-geo|geosynchronous)/.test(t)) return "Satellite Communications / Links";
  if (/(data processing|product generation|data lake|dissemination)/.test(t)) return "Space Data / Processing";
  if (/(payload|instrument|calibration|validation)/.test(t)) return "Payload / Instruments";
  if (/(satellite|spacecraft|orbit|metop|meteosat|mtg|eps-sg)/.test(t)) return "Satellite Systems";
  return "Mission Support";
}

// ------------------------------------------------------------
// EUMITS TABLE PARSER
// ------------------------------------------------------------

function normalizeReference(v) {
  return clean(v)
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/^(\d{2})\/?(\d{6})$/, "$1/$2");
}

function parseTableRows(html, sourceType, sourceUrl, snapshotDate = "") {
  const $ = cheerio.load(html);
  const rows = [];

  $("table tr").each((_, tr) => {
    const cells = $(tr).find("th,td").map((__, el) => clean($(el).text())).get();
    if (cells.length < 2) return;

    const joined = cells.join(" | ");
    if (/reference\s*\|\s*title/i.test(joined)) return;

    let reference = clean(cells[0]);
    let title = clean(cells[1]);
    let opening = clean(cells[2] || "");
    let closing = clean(cells[3] || "");

    if (!reference || !title) return;

    // EUMITS reference patterns commonly look like 26/251743 or 26251930.
    if (!/^\d{2}\/?\d{3,8}$/.test(reference.replace(/\s/g, ""))) return;

    const normalizedRef = normalizeReference(reference);
    const openingDate = iso(opening);
    const closingDate = iso(closing);

    let status = "";
    let stage = "";

    if (sourceType === "EUMITS Intended ITT") {
      status = "PLANNED";
      stage = "Intended / Planned";
    } else {
      if (closingDate) {
        status = isFuture(closingDate) ? "OPEN" : "CLOSED";
      } else {
        status = "UNKNOWN";
      }
      stage = status === "OPEN" ? "Competition / Open" : "Competition";
    }

    const cls = classify(`${title} ${joined}`);

    const row = {
      sourceType,
      sourceAuthority: "EUMETSAT",
      authority: "EUMETSAT",
      reference: normalizedRef,
      title,
      description: "",
      openingDate,
      closingDate,
      publicationDate: openingDate,
      status,
      openNow: status === "OPEN" ? "YES" : "NO",
      stage,
      spaceClassification: cls.classification,
      spaceDomain: cls.domain,
      relevanceDecision: cls.decision,
      relevanceConfidence: cls.confidence,
      relevanceEvidence: cls.evidence,
      sourceURL: sourceUrl,
      archivedSnapshotDate: snapshotDate,
      sourceDataProvenance:
        sourceType === "Archived EUMITS Current ITT"
          ? "Official EUMITS page preserved by Internet Archive"
          : "Official EUMITS public page",
      sourceDataAltered:
        "NO - fields normalized from published listing",
      ragText: ""
    };

    row.ragText = buildRagText(row);
    rows.push(row);
  });

  return rows;
}

function buildRagText(r) {
  return [
    `Authority: ${r.authority}`,
    `Source: ${r.sourceType}`,
    `Reference: ${r.reference}`,
    `Title: ${r.title}`,
    `Opening date: ${r.openingDate}`,
    `Closing date: ${r.closingDate}`,
    `Status: ${r.status}`,
    `Stage: ${r.stage}`,
    `Space classification: ${r.spaceClassification}`,
    `Space domain: ${r.spaceDomain}`,
    `Relevance decision: ${r.relevanceDecision}`,
    `Relevance evidence: ${r.relevanceEvidence}`,
    `Source URL: ${r.sourceURL}`,
    r.archivedSnapshotDate
      ? `Archived snapshot date: ${r.archivedSnapshotDate}`
      : ""
  ].filter(Boolean).join("\n");
}

// ------------------------------------------------------------
// LIVE CURRENT / INTENDED
// ------------------------------------------------------------

async function collectLivePage(url, type, cacheName) {
  let html = loadCache(cacheName);

  if (html !== null) {
    console.log(`${type}: checkpoint`);
  } else {
    html = await requestText(url, type);
    saveCache(cacheName, html);
  }

  const rows = parseTableRows(html, type, url);
  console.log(`${type}: ${rows.length} rows`);
  return rows;
}

// ------------------------------------------------------------
// WAYBACK HISTORICAL RECONSTRUCTION
// ------------------------------------------------------------

async function collectCdxSnapshots() {
  const cacheName = "wayback-cdx-normalized-v3.json";
  const cacheFile = cachePath(cacheName);

  // Reuse only a non-empty checkpoint. Empty/headers-only checkpoints
  // from a previous failed run are ignored and refreshed automatically.
  if (!FORCE_REFRESH && fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      if (Array.isArray(cached) && cached.length > 1) {
        console.log(
          `Wayback CDX index: checkpoint (${cached.length - 1} snapshots)`
        );
        return cached;
      }

      console.log(
        "Wayback CDX checkpoint is empty; refreshing it."
      );
    } catch {
      console.log(
        "Wayback CDX checkpoint is invalid; refreshing it."
      );
    }
  }

  const params = new URLSearchParams({
    url: CURRENT_URL,
    from: String(START_YEAR),
    to: String(END_YEAR),
    output: "json",
    fl: "timestamp,original,statuscode,mimetype,digest",
    filter: "statuscode:200",
    collapse: "digest"
  });

  const url = `${WAYBACK_CDX}?${params.toString()}`;

  try {
    const text = await requestText(url, "Wayback CDX");
    const trimmed = String(text || "").trim();

    let data = [];

    if (trimmed.startsWith("[")) {
      data = JSON.parse(trimmed);
    } else {
      // Some Wayback frontends return CSV despite output=json.
      const lines =
        trimmed
          .split(/\r?\n/)
          .map(x => x.trim())
          .filter(Boolean);

      function parseCsvLine(line) {
        const out = [];
        let cur = "";
        let quoted = false;

        for (let i = 0; i < line.length; i++) {
          const ch = line[i];

          if (ch === '"') {
            if (quoted && line[i + 1] === '"') {
              cur += '"';
              i++;
            } else {
              quoted = !quoted;
            }
            continue;
          }

          if (ch === "," && !quoted) {
            out.push(cur);
            cur = "";
          } else {
            cur += ch;
          }
        }

        out.push(cur);
        return out;
      }

      data = lines.map(parseCsvLine);
    }

    // Strip UTF-8 BOM from first header when present.
    if (
      Array.isArray(data) &&
      data.length &&
      Array.isArray(data[0]) &&
      data[0].length
    ) {
      data[0][0] =
        String(data[0][0] || "")
          .replace(/^\uFEFF/, "")
          .trim();
    }

    console.log(
      `Wayback CDX rows received: ${
        Array.isArray(data) ? Math.max(0, data.length - 1) : 0
      }`
    );

    if (!Array.isArray(data) || data.length <= 1) {
      console.log(
        "Wayback CDX returned no usable rows from this network."
      );
      console.log(
        `Using ${VERIFIED_WAYBACK_SNAPSHOTS.length} verified fallback snapshots instead.`
      );

      const fallback = [
        ["timestamp", "original", "statuscode", "mimetype", "digest"],
        ...VERIFIED_WAYBACK_SNAPSHOTS.map(ts => [
          ts,
          CURRENT_URL,
          "200",
          "text/html",
          `VERIFIED-${ts}`
        ])
      ];

      saveCache(
        cacheName,
        JSON.stringify(fallback, null, 2)
      );

      return fallback;
    }

    saveCache(
      cacheName,
      JSON.stringify(data, null, 2)
    );

    return data;
  } catch (err) {
    console.error(
      `Wayback historical layer unavailable: ${err.message}`
    );
    return [];
  }
}

function snapshotSelection(cdx) {
  if (!Array.isArray(cdx) || cdx.length < 2) {
    return [];
  }

  const headers =
    cdx[0].map(x => String(x || "").trim());
  const idx = Object.fromEntries(
    headers.map((h, i) => [h, i])
  );

  if (
    idx.timestamp === undefined ||
    idx.original === undefined
  ) {
    console.log(
      `Unexpected Wayback headers: ${headers.join(" | ")}`
    );
    return [];
  }

  const raw = cdx.slice(1).map(r => ({
    timestamp: r[idx.timestamp],
    original: r[idx.original],
    digest: r[idx.digest]
  })).filter(x => x.timestamp && x.original);

  // One snapshot per ISO week is enough because EUMITS keeps closed
  // tenders visible briefly after closure; weekly density balances recall
  // against download volume.
  const seen = new Set();
  const selected = [];

  for (const x of raw) {
    const ts = x.timestamp;
    const d = new Date(Date.UTC(
      Number(ts.slice(0,4)),
      Number(ts.slice(4,6))-1,
      Number(ts.slice(6,8))
    ));

    const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
    const week = Math.floor((d - yearStart) / (7*86400000));
    const key = `${d.getUTCFullYear()}-${week}`;

    if (!seen.has(key)) {
      seen.add(key);
      selected.push(x);
    }
  }

  return selected;
}

async function collectHistorical() {
  if(require('../../daily/scope.cjs').active())return [];
  console.log("\n=== Historical reconstruction via archived EUMITS listings ===");

  const cdx = await collectCdxSnapshots();
  const snapshots = snapshotSelection(cdx);

  console.log(`Selected archive snapshots: ${snapshots.length}`);

  const rows = [];

  for (let i = 0; i < snapshots.length; i++) {
    const s = snapshots[i];
    const cacheName = `wayback-${s.timestamp}.html`;

    let html = loadCache(cacheName);

    if (html === null) {
      const archivedUrl =
        `https://web.archive.org/web/${s.timestamp}id_/${s.original}`;

      try {
        html = await requestText(
          archivedUrl,
          `Wayback snapshot ${s.timestamp}`
        );
        saveCache(cacheName, html);
      } catch (err) {
        console.error(
          `Skipping snapshot ${s.timestamp}: ${err.message}`
        );
        continue;
      }

      await sleep(REQUEST_PAUSE_MS);
    }

    const snapshotDate =
      `${s.timestamp.slice(0,4)}-${s.timestamp.slice(4,6)}-${s.timestamp.slice(6,8)}`;

    const parsed = parseTableRows(
      html,
      "Archived EUMITS Current ITT",
      s.original,
      snapshotDate
    );

    rows.push(...parsed);

    if ((i + 1) % 20 === 0 || i + 1 === snapshots.length) {
      console.log(
        `Archive progress ${i+1}/${snapshots.length}; parsed rows ${rows.length}`
      );
    }
  }

  return rows;
}

// ------------------------------------------------------------
// DEDUP / MERGE
// ------------------------------------------------------------

function recordKey(r) {
  const ref = normalizeReference(r.reference);
  return ref || `${clean(r.title).toLowerCase()}|${clean(r.openingDate)}`;
}

function mergeRows(rows) {
  const map = new Map();

  for (const r of rows) {
    const key = recordKey(r);
    const current = map.get(key);

    if (!current) {
      map.set(key, { ...r });
      continue;
    }

    const score = x =>
      (x.sourceType === "EUMITS Current ITT" ? 30 : 0) +
      (x.sourceType === "EUMITS Intended ITT" ? 20 : 0) +
      (x.closingDate ? 5 : 0) +
      (x.openingDate ? 3 : 0);

    const primary = score(r) > score(current) ? { ...r } : { ...current };
    const secondary = score(r) > score(current) ? current : r;

    for (const k of Object.keys(primary)) {
      if (!clean(primary[k]) && clean(secondary[k])) {
        primary[k] = secondary[k];
      }
    }

    const snapshotDates = uniq([
      current.archivedSnapshotDate,
      r.archivedSnapshotDate,
      current.archiveSeenDates,
      r.archiveSeenDates
    ]);

    primary.archiveSeenDates = snapshotDates.join(" | ");

    // If a current listing exists, its status wins.
    if (current.sourceType === "EUMITS Current ITT") {
      primary.status = current.status;
      primary.openNow = current.openNow;
      primary.closingDate = current.closingDate || primary.closingDate;
    }
    if (r.sourceType === "EUMITS Current ITT") {
      primary.status = r.status;
      primary.openNow = r.openNow;
      primary.closingDate = r.closingDate || primary.closingDate;
    }

    primary.ragText = buildRagText(primary);
    map.set(key, primary);
  }

  return [...map.values()];
}

// ------------------------------------------------------------
// CSV OUTPUT
// ------------------------------------------------------------

const COLUMNS = [
  "sourceType",
  "sourceAuthority",
  "authority",
  "reference",
  "title",
  "description",
  "openingDate",
  "closingDate",
  "publicationDate",
  "status",
  "openNow",
  "stage",
  "spaceClassification",
  "spaceDomain",
  "relevanceDecision",
  "relevanceConfidence",
  "relevanceEvidence",
  "sourceURL",
  "archivedSnapshotDate",
  "archiveSeenDates",
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

function writeSourceRegistry() {
  const rows = [
    [
      "Official EUMITS Current ITTs",
      CURRENT_URL,
      "Current open and very recently closed ITTs",
      "Live"
    ],
    [
      "Official EUMITS Intended ITTs",
      INTENDED_URL,
      "Planned/intended future ITTs",
      "Live"
    ],
    [
      "Internet Archive snapshots of official EUMITS Current ITT page",
      CURRENT_URL,
      "Reconstruct historical public EUMITS listings",
      "2020-present where archived snapshots exist"
    ]
  ];

  const file = path.join(
    OUTPUT_DIR,
    `EUMETSAT_Procurement_Sources_${TODAY}.csv`
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
  console.log("EUMETSAT PROCUREMENT COLLECTOR V1.3");
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log(`Checkpoint: ${CACHE_DIR}`);
  console.log(`Historical start: ${START_YEAR}`);
  console.log("==============================================");

  const current = await collectLivePage(
    CURRENT_URL,
    "EUMITS Current ITT",
    "current.html"
  );

  const intended = await collectLivePage(
    INTENDED_URL,
    "EUMITS Intended ITT",
    "intended.html"
  );

  const historical = await collectHistorical();

  const all = mergeRows([
    ...historical,
    ...intended,
    ...current
  ]).sort((a,b) => {
    const da = parseDate(a.openingDate);
    const db = parseDate(b.openingDate);
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
      const da = parseDate(a.closingDate);
      const db = parseDate(b.closingDate);
      return (da ? da.getTime() : Number.MAX_SAFE_INTEGER) -
             (db ? db.getTime() : Number.MAX_SAFE_INTEGER);
    });

  const planned = relevant.filter(
    r => r.status === "PLANNED"
  );

  const historicalRelevant = relevant.filter(
    r => r.openNow !== "YES" && r.status !== "PLANNED"
  );

  const files = [];
  files.push(...writeCsvChunked("EUMETSAT_Procurement_All", all));
  files.push(...writeCsvChunked("EUMETSAT_Space_Procurement_RAG", ragReady));
  files.push(...writeCsvChunked("EUMETSAT_Open_Space_Procurement", open));
  files.push(...writeCsvChunked("EUMETSAT_Planned_Space_Procurement", planned));
  files.push(...writeCsvChunked("EUMETSAT_Space_Procurement_Historical", historicalRelevant));
  files.push(...writeCsvChunked("EUMETSAT_Space_Manual_Review", manual));
  files.push(writeSourceRegistry());
  files.push(copyCollector());

  const summary = {
    runDate: TODAY,
    historicalStart: START_YEAR,
    currentRows: current.length,
    intendedRows: intended.length,
    archivedRowsBeforeDedup: historical.length,
    totalUniqueProcurementRecords: all.length,
    spaceRelevantIncludingManualReview: relevant.length,
    ragReadySpace: ragReady.length,
    openSpace: open.length,
    plannedSpace: planned.length,
    historicalSpace: historicalRelevant.length,
    manualReview: manual.length,
    methodology: [
      "Official public EUMITS Current ITT page",
      "Official public EUMITS Intended ITT page",
      "Weekly-deduplicated Internet Archive snapshots of the official EUMITS Current ITT page from 2020-present where available",
      "High-recall EUMETSAT mission/space classifier with separate manual-review layer"
    ],
    limitation:
      "Public EUMITS exposes current and intended ITTs but not a complete public live archive. Historical reconstruction therefore depends on archived snapshots and can only cover periods for which snapshots exist. When the Wayback CDX index is unavailable from the user network, the collector falls back to a verified list of archived EUMITS snapshots from 2020-2026. Award details may require registered EUMITS access."
  };

  const summaryFile = path.join(
    OUTPUT_DIR,
    `EUMETSAT_Procurement_Summary_${TODAY}.json`
  );

  fs.writeFileSync(
    summaryFile,
    JSON.stringify(summary, null, 2),
    "utf8"
  );

  files.push(summaryFile);

  console.log("\n==============================================");
  console.log("EUMETSAT PROCUREMENT COLLECTION COMPLETE");
  console.log(`Current ITT rows: ${current.length}`);
  console.log(`Intended ITT rows: ${intended.length}`);
  console.log(`Historical archived rows before dedup: ${historical.length}`);
  console.log(`All unique procurement records: ${all.length}`);
  console.log(`Space relevant incl. manual review: ${relevant.length}`);
  console.log(`RAG-ready space: ${ragReady.length}`);
  console.log(`OPEN space: ${open.length}`);
  console.log(`PLANNED space: ${planned.length}`);
  console.log(`Historical space: ${historicalRelevant.length}`);
  console.log(`Manual review: ${manual.length}`);
  console.log("\nGenerated files:");
  for (const f of files) console.log(f);
  console.log("==============================================\n");
}

if (require.main === module) main().catch(err => {
  console.error("\nEUMETSAT PROCUREMENT COLLECTOR FAILED");
  console.error(err.stack || err.message || err);
  process.exit(1);
});

module.exports = { main, outputDirectory: OUTPUT_DIR };
