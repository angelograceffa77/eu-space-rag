const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");
const pdf = require("pdf-parse");

// ============================================================
// EUROCONTROL PROCUREMENT COLLECTOR — V1.2
//
// OUTPUT:
// Default output: ../generated (or PROCUREMENT_OUTPUT_DIR)
//
// PRIMARY SOURCE:
// https://www.eurocontrol.int/procurement
//
// EUROCONTROL is an intergovernmental organisation with its own procurement
// rules. Its public procurement catalogue exposes:
//   1) Current business opportunities
//   2) Awarded contracts
//   3) Upcoming business opportunities
//
// Historical target: 2020-present.
//
// SPACE / SPACE-ENABLED ATM SCOPE:
// GNSS, Galileo, EGNOS, PNT, ARAIM, SBAS, satellite navigation,
// SATCOM, satellite communications, space weather, space-based surveillance,
// spectrum/RF monitoring where strongly linked to CNS/ATM, and selected
// CNS/datalink/UTM/U-space procurements where the space nexus is plausible.
//
// Generic ATM software, buildings, HR, training, office IT and facilities
// are excluded unless explicit space/navigation/satellite evidence exists.
// ============================================================

const OUTPUT_DIR = path.resolve(process.env.PROCUREMENT_OUTPUT_DIR || path.join(__dirname, "../generated"));

const TODAY = new Date().toISOString().slice(0, 10);
const CACHE_DIR = path.join(OUTPUT_DIR, "_EUROCONTROL_CACHE", TODAY);

const BASE_URL = "https://www.eurocontrol.int/procurement";
const SUPPLIER_PORTAL =
  "https://www.eurocontrol.int/portal/supplier-portal";

const START_YEAR = 2020;
const CSV_MAX_BYTES = 90 * 1024 * 1024;
const WAIT_MS = 700;
const MAX_PAGES = 40;

const FORCE_REFRESH =
  String(process.env.EUROCONTROL_FORCE_REFRESH || "").trim() === "1";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154 Safari/537.36 " +
  "EUROCONTROL-Procurement-Collector/1.0";

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
  if (typeof v === "object") return Object.values(v).map(clean).filter(Boolean).join(" | ");
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
          "Accept-Language": "en",
          "Accept": "text/html,application/xhtml+xml"
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

const CORE_SPACE = [
  "gnss",
  "galileo",
  "egnos",
  "satellite navigation",
  "satellite-based navigation",
  "satellite based navigation",
  "position navigation and timing",
  "position, navigation and timing",
  "pnt",
  "araim",
  "advanced raim",
  "sbas",
  "satcom",
  "satellite communication",
  "satellite communications",
  "space weather",
  "space-based",
  "space based",
  "satellite surveillance",
  "satellite data",
  "satellite service",
  "satellite services"
];

const SPACE_ENABLED_ATM = [
  "navigation performance",
  "navigation resilience",
  "interference monitoring",
  "gnss interference",
  "gnss monitoring",
  "rf monitoring",
  "radio frequency monitoring",
  "spectrum monitoring",
  "cns",
  "communications navigation surveillance",
  "datalink",
  "data link",
  "ads-b",
  "automatic dependent surveillance",
  "surveillance data",
  "u-space",
  "u space",
  "utm",
  "unmanned traffic management"
];

const ATM_CONTEXT = [
  "atm",
  "air traffic management",
  "air navigation",
  "air traffic control",
  "european aviation",
  "sesar",
  "muac",
  "network manager"
];

const GENERIC_EXCLUDE = [
  "office",
  "furniture",
  "cleaning",
  "catering",
  "training",
  "leadership",
  "loan",
  "fire compartment",
  "mechanical installations",
  "website",
  "recruitment",
  "human resources",
  "language",
  "video wall"
];

function detectDomain(t) {
  if (/gnss|galileo|egnos|araim|sbas|satellite navigation|position[, ]+navigation and timing|\bpnt\b/.test(t)) {
    return "GNSS / Galileo / EGNOS / PNT";
  }

  if (/satcom|satellite communication/.test(t)) {
    return "Satellite Communications";
  }

  if (/space weather/.test(t)) {
    return "Space Weather";
  }

  if (/space[- ]based|satellite surveillance|ads-b|automatic dependent surveillance/.test(t)) {
    return "Space-Based Surveillance";
  }

  if (/rf monitoring|radio frequency monitoring|spectrum monitoring|interference/.test(t)) {
    return "RF / Spectrum / Interference Monitoring";
  }

  if (/datalink|data link/.test(t)) {
    return "Datalink / CNS";
  }

  if (/u-space|u space|\butm\b|unmanned traffic management/.test(t)) {
    return "U-space / UTM";
  }

  if (/navigation performance|navigation resilience/.test(t)) {
    return "Navigation Performance / Resilience";
  }

  return "Space-Enabled ATM";
}

