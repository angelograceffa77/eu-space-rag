const axios = require("axios");
const cheerio = require("cheerio");
const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");


// =====================================================
// OFFICIAL EUSPA SOURCES
// =====================================================

const BASE_URL =
  "https://www.euspa.europa.eu";

const CLOSED_URL =
  "https://www.euspa.europa.eu/opportunities/procurement-grants/closed-procurements";


// =====================================================
// OUTPUT
// =====================================================

const OUTPUT_FOLDER =
  "C:\\Users\\angel\\OneDrive\\Desktop\\knowledge\\eu-space-rag\\03_PROCUREMENT\\EUSPA\\Procurement Data";

const CHECKPOINT_FILE =
  path.join(
    OUTPUT_FOLDER,
    "euspa-closed-procurements-checkpoint.json"
  );


// =====================================================
// SETTINGS
// =====================================================

const WAIT_BETWEEN_PAGES = 600;
const CHECKPOINT_EVERY = 20;


// =====================================================
// UTILITIES
// =====================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


function cleanText(value) {
  if (!value) {
    return "";
  }

  return String(value)
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}


function cleanInline(value) {
  if (!value) {
    return "";
  }

  return String(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function absoluteUrl(url) {
  if (!url) {
    return "";
  }

  try {
    return new URL(
      url,
      BASE_URL
    ).href;
  } catch {
    return url;
  }
}


// =====================================================
// HTTP WITH AUTOMATIC RETRY
// =====================================================

async function getHtml(url) {
  let attempt = 1;

  while (true) {
    try {
      const response =
        await axios.get(
          url,
          {
            timeout: 60000,

            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36",

              "Accept":
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

              "Accept-Language":
                "en-GB,en;q=0.9"
            }
          }
        );

      return response.data;

    } catch (error) {
      console.log("");
      console.log(
        `Connection error: ${url}`
      );

      console.log(
        `Retry ${attempt} in 10 seconds...`
      );

      attempt++;

      await sleep(10000);
    }
  }
}


// =====================================================
// CHECKPOINT
// =====================================================

function saveCheckpoint(
  records,
  nextIndex
) {
  const checkpoint = {
    savedAt:
      new Date().toISOString(),

    nextIndex,

    records
  };

  fs.writeFileSync(
    CHECKPOINT_FILE,
    JSON.stringify(
      checkpoint,
      null,
      2
    ),
    "utf8"
  );

  console.log("");
  console.log(
    `CHECKPOINT SAVED - ${records.length} records`
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
  } catch {
    return null;
  }
}


// =====================================================
// SOURCE AGENCY
// =====================================================

function detectAgency(
  reference,
  title
) {
  const text =
    `${reference} ${title}`
      .toUpperCase();

  if (
    text.includes("GSA/")
  ) {
    return "European GNSS Agency (GSA)";
  }

  return "European Union Agency for the Space Programme (EUSPA)";
}


// =====================================================
// STRUCTURED DRUPAL FIELDS
// =====================================================

function extractPostDate($) {
  const value =
    $(".field--name-node-post-date .field__item")
      .first()
      .text();

  return cleanInline(value);
}


function extractSubmissionDeadline($) {
  const value =
    $(".field--name-field-submission-deadline .field__item")
      .first()
      .text();

  return cleanInline(value);
}


function extractDetailStatus($) {
  const value =
    $(".field--name-field-opportunity-status .field__item")
      .first()
      .text();

  return cleanInline(value);
}


function extractReference(
  $,
  fallback
) {
  const value =
    $(".field--name-field-submission-reference .field__item")
      .first()
      .text();

  const cleaned =
    cleanInline(value);

  return cleaned || fallback;
}


function extractOpportunityType($) {
  const value =
    $(".field--name-field-available-opportunity-type .field__item")
      .first()
      .text();

  return cleanInline(value);
}


// =====================================================
// DOCUMENTS
// =====================================================

function extractDocuments($) {
  const documents = [];
  const seen = new Set();

  $("main a[href]").each(
    (_, element) => {
      const href =
        $(element)
          .attr("href");

      if (!href) {
        return;
      }

      const fullUrl =
        absoluteUrl(
          href
        );

      const lowerUrl =
        fullUrl
          .toLowerCase();

      const looksLikeFile =
        /\.(pdf|doc|docx|xls|xlsx|zip|ppt|pptx)(\?|$)/i
          .test(
            lowerUrl
          )
        ||
        lowerUrl.includes(
          "/sites/default/files/"
        );

      if (
        !looksLikeFile
      ) {
        return;
      }

      if (
        seen.has(
          fullUrl
        )
      ) {
        return;
      }

      seen.add(
        fullUrl
      );

      let title =
        cleanText(
          $(element)
            .text()
        );

      if (!title) {
        try {
          title =
            decodeURIComponent(
              fullUrl
                .split("/")
                .pop()
                .split("?")[0]
            );
        } catch {
          title =
            fullUrl
              .split("/")
              .pop()
              .split("?")[0];
        }
      }

      documents.push(
        {
          title,
          url:
            fullUrl
        }
      );
    }
  );

  return documents;
}


// =====================================================
// DESCRIPTION
// =====================================================

function extractDescription($) {
  const metaDescription =
    $('meta[name="description"]')
      .attr("content");

  if (metaDescription) {
    return cleanText(
      metaDescription
    );
  }

  const paragraphs = [];

  $("main p").each(
    (_, element) => {
      const text =
        cleanText(
          $(element).text()
        );

      if (
        !text ||
        text.length < 20
      ) {
        return;
      }

      const lower =
        text.toLowerCase();

      if (
        lower.startsWith(
          "post date"
        )
        ||
        lower.includes(
          "submission deadline"
        )
        ||
        lower.includes(
          "status of the opportunity"
        )
        ||
        lower.startsWith(
          "ref. no"
        )
        ||
        lower.includes(
          "type of available opportunity"
        )
        ||
        lower ===
          "back to top"
      ) {
        return;
      }

      paragraphs.push(
        text
      );
    }
  );

  return [
    ...new Set(
      paragraphs
    )
  ]
    .join(
      "\n\n"
    )
    .trim();
}


// =====================================================
// MASTER LIST
// =====================================================

async function getClosedProcurementList() {
  console.log("");
  console.log(
    "Downloading EUSPA Closed Procurements list..."
  );

  const html =
    await getHtml(
      CLOSED_URL
    );

  const $ =
    cheerio.load(
      html
    );

  const records = [];

  $("table tbody tr").each(
    (_, row) => {
      const cells =
        $(row)
          .find(
            "td"
          );

      if (
        cells.length < 2
      ) {
        return;
      }

      const reference =
        cleanText(
          $(cells[0])
            .text()
        );

      const titleCell =
        $(cells[1]);

      const title =
        cleanText(
          titleCell
            .text()
        );

      const href =
        titleCell
          .find(
            "a"
          )
          .first()
          .attr(
            "href"
          );

      let listStatus = "";

      if (
        cells.length >= 3
      ) {
        listStatus =
          cleanText(
            $(cells[2])
              .text()
          );
      }

      if (
        !reference ||
        !title ||
        !href
      ) {
        return;
      }

      const detailPageUrl =
        absoluteUrl(
          href
        );

      if (
        !detailPageUrl.includes(
          "/opportunities/procurement-grants/"
        )
      ) {
        return;
      }

      records.push(
        {
          reference,
          title,
          listStatus,
          detailPageUrl
        }
      );
    }
  );

  const unique =
    Array.from(
      new Map(
        records.map(
          record => [
            record.detailPageUrl,
            record
          ]
        )
      ).values()
    );

  console.log("");
  console.log(
    `Closed procurements found: ${unique.length}`
  );

  return unique;
}


// =====================================================
// DETAIL PAGE
// =====================================================

async function getProcurementDetails(
  listRecord
) {
  console.log("");
  console.log(
    `Reading: ${listRecord.reference}`
  );

  console.log(
    listRecord.detailPageUrl
  );

  const html =
    await getHtml(
      listRecord.detailPageUrl
    );

  const $ =
    cheerio.load(
      html
    );


  // ===================================================
  // TITLE
  // ===================================================

  let title =
    cleanText(
      $("main h1")
        .first()
        .text()
    );

  if (!title) {
    title =
      cleanText(
        $('meta[property="og:title"]')
          .attr("content")
      );
  }

  if (!title) {
    title =
      listRecord.title;
  }


  // ===================================================
  // STRUCTURED FIELDS
  // ===================================================

  const postDate =
    extractPostDate(
      $
    );

  const submissionDeadline =
    extractSubmissionDeadline(
      $
    );

  const detailStatus =
    extractDetailStatus(
      $
    );

  const reference =
    extractReference(
      $,
      listRecord.reference
    );

  const opportunityType =
    extractOpportunityType(
      $
    );


  // ===================================================
  // DESCRIPTION
  // ===================================================

  const description =
    extractDescription(
      $
    );


  // ===================================================
  // DOCUMENTS
  // ===================================================

  const documents =
    extractDocuments(
      $
    );

  const documentTitles =
    documents
      .map(
        document =>
          document.title
      )
      .join(
        "\n"
      );

  const documentUrls =
    documents
      .map(
        document =>
          document.url
      )
      .join(
        "\n"
      );


  // ===================================================
  // SOURCE
  // ===================================================

  const sourceAgency =
    detectAgency(
      reference,
      title
    );


  // ===================================================
  // STATUS
  // ===================================================

  const listStatus =
    cleanInline(
      listRecord.listStatus
    );

  const status =
    detailStatus ||
    listStatus;

  let statusConflict =
    "No";

  if (
    listStatus &&
    detailStatus &&
    listStatus.toLowerCase() !==
      detailStatus.toLowerCase()
  ) {
    statusConflict =
      "Yes";
  }


  return {
    reference:
      cleanText(
        reference
      ),

    title:
      cleanText(
        title
      ),

    status:
      cleanText(
        status
      ),

    listStatus:
      cleanText(
        listStatus
      ),

    detailStatus:
      cleanText(
        detailStatus
      ),

    statusConflict,

    postDate:
      cleanText(
        postDate
      ),

    submissionDeadline:
      cleanText(
        submissionDeadline
      ),

    opportunityType:
      cleanText(
        opportunityType
      ),

    description:
      cleanText(
        description
      ),

    sourceAgency,

    detailPageUrl:
      listRecord.detailPageUrl,

    documentCount:
      documents.length,

    documentTitles,

    documentUrls
  };
}


// =====================================================
// RAG TEXT
// =====================================================

function createRagText(
  record
) {
  const parts = [];

  parts.push(
    "Source: Official EUSPA procurement website"
  );

  if (
    record.sourceAgency
  ) {
    parts.push(
      `Contracting authority: ${record.sourceAgency}`
    );
  }

  if (
    record.reference
  ) {
    parts.push(
      `Procurement reference: ${record.reference}`
    );
  }

  if (
    record.title
  ) {
    parts.push(
      `Procurement title: ${record.title}`
    );
  }

  if (
    record.status
  ) {
    parts.push(
      `Status: ${record.status}`
    );
  }

  if (
    record.listStatus
  ) {
    parts.push(
      `Closed archive list status: ${record.listStatus}`
    );
  }

  if (
    record.detailStatus &&
    record.detailStatus !==
      record.listStatus
  ) {
    parts.push(
      `Detail page status: ${record.detailStatus}`
    );
  }

  if (
    record.opportunityType
  ) {
    parts.push(
      `Opportunity type: ${record.opportunityType}`
    );
  }

  if (
    record.postDate
  ) {
    parts.push(
      `Website post date: ${record.postDate}`
    );
  }

  if (
    record.submissionDeadline
  ) {
    parts.push(
      `Submission deadline: ${record.submissionDeadline}`
    );
  }

  if (
    record.description
  ) {
    parts.push(
      `Description: ${record.description}`
    );
  }

  if (
    record.documentTitles
  ) {
    parts.push(
      `Associated procurement documents: ${record.documentTitles}`
    );
  }

  parts.push(
    `Official procurement page: ${record.detailPageUrl}`
  );

  if (
    record.documentUrls
  ) {
    parts.push(
      `Official document URLs: ${record.documentUrls}`
    );
  }

  return parts.join(
    "\n"
  );
}


// =====================================================
// CREATE EXCEL
// =====================================================

async function createExcel(
  records
) {
  const workbook =
    new ExcelJS.Workbook();

  workbook.creator =
    "EUSPA Procurement Downloader";

  workbook.created =
    new Date();

  const sheet =
    workbook.addWorksheet(
      "All Closed Procurements",
      {
        views: [
          {
            state:
              "frozen",

            ySplit:
              1
          }
        ]
      }
    );

  sheet.columns = [

    {
      header:
        "reference",

      key:
        "reference",

      width:
        34
    },

    {
      header:
        "title",

      key:
        "title",

      width:
        55
    },

    {
      header:
        "status",

      key:
        "status",

      width:
        20
    },

    {
      header:
        "listStatus",

      key:
        "listStatus",

      width:
        18
    },

    {
      header:
        "detailStatus",

      key:
        "detailStatus",

      width:
        18
    },

    {
      header:
        "statusConflict",

      key:
        "statusConflict",

      width:
        16
    },

    {
      header:
        "postDate",

      key:
        "postDate",

      width:
        20
    },

    {
      header:
        "submissionDeadline",

      key:
        "submissionDeadline",

      width:
        25
    },

    {
      header:
        "opportunityType",

      key:
        "opportunityType",

      width:
        20
    },

    {
      header:
        "description",

      key:
        "description",

      width:
        75
    },

    {
      header:
        "sourceAgency",

      key:
        "sourceAgency",

      width:
        45
    },

    {
      header:
        "detailPageUrl",

      key:
        "detailPageUrl",

      width:
        65
    },

    {
      header:
        "documentCount",

      key:
        "documentCount",

      width:
        15
    },

    {
      header:
        "documentTitles",

      key:
        "documentTitles",

      width:
        60
    },

    {
      header:
        "documentUrls",

      key:
        "documentUrls",

      width:
        80
    },

    {
      header:
        "ragText",

      key:
        "ragText",

      width:
        100
    }

  ];


  records.forEach(
    record => {
      sheet.addRow(
        {
          ...record,

          ragText:
            createRagText(
              record
            )
        }
      );
    }
  );


  // ===================================================
  // HEADER
  // ===================================================

  const header =
    sheet.getRow(
      1
    );

  header.height =
    30;

  header.eachCell(
    cell => {
      cell.font = {
        bold:
          true,

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
        vertical:
          "middle",

        horizontal:
          "center",

        wrapText:
          true
      };
    }
  );


  // ===================================================
  // FILTER
  // ===================================================

  sheet.autoFilter = {
    from:
      "A1",

    to:
      "P1"
  };


  // ===================================================
  // BODY
  // ===================================================

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

      row.height =
        42;

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

      const conflictCell =
        row.getCell(
          6
        );

      if (
        conflictCell.value ===
        "Yes"
      ) {
        conflictCell.fill = {
          type:
            "pattern",

          pattern:
            "solid",

          fgColor: {
            argb:
              "FFFFC7CE"
          }
        };

        conflictCell.font = {
          bold:
            true,

          color: {
            argb:
              "FF9C0006"
          }
        };
      }
    }
  );


  // ===================================================
  // OUTPUT FILE
  // ===================================================

  const today =
    new Date()
      .toISOString()
      .slice(
        0,
        10
      );

  const filename =
    `EUSPA_Closed_Procurements_${today}.xlsx`;

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

  return fullPath;
}


