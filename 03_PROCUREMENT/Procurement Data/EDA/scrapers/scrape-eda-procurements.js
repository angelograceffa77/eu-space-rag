const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cheerio = require("cheerio");

// ============================================================
// EDA PROCUREMENT COLLECTOR — V1.1
// European Defence Agency (EDA)
// Formal tenders + EDA low-value/other notices
// Historical coverage: 2020 -> present
//
// OUTPUT FOLDER:
// Default output: ../generated (or PROCUREMENT_OUTPUT_DIR)
//
// METHODOLOGY
// 1) EU Funding & Tenders Portal SEARCH API:
//    exact EDA legal entity id = 47352396
//    This is the official destination linked by EDA for closed tenders.
// 2) EDA procurement landing page:
//    captures current "Ongoing Calls For Tenders".
// 3) EDA "Other notices":
//    captures EDA ex-ante publicity / low-value / market consultation
//    records currently exposed by EDA.
//
// Notes:
// - EDA's public website does not expose a complete machine-readable archive
//   of all historical "Other notices". Formal tender history is therefore
//   anchored on the Funding & Tenders Portal.
// - Technical cache/checkpoints are kept under _EDA_CACHE/<run date>.
// - CSV outputs are chunked automatically before 90 MB to stay Git-friendly.
// ============================================================

const OUTPUT_DIR = path.resolve(process.env.PROCUREMENT_OUTPUT_DIR || path.join(__dirname, "../generated"));

const TODAY = new Date().toISOString().slice(0, 10);
const RUN_CACHE_DIR = path.join(OUTPUT_DIR, "_EDA_CACHE", TODAY);

const FNT_API =
  "https://api.tech.ec.europa.eu/search-api/prod/rest/search";

const EDA_PROCUREMENT =
  "https://www.eda.europa.eu/procurement";

const EDA_OTHER_NOTICES =
  "https://www.eda.europa.eu/procurement/other-notices";

const EDA_LEGAL_ENTITY_ID = "47352396";
const START_DATE = "2020-01-01";

const PAGE_SIZE = 100;
const RETRY_START_MS = 10000;
const RETRY_MAX_MS = 120000;
const BETWEEN_REQUESTS_MS = 900;
const CSV_MAX_BYTES = 90 * 1024 * 1024;

const FORCE_REFRESH =
  String(process.env.EDA_FORCE_REFRESH || "").trim() === "1";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154 Safari/537.36 " +
  "EDA-Procurement-Collector/1.0";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ensureDirs() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(RUN_CACHE_DIR, { recursive: true });
}

function clean(v) {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.map(clean).filter(Boolean).join(" | ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v).replace(/\s+/g, " ").trim();
}

function arr(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function first(v) {
  const a = arr(v).map(clean).filter(Boolean);
  return a.length ? a[0] : "";
}

function uniq(values) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function normalizeUrl(url,base=EDA_OTHER_NOTICES) {
  const value=clean(url);if(!value)return "";
  try {const u=new URL(value,base);if(!/^https?:$/.test(u.protocol))return "";if(u.hostname==='eda.europa.eu'){u.hostname='www.eda.europa.eu';u.protocol='https:';}return u.href;}catch{return "";}
}

function parseDate(value) {
  const s = clean(value);
  if (!s) return null;

  const direct = Date.parse(s);
  if (Number.isFinite(direct)) return new Date(direct);

  // dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy
  let m = s.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](20\d{2})\b/);
  if (m) {
    const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
    if (Number.isFinite(d.getTime())) return d;
  }

  return null;
}

function isoDate(value) {
  const m=clean(value).match(/^(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\s+(20\d{2})$/i);
  if(m){const months=['january','february','march','april','may','june','july','august','september','october','november','december'],v=m[3]+'-'+String(months.findIndex(x=>x.slice(0,3)===m[2].slice(0,3).toLowerCase())+1).padStart(2,'0')+'-'+m[1].padStart(2,'0');return new Date(v).toISOString().slice(0,10)===v?v:"";}
  const d = parseDate(value);
  return d ? d.toISOString() : "";
}

function futureDeadline(value) {
  const d = parseDate(value);
  return !!d && d.getTime() >= Date.now();
}

function meta(result, key) {
  const md = result && result.metadata ? result.metadata : {};
  return md[key];
}

function metadataByRegex(result, regex) {
  const md = result && result.metadata ? result.metadata : {};
  const values = [];
  for (const [k, v] of Object.entries(md)) {
    if (regex.test(k)) values.push(...arr(v));
  }
  return uniq(values);
}

function firstMetadataByRegex(result, regex) {
  return first(metadataByRegex(result, regex));
}

function extractJsonArrayText(v) {
  const out = [];
  for (const item of arr(v)) {
    const s = clean(item);
    if (!s) continue;
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        for (const x of parsed) {
          if (x && typeof x === "object") {
            if (x.name) out.push(clean(x.name));
            else out.push(clean(x));
          }
        }
      } else if (parsed && typeof parsed === "object") {
        if (parsed.name) out.push(clean(parsed.name));
        else out.push(clean(parsed));
      } else {
        out.push(s);
      }
    } catch {
      out.push(s);
    }
  }
  return uniq(out);
}

