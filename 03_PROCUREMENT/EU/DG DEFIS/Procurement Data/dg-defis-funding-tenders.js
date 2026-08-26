const axios = require("axios");
const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");

const API_URL =
  "https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA";

const OUTPUT_FOLDER =
  "C:\\Users\\angel\\OneDrive\\Desktop\\knowledge\\eu-space-rag\\03_PROCUREMENT\\EU\\DG DEFIS\\Procurement Data";

const CHECKPOINT_FILE = path.join(
  OUTPUT_FOLDER,
  "dg-defis-funding-tenders-checkpoint.json"
);

const PAGE_SIZE = 100;

const SEARCH_TERMS = [
  "DEFIS/",
  "DG DEFIS",
  "Defence Industry and Space"
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ======================================================
// BASIC HELPERS
// ======================================================

function first(value) {
  if (value === undefined || value === null) {
    return "";
  }

  if (Array.isArray(value)) {
    return value.length ? first(value[0]) : "";
  }

  return value;
}

function text(value) {
  if (value === undefined || value === null) {
    return "";
  }

  if (Array.isArray(value)) {
    return value
      .map(text)
      .filter(Boolean)
      .join("\n");
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value).trim();
}

function cleanText(value) {
  return text(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function metadata(result) {
  return result.metadata || {};
}

function getField(result, field) {
  return cleanText(
    metadata(result)[field]
  );
}

function getFirstField(result, field) {
  return cleanText(
    first(
      metadata(result)[field]
    )
  );
}

// ======================================================
// JSON HELPERS
// ======================================================

function safeJsonParse(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "object") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// ======================================================
// DEFIS FILTER
// ======================================================

function isDefisResult(result) {
  const m = metadata(result);

  const callIdentifier =
    cleanText(
      m.callIdentifier
    ).toUpperCase();

  const authority =
    cleanText(
      m.cftLeadContractingAuthorityCode
    ).toUpperCase();

  const genuineDefisReference =
    callIdentifier.includes("DEFIS/") ||
    callIdentifier.startsWith("DEFIS") ||
    callIdentifier.includes("EC-DEFIS");

  const genuineDefisAuthority =
    authority.includes("DG DEFIS") ||
    authority.includes(
      "DIRECTORATE-GENERAL FOR DEFENCE INDUSTRY AND SPACE"
    ) ||
    (
      authority.includes("EUROPEAN COMMISSION") &&
      authority.includes("DEFENCE INDUSTRY AND SPACE")
    );

  return (
    genuineDefisReference ||
    genuineDefisAuthority
  );
}

// ======================================================
// IDENTIFIERS / DEDUPLICATION
// ======================================================

function getCanonicalId(result) {
  return (
    getFirstField(result, "identifier") ||
    getFirstField(result, "cftId") ||
    getFirstField(result, "callIdentifier") ||
    cleanText(result.reference) ||
    cleanText(result.url)
  );
}

function languageScore(result) {
  const language =
    cleanText(
      result.language ||
      metadata(result).language
    ).toLowerCase();

  if (
    language === "en" ||
    language === "eng"
  ) {
    return 10;
  }

  return 0;
}

function completenessScore(result) {
  const m = metadata(result);

  const fields = [
    "title",
    "description",
    "callIdentifier",
    "deadlineDate",
    "closingDate",
    "mainCpv",
    "cftEstimatedTotalProcedureValue",
    "cftLeadContractingAuthorityCode",
    "cftDocuments",
    "lots"
  ];

  return fields.reduce(
    (score, field) =>
      score +
      (
        cleanText(m[field])
          ? 1
          : 0
      ),
    0
  );
}

function deduplicateResults(results) {
  const map = new Map();

  for (const result of results) {
    const key =
      getCanonicalId(result);

    if (!key) {
      continue;
    }

    if (!map.has(key)) {
      map.set(
        key,
        result
      );

      continue;
    }

    const existing =
      map.get(key);

    const existingScore =
      languageScore(existing) * 100 +
      completenessScore(existing);

    const candidateScore =
      languageScore(result) * 100 +
      completenessScore(result);

    if (
      candidateScore >
      existingScore
    ) {
      map.set(
        key,
        result
      );
    }
  }

  return Array.from(
    map.values()
  );
}

// ======================================================
// CALL IDENTIFIER HELPERS
// ======================================================

function normalizeCallIdentifier(value) {
  return cleanText(value)
    .toUpperCase()
    .trim();
}

function getBaseProcedureIdentifier(callIdentifier) {
  let value =
    normalizeCallIdentifier(
      callIdentifier
    );

  if (!value) {
    return "";
  }

  value = value
    .replace(/-PIN$/i, "")
    .replace(/\/PIN$/i, "")
    .replace(/-PRIOR$/i, "")
    .replace(/\/PRIOR$/i, "");

  return value;
}

function isPlanningIdentifier(callIdentifier) {
  const value =
    normalizeCallIdentifier(
      callIdentifier
    );

  return (
    value.endsWith("-PIN") ||
    value.endsWith("/PIN") ||
    value.includes("-PIN-")
  );
}

function buildPublishedProcedureSet(results) {
  const set =
    new Set();

  for (const result of results) {
    const callIdentifier =
      getFirstField(
        result,
        "callIdentifier"
      );

    if (!callIdentifier) {
      continue;
    }

    if (
      isPlanningIdentifier(
        callIdentifier
      )
    ) {
      continue;
    }

    const base =
      getBaseProcedureIdentifier(
        callIdentifier
      );

    if (base) {
      set.add(base);
    }
  }

  return set;
}

// ======================================================
// DOCUMENT EXTRACTION
// ======================================================

function extractDocuments(result) {
  const raw =
    first(
      metadata(result).cftDocuments
    );

  const parsed =
    safeJsonParse(raw);

  if (!parsed) {
    return [];
  }

  const docs =
    Array.isArray(parsed)
      ? parsed
      : (
        parsed.cftDocuments ||
        []
      );

  const output = [];

  for (const doc of docs) {
    if (!doc) {
      continue;
    }

    const refs =
      doc.hermesDocumentReferences ||
      [];

    if (
      refs.length === 0
    ) {
      output.push({
        title:
          cleanText(
            doc.documentTitle
          ),

        type:
          cleanText(
            doc.documentType
          ),

        filename: "",

        publicationDate: "",

        currentVersion: "",

        obsolete:
          doc.obsolete === true
            ? "YES"
            : "NO"
      });

      continue;
    }

    for (const ref of refs) {
      if (!ref) {
        continue;
      }

      output.push({
        title:
          cleanText(
            doc.documentTitle
          ),

        type:
          cleanText(
            doc.documentType
          ),

        filename:
          cleanText(
            ref.documentFileName
          ),

        publicationDate:
          cleanText(
            ref.publicationDate
          ),

        currentVersion:
          cleanText(
            ref.isCurrentVersion
          ),

        obsolete:
          doc.obsolete === true
            ? "YES"
            : "NO"
      });
    }
  }

  return output;
}

function documentTitles(result) {
  return extractDocuments(result)
    .map(x => x.title)
    .filter(Boolean)
    .join("\n");
}

function documentFiles(result) {
  return extractDocuments(result)
    .map(x => x.filename)
    .filter(Boolean)
    .join("\n");
}

function documentTypes(result) {
  return extractDocuments(result)
    .map(x => x.type)
    .filter(Boolean)
    .join("\n");
}

function documentCount(result) {
  return extractDocuments(result)
    .length;
}

// ======================================================
// LOT EXTRACTION
// ======================================================

function extractLots(result) {
  const raw =
    first(
      metadata(result).lots
    );

  const parsed =
    safeJsonParse(raw);

  if (!parsed) {
    return [];
  }

  if (Array.isArray(parsed)) {
    return parsed.filter(Boolean);
  }

  if (
    Array.isArray(
      parsed.procurementProjectLots
    )
  ) {
    return parsed
      .procurementProjectLots
      .filter(Boolean);
  }

  return [];
}

function getLotCount(result) {
  return extractLots(result)
    .length;
}

// ======================================================
// AUTHORITY
// ======================================================

function getAuthority(result) {
  const raw =
    first(
      metadata(result)
        .cftLeadContractingAuthorityCode
    );

  if (!raw) {
    return "";
  }

  const parsed =
    safeJsonParse(raw);

  if (
    Array.isArray(parsed)
  ) {
    return parsed
      .filter(Boolean)
      .map(x =>
        cleanText(
          x.name ||
          x
        )
      )
      .filter(Boolean)
      .join("\n");
  }

  return cleanText(raw);
}

// ======================================================
// TED NOTICE
// ======================================================

function getTedNotice(result) {
  const raw =
    first(
      metadata(result)
        .cftContractNoticeLink
    );

  if (!raw) {
    return "";
  }

  const parsed =
    safeJsonParse(raw);

  if (
    Array.isArray(parsed)
  ) {
    return parsed
      .filter(
        item =>
          item !== null &&
          item !== undefined
      )
      .map(item => {
        if (
          typeof item ===
          "string"
        ) {
          return item;
        }

        if (
          typeof item ===
          "object"
        ) {
          return (
            item.publicationReference ||
            item.link ||
            item.noticeType ||
            JSON.stringify(item)
          );
        }

        return String(item);
      })
      .filter(Boolean)
      .join("\n");
  }

  if (
    parsed &&
    typeof parsed ===
    "object"
  ) {
    return (
      parsed.publicationReference ||
      parsed.link ||
      parsed.noticeType ||
      JSON.stringify(parsed)
    );
  }

  return cleanText(raw);
}

// ======================================================
// DATE HELPERS
// ======================================================

function parseDate(value) {
  const raw =
    cleanText(value);

  if (!raw) {
    return null;
  }

  const parsed =
    new Date(raw);

  if (
    !isNaN(
      parsed.getTime()
    )
  ) {
    return parsed;
  }

  // European format dd/mm/yyyy
  const match =
    raw.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})/
    );

  if (match) {
    const day =
      Number(match[1]);

    const month =
      Number(match[2]);

    const year =
      Number(match[3]);

    const european =
      new Date(
        year,
        month - 1,
        day,
        23,
        59,
        59
      );

    if (
      !isNaN(
        european.getTime()
      )
    ) {
      return european;
    }
  }

  return null;
}

