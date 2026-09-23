const axios = require("axios");
const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");

// ============================================================
// EU-27 MEMBER STATES SPACE PROCUREMENT MASTER — V5 FINAL TED-ONLY
// ============================================================
//
// ONE SCRIPT -> FINAL TED SOURCE + FINAL EXCEL
//
// REQUIREMENTS:
//
// A) High-recall EU-27 Member State space procurement extraction from TED.
// B) ALSO capture every EU-27 TED notice whose procurement/submission deadline
//    has not expired, whether or not the space classifier recognizes it.
// C) TED is the only procurement data source. No external/future sources.
// D) Original TED API source payload is preserved unchanged as raw JSON.
//    Derived classification/status fields are separate and never overwrite it.
// E) The script itself, the raw TED source JSONL, and the generated Excel are
//    all written under:
//
// C:\Users\angel\OneDrive\Desktop\knowledge\eu-space-rag\03_PROCUREMENT\Member States\Procurement Data
//
// The _V5_CACHE subfolder is only a resumable technical cache.
//
// ============================================================
// CONFIG
// ============================================================


const OUTPUT_DIR =
  "C:\\Users\\angel\\OneDrive\\Desktop\\knowledge\\eu-space-rag\\03_PROCUREMENT\\Member States\\Procurement Data";

const CACHE_DIR = path.join(OUTPUT_DIR, "_V5_CACHE");


const API_URL =
  "https://api.ted.europa.eu/v3/notices/search";

const START_YEAR = 2020;
const END_YEAR = new Date().getFullYear();

const PAGE_SIZE = 250;
const NORMAL_WAIT_MS = 1500;
const INITIAL_RETRY_MS = 15000;
const MAX_RETRY_MS = 120000;
const CHECKPOINT_EVERY = 10;

const TODAY =
  new Date().toISOString().slice(0, 10);

const FINAL_XLSX =
  path.join(
    OUTPUT_DIR,
    `EU27_MEMBER_STATES_SPACE_PROCUREMENT_FINAL_${TODAY}.xlsx`
  );

const RAW_TED_SOURCE_JSONL =
  path.join(
    OUTPUT_DIR,
    `EU27_TED_SOURCE_RAW_${TODAY}.jsonl`
  );

const SOURCE_SCRIPT_COPY =
  path.join(
    OUTPUT_DIR,
    "eu27-member-states-space-procurement-final.js"
  );


// ============================================================
// EU-27
// ============================================================

const COUNTRIES = [
  ["AUT", "Austria"],
  ["BEL", "Belgium"],
  ["BGR", "Bulgaria"],
  ["HRV", "Croatia"],
  ["CYP", "Cyprus"],
  ["CZE", "Czechia"],
  ["DNK", "Denmark"],
  ["EST", "Estonia"],
  ["FIN", "Finland"],
  ["FRA", "France"],
  ["DEU", "Germany"],
  ["GRC", "Greece"],
  ["HUN", "Hungary"],
  ["IRL", "Ireland"],
  ["ITA", "Italy"],
  ["LVA", "Latvia"],
  ["LTU", "Lithuania"],
  ["LUX", "Luxembourg"],
  ["MLT", "Malta"],
  ["NLD", "Netherlands"],
  ["POL", "Poland"],
  ["PRT", "Portugal"],
  ["ROU", "Romania"],
  ["SVK", "Slovakia"],
  ["SVN", "Slovenia"],
  ["ESP", "Spain"],
  ["SWE", "Sweden"]
];


// ============================================================
// TED FIELDS
// ============================================================

const FIELDS = [
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
  "deadline-date-lot",
  "deadline-date-part",
  "deadline-receipt-tender-date-lot",
  "deadline-receipt-tender-time-lot",
  "deadline-receipt-expressions-date-lot",
  "deadline-receipt-expressions-time-lot",
  "deadline-receipt-request-date-lot",
  "deadline-receipt-request-time-lot",
  "deadline-receipt-answers-date-lot",
  "deadline-receipt-answers-time-lot",
  "legal-basis",
  "winner-name",
  "result-value-notice",
  "result-value-cur-notice",
  "links"
];

// ============================================================
// BASIC HELPERS
// ============================================================

function ensureDirs() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function flattenText(value) {
  if (value === undefined || value === null) return "";

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map(flattenText).join(" ");
  }

  if (typeof value === "object") {
    if (value.eng) return flattenText(value.eng);
    if (value.ita) return flattenText(value.ita);
    if (value.fra) return flattenText(value.fra);
    if (value.deu) return flattenText(value.deu);
    if (value.spa) return flattenText(value.spa);

    return Object.values(value)
      .map(flattenText)
      .join(" ");
  }

  return "";
}