function publicationDateFromFnt(result) {
  const candidates = [
    first(meta(result, "cftPublicationDateEForm")),
    first(meta(result, "startDate")),
    first(meta(result, "es_SortDate"))
  ].filter(Boolean);

  for (const c of candidates) {
    if (parseDate(c)) return isoDate(c);
  }
  return "";
}

function deadlineFromFnt(result) {
  const all = metadataByRegex(
    result,
    /(deadline|submission.*date|closing.*date|endDate|endDateLong)/i
  );

  const parsed = all
    .map(x => ({ raw: clean(x), d: parseDate(x) }))
    .filter(x => x.d)
    .sort((a, b) => a.d - b.d);

  return parsed.length
    ? parsed[parsed.length - 1].d.toISOString()
    : "";
}

function estimatedValueFromFnt(result) {
  const value = firstMetadataByRegex(
    result,
    /(estimated.*overall.*contract.*value|estimated.*value|budget)/i
  );
  return clean(value);
}

function currencyFromFnt(result) {
  return firstMetadataByRegex(
    result,
    /(estimated.*currency|contract.*currency|currency)/i
  );
}

function cpvsFromFnt(result) {
  return uniq([
    ...arr(meta(result, "mainCpv")),
    ...metadataByRegex(result, /cpv/i)
  ]).join(" | ");
}

function authorityFromFnt(result) {
  const raw = meta(result, "cftLeadContractingAuthorityCode");
  const names = [];
  for (const v of arr(raw)) {
    const s = clean(v);
    try {
      const parsed = JSON.parse(s);
      for (const item of arr(parsed)) {
        if (item && item.name) names.push(clean(item.name));
      }
    } catch {}
  }
  return uniq(names).join(" | ") || "European Defence Agency";
}

function fntStatus(result) {
  const code = first(meta(result, "status"));
  const map = {
    "31094501": "FORTHCOMING",
    "31094502": "OPEN",
    "31094503": "CLOSED"
  };
  return map[code] || code || "UNKNOWN";
}

function isEnglishResult(result) {
  const lang = clean(result.language || first(meta(result, "language"))).toLowerCase();
  return !lang || lang === "en";
}

function dedupFntLanguageVariants(results) {
  const map = new Map();

  for (const r of results) {
    const url = clean(
      first(meta(r, "esST_URL")) ||
      r.url ||
      r.reference
    ).replace(/([A-Za-z]{2})$/, "");

    const identifier =
      first(meta(r, "identifier")) ||
      first(meta(r, "callIdentifier")) ||
      url ||
      clean(r.reference);

    const key = identifier.replace(/[a-z]{2}$/i, "");
    const current = map.get(key);

    if (!current || (isEnglishResult(r) && !isEnglishResult(current))) {
      map.set(key, r);
    }
  }

  return [...map.values()];
}

// ------------------------------------------------------------
// SPACE RELEVANCE
// ------------------------------------------------------------

const CORE_SPACE_PHRASES = [
  "satellite communication", "satellite communications", "satcom",
  "governmental satellite", "govsatcom", "milsatcom",
  "satellite service", "satellite services", "satellite capacity",
  "satellite terminal", "satellite terminals", "satellite antenna",
  "satellite ground", "ground segment", "ground station",
  "spacecraft", "space system", "space systems", "space mission",
  "space situational awareness", "space surveillance", "space tracking",
  "space traffic management", "space debris",
  "very low earth orbit", "vleo", "low earth orbit", "leo satellite",
  "orbital", "in-orbit", "in orbit",
  "launch service", "launch services", "launch vehicle",
  "satellite payload", "space payload", "hosted payload"
];

const DOWNSTREAM_SPACE_PHRASES = [
  "earth observation", "remote sensing", "satellite imagery",
  "satellite image", "satellite data", "copernicus",
  "gnss", "galileo", "egnos", "satellite navigation",
  "global navigation satellite system", "positioning navigation timing",
  "pnt", "synthetic aperture radar"
];

const DEFENCE_TERMS = [
  "defence", "defense", "military", "armed forces",
  "command and control", "isr", "intelligence surveillance reconnaissance",
  "secure communication", "secure communications", "battlefield"
];

const AMBIGUOUS = [
  "beyond line of sight", "b-los", "blos",
  "rf sensor", "radiofrequency sensor", "radar",
  "timing", "geospatial", "navigation", "tracking"
];

function wholeWord(text, word) {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, "i").test(text);
}