function classify(text) {
  const t = clean(text).toLowerCase();

  const core = CORE_SPACE.filter(x => t.includes(x));
  const atmSpace = SPACE_ENABLED_ATM.filter(x => t.includes(x));
  const atmContext = ATM_CONTEXT.filter(x => t.includes(x));
  const generic = GENERIC_EXCLUDE.filter(x => t.includes(x));

  if (core.length) {
    return {
      decision: "AUTO_KEEP",
      classification: "CORE SPACE / SPACE-ENABLED ATM",
      domain: detectDomain(t),
      confidence: "HIGH",
      evidence: uniq([...core, ...atmSpace, ...atmContext]).join(" | ")
    };
  }

  if (atmSpace.length >= 2 && atmContext.length && !generic.length) {
    return {
      decision: "AUTO_KEEP",
      classification: "SPACE-ENABLED ATM / DUAL-USE",
      domain: detectDomain(t),
      confidence: "MEDIUM",
      evidence: uniq([...atmSpace, ...atmContext]).join(" | ")
    };
  }

  if (atmSpace.length && !generic.length) {
    return {
      decision: "MANUAL_REVIEW",
      classification: "POSSIBLE SPACE-ENABLED ATM",
      domain: detectDomain(t),
      confidence: "MEDIUM",
      evidence: uniq([...atmSpace, ...atmContext]).join(" | ")
    };
  }

  return {
    decision: "AUTO_EXCLUDE",
    classification: "NON-SPACE / GENERIC EUROCONTROL PROCUREMENT",
    domain: "",
    confidence: "LOW",
    evidence: generic.join(" | ")
  };
}

function makeRow(base) {
  const cls =
    classify(`${base.title || ""} ${base.description || ""}`);

  const row = {
    sourceType: base.sourceType || "",
    sourceAuthority: "EUROCONTROL",
    authority: "EUROCONTROL",
    reference: base.reference || "",
    title: base.title || "",
    description: base.description || "",
    publicationDate: base.publicationDate || "",
    deadline: base.deadline || "",
    signedDate: base.signedDate || "",
    status: base.status || "",
    openNow: base.openNow || "NO",
    stage: base.stage || "",
    procurementType: base.procurementType || "",
    contractor: base.contractor || "",
    sourceURL: base.sourceURL || "",
    documentURL: base.documentURL || "",
    sourceRecordId: base.sourceRecordId || "",
    sourceDataProvenance: base.sourceDataProvenance || "",
    sourceDataAltered: "NO - normalized from official EUROCONTROL source",
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
    `Signed date: ${row.signedDate}`,
    `Status: ${row.status}`,
    `Stage: ${row.stage}`,
    `Procurement type: ${row.procurementType}`,
    `Contractor: ${row.contractor}`,
    `Space classification: ${row.spaceClassification}`,
    `Space domain: ${row.spaceDomain}`,
    `Relevance decision: ${row.relevanceDecision}`,
    `Evidence: ${row.relevanceEvidence}`,
    `Source URL: ${row.sourceURL}`,
    `Document URL: ${row.documentURL}`
  ].filter(Boolean).join("\n");

  return row;
}

// ------------------------------------------------------------
// HTML PARSER
// ------------------------------------------------------------

function labelMap($) {
  const map = new Map();

  $("a[aria-controls]").each((_, a) => {
    const id = clean($(a).attr("aria-controls"));
    const label = clean($(a).text());

    if (id && label) map.set(id, label);
  });

  return map;
}

function paneKind(label, index) {
  const x = clean(label).toLowerCase();

  if (/current business opportunities/.test(x)) return "CURRENT";
  if (/awarded contracts/.test(x)) return "AWARDED";
  if (/upcoming business opportunities/.test(x)) return "UPCOMING";

  if (index === 0) return "CURRENT";
  if (index === 1) return "AWARDED";
  if (index === 2) return "UPCOMING";

  return "UNKNOWN";
}

