const axios = require("axios");
const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");

const BASE_URL =
  "https://esastar-esamatch-ext.sso.esa.int/api/tenders/filter";

const PAGE_SIZE = 10;
const CHECKPOINT_EVERY = 200;

const OUTPUT_FOLDER =
  "C:\\Users\\angel\\OneDrive\\Desktop\\knowledge\\eu-space-rag\\03_PROCUREMENT\\ESA\\Operational documents\\Procurement Data";

const CHECKPOINT_FILE =
  path.join(
    OUTPUT_FOLDER,
    "esa-tenders-checkpoint.json"
  );

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


// =====================================================
// RETRY AUTOMATICO
// =====================================================

async function getPage(start) {
  const url =
    `${BASE_URL}/${PAGE_SIZE}/${start}`;

  let attempt = 1;

  while (true) {
    try {
      const response = await axios.get(url, {
        params: {
          sortBy: "LastUpdateTime",
          sortDir: 1,
          isEsaTenderAction: true
        },

        timeout: 60000,

        headers: {
          "User-Agent": "Mozilla/5.0"
        }
      });

      return response.data;

    } catch (error) {
      console.log("");

      console.log(
        `Connection error at ${start}. Retry ${attempt}...`
      );

      console.log(
        "Waiting 10 seconds before retry..."
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
  tenders,
  nextStart,
  total
) {
  const checkpoint = {
    savedAt: new Date().toISOString(),
    nextStart,
    total,
    tenders
  };

  fs.writeFileSync(
    CHECKPOINT_FILE,
    JSON.stringify(checkpoint),
    "utf8"
  );

  console.log("");
  console.log(
    `CHECKPOINT SAVED: ${tenders.length} / ${total}`
  );
  console.log("");
}


function loadCheckpoint() {
  if (
    !fs.existsSync(CHECKPOINT_FILE)
  ) {
    return null;
  }

  try {
    const raw =
      fs.readFileSync(
        CHECKPOINT_FILE,
        "utf8"
      );

    return JSON.parse(raw);

  } catch (error) {
    console.log(
      "Checkpoint exists but could not be read."
    );

    return null;
  }
}


// =====================================================
// DOWNLOAD TUTTI I TENDER
// =====================================================

async function downloadTenders() {
  let allTenders = [];
  let start = 0;
  let total = null;

  const checkpoint =
    loadCheckpoint();

  if (checkpoint) {
    allTenders =
      checkpoint.tenders || [];

    start =
      checkpoint.nextStart || 0;

    total =
      checkpoint.total || null;

    console.log("");
    console.log("CHECKPOINT FOUND");

    console.log(
      `Resuming from ${start}`
    );

    console.log(
      `Already downloaded: ${allTenders.length}`
    );

    console.log("");
  }


  while (
    total === null ||
    start < total
  ) {
    console.log(
      `Downloading ${start}...`
    );

    const data =
      await getPage(start);

    if (total === null) {
      total = data.total;

      console.log(
        `Total tenders: ${total}`
      );
    }

    const items =
      data.items || [];

    console.log(
      `Found: ${items.length}`
    );

    if (items.length === 0) {
      console.log(
        "No records returned. Waiting and retrying..."
      );

      await sleep(10000);

      continue;
    }

    allTenders.push(...items);

    start += PAGE_SIZE;

    console.log(
      `Downloaded ${allTenders.length} / ${total}`
    );

    if (
      allTenders.length %
        CHECKPOINT_EVERY ===
      0
    ) {
      saveCheckpoint(
        allTenders,
        start,
        total
      );
    }

    await sleep(500);
  }

  saveCheckpoint(
    allTenders,
    start,
    total
  );

  return allTenders;
}


// =====================================================
// CLEAN TEXT
// =====================================================

function cleanText(text) {
  if (!text) return "";

  return String(text)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<li>/gi, "- ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}


// =====================================================
// RAG TEXT
// =====================================================

function createRagText(tender) {
  const parts = [];

  parts.push(
    "Source: ESA esa-match"
  );

  if (tender.tenderTitle) {
    parts.push(
      `Tender title: ${tender.tenderTitle}`
    );
  }

  if (tender.tenderNumber) {
    parts.push(
      `Tender number: ${tender.tenderNumber}`
    );
  }

  if (tender.tenderStatus) {
    parts.push(
      `Status: ${tender.tenderStatus}`
    );
  }

  if (tender.tenderType) {
    parts.push(
      `Tender type: ${tender.tenderType}`
    );
  }

  if (tender.directorate) {
    parts.push(
      `Directorate: ${tender.directorate}`
    );
  }

  if (tender.programmeReference) {
    parts.push(
      `Programme reference: ${tender.programmeReference}`
    );
  }

  if (tender.entityName) {
    parts.push(
      `Issuing entity: ${tender.entityName}`
    );
  }

  if (tender.entityCode) {
    parts.push(
      `ESA entity code: ${tender.entityCode}`
    );
  }

  if (
    tender.procurementActionClassification
  ) {
    parts.push(
      `Procurement classification: ${tender.procurementActionClassification}`
    );
  }

  if (
    tender.tenderFirstPublicationDate
  ) {
    parts.push(
      `First publication date: ${tender.tenderFirstPublicationDate}`
    );
  }

  if (tender.tenderDescription) {
    parts.push(
      `Description: ${cleanText(tender.tenderDescription)}`
    );
  }

  return parts.join("\n");
}


// =====================================================
// CREA FOGLIO EXCEL
// =====================================================

function createSheet(
  workbook,
  sheetName,
  tenders
) {
  const sheet =
    workbook.addWorksheet(
      sheetName,
      {
        views: [
          {
            state: "frozen",
            ySplit: 1
          }
        ]
      }
    );

  sheet.columns = [
    {
      header: "id",
      key: "id",
      width: 10
    },
    {
      header: "tenderTitle",
      key: "tenderTitle",
      width: 42
    },
    {
      header: "tenderNumber",
      key: "tenderNumber",
      width: 16
    },
    {
      header: "tenderDescription",
      key: "tenderDescription",
      width: 60
    },
    {
      header: "tenderStatus",
      key: "tenderStatus",
      width: 12
    },
    {
      header: "tenderTypeId",
      key: "tenderTypeId",
      width: 12
    },
    {
      header: "tenderType",
      key: "tenderType",
      width: 24
    },
    {
      header: "directorate",
      key: "directorate",
      width: 28
    },
    {
      header: "programmeReference",
      key: "programmeReference",
      width: 26
    },
    {
      header: "issuingEntityId",
      key: "issuingEntityId",
      width: 16
    },
    {
      header: "interactType",
      key: "interactType",
      width: 14
    },
    {
      header: "tenderFirstPublicationDate",
      key: "tenderFirstPublicationDate",
      width: 21
    },
    {
      header: "entityName",
      key: "entityName",
      width: 32
    },
    {
      header: "entityCode",
      key: "entityCode",
      width: 18
    },
    {
      header: "isFavourite",
      key: "isFavourite",
      width: 12
    },
    {
      header: "procurementActionClassification",
      key: "procurementActionClassification",
      width: 24
    },
    {
      header: "ragText",
      key: "ragText",
      width: 90
    }
  ];


  tenders.forEach(tender => {
    sheet.addRow({
      ...tender,

      tenderDescription:
        cleanText(
          tender.tenderDescription
        ),

      ragText:
        createRagText(tender)
    });
  });


  const headerRow =
    sheet.getRow(1);

  headerRow.height = 30;

  headerRow.eachCell(cell => {
    cell.font = {
      bold: true,
      color: {
        argb: "FFFFFFFF"
      }
    };

    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: {
        argb: "FF1F4E78"
      }
    };

    cell.alignment = {
      vertical: "middle",
      horizontal: "center",
      wrapText: true
    };
  });


  sheet.autoFilter = {
    from: "A1",
    to: "Q1"
  };


  sheet.eachRow(
    (row, rowNumber) => {
      if (rowNumber === 1) {
        return;
      }

      row.height = 36;

      row.eachCell(cell => {
        cell.alignment = {
          vertical: "top",
          wrapText: true
        };
      });

      const statusCell =
        row.getCell(5);

      if (
        statusCell.value ===
        "Issued"
      ) {
        statusCell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: {
            argb: "FFE2F0D9"
          }
        };

        statusCell.font = {
          bold: true,
          color: {
            argb: "FF375623"
          }
        };
      }

      if (
        statusCell.value ===
        "Intended"
      ) {
        statusCell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: {
            argb: "FFFFF2CC"
          }
        };

        statusCell.font = {
          bold: true,
          color: {
            argb: "FF7F6000"
          }
        };
      }
    }
  );

  return sheet;
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
          recursive: true
        }
      );
    }


    const allTenders =
      await downloadTenders();


    const esaTenders =
      allTenders.filter(
        tender =>
          tender.tenderType ===
          "ESA Tender Actions"
      );


    const nonEsaTenders =
      allTenders.filter(
        tender =>
          tender.tenderType ===
          "Non ESA Tender Actions"
      );


    const workbook =
      new ExcelJS.Workbook();

    workbook.creator =
      "ESA Tender Downloader";

    workbook.created =
      new Date();


    createSheet(
      workbook,
      "All Tender Actions",
      allTenders
    );


    createSheet(
      workbook,
      "ESA",
      esaTenders
    );


    createSheet(
      workbook,
      "Non ESA",
      nonEsaTenders
    );


    const today =
      new Date()
        .toISOString()
        .slice(0, 10);


    const filename =
      `ESA_Tender_Actions_${today}.xlsx`;


    const fullPath =
      path.join(
        OUTPUT_FOLDER,
        filename
      );


    console.log("");
    console.log(
      "Creating Excel file..."
    );


    await workbook.xlsx.writeFile(
      fullPath
    );


    console.log("");
    console.log("DONE!");

    console.log(
      `Total: ${allTenders.length}`
    );

    console.log(
      `ESA: ${esaTenders.length}`
    );

    console.log(
      `Non ESA: ${nonEsaTenders.length}`
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

    console.log(
      "Run the script again to resume."
    );
  }
}


main();