function spaceClassify(text, cpvs = "") {
  const t = clean(text).toLowerCase();
  const c = clean(cpvs);

  const core = CORE_SPACE_PHRASES.filter(x => t.includes(x));
  const downstream = DOWNSTREAM_SPACE_PHRASES.filter(x => t.includes(x));
  const defence = DEFENCE_TERMS.filter(x => t.includes(x));
  const ambiguous = AMBIGUOUS.filter(x => t.includes(x));

  // Protect against "airspace" being treated as "space".
  const plainSpace = wholeWord(t, "space");

  if (plainSpace && !core.includes("space")) {
    // generic standalone "space" is evidence only when procurement text
    // contains an engineering/operational context.
    if (/(satellite|orbital|defence|military|research|technology|sensor|communication|surveillance)/i.test(t)) {
      core.push("space");
    }
  }

  const spaceCpv =
    /\b(3253\d{4}|34712\d{3}|3563\d{4}|38112100)\b/.test(c);

  if (core.length || spaceCpv) {
    return {
      relevant: true,
      decision: "AUTO_KEEP",
      classification: defence.length
        ? "DEFENCE-SPACE / DUAL-USE"
        : "CORE SPACE",
      confidence: "HIGH",
      evidence: uniq([...core, spaceCpv ? "space CPV" : ""]).join(" | ")
    };
  }

  if (downstream.length) {
    return {
      relevant: true,
      decision: "AUTO_KEEP",
      classification: defence.length
        ? "DEFENCE-SPACE / DUAL-USE"
        : "SPACE-ENABLED APPLICATION",
      confidence: "HIGH",
      evidence: downstream.join(" | ")
    };
  }

  if (ambiguous.length && defence.length) {
    return {
      relevant: true,
      decision: "MANUAL_REVIEW",
      classification: "POSSIBLE DEFENCE-SPACE",
      confidence: "MEDIUM",
      evidence: ambiguous.join(" | ")
    };
  }

  return {
    relevant: false,
    decision: "AUTO_EXCLUDE",
    classification: "NON-SPACE / NO MATERIAL SPACE EVIDENCE",
    confidence: "LOW",
    evidence: ""
  };
}

function detectDomain(text) {
  const t = clean(text).toLowerCase();
  if (/(satcom|satellite communication|satellite terminal|govsatcom|milsatcom)/.test(t)) return "SATCOM";
  if (/(earth observation|remote sensing|satellite imagery|copernicus|synthetic aperture radar)/.test(t)) return "Earth Observation";
  if (/(gnss|galileo|egnos|satellite navigation|positioning navigation timing|\bpnt\b)/.test(t)) return "GNSS / PNT";
  if (/(space situational awareness|space surveillance|space tracking|space debris|space traffic)/.test(t)) return "SSA / SST";
  if (/(launch service|launch vehicle|space launch)/.test(t)) return "Launch / Transportation";
  if (/(ground segment|ground station|satellite ground)/.test(t)) return "Ground Segment";
  if (/(spacecraft|satellite payload|space payload|hosted payload|vleo|orbital)/.test(t)) return "Spacecraft / Payload";
  return "Other Space";
}

function buildRagText(r) {
  return [
    `Authority: ${r.authority}`,
    `Source: ${r.sourceType}`,
    `Reference: ${r.reference}`,
    `Title: ${r.title}`,
    `Publication date: ${r.publicationDate}`,
    `Deadline: ${r.deadline}`,
    `Status: ${r.status}`,
    `Procedure stage: ${r.stage}`,
    `Description: ${r.description}`,
    `CPV: ${r.cpv}`,
    `Estimated value: ${r.estimatedValue} ${r.currency}`.trim(),
    `Space classification: ${r.spaceClassification}`,
    `Space domain: ${r.spaceDomain}`,
    `Relevance decision: ${r.relevanceDecision}`,
    `Relevance evidence: ${r.relevanceEvidence}`,
    `Source URL: ${r.sourceURL}`
  ].filter(Boolean).join("\n");
}

// ------------------------------------------------------------
// HTTP / CHECKPOINT
// ------------------------------------------------------------

async function withRetry(fn, label) {
  for(let attempt=1;;attempt++) {
    try { return await fn(); }
    catch(err) {
      const status=Number(err.response?.status||0);
      if(attempt>=3||err.permanent||(status>=400&&status<500&&![408,429].includes(status))) {
        currentSourceChecks.push({source:label,state:"failed",checkedAt:new Date().toISOString(),error:err.message});
        throw err;
      }
      await sleep(Math.min(RETRY_MAX_MS,RETRY_START_MS*2**(attempt-1)));
    }
  }
}

const currentSourceChecks = [];
async function getText(url) {
  if(url===EDA_PROCUREMENT && process.env.EDA_LANDING_SNAPSHOT){
    const bytes=fs.readFileSync(process.env.EDA_LANDING_SNAPSHOT),data=JSON.parse(bytes);
    if(data.metadata?.statusCode!==200 || !data.html || !/^https:\/\/(www\.)?eda\.europa\.eu\/procurement\/?$/.test(data.metadata.sourceURL||data.metadata.url||''))throw Error('Invalid EDA snapshot');
    const file=cacheFile('eda-provider-response.json');fs.writeFileSync(file,bytes);
    currentSourceChecks.push({source:url,state:'partial',mode:'explicit-provider-snapshot',sourceObservedAt:data.metadata.cachedAt||fs.statSync(process.env.EDA_LANDING_SNAPSHOT).mtime.toISOString(),evidenceFile:file,sha256:require('crypto').createHash('sha256').update(bytes).digest('hex'),error:'Remote source representation; imported snapshot is not a new local live fetch'});
    return data.html;
  }
  let attempt = 0;
  let wait = RETRY_START_MS;

  while (true) {
    try {
      const r = await axios.get(url, {
        timeout: 120000,
        headers: {
          "User-Agent": USER_AGENT,
          "Accept-Language": "en"
        }
      });

      return String(r.data || "");
    } catch (err) {
      const status = err.response && err.response.status;
      if (++attempt >= 3) { currentSourceChecks.push({source:url,state:"failed",checkedAt:new Date().toISOString(),error:err.message}); throw err; }

      // Permanent client-side blocks/errors must not freeze the collector.
      // EDA currently returns HTTP 403 to some automated requests.
      if (
        status &&
        status >= 400 &&
        status < 500 &&
        status !== 429
      ) {
        const e = new Error(
          `Permanent HTTP ${status} for ${url}`
        );
        e.status = status;
        currentSourceChecks.push({source:url,state:"failed",checkedAt:new Date().toISOString(),error:e.message});
        throw e;
      }

      console.error(
        `GET ${url} failed${status ? ` HTTP ${status}` : ""}: ${err.message}`
      );
      console.error(
        `Retrying in ${Math.round(wait / 1000)} sec...`
      );

      await sleep(wait);
      wait = Math.min(wait * 2, RETRY_MAX_MS);
    }
  }
}

