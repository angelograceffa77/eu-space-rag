const axios = require("axios");
const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");


// =====================================================
// OFFICIAL ESA SOURCES
// =====================================================

const ESA_URL =
  "https://esastar-publication-ext.sso.esa.int/api/tenderAction/filter";

const NON_ESA_URL =
  "https://esastar-publication-ext.sso.esa.int/api/nonESATA/filter";

const ESA_PUBLIC_PAGE =
  "https://esastar-publication-ext.sso.esa.int/ESATenderActions/filter/open";

const NON_ESA_PUBLIC_PAGE =
  "https://esastar-publication-ext.sso.esa.int/nonEsaTenderActions/filter/open";


// =====================================================
// SETTINGS
// =====================================================

const PAGE_SIZE = 10;

const CHECKPOINT_EVERY = 200;

const OUTPUT_FOLDER =
  "C:\\Users\\angel\\OneDrive\\Desktop\\knowledge\\eu-space-rag\\03_PROCUREMENT\\ESA\\Operational documents\\Procurement Data";

const CHECKPOINT_FILE =
  path.join(
    OUTPUT_FOLDER,
    "esa-publication-tenders-checkpoint.json"
  );


// =====================================================
// BASIC UTILITIES
// =====================================================

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


function cleanText(text) {

  if (!text) {
    return "";
  }

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


function idsToString(array) {

  if (!Array.isArray(array)) {
    return "";
  }

  return array
    .map(item => item?.id)
    .filter(value => value !== undefined && value !== null)
    .join(", ");
}


// =====================================================
// OFFICIAL STATUS LABELS
//
// These are kept separate from the raw statusId.
// If an unknown value appears, the raw ID is retained.
// =====================================================

function statusLabel(statusId) {

  const labels = {
    1: "Intended",
    2: "Issued",
    5: "Closed",
    6: "Closed"
  };

  return labels[statusId] || "";
}


// =====================================================
// NETWORK RETRY
// =====================================================

async function getPage(baseUrl, start) {

  const url =
    `${baseUrl}/${PAGE_SIZE}/${start}`;

  let attempt = 1;

  while (true) {

    try {

      const response =
        await axios.get(
          url,
          {
            params: {
              tType: 5,
              isF: false,
              isA: false,
              sortBy: "LastUpdateTime",
              sortDir: 1
            },

            timeout: 60000,

            headers: {
              "User-Agent": "Mozilla/5.0"
            }
          }
        );

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

function saveCheckpoint(data) {

  fs.writeFileSync(
    CHECKPOINT_FILE,
    JSON.stringify(
      {
        savedAt:
          new Date().toISOString(),

        ...data
      }
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
// DOWNLOAD ONE DATASET
// =====================================================

async function downloadDataset(
  name,
  baseUrl,
  initialRecords = [],
  initialStart = 0,
  initialTotal = null,
  checkpointCallback = null
) {

  const records =
    [...initialRecords];

  let start =
    initialStart;

  let total =
    initialTotal;

  console.log("");
  console.log(
    "================================"
  );

  console.log(
    `DOWNLOADING ${name}`
  );

  console.log(
    "================================"
  );

  if (start > 0) {

    console.log(
      `Resuming from ${start}`
    );

    console.log(
      `Already downloaded: ${records.length}`
    );
  }


  while (
    total === null ||
    start < total
  ) {

    console.log(
      `${name}: downloading ${start}...`
    );

    const data =
      await getPage(
        baseUrl,
        start
      );

    if (total === null) {

      total =
        data.total;

      console.log(
        `${name} total: ${total}`
      );
    }


    const items =
      data.items || [];


    if (
      items.length === 0
    ) {

      console.log(
        "No records returned. Waiting 10 seconds..."
      );

      await sleep(10000);

      continue;
    }


    records.push(
      ...items
    );


    start +=
      PAGE_SIZE;


    console.log(
      `${name}: ${records.length} / ${total}`
    );


    if (
      checkpointCallback &&
      records.length %
        CHECKPOINT_EVERY ===
      0
    ) {

      checkpointCallback(
        records,
        start,
        total
      );
    }


    await sleep(500);
  }


  return {
    records,
    start,
    total
  };
}


// =====================================================
// NORMALISE ESA
// =====================================================

function normalizeESA(item) {

  const statusId =
    item.status?.id ?? "";

  const tenderTypeId =
    item.tenderType?.id ?? "";

  return {

    sourceType:
      "ESA Tender Action",

    sourceSystem:
      "ESA esa-star Publication",

    sourcePage:
      ESA_PUBLIC_PAGE,

    id:
      item.id ?? "",

    idEra:
      item.idEra ?? "",

    activityNumber:
      item.activityNumber || "",

    contractNumber:
      "",

    tanumber:
      item.tanumber || "",

    title:
      item.title || "",

    description:
      cleanText(
        item.description
      ),

    programmeReference:
      item.programmeReference || "",

    priceRange:
      "",

    firstPublicationDate:
      item.firstPublicationDate || "",

    openDate:
      item.openDate || "",

    closingDate:
      item.closingDate || "",

    clarificationRequestDeadline:
      item.clarificationRequestDeadline || "",

    extensionRequestDeadline:
      item.extensionRequestDeadline || "",

    lastUpdateTime:
      "",

    updateReason:
      "",

    externalEntityName:
      "",

    externalEntityCode:
      "",

    externalEntityId:
      "",

    countryIds:
      idsToString(
        item.countries
      ),

    productIds:
      idsToString(
        item.products
      ),

    technologyIds:
      idsToString(
        item.technologies
      ),

    statusId,

    statusLabel:
      statusLabel(
        statusId
      ),

    tenderTypeId,

    isArchived:
      Boolean(
        item.isArchived
      ),

    isCancelled:
      Boolean(
        item.isCancelled
      ),

    isReissued:
      Boolean(
        item.isReissued
      ),

    isToBeReissued:
      Boolean(
        item.isToBeReissued
      )
  };
}


// =====================================================
// NORMALISE NON ESA
// =====================================================

function normalizeNonESA(item) {

  const statusId =
    item.status?.id ?? "";

  const tenderTypeId =
    item.tenderType?.id ?? "";

  return {

    sourceType:
      "Non ESA Tender Action",

    sourceSystem:
      "ESA esa-star Publication",

    sourcePage:
      NON_ESA_PUBLIC_PAGE,

    id:
      item.id ?? "",

    idEra:
      item.idEra ?? "",

    activityNumber:
      "",

    contractNumber:
      item.contractNumber || "",

    tanumber:
      item.tanumber || "",

    title:
      item.title || "",

    description:
      cleanText(
        item.abstract
      ),

    programmeReference:
      item.programmeReference || "",

    priceRange:
      item.priceRange || "",

    firstPublicationDate:
      item.firstPublicationDate || "",

    openDate:
      item.openDate || "",

    closingDate:
      item.closingDate || "",

    clarificationRequestDeadline:
      item.clarificationRequestDeadline || "",

    extensionRequestDeadline:
      item.extensionRequestDeadline || "",

    lastUpdateTime:
      item.lastUpdateTime || "",

    updateReason:
      item.updateReason || "",

    externalEntityName:
      item.externalEntity?.entityName || "",

    externalEntityCode:
      item.externalEntity?.entityCode || "",

    externalEntityId:
      item.externalEntity?.entityId || "",

    countryIds:
      idsToString(
        item.countries
      ),

    productIds:
      idsToString(
        item.products
      ),

    technologyIds:
      idsToString(
        item.technologies
      ),

    statusId,

    statusLabel:
      statusLabel(
        statusId
      ),

    tenderTypeId,

    isArchived:
      Boolean(
        item.isArchived
      ),

    isCancelled:
      Boolean(
        item.isCancelled
      ),

    isReissued:
      Boolean(
        item.isReissued
      ),

    isToBeReissued:
      Boolean(
        item.isToBeReissued
      )
  };
}


// =====================================================
// RAG TEXT
// =====================================================

function createRagText(record) {

  const parts = [];


  parts.push(
    `Source: ${record.sourceSystem}`
  );


  parts.push(
    `Tender source type: ${record.sourceType}`
  );


  if (record.title) {

    parts.push(
      `Tender title: ${record.title}`
    );
  }


  if (record.tanumber) {

    parts.push(
      `Tender number: ${record.tanumber}`
    );
  }


  if (record.activityNumber) {

    parts.push(
      `Activity number: ${record.activityNumber}`
    );
  }


  if (record.contractNumber) {

    parts.push(
      `Contract number: ${record.contractNumber}`
    );
  }


  if (record.statusLabel) {

    parts.push(
      `Tender status: ${record.statusLabel}`
    );
  }


  if (record.statusId !== "") {

    parts.push(
      `ESA status ID: ${record.statusId}`
    );
  }


  if (
    record.externalEntityName
  ) {

    parts.push(
      `Issuing organisation: ${record.externalEntityName}`
    );
  }


  if (
    record.externalEntityCode
  ) {

    parts.push(
      `ESA entity code: ${record.externalEntityCode}`
    );
  }


  if (
    record.programmeReference
  ) {

    parts.push(
      `Programme reference: ${record.programmeReference}`
    );
  }


  if (record.priceRange) {

    parts.push(
      `Price range: ${record.priceRange}`
    );
  }


  if (
    record.firstPublicationDate
  ) {

    parts.push(
      `First publication date: ${record.firstPublicationDate}`
    );
  }


  if (record.openDate) {

    parts.push(
      `Open date: ${record.openDate}`
    );
  }


  if (record.closingDate) {

    parts.push(
      `Closing date: ${record.closingDate}`
    );
  }


  if (
    record.clarificationRequestDeadline
  ) {

    parts.push(
      `Clarification request deadline: ${record.clarificationRequestDeadline}`
    );
  }


  if (
    record.extensionRequestDeadline
  ) {

    parts.push(
      `Extension request deadline: ${record.extensionRequestDeadline}`
    );
  }


  if (
    record.lastUpdateTime
  ) {

    parts.push(
      `Last update: ${record.lastUpdateTime}`
    );
  }


  if (
    record.updateReason
  ) {

    parts.push(
      `Update reason: ${record.updateReason}`
    );
  }


  if (record.countryIds) {

    parts.push(
      `ESA country IDs: ${record.countryIds}`
    );
  }


  if (record.productIds) {

    parts.push(
      `ESA product IDs: ${record.productIds}`
    );
  }


  if (
    record.technologyIds
  ) {

    parts.push(
      `ESA technology IDs: ${record.technologyIds}`
    );
  }


  if (record.isArchived) {

    parts.push(
      "Archived: Yes"
    );
  }


  if (record.isCancelled) {

    parts.push(
      "Cancelled: Yes"
    );
  }


  if (record.isReissued) {

    parts.push(
      "Reissued: Yes"
    );
  }


  if (
    record.isToBeReissued
  ) {

    parts.push(
      "To be reissued: Yes"
    );
  }


  if (record.description) {

    parts.push(
      `Description: ${record.description}`
    );
  }


  parts.push(
    `Official source page: ${record.sourcePage}`
  );


  return parts.join("\n");
}


// =====================================================
// EXCEL SHEET
// =====================================================

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
            state: "frozen",
            ySplit: 1
          }
        ]
      }
    );


  sheet.columns = [

    {
      header: "sourceType",
      key: "sourceType",
      width: 22
    },

    {
      header: "sourceSystem",
      key: "sourceSystem",
      width: 24
    },

    {
      header: "sourcePage",
      key: "sourcePage",
      width: 45
    },

    {
      header: "id",
      key: "id",
      width: 12
    },

    {
      header: "idEra",
      key: "idEra",
      width: 12
    },

    {
      header: "activityNumber",
      key: "activityNumber",
      width: 18
    },

    {
      header: "contractNumber",
      key: "contractNumber",
      width: 18
    },

    {
      header: "tanumber",
      key: "tanumber",
      width: 18
    },

    {
      header: "title",
      key: "title",
      width: 45
    },

    {
      header: "description",
      key: "description",
      width: 70
    },

    {
      header: "programmeReference",
      key: "programmeReference",
      width: 28
    },

    {
      header: "priceRange",
      key: "priceRange",
      width: 18
    },

    {
      header: "firstPublicationDate",
      key: "firstPublicationDate",
      width: 22
    },

    {
      header: "openDate",
      key: "openDate",
      width: 22
    },

    {
      header: "closingDate",
      key: "closingDate",
      width: 22
    },

    {
      header: "clarificationRequestDeadline",
      key: "clarificationRequestDeadline",
      width: 25
    },

    {
      header: "extensionRequestDeadline",
      key: "extensionRequestDeadline",
      width: 25
    },

    {
      header: "lastUpdateTime",
      key: "lastUpdateTime",
      width: 22
    },

    {
      header: "updateReason",
      key: "updateReason",
      width: 30
    },

    {
      header: "externalEntityName",
      key: "externalEntityName",
      width: 35
    },

    {
      header: "externalEntityCode",
      key: "externalEntityCode",
      width: 20
    },

    {
      header: "externalEntityId",
      key: "externalEntityId",
      width: 18
    },

    {
      header: "countryIds",
      key: "countryIds",
      width: 30
    },

    {
      header: "productIds",
      key: "productIds",
      width: 25
    },

    {
      header: "technologyIds",
      key: "technologyIds",
      width: 25
    },

    {
      header: "statusId",
      key: "statusId",
      width: 12
    },

    {
      header: "statusLabel",
      key: "statusLabel",
      width: 14
    },

    {
      header: "tenderTypeId",
      key: "tenderTypeId",
      width: 14
    },

    {
      header: "isArchived",
      key: "isArchived",
      width: 14
    },

    {
      header: "isCancelled",
      key: "isCancelled",
      width: 14
    },

    {
      header: "isReissued",
      key: "isReissued",
      width: 14
    },

    {
      header: "isToBeReissued",
      key: "isToBeReissued",
      width: 16
    },

    {
      header: "ragText",
      key: "ragText",
      width: 90
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


  const headerRow =
    sheet.getRow(1);


  headerRow.height = 30;


  headerRow.eachCell(
    cell => {

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
    }
  );


  sheet.autoFilter = {
    from: "A1",
    to: "AG1"
  };


  sheet.eachRow(
    (row, rowNumber) => {

      if (
        rowNumber === 1
      ) {
        return;
      }


      row.height = 38;


      row.eachCell(
        cell => {

          cell.alignment = {
            vertical: "top",
            wrapText: true
          };
        }
      );


      const statusCell =
        row.getCell(27);


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


    let esaRecords = [];
    let esaStart = 0;
    let esaTotal = null;

    let nonEsaRecords = [];
    let nonEsaStart = 0;
    let nonEsaTotal = null;


    const checkpoint =
      loadCheckpoint();


    if (checkpoint) {

      console.log("");
      console.log(
        "CHECKPOINT FOUND"
      );


      esaRecords =
        checkpoint.esaRecords || [];

      esaStart =
        checkpoint.esaStart || 0;

      esaTotal =
        checkpoint.esaTotal || null;


      nonEsaRecords =
        checkpoint.nonEsaRecords || [];

      nonEsaStart =
        checkpoint.nonEsaStart || 0;

      nonEsaTotal =
        checkpoint.nonEsaTotal || null;


      console.log(
        `ESA already downloaded: ${esaRecords.length}`
      );

      console.log(
        `Non ESA already downloaded: ${nonEsaRecords.length}`
      );

      console.log("");
    }


    const esaResult =
      await downloadDataset(

        "ESA",

        ESA_URL,

        esaRecords,

        esaStart,

        esaTotal,

        (
          records,
          start,
          total
        ) => {

          esaRecords =
            records;

          esaStart =
            start;

          esaTotal =
            total;


          saveCheckpoint(
            {
              esaRecords,
              esaStart,
              esaTotal,

              nonEsaRecords,
              nonEsaStart,
              nonEsaTotal
            }
          );
        }
      );


    esaRecords =
      esaResult.records;

    esaStart =
      esaResult.start;

    esaTotal =
      esaResult.total;


    saveCheckpoint(
      {
        esaRecords,
        esaStart,
        esaTotal,

        nonEsaRecords,
        nonEsaStart,
        nonEsaTotal
      }
    );


    const nonEsaResult =
      await downloadDataset(

        "NON ESA",

        NON_ESA_URL,

        nonEsaRecords,

        nonEsaStart,

        nonEsaTotal,

        (
          records,
          start,
          total
        ) => {

          nonEsaRecords =
            records;

          nonEsaStart =
            start;

          nonEsaTotal =
            total;


          saveCheckpoint(
            {
              esaRecords,
              esaStart,
              esaTotal,

              nonEsaRecords,
              nonEsaStart,
              nonEsaTotal
            }
          );
        }
      );


    nonEsaRecords =
      nonEsaResult.records;

    nonEsaStart =
      nonEsaResult.start;

    nonEsaTotal =
      nonEsaResult.total;


    const esa =
      esaRecords.map(
        normalizeESA
      );


    const nonEsa =
      nonEsaRecords.map(
        normalizeNonESA
      );


    const all =
      [
        ...esa,
        ...nonEsa
      ];


    const workbook =
      new ExcelJS.Workbook();


    workbook.creator =
      "ESA Procurement Downloader";


    workbook.created =
      new Date();


    createSheet(
      workbook,
      "All Tender Actions",
      all
    );


    createSheet(
      workbook,
      "ESA Tender Actions",
      esa
    );


    createSheet(
      workbook,
      "Non ESA Tender Actions",
      nonEsa
    );


    const today =
      new Date()
        .toISOString()
        .slice(0, 10);


    const filename =
      `ESA_Publication_Tender_Actions_${today}.xlsx`;


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
      `ESA: ${esa.length}`
    );


    console.log(
      `Non ESA: ${nonEsa.length}`
    );


    console.log(
      `TOTAL: ${all.length}`
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