function getCanonicalDeadline(result) {
  const deadline =
    getFirstField(
      result,
      "deadlineDate"
    );

  const closing =
    getFirstField(
      result,
      "closingDate"
    );

  return (
    deadline ||
    closing ||
    ""
  );
}

function getPlanningDate(result) {
  return (
    getFirstField(
      result,
      "cftPlannedDate"
    ) ||
    getFirstField(
      result,
      "indicativeLaunch"
    ) ||
    ""
  );
}

// ======================================================
// CANCELLED DETECTION
// ======================================================

function isCancelled(result) {
  const combined = [
    getFirstField(
      result,
      "title"
    ),

    getFirstField(
      result,
      "description"
    ),

    getField(
      result,
      "cftPublicationDisplayStatus"
    ),

    getField(
      result,
      "cftCorrigendaList"
    )
  ]
    .join(" ")
    .toLowerCase();

  const cancellationTerms = [
    "cancelled after publication",
    "canceled after publication",
    "procedure cancelled",
    "procedure canceled",
    "call cancelled",
    "call canceled",
    "procurement cancelled",
    "procurement canceled"
  ];

  return cancellationTerms.some(
    term =>
      combined.includes(term)
  );
}

// ======================================================
// STATUS
// ======================================================

function getStatusAtDownload(
  result,
  publishedProcedureSet
) {
  const now =
    new Date();

  const callIdentifier =
    getFirstField(
      result,
      "callIdentifier"
    );

  const baseIdentifier =
    getBaseProcedureIdentifier(
      callIdentifier
    );

  const planningIdentifier =
    isPlanningIdentifier(
      callIdentifier
    );

  if (
    isCancelled(result)
  ) {
    return "CANCELLED";
  }

  if (
    planningIdentifier &&
    baseIdentifier &&
    publishedProcedureSet.has(
      baseIdentifier
    )
  ) {
    return "SUPERSEDED BY PUBLISHED PROCEDURE";
  }

  const submissions =
    getFirstField(
      result,
      "cftSubmissionsAllowed"
    ).toLowerCase();

  const deadlineText =
    getCanonicalDeadline(
      result
    );

  const deadline =
    parseDate(
      deadlineText
    );

  const planningDateText =
    getPlanningDate(
      result
    );

  const planningDate =
    parseDate(
      planningDateText
    );

  if (
    submissions === "true" &&
    (
      !deadline ||
      deadline.getTime() >=
        now.getTime()
    )
  ) {
    return "OPEN";
  }

  if (
    deadline &&
    deadline.getTime() >=
      now.getTime()
  ) {
    return "OPEN";
  }

  if (
    planningDate
  ) {
    if (
      planningDate.getTime() >=
        now.getTime()
    ) {
      return "FORTHCOMING / PLANNED";
    }

    return "PLANNING NOTICE - PLANNED DATE PASSED";
  }

  if (
    deadline &&
    deadline.getTime() <
      now.getTime()
  ) {
    return "CLOSED / DEADLINE EXPIRED";
  }

  if (
    submissions === "false"
  ) {
    return "CLOSED / SUBMISSIONS NOT ALLOWED";
  }

  return "STATUS NOT DETERMINED";
}