function cacheFile(name) {
  return path.join(RUN_CACHE_DIR, name);
}

function loadJsonIfExists(file) {
  if (!FORCE_REFRESH && fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }
  return null;
}

function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

// ------------------------------------------------------------
// FUNDING & TENDERS API
// ------------------------------------------------------------

async function fntPage(pageNumber) {
  const cache = cacheFile(`fnt-page-${String(pageNumber).padStart(4, "0")}.json`);
  const existing = loadJsonIfExists(cache);
  if (existing) {
    console.log(`F&T page ${pageNumber}: checkpoint`);
    return existing;
  }

  const query = {
    bool: {
      must: [
        { terms: { type: ["0"] } },
        { terms: { status: ["31094501", "31094502", "31094503"] } },
        { term: { cftPartyLegalEntityId: EDA_LEGAL_ENTITY_ID } }
      ]
    }
  };

  const languages = ["en"];
  const sort = { field: "startDate", order: "DESC" };

  const url =
    `${FNT_API}?apiKey=SEDIA&text=***` +
    `&pageSize=${PAGE_SIZE}&pageNumber=${pageNumber}`;

  const data = await withRetry(async () => {
    const form = new FormData();
    form.append(
      "query",
      new Blob([JSON.stringify(query)], { type: "application/json" }),
      "query.json"
    );
    form.append(
      "languages",
      new Blob([JSON.stringify(languages)], { type: "application/json" }),
      "languages.json"
    );
    form.append(
      "sort",
      new Blob([JSON.stringify(sort)], { type: "application/json" }),
      "sort.json"
    );

    const r = await axios.post(url,form,{timeout:60000,headers:{Accept:"application/json","User-Agent":USER_AGENT}});
    require('../../current/sedia.cjs').validate(r.data,pageNumber,PAGE_SIZE);
    return r.data;
  }, `F&T page ${pageNumber}`);

  saveJson(cache, data);
  return data;
}

async function collectFnt() {
  console.log("\n=== Funding & Tenders Portal: exact EDA buyer ===");

  const all = [];
  let page = 1;
  let total = null;

  while (true) {
    const data = await fntPage(page);
    const results = arr(data.results);

    if (total === null) {
      total = Number(data.totalResults || 0);
      console.log(`F&T reported total: ${total}`);
    }

    all.push(...results);
    console.log(`F&T page ${page}: ${results.length} rows; raw cumulative ${all.length}`);

    if (!results.length) break;
    if (total && all.length >= total) break;
    if (results.length < PAGE_SIZE) break;

    page += 1;
    await sleep(BETWEEN_REQUESTS_MS);
  }

  currentSourceChecks.push({source:"EDA Funding & Tenders",state:all.length===total?"complete":"partial",reportedTotal:total,rawRecords:all.length,pages:page,error:all.length===total?null:"Reported total differs from collected rows"});
  const dedup = dedupFntLanguageVariants(all);

  const rows = [];

  for (const r of dedup) {
    const entityIds = arr(meta(r, "cftPartyLegalEntityId")).map(clean);
    if (!entityIds.includes(EDA_LEGAL_ENTITY_ID)) continue;

    const publicationDate = publicationDateFromFnt(r);
    const d = parseDate(publicationDate);

    if (d && d < new Date(`${START_DATE}T00:00:00Z`)) continue;

    const reference =
      first(meta(r, "callIdentifier")) ||
      first(meta(r, "identifier")) ||
      clean(r.reference);

    const title = clean(r.summary || r.content);
    const description =
      first(meta(r, "description")) ||
      clean(r.content);

    const deadline = deadlineFromFnt(r);
    let status = fntStatus(r);

    if (deadline) {
      if (futureDeadline(deadline) && status === "OPEN") status = "OPEN";
      if (!futureDeadline(deadline) && status === "OPEN") status = "DEADLINE_EXPIRED";
    }

    const sourceURL = normalizeUrl(
      first(meta(r, "esST_URL")) ||
      r.url
    );

    const cpv = cpvsFromFnt(r);
    const sc = spaceClassify(
      [title, description, cpv].join(" "),
      cpv
    );

    const row = {
      sourceType: "EU Funding & Tenders Portal",
      sourceAuthority: "European Commission Funding & Tenders Portal",
      authority: authorityFromFnt(r),
      reference,
      title,
      description,
      publicationDate,
      deadline,
      status,
      stage: status === "FORTHCOMING" ? "Planning / Forthcoming" :
             status === "OPEN" ? "Competition / Open" :
             "Historical / Closed",
      procedureType: first(meta(r, "procedureType")),
      contractType: first(meta(r, "contractType")),
      cpv,
      estimatedValue: estimatedValueFromFnt(r),
      currency: currencyFromFnt(r),
      documents: metadataByRegex(r, /cftDocuments/i).join(" | "),
      sourceURL,
      sourceRecordId:
        first(meta(r, "identifier")) ||
        clean(r.reference),
      sourceDataProvenance: "Official EU Funding & Tenders Portal",
      sourceDataAltered: "NO - normalized fields derived from official portal metadata",
      relevanceDecision: sc.decision,
      spaceClassification: sc.classification,
      spaceRelevanceConfidence: sc.confidence,
      relevanceEvidence: sc.evidence,
      spaceDomain: sc.relevant ? detectDomain([title, description].join(" ")) : "",
      openNow: status === "OPEN" && (!deadline || futureDeadline(deadline)) ? "YES" : "NO"
    };

    if(/list of vendors|supplier admission/i.test(title)){row.stage="Supplier admission";row.status="SUPPLIER_ADMISSION";row.openNow="NO";}
    row.ragText = buildRagText(row);
    rows.push(row);
  }

  console.log(`F&T normalized EDA tenders from 2020+: ${rows.length}`);
  return rows;
}

