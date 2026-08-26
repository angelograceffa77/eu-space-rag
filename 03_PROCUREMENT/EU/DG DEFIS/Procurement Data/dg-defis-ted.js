const axios = require("axios");
const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");

const API_URL = "https://api.ted.europa.eu/v3/notices/search";

const OUTPUT_FOLDER =
  "C:\\Users\\angel\\OneDrive\\Desktop\\knowledge\\eu-space-rag\\03_PROCUREMENT\\EU\\DG DEFIS\\Procurement Data";

const CHECKPOINT_FILE = path.join(
  OUTPUT_FOLDER,
  "dg-defis-ted-checkpoint.json"
);

const PAGE_SIZE = 100;

const BUYER_QUERIES = [
  'buyer-name = "European Commission, DG DEFIS - Defence Industry and Space"',
  'buyer-name = "European Commission, Directorate-General for Defence Industry and Space"',
  'buyer-name = "European Commission, Directorate-General for Defence Industry and Space (DEFIS)"'
];

const TED_FIELDS = [
  "publication-number",
  "publication-date",
  "notice-identifier",
  "notice-title",
  "form-type",
  "notice-type",

  "buyer-name",
  "buyer-identifier",
  "buyer-partname",
  "buyer-country",

  "procedure-identifier",
  "internal-identifier-proc",
  "title-proc",
  "description-proc",
  "procedure-type",
  "contract-nature",

  "classification-cpv",

  "estimated-value-proc",
  "estimated-value-cur-proc",

  "deadline-receipt-tender-date-lot",
  "deadline-receipt-tender-time-lot",

  "winner-name",
  "winner-identifier",

  "tender-value",
  "tender-value-cur",

  "contract-identifier",
  "contract-title",
  "contract-conclusion-date",

  "total-value",
  "total-value-cur"
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ======================================================
// BASIC HELPERS
// ======================================================

function valueToText(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return "";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value
      .map(valueToText)
      .filter(Boolean)
      .join("\n");
  }

  if (typeof value === "object") {
    if (value.eng !== undefined) {
      return valueToText(value.eng);
    }

    if (value.EN !== undefined) {
      return valueToText(value.EN);
    }

    return Object.values(value)
      .map(valueToText)
      .filter(Boolean)
      .join("\n");
  }

  return String(value);
}