// ======================================================
// SPACE / DEFENCE CLASSIFICATION
// ======================================================

function classifySector(result) {
  const combined = [
    getFirstField(
      result,
      "title"
    ),

    getFirstField(
      result,
      "description"
    ),

    getField(
      result,
      "mainCpv"
    ),

    getField(
      result,
      "additionalCpvs"
    )
  ]
    .join(" ")
    .toLowerCase();

  const spaceTerms = [
    "space",
    "satellite",
    "galileo",
    "egnos",
    "copernicus",
    "iris2",
    "iris²",
    "gnss",
    "navigation",
    "earth observation",
    "satcom",
    "launcher",
    "launch service",
    "space surveillance",
    "space situational",
    "sst",
    "orbit",
    "orbital",
    "spacecraft"
  ];

  const defenceTerms = [
    "defence",
    "defense",
    "military",
    "weapon",
    "ammunition",
    "munition",
    "missile",
    "armed forces",
    "security",
    "cyber",
    "surveillance",
    "command and control",
    "c4isr",
    "intelligence"
  ];

  const hasSpace =
    spaceTerms.some(
      x =>
        combined.includes(x)
    );

  const hasDefence =
    defenceTerms.some(
      x =>
        combined.includes(x)
    );

  if (
    hasSpace &&
    hasDefence
  ) {
    return "Dual-use";
  }

  if (hasSpace) {
    return "Space";
  }

  if (hasDefence) {
    return "Defence";
  }

  return "Other";
}