// ------------------------------------------------------------
// EDA WEBSITE
// ------------------------------------------------------------

function parseDateLabel(text, label) {
  const re = new RegExp(
    `${label}\\s*:?\\s*([0-9]{1,2}\\s+[A-Za-z]+\\s+20[0-9]{2}(?:\\s*[,\\-]?\\s*[0-9]{1,2}:[0-9]{2})?)`,
    "i"
  );
  const m = clean(text).match(re);
  return m ? isoDate(m[1]) : "";
}

function extractReference(text) {
  const t = clean(text);
  const patterns = [
    /\bEDA\/20\d{2}\/OP\/\d{4}\b/i,
    /\b\d{2}\.[A-Z0-9-]+\.(?:OP|NP\d|PRZ)\.\d+\b/i,
    /\bEDA\/\d{2}\.[A-Z0-9-]+\.(?:OP|NP\d|PRZ)\.\d+\b/i
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (m) return m[0];
  }
  return "";
}

function pageDocuments($, baseUrl) {
  const links = [];
  $("a[href]").each((_, el) => {
    const href = normalizeUrl($(el).attr("href"),baseUrl);
    const txt = clean($(el).text());
    if (
      href &&
      /\.(pdf|docx?|xlsx?|zip)(?:$|\?)/i.test(href)
    ) {
      links.push(txt ? `${txt} => ${href}` : href);
    }
  });
  return uniq(links);
}

async function collectEdaOtherNoticeDetail(url) {
  const safe = Buffer.from(url).toString("base64url").slice(0, 100);
  const cache = cacheFile(`eda-other-${safe}.json`);
  const existing = loadJsonIfExists(cache);
  if (existing) return existing;

  const html = await getText(url);
  fs.writeFileSync(cacheFile("eda-detail-"+require("node:crypto").createHash("sha256").update(url).digest("hex").slice(0,16)+".html"),html,"utf8");
  const $ = cheerio.load(html);

  const mainText = clean(
    $("#main-post-content").text() ||
    $("main").text() ||
    $("#content-page").text() ||
    $("body").text()
  );

  const title =
    clean($("h1.post-title").text()) ||
    clean($("h1").first().text()) ||
    clean($("title").text());

  const pageDate =
    clean($(".post-meta .date").first().text()) ||
    clean($("h1").first().prev().text()) ||
    parseDateLabel(mainText, "Published");

  const started =
    parseDateLabel(mainText, "Opening date") ||
    parseDateLabel(mainText, "Started");

  const closing =
    parseDateLabel(mainText, "Closing date") ||
    parseDateLabel(mainText, "Closing") ||
    parseDateLabel(mainText, "Submission deadline");

  const reference = extractReference(mainText + " " + title);

  const categories = [];
  $("a").each((_, el) => {
    const txt = clean($(el).text());
    if (/market consultation|ex-ante|expression of interest|annual list|prize/i.test(txt)) {
      categories.push(txt);
    }
  });

  const docs = pageDocuments($, url);
  const publicationDate =
    isoDate(pageDate) ||
    started ||
    "";

  const sc = spaceClassify(
    [title, mainText].join(" "),
    ""
  );

  const status =
    closing
      ? (futureDeadline(closing) ? "OPEN" : "CLOSED")
      : "UNKNOWN";

  const row = {
    sourceType: "EDA Website - Other Notice",
    sourceAuthority: "European Defence Agency",
    authority: "European Defence Agency",
    reference,
    title,
    description: mainText.slice(0, 30000),
    publicationDate,
    deadline: closing,
    status,
    stage:
      /list of vendors|supplier admission/i.test(title) ? "Supplier admission" :
      /prize/i.test(title) ? "Prize / Innovation" :
      /market consultation/i.test(mainText)
        ? "Market Consultation"
        : /ex-ante/i.test(mainText)
        ? "Ex-ante Publicity / Low Value"
        : /expression of interest/i.test(mainText)
        ? "Expression of Interest"
        : /prize/i.test(mainText)
        ? "Prize / Innovation"
        : "Other Notice",
    procedureType: "",
    contractType: "",
    cpv: "",
    estimatedValue: "",
    currency: "",
    documents: docs.join(" | "),
    sourceURL: url,
    sourceRecordId: reference || url,
    sourceDataProvenance: "Official EDA procurement website",
    sourceDataAltered: "NO - text normalized from official EDA page",
    relevanceDecision: sc.decision,
    spaceClassification: sc.classification,
    spaceRelevanceConfidence: sc.confidence,
    relevanceEvidence: sc.evidence,
    spaceDomain: sc.relevant ? detectDomain([title, mainText].join(" ")) : "",
    openNow: status === "OPEN" ? "YES" : "NO"
  };

  row.ragText = buildRagText(row);

  saveJson(cache, row);
  await sleep(BETWEEN_REQUESTS_MS);

  return row;
}

