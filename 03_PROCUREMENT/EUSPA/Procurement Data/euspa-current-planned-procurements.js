const axios = require("axios");
const cheerio = require("cheerio");
const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");


// =====================================================
// OFFICIAL EUSPA SOURCE
// =====================================================

const BASE_URL =
  "https://www.euspa.europa.eu";

const PROCUREMENT_URL =
  "https://www.euspa.europa.eu/opportunities/procurement-grants/procurement";


// =====================================================
// OUTPUT
// =====================================================

const OUTPUT_FOLDER =
  "C:\\Users\\angel\\OneDrive\\Desktop\\knowledge\\eu-space-rag\\03_PROCUREMENT\\EUSPA\\Procurement Data";

const CHECKPOINT_FILE =
  path.join(
    OUTPUT_FOLDER,
    "euspa-current-planned-checkpoint.json"
  );


// =====================================================
// SETTINGS
// =====================================================

const WAIT_BETWEEN_PAGES = 600;
const CHECKPOINT_EVERY = 10;


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
// HTTP WITH RETRY
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
// PARSE ONE PROCUREMENT TABLE
// =====================================================

function parseTable(
  $,
  containerSelector,
  sourceCategory
) {
  const records = [];

  const container =
    $(containerSelector);

  if (
    container.length === 0
  ) {
    return records;
  }

  container
    .find("table tbody tr")
    .each(
      (_, row) => {
        const cells =
          $(row)
            .find("td");

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
            .find("a")
            .first()
            .attr("href");

        if (
          !reference ||
          !title ||
          !href
        ) {
          return;
        }

        let listDeadline = "";
        let listStatus = "";

        if (
          sourceCategory ===
          "Ongoing Procurement"
        ) {
          if (
            cells.length >= 3
          ) {
            listDeadline =
              cleanInline(
                $(cells[2])
                  .text()
              );
          }

          if (
            cells.length >= 4
          ) {
            listStatus =
              cleanInline(
                $(cells[3])
                  .text()
              );
          }

        } else {
          if (
            cells.length >= 3
          ) {
            listStatus =
              cleanInline(
                $(cells[2])
                  .text()
              );
          }
        }

        records.push(
          {
            reference,
            title,
            listDeadline,
            listStatus,
            sourceCategory,
            detailPageUrl:
              absoluteUrl(
                href
              )
          }
        );
      }
    );

  return records;
}


// =====================================================
// MASTER LIST
// =====================================================