function fieldValue(node, selector) {
  const el = node.find(selector).first();
  if (!el.length) return "";

  const clone = el.clone();
  clone.find(".field-label-inline").remove();

  return clean(clone.text());
}

function parsePage(html, pageUrl) {
  const $ = cheerio.load(html);
  const labels = labelMap($);

  const out = {
    current: [],
    awarded: [],
    upcoming: [],
    totals: {
      current: null,
      awarded: null,
      upcoming: null
    }
  };

  $(".tab-content > .tab-pane").each((paneIndex, pane) => {
    const p = $(pane);
    const id = clean(p.attr("id"));
    const label = labels.get(id) || "";
    const kind = paneKind(label, paneIndex);

    if (kind === "UNKNOWN") return;

    const summary =
      clean(
        p.find(".view-result-summary").first().text()
      );

    const totalMatch =
      summary.match(/([\d,]+)\s+results?\s+found/i);

    const total =
      totalMatch
        ? Number(totalMatch[1].replace(/,/g, ""))
        : null;

    if (kind === "CURRENT") out.totals.current = total;
    if (kind === "AWARDED") out.totals.awarded = total;
    if (kind === "UPCOMING") out.totals.upcoming = total;

    p.find(".views-row .node--procurement").each((_, card) => {
      const c = $(card);

      const title =
        clean(c.find("h3").first().text());

      const reference =
        fieldValue(
          c,
          ".field-name-field-reference-number"
        );

      const published =
        fieldValue(
          c,
          ".field-name-field-published-on"
        );

      const closing =
        fieldValue(
          c,
          ".field-name-procurement-closing-date"
        );

      const signed =
        fieldValue(
          c,
          ".field-name-procurement-signon-date"
        );

      const documentURL =
        c.find('a[href$=".pdf"], a[href*=".pdf?"]')
          .first()
          .attr("href") || "";

      const cardText =
        clean(c.text());

      const typeClass =
        clean(c.attr("class"));

      const procurementType =
        /time-based/i.test(typeClass + " " + cardText)
          ? "Time-based consultancy"
          : "Call for tenders";

      if (!title && !reference) return;

      let status = "";
      let openNow = "NO";
      let stage = "";

      if (kind === "AWARDED") {
        status = "AWARDED";
        stage = "Historical / Awarded Contract";
      } else if (kind === "UPCOMING") {
        status = "PLANNED";
        stage = "Planning / Upcoming Business Opportunity";
      } else {
        const deadlineIso = iso(closing);

        if (deadlineIso && isFuture(deadlineIso)) {
          status = "OPEN";
          openNow = "YES";
          stage = "Current / Open Competition";
        } else if (deadlineIso) {
          status = "CLOSED";
          stage = "Historical / Closed Competition";
        } else {
          // The source places records in the Current tab; absence of a
          // machine-readable closing date should not automatically make them
          // historical.
          status = "OPEN";
          openNow = "YES";
          stage = "Current / Open Competition";
        }
      }

      const row =
        makeRow({
          sourceType: "EUROCONTROL Procurement Catalogue",
          reference,
          title,
          description: cardText,
          publicationDate: iso(published),
          deadline: iso(closing),
          signedDate: iso(signed),
          status,
          openNow,
          stage,
          procurementType,
          sourceURL: pageUrl,
          documentURL:
            documentURL
              ? new URL(documentURL, pageUrl).href
              : "",
          sourceRecordId:
            reference || `${kind}|${title}`,
          sourceDataProvenance:
            `Official EUROCONTROL procurement page — ${kind}`
        });

      if (kind === "CURRENT") out.current.push(row);
      if (kind === "AWARDED") out.awarded.push(row);
      if (kind === "UPCOMING") out.upcoming.push(row);
    });
  });

  return out;
}

// ------------------------------------------------------------
// COLLECTION / PAGINATION
// ------------------------------------------------------------