function parseEdaCards(html){const $=cheerio.load(html);return $('.reference').filter((i,e)=>/^EDA\/20\d{2}\/OP\/\d{4}$/.test(clean($(e).text()))).map((i,e)=>({reference:clean($(e).text()),title:clean($(e).parent().find('h3').first().text()),text:clean($(e).parent().text())})).get();}

async function collectEdaWebsite() {
  console.log("\n=== EDA procurement website ===");

  const landingCache = cacheFile("eda-procurement-page.html");
  let landingHtml = "";

  if (!FORCE_REFRESH && fs.existsSync(landingCache)) {
    landingHtml = fs.readFileSync(landingCache, "utf8");
    console.log("EDA procurement page: checkpoint");
  } else {
    try {
      landingHtml = await getText(EDA_PROCUREMENT);
      fs.writeFileSync(landingCache, landingHtml, "utf8");
    } catch (err) {
      if (err.status === 403) {
        console.log(
          "EDA website returned HTTP 403. Skipping the supplemental EDA-web layer."
        );
        console.log(
          "Funding & Tenders data will still be finalized from the existing checkpoint."
        );
        landingHtml = "";
      } else { throw err; }
    }
  }

  const $ = cheerio.load(landingHtml);
  const rows = [];

  // Current formal calls exposed in the "Ongoing Calls For Tenders" block.
  const cards=parseEdaCards(landingHtml);
  for (const card of cards) {
    const ref=card.reference,snippet=card.text,title=card.title;
    const publicationDate = parseDateLabel(snippet, "Publication date");
    const deadline = parseDateLabel(snippet, "Deadline");
    const status = !deadline ? "UNKNOWN" : deadline.slice(0,10)===TODAY ? "DEADLINE_TODAY_CHECK_TIME" : futureDeadline(deadline) ? "OPEN" : "DEADLINE_EXPIRED";

    const sc = spaceClassify([title, snippet].join(" "), "");

    const row = {
      sourceType: "EDA Website - Ongoing Calls",
      sourceAuthority: "European Defence Agency",
      authority: "European Defence Agency",
      reference: ref,
      title,
      description: snippet,
      publicationDate,
      deadline,
      status,
      stage: "Competition",
      procedureType: "Open / formal call",
      contractType: "",
      cpv: "",
      estimatedValue: "",
      currency: "",
      documents: "",
      sourceURL: EDA_PROCUREMENT,
      sourceRecordId: ref,
      sourceDataProvenance: "Official EDA procurement website",
      sourceDataAltered: "NO - normalized from official EDA page",
      relevanceDecision: sc.decision,
      spaceClassification: sc.classification,
      spaceRelevanceConfidence: sc.confidence,
      relevanceEvidence: sc.evidence,
      spaceDomain: sc.relevant ? detectDomain(title + " " + snippet) : "",
      openNow: status === "OPEN" ? "YES" : "NO"
    };

    row.ragText = buildRagText(row);
    rows.push(row);
  }

  // Current EDA "Other notices" index.
  const otherCache = cacheFile("eda-other-index.html");
  let otherHtml = "";

  if (!FORCE_REFRESH && fs.existsSync(otherCache)) {
    otherHtml = fs.readFileSync(otherCache, "utf8");
    console.log("EDA other notices index: checkpoint");
  } else {
    try {
      otherHtml = await getText(EDA_OTHER_NOTICES);
      fs.writeFileSync(otherCache, otherHtml, "utf8");
    } catch (err) {
      if (err.status === 403) {
        console.log(
          "EDA Other notices returned HTTP 403. Skipping that supplemental layer."
        );
        console.log(`EDA website normalized rows: ${rows.length}`);
        otherHtml = "";
      } else { throw err; }
    }
  }

  const $o = cheerio.load(landingHtml + "\n" + otherHtml);
  const links = [];

  $o('a[href*="other-notices/"]').each((_, el) => {
    const href = normalizeUrl($o(el).attr("href"),EDA_OTHER_NOTICES);
    if (
      href &&
      href !== EDA_OTHER_NOTICES &&
      !href.endsWith("#")
    ) {
      links.push(href);
    }
  });

  currentSourceChecks.push({source:"EDA Other notices discovery",state:"partial",discoveredUrls:uniq(links).length,error:"Combined landing and index; full historical archive not available"});
  for (const url of uniq(links)) {
    try {
      rows.push(await collectEdaOtherNoticeDetail(url));
    } catch (err) {
      console.error(`Other notice failed: ${url}: ${err.message}`);
    }
  }

  console.log(`EDA website normalized rows: ${rows.length}`);
  return rows;
}