function classifySpaceRelevance(result) {
  const sector =
    classifySector(result);

  if (
    sector === "Space" ||
    sector === "Dual-use"
  ) {
    return "High";
  }

  const combined = [
    getFirstField(
      result,
      "title"
    ),

    getFirstField(
      result,
      "description"
    )
  ]
    .join(" ")
    .toLowerCase();

  const terms = [
    "cyber",
    "secure communication",
    "quantum",
    "resilience",
    "surveillance",
    "navigation",
    "positioning",
    "timing",
    "remote sensing",
    "critical infrastructure",
    "autonomous systems"
  ];

  if (
    terms.some(
      x =>
        combined.includes(x)
    )
  ) {
    return "Medium";
  }

  return "Low";
}

// ======================================================
// RAG TEXT
// ======================================================

function createRagText(
  result,
  publishedProcedureSet
) {
  const parts = [];

  const callIdentifier =
    getFirstField(
      result,
      "callIdentifier"
    );

  const title =
    getFirstField(
      result,
      "title"
    ) ||
    cleanText(
      result.summary
    );

  const description =
    getFirstField(
      result,
      "description"
    );

  const authority =
    getAuthority(result);

  const publicationDate =
    getFirstField(
      result,
      "cftPublicationDateEForm"
    ) ||
    getFirstField(
      result,
      "startDate"
    );

  const deadline =
    getCanonicalDeadline(
      result
    );

  const planningDate =
    getPlanningDate(
      result
    );

  const status =
    getStatusAtDownload(
      result,
      publishedProcedureSet
    );

  const submissions =
    getFirstField(
      result,
      "cftSubmissionsAllowed"
    );

  const cpv =
    getField(
      result,
      "mainCpv"
    );

  const estimatedValue =
    getFirstField(
      result,
      "cftEstimatedTotalProcedureValue"
    ) ||
    getFirstField(
      result,
      "cftEstimatedOverallContractAmount"
    );

  const procedureType =
    getFirstField(
      result,
      "procedureType"
    );

  const procurementType =
    getFirstField(
      result,
      "cftProcurementType"
    ) ||
    getFirstField(
      result,
      "contractType"
    );

  const tedNotice =
    getTedNotice(result);

  const docTitles =
    documentTitles(result);

  const docFiles =
    documentFiles(result);

  const portalUrl =
    cleanText(
      result.url ||
      getFirstField(
        result,
        "url"
      )
    );

  if (title) {
    parts.push(
      `Procurement: ${title}`
    );
  }

  if (callIdentifier) {
    parts.push(
      `Call identifier: ${callIdentifier}`
    );
  }

  if (authority) {
    parts.push(
      `Contracting authority: ${authority}`
    );
  }

  if (description) {
    parts.push(
      `Description: ${description}`
    );
  }

  if (publicationDate) {
    parts.push(
      `Publication date: ${publicationDate}`
    );
  }

  if (deadline) {
    parts.push(
      `Canonical deadline: ${deadline}`
    );
  }

  if (planningDate) {
    parts.push(
      `Planned or indicative launch date: ${planningDate}`
    );
  }

  parts.push(
    `Status at download: ${status}`
  );

  if (submissions) {
    parts.push(
      `Submissions allowed: ${submissions}`
    );
  }

  if (cpv) {
    parts.push(
      `CPV: ${cpv}`
    );
  }

  if (estimatedValue) {
    parts.push(
      `Estimated value: ${estimatedValue}`
    );
  }

  if (procedureType) {
    parts.push(
      `Procedure type code: ${procedureType}`
    );
  }

  if (procurementType) {
    parts.push(
      `Procurement type code: ${procurementType}`
    );
  }

  if (tedNotice) {
    parts.push(
      `Related TED notice: ${tedNotice}`
    );
  }

  if (docTitles) {
    parts.push(
      `Procurement documents: ${docTitles}`
    );
  }

  if (docFiles) {
    parts.push(
      `Document files: ${docFiles}`
    );
  }

  parts.push(
    `Sector classification: ${classifySector(result)}`
  );

  parts.push(
    `Space relevance: ${classifySpaceRelevance(result)}`
  );

  if (portalUrl) {
    parts.push(
      `Funding & Tenders Portal: ${portalUrl}`
    );
  }

  return parts.join("\n");
}