function cleanText(value) {
  return valueToText(value)
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

function getTedUrl(notice) {
  const publicationNumber =
    cleanText(
      notice["publication-number"]
    );

  if (!publicationNumber) {
    return "";
  }

  return `https://ted.europa.eu/en/notice/-/detail/${publicationNumber}`;
}

function getTedPdfUrl(notice) {
  const publicationNumber =
    cleanText(
      notice["publication-number"]
    );

  if (!publicationNumber) {
    return "";
  }

  return `https://ted.europa.eu/en/notice/${publicationNumber}/pdf`;
}

function getTedXmlUrl(notice) {
  const publicationNumber =
    cleanText(
      notice["publication-number"]
    );

  if (!publicationNumber) {
    return "";
  }

  return `https://ted.europa.eu/en/notice/${publicationNumber}/xml`;
}

// ======================================================
// PROCEDURE GROUPING
// ======================================================

function getProcedureGroupKey(notice) {
  const procedureIdentifier =
    cleanText(
      notice["procedure-identifier"]
    );

  if (procedureIdentifier) {
    return `PROCEDURE:${procedureIdentifier}`;
  }

  const internalReference =
    cleanText(
      notice["internal-identifier-proc"]
    );

  if (internalReference) {
    return `INTERNAL:${internalReference}`;
  }

  const title =
    cleanText(
      notice["title-proc"]
    ) ||
    cleanText(
      notice["notice-title"]
    );

  if (title) {
    return `TITLE:${title.toLowerCase()}`;
  }

  const publicationNumber =
    cleanText(
      notice["publication-number"]
    );

  return `NOTICE:${publicationNumber}`;
}

function parsePublicationDate(value) {
  const text =
    cleanText(value);

  if (!text) {
    return null;
  }

  const normalized =
    text
      .replace(/Z$/, "")
      .substring(0, 10);

  const parsed =
    new Date(
      `${normalized}T00:00:00`
    );

  if (
    isNaN(
      parsed.getTime()
    )
  ) {
    return null;
  }

  return parsed;
}

function buildLatestNoticeMap(notices) {
  const map =
    new Map();

  for (
    const notice of notices
  ) {
    const key =
      getProcedureGroupKey(
        notice
      );

    const publicationDate =
      parsePublicationDate(
        notice[
          "publication-date"
        ]
      );

    const publicationNumber =
      cleanText(
        notice[
          "publication-number"
        ]
      );

    if (!map.has(key)) {
      map.set(
        key,
        {
          publicationDate,
          publicationNumber
        }
      );

      continue;
    }

    const current =
      map.get(key);

    const currentTime =
      current.publicationDate
        ? current.publicationDate.getTime()
        : 0;

    const candidateTime =
      publicationDate
        ? publicationDate.getTime()
        : 0;

    if (
      candidateTime >
      currentTime
    ) {
      map.set(
        key,
        {
          publicationDate,
          publicationNumber
        }
      );

      continue;
    }

    if (
      candidateTime ===
        currentTime &&
      publicationNumber >
        current.publicationNumber
    ) {
      map.set(
        key,
        {
          publicationDate,
          publicationNumber
        }
      );
    }
  }

  return map;
}

function isLatestNotice(
  notice,
  latestNoticeMap
) {
  const key =
    getProcedureGroupKey(
      notice
    );

  const latest =
    latestNoticeMap.get(
      key
    );

  if (!latest) {
    return "YES";
  }

  const publicationNumber =
    cleanText(
      notice[
        "publication-number"
      ]
    );

  return (
    publicationNumber ===
    latest.publicationNumber
  )
    ? "YES"
    : "NO";
}

function getLatestPublicationDate(
  notice,
  latestNoticeMap
) {
  const key =
    getProcedureGroupKey(
      notice
    );

  const latest =
    latestNoticeMap.get(
      key
    );

  if (
    !latest ||
    !latest.publicationDate
  ) {
    return "";
  }

  return latest.publicationDate
    .toISOString()
    .slice(0, 10);
}

// ======================================================
// DEADLINE HELPERS
// ======================================================

function splitValues(value) {
  const text =
    cleanText(value);

  if (!text) {
    return [];
  }

  return text
    .split("\n")
    .map(x => x.trim())
    .filter(Boolean);
}

function parseDeadline(
  dateText,
  timeText = ""
) {
  if (!dateText) {
    return null;
  }

  const date =
    dateText.substring(
      0,
      10
    );

  let time =
    timeText.trim();

  if (!time) {
    time =
      "23:59:59";
  }

  if (
    /^\d{2}:\d{2}$/.test(
      time
    )
  ) {
    time += ":00";
  }

  const parsed =
    new Date(
      `${date}T${time}`
    );

  if (
    isNaN(
      parsed.getTime()
    )
  ) {
    return null;
  }

  return parsed;
}

function getCanonicalDeadline(
  notice
) {
  const dates =
    splitValues(
      notice[
        "deadline-receipt-tender-date-lot"
      ]
    );

  const times =
    splitValues(
      notice[
        "deadline-receipt-tender-time-lot"
      ]
    );

  if (
    dates.length === 0
  ) {
    return "";
  }

  const candidates = [];

  for (
    let i = 0;
    i < dates.length;
    i++
  ) {
    const date =
      dates[i];

    const time =
      times[i] ||
      times[0] ||
      "";

    const parsed =
      parseDeadline(
        date,
        time
      );

    if (parsed) {
      candidates.push({
        date,
        time,
        parsed
      });
    }
  }

  if (
    candidates.length === 0
  ) {
    return dates[0];
  }

  candidates.sort(
    (a, b) =>
      b.parsed.getTime() -
      a.parsed.getTime()
  );

  const selected =
    candidates[0];

  if (selected.time) {
    return (
      `${selected.date} ${selected.time}`
    );
  }

  return selected.date;
}

function getCanonicalDeadlineDate(
  notice
) {
  const canonical =
    getCanonicalDeadline(
      notice
    );

  if (!canonical) {
    return null;
  }

  const parts =
    canonical.split(
      /\s+/
    );

  return parseDeadline(
    parts[0],
    parts[1] || ""
  );
}

// ======================================================
// STATUS AT DOWNLOAD
// ======================================================

function getStatusAtDownload(
  notice
) {
  const formType =
    cleanText(
      notice[
        "form-type"
      ]
    ).toLowerCase();

  const deadline =
    getCanonicalDeadlineDate(
      notice
    );

  const now =
    new Date();

  if (
    formType === "result"
  ) {
    return "AWARDED / CLOSED";
  }

  if (
    deadline &&
    deadline.getTime() >=
      now.getTime()
  ) {
    return "OPEN";
  }

  if (
    formType === "planning"
  ) {
    return "PLANNED";
  }

  if (
    formType ===
    "consultation"
  ) {
    if (
      deadline &&
      deadline.getTime() <
        now.getTime()
    ) {
      return "CONSULTATION DEADLINE EXPIRED";
    }

    return "CONSULTATION";
  }

  if (
    formType ===
    "competition"
  ) {
    if (deadline) {
      return "DEADLINE EXPIRED";
    }

    return "COMPETITION - DEADLINE NOT AVAILABLE";
  }

  if (
    formType === "change"
  ) {
    return "CHANGE NOTICE";
  }

  if (
    formType ===
    "cont-modif"
  ) {
    return "CONTRACT MODIFICATION";
  }

  return "STATUS NOT DETERMINED";
}

// ======================================================
// SECTOR CLASSIFICATION
// ======================================================

function classifySector(
  notice
) {
  const text = [
    cleanText(
      notice["notice-title"]
    ),
    cleanText(
      notice["title-proc"]
    ),
    cleanText(
      notice["description-proc"]
    ),
    cleanText(
      notice["classification-cpv"]
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
      term =>
        text.includes(term)
    );

  const hasDefence =
    defenceTerms.some(
      term =>
        text.includes(term)
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

function classifySpaceRelevance(
  notice
) {
  const sector =
    classifySector(
      notice
    );

  if (
    sector === "Space" ||
    sector === "Dual-use"
  ) {
    return "High";
  }

  const text = [
    cleanText(
      notice["notice-title"]
    ),
    cleanText(
      notice["title-proc"]
    ),
    cleanText(
      notice["description-proc"]
    )
  ]
    .join(" ")
    .toLowerCase();

  const mediumTerms = [
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
    mediumTerms.some(
      term =>
        text.includes(term)
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
  notice,
  latestNoticeMap
) {
  const parts = [];

  const publicationNumber =
    cleanText(
      notice[
        "publication-number"
      ]
    );

  const noticeTitle =
    cleanText(
      notice[
        "notice-title"
      ]
    );

  const procedureTitle =
    cleanText(
      notice[
        "title-proc"
      ]
    );

  const description =
    cleanText(
      notice[
        "description-proc"
      ]
    );

  const buyer =
    cleanText(
      notice[
        "buyer-name"
      ]
    );

  const buyerPart =
    cleanText(
      notice[
        "buyer-partname"
      ]
    );

  const formType =
    cleanText(
      notice[
        "form-type"
      ]
    );

  const noticeType =
    cleanText(
      notice[
        "notice-type"
      ]
    );

  const publicationDate =
    cleanText(
      notice[
        "publication-date"
      ]
    );

  const procedureId =
    cleanText(
      notice[
        "procedure-identifier"
      ]
    );

  const internalRef =
    cleanText(
      notice[
        "internal-identifier-proc"
      ]
    );

  const procedureType =
    cleanText(
      notice[
        "procedure-type"
      ]
    );

  const contractNature =
    cleanText(
      notice[
        "contract-nature"
      ]
    );

  const cpv =
    cleanText(
      notice[
        "classification-cpv"
      ]
    );

  const estimatedValue =
    cleanText(
      notice[
        "estimated-value-proc"
      ]
    );

  const estimatedCurrency =
    cleanText(
      notice[
        "estimated-value-cur-proc"
      ]
    );

  const deadlineDate =
    cleanText(
      notice[
        "deadline-receipt-tender-date-lot"
      ]
    );

  const deadlineTime =
    cleanText(
      notice[
        "deadline-receipt-tender-time-lot"
      ]
    );

  const canonicalDeadline =
    getCanonicalDeadline(
      notice
    );

  const statusAtDownload =
    getStatusAtDownload(
      notice
    );

  const latestNotice =
    isLatestNotice(
      notice,
      latestNoticeMap
    );

  const latestPublication =
    getLatestPublicationDate(
      notice,
      latestNoticeMap
    );

  const winners =
    cleanText(
      notice[
        "winner-name"
      ]
    );

  const awardValue =
    cleanText(
      notice[
        "tender-value"
      ]
    );

  const awardCurrency =
    cleanText(
      notice[
        "tender-value-cur"
      ]
    );

  const contractDate =
    cleanText(
      notice[
        "contract-conclusion-date"
      ]
    );

  const totalValue =
    cleanText(
      notice[
        "total-value"
      ]
    );

  const totalCurrency =
    cleanText(
      notice[
        "total-value-cur"
      ]
    );

  const sector =
    classifySector(
      notice
    );

  const spaceRelevance =
    classifySpaceRelevance(
      notice
    );

  if (noticeTitle) {
    parts.push(
      `Procurement notice: ${noticeTitle}`
    );
  }

  if (
    procedureTitle &&
    procedureTitle !==
      noticeTitle
  ) {
    parts.push(
      `Procedure title: ${procedureTitle}`
    );
  }

  if (
    publicationNumber
  ) {
    parts.push(
      `TED publication number: ${publicationNumber}`
    );
  }

  if (buyer) {
    parts.push(
      `Contracting authority: ${buyer}`
    );
  }

  if (buyerPart) {
    parts.push(
      `Buyer department: ${buyerPart}`
    );
  }

  if (formType) {
    parts.push(
      `Notice stage: ${formType}`
    );
  }

  if (noticeType) {
    parts.push(
      `Notice type: ${noticeType}`
    );
  }

  if (
    publicationDate
  ) {
    parts.push(
      `Publication date: ${publicationDate}`
    );
  }

  if (procedureId) {
    parts.push(
      `Procedure identifier: ${procedureId}`
    );
  }

  if (internalRef) {
    parts.push(
      `Internal reference: ${internalRef}`
    );
  }

  parts.push(
    `Latest notice for procedure: ${latestNotice}`
  );

  if (
    latestPublication
  ) {
    parts.push(
      `Latest publication for procedure: ${latestPublication}`
    );
  }

  if (
    procedureType
  ) {
    parts.push(
      `Procedure type: ${procedureType}`
    );
  }

  if (
    contractNature
  ) {
    parts.push(
      `Contract nature: ${contractNature}`
    );
  }

  if (cpv) {
    parts.push(
      `CPV classification: ${cpv}`
    );
  }

  if (description) {
    parts.push(
      `Description: ${description}`
    );
  }

  if (
    estimatedValue
  ) {
    parts.push(
      `Estimated value: ${estimatedValue} ${estimatedCurrency}`.trim()
    );
  }

  if (deadlineDate) {
    parts.push(
      `Tender deadline information: ${deadlineDate} ${deadlineTime}`.trim()
    );
  }

  if (
    canonicalDeadline
  ) {
    parts.push(
      `Canonical deadline: ${canonicalDeadline}`
    );
  }

  parts.push(
    `Status at download: ${statusAtDownload}`
  );

  if (winners) {
    parts.push(
      `Winner or winners: ${winners}`
    );
  }

  if (awardValue) {
    parts.push(
      `Awarded tender value: ${awardValue} ${awardCurrency}`.trim()
    );
  }

  if (totalValue) {
    parts.push(
      `Total value: ${totalValue} ${totalCurrency}`.trim()
    );
  }

  if (contractDate) {
    parts.push(
      `Contract conclusion date: ${contractDate}`
    );
  }

  parts.push(
    `Sector classification: ${sector}`
  );

  parts.push(
    `Space relevance: ${spaceRelevance}`
  );

  parts.push(
    `TED page: ${getTedUrl(notice)}`
  );

  return parts.join("\n");
}

// ======================================================
// TED API
// ======================================================

async function getPage(
  query,
  page
) {
  let attempt = 1;

  while (true) {
    try {
      const response =
        await axios.post(
          API_URL,
          {
            query,
            fields:
              TED_FIELDS,
            page,
            limit:
              PAGE_SIZE,
            paginationMode:
              "PAGE_NUMBER"
          },
          {
            timeout:
              60000,

            headers: {
              "Content-Type":
                "application/json",

              "User-Agent":
                "Mozilla/5.0"
            }
          }
        );

      return response.data;

    } catch (error) {
      console.log("");

      console.log(
        `TED connection error. Page ${page}. Attempt ${attempt}.`
      );

      if (
        error.response
      ) {
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

      console.log(
        "Waiting 10 seconds before retry..."
      );

      attempt++;

      await sleep(
        10000
      );
    }
  }
}

// ======================================================
// CHECKPOINT
// ======================================================

function saveCheckpoint(
  data
) {
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

  console.log("");
  console.log(
    "CHECKPOINT SAVED"
  );
  console.log("");
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

  } catch (error) {
    console.log(
      "Checkpoint exists but could not be read."
    );

    return null;
  }
}

// ======================================================
// DOWNLOAD ALL BUYER VARIANTS
// ======================================================

async function downloadAllNotices() {
  let queryIndex = 0;
  let page = 1;
  let allNotices = [];

  const checkpoint =
    loadCheckpoint();

  if (checkpoint) {
    queryIndex =
      checkpoint.queryIndex ||
      0;

    page =
      checkpoint.page ||
      1;

    allNotices =
      checkpoint.allNotices ||
      [];

    console.log("");
    console.log(
      "CHECKPOINT FOUND"
    );

    console.log(
      `Resuming buyer query ${queryIndex + 1}, page ${page}`
    );

    console.log(
      `Already downloaded: ${allNotices.length}`
    );

    console.log("");
  }

  for (
    ;
    queryIndex <
      BUYER_QUERIES.length;
    queryIndex++
  ) {
    const query =
      BUYER_QUERIES[
        queryIndex
      ];

    console.log("");

    console.log(
      "========================================"
    );

    console.log(
      `BUYER QUERY ${queryIndex + 1} / ${BUYER_QUERIES.length}`
    );

    console.log(
      query
    );

    console.log(
      "========================================"
    );

    let currentPage =
      page || 1;

    let totalPages =
      null;

    while (true) {
      console.log(
        `Downloading page ${currentPage}...`
      );

      const data =
        await getPage(
          query,
          currentPage
        );

      const notices =
        data.notices ||
        [];

      const total =
        data.totalNoticeCount ||
        0;

      if (
        totalPages === null
      ) {
        totalPages =
          Math.max(
            1,
            Math.ceil(
              total /
              PAGE_SIZE
            )
          );

        console.log(
          `TED reports ${total} notices for this buyer variant.`
        );

        console.log(
          `Pages: ${totalPages}`
        );
      }

      if (
        notices.length ===
        0
      ) {
        break;
      }

      allNotices.push(
        ...notices
      );

      console.log(
        `Received ${notices.length}. Raw downloaded total: ${allNotices.length}`
      );

      if (
        currentPage >=
        totalPages
      ) {
        break;
      }

      currentPage++;

      saveCheckpoint({
        queryIndex,
        page:
          currentPage,
        allNotices
      });

      await sleep(
        500
      );
    }

    page = 1;

    saveCheckpoint({
      queryIndex:
        queryIndex + 1,
      page: 1,
      allNotices
    });
  }

  return allNotices;
}

// ======================================================
// DEDUPLICATION
// ======================================================

function deduplicateNotices(
  notices
) {
  const map =
    new Map();

  for (
    const notice of
      notices
  ) {
    const key =
      cleanText(
        notice[
          "publication-number"
        ]
      );

    if (!key) {
      continue;
    }

    if (
      !map.has(key)
    ) {
      map.set(
        key,
        notice
      );
    }
  }

  return Array.from(
    map.values()
  );
}

// ======================================================
// NORMALISE FOR EXCEL
// ======================================================

function normaliseNotice(
  notice,
  latestNoticeMap
) {
  return {
    publicationNumber:
      cleanText(
        notice[
          "publication-number"
        ]
      ),

    noticeIdentifier:
      cleanText(
        notice[
          "notice-identifier"
        ]
      ),

    publicationDate:
      cleanText(
        notice[
          "publication-date"
        ]
      ),

    formType:
      cleanText(
        notice[
          "form-type"
        ]
      ),

    noticeType:
      cleanText(
        notice[
          "notice-type"
        ]
      ),

    noticeTitle:
      cleanText(
        notice[
          "notice-title"
        ]
      ),

    procedureTitle:
      cleanText(
        notice[
          "title-proc"
        ]
      ),

    description:
      cleanText(
        notice[
          "description-proc"
        ]
      ),

    buyerName:
      cleanText(
        notice[
          "buyer-name"
        ]
      ),

    buyerIdentifier:
      cleanText(
        notice[
          "buyer-identifier"
        ]
      ),

    buyerDepartment:
      cleanText(
        notice[
          "buyer-partname"
        ]
      ),

    buyerCountry:
      cleanText(
        notice[
          "buyer-country"
        ]
      ),

    procedureIdentifier:
      cleanText(
        notice[
          "procedure-identifier"
        ]
      ),

    internalReference:
      cleanText(
        notice[
          "internal-identifier-proc"
        ]
      ),

    procedureGroupKey:
      getProcedureGroupKey(
        notice
      ),

    latestNoticeForProcedure:
      isLatestNotice(
        notice,
        latestNoticeMap
      ),

    latestPublicationForProcedure:
      getLatestPublicationDate(
        notice,
        latestNoticeMap
      ),

    procedureType:
      cleanText(
        notice[
          "procedure-type"
        ]
      ),

    contractNature:
      cleanText(
        notice[
          "contract-nature"
        ]
      ),

    cpvCodes:
      cleanText(
        notice[
          "classification-cpv"
        ]
      ),

    estimatedValue:
      cleanText(
        notice[
          "estimated-value-proc"
        ]
      ),

    estimatedCurrency:
      cleanText(
        notice[
          "estimated-value-cur-proc"
        ]
      ),

    deadlineDate:
      cleanText(
        notice[
          "deadline-receipt-tender-date-lot"
        ]
      ),

    deadlineTime:
      cleanText(
        notice[
          "deadline-receipt-tender-time-lot"
        ]
      ),

    canonicalDeadline:
      getCanonicalDeadline(
        notice
      ),

    statusAtDownload:
      getStatusAtDownload(
        notice
      ),

    winnerNames:
      cleanText(
        notice[
          "winner-name"
        ]
      ),

    winnerIdentifiers:
      cleanText(
        notice[
          "winner-identifier"
        ]
      ),

    awardedValue:
      cleanText(
        notice[
          "tender-value"
        ]
      ),

    awardedCurrency:
      cleanText(
        notice[
          "tender-value-cur"
        ]
      ),

    contractIdentifier:
      cleanText(
        notice[
          "contract-identifier"
        ]
      ),

    contractTitle:
      cleanText(
        notice[
          "contract-title"
        ]
      ),

    contractConclusionDate:
      cleanText(
        notice[
          "contract-conclusion-date"
        ]
      ),

    totalValue:
      cleanText(
        notice[
          "total-value"
        ]
      ),

    totalCurrency:
      cleanText(
        notice[
          "total-value-cur"
        ]
      ),

    sector:
      classifySector(
        notice
      ),

    spaceRelevance:
      classifySpaceRelevance(
        notice
      ),

    tedUrl:
      getTedUrl(
        notice
      ),

    pdfUrl:
      getTedPdfUrl(
        notice
      ),

    xmlUrl:
      getTedXmlUrl(
        notice
      ),

    ragText:
      createRagText(
        notice,
        latestNoticeMap
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

  sheet.columns = [
    {
      header:
        "publicationNumber",
      key:
        "publicationNumber",
      width: 18
    },
    {
      header:
        "noticeIdentifier",
      key:
        "noticeIdentifier",
      width: 38
    },
    {
      header:
        "publicationDate",
      key:
        "publicationDate",
      width: 16
    },
    {
      header:
        "formType",
      key:
        "formType",
      width: 18
    },
    {
      header:
        "noticeType",
      key:
        "noticeType",
      width: 20
    },
    {
      header:
        "noticeTitle",
      key:
        "noticeTitle",
      width: 70
    },
    {
      header:
        "procedureTitle",
      key:
        "procedureTitle",
      width: 60
    },
    {
      header:
        "description",
      key:
        "description",
      width: 90
    },
    {
      header:
        "buyerName",
      key:
        "buyerName",
      width: 55
    },
    {
      header:
        "buyerIdentifier",
      key:
        "buyerIdentifier",
      width: 30
    },
    {
      header:
        "buyerDepartment",
      key:
        "buyerDepartment",
      width: 45
    },
    {
      header:
        "buyerCountry",
      key:
        "buyerCountry",
      width: 18
    },
    {
      header:
        "procedureIdentifier",
      key:
        "procedureIdentifier",
      width: 38
    },
    {
      header:
        "internalReference",
      key:
        "internalReference",
      width: 28
    },
    {
      header:
        "procedureGroupKey",
      key:
        "procedureGroupKey",
      width: 50
    },
    {
      header:
        "latestNoticeForProcedure",
      key:
        "latestNoticeForProcedure",
      width: 24
    },
    {
      header:
        "latestPublicationForProcedure",
      key:
        "latestPublicationForProcedure",
      width: 28
    },
    {
      header:
        "procedureType",
      key:
        "procedureType",
      width: 24
    },
    {
      header:
        "contractNature",
      key:
        "contractNature",
      width: 20
    },
    {
      header:
        "cpvCodes",
      key:
        "cpvCodes",
      width: 35
    },
    {
      header:
        "estimatedValue",
      key:
        "estimatedValue",
      width: 20
    },
    {
      header:
        "estimatedCurrency",
      key:
        "estimatedCurrency",
      width: 16
    },
    {
      header:
        "deadlineDate",
      key:
        "deadlineDate",
      width: 28
    },
    {
      header:
        "deadlineTime",
      key:
        "deadlineTime",
      width: 20
    },
    {
      header:
        "canonicalDeadline",
      key:
        "canonicalDeadline",
      width: 26
    },
    {
      header:
        "statusAtDownload",
      key:
        "statusAtDownload",
      width: 34
    },
    {
      header:
        "winnerNames",
      key:
        "winnerNames",
      width: 60
    },
    {
      header:
        "winnerIdentifiers",
      key:
        "winnerIdentifiers",
      width: 35
    },
    {
      header:
        "awardedValue",
      key:
        "awardedValue",
      width: 20
    },
    {
      header:
        "awardedCurrency",
      key:
        "awardedCurrency",
      width: 16
    },
    {
      header:
        "contractIdentifier",
      key:
        "contractIdentifier",
      width: 30
    },
    {
      header:
        "contractTitle",
      key:
        "contractTitle",
      width: 60
    },
    {
      header:
        "contractConclusionDate",
      key:
        "contractConclusionDate",
      width: 22
    },
    {
      header:
        "totalValue",
      key:
        "totalValue",
      width: 20
    },
    {
      header:
        "totalCurrency",
      key:
        "totalCurrency",
      width: 16
    },
    {
      header:
        "sector",
      key:
        "sector",
      width: 16
    },
    {
      header:
        "spaceRelevance",
      key:
        "spaceRelevance",
      width: 18
    },
    {
      header:
        "tedUrl",
      key:
        "tedUrl",
      width: 55
    },
    {
      header:
        "pdfUrl",
      key:
        "pdfUrl",
      width: 55
    },
    {
      header:
        "xmlUrl",
      key:
        "xmlUrl",
      width: 55
    },
    {
      header:
        "ragText",
      key:
        "ragText",
      width: 100
    }
  ];

  records.forEach(
    record => {
      sheet.addRow(
        record
      );
    }
  );

  const header =
    sheet.getRow(1);

  header.height = 30;

  header.eachCell(
    cell => {
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
    }
  );

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
    (
      row,
      rowNumber
    ) => {
      if (
        rowNumber === 1
      ) {
        return;
      }

      row.height = 45;

      row.eachCell(
        cell => {
          cell.alignment = {
            vertical:
              "top",
            wrapText:
              true
          };
        }
      );
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
      "DG DEFIS TED PROCUREMENT DOWNLOADER"
    );

    const rawNotices =
      await downloadAllNotices();

    console.log("");

    console.log(
      `Raw notices downloaded: ${rawNotices.length}`
    );

    const uniqueNotices =
      deduplicateNotices(
        rawNotices
      );

    console.log(
      `Unique TED notices: ${uniqueNotices.length}`
    );

    const latestNoticeMap =
      buildLatestNoticeMap(
        uniqueNotices
      );

    const records =
      uniqueNotices
        .map(
          notice =>
            normaliseNotice(
              notice,
              latestNoticeMap
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

    const workbook =
      new ExcelJS.Workbook();

    workbook.creator =
      "DG DEFIS TED Downloader";

    workbook.created =
      new Date();

    createSheet(
      workbook,
      "All Procurement Notices",
      records
    );

    createSheet(
      workbook,
      "Latest Notices",
      records.filter(
        record =>
          record.latestNoticeForProcedure ===
          "YES"
      )
    );

    createSheet(
      workbook,
      "Open Latest",
      records.filter(
        record =>
          record.latestNoticeForProcedure ===
            "YES" &&
          record.statusAtDownload ===
            "OPEN"
      )
    );

    createSheet(
      workbook,
      "Planning",
      records.filter(
        record =>
          record.formType ===
          "planning"
      )
    );

    createSheet(
      workbook,
      "Competition",
      records.filter(
        record =>
          record.formType ===
          "competition"
      )
    );

    createSheet(
      workbook,
      "Results Awards",
      records.filter(
        record =>
          record.formType ===
          "result"
      )
    );

    createSheet(
      workbook,
      "Changes Modifications",
      records.filter(
        record =>
          record.formType ===
            "change" ||
          record.formType ===
            "cont-modif"
      )
    );

    createSheet(
      workbook,
      "Consultations",
      records.filter(
        record =>
          record.formType ===
          "consultation"
      )
    );

    const today =
      new Date()
        .toISOString()
        .slice(
          0,
          10
        );

    const filename =
      `EC_DG_DEFIS_TED_Procurements_${today}.xlsx`;

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
    console.log(
      "DONE"
    );
    console.log("");

    console.log(
      `Total unique notices: ${records.length}`
    );

    console.log(
      `Unique procedure groups: ${latestNoticeMap.size}`
    );

    console.log(
      `Latest notices: ${
        records.filter(
          x =>
            x.latestNoticeForProcedure ===
            "YES"
        ).length
      }`
    );

    console.log(
      `OPEN latest notices: ${
        records.filter(
          x =>
            x.latestNoticeForProcedure ===
              "YES" &&
            x.statusAtDownload ===
              "OPEN"
        ).length
      }`
    );

    console.log(
      `Planning: ${
        records.filter(
          x =>
            x.formType ===
            "planning"
        ).length
      }`
    );

    console.log(
      `Competition: ${
        records.filter(
          x =>
            x.formType ===
            "competition"
        ).length
      }`
    );

    console.log(
      `Results/Awards: ${
        records.filter(
          x =>
            x.formType ===
            "result"
        ).length
      }`
    );

    console.log(
      `OPEN at download, all notices: ${
        records.filter(
          x =>
            x.statusAtDownload ===
            "OPEN"
        ).length
      }`
    );

    console.log(
      `Deadline expired: ${
        records.filter(
          x =>
            x.statusAtDownload ===
            "DEADLINE EXPIRED"
        ).length
      }`
    );

    console.log(
      `Planned: ${
        records.filter(
          x =>
            x.statusAtDownload ===
            "PLANNED"
        ).length
      }`
    );

    console.log(
      `Awarded / Closed: ${
        records.filter(
          x =>
            x.statusAtDownload ===
            "AWARDED / CLOSED"
        ).length
      }`
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
      error.message
    );

    console.log("");

    console.log(
      "Checkpoint preserved."
    );
  }
}

main();