// ------------------------------------------------------------
// DEDUP / OUTPUT
// ------------------------------------------------------------

function normalizedReference(r) {
  return clean(r.reference).toUpperCase().replace(/\s+/g, "");
}

function recordKey(r) {
  const ref = normalizedReference(r);
  if (ref) return `REF|${ref}`;
  if (r.sourceURL) return `URL|${normalizeUrl(r.sourceURL).toLowerCase()}`;
  return `TITLE|${clean(r.title).toLowerCase()}|${clean(r.publicationDate)}`;
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

    // Prefer F&T for formal tender structured metadata, but retain
    // source URLs from both channels where available.
    const preferNew =
      r.sourceType === "EU Funding & Tenders Portal" &&
      current.sourceType !== "EU Funding & Tenders Portal";

    const primary = preferNew ? { ...r } : { ...current };
    const secondary = preferNew ? current : r;

    for (const k of Object.keys(primary)) {
      if (!clean(primary[k]) && clean(secondary[k])) {
        primary[k] = secondary[k];
      }
    }

    primary.additionalSourceURLs =
      uniq([
        primary.additionalSourceURLs,
        current.sourceURL,
        r.sourceURL
      ]).join(" | ");

    if(current.deadline && r.deadline && current.deadline.slice(0,10)!==r.deadline.slice(0,10)){
      primary.deadlineConflict=[{sourceURL:current.sourceURL,deadline:current.deadline},{sourceURL:r.sourceURL,deadline:r.deadline}];primary.status='UNKNOWN_DEADLINE_CONFLICT';primary.openNow='NO';
    }
    primary.ragText=buildRagText(primary);
    map.set(key, primary);
  }

  return [...map.values()];
}

function csvEscape(v) {
  const s = v === undefined || v === null ? "" : String(v);
  return `"${s.replace(/"/g, '""')}"`;
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
  "documents",
  "spaceClassification",
  "spaceDomain",
  "relevanceDecision",
  "spaceRelevanceConfidence",
  "relevanceEvidence",
  "sourceURL",
  "additionalSourceURLs",
  "sourceRecordId",
  "sourceDataProvenance",
  "sourceDataAltered",
  "ragText"
];

function rowCsv(r) {
  return COLUMNS.map(c => csvEscape(r[c])).join(",") + "\n";
}

function writeCsvChunked(baseName, rows) {
  const header = COLUMNS.map(csvEscape).join(",") + "\n";
  let part = 1;
  let content = header;
  let bytes = Buffer.byteLength(content, "utf8");
  const files = [];

  const flush = () => {
    const suffix = part === 1 && files.length === 0 && rows.length < 100000
      ? ""
      : `_part${String(part).padStart(2, "0")}`;

    const file = path.join(
      OUTPUT_DIR,
      `${baseName}_${TODAY}${suffix}.csv`
    );

    fs.writeFileSync(file, content, "utf8");
    files.push(file);
    part += 1;
    content = header;
    bytes = Buffer.byteLength(content, "utf8");
  };

  for (const r of rows) {
    const line = rowCsv(r);
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
    {
      sourceType: "Official EDA procurement webpage",
      url: EDA_PROCUREMENT,
      purpose: "Current formal EDA calls and procurement guidance",
      historicalCoverage: "Current page",
      authority: "European Defence Agency"
    },
    {
      sourceType: "Official EU Funding & Tenders Portal",
      url: "https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/calls-for-tenders?cftPartyLegalEntityId=47352396&isExactMatch=true",
      purpose: "Formal EDA tender history/open/closed using exact EDA legal entity identifier",
      historicalCoverage: "2020-present in collector",
      authority: "European Commission / European Defence Agency"
    },
    {
      sourceType: "Official EDA Other notices",
      url: EDA_OTHER_NOTICES,
      purpose: "Low-value ex-ante publicity, market consultations, expressions of interest and other current notices exposed by EDA",
      historicalCoverage: "Current publicly exposed index; full historical archive not machine-readable",
      authority: "European Defence Agency"
    }
  ];

  const cols = ["sourceType", "url", "purpose", "historicalCoverage", "authority"];
  const csv =
    cols.map(csvEscape).join(",") + "\n" +
    rows.map(r => cols.map(c => csvEscape(r[c])).join(",")).join("\n") + "\n";

  const file = path.join(
    OUTPUT_DIR,
    `EDA_Procurement_Sources_${TODAY}.csv`
  );
  fs.writeFileSync(file, csv, "utf8");
  return file;
}

function copyCollector() { return __filename; }

