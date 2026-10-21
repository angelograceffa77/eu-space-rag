const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");

// ============================================================
// ESO PROCUREMENT COLLECTOR — V1.1
// European Southern Observatory
//
// OUTPUT:
// Default output: ../generated (or PROCUREMENT_OUTPUT_DIR)
//
// SOURCES
// 1) ESO In-Tend e-Procurement Portal (current/forthcoming/awarded).
// 2) ESO legacy >150 kEUR Calls for Tender / Preliminary Inquiry page.
// 3) ESO legacy 50-150 kEUR procurement page.
// 4) ESO "Doing Business with ESO" page as procurement-policy provenance.
//
// HISTORICAL COVERAGE
// 2020-present. ESO states that procurements since 7 Nov 2022 are handled
// through In-Tend. Legacy ESO tables are therefore used for the 2020-2022
// transition/history and In-Tend for newer/current records.
//
// RAG SCOPE
// Astronomy/space-industry technology procurement: ELT/VLT/ALMA/CTAO,
// telescope/instrument systems, optics/mirrors/coatings, adaptive optics,
// lasers/photonics, detectors/cameras/sensors, cryogenics/vacuum,
// precision mechanics, RF/receivers/antennas, control/data/software systems,
// observatory engineering and specialised infrastructure.
//
// Generic catering, office, travel, HR and non-technical facilities are excluded.
// ============================================================

const OUTPUT_DIR = path.resolve(process.env.PROCUREMENT_OUTPUT_DIR || path.join(__dirname, "../generated"));

const TODAY = new Date().toISOString().slice(0, 10);
const CACHE_DIR = path.join(OUTPUT_DIR, "_ESO_CACHE", TODAY);

const START_YEAR = 2020;
const CSV_MAX_BYTES = 90 * 1024 * 1024;
const WAIT_MS = 700;

const FORCE_REFRESH =
  String(process.env.ESO_FORCE_REFRESH || "").trim() === "1";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154 Safari/537.36 " +
  "ESO-Procurement-Collector/1.0";

const ESO_INDUSTRY =
  "https://www.eso.org/public/industry/";

const LEGACY_GT150 =
  "https://www.eso.org/public/industry/cp/docs/CFT-advance.html";

const LEGACY_50_150 =
  "https://www.eso.org/public/industry/cp/docs/50-150k_Procurements.html";

const INTEND_HOME =
  "https://www.in-tendhost.co.uk/eso/aspx/Home";