function clean(value) {
  return flattenText(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function low(v) {
  return clean(v).toLowerCase();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function firstNumber(value) {
  for (const v of asArray(value)) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function escapeRegex(text) {
  return String(text).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

function containsPhrase(text, phrase) {
  return low(text).includes(low(phrase));
}

function containsAny(text, terms) {
  const t = low(text);
  return terms.some(term => t.includes(low(term)));
}

function containsWholeWord(text, term) {
  const regex =
    new RegExp(
      `(^|[^a-z0-9])${escapeRegex(
        String(term).toLowerCase()
      )}([^a-z0-9]|$)`,
      "i"
    );

  return regex.test(String(text).toLowerCase());
}

function findPhraseMatches(text, terms) {
  return terms.filter(term =>
    containsPhrase(text, term)
  );
}

function findWordMatches(text, terms) {
  return terms.filter(term =>
    containsWholeWord(text, term)
  );
}

function normalizeKeyText(text) {
  return clean(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(austria|belgium|bulgaria|croatia|cyprus|czechia|denmark|estonia|finland|france|germany|greece|hungary|ireland|italy|latvia|lithuania|luxembourg|malta|netherlands|poland|portugal|romania|slovakia|slovenia|spain|sweden)\b/g, " ")
    .replace(/\b(vienna|wien|brussels|bruxelles|roma|rome|paris|berlin|madrid|warsaw|warszawa|praha|prague|stockholm|helsinki)\b/g, " ")
    .replace(/\b(correction|corrigendum|contract notice|contract award notice|prior information notice)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeBuyer(v) {
  return normalizeKeyText(v)
    .replace(/\b(gmbh|mbh|ag|sa|nv|bv|srl|spa|ltd|limited|llc|oy|ab|kft|sro|kg|company|procurement|division|afdeling)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePublicationDate(value) {
  const t = Date.parse(clean(value));
  return Number.isFinite(t) ? t : 0;
}

function joinUnique(values) {
  return unique(values.map(clean)).join(" | ");
}

function safeUrl(value) {
  const t = clean(value);
  const m = t.match(/https?:\/\/[^\s|]+/i);
  return m ? m[0] : t;
}

function dateOnlyFromAny(value) {
  const t = clean(value);
  const m = t.match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : "";
}

// ============================================================
// CPV DESIGN
// ============================================================

const CORE_SPACE_CPV_PREFIXES = [
  "3253",
  "34712",
  "3563"
];

const CORE_SPACE_CPV_EXACT = new Set([
  "32530000",
  "32531000",
  "32532000",
  "32533000",
  "32534000",
  "34712000",
  "34712100",
  "34712200",
  "34712300",
  "35630000",
  "35631000",
  "35631100",
  "35631200",
  "35631300"
]);

const DOWNSTREAM_SPACE_CPV_EXACT = new Set([
  "38112100"
]);

const SUPPORTING_CPV_PREFIXES = [
  "325",
  "3244",
  "3572",
  "63724",
  "71354",
  "382"
];

// ============================================================
// SPACE TEXT SIGNALS
// ============================================================

const CORE_SPACE_PHRASES = [
  "space agency",
  "space programme",
  "space program",
  "space mission",
  "space missions",
  "space system",
  "space systems",
  "satellite communication",
  "satellite communications",
  "satellite telecommunications",
  "satellite antenna",
  "satellite antennas",
  "satellite earth station",
  "satellite imagery",
  "satellite images",
  "satellite image",
  "satellite data",
  "satellite service",
  "satellite services",
  "earth observation satellite",
  "earth observation satellites",
  "ground segment",
  "ground station",
  "ground stations",
  "space situational awareness",
  "space surveillance",
  "space tracking",
  "space traffic management",
  "space debris",
  "governmental satellite communications",
  "secure satellite communications",
  "satellite platform",
  "satellite platforms",
  "launch vehicle",
  "launch vehicles",
  "launch service",
  "launch services",
  "space launch",
  "orbital services",
  "meteorological satellite",
  "weather satellite",
  "satellite reception",
  "in-orbit validation",
  "in orbit validation",
  "hosted payload",
  "space payload",
  "satellite payload",

  // multilingual high-value additions
  "comunicazioni satellitari",
  "comunicazione satellitare",
  "satellite de télécommunications",
  "communications par satellite",
  "communication par satellite",
  "satellitenkommunikation",
  "satellitenkommunikations",
  "comunicaciones por satélite",
  "comunicacion por satelite",
  "segmento di terra",
  "segment sol",
  "bodensegment",
  "segmento terreno",
  "véhicule spatial",
  "vehicule spatial",
  "raumfahrzeug",
  "veicolo spaziale",
  "vehículo espacial",
  "vehiculo espacial",
  "lancement spatial",
  "servizio di lancio",
  "servicio de lanzamiento",
  "startdienst"
];

const CORE_SPACE_WORDS = [
  "spacecraft",
  "satcom",
  "govsatcom",
  "launcher",
  "launchers"
];

const DOWNSTREAM_SPACE_WORDS = [
  "galileo",
  "egnos",
  "copernicus",
  "gnss",
  "pnt",
  "gps"
];

const DOWNSTREAM_SPACE_PHRASES = [
  "satellite navigation",
  "global navigation satellite system",
  "global navigation satellite systems",
  "remote sensing",
  "earth observation",
  "satellite internet",
  "low orbit satellite internet",
  "low earth orbit satellite internet",
  "satellite positioning",
  "satellite tracking",
  "satellite-based positioning",
  "satellite based positioning",
  "satellite-based monitoring",
  "satellite based monitoring",

  // multilingual high-value additions
  "osservazione della terra",
  "observation de la terre",
  "erdbeobachtung",
  "observación de la tierra",
  "observacion de la tierra",
  "telerilevamento",
  "télédétection",
  "teledetection",
  "fernerkundung",
  "teledetección",
  "teledeteccion",
  "navigazione satellitare",
  "navigation par satellite",
  "satellitennavigation",
  "navegación por satélite",
  "navegacion por satelite"
];

const AMBIGUOUS_ACRONYMS = [
  "SSA",
  "SST",
  "STM",
  "SAR",
  "EO"
];

const AMBIGUOUS_CONTEXT_PHRASES = [
  "space situational awareness",
  "space surveillance",
  "space traffic",
  "space debris",
  "synthetic aperture radar",
  "earth observation",
  "satellite imagery",
  "satellite data",
  "satellite system",
  "ground segment"
];

const APPLICATION_PHRASES = [
  "precision agriculture",
  "forest monitoring",
  "wildfire monitoring",
  "wildfire detection",
  "fire detection",
  "maritime surveillance",
  "border surveillance",
  "disaster management",
  "emergency mapping",
  "flood monitoring",
  "land monitoring",
  "geospatial intelligence",
  "precise timing",
  "environmental monitoring",
  "climate monitoring",
  "coastal monitoring",
  "asset tracking",
  "fleet tracking",
  "vehicle tracking",
  "train tracking",
  "rail tracking"
];

// ============================================================
// DEFENCE / SECURITY SIGNALS
// ============================================================

const DEFENCE_PHRASES = [
  "ministry of defence",
  "ministry of defense",
  "armed forces",
  "air force",
  "naval forces",
  "navy",
  "military satellite",
  "military satellites",
  "military communications",
  "secure military communications",
  "command and control",
  "military surveillance",
  "military reconnaissance",
  "missile warning",
  "early warning",
  "defence communications",
  "defense communications",
  "ministero della difesa",
  "ministerio de defensa",
  "ministerium der verteidigung",
  "ministère de la défense",
  "ministere de la defense",
  "ministerstwo obrony",
  "министерство на отбраната",
  "försvarsmakten"
];

const DEFENCE_WORDS = [
  "defence",
  "defense",
  "military",
  "missile",
  "missiles",
  "weapon",
  "weapons"
];

const DEFENCE_ACRONYMS = [
  "C2",
  "ISR"
];

const UAV_TERMS = [
  "uav",
  "uas",
  "drone",
  "drones",
  "unmanned aircraft",
  "unmanned aerial",
  "uncrewed aircraft",
  "безпилот",
  "bezzałog",
  "bezzalog",
  "drohne",
  "dron",
  "aeromobile pilotato da remoto"
];

const FORENSIC_GPS_CONTEXT = [
  "forensic",
  "forensique",
  "forensisch",
  "forensische",
  "cellebrite",
  "smartphone",
  "mobile phone",
  "gsm",
  "digital evidence",
  "device extraction",
  "mobile device"
];

const MATERIAL_GNSS_CONTEXT = [
  "receiver",
  "receivers",
  "empfänger",
  "empfaenger",
  "ricevitore",
  "ricevitori",
  "récepteur",
  "recepteur",
  "receptores",
  "positioning",
  "position",
  "geolocation",
  "geo-location",
  "tracking system",
  "fleet tracking",
  "asset tracking",
  "telematics",
  "surveying",
  "survey",
  "geodetic",
  "geodesy",
  "mapping",
  "navigation system",
  "timing",
  "synchronisation",
  "synchronization",
  "reference station",
  "correction service",
  "rtk",
  "gis"
];

// ============================================================
// NATIONAL SPACE BUYERS / NON-NATIONAL EXCLUSION
// ============================================================

const NATIONAL_SPACE_BUYER_TERMS = [
  "austrian space agency",
  "agentur für luft- und raumfahrt",
  "agentur fuer luft- und raumfahrt",
  "agenzia spaziale italiana",
  "centre national d'études spatiales",
  "centre national d’etudes spatiales",
  "cnes",
  "deutsches zentrum für luft- und raumfahrt",
  "deutsches zentrum fuer luft- und raumfahrt",
  "agencia espacial española",
  "agencia espacial espanola",
  "polska agencja kosmiczna",
  "polish space agency",
  "romanian space agency",
  "agentia spatiala romana",
  "luxembourg space agency",
  "netherlands space office",
  "portugal space",
  "agência espacial portuguesa",
  "agencia espacial portuguesa",
  "swedish national space agency",
  "rymdstyrelsen",
  "national space agency",
  "space agency",
  "agence spatiale",
  "agencia espacial",
  "agenzia spaziale",
  "raumfahrtagentur"
];

const NON_NATIONAL_BUYER_TERMS = [
  "european commission",
  "commission européenne",
  "european parliament",
  "european space agency",
  "esa-esrin",
  "esa esrin",
  "european space research institute",
  "european union agency",
  "european investment bank",
  "european central bank",
  "joint research centre",
  "joint research center",
  "eurocontrol"
];

function isNonNationalBuyer(notice, buyerName) {
  const legalTypes =
    asArray(notice["buyer-legal-type"])
      .map(x => String(x).toLowerCase());

  if (
    legalTypes.includes("eu-ins-bod-ag") ||
    legalTypes.includes("int-org")
  ) {
    return true;
  }

  const text = buyerName.toLowerCase();

  return NON_NATIONAL_BUYER_TERMS.some(
    term => text.includes(term.toLowerCase())
  );
}

function isNationalSpaceBuyer(buyerName) {
  const text = buyerName.toLowerCase();

  return NATIONAL_SPACE_BUYER_TERMS.some(
    term => text.includes(term.toLowerCase())
  );
}

// ============================================================
// CPV EXTRACTION
// ============================================================

function extractCPVs(notice) {
  const values = [
    ...asArray(notice["classification-cpv"]),
    ...asArray(notice["main-classification-proc"]),
    ...asArray(notice["additional-classification-proc"])
  ];

  const cpvs = [];

  for (const value of values) {
    const text = flattenText(value);
    const matches = text.match(/\b\d{8}\b/g);
    if (matches) cpvs.push(...matches);
  }

  return unique(cpvs);
}

function extractMainCPV(notice) {
  const raw = clean(notice["main-classification-proc"]);
  const match = raw.match(/\b\d{8}\b/);
  return match ? match[0] : "";
}

function isCoreSpaceCPV(cpv) {
  if (!cpv) return false;

  if (CORE_SPACE_CPV_EXACT.has(cpv)) {
    return true;
  }

  return CORE_SPACE_CPV_PREFIXES.some(
    prefix => cpv.startsWith(prefix)
  );
}

function getCoreSpaceCPVMatches(cpvs) {
  return cpvs.filter(cpv => isCoreSpaceCPV(cpv));
}

function getDownstreamCPVMatches(cpvs) {
  return cpvs.filter(
    cpv => DOWNSTREAM_SPACE_CPV_EXACT.has(cpv)
  );
}

function getSupportingCPVMatches(cpvs) {
  return cpvs.filter(
    cpv =>
      SUPPORTING_CPV_PREFIXES.some(
        prefix => cpv.startsWith(prefix)
      )
  );
}

// ============================================================
// TED TITLE PROTECTION
// ============================================================

function isGenericMixedAerospaceHeading(noticeTitle) {
  const t = low(noticeTitle);

  return (
    t.includes("aircraft") &&
    t.includes("spacecraft") &&
    t.includes("helicopter")
  );
}

function safeNoticeTitleEvidence(noticeTitle) {
  if (!noticeTitle) return [];

  if (isGenericMixedAerospaceHeading(noticeTitle)) {
    return [];
  }

  return findPhraseMatches(
    noticeTitle,
    [
      "satellite communication",
      "satellite communications",
      "satellite telecommunications",
      "satellite antenna",
      "satellite navigation",
      "global navigation and positioning systems",
      "spacecraft, satellites and launch vehicles",
      "launch services"
    ]
  );
}

// ============================================================
// TED RELEVANCE CLASSIFIER — HIGH RECALL + CLEANUP
// ============================================================

function classifyTEDNotice({
  noticeTitle,
  procedureTitle,
  description,
  lotDescription,
  buyerName,
  mainActivity,
  mainCPV,
  cpvs
}) {
  const semanticText =
    [procedureTitle, description, lotDescription]
      .filter(Boolean)
      .join(" ");

  const allText =
    [noticeTitle, procedureTitle, description, lotDescription, buyerName]
      .filter(Boolean)
      .join(" ");

  const titleEvidence =
    safeNoticeTitleEvidence(noticeTitle);

  const coreTextEvidence =
    unique([
      ...findPhraseMatches(
        semanticText,
        CORE_SPACE_PHRASES
      ),
      ...findWordMatches(
        semanticText,
        CORE_SPACE_WORDS
      )
    ]);

  const downstreamTextEvidence =
    unique([
      ...findPhraseMatches(
        semanticText,
        DOWNSTREAM_SPACE_PHRASES
      ),
      ...findWordMatches(
        semanticText,
        DOWNSTREAM_SPACE_WORDS
      )
    ]);

  const ambiguousEvidence =
    findWordMatches(
      semanticText,
      AMBIGUOUS_ACRONYMS
    );

  const ambiguousConfirmed =
    ambiguousEvidence.length > 0 &&
    findPhraseMatches(
      semanticText,
      AMBIGUOUS_CONTEXT_PHRASES
    ).length > 0;

  const applicationEvidence =
    findPhraseMatches(
      semanticText,
      APPLICATION_PHRASES
    );

  const defenceEvidence =
    unique([
      ...findPhraseMatches(
        allText,
        DEFENCE_PHRASES
      ),
      ...findWordMatches(
        allText,
        DEFENCE_WORDS
      ),
      ...findWordMatches(
        allText,
        DEFENCE_ACRONYMS
      )
    ]);

  const coreCPV =
    getCoreSpaceCPVMatches(cpvs);

  const downstreamCPV =
    getDownstreamCPVMatches(cpvs);

  const supportingCPV =
    getSupportingCPVMatches(cpvs);

  const nationalSpaceBuyer =
    isNationalSpaceBuyer(buyerName);

  const mainIsCore =
    isCoreSpaceCPV(mainCPV);

  const hasDirectCoreText =
    coreTextEvidence.length > 0 ||
    ambiguousConfirmed;

  const hasDownstream =
    downstreamCPV.length > 0 ||
    downstreamTextEvidence.length > 0 ||
    applicationEvidence.length > 0;

  const hasDefence =
    defenceEvidence.length > 0 ||
    low(mainActivity).includes("defence");

  // -------------------------
  // V3.1/V3.2 cleanup rules
  // -------------------------

  const isUAV =
    containsAny(allText, UAV_TERMS);

  const hasIndependentTrueSpace =
    containsAny(
      semanticText,
      [
        "satellite",
        "satcom",
        "spacecraft",
        "gnss",
        "galileo",
        "egnos",
        "copernicus",
        "earth observation",
        "remote sensing",
        "ground segment",
        "launch service",
        "launch vehicle"
      ]
    ) ||
    downstreamCPV.length > 0;

  if (
    isUAV &&
    !hasIndependentTrueSpace
  ) {
    return {
      keep: false,
      classification: "EXCLUDED - NON-SPACE UAV",
      relevanceDecision: "AUTO_EXCLUDE",
      reason:
        "UAV/drone procurement without independent satellite/GNSS/EO/space evidence.",
      confidence: "HIGH",
      coreCPV,
      downstreamCPV,
      supportingCPV,
      coreTextEvidence,
      downstreamTextEvidence,
      ambiguousEvidence,
      titleEvidence,
      defenceEvidence,
      applicationEvidence
    };
  }

  const gpsOnly =
    findWordMatches(
      semanticText,
      ["gps"]
    ).length > 0 &&
    downstreamCPV.length === 0 &&
    !containsAny(
      semanticText,
      [
        "gnss",
        "galileo",
        "egnos",
        "satellite navigation",
        "global navigation satellite system"
      ]
    );

  const forensicGPS =
    gpsOnly &&
    containsAny(
      semanticText,
      FORENSIC_GPS_CONTEXT
    );

  if (forensicGPS) {
    return {
      keep: false,
      classification: "EXCLUDED - INCIDENTAL GPS",
      relevanceDecision: "AUTO_EXCLUDE",
      reason:
        "GPS appears only as a forensic/mobile-device artefact.",
      confidence: "HIGH",
      coreCPV,
      downstreamCPV,
      supportingCPV,
      coreTextEvidence,
      downstreamTextEvidence,
      ambiguousEvidence,
      titleEvidence,
      defenceEvidence,
      applicationEvidence
    };
  }

  const materialGPS =
    gpsOnly &&
    containsAny(
      semanticText,
      MATERIAL_GNSS_CONTEXT
    );

  if (
    gpsOnly &&
    !materialGPS
  ) {
    return {
      keep: false,
      classification: "EXCLUDED - INCIDENTAL GPS",
      relevanceDecision: "AUTO_EXCLUDE",
      reason:
        "GPS mention is not supported by a material positioning/tracking/telematics requirement.",
      confidence: "MEDIUM",
      coreCPV,
      downstreamCPV,
      supportingCPV,
      coreTextEvidence,
      downstreamTextEvidence,
      ambiguousEvidence,
      titleEvidence,
      defenceEvidence,
      applicationEvidence
    };
  }

  // -------------------------
  // Defence-space
  // -------------------------

  if (
    hasDefence &&
    (
      mainIsCore ||
      hasDirectCoreText ||
      downstreamCPV.length > 0 ||
      downstreamTextEvidence.length > 0
    )
  ) {
    return {
      keep: true,
      classification:
        "DEFENCE-SPACE / DUAL-USE",
      relevanceDecision:
        "AUTO_KEEP",
      reason:
        "Material space capability combined with defence/security context.",
      confidence: "HIGH",
      coreCPV,
      downstreamCPV,
      supportingCPV,
      coreTextEvidence,
      downstreamTextEvidence,
      ambiguousEvidence,
      titleEvidence,
      defenceEvidence,
      applicationEvidence
    };
  }

  // -------------------------
  // Core space
  // -------------------------

  if (
    mainIsCore ||
    (
      hasDirectCoreText &&
      !isGenericMixedAerospaceHeading(noticeTitle)
    ) ||
    (
      nationalSpaceBuyer &&
      (
        hasDirectCoreText ||
        hasDownstream ||
        coreCPV.length > 0
      )
    )
  ) {
    return {
      keep: true,
      classification: "CORE SPACE",
      relevanceDecision: "AUTO_KEEP",
      reason:
        mainIsCore
          ? "Main CPV directly describes a space procurement."
          : nationalSpaceBuyer
          ? "National space-sector buyer with material space procurement evidence."
          : "Procedure text directly describes a core-space capability.",
      confidence: "HIGH",
      coreCPV,
      downstreamCPV,
      supportingCPV,
      coreTextEvidence,
      downstreamTextEvidence,
      ambiguousEvidence,
      titleEvidence,
      defenceEvidence,
      applicationEvidence
    };
  }

  // -------------------------
  // Downstream / application
  // -------------------------

  if (
    hasDownstream ||
    materialGPS ||
    (
      coreCPV.length > 0 &&
      !mainIsCore
    )
  ) {
    const manual =
      materialGPS &&
      downstreamCPV.length === 0 &&
      !containsAny(
        semanticText,
        ["gnss", "galileo", "egnos"]
      );

    return {
      keep: true,
      classification:
        "SPACE-ENABLED APPLICATION",
      relevanceDecision:
        manual
          ? "MANUAL_REVIEW"
          : "AUTO_KEEP",
      reason:
        manual
          ? "GPS appears material, but space relevance should be reviewed."
          : "Space/GNSS/EO/satellite capability is a material component of a broader procurement.",
      confidence:
        manual ? "MEDIUM" : "HIGH",
      coreCPV,
      downstreamCPV,
      supportingCPV,
      coreTextEvidence,
      downstreamTextEvidence,
      ambiguousEvidence,
      titleEvidence,
      defenceEvidence,
      applicationEvidence
    };
  }

  // CPV-only residual cases: preserve for manual review rather than miss.
  if (coreCPV.length > 0) {
    return {
      keep: true,
      classification:
        "SPACE-ENABLED APPLICATION",
      relevanceDecision:
        "MANUAL_REVIEW",
      reason:
        "Space CPV present but text does not prove that space is the main procurement subject.",
      confidence: "MEDIUM",
      coreCPV,
      downstreamCPV,
      supportingCPV,
      coreTextEvidence,
      downstreamTextEvidence,
      ambiguousEvidence,
      titleEvidence,
      defenceEvidence,
      applicationEvidence
    };
  }

  return {
    keep: false,
    classification:
      "EXCLUDED - WEAK EVIDENCE",
    relevanceDecision:
      "AUTO_EXCLUDE",
    reason:
      "No sufficiently material space/GNSS/EO/SATCOM evidence.",
    confidence: "LOW",
    coreCPV,
    downstreamCPV,
    supportingCPV,
    coreTextEvidence,
    downstreamTextEvidence,
    ambiguousEvidence,
    titleEvidence,
    defenceEvidence,
    applicationEvidence
  };
}

// ============================================================
// SPACE DOMAIN / APPLICATION SECTOR
// ============================================================

function detectSpaceDomain(text, cpvs) {
  const t = low(text);

  if (
    containsAny(t, [
      "satellite communication",
      "satellite communications",
      "satellite telecommunications",
      "satcom",
      "satellite internet",
      "govsatcom"
    ]) ||
    cpvs.some(c => c.startsWith("3253"))
  ) {
    return "SATCOM";
  }

  if (
    containsAny(t, [
      "space situational awareness",
      "space surveillance",
      "space tracking",
      "space traffic management",
      "space debris"
    ])
  ) {
    return "Space Surveillance / SSA / SST";
  }

  if (
    containsAny(t, [
      "launch service",
      "launch services",
      "launch vehicle",
      "space launch",
      "in-orbit validation",
      "in orbit validation"
    ]) ||
    cpvs.some(c => c.startsWith("34712"))
  ) {
    return "Launch / Transportation";
  }

  if (
    containsAny(t, [
      "spacecraft",
      "hosted payload",
      "satellite payload",
      "space payload",
      "satellite platform"
    ])
  ) {
    return "Spacecraft / Payload";
  }

  if (
    containsAny(t, [
      "ground segment",
      "ground station",
      "satellite earth station",
      "satellite reception"
    ])
  ) {
    return "Ground Segment";
  }

  if (
    containsAny(t, [
      "earth observation",
      "remote sensing",
      "copernicus",
      "satellite imagery",
      "satellite data"
    ])
  ) {
    return "Earth Observation";
  }

  if (
    containsAny(t, [
      "gnss",
      "galileo",
      "egnos",
      "gps",
      "pnt",
      "satellite navigation"
    ]) ||
    cpvs.includes("38112100")
  ) {
    return "GNSS / PNT";
  }

  if (
    cpvs.some(c => c.startsWith("3563"))
  ) {
    return "Military Space / Unverified";
  }

  return "Other Space";
}

function detectApplicationSector(row, text) {
  const a = low(row.mainActivity);
  const t = low(text);

  if (
    containsAny(t, DEFENCE_PHRASES) ||
    low(row.classification).includes("defence") ||
    a.includes("defence")
  ) return "Defence / Security";

  if (
    a.includes("rail") ||
    containsAny(t, ["rail", "railway", "train", "tram", "metro"])
  ) return "Transport - Rail";

  if (
    containsAny(t, ["road", "highway", "motorway", "traffic", "vehicle", "fleet"])
  ) return "Transport - Road";

  if (
    containsAny(t, ["maritime", "marine", "port", "harbour", "harbor", "vessel", "ship"])
  ) return "Maritime";

  if (
    containsAny(t, ["agriculture", "agricultural", "farm", "crop", "forest"])
  ) return "Agriculture / Forestry";

  if (
    a.includes("water") ||
    containsAny(t, ["water", "hydro", "flood"])
  ) return "Water / Environment";

  if (
    a.includes("electric") ||
    containsAny(t, ["electricity", "power grid", "energy", "utility", "utilities"])
  ) return "Energy / Utilities";

  if (
    a.includes("education") ||
    containsAny(t, ["university", "research", "laboratory", "scientific"])
  ) return "Research / Education";

  if (
    containsAny(t, ["police", "emergency", "fire brigade", "civil protection"])
  ) return "Public Safety / Emergency";

  if (
    containsAny(t, ["city planning", "urban", "municipal", "municipality", "smart city"])
  ) return "Urban / Local Government";

  if (
    containsAny(t, ["environment", "climate", "biodiversity", "land monitoring"])
  ) return "Environment / Climate";

  if (
    containsAny(t, ["telecommunication", "network", "wan", "internet", "connectivity"])
  ) return "ICT / Telecommunications";

  return "Other";
}

function detectCapability(domain, text) {
  const t = low(text);

  switch (domain) {
    case "SATCOM":
      return containsAny(t, ["antenna", "terminal", "equipment"])
        ? "Satellite communications equipment / terminals"
        : "Satellite communications service / connectivity";

    case "GNSS / PNT":
      if (containsAny(t, ["receiver", "receivers", "empfänger", "empfaenger"])) {
        return "GNSS/PNT receivers and positioning equipment";
      }
      if (containsAny(t, ["tracking", "telematics"])) {
        return "GNSS-enabled tracking / telematics";
      }
      return "GNSS/PNT positioning, navigation or timing";

    case "Earth Observation":
      return containsAny(t, ["data", "imagery", "image", "cloud"])
        ? "Earth observation data / imagery / processing"
        : "Earth observation / remote sensing capability";

    case "Space Surveillance / SSA / SST":
      return "SSA/SST monitoring, tracking or data service";

    case "Launch / Transportation":
      return "Launch / in-orbit delivery service";

    case "Spacecraft / Payload":
      return "Spacecraft, payload or hosted-payload capability";

    case "Ground Segment":
      return "Ground segment / ground station capability";

    default:
      return "Space-related capability";
  }
}

function detectSupplierType(domain, sector, text) {
  const t = low(text);

  if (domain === "SATCOM") {
    return containsAny(t, ["service", "connectivity", "network"])
      ? "SATCOM operator / service provider / systems integrator"
      : "Satellite communications equipment supplier / integrator";
  }

  if (domain === "GNSS / PNT") {
    return "GNSS/PNT equipment, software or geospatial solution provider";
  }

  if (domain === "Earth Observation") {
    return "EO data provider / geospatial analytics company / systems integrator";
  }

  if (domain === "Space Surveillance / SSA / SST") {
    return "SSA/SST sensor, data or analytics provider";
  }

  if (domain === "Launch / Transportation") {
    return "Launch service / orbital transportation provider";
  }

  if (domain === "Spacecraft / Payload") {
    return "Spacecraft/payload manufacturer or space systems integrator";
  }

  if (domain === "Ground Segment") {
    return "Ground-segment systems supplier / operator / integrator";
  }

  if (sector === "Defence / Security") {
    return "Defence-space systems supplier / integrator";
  }

  return "Space-enabled technology or services supplier";
}

// ============================================================
// RAW TED SOURCE PRESERVATION
// ============================================================
//
// The source notice returned by TED is preserved as exact JSON text.
// Because one Excel cell cannot safely hold very large notices, the JSON
// is split into ordered 30,000-character chunks. Concatenating
// tedRawJSONPart01 ... tedRawJSONPart12 reconstructs the source payload.
// Derived fields remain separate and never replace the raw source payload.
//
// ============================================================

const TED_RAW_CHUNK_SIZE = 30000;
const TED_RAW_MAX_PARTS = 12;

function splitTedRawJson(notice) {
  const raw = JSON.stringify(notice);
  const parts = {};

  for (let i = 0; i < TED_RAW_MAX_PARTS; i++) {
    const start = i * TED_RAW_CHUNK_SIZE;
    parts[`tedRawJSONPart${String(i + 1).padStart(2, "0")}`] =
      raw.slice(start, start + TED_RAW_CHUNK_SIZE);
  }

  parts.tedRawJSONLength = raw.length;
  parts.tedRawJSONTruncated =
    raw.length > TED_RAW_CHUNK_SIZE * TED_RAW_MAX_PARTS
      ? "YES"
      : "NO";

  return parts;
}

// ============================================================
// TED NORMALIZATION
// ============================================================

function zipDateTime(dateValue, timeValue) {
  const dates = asArray(dateValue).map(clean).filter(Boolean);
  const times = asArray(timeValue).map(clean).filter(Boolean);

  const out = [];

  for (let i = 0; i < dates.length; i++) {
    const d = dates[i];
    const t = times[i] || times[0] || "";

    if (!d) continue;

    if (t) {
      out.push(`${d}T${t}`);
    } else {
      out.push(d);
    }
  }

  return out;
}

function extractDeadline(notice) {
  const submission = unique([
    ...zipDateTime(
      notice["deadline-receipt-tender-date-lot"],
      notice["deadline-receipt-tender-time-lot"]
    ),
    ...zipDateTime(
      notice["deadline-receipt-expressions-date-lot"],
      notice["deadline-receipt-expressions-time-lot"]
    ),
    ...zipDateTime(
      notice["deadline-receipt-request-date-lot"],
      notice["deadline-receipt-request-time-lot"]
    )
  ]);

  const answerDeadlines = unique([
    ...zipDateTime(
      notice["deadline-receipt-answers-date-lot"],
      notice["deadline-receipt-answers-time-lot"]
    )
  ]);

  // "deadline" / deadline-date-* may include additional-information deadlines.
  // They are preserved, but submission deadlines are preferred for open status.
  const general = unique([
    ...asArray(notice["deadline"]).map(clean).filter(Boolean),
    ...asArray(notice["deadline-date-lot"]).map(clean).filter(Boolean),
    ...asArray(notice["deadline-date-part"]).map(clean).filter(Boolean)
  ]);

  function parseCandidates(values) {
    return values
      .map(raw => {
        const t = Date.parse(raw);
        return { raw, time: t };
      })
      .filter(x => Number.isFinite(x.time))
      .sort((a, b) => a.time - b.time);
  }

  const parsedSubmission = parseCandidates(submission);
  const parsedAll = parseCandidates(
    unique([...submission, ...answerDeadlines, ...general])
  );

  const canonicalSubmissionDeadline =
    parsedSubmission.length
      ? parsedSubmission[parsedSubmission.length - 1].raw
      : "";

  const canonicalAnyDeadline =
    parsedAll.length
      ? parsedAll[parsedAll.length - 1].raw
      : "";

  return {
    submissionDeadlines: submission.join(" | "),
    answerDeadlines: answerDeadlines.join(" | "),
    generalDeadlines: general.join(" | "),
    uniqueDeadlines:
      unique([...submission, ...answerDeadlines, ...general]).join(" | "),
    canonicalSubmissionDeadline,
    canonicalAnyDeadline,
    canonicalDeadline:
      canonicalSubmissionDeadline || canonicalAnyDeadline
  };
}

function hasNonExpiredDeadline(deadlineInfo) {
  const candidates = unique([
    ...clean(deadlineInfo.submissionDeadlines).split(" | ").filter(Boolean),
    ...clean(deadlineInfo.answerDeadlines).split(" | ").filter(Boolean),
    ...clean(deadlineInfo.generalDeadlines).split(" | ").filter(Boolean)
  ]);

  return candidates.some(raw => {
    const t = Date.parse(raw);
    return Number.isFinite(t) && t >= Date.now();
  });
}

function buildProcedureGroupKey(row) {
  if (row.procedureIdentifier) {
    return `${row.countryCode}|PROC|${normalizeKeyText(row.procedureIdentifier)}`;
  }

  const buyer =
    row.buyerIdentifier
      ? normalizeKeyText(row.buyerIdentifier)
      : normalizeBuyer(row.buyerName);

  const subject =
    normalizeKeyText(
      row.procedureTitle ||
      row.noticeTitle
    );

  const primaryCPV =
    row.mainCPV ||
    (row.allCPV.split(" | ")[0] || "");

  return [
    row.countryCode,
    "FALLBACK",
    buyer,
    subject,
    primaryCPV
  ].join("|");
}

function getTedUrl(notice, publicationNumber) {
  const links = flattenText(notice["links"]);
  const found = links.match(/https?:\/\/[^\s|]+/i);
  return found ? found[0] : "";
}

function normalizeTEDNotice(
  countryCode,
  country,
  notice
) {
  const publicationNumber =
    clean(notice["publication-number"]);

  if (!publicationNumber) return null;

  const publicationDate =
    clean(notice["publication-date"]);

  const noticeTitle =
    clean(notice["notice-title"]);

  const procedureTitle =
    clean(notice["title-proc"]);

  const description =
    clean(notice["description-proc"]);

  const lotDescription =
    clean(notice["description-lot"]);

  const buyerName =
    clean(notice["buyer-name"]);

  if (
    isNonNationalBuyer(
      notice,
      buyerName
    )
  ) {
    return null;
  }

  const buyerLegalType =
    clean(notice["buyer-legal-type"]);

  const buyerIdentifier =
    clean(notice["buyer-identifier"]);

  const mainActivity =
    clean(notice["main-activity"]);

  const formType =
    clean(notice["form-type"]);

  const noticeType =
    clean(notice["notice-type"]);

  const noticeSubtype =
    clean(notice["notice-subtype"]);

  const procedureType =
    clean(notice["procedure-type"]);

  const procedureIdentifier =
    clean(notice["procedure-identifier"]);

  const contractNature =
    clean(notice["contract-nature-main-proc"]);

  const cpvs =
    extractCPVs(notice);

  const mainCPV =
    extractMainCPV(notice);

  const estimatedValue =
    firstNumber(
      notice["estimated-value-proc"]
    );

  const currency =
    clean(
      notice["estimated-value-cur-proc"]
    );

  const deadlineInfo =
    extractDeadline(notice);

  const openDeadlineOverride =
    hasNonExpiredDeadline(
      deadlineInfo
    );

  const legalBasis =
    clean(notice["legal-basis"]);

  const winnerNames =
    joinUnique(
      asArray(
        notice["winner-name"]
      )
    );

  const awardValue =
    firstNumber(
      notice["result-value-notice"]
    );

  const awardCurrency =
    clean(
      notice["result-value-cur-notice"]
    );

  const tedUrl =
    getTedUrl(
      notice,
      publicationNumber
    );

  const cls =
    classifyTEDNotice({
      noticeTitle,
      procedureTitle,
      description,
      lotDescription,
      buyerName,
      mainActivity,
      mainCPV,
      cpvs
    });

  const stage =
    formType === "planning"
      ? "Planning"
      : formType === "competition"
      ? "Competition"
      : formType === "result"
      ? "Result / Award"
      : formType === "change"
      ? "Change / Modification"
      : formType === "cont-modif"
      ? "Contract Modification"
      : formType;

  const rawTed = splitTedRawJson(notice);

  const row = {
    recordSource: "TED",
    sourceDataProvenance: "TED API",
    sourceDataAltered: "NO - exact source payload preserved in raw JSON chunks",
    sourceAuthority: buyerName,
    countryCode,
    country,
    publicationNumber,
    publicationDate,
    buyerName,
    buyerLegalType,
    buyerIdentifier,
    mainActivity,
    procedureIdentifier,
    noticeTitle,
    procedureTitle,
    description,
    lotDescription,
    formType,
    noticeType,
    noticeSubtype,
    procurementStage: stage,
    procedureType,
    contractNature,
    mainCPV,
    allCPV: cpvs.join(" | "),
    estimatedValue,
    currency,
    submissionDeadlines:
      deadlineInfo.submissionDeadlines,
    answerDeadlines:
      deadlineInfo.answerDeadlines,
    generalDeadlines:
      deadlineInfo.generalDeadlines,
    uniqueDeadlines:
      deadlineInfo.uniqueDeadlines,
    canonicalSubmissionDeadline:
      deadlineInfo.canonicalSubmissionDeadline,
    canonicalAnyDeadline:
      deadlineInfo.canonicalAnyDeadline,
    canonicalDeadline:
      deadlineInfo.canonicalDeadline,
    openDeadlineOverride:
      openDeadlineOverride
        ? "YES"
        : "NO",
    legalBasis,
    winnerNames,
    awardValue,
    awardCurrency,
    sourceURL: tedUrl,
    classification:
      cls.classification,
    relevanceDecision:
      cls.relevanceDecision,
    relevanceConfidence:
      cls.confidence,
    relevanceReason:
      cls.reason,
    spaceRelevanceQualified:
      cls.keep ? "YES" : "NO",
    coreSpaceCPVEvidence:
      cls.coreCPV.join(" | "),
    downstreamSpaceCPVEvidence:
      cls.downstreamCPV.join(" | "),
    supportingCPVEvidence:
      cls.supportingCPV.join(" | "),
    coreSpaceTextEvidence:
      cls.coreTextEvidence.join(" | "),
    downstreamSpaceTextEvidence:
      cls.downstreamTextEvidence.join(" | "),
    ambiguousSpaceEvidence:
      cls.ambiguousEvidence.join(" | "),
    noticeTitleEvidence:
      cls.titleEvidence.join(" | "),
    defenceEvidence:
      cls.defenceEvidence.join(" | "),
    applicationEvidence:
      cls.applicationEvidence.join(" | "),
    keepForRAG:
      cls.keep
        ? "YES"
        : openDeadlineOverride
        ? "OPEN-DEADLINE-OVERRIDE"
        : "NO"
  };

  Object.assign(row, rawTed);

  row.procedureGroupKey =
    buildProcedureGroupKey(row);

  const fullText =
    [
      row.noticeTitle,
      row.procedureTitle,
      row.description,
      row.lotDescription
    ].join(" ");

  const cpvList =
    row.allCPV
      ? row.allCPV.split(" | ")
      : [];

  row.spaceDomain =
    cls.keep
      ? detectSpaceDomain(
          fullText,
          cpvList
        )
      : "";

  row.applicationSector =
    cls.keep
      ? detectApplicationSector(
          row,
          fullText
        )
      : "";

  row.requiredCapability =
    cls.keep
      ? detectCapability(
          row.spaceDomain,
          fullText
        )
      : "";

  row.potentialSupplierType =
    cls.keep
      ? detectSupplierType(
          row.spaceDomain,
          row.applicationSector,
          fullText
        )
      : "";

  row.eligibilityEvidence =
    "Eligibility not determined from TED relevance data alone";

  row.eligibilityUnknown =
    "YES";

  return row;
}

// ============================================================
// TED API CLIENT
// ============================================================

async function postTED(body, options = {}) {
  let wait = INITIAL_RETRY_MS;
  const retryClientErrors =
    options.retryClientErrors !== false;

  while (true) {
    try {
      const response =
        await axios.post(
          API_URL,
          body,
          {
            timeout: 120000,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );

      return response.data;
    } catch (error) {
      const status =
        error.response &&
        error.response.status;

      if (
        status &&
        status >= 400 &&
        status < 500 &&
        status !== 429 &&
        !retryClientErrors
      ) {
        throw error;
      }

      const msg =
        status
          ? `HTTP ${status}`
          : error.message;

      console.log(
        `TED request failed: ${msg}. Retrying in ${Math.round(wait / 1000)} sec...`
      );

      await sleep(wait);

      wait =
        Math.min(
          wait * 2,
          MAX_RETRY_MS
        );
    }
  }
}

function tedQuery(
  countryCode,
  year
) {
  const start =
    `${year}0101`;

  const end =
    `${year}1231`;

  return (
    `buyer-country = ${countryCode} ` +
    `AND publication-date >= ${start} ` +
    `AND publication-date <= ${end} ` +
    `AND buyer-legal-type != eu-ins-bod-ag ` +
    `AND buyer-legal-type != int-org`
  );
}

function cachePaths(
  countryCode,
  year
) {
  return {
    final:
      path.join(
        CACHE_DIR,
        `ted-v4-${countryCode.toLowerCase()}-${year}.json`
      ),

    checkpoint:
      path.join(
        CACHE_DIR,
        `ted-v4-checkpoint-${countryCode.toLowerCase()}-${year}.json`
      )
  };
}

async function downloadCountryYear(
  countryCode,
  country,
  year
) {
  const paths =
    cachePaths(
      countryCode,
      year
    );

  if (
    fs.existsSync(
      paths.final
    )
  ) {
    console.log(
      `${country} ${year}: already completed`
    );

    return JSON.parse(
      fs.readFileSync(
        paths.final,
        "utf8"
      )
    );
  }

  let nextToken = "";
  let scanned = 0;
  let relevant = [];
  let batch = 0;

  if (
    fs.existsSync(
      paths.checkpoint
    )
  ) {
    const cp =
      JSON.parse(
        fs.readFileSync(
          paths.checkpoint,
          "utf8"
        )
      );

    nextToken =
      cp.nextToken || "";

    scanned =
      cp.scanned || 0;

    relevant =
      cp.relevant || [];

    batch =
      cp.batch || 0;

    console.log(
      `${country} ${year}: resuming checkpoint at ${scanned} scanned`
    );
  }

  const query =
    tedQuery(
      countryCode,
      year
    );

  let first = true;

  while (true) {
    const body = {
      query,
      limit:
        PAGE_SIZE,
      fields:
        FIELDS,
      paginationMode:
        "ITERATION"
    };

    if (nextToken) {
      body.iterationNextToken =
        nextToken;
    }

    const data =
      await postTED(body);

    if (
      first &&
      data.totalNoticeCount !== undefined
    ) {
      console.log(
        `${country} ${year}: TED matches ${data.totalNoticeCount}`
      );
      first = false;
    }

    const notices =
      data.notices ||
      data.results ||
      [];

    if (!notices.length) {
      break;
    }

    for (const notice of notices) {
      const row =
        normalizeTEDNotice(
          countryCode,
          country,
          notice
        );

      if (
        row &&
        (
          row.keepForRAG === "YES" ||
          row.keepForRAG === "OPEN-DEADLINE-OVERRIDE"
        )
      ) {
        relevant.push(row);
      }
    }

    scanned +=
      notices.length;

    batch += 1;

    console.log(
      `${country} ${year}: scanned ${scanned}, retained ${relevant.length}`
    );

    nextToken =
      data.iterationNextToken ||
      "";

    if (
      batch % CHECKPOINT_EVERY === 0
    ) {
      fs.writeFileSync(
        paths.checkpoint,
        JSON.stringify(
          {
            nextToken,
            scanned,
            relevant,
            batch
          },
          null,
          2
        )
      );

      console.log(
        `${country} ${year}: checkpoint saved`
      );
    }

    if (!nextToken) {
      break;
    }

    await sleep(
      NORMAL_WAIT_MS
    );
  }

  // Deduplicate exact TED publication number.
  const map = new Map();

  for (const row of relevant) {
    map.set(
      row.publicationNumber,
      row
    );
  }

  const uniqueRows =
    [...map.values()];

  fs.writeFileSync(
    paths.final,
    JSON.stringify(
      uniqueRows,
      null,
      2
    )
  );

  if (
    fs.existsSync(
      paths.checkpoint
    )
  ) {
    fs.unlinkSync(
      paths.checkpoint
    );
  }

  console.log(
    `${country} ${year}: COMPLETE — ${uniqueRows.length} retained`
  );

  return uniqueRows;
}

// ============================================================
// GLOBAL NON-EXPIRED-DEADLINE PASS
// ============================================================
//
// This is independent from the space classifier and has no publication-year
// restriction. It exists specifically to guarantee capture of EU-27 TED
// notices that expose a non-expired procurement-related deadline.
//
// Each searchable TED deadline field is queried separately and results are
// unioned by publication number.
//
// ============================================================

const OPEN_DEADLINE_QUERY_FIELDS = [
  "deadline-receipt-tender-date-lot",
  "deadline-receipt-expressions-date-lot",
  "deadline-receipt-request-date-lot",
  "deadline-receipt-answers-date-lot",
  "deadline"
];

function todayTedDate() {
  return new Date()
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "");
}

async function downloadOpenDeadlineField(
  countryCode,
  country,
  field
) {
  const today = todayTedDate();

  const query =
    `buyer-country = ${countryCode} ` +
    `AND ${field} >= ${today} ` +
    `AND buyer-legal-type != eu-ins-bod-ag ` +
    `AND buyer-legal-type != int-org`;

  let nextToken = "";
  const rows = [];
  let scanned = 0;

  console.log(
    `${country}: open-deadline query ${field}`
  );

  try {
    while (true) {
      const body = {
        query,
        limit: PAGE_SIZE,
        fields: FIELDS,
        paginationMode: "ITERATION"
      };

      if (nextToken) {
        body.iterationNextToken = nextToken;
      }

      const data =
        await postTED(
          body,
          { retryClientErrors: false }
        );

      const notices =
        data.notices ||
        data.results ||
        [];

      if (!notices.length) {
        break;
      }

      for (const notice of notices) {
        const row =
          normalizeTEDNotice(
            countryCode,
            country,
            notice
          );

        if (!row) continue;

        // Query matched a future deadline field. Verify locally from returned
        // deadline values before retaining.
        if (
          row.openDeadlineOverride === "YES"
        ) {
          rows.push(row);
        }
      }

      scanned += notices.length;

      nextToken =
        data.iterationNextToken ||
        "";

      if (!nextToken) break;

      await sleep(NORMAL_WAIT_MS);
    }
  } catch (error) {
    const status =
      error.response &&
      error.response.status;

    console.log(
      `${country}: deadline field ${field} query skipped (${status ? "HTTP " + status : error.message}).`
    );
  }

  console.log(
    `${country}: ${field} -> ${rows.length} non-expired deadline notices`
  );

  return rows;
}

async function downloadAllOpenDeadlineNotices() {
  console.log("");
  console.log(
    "=== TED ALL NON-EXPIRED DEADLINES PASS ==="
  );

  const map = new Map();

  for (const [countryCode, country] of COUNTRIES) {
    for (const field of OPEN_DEADLINE_QUERY_FIELDS) {
      const rows =
        await downloadOpenDeadlineField(
          countryCode,
          country,
          field
        );

      for (const row of rows) {
        map.set(
          row.publicationNumber,
          row
        );
      }
    }
  }

  const rows =
    [...map.values()];

  console.log(
    `All EU-27 TED notices with non-expired deadlines: ${rows.length}`
  );

  return rows;
}

// ============================================================
// LIFECYCLE + STATUS
// ============================================================

function markLatestRelevant(rows) {
  const latest =
    new Map();

  for (const row of rows) {
    const key =
      row.procedureGroupKey;

    const t =
      parsePublicationDate(
        row.publicationDate
      );

    const current =
      latest.get(key);

    if (
      !current ||
      t > current.time
    ) {
      latest.set(
        key,
        {
          time: t,
          publicationNumber:
            row.publicationNumber
        }
      );
    }
  }

  for (const row of rows) {
    const x =
      latest.get(
        row.procedureGroupKey
      );

    row.latestRelevantNotice =
      x &&
      x.publicationNumber ===
        row.publicationNumber
        ? "YES"
        : "NO";
  }
}

function deriveAvailabilityStatus(row) {
  if (
    row.recordSource !== "TED"
  ) {
    if (
      row.pipelineStatus === "FUTURE_SIGNAL"
    ) {
      return {
        availabilityStatus:
          "FUTURE_PIPELINE",
        openStatusReason:
          "Publicly announced future procurement signal outside TED; not yet a confirmed open TED competition."
      };
    }

    return {
      availabilityStatus:
        "STATUS_UNKNOWN",
      openStatusReason:
        "Non-TED source; status must be verified at source."
    };
  }

  if (
    row.latestRelevantNotice !== "YES"
  ) {
    return {
      availabilityStatus:
        "HISTORICAL_NOTICE",
      openStatusReason:
        "Not the latest relevant notice for the procedure."
    };
  }

  const form =
    low(row.formType);

  const stage =
    low(row.procurementStage);

  if (
    row.openDeadlineOverride === "YES"
  ) {
    return {
      availabilityStatus:
        "OPEN_DEADLINE_PRESENT",
      openStatusReason:
        "TED notice contains at least one non-expired deadline field."
    };
  }

  if (
    form === "result" ||
    stage.includes("result") ||
    row.winnerNames
  ) {
    return {
      availabilityStatus:
        "CLOSED_CONFIRMED",
      openStatusReason:
        "Latest relevant notice is a result/award or contains winner information."
    };
  }

  if (
    row.canonicalDeadline
  ) {
    const t =
      Date.parse(
        row.canonicalDeadline
      );

    if (
      Number.isFinite(t)
    ) {
      if (
        t >= Date.now()
      ) {
        return {
          availabilityStatus:
            "OPEN_CONFIRMED",
          openStatusReason:
            "Latest relevant notice has a future canonical deadline."
        };
      }

      return {
        availabilityStatus:
          "CLOSED_CONFIRMED",
        openStatusReason:
          "Latest relevant notice has an expired canonical deadline."
      };
    }
  }

  if (
    form === "planning" ||
    stage.includes("planning")
  ) {
    return {
      availabilityStatus:
        "FUTURE_PIPELINE",
      openStatusReason:
        "TED planning/PIN notice published before the competition."
    };
  }

  return {
    availabilityStatus:
      "STATUS_UNKNOWN",
    openStatusReason:
      "Current status cannot be confirmed from the available TED fields."
  };
}

function buildTEDMaster(rows) {
  markLatestRelevant(rows);

  const groups =
    new Map();

  for (const row of rows) {
    const key =
      row.procedureGroupKey;

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups
      .get(key)
      .push(row);
  }

  const master = [];

  for (
    const [
      key,
      group
    ]
    of groups.entries()
  ) {
    group.sort(
      (a, b) =>
        parsePublicationDate(a.publicationDate) -
        parsePublicationDate(b.publicationDate)
    );

    const latest =
      [...group]
        .reverse()
        .find(
          x =>
            x.latestRelevantNotice === "YES"
        ) ||
      group[group.length - 1];

    const first =
      group[0];

    const latestPlanning =
      [...group]
        .reverse()
        .find(
          x =>
            low(x.formType) === "planning"
        );

    const latestCompetition =
      [...group]
        .reverse()
        .find(
          x =>
            low(x.formType) === "competition"
        );

    const latestAward =
      [...group]
        .reverse()
        .find(
          x =>
            low(x.formType) === "result" ||
            x.winnerNames
        );

    const out =
      { ...latest };

    out.firstRelevantPublicationDate =
      first.publicationDate;

    out.latestRelevantPublicationDate =
      latest.publicationDate;

    out.noticeCountRelevant =
      group.length;

    out.latestPlanningNotice =
      latestPlanning
        ? latestPlanning.publicationNumber
        : "";

    out.latestCompetitionNotice =
      latestCompetition
        ? latestCompetition.publicationNumber
        : "";

    out.latestAwardNotice =
      latestAward
        ? latestAward.publicationNumber
        : "";

    out.procedureLifecycleStatus =
      joinUnique(
        group.map(
          x =>
            x.procurementStage
        )
      );

    Object.assign(
      out,
      deriveAvailabilityStatus(out)
    );

    master.push(out);
  }

  return master;
}


// ============================================================
// RAG TEXT
// ============================================================

function buildRagText(row) {
  return [
    `Record source: ${clean(row.recordSource)}`,
    `Source authority: ${clean(row.sourceAuthority)}`,
    `Country: ${clean(row.country)}`,
    `Buyer: ${clean(row.buyerName)}`,
    `Procedure group: ${clean(row.procedureGroupKey)}`,
    `Publication/reference: ${clean(row.publicationNumber)}`,
    `Publication date: ${clean(row.publicationDate)}`,
    `Procurement stage: ${clean(row.procurementStage)}`,
    `Availability status: ${clean(row.availabilityStatus)}`,
    `Open-status reason: ${clean(row.openStatusReason)}`,
    `Canonical deadline: ${clean(row.canonicalDeadline)}`,
    `Title: ${clean(row.noticeTitle)}`,
    `Procedure title: ${clean(row.procedureTitle)}`,
    `Description: ${clean(row.description)}`,
    `Lot description: ${clean(row.lotDescription)}`,
    `Classification: ${clean(row.classification)}`,
    `Space domain: ${clean(row.spaceDomain)}`,
    `Application sector: ${clean(row.applicationSector)}`,
    `Required capability: ${clean(row.requiredCapability)}`,
    `Potential supplier type: ${clean(row.potentialSupplierType)}`,
    `Relevance decision: ${clean(row.relevanceDecision)}`,
    `Relevance reason: ${clean(row.relevanceReason)}`,
    `Main CPV: ${clean(row.mainCPV)}`,
    `All CPVs: ${clean(row.allCPV)}`,
    `Estimated value: ${row.estimatedValue ?? ""} ${clean(row.currency)}`,
    `Winner(s): ${clean(row.winnerNames)}`,
    `Award value: ${row.awardValue ?? ""} ${clean(row.awardCurrency)}`,
    `Eligibility evidence: ${clean(row.eligibilityEvidence)}`,
    `Eligibility unknown: ${clean(row.eligibilityUnknown)}`,
    `Source URL: ${clean(row.sourceURL)}`
  ]
    .filter(Boolean)
    .join("\n");
}

// ============================================================
// WORKBOOK OUTPUT
// ============================================================

const MASTER_COLUMNS = [
  "recordSource",
  "sourceDataProvenance",
  "sourceDataAltered",
  "sourceAuthority",
  "countryCode",
  "country",
  "buyerName",
  "buyerLegalType",
  "buyerIdentifier",
  "mainActivity",
  "procedureIdentifier",
  "procedureGroupKey",
  "publicationNumber",
  "firstRelevantPublicationDate",
  "latestRelevantPublicationDate",
  "publicationDate",
  "noticeCountRelevant",
  "latestPlanningNotice",
  "latestCompetitionNotice",
  "latestAwardNotice",
  "procedureLifecycleStatus",
  "noticeTitle",
  "procedureTitle",
  "procurementStage",
  "availabilityStatus",
  "openStatusReason",
  "submissionDeadlines",
  "answerDeadlines",
  "generalDeadlines",
  "canonicalSubmissionDeadline",
  "canonicalAnyDeadline",
  "canonicalDeadline",
  "openDeadlineOverride",
  "spaceRelevanceQualified",
  "classification",
  "spaceDomain",
  "applicationSector",
  "requiredCapability",
  "potentialSupplierType",
  "relevanceDecision",
  "relevanceConfidence",
  "relevanceReason",
  "mainCPV",
  "allCPV",
  "estimatedValue",
  "currency",
  "winnerNames",
  "awardValue",
  "awardCurrency",
  "eligibilityEvidence",
  "eligibilityUnknown",
  "sourceURL",
  "ragText"
];

const NOTICE_COLUMNS = [
  "recordSource",
  "sourceDataProvenance",
  "sourceDataAltered",
  "tedRawJSONLength",
  "tedRawJSONTruncated",
  "tedRawJSONPart01",
  "tedRawJSONPart02",
  "tedRawJSONPart03",
  "tedRawJSONPart04",
  "tedRawJSONPart05",
  "tedRawJSONPart06",
  "tedRawJSONPart07",
  "tedRawJSONPart08",
  "tedRawJSONPart09",
  "tedRawJSONPart10",
  "tedRawJSONPart11",
  "tedRawJSONPart12",
  "countryCode",
  "country",
  "publicationNumber",
  "publicationDate",
  "buyerName",
  "buyerLegalType",
  "buyerIdentifier",
  "mainActivity",
  "procedureIdentifier",
  "procedureGroupKey",
  "latestRelevantNotice",
  "noticeTitle",
  "procedureTitle",
  "description",
  "lotDescription",
  "formType",
  "noticeType",
  "noticeSubtype",
  "procurementStage",
  "procedureType",
  "contractNature",
  "mainCPV",
  "allCPV",
  "estimatedValue",
  "currency",
  "submissionDeadlines",
  "answerDeadlines",
  "generalDeadlines",
  "uniqueDeadlines",
  "canonicalSubmissionDeadline",
  "canonicalAnyDeadline",
  "canonicalDeadline",
  "openDeadlineOverride",
  "spaceRelevanceQualified",
  "legalBasis",
  "classification",
  "spaceDomain",
  "applicationSector",
  "requiredCapability",
  "potentialSupplierType",
  "relevanceDecision",
  "relevanceConfidence",
  "relevanceReason",
  "coreSpaceCPVEvidence",
  "downstreamSpaceCPVEvidence",
  "supportingCPVEvidence",
  "coreSpaceTextEvidence",
  "downstreamSpaceTextEvidence",
  "ambiguousSpaceEvidence",
  "noticeTitleEvidence",
  "defenceEvidence",
  "applicationEvidence",
  "winnerNames",
  "awardValue",
  "awardCurrency",
  "eligibilityEvidence",
  "eligibilityUnknown",
  "sourceURL",
  "ragText"
];

function makeColumns(keys) {
  return keys.map(key => ({
    header: key,
    key,
    width:
      key === "description" ||
      key === "lotDescription" ||
      key === "ragText"
        ? 60
        : key === "relevanceReason" ||
          key === "openStatusReason" ||
          key === "procedureGroupKey"
        ? 45
        : key === "noticeTitle" ||
          key === "procedureTitle"
        ? 45
        : key === "buyerName" ||
          key === "potentialSupplierType"
        ? 35
        : 20
  }));
}

function styleSheet(sheet, freezeCols = 2) {
  sheet.views = [
    {
      state: "frozen",
      ySplit: 1,
      xSplit: freezeCols
    }
  ];

  const header =
    sheet.getRow(1);

  header.font = {
    bold: true,
    color: {
      argb: "FFFFFFFF"
    }
  };

  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: {
      argb: "FF1F4E78"
    }
  };

  header.alignment = {
    vertical: "middle",
    horizontal: "center",
    wrapText: true
  };

  header.height = 32;

  if (sheet.columnCount > 0) {
    sheet.autoFilter = {
      from: {
        row: 1,
        column: 1
      },
      to: {
        row: 1,
        column:
          sheet.columnCount
      }
    };
  }
}

function writeRows(
  workbook,
  sheetName,
  rows,
  columns
) {
  const sheet =
    workbook.addWorksheet(
      sheetName
    );

  sheet.columns =
    makeColumns(columns);

  for (const row of rows) {
    const out = {};

    for (const key of columns) {
      out[key] =
        row[key] === undefined ||
        row[key] === null
          ? ""
          : row[key];
    }

    sheet.addRow(out);
  }

  styleSheet(sheet);

  const wrapKeys =
    new Set([
      "noticeTitle",
      "procedureTitle",
      "description",
      "lotDescription",
      "relevanceReason",
      "openStatusReason",
      "ragText"
    ]);

  for (const key of columns) {
    if (
      wrapKeys.has(key)
    ) {
      sheet.getColumn(key).alignment = {
        vertical: "top",
        wrapText: true
      };
    }
  }

  return sheet;
}

function countBy(rows, key) {
  const map = new Map();

  for (const row of rows) {
    const value =
      clean(row[key]) ||
      "BLANK";

    map.set(
      value,
      (map.get(value) || 0) + 1
    );
  }

  return map;
}

function addCountSection(
  sheet,
  title,
  map
) {
  sheet.addRow({});
  sheet.addRow({
    metric: title,
    value: ""
  });

  for (
    const [
      label,
      count
    ]
    of [...map.entries()]
      .sort(
        (a, b) =>
          b[1] - a[1]
      )
  ) {
    sheet.addRow({
      metric:
        `  ${label}`,
      value:
        count
    });
  }
}

function buildSummary(
  workbook,
  tedNotices,
  tedMaster,
  allNonExpiredDeadlines,
  combined
) {
  const sheet =
    workbook.addWorksheet(
      "Summary"
    );

  sheet.columns = [
    {
      header: "Metric",
      key: "metric",
      width: 55
    },
    {
      header: "Value",
      key: "value",
      width: 20
    }
  ];

  const metrics = [
    ["All TED notice rows retained", tedNotices.length],
    ["TED procurement master rows", tedMaster.length],
    ["All TED notices with non-expired deadline", allNonExpiredDeadlines.length],
    ["Combined final master rows", combined.length],
    [
      "ALL TED WITH NON-EXPIRED DEADLINE",
      allNonExpiredDeadlines.length
    ],
    [
      "PUBLISHED TED PLANNING / PIN",
      combined.filter(
        r =>
          r.availabilityStatus ===
          "FUTURE_PIPELINE"
      ).length
    ],
    [
      "STATUS_UNKNOWN",
      combined.filter(
        r =>
          r.availabilityStatus ===
          "STATUS_UNKNOWN"
      ).length
    ],
    [
      "AUTO_KEEP",
      combined.filter(
        r =>
          r.relevanceDecision ===
          "AUTO_KEEP"
      ).length
    ],
    [
      "MANUAL_REVIEW",
      combined.filter(
        r =>
          r.relevanceDecision ===
          "MANUAL_REVIEW"
      ).length
    ]
  ];

  for (
    const [
      metric,
      value
    ]
    of metrics
  ) {
    sheet.addRow({
      metric,
      value
    });
  }

  addCountSection(
    sheet,
    "Classification",
    countBy(
      combined,
      "classification"
    )
  );

  addCountSection(
    sheet,
    "Space domain",
    countBy(
      combined,
      "spaceDomain"
    )
  );

  addCountSection(
    sheet,
    "Record source",
    countBy(
      combined,
      "recordSource"
    )
  );

  styleSheet(
    sheet,
    1
  );
}

function buildSourcesSheet(
  workbook
) {
  const sheet =
    workbook.addWorksheet(
      "Sources & Coverage"
    );

  sheet.columns = [
    {
      header: "Source Type",
      key: "sourceType",
      width: 25
    },
    {
      header: "Country",
      key: "country",
      width: 20
    },
    {
      header: "Authority",
      key: "authority",
      width: 35
    },
    {
      header: "URL / Location",
      key: "url",
      width: 60
    },
    {
      header: "Purpose",
      key: "purpose",
      width: 75
    }
  ];

  sheet.addRow({
    sourceType: "TED",
    country: "EU-27",
    authority: "TED / Publications Office",
    url: API_URL,
    purpose:
      "Sole procurement source. Only notices actually published in TED are included. A separate deadline pass queries TED deadline fields directly so all returned EU-27 notices with a locally verified non-expired deadline are retained even when the space classifier does not qualify them; space relevance remains separate. Published planning/PIN notices are retained because they are already public TED notices."
  });

  sheet.addRow({
    sourceType: "Source integrity",
    country: "EU-27",
    authority: "TED / Publications Office",
    url: "",
    purpose:
      "TED Notice History preserves the exact TED API notice payload in ordered raw JSON chunks. Classification, domain, lifecycle and status columns are separate derived metadata based only on TED data."
  });

  styleSheet(
    sheet,
    1
  );
}

// ============================================================
// SOURCE FILE OUTPUT
// ============================================================

function reconstructRawTedJson(row) {
  let raw = "";

  for (let i = 1; i <= TED_RAW_MAX_PARTS; i++) {
    raw +=
      row[
        `tedRawJSONPart${String(i).padStart(2, "0")}`
      ] || "";
  }

  return raw;
}

function writeRawTedSourceJsonl(rows) {
  const byPublication =
    new Map();

  for (const row of rows) {
    if (!row.publicationNumber) continue;
    byPublication.set(
      row.publicationNumber,
      row
    );
  }

  const fd =
    fs.openSync(
      RAW_TED_SOURCE_JSONL,
      "w"
    );

  try {
    for (const row of byPublication.values()) {
      const raw =
        reconstructRawTedJson(row);

      if (raw) {
        fs.writeSync(
          fd,
          raw + "\n",
          null,
          "utf8"
        );
      }
    }
  } finally {
    fs.closeSync(fd);
  }

  console.log(
    `Raw TED source JSONL: ${RAW_TED_SOURCE_JSONL}`
  );
}

function copySourceScriptToOutput() {
  try {
    if (
      path.resolve(__filename) !==
      path.resolve(SOURCE_SCRIPT_COPY)
    ) {
      fs.copyFileSync(
        __filename,
        SOURCE_SCRIPT_COPY
      );
    }

    console.log(
      `Source script copy: ${SOURCE_SCRIPT_COPY}`
    );
  } catch (error) {
    console.log(
      `WARNING: could not copy source script: ${error.message}`
    );
  }
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  ensureDirs();

  console.log("");
  console.log(
    "EU-27 SPACE PROCUREMENT MASTER BUILDER V4"
  );
  console.log(
    `Output folder: ${OUTPUT_DIR}`
  );
  console.log(
    `Years: ${START_YEAR}-${END_YEAR}`
  );
  console.log("");

  // ---------------------------------------------
  // 1. TED
  // ---------------------------------------------

  const tedNotices = [];

  console.log(
    "=== TED EU-27 DOWNLOAD / RESUME ==="
  );

  for (
    const [
      countryCode,
      country
    ]
    of COUNTRIES
  ) {
    console.log("");
    console.log(
      "########################################"
    );
    console.log(country);
    console.log(
      "########################################"
    );

    for (
      let year =
        START_YEAR;
      year <= END_YEAR;
      year++
    ) {
      const rows =
        await downloadCountryYear(
          countryCode,
          country,
          year
        );

      tedNotices.push(
        ...rows
      );
    }
  }

  // Deduplicate exact TED publication number globally.
  const tedMap =
    new Map();

  for (const row of tedNotices) {
    tedMap.set(
      row.publicationNumber,
      row
    );
  }

  const historicalSpaceRows =
    [...tedMap.values()];

  console.log("");
  console.log(
    `TED historical/high-recall space notices: ${historicalSpaceRows.length}`
  );

  // Independent pass: all Member-State TED notices with a non-expired deadline,
  // regardless of space classification and without publication-year restriction.
  const openDeadlineRows =
    await downloadAllOpenDeadlineNotices();

  const combinedMap =
    new Map();

  for (const row of historicalSpaceRows) {
    combinedMap.set(
      row.publicationNumber,
      row
    );
  }

  for (const row of openDeadlineRows) {
    combinedMap.set(
      row.publicationNumber,
      row
    );
  }

  const tedUnique =
    [...combinedMap.values()];

  console.log(
    `Combined TED notice rows after union: ${tedUnique.length}`
  );

  const tedMaster =
    buildTEDMaster(
      tedUnique
    );

  console.log(
    `TED procurement master rows: ${tedMaster.length}`
  );

  // ---------------------------------------------
  // 2. TED-ONLY FINAL MASTER
  // ---------------------------------------------

  for (const row of tedMaster) {
    row.ragText =
      buildRagText(row);
  }

  for (const row of tedUnique) {
    Object.assign(
      row,
      deriveAvailabilityStatus(row)
    );

    row.ragText =
      buildRagText(row);
  }

  const finalMaster =
    [...tedMaster]
      .sort(
        (a, b) =>
          clean(a.country)
            .localeCompare(
              clean(b.country)
            ) ||
          parsePublicationDate(
            b.publicationDate
          ) -
          parsePublicationDate(
            a.publicationDate
          )
      );

  const ragReady =
    finalMaster.filter(
      r =>
        r.relevanceDecision === "AUTO_KEEP" &&
        r.spaceRelevanceQualified === "YES"
    );

  const manualReview =
    finalMaster.filter(
      r =>
        r.relevanceDecision === "MANUAL_REVIEW" &&
        r.spaceRelevanceQualified === "YES"
    );

  const allNonExpiredDeadlines =
    openDeadlineRows
      .filter(
        r =>
          r.openDeadlineOverride === "YES"
      )
      .sort(
        (a, b) =>
          clean(a.country).localeCompare(clean(b.country)) ||
          Date.parse(a.canonicalDeadline || "9999-12-31") -
          Date.parse(b.canonicalDeadline || "9999-12-31")
      );

  // Only planning/PIN notices that are already published in TED.
  const publishedTedPlanning =
    finalMaster.filter(
      r =>
        r.availabilityStatus ===
        "FUTURE_PIPELINE"
    );

  // ---------------------------------------------
  // 3. EXCEL
  // ---------------------------------------------

  const workbook =
    new ExcelJS.Workbook();

  workbook.creator =
    "EU-27 Member States Space Procurement Master V5 Final TED-Only";

  workbook.created =
    new Date();

  writeRows(
    workbook,
    "Final Procurement Master",
    finalMaster,
    MASTER_COLUMNS
  );

  writeRows(
    workbook,
    "RAG Ready Master",
    ragReady,
    MASTER_COLUMNS
  );

  writeRows(
    workbook,
    "All Non-Expired Deadlines",
    allNonExpiredDeadlines,
    NOTICE_COLUMNS
  );

  writeRows(
    workbook,
    "Published TED Planning",
    publishedTedPlanning,
    MASTER_COLUMNS
  );

  writeRows(
    workbook,
    "Manual Review",
    manualReview,
    MASTER_COLUMNS
  );

  writeRows(
    workbook,
    "TED Notice History",
    tedUnique,
    NOTICE_COLUMNS
  );

  buildSourcesSheet(
    workbook
  );

  buildSummary(
    workbook,
    tedUnique,
    tedMaster,
    allNonExpiredDeadlines,
    finalMaster
  );

  // Save both source artifacts under Procurement Data.
  copySourceScriptToOutput();
  writeRawTedSourceJsonl(tedUnique);

  console.log("");
  console.log(
    "Writing final TED-only workbook..."
  );

  await workbook.xlsx.writeFile(
    FINAL_XLSX
  );

  console.log("");
  console.log(
    "=============================================="
  );
  console.log(
    "V5 FINAL TED-ONLY COMPLETE"
  );
  console.log(
    `Final Procurement Master: ${finalMaster.length}`
  );
  console.log(
    `RAG Ready Master: ${ragReady.length}`
  );
  console.log(
    `All TED non-expired deadlines: ${allNonExpiredDeadlines.length}`
  );
  console.log(
    `Published TED Planning/PIN: ${publishedTedPlanning.length}`
  );
  console.log(
    `Manual Review: ${manualReview.length}`
  );
  console.log("");
  console.log("Final workbook:");
  console.log(FINAL_XLSX);
  console.log(
    "=============================================="
  );
  console.log("");
}

main().catch(error => {
  console.error("");
  console.error(
    "V5 FINAL TED-ONLY MASTER BUILDER FAILED"
  );
  console.error(
    error.stack ||
    error.message ||
    error
  );
  process.exit(1);
});