// ======================================================
// API
// ======================================================

async function searchPage(
  searchTerm,
  pageNumber
) {
  let attempt = 1;

  while (true) {
    try {
      const query = {
        bool: {
          must: [
            {
              terms: {
                type: ["0"]
              }
            }
          ]
        }
      };

      const form =
        new FormData();

      form.append(
        "query",
        new Blob(
          [
            JSON.stringify(
              query
            )
          ],
          {
            type:
              "application/json"
          }
        ),
        "query.json"
      );

      form.append(
        "pageNumber",
        String(pageNumber)
      );

      form.append(
        "pageSize",
        String(PAGE_SIZE)
      );

      form.append(
        "language",
        "en"
      );

      form.append(
        "text",
        searchTerm
      );

      const response =
        await axios.post(
          API_URL,
          form,
          {
            timeout: 60000
          }
        );

      return response.data;

    } catch (error) {
      console.log("");
      console.log(
        `API error. Search "${searchTerm}", page ${pageNumber}, attempt ${attempt}.`
      );

      if (error.response) {
        console.log(
          `HTTP status: ${error.response.status}`
        );

        console.log(
          JSON.stringify(
            error.response.data,
            null,
            2
          )
        );
      } else {
        console.log(
          error.message
        );
      }

      attempt++;

      console.log(
        "Waiting 10 seconds..."
      );

      await sleep(
        10000
      );
    }
  }
}

// ======================================================
// CHECKPOINT
// ======================================================