async function collectCatalogue() {
  console.log("\n=== EUROCONTROL procurement catalogue ===");

  const current = new Map();
  const awarded = new Map();
  const upcoming = new Map();

  const sortOrders = [
    "unpublish_on",
    "title",
    "title_1",
    "search_api_relevance"
  ];

  let expectedAwarded = null;

  for (let si = 0; si < sortOrders.length; si++) {
    const sortBy = sortOrders[si];

    console.log(`\n--- Catalogue sort: ${sortBy} ---`);

    let emptyPages = 0;

    for (let page = 0; page < MAX_PAGES; page++) {
      const url =
        `${BASE_URL}?page=${page}&sort_by=${encodeURIComponent(sortBy)}`;

      const cache =
        `procurement-${sortBy}-page-${String(page).padStart(2, "0")}.html`;

      let html = readCache(cache);

      if (html === null) {
        html = await getText(
          url,
          `EUROCONTROL procurement ${sortBy} page ${page}`
        );
        saveCache(cache, html);
        await sleep(WAIT_MS);
      } else {
        console.log(`Page ${page}: checkpoint`);
      }

      const parsed = parsePage(html, url);

      if (
        expectedAwarded === null &&
        Number.isFinite(parsed.totals.awarded)
      ) {
        expectedAwarded = parsed.totals.awarded;
      }

      let newCurrent = 0;
      let newAwarded = 0;
      let newUpcoming = 0;

      for (const r of parsed.current) {
        const key = keyFor(r);
        if (!current.has(key)) {
          current.set(key, r);
          newCurrent++;
        }
      }

      for (const r of parsed.awarded) {
        const key = keyFor(r);
        if (!awarded.has(key)) {
          awarded.set(key, r);
          newAwarded++;
        }
      }

      for (const r of parsed.upcoming) {
        const key = keyFor(r);
        if (!upcoming.has(key)) {
          upcoming.set(key, r);
          newUpcoming++;
        }
      }

      console.log(
        `Page ${page}: current ${parsed.current.length} (+${newCurrent}), ` +
        `awarded ${parsed.awarded.length} (+${newAwarded}), ` +
        `upcoming ${parsed.upcoming.length} (+${newUpcoming}); ` +
        `awarded union ${awarded.size}` +
        (expectedAwarded !== null ? ` / ${expectedAwarded}` : "")
      );

      if (
        expectedAwarded !== null &&
        awarded.size >= expectedAwarded
      ) {
        console.log("Reached advertised awarded-contract total.");
        break;
      }

      if (
        parsed.current.length === 0 &&
        parsed.awarded.length === 0 &&
        parsed.upcoming.length === 0
      ) {
        emptyPages++;
      } else {
        emptyPages = 0;
      }

      if (emptyPages >= 2) {
        console.log("Two consecutive empty pages for this sort; moving to next sort.");
        break;
      }
    }

    if (
      expectedAwarded !== null &&
      awarded.size >= expectedAwarded
    ) break;
  }

  if (
    expectedAwarded !== null &&
    awarded.size < expectedAwarded
  ) {
    console.log(
      `WARNING: collected ${awarded.size} unique awarded records but source advertises ${expectedAwarded}.`
    );
  }

  return {
    current: [...current.values()],
    awarded: [...awarded.values()],
    upcoming: [...upcoming.values()],
    expectedAwarded
  };
}


async function collectTargetedSpaceSearches() {
  console.log("\n=== Targeted space-procurement supplementation ===");

  const terms = [
    "GNSS",
    "Galileo",
    "EGNOS",
    "ARAIM",
    "satellite",
    "space weather",
    "SATCOM"
  ];

  const current = new Map();
  const awarded = new Map();
  const upcoming = new Map();

  for (const term of terms) {
    const variants = [
      `${BASE_URL}?keywords=${encodeURIComponent(term)}&sort_by=unpublish_on`,
      `${BASE_URL}?keywords_contract=${encodeURIComponent(term)}&sort_by=unpublish_on`
    ];

    for (let vi = 0; vi < variants.length; vi++) {
      const url = variants[vi];
      const safeTerm = term.replace(/[^A-Za-z0-9]+/g, "_");
      const cache = `target-${safeTerm}-${vi}.html`;

      let html = readCache(cache);

      if (html === null) {
        try {
          html = await getText(url, `EUROCONTROL targeted ${term}`);
          saveCache(cache, html);
          await sleep(WAIT_MS);
        } catch (err) {
          console.log(`Targeted search ${term} failed: ${err.message}`);
          continue;
        }
      }

      const parsed = parsePage(html, url);

      for (const r of parsed.current) {
        const key = keyFor(r);
        if (!current.has(key)) current.set(key, r);
      }

      for (const r of parsed.awarded) {
        const key = keyFor(r);
        if (!awarded.has(key)) awarded.set(key, r);
      }

      for (const r of parsed.upcoming) {
        const key = keyFor(r);
        if (!upcoming.has(key)) upcoming.set(key, r);
      }
    }
  }

  console.log(
    `Targeted supplements: current ${current.size}, awarded ${awarded.size}, upcoming ${upcoming.size}`
  );

  return {
    current: [...current.values()],
    awarded: [...awarded.values()],
    upcoming: [...upcoming.values()]
  };
}