const INTEND_PAGES = [
  {
    status: "OPEN",
    stage: "Current / In-Tend",
    urls: [
      "https://www.in-tendhost.co.uk/eso/aspx/Tenders/CurrentTenders",
      "https://www.in-tendhost.co.uk/eso/aspx/Tenders/Current",
      "https://www.in-tendhost.co.uk/eso/aspx/Tenders/729"
    ]
  },
  {
    status: "PLANNED",
    stage: "Forthcoming / In-Tend",
    urls: [
      "https://www.in-tendhost.co.uk/eso/aspx/Tenders/ForthcomingTenders",
      "https://www.in-tendhost.co.uk/eso/aspx/Tenders/Forthcoming"
    ]
  },
  {
    status: "AWARDED",
    stage: "Awarded / In-Tend",
    urls: [
      "https://www.in-tendhost.co.uk/eso/aspx/Tenders/AwardedTenders",
      "https://www.in-tendhost.co.uk/eso/aspx/Tenders/Awarded"
    ]
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

// ------------------------------------------------------------
// CLASSIFICATION
// ------------------------------------------------------------

const STRONG = [
  "extremely large telescope",
  "elt",
  "very large telescope",
  "vlt",
  "alma",
  "ctao",
  "telescope",
  "astronomical instrument",
  "scientific instrument",
  "spectrograph",
  "spectrometer",
  "interferometer",
  "adaptive optics",
  "wavefront",
  "laser guide star",
  "laser",
  "photonics",
  "optical system",
  "optics",
  "mirror",
  "mirror segment",
  "mirror coating",
  "coating unit",
  "detector",
  "focal plane",
  "camera",
  "cryogenic",
  "cryostat",
  "vacuum system",
  "vacuum vessel",
  "antenna",
  "receiver",
  "radio frequency",
  "rf system",
  "millimeter",
  "millimetre",
  "submillimeter",
  "submillimetre",
  "fiber optic",
  "fibre optic",
  "precision mechanism",
  "precision mechanics",
  "instrument control",
  "telescope control",
  "observatory control",
  "data acquisition",
  "scientific data"
];

const SUPPORT = [
  "control system",
  "software",
  "electronics",
  "electrical",
  "mechanical",
  "engineering",
  "automation",
  "metrology",
  "sensor",
  "calibration",
  "cooling",
  "thermal",
  "structure",
  "dome",
  "rotating enclosure",
  "observatory infrastructure",
  "technical infrastructure"
];

const GENERIC = [
  "canteen",
  "catering",
  "office furniture",
  "office supplies",
  "travel",
  "hotel",
  "insurance",
  "human resources",
  "recruitment",
  "language training",
  "cleaning service",
  "gym"
];

function detectDomain(t) {
  if (/adaptive optics|wavefront|laser guide star/.test(t)) return "Adaptive Optics / Wavefront / Lasers";
  if (/mirror|optics|optical system|coating/.test(t)) return "Optics / Mirrors / Coatings";
  if (/detector|focal plane|camera|sensor/.test(t)) return "Detectors / Cameras / Sensors";
  if (/cryogenic|cryostat|vacuum/.test(t)) return "Cryogenics / Vacuum";
  if (/antenna|receiver|radio frequency|\brf\b|millimeter|millimetre|submillimeter|submillimetre/.test(t)) return "RF / Receivers / Antennas";
  if (/spectrograph|spectrometer|interferometer|instrument/.test(t)) return "Scientific Instrumentation";
  if (/software|control system|data acquisition|scientific data/.test(t)) return "Control / Software / Data";
  if (/structure|dome|rotating enclosure|technical infrastructure|observatory infrastructure/.test(t)) return "Observatory / Telescope Infrastructure";
  if (/elt|extremely large telescope/.test(t)) return "ELT";
  if (/vlt|very large telescope/.test(t)) return "VLT";
  if (/alma/.test(t)) return "ALMA";
  if (/ctao/.test(t)) return "CTAO";
  return "Astronomy / Space-Industry Technology";
}

function classify(text) {
  const t = clean(text).toLowerCase();

  const strong = STRONG.filter(x => t.includes(x));
  const support = SUPPORT.filter(x => t.includes(x));
  const generic = GENERIC.filter(x => t.includes(x));

  if (strong.length && !generic.length) {
    return {
      decision: "AUTO_KEEP",
      classification: "SPACE-INDUSTRY / ASTRONOMY TECHNOLOGY",
      domain: detectDomain(t),
      confidence: "HIGH",
      evidence: uniq([...strong, ...support]).join(" | ")
    };
  }

  if (support.length >= 2 && !generic.length) {
    return {
      decision: "AUTO_KEEP",
      classification: "SPACE-INDUSTRY / TECHNICAL SUPPORT",
      domain: detectDomain(t),
      confidence: "MEDIUM",
      evidence: support.join(" | ")
    };
  }

  if (support.length === 1 && !generic.length) {
    return {
      decision: "MANUAL_REVIEW",
      classification: "POSSIBLE SPACE-INDUSTRY / ENGINEERING",
      domain: detectDomain(t),
      confidence: "MEDIUM",
      evidence: support.join(" | ")
    };
  }

  return {
    decision: "AUTO_EXCLUDE",
    classification: "NON-SPACE / GENERIC ESO PROCUREMENT",
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
    sourceAuthority: "European Southern Observatory",
    authority: "European Southern Observatory (ESO)",
    reference: base.reference || "",
    title: base.title || "",
    description: base.description || "",
    publicationDate: base.publicationDate || "",
    deadline: base.deadline || "",
    status: base.status || "",
    openNow: base.openNow || "NO",
    stage: base.stage || "",
    contractType: base.contractType || "",
    awardPrinciple: base.awardPrinciple || "",
    eligibleCountries: base.eligibleCountries || "",
    estimatedIssueDate: base.estimatedIssueDate || "",
    contractor: base.contractor || "",
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
    `Contract type: ${row.contractType}`,
    `Eligible countries: ${row.eligibleCountries}`,
    `Estimated issue date: ${row.estimatedIssueDate}`,
    `Contractor: ${row.contractor}`,
    `Space classification: ${row.spaceClassification}`,
    `Space domain: ${row.spaceDomain}`,
    `Relevance decision: ${row.relevanceDecision}`,
    `Evidence: ${row.relevanceEvidence}`,
    `Source URL: ${row.sourceURL}`
  ].filter(Boolean).join("\n");

  return row;
}

// ------------------------------------------------------------
// LEGACY ESO TABLES
// ------------------------------------------------------------

function parseLegacyTables(html, sourceType, sourceURL) {
  const $ = cheerio.load(html);
  const rows = [];

  $("table").each((_, table) => {
    const trs = $(table).find("tr");
    if (!trs.length) return;

    let headerIndex = -1;
    let headers = [];

    trs.each((i, tr) => {
      const cells =
        $(tr).find("th,td").map((__, el) => clean($(el).text())).get();

      if (
        cells.some(x => /Reference No/i.test(x)) &&
        cells.some(x => /Subject/i.test(x))
      ) {
        headerIndex = i;
        headers = cells.map(x => x.toLowerCase());
        return false;
      }
    });

    if (headerIndex < 0) return;

    const refIdx = headers.findIndex(x => /reference/.test(x));
    const dateIdx = headers.findIndex(x => /^date/.test(x));
    const subjectIdx = headers.findIndex(x => /subject/.test(x));
    const typeIdx = headers.findIndex(x => /type of contract/.test(x));
    const principleIdx = headers.findIndex(x => /award principle/.test(x));
    const countryIdx = headers.findIndex(x => /eligible countries/.test(x));
    const issueIdx = headers.findIndex(x => /estimated issue/.test(x));

    trs.slice(headerIndex + 1).each((__, tr) => {
      const cells =
        $(tr).find("td").map((___, el) => clean($(el).text())).get();

      if (!cells.length) return;

      const reference = refIdx >= 0 ? clean(cells[refIdx]) : "";
      const subject = subjectIdx >= 0 ? clean(cells[subjectIdx]) : "";

      if (!reference && !subject) return;

      const dateText = dateIdx >= 0 ? clean(cells[dateIdx]) : "";
      const pubDate = iso(dateText);

      const year =
        pubDate
          ? new Date(pubDate).getUTCFullYear()
          : Number((dateText.match(/\b20\d{2}\b/) || [])[0]);

      if (year && year < START_YEAR) return;

      const status =
        /forthcoming/i.test(sourceType)
          ? "PLANNED"
          : "CLOSED";

      rows.push(
        makeRow({
          sourceType,
          reference,
          title: subject,
          description: clean($(tr).text()),
          publicationDate: pubDate,
          deadline: "",
          status,
          openNow: "NO",
          stage:
            status === "PLANNED"
              ? "Planning / Legacy ESO Advance Information"
              : "Historical / Legacy ESO Procurement",
          contractType: typeIdx >= 0 ? clean(cells[typeIdx]) : "",
          awardPrinciple: principleIdx >= 0 ? clean(cells[principleIdx]) : "",
          eligibleCountries: countryIdx >= 0 ? clean(cells[countryIdx]) : "",
          estimatedIssueDate: issueIdx >= 0 ? clean(cells[issueIdx]) : "",
          sourceURL,
          sourceRecordId: reference || `${subject}|${dateText}`,
          sourceDataProvenance: "Official ESO legacy procurement page"
        })
      );
    });
  });

  return rows;
}


function parseLegacyGt150(html, sourceURL) {
  const $ = cheerio.load(html);
  const rows = [];

  $("table").each((_, table) => {
    const trs = $(table).find("tr");
    if (!trs.length) return;

    let headerIndex = -1;
    let headers = [];

    trs.each((i, tr) => {
      const cells =
        $(tr).find("th,td").map((__, el) => clean($(el).text())).get();

      if (
        cells.some(x => /Cft No|CfT No/i.test(x)) &&
        cells.some(x => /Subject/i.test(x))
      ) {
        headerIndex = i;
        headers = cells.map(x => x.toLowerCase());
        return false;
      }
    });

    if (headerIndex < 0) return;

    const refIdx = headers.findIndex(x => /cft no/.test(x));
    const dateIdx = headers.findIndex(x => /^date/.test(x));
    const divisionIdx = headers.findIndex(x => /division/.test(x));
    const subjectIdx = headers.findIndex(x => /subject/.test(x));
    const detailsIdx = headers.findIndex(x => /details/.test(x));
    const scheduleIdx = headers.findIndex(x => /scheduled for issuance/.test(x));

    trs.slice(headerIndex + 1).each((__, tr) => {
      const cells =
        $(tr).find("td").map((___, el) => clean($(el).text())).get();

      if (!cells.length) return;

      const reference = refIdx >= 0 ? clean(cells[refIdx]) : "";
      const dateText = dateIdx >= 0 ? clean(cells[dateIdx]) : "";
      const division = divisionIdx >= 0 ? clean(cells[divisionIdx]) : "";
      const subject = subjectIdx >= 0 ? clean(cells[subjectIdx]) : "";
      const details = detailsIdx >= 0 ? clean(cells[detailsIdx]) : "";
      const schedule = scheduleIdx >= 0 ? clean(cells[scheduleIdx]) : "";

      if (!reference && !subject) return;

      const originalDate = iso(dateText);
      const originalYear =
        originalDate
          ? new Date(originalDate).getUTCFullYear()
          : Number((dateText.match(/\b20\d{2}\b/) || [])[0]);

      // Keep records whose advance-info date is >=2020, or whose details
      // contain a 2020+ release/award/update date.
      const detailYears =
        [...`${details} ${schedule}`.matchAll(/\b20\d{2}\b/g)]
          .map(m => Number(m[0]))
          .filter(y => y >= START_YEAR);

      if (
        originalYear &&
        originalYear < START_YEAR &&
        detailYears.length === 0
      ) return;

      const releaseMatch =
        details.match(/Release date:\s*(\d{1,2}[.\/-]\d{1,2}[.\/-]20\d{2})/i);

      const closingMatches =
        [...details.matchAll(/Closing date:\s*(\d{1,2}[.\/-]\d{1,2}[.\/-]20\d{2})/ig)];

      const publicationDate =
        releaseMatch
          ? iso(releaseMatch[1])
          : originalDate;

      const deadline =
        closingMatches.length
          ? iso(closingMatches[closingMatches.length - 1][1])
          : "";

      let status = "CLOSED";
      let openNow = "NO";
      let stage = "Historical / Legacy ESO Procurement";

      if (/contract was awarded to/i.test(details)) {
        status = "AWARDED";
        stage = "Historical / Awarded Contract";
      } else if (
        /\bongoing\b/i.test(details) &&
        /ESO Procurement Portal|Call for tender|CFT/i.test(details)
      ) {
        status = "OPEN";
        openNow = "YES";
        stage = "Current / Legacy-linked In-Tend";
      } else if (/ON HOLD/i.test(details)) {
        status = "ON_HOLD";
        stage = "Historical / On Hold";
      } else if (
        /further information will be published on the ESO Procurement Portal/i.test(details) &&
        !deadline
      ) {
        status = "PLANNED";
        stage = "Planning / Legacy-linked Procurement";
      }

      // Deadline controls current status where present.
      if (deadline) {
        const d = parseDate(deadline);
        if (d && d.getTime() >= Date.now() && status !== "AWARDED") {
          status = "OPEN";
          openNow = "YES";
          stage = "Current / Legacy-linked In-Tend";
        } else if (d && d.getTime() < Date.now() && status === "OPEN") {
          status = "CLOSED";
          openNow = "NO";
          stage = "Historical / Legacy ESO Procurement";
        }
      }

      const awardMatch =
        details.match(
          /contract was awarded to\s+(.+?)(?:\s*\([A-Z]{2}\)|$)/i
        );

      const contractor =
        awardMatch ? clean(awardMatch[1]) : "";

      rows.push(
        makeRow({
          sourceType: "ESO Legacy >=150 kEUR Historical",
          reference,
          title: subject,
          description:
            clean(
              `Division: ${division}. ${details} Scheduled/Status: ${schedule}`
            ),
          publicationDate,
          deadline,
          status,
          openNow,
          stage,
          contractType: "",
          awardPrinciple: "",
          eligibleCountries: "",
          estimatedIssueDate: schedule,
          contractor,
          sourceURL,
          sourceRecordId: reference || `${subject}|${dateText}`,
          sourceDataProvenance:
            "Official ESO legacy >=150 kEUR procurement page; status and award text preserved from ESO updates"
        })
      );
    });
  });

  return rows;
}

async function collectLegacy(url, cache, label) {
  if(require('../../daily/scope.cjs').active())return [];
  let html = readCache(cache);

  if (html === null) {
    html = await getText(url, label);
    saveCache(cache, html);
  } else {
    console.log(`${label}: checkpoint`);
  }

  const rows =
    /gt150|>=150/i.test(cache + " " + label)
      ? parseLegacyGt150(
          html,
          url
        )
      : parseLegacyTables(
          html,
          `${label} Historical`,
          url
        );

  console.log(`${label}: ${rows.length} rows 2020-present`);
  return rows;
}

// ------------------------------------------------------------
// IN-TEND
// ------------------------------------------------------------

function parseProjectId(href) {
  const m = clean(href).match(/\/aspx\/ProjectManage\/(\d+)/i);
  return m ? m[1] : "";
}

function parseInTendListing(html, pageStatus, stage, sourceURL) {
  const $ = cheerio.load(html);
  const rows = [];
  const seen = new Set();

  $("a[href]").each((_, a) => {
    const href = $(a).attr("href") || "";
    const id = parseProjectId(href);
    if (!id || seen.has(id)) return;

    seen.add(id);

    const parent =
      $(a).closest("tr,div,li").first();

    const text =
      clean(
        parent.length
          ? parent.text()
          : $(a).text()
      );

    const title =
      clean($(a).text()) ||
      text.slice(0, 1000);

    rows.push(
      makeRow({
        sourceType: "ESO In-Tend",
        reference: `INTEND-${id}`,
        title,
        description: text,
        publicationDate: "",
        deadline: "",
        status: pageStatus,
        openNow: pageStatus === "OPEN" ? "YES" : "NO",
        stage,
        sourceURL:
          new URL(href, sourceURL).href,
        sourceRecordId: id,
        sourceDataProvenance: "ESO In-Tend public tender listing"
      })
    );
  });

  return rows;
}

function detailField($, labelPattern) {
  let found = "";

  $("td,th,div,span,label").each((_, el) => {
    const text = clean($(el).text());

    if (!labelPattern.test(text)) return;

    const next =
      $(el).next("td,div,span").first();

    if (next.length) {
      const v = clean(next.text());
      if (v && v !== text) {
        found = v;
        return false;
      }
    }
  });

  return found;
}

async function enrichInTendRow(row) {
  const id = row.sourceRecordId;
  const cache = `intend-project-${id}.html`;

  let html = readCache(cache);

  if (html === null) {
    try {
      html = await getText(row.sourceURL, `In-Tend project ${id}`);
      saveCache(cache, html);
    } catch (err) {
      console.log(`Skip project detail ${id}: ${err.message}`);
      return row;
    }
    await sleep(WAIT_MS);
  }

  const $ = cheerio.load(html);
  const body = clean($("body").text());

  if (/project is no longer visible/i.test(body)) {
    row.status = row.status === "AWARDED" ? "AWARDED" : "UNKNOWN";
    row.openNow = "NO";
  }

  const issue =
    detailField($, /Issue Date/i);

  const deadline =
    detailField($, /Deadline For Applications|Deadline/i);

  const title =
    detailField($, /Project Title|Tender Title|Title/i);

  if (title && title.length < 1500) row.title = title;
  if (issue) row.publicationDate = iso(issue);
  if (deadline) row.deadline = iso(deadline);

  row.description =
    clean(`${row.description} ${body.slice(0, 5000)}`);

  const cls =
    classify(`${row.title} ${row.description}`);

  row.relevanceDecision = cls.decision;
  row.spaceClassification = cls.classification;
  row.spaceDomain = cls.domain;
  row.relevanceConfidence = cls.confidence;
  row.relevanceEvidence = cls.evidence;

  row.ragText = [
    `Authority: ${row.authority}`,
    `Reference: ${row.reference}`,
    `Title: ${row.title}`,
    `Description: ${row.description}`,
    `Publication date: ${row.publicationDate}`,
    `Deadline: ${row.deadline}`,
    `Status: ${row.status}`,
    `Stage: ${row.stage}`,
    `Space classification: ${row.spaceClassification}`,
    `Space domain: ${row.spaceDomain}`,
    `Relevance decision: ${row.relevanceDecision}`,
    `Evidence: ${row.relevanceEvidence}`,
    `Source URL: ${row.sourceURL}`
  ].filter(Boolean).join("\n");

  return row;
}

async function collectInTend() {
  console.log("\n=== ESO In-Tend procurement portal ===");

  const all = [];
  const used = new Set();

  for (const group of INTEND_PAGES) {
    let groupRows = [];
    let selectedURL = "";

    for (let i = 0; i < group.urls.length; i++) {
      const url = group.urls[i];
      const cache =
        `intend-${group.status.toLowerCase()}-${i}.html`;

      let html = readCache(cache);

      if (html === null) {
        try {
          html = await getText(url, `In-Tend ${group.status}`);
          saveCache(cache, html);
        } catch (err) {
          console.log(`In-Tend ${group.status} URL failed: ${url} (${err.message})`);
          continue;
        }
      }

      const parsed =
        parseInTendListing(
          html,
          group.status,
          group.stage,
          url
        );

      if (parsed.length > groupRows.length) {
        groupRows = parsed;
        selectedURL = url;
      }
    }

    console.log(
      `In-Tend ${group.status}: ${groupRows.length} project links` +
      (selectedURL ? ` from ${selectedURL}` : "")
    );

    if (!groupRows.length) {
      console.log(
        `  Note: zero In-Tend rows may indicate JavaScript/reCAPTCHA blocking, not zero ESO opportunities.`
      );
    }

    for (const r of groupRows) {
      const key = `${group.status}|${r.sourceRecordId}`;
      if (used.has(key)) continue;
      used.add(key);

      const enriched =
        await enrichInTendRow(r);

      all.push(enriched);
    }
  }

  return all;
}

// ------------------------------------------------------------
// MERGE / OUTPUT
// ------------------------------------------------------------

function keyFor(r) {
  if (r.sourceType === "ESO In-Tend" && r.sourceRecordId) {
    return `INTEND|${r.sourceRecordId}`;
  }

  const ref =
    clean(r.reference).toUpperCase();

  if (ref) return `REF|${ref}`;

  return (
    `TITLE|${clean(r.title).toLowerCase().slice(0,180)}` +
    `|${clean(r.publicationDate).slice(0,10)}`
  );
}

function priority(r) {
  if (r.sourceType === "ESO In-Tend") return 60;
  if (/Legacy/.test(r.sourceType)) return 30;
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
  "contractType",
  "awardPrinciple",
  "eligibleCountries",
  "estimatedIssueDate",
  "contractor",
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
      "ESO Doing Business with Industry",
      ESO_INDUSTRY,
      "Official procurement policy and industrial participation framework",
      "Current"
    ],
    [
      "ESO In-Tend",
      INTEND_HOME,
      "Current, forthcoming and awarded ESO procurements since November 2022",
      "2022-present"
    ],
    [
      "ESO legacy >=150 kEUR",
      LEGACY_GT150,
      "Historical Calls for Tender / Preliminary Inquiry",
      "2020-transition period"
    ],
    [
      "ESO legacy 50-150 kEUR",
      LEGACY_50_150,
      "Historical Price Inquiries / Calls for Tender / RFI",
      "2020-transition period"
    ]
  ];

  const f =
    path.join(
      OUTPUT_DIR,
      `ESO_Procurement_Sources_${TODAY}.csv`
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
  const portalAccess = await require("../portal-access.cjs").inspect(OUTPUT_DIR);

  console.log("==============================================");
  console.log("ESO PROCUREMENT COLLECTOR V1.1");
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log(`Checkpoint: ${CACHE_DIR}`);
  console.log(`Historical start: ${START_YEAR}`);
  console.log("==============================================");

  const inTend =
    await collectInTend();

  console.log("\n=== ESO legacy procurement history ===");

  const legacyGt150 =
    await collectLegacy(
      LEGACY_GT150,
      "legacy-gt150.html",
      "ESO Legacy >=150 kEUR"
    );

  const legacyMid =
    await collectLegacy(
      LEGACY_50_150,
      "legacy-50-150.html",
      "ESO Legacy 50-150 kEUR"
    );

  const all =
    mergeRows([
      ...inTend,
      ...legacyGt150,
      ...legacyMid
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

  files.push(...writeCsvChunked("ESO_Procurement_All", all));
  files.push(...writeCsvChunked("ESO_Space_Industry_Procurement_RAG", ragReady));
  files.push(...writeCsvChunked("ESO_Open_Space_Industry_Procurement", open));
  files.push(...writeCsvChunked("ESO_Planned_Space_Industry_Procurement", planned));
  files.push(...writeCsvChunked("ESO_Space_Industry_Procurement_Historical", historical));
  files.push(...writeCsvChunked("ESO_Space_Industry_Awards_Suppliers", awards));
  files.push(...writeCsvChunked("ESO_Space_Industry_Manual_Review", manual));
  files.push(writeSources());
  files.push(copyCollector());

  // Export the exact same records without modifying cached source responses.
  const workbook = new (require('exceljs').Workbook)();
  for (const [name, rows] of Object.entries({All:all, RAG:ragReady, Open:open, Planned:planned, Historical:historical, Awards:awards, Review:manual})) {
    const file = path.join(OUTPUT_DIR, 'ESO_' + name + '_' + TODAY + '.jsonl');
    fs.writeFileSync(file, rows.map(r=>JSON.stringify(r)).join('\n') + (rows.length?'\n':''), 'utf8'); files.push(file);
    const sheet = workbook.addWorksheet(name);
    const keys = [...new Set(rows.flatMap(r=>Object.keys(r)))];
    sheet.columns = (keys.length?keys:COLUMNS).map(key=>({header:key,key}));
    for (const row of rows) sheet.addRow(row);
  }
  const excelFile = path.join(OUTPUT_DIR, 'ESO_Procurement_' + TODAY + '.xlsx');
  await workbook.xlsx.writeFile(excelFile); files.push(excelFile);
  const summary = {
    runDate: TODAY,
    historicalStart: START_YEAR,
    sourceCounts: {
      inTend: inTend.length,
      legacyAbove150k: legacyGt150.length,
      legacy50to150k: legacyMid.length
    },
    liveInTendLayerAccessible: false,
    publicListingRecordsObserved: inTend.length,
    portalAccess,
    collectionStatus: "partial",
    currentTenderCountVerified: false,
    totalUniqueProcurementRecords: all.length,
    spaceIndustryRelevantIncludingManualReview: relevant.length,
    ragReadySpaceIndustry: ragReady.length,
    openSpaceIndustry: open.length,
    plannedSpaceIndustry: planned.length,
    historicalSpaceIndustry: historical.length,
    awardedSpaceIndustry: awards.length,
    manualReview: manual.length,
    methodology: [
      "ESO In-Tend public portal for current, forthcoming and awarded procurement since November 2022",
      "Official ESO legacy procurement tables for historical calls and price inquiries around the 2020-2022 transition; the >=150 kEUR page is parsed with its native Cft No/Date/Division/Subject/Details structure and preserves later award/status updates",
      "Conservative European space-industry classifier focused on telescope/instrument systems, optics, adaptive optics, detectors, cryogenics, RF/receivers, precision mechanics, scientific software/data and observatory engineering"
    ],
    limitations: [
      "The ESO In-Tend portal is JavaScript-heavy and can present reCAPTCHA/anti-bot challenges. If the local run returns zero In-Tend rows, this does NOT mean ESO has zero current/forthcoming/awarded procurements; it means the live layer is not machine-readable through plain HTTP from this collector.",
      "ESO is an intergovernmental astronomy organisation, not an EU agency. The RAG scope therefore means procurement relevant to the European space/astronomy industrial supply chain, not EU public procurement in the narrow legal sense.",
      "Generic catering, office, travel, HR and non-technical facilities procurement is excluded.",
      "Supplier/award details depend on what the public In-Tend pages expose without authentication."
    ]
  };

  const summaryFile =
    path.join(
      OUTPUT_DIR,
      `ESO_Procurement_Summary_${TODAY}.json`
    );

  fs.writeFileSync(
    summaryFile,
    JSON.stringify(summary, null, 2),
    "utf8"
  );

  files.push(summaryFile);

  console.log("\n==============================================");
  console.log("ESO PROCUREMENT EXPORT COMPLETE — COVERAGE PARTIAL");
  console.log(`In-Tend records: ${inTend.length}`);
  console.log(`Legacy >=150 kEUR records: ${legacyGt150.length}`);
  console.log(`Legacy 50-150 kEUR records: ${legacyMid.length}`);
  console.log(`All unique procurement records: ${all.length}`);
  console.log(`Space-industry relevant incl. manual review: ${relevant.length}`);
  console.log(`RAG-ready space-industry: ${ragReady.length}`);
  console.log(`OPEN space-industry: ${open.length}`);
  console.log(`PLANNED space-industry: ${planned.length}`);
  console.log(`Historical space-industry: ${historical.length}`);
  console.log(`Awarded space-industry: ${awards.length}`);
  console.log(`Manual review: ${manual.length}`);
  console.log("\nGenerated files:");
  for (const f of files) console.log(f);
  console.log("==============================================\n");
}

if (require.main === module) main().catch(err => {
  console.error("\nESO PROCUREMENT COLLECTOR FAILED");
  console.error(err.stack || err.message || err);
  process.exit(1);
});

module.exports = { main, outputDirectory: OUTPUT_DIR };