function saveCheckpoint(data) {
  fs.writeFileSync(
    CHECKPOINT_FILE,
    JSON.stringify(
      {
        savedAt:
          new Date()
            .toISOString(),

        ...data
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(
    "CHECKPOINT SAVED"
  );
}

function loadCheckpoint() {
  if (
    !fs.existsSync(
      CHECKPOINT_FILE
    )
  ) {
    return null;
  }

  try {
    return JSON.parse(
      fs.readFileSync(
        CHECKPOINT_FILE,
        "utf8"
      )
    );
  } catch {
    return null;
  }
}

// ======================================================
// DOWNLOAD
// ======================================================

async function downloadAll() {
  let termIndex = 0;
  let pageNumber = 1;
  let matchedResults = [];

  const checkpoint =
    loadCheckpoint();

  if (checkpoint) {
    termIndex =
      checkpoint.termIndex ||
      0;

    pageNumber =
      checkpoint.pageNumber ||
      1;

    matchedResults =
      checkpoint.matchedResults ||
      [];

    console.log("");
    console.log(
      "CHECKPOINT FOUND"
    );

    console.log(
      `Already retained: ${matchedResults.length}`
    );
  }

  for (
    ;
    termIndex <
      SEARCH_TERMS.length;
    termIndex++
  ) {
    const searchTerm =
      SEARCH_TERMS[
        termIndex
      ];

    console.log("");
    console.log(
      "========================================"
    );

    console.log(
      `SEARCH ${termIndex + 1} / ${SEARCH_TERMS.length}`
    );

    console.log(
      searchTerm
    );

    console.log(
      "========================================"
    );

    let currentPage =
      pageNumber || 1;

    let totalPages =
      null;

    while (true) {
      console.log(
        `Downloading page ${currentPage}...`
      );

      const data =
        await searchPage(
          searchTerm,
          currentPage
        );

      const results =
        data.results ||
        [];

      const totalResults =
        Number(
          data.totalResults ||
          0
        );

      if (
        totalPages === null
      ) {
        totalPages =
          Math.max(
            1,
            Math.ceil(
              totalResults /
              PAGE_SIZE
            )
          );

        console.log(
          `Portal reports ${totalResults} raw search results.`
        );

        console.log(
          `Pages: ${totalPages}`
        );
      }

      if (
        results.length === 0
      ) {
        break;
      }

      const defis =
        results.filter(
          isDefisResult
        );

      matchedResults.push(
        ...defis
      );

      console.log(
        `Received ${results.length}; genuine DG DEFIS on this page: ${defis.length}; retained raw total: ${matchedResults.length}`
      );

      if (
        currentPage >=
        totalPages
      ) {
        break;
      }

      currentPage++;

      saveCheckpoint({
        termIndex,
        pageNumber:
          currentPage,
        matchedResults
      });

      await sleep(
        300
      );
    }

    pageNumber = 1;

    saveCheckpoint({
      termIndex:
        termIndex + 1,
      pageNumber: 1,
      matchedResults
    });
  }

  return matchedResults;
}

// ======================================================
// NORMALISE
// ======================================================

function normaliseResult(
  result,
  publishedProcedureSet
) {
  const callIdentifier =
    getFirstField(
      result,
      "callIdentifier"
    );

  return {
    identifier:
      getCanonicalId(
        result
      ),

    callIdentifier,

    baseProcedureIdentifier:
      getBaseProcedureIdentifier(
        callIdentifier
      ),

    title:
      getFirstField(
        result,
        "title"
      ) ||
      cleanText(
        result.summary
      ),

    description:
      getFirstField(
        result,
        "description"
      ),

    language:
      cleanText(
        result.language
      ),

    contractingAuthority:
      getAuthority(
        result
      ),

    publicationDate:
      getFirstField(
        result,
        "cftPublicationDateEForm"
      ) ||
      getFirstField(
        result,
        "startDate"
      ),

    startDate:
      getFirstField(
        result,
        "startDate"
      ),

    updateDate:
      getFirstField(
        result,
        "updateDate"
      ),

    deadlineDate:
      getFirstField(
        result,
        "deadlineDate"
      ),

    closingDate:
      getFirstField(
        result,
        "closingDate"
      ),

    canonicalDeadline:
      getCanonicalDeadline(
        result
      ),

    submissionsAllowed:
      getFirstField(
        result,
        "cftSubmissionsAllowed"
      ),

    statusCode:
      getFirstField(
        result,
        "status"
      ),

    sortStatus:
      getFirstField(
        result,
        "sortStatus"
      ),

    statusAtDownload:
      getStatusAtDownload(
        result,
        publishedProcedureSet
      ),

    plannedDate:
      getFirstField(
        result,
        "cftPlannedDate"
      ),

    indicativeLaunch:
      getFirstField(
        result,
        "indicativeLaunch"
      ),

    mainCpv:
      getField(
        result,
        "mainCpv"
      ),

    additionalCpvs:
      getField(
        result,
        "additionalCpvs"
      ),

    estimatedTotalProcedureValue:
      getFirstField(
        result,
        "cftEstimatedTotalProcedureValue"
      ),

    estimatedContractAmount:
      getFirstField(
        result,
        "cftEstimatedOverallContractAmount"
      ),

    estimatedCurrency:
      getFirstField(
        result,
        "cftEstimatedOverallContractCurrency"
      ),

    procedureTypeCode:
      getFirstField(
        result,
        "procedureType"
      ),

    procurementTypeCode:
      getFirstField(
        result,
        "cftProcurementType"
      ),

    contractTypeCode:
      getFirstField(
        result,
        "contractType"
      ),

    submissionMethod:
      getFirstField(
        result,
        "cftSubmissionMethodCode"
      ),

    questionsAnswersAllowed:
      getFirstField(
        result,
        "cftQuestionsAnswersAllowed"
      ),

    subscriptionsAllowed:
      getFirstField(
        result,
        "cftSubscriptionsAllowed"
      ),

    timezone:
      getFirstField(
        result,
        "cftTimezone"
      ),

    lotCount:
      getLotCount(
        result
      ),

    documentCount:
      documentCount(
        result
      ),

    documentTitles:
      documentTitles(
        result
      ),

    documentTypes:
      documentTypes(
        result
      ),

    documentFiles:
      documentFiles(
        result
      ),

    tedNotice:
      getTedNotice(
        result
      ),

    sector:
      classifySector(
        result
      ),

    spaceRelevance:
      classifySpaceRelevance(
        result
      ),

    portalUrl:
      cleanText(
        result.url ||
        getFirstField(
          result,
          "url"
        )
      ),

    ragText:
      createRagText(
        result,
        publishedProcedureSet
      )
  };
}

// ======================================================
// EXCEL
// ======================================================

function createSheet(
  workbook,
  name,
  records
) {
  const sheet =
    workbook.addWorksheet(
      name,
      {
        views: [
          {
            state:
              "frozen",
            ySplit: 1
          }
        ]
      }
    );

  const columns = [
    ["identifier", 40],
    ["callIdentifier", 28],
    ["baseProcedureIdentifier", 32],
    ["title", 70],
    ["description", 90],
    ["language", 12],
    ["contractingAuthority", 60],
    ["publicationDate", 24],
    ["startDate", 24],
    ["updateDate", 24],
    ["deadlineDate", 26],
    ["closingDate", 26],
    ["canonicalDeadline", 26],
    ["submissionsAllowed", 20],
    ["statusCode", 16],
    ["sortStatus", 14],
    ["statusAtDownload", 40],
    ["plannedDate", 24],
    ["indicativeLaunch", 24],
    ["mainCpv", 30],
    ["additionalCpvs", 40],
    ["estimatedTotalProcedureValue", 30],
    ["estimatedContractAmount", 24],
    ["estimatedCurrency", 18],
    ["procedureTypeCode", 22],
    ["procurementTypeCode", 24],
    ["contractTypeCode", 22],
    ["submissionMethod", 22],
    ["questionsAnswersAllowed", 24],
    ["subscriptionsAllowed", 22],
    ["timezone", 20],
    ["lotCount", 12],
    ["documentCount", 16],
    ["documentTitles", 70],
    ["documentTypes", 50],
    ["documentFiles", 80],
    ["tedNotice", 60],
    ["sector", 16],
    ["spaceRelevance", 18],
    ["portalUrl", 70],
    ["ragText", 100]
  ];

  sheet.columns =
    columns.map(
      ([key, width]) => ({
        header: key,
        key,
        width
      })
    );

  for (const record of records) {
    sheet.addRow(record);
  }

  const header =
    sheet.getRow(1);

  header.height = 30;

  header.eachCell(cell => {
    cell.font = {
      bold: true,
      color: {
        argb:
          "FFFFFFFF"
      }
    };

    cell.fill = {
      type:
        "pattern",
      pattern:
        "solid",
      fgColor: {
        argb:
          "FF1F4E78"
      }
    };

    cell.alignment = {
      horizontal:
        "center",
      vertical:
        "middle",
      wrapText:
        true
    };
  });

  sheet.autoFilter = {
    from: {
      row: 1,
      column: 1
    },
    to: {
      row: 1,
      column:
        sheet.columns.length
    }
  };

  sheet.eachRow(
    (row, number) => {
      if (number === 1) {
        return;
      }

      row.height = 45;

      row.eachCell(cell => {
        cell.alignment = {
          vertical:
            "top",
          wrapText:
            true
        };
      });
    }
  );

  return sheet;
}

// ======================================================
// MAIN
// ======================================================

async function main() {
  try {
    if (
      !fs.existsSync(
        OUTPUT_FOLDER
      )
    ) {
      fs.mkdirSync(
        OUTPUT_FOLDER,
        {
          recursive: true
        }
      );
    }

    console.log("");
    console.log(
      "DG DEFIS FUNDING & TENDERS DOWNLOADER"
    );

    const raw =
      await downloadAll();

    console.log("");
    console.log(
      `Raw DG DEFIS matches: ${raw.length}`
    );

    const unique =
      deduplicateResults(
        raw
      );

    console.log(
      `Unique DG DEFIS tenders: ${unique.length}`
    );

    const publishedProcedureSet =
      buildPublishedProcedureSet(
        unique
      );

    const records =
      unique
        .map(
          result =>
            normaliseResult(
              result,
              publishedProcedureSet
            )
        )
        .sort(
          (a, b) =>
            String(
              b.publicationDate
            ).localeCompare(
              String(
                a.publicationDate
              )
            )
        );

    const open =
      records.filter(
        x =>
          x.statusAtDownload ===
          "OPEN"
      );

    const planned =
      records.filter(
        x =>
          x.statusAtDownload ===
          "FORTHCOMING / PLANNED"
      );

    const superseded =
      records.filter(
        x =>
          x.statusAtDownload ===
          "SUPERSEDED BY PUBLISHED PROCEDURE"
      );

    const pastPlanning =
      records.filter(
        x =>
          x.statusAtDownload ===
          "PLANNING NOTICE - PLANNED DATE PASSED"
      );

    const cancelled =
      records.filter(
        x =>
          x.statusAtDownload ===
          "CANCELLED"
      );

    const closed =
      records.filter(
        x =>
          x.statusAtDownload.startsWith(
            "CLOSED"
          )
      );

    const undetermined =
      records.filter(
        x =>
          x.statusAtDownload ===
          "STATUS NOT DETERMINED"
      );

    const workbook =
      new ExcelJS.Workbook();

    workbook.creator =
      "DG DEFIS Funding & Tenders Downloader";

    workbook.created =
      new Date();

    createSheet(
      workbook,
      "All DG DEFIS Tenders",
      records
    );

    createSheet(
      workbook,
      "Open",
      open
    );

    createSheet(
      workbook,
      "Forthcoming Planned",
      planned
    );

    createSheet(
      workbook,
      "Superseded PINs",
      superseded
    );

    createSheet(
      workbook,
      "Past Planning Notices",
      pastPlanning
    );

    createSheet(
      workbook,
      "Cancelled",
      cancelled
    );

    createSheet(
      workbook,
      "Closed",
      closed
    );

    createSheet(
      workbook,
      "Status Undetermined",
      undetermined
    );

    const today =
      new Date()
        .toISOString()
        .slice(0, 10);

    const filename =
      `EC_DG_DEFIS_Funding_Tenders_${today}.xlsx`;

    const fullPath =
      path.join(
        OUTPUT_FOLDER,
        filename
      );

    console.log("");
    console.log(
      "Creating Excel..."
    );

    await workbook.xlsx.writeFile(
      fullPath
    );

    console.log("");
    console.log("DONE");
    console.log("");

    console.log(
      `Total unique DG DEFIS tenders: ${records.length}`
    );

    console.log(
      `Open: ${open.length}`
    );

    console.log(
      `Forthcoming / Planned: ${planned.length}`
    );

    console.log(
      `Superseded PINs: ${superseded.length}`
    );

    console.log(
      `Past planning notices: ${pastPlanning.length}`
    );

    console.log(
      `Cancelled: ${cancelled.length}`
    );

    console.log(
      `Closed: ${closed.length}`
    );

    console.log(
      `Status undetermined: ${undetermined.length}`
    );

    console.log(
      `Space: ${
        records.filter(
          x =>
            x.sector ===
            "Space"
        ).length
      }`
    );

    console.log(
      `Dual-use: ${
        records.filter(
          x =>
            x.sector ===
            "Dual-use"
        ).length
      }`
    );

    console.log(
      `Defence: ${
        records.filter(
          x =>
            x.sector ===
            "Defence"
        ).length
      }`
    );

    console.log("");
    console.log(
      "File created:"
    );

    console.log(
      fullPath
    );

    if (
      fs.existsSync(
        CHECKPOINT_FILE
      )
    ) {
      fs.unlinkSync(
        CHECKPOINT_FILE
      );

      console.log("");
      console.log(
        "Checkpoint deleted."
      );
    }

  } catch (error) {
    console.error("");
    console.error(
      "FINAL ERROR:"
    );

    console.error(
      error.stack ||
      error.message
    );

    console.log("");
    console.log(
      "Checkpoint preserved."
    );
  }
}

main();