// ------------------------------------------------------------
// OPTIONAL PDF ENRICHMENT
// ------------------------------------------------------------

async function enrichRelevantPdf(row) {
  if (!row.documentURL) return row;

  if (
    row.relevanceDecision !== "AUTO_KEEP" &&
    row.relevanceDecision !== "MANUAL_REVIEW"
  ) {
    return row;
  }

  const safe =
    clean(row.reference || row.sourceRecordId)
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .slice(0, 120);

  const cache = `pdf-${safe}.pdf`;

  let buffer = readCache(cache, true);

  if (buffer === null) {
    try {
      buffer = await getBuffer(row.documentURL, `Procurement PDF ${safe}`);
      saveCache(cache, buffer);
      await sleep(WAIT_MS);
    } catch (err) {
      console.log(`PDF download skipped ${safe}: ${err.message}`);
      return row;
    }
  }

  if (
    buffer.length < 5 ||
    buffer.slice(0,5).toString("ascii") !== "%PDF-"
  ) {
    return row;
  }

  try {
    const parsed = await pdf(buffer);
    const text =
      clean(String(parsed.text || "")).slice(0, 12000);

    if (text) {
      row.description =
        clean(`${row.description} ${text}`);

      const cls =
        classify(`${row.title} ${row.description}`);

      const wasAutoKeep =
        row.relevanceDecision === "AUTO_KEEP";

      if (!wasAutoKeep || cls.decision === "AUTO_KEEP") {
        row.relevanceDecision = cls.decision;
        row.spaceClassification = cls.classification;
        row.spaceDomain = cls.domain;
        row.relevanceConfidence = cls.confidence;
        row.relevanceEvidence = cls.evidence;
      }

      row.ragText = [
        `Authority: ${row.authority}`,
        `Reference: ${row.reference}`,
        `Title: ${row.title}`,
        `Description: ${row.description}`,
        `Publication date: ${row.publicationDate}`,
        `Deadline: ${row.deadline}`,
        `Signed date: ${row.signedDate}`,
        `Status: ${row.status}`,
        `Stage: ${row.stage}`,
        `Procurement type: ${row.procurementType}`,
        `Space classification: ${row.spaceClassification}`,
        `Space domain: ${row.spaceDomain}`,
        `Relevance decision: ${row.relevanceDecision}`,
        `Evidence: ${row.relevanceEvidence}`,
        `Source URL: ${row.sourceURL}`,
        `Document URL: ${row.documentURL}`
      ].filter(Boolean).join("\n");
    }
  } catch (err) {
    console.log(`PDF parse warning ${safe}: ${err.message}`);
  }

  return row;
}

// ------------------------------------------------------------
// FILTER / MERGE
// ------------------------------------------------------------

function recordYear(r) {
  for (const v of [r.publicationDate, r.signedDate, r.deadline]) {
    const d = parseDate(v);
    if (d) return d.getUTCFullYear();
  }

  const m =
    clean(r.reference).match(/(?:_|-)(\d{2})(?:\d{3})?\b/);

  if (m) {
    const yy = Number(m[1]);
    return yy >= 90 ? 1900 + yy : 2000 + yy;
  }

  return null;
}

function keyFor(r) {
  const ref = clean(r.reference).toUpperCase();
  // One procedure can award several separate contracts. Preserve each published award document.
  if (ref && r.status === 'AWARDED') return [ref, clean(r.documentURL), clean(r.signedDate), clean(r.title).toLowerCase()].join('|');
  if (ref) return ref;

  return `${clean(r.title).toLowerCase()}|${clean(r.signedDate || r.publicationDate).slice(0,10)}`;
}