async function main() {
  ensureDirs();

  console.log("==============================================");
  console.log("EDA PROCUREMENT COLLECTOR V1.1");
  console.log(`Historical start: ${START_DATE}`);
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log(`Checkpoint: ${RUN_CACHE_DIR}`);
  console.log("==============================================");

  const fnt = await collectFnt();
  const web = await collectEdaWebsite();

  fs.writeFileSync(path.join(OUTPUT_DIR,`EDA_Source_Records_${TODAY}.jsonl`),[...fnt,...web].map(r=>JSON.stringify(r)).join("\n")+"\n","utf8");
  const all = mergeRows([...fnt, ...web])
    .sort((a, b) => {
      const da = parseDate(a.publicationDate);
      const db = parseDate(b.publicationDate);
      return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
    });

  const space = all.filter(
    r =>
      r.relevanceDecision === "AUTO_KEEP" ||
      r.relevanceDecision === "MANUAL_REVIEW"
  );

  const ragReady = space.filter(
    r => r.relevanceDecision === "AUTO_KEEP"
  );

  const manual = space.filter(
    r => r.relevanceDecision === "MANUAL_REVIEW"
  );

  const openSpace = space
    .filter(r => r.openNow === "YES")
    .sort((a, b) => {
      const da = parseDate(a.deadline);
      const db = parseDate(b.deadline);
      return (da ? da.getTime() : Number.MAX_SAFE_INTEGER) -
             (db ? db.getTime() : Number.MAX_SAFE_INTEGER);
    });

  const historicalSpace = space.filter(
    r => r.openNow !== "YES"
  );

  const outputFiles = [];
  outputFiles.push(...writeCsvChunked("EDA_Procurement_All", all));
  outputFiles.push(...writeCsvChunked("EDA_Space_Procurement_RAG", ragReady));
  outputFiles.push(...writeCsvChunked("EDA_Open_Space_Procurement", openSpace));
  outputFiles.push(...writeCsvChunked("EDA_Space_Procurement_Historical", historicalSpace));
  outputFiles.push(...writeCsvChunked("EDA_Space_Manual_Review", manual));
  outputFiles.push(writeSourceRegistry());
  outputFiles.push(copyCollector());

  const workbook=new (require('exceljs').Workbook)();
  for(const [name,rows] of Object.entries({All:all,RAG:ragReady,Open:openSpace,Historical:historicalSpace,Review:manual})){
    fs.writeFileSync(path.join(OUTPUT_DIR,'EDA_'+name+'_'+TODAY+'.jsonl'),rows.map(r=>JSON.stringify(r)).join('\n')+(rows.length?'\n':''),'utf8');
    const sheet=workbook.addWorksheet(name),keys=[...new Set(rows.flatMap(Object.keys))];sheet.columns=(keys.length?keys:COLUMNS).map(key=>({header:key,key}));
    for(const row of rows)sheet.addRow(Object.fromEntries(Object.entries(row).map(([k,v])=>[k,v&&typeof v==='object'?JSON.stringify(v):v])));
  }
  await workbook.xlsx.writeFile(path.join(OUTPUT_DIR,'EDA_Procurement_'+TODAY+'.xlsx'));
  const summary = {
    collectionStatus:'partial',
    runDate: TODAY,
    historicalStart: START_DATE,
    currentSourceChecks,
    sourceCounts: {
      fundingTenders: fnt.length,
      edaWebsite: web.length
    },
    totalUniqueProcurementRecords: all.length,
    spaceRelevantIncludingManualReview: space.length,
    ragReadySpace: ragReady.length,
    openSpace: openSpace.length,
    historicalSpace: historicalSpace.length,
    manualReview: manual.length,
    methodology: [
      "Exact EDA buyer filter on EU Funding & Tenders Portal using cftPartyLegalEntityId=47352396",
      "Official EDA procurement page for current formal calls",
      "Official EDA Other notices index for current low-value/ex-ante/market-consultation notices",
      "High-recall space/defence-space classifier with manual-review layer"
    ],
    limitation:
      "EDA does not expose a complete machine-readable historical archive of all Other notices. Formal historical tender coverage from 2020 is anchored on the Funding & Tenders Portal. If the EDA website returns HTTP 403, the supplemental website layer is skipped without blocking completion."
  };

  const summaryFile = path.join(
    OUTPUT_DIR,
    `EDA_Procurement_Summary_${TODAY}.json`
  );
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2), "utf8");
  outputFiles.push(summaryFile);

  console.log("\n==============================================");
  console.log("EDA PROCUREMENT EXPORT COMPLETE — COVERAGE PARTIAL");
  console.log(`All unique procurement records: ${all.length}`);
  console.log(`Space relevant incl. manual review: ${space.length}`);
  console.log(`RAG-ready space: ${ragReady.length}`);
  console.log(`OPEN space: ${openSpace.length}`);
  console.log(`Historical space: ${historicalSpace.length}`);
  console.log(`Manual review: ${manual.length}`);
  console.log("\nGenerated files:");
  for (const f of outputFiles) console.log(f);
  console.log("==============================================\n");
}

if (require.main === module) main().catch(err => {
  console.error("\nEDA PROCUREMENT COLLECTOR FAILED");
  console.error(err.stack || err.message || err);
  process.exit(1);
});

module.exports = { main, outputDirectory: OUTPUT_DIR, collectEdaWebsite, mergeRows, isoDate, parseEdaCards, normalizeUrl };