// =====================================================
// MAIN
// =====================================================

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
          recursive:
            true
        }
      );
    }


    // =================================================
    // MASTER LIST
    // =================================================

    const masterList =
      await getClosedProcurementList();

    if (
      masterList.length === 0
    ) {
      throw new Error(
        "No closed procurements found."
      );
    }


    // =================================================
    // CHECKPOINT
    // =================================================

    let records = [];
    let startIndex = 0;

    const checkpoint =
      loadCheckpoint();

    if (
      checkpoint
    ) {
      records =
        checkpoint.records ||
        [];

      startIndex =
        checkpoint.nextIndex ||
        0;

      console.log("");
      console.log(
        "CHECKPOINT FOUND"
      );

      console.log(
        `Already completed: ${records.length}`
      );

      console.log(
        `Resuming from record: ${startIndex + 1}`
      );
    }


    // =================================================
    // DETAIL PAGES
    // =================================================

    for (
      let i = startIndex;
      i < masterList.length;
      i++
    ) {
      const listRecord =
        masterList[i];

      console.log("");
      console.log(
        "===================================="
      );

      console.log(
        `${i + 1} / ${masterList.length}`
      );

      console.log(
        listRecord.reference
      );

      const details =
        await getProcurementDetails(
          listRecord
        );

      records.push(
        details
      );

      console.log(
        `Post date: ${details.postDate || "not found"}`
      );

      console.log(
        `Deadline: ${details.submissionDeadline || "not found"}`
      );

      console.log(
        `Status: ${details.status || "not found"}`
      );

      console.log(
        `Opportunity type: ${details.opportunityType || "not found"}`
      );

      console.log(
        `Documents: ${details.documentCount}`
      );

      if (
        details.statusConflict ===
        "Yes"
      ) {
        console.log(
          `STATUS DIFFERENCE: list=${details.listStatus} / detail=${details.detailStatus}`
        );
      }

      if (
        records.length %
          CHECKPOINT_EVERY ===
        0
      ) {
        saveCheckpoint(
          records,
          i + 1
        );
      }

      await sleep(
        WAIT_BETWEEN_PAGES
      );
    }


    // =================================================
    // FINAL CHECKPOINT
    // =================================================

    saveCheckpoint(
      records,
      masterList.length
    );


    // =================================================
    // EXCEL
    // =================================================

    const output =
      await createExcel(
        records
      );


    // =================================================
    // QUALITY CHECK
    // =================================================

    const missingPostDates =
      records.filter(
        record =>
          !record.postDate
      ).length;

    const missingDeadlines =
      records.filter(
        record =>
          !record.submissionDeadline
      ).length;

    const missingTypes =
      records.filter(
        record =>
          !record.opportunityType
      ).length;

    const missingStatuses =
      records.filter(
        record =>
          !record.status
      ).length;

    const conflicts =
      records.filter(
        record =>
          record.statusConflict ===
          "Yes"
      ).length;


    console.log("");
    console.log(
      "===================================="
    );

    console.log(
      "DONE!"
    );

    console.log(
      "===================================="
    );

    console.log(
      `Closed procurements: ${records.length}`
    );

    console.log(
      `Missing post dates: ${missingPostDates}`
    );

    console.log(
      `Missing deadlines: ${missingDeadlines}`
    );

    console.log(
      `Missing opportunity types: ${missingTypes}`
    );

    console.log(
      `Missing statuses: ${missingStatuses}`
    );

    console.log(
      `Status differences: ${conflicts}`
    );

    console.log("");
    console.log(
      "Excel created:"
    );

    console.log(
      output
    );


    // =================================================
    // DELETE CHECKPOINT ONLY AFTER SUCCESS
    // =================================================

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

    console.log(
      "Run the script again to resume."
    );
  }
}


main();