function dedup(rows) {
  const map = new Map();

  for (const r of rows) {
    const key = keyFor(r);
    if (!map.has(key)) {
      map.set(key, r);
      continue;
    }

    const cur = map.get(key);

    // Prefer live/open or awarded source facts over ambiguous duplicates.
    const rank = x =>
      x.openNow === "YES" ? 4 :
      x.status === "AWARDED" ? 3 :
      x.status === "PLANNED" ? 2 : 1;

    const primary =
      rank(r) > rank(cur) ? { ...r } : { ...cur };

    const secondary =
      rank(r) > rank(cur) ? cur : r;

    for (const k of Object.keys(primary)) {
      if (!clean(primary[k]) && clean(secondary[k])) {
        primary[k] = secondary[k];
      }
    }

    map.set(key, primary);
  }

  return [...map.values()];
}

// ------------------------------------------------------------
// CSV
// ------------------------------------------------------------

const COLUMNS = [
  "sourceType",
  "sourceAuthority",
  "authority",
  "reference",
  "title",
  "description",
  "publicationDate",
  "deadline",
  "signedDate",
  "status",
  "openNow",
  "stage",
  "procurementType",
  "contractor",
  "spaceClassification",
  "spaceDomain",
  "relevanceDecision",
  "relevanceConfidence",
  "relevanceEvidence",
  "sourceURL",
  "documentURL",
  "sourceRecordId",
  "sourceDataProvenance",
  "sourceDataAltered",
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
        : `_part${String(part).padStart(2, "0")}`;

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

  if (content !== header || !files.length) flush();

  return files;
}

function writeSources() {
  const rows = [
    [
      "EUROCONTROL procurement catalogue",
      BASE_URL,
      "Current business opportunities, awarded contracts and upcoming opportunities",
      "Current + historical public catalogue"
    ],
    [
      "EUROCONTROL Supplier Portal",
      SUPPLIER_PORTAL,
      "Supplier registration, active negotiations, tender documents and submissions",
      "Current secure supplier workflow"
    ]
  ];

  const f =
    path.join(
      OUTPUT_DIR,
      `EUROCONTROL_Procurement_Sources_${TODAY}.csv`
    );

  const csv =
    `"sourceType","url","purpose","coverage"\n` +
    rows.map(r => r.map(esc).join(",")).join("\n") +
    "\n";

  fs.writeFileSync(f, csv, "utf8");
  return f;
}

function copyCollector() { return __filename; }

// ------------------------------------------------------------
// MAIN
// ------------------------------------------------------------