async function getMasterList() {
  console.log("");
  console.log(
    "Downloading EUSPA current/planned procurement page..."
  );

  const html =
    await getHtml(
      PROCUREMENT_URL
    );

  const $ =
    cheerio.load(
      html
    );

  const ongoing =
    parseTable(
      $,
      ".block-ongoing-procedures",
      "Ongoing Procurement"
    );

  const prior =
    parseTable(
      $,
      ".block-prior-information-notices",
      "Prior Information Notice / Consultation"
    );

  const planned =
    parseTable(
      $,
      ".block-announcements-procurement",
      "Planned Low/Middle Value Procurement"
    );

  const all =
    [
      ...ongoing,
      ...prior,
      ...planned
    ];

  const unique =
    Array.from(
      new Map(
        all.map(
          record => [
            `${record.sourceCategory}|${record.detailPageUrl}`,
            record
          ]
        )
      ).values()
    );

  console.log("");
  console.log(
    `Ongoing: ${ongoing.length}`
  );

  console.log(
    `Prior information notices / consultations: ${prior.length}`
  );

  console.log(
    `Planned low/middle value: ${planned.length}`
  );

  console.log(
    `Total records: ${unique.length}`
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

  const reference =
    extractReference(
      $,
      listRecord.reference
    );

  const postDate =
    extractPostDate(
      $
    );

  const detailDeadline =
    extractSubmissionDeadline(
      $
    );

  const detailStatus =
    extractDetailStatus(
      $
    );

  const opportunityType =
    extractOpportunityType(
      $
    );


  // ===================================================
  // IMPORTANT:
  // FOR CURRENT PROCUREMENTS, MASTER LIST DEADLINE WINS
  // ===================================================

  const submissionDeadline =
    listRecord.listDeadline ||
    detailDeadline ||
    "";


  // ===================================================
  // STATUS
  // ===================================================

  const status =
    detailStatus ||
    listRecord.listStatus ||
    "";


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
  // STATUS CONSISTENCY
  // ===================================================

  let statusConflict =
    "No";

  if (
    listRecord.listStatus &&
    detailStatus &&
    listRecord.listStatus
      .toLowerCase() !==
    detailStatus
      .toLowerCase()
  ) {
    statusConflict =
      "Yes";
  }


  // ===================================================
  // DEADLINE CONSISTENCY
  // ===================================================

  let deadlineConflict =
    "No";

  if (
    listRecord.listDeadline &&
    detailDeadline &&
    cleanInline(
      listRecord.listDeadline
    ) !==
    cleanInline(
      detailDeadline
    )
  ) {
    deadlineConflict =
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

    sourceCategory:
      listRecord.sourceCategory,

    status:
      cleanText(
        status
      ),

    listStatus:
      cleanText(
        listRecord.listStatus
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

    listDeadline:
      cleanText(
        listRecord.listDeadline
      ),

    detailDeadline:
      cleanText(
        detailDeadline
      ),

    deadlineConflict,

    opportunityType:
      cleanText(
        opportunityType
      ),

    description:
      cleanText(
        description
      ),

    sourceAgency:
      "European Union Agency for the Space Programme (EUSPA)",

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

  parts.push(
    "Contracting authority: European Union Agency for the Space Programme (EUSPA)"
  );

  if (
    record.sourceCategory
  ) {
    parts.push(
      `Procurement category: ${record.sourceCategory}`
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
    record.opportunityType
  ) {
    parts.push(
      `Opportunity type: ${record.opportunityType}`
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
      "All Current Planned Procurements",
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
        36
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
        "sourceCategory",

      key:
        "sourceCategory",

      width:
        38
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
        20
    },

    {
      header:
        "detailStatus",

      key:
        "detailStatus",

      width:
        20
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
        26
    },

    {
      header:
        "listDeadline",

      key:
        "listDeadline",

      width:
        26
    },

    {
      header:
        "detailDeadline",

      key:
        "detailDeadline",

      width:
        26
    },

    {
      header:
        "deadlineConflict",

      key:
        "deadlineConflict",

      width:
        18
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
        50
    },

    {
      header:
        "detailPageUrl",

      key:
        "detailPageUrl",

      width:
        70
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
      "T1"
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

      const statusConflictCell =
        row.getCell(
          7
        );

      if (
        statusConflictCell.value ===
        "Yes"
      ) {
        statusConflictCell.fill = {
          type:
            "pattern",

          pattern:
            "solid",

          fgColor: {
            argb:
              "FFFFC7CE"
          }
        };
      }

      const deadlineConflictCell =
        row.getCell(
          12
        );

      if (
        deadlineConflictCell.value ===
        "Yes"
      ) {
        deadlineConflictCell.fill = {
          type:
            "pattern",

          pattern:
            "solid",

          fgColor: {
            argb:
              "FFFFC7CE"
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
    `EUSPA_Current_Planned_Procurements_${today}.xlsx`;

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
      await getMasterList();

    if (
      masterList.length === 0
    ) {
      throw new Error(
        "No current/planned procurements found."
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
        listRecord.sourceCategory
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
        `Deadline used: ${details.submissionDeadline || "not found"}`
      );

      console.log(
        `List deadline: ${details.listDeadline || "not found"}`
      );

      console.log(
        `Detail deadline: ${details.detailDeadline || "not found"}`
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
        details.deadlineConflict ===
        "Yes"
      ) {
        console.log(
          `DEADLINE DIFFERENCE: list=${details.listDeadline} / detail=${details.detailDeadline}`
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
    // QUALITY SUMMARY
    // =================================================

    const ongoing =
      records.filter(
        record =>
          record.sourceCategory ===
          "Ongoing Procurement"
      ).length;

    const prior =
      records.filter(
        record =>
          record.sourceCategory ===
          "Prior Information Notice / Consultation"
      ).length;

    const planned =
      records.filter(
        record =>
          record.sourceCategory ===
          "Planned Low/Middle Value Procurement"
      ).length;

    const missingPostDates =
      records.filter(
        record =>
          !record.postDate
      ).length;

    const missingStatuses =
      records.filter(
        record =>
          !record.status
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

    const statusConflicts =
      records.filter(
        record =>
          record.statusConflict ===
          "Yes"
      ).length;

    const deadlineConflicts =
      records.filter(
        record =>
          record.deadlineConflict ===
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
      `Total records: ${records.length}`
    );

    console.log(
      `Ongoing: ${ongoing}`
    );

    console.log(
      `Prior information notices / consultations: ${prior}`
    );

    console.log(
      `Planned low/middle value: ${planned}`
    );

    console.log(
      `Missing post dates: ${missingPostDates}`
    );

    console.log(
      `Missing statuses: ${missingStatuses}`
    );

    console.log(
      `Missing deadlines: ${missingDeadlines}`
    );

    console.log(
      `Missing opportunity types: ${missingTypes}`
    );

    console.log(
      `Status differences: ${statusConflicts}`
    );

    console.log(
      `Deadline differences: ${deadlineConflicts}`
    );

    console.log("");
    console.log(
      "Excel created:"
    );

    console.log(
      output
    );


    // =================================================
    // DELETE CHECKPOINT AFTER SUCCESS
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