async function main() {
  ensureDirs();

  console.log("==============================================");
  console.log("EUROCONTROL PROCUREMENT COLLECTOR V1.2");
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log(`Checkpoint: ${CACHE_DIR}`);
  console.log(`Historical start: ${START_YEAR}`);
  console.log("==============================================");

  const catalogue =
    await collectCatalogue();

  const targeted =
    await collectTargetedSpaceSearches();

  const rawAll =
    dedup([
      ...catalogue.current,
      ...catalogue.upcoming,
      ...catalogue.awarded,
      ...targeted.current,
      ...targeted.upcoming,
      ...targeted.awarded
    ]);

  const filtered =
    rawAll.filter(r => {
      const y = recordYear(r);
      return y === null || y >= START_YEAR;
    });

  console.log("\n=== Relevant PDF enrichment ===");

  const enriched = [];

  for (let i = 0; i < filtered.length; i++) {
    const r =
      await enrichRelevantPdf(filtered[i]);

    enriched.push(r);

    if (
      (r.relevanceDecision === "AUTO_KEEP" ||
       r.relevanceDecision === "MANUAL_REVIEW") &&
      (i + 1) % 10 === 0
    ) {
      console.log(`Reviewed ${i+1}/${filtered.length} catalogue records`);
    }
  }

  const all =
    dedup(enriched)
      .sort((a,b) => {
        const da = parseDate(a.publicationDate || a.signedDate || a.deadline);
        const db = parseDate(b.publicationDate || b.signedDate || b.deadline);
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
      r => r.status === "PLANNED"
    );

  const historical =
    ragReady.filter(
      r =>
        r.openNow !== "YES" &&
        r.status !== "PLANNED"
    );

  const awards =
    ragReady.filter(
      r => r.status === "AWARDED"
    );

  const files = [];

  files.push(...writeCsvChunked("EUROCONTROL_Procurement_All", all));
  files.push(...writeCsvChunked("EUROCONTROL_Space_Procurement_RAG", ragReady));
  files.push(...writeCsvChunked("EUROCONTROL_Open_Space_Procurement", open));
  files.push(...writeCsvChunked("EUROCONTROL_Planned_Space_Procurement", planned));
  files.push(...writeCsvChunked("EUROCONTROL_Space_Procurement_Historical", historical));
  files.push(...writeCsvChunked("EUROCONTROL_Space_Awards_Suppliers", awards));
  files.push(...writeCsvChunked("EUROCONTROL_Space_Manual_Review", manual));
  files.push(writeSources());
  files.push(copyCollector());

  const summary = {
    runDate: TODAY,
    historicalStart: START_YEAR,
    sourceCounts: {
      currentCatalogue: catalogue.current.length,
      upcomingCatalogue: catalogue.upcoming.length,
      awardedCatalogue: catalogue.awarded.length,
      advertisedAwardedTotal: catalogue.expectedAwarded,
      targetedCurrentSupplements: targeted.current.length,
      targetedAwardedSupplements: targeted.awarded.length,
      targetedUpcomingSupplements: targeted.upcoming.length
    },
    totalUniqueProcurementRecords: all.length,
    spaceRelevantIncludingManualReview: relevant.length,
    ragReadySpace: ragReady.length,
    openSpace: open.length,
    plannedSpace: planned.length,
    historicalSpace: historical.length,
    awardSupplierSpace: awards.length,
    manualReview: manual.length,
    methodology: [
      "Official EUROCONTROL public procurement catalogue, including Current business opportunities, Awarded contracts and Upcoming business opportunities",
      "Public catalogue pagination is unioned across multiple official sort orders (Most recent, A-Z, Z-A, Relevance) to recover pagination inconsistencies and continues until the advertised awarded total is reached where possible",
      "Targeted catalogue searches for GNSS, Galileo, EGNOS, ARAIM, satellite, space weather and SATCOM supplement the paginated catalogue so relevant records are not lost if catalogue pagination shifts",
      "Relevant procurement PDFs are downloaded and parsed to enrich classification where the catalogue title alone is insufficient; a previously confirmed core-space title cannot be demoted merely because the PDF also contains generic administrative words",
      "Conservative classifier focused on GNSS/Galileo/EGNOS/PNT, ARAIM/SBAS, satellite communications, space weather, space-based surveillance, RF/interference monitoring and tightly contextualized CNS/datalink/U-space procurement"
    ],
    limitations: [
      "EUROCONTROL is an intergovernmental organisation and follows its own Contract Regulations; it is not an EU agency and its procurement is not expected to be complete in TED or the EU Funding & Tenders Portal.",
      "Supplier names are only captured if exposed in the public catalogue or procurement documents; secure supplier-portal information is not scraped.",
      "Generic ATM software, facilities, training and corporate procurement is excluded from the primary space RAG.",
      "Datalink, surveillance, spectrum and U-space procurement without explicit satellite/GNSS or multiple space-enabled ATM signals is kept for manual review rather than automatically classified as space."
    ]
  };

  const summaryFile =
    path.join(
      OUTPUT_DIR,
      `EUROCONTROL_Procurement_Summary_${TODAY}.json`
    );

  fs.writeFileSync(
    summaryFile,
    JSON.stringify(summary, null, 2),
    "utf8"
  );

  files.push(summaryFile);

  console.log("\n==============================================");
  console.log("EUROCONTROL PROCUREMENT COLLECTION COMPLETE");
  console.log(`Current catalogue records: ${catalogue.current.length}`);
  console.log(`Upcoming catalogue records: ${catalogue.upcoming.length}`);
  console.log(`Awarded catalogue records: ${catalogue.awarded.length}`);
  console.log(`Advertised awarded total: ${catalogue.expectedAwarded ?? "unknown"}`);
  console.log(`Targeted current supplements: ${targeted.current.length}`);
  console.log(`Targeted awarded supplements: ${targeted.awarded.length}`);
  console.log(`Targeted upcoming supplements: ${targeted.upcoming.length}`);
  console.log(`All unique procurement records 2020-present: ${all.length}`);
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
  console.error("\nEUROCONTROL PROCUREMENT COLLECTOR FAILED");
  console.error(err.stack || err.message || err);
  process.exit(1);
});

module.exports = { main, outputDirectory: OUTPUT_DIR, makeRow, iso, keyFor, dedup, parsePage };
