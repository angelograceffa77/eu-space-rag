const axios = require("axios");
const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");

const BASE_URL =
  "https://esastar-esamatch-ext.sso.esa.int/api/companiesDirectory/filter";

const PAGE_SIZE = 10;

// Salva un checkpoint ogni 500 aziende
const CHECKPOINT_EVERY = 500;

// Defaults to this script's folder; override for isolated validation runs.
const OUTPUT_FOLDER = process.env.ESA_OUTPUT_DIR || __dirname;
const { exportSnapshot, readJsonlFiles } = require("./company-export");

const CHECKPOINT_FILE =
  path.join(
    OUTPUT_FOLDER,
    "esa-companies-checkpoint.json"
  );

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


// ======================================================
// DOWNLOAD PAGINA ESA
// Se la connessione cade, riprova automaticamente
// ======================================================

async function getPage(start) {
  const url =
    `${BASE_URL}/${PAGE_SIZE}/${start}`;

  let attempt = 1;

  while (true) {
    try {
      const response = await axios.get(url, {
        params: {
          sortBy: "LastUpdateTime"
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


// ======================================================
// CHECKPOINT
// ======================================================

function saveCheckpoint(
  companies,
  nextStart,
  total
) {
  const checkpoint = {
    savedAt: new Date().toISOString(),
    nextStart,
    total,
    companies
  };

  fs.writeFileSync(
    CHECKPOINT_FILE + ".tmp",
    JSON.stringify(checkpoint),
    "utf8"
  );

  console.log("");
  fs.renameSync(CHECKPOINT_FILE + ".tmp", CHECKPOINT_FILE);
  console.log(
    `CHECKPOINT SAVED: ${companies.length} / ${total}`
  );
  console.log("");
}


function loadCheckpoint() {
  if (!fs.existsSync(CHECKPOINT_FILE)) {
    return null;
  }

  try {
    const raw =
      fs.readFileSync(
        CHECKPOINT_FILE,
        "utf8"
      );

    const checkpoint = JSON.parse(raw);
    if (!Array.isArray(checkpoint.companies) || !Number.isSafeInteger(checkpoint.total) ||
        !Number.isSafeInteger(checkpoint.nextStart) || checkpoint.nextStart < 0 || checkpoint.total < 0 ||
        checkpoint.companies.length !== Math.min(checkpoint.nextStart, checkpoint.total)) {
      throw new Error("Invalid checkpoint");
    }
    return checkpoint;

  } catch (error) {
    console.log(
      "Checkpoint exists but could not be read."
    );

    throw error;
  }
}


// ======================================================
// DOWNLOAD TUTTE LE AZIENDE
// ======================================================

async function downloadCompanies() {
  let allCompanies = [];
  let start = 0;
  let total = null;

  const checkpoint =
    loadCheckpoint();

  if (checkpoint) {
    allCompanies =
      checkpoint.companies || [];

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
      `Already downloaded: ${allCompanies.length}`
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

    if (!Number.isSafeInteger(data.total) || data.total < 0 || !Array.isArray(data.items)) {
      throw new Error("Invalid ESA page response; nothing published");
    }
    if (total !== null && total !== data.total) throw new Error("ESA total changed during download; restart with a fresh checkpoint");
    if (total === null) {
      total = data.total;

      console.log(
        `Total companies/entities: ${total}`
      );
    }

    const items =
      data.items || [];

    console.log(
      `Found: ${items.length}`
    );

    if (items.length !== Math.min(PAGE_SIZE, total - start)) {
      throw new Error("Incomplete ESA page; checkpoint preserved, nothing published");
    }

    allCompanies.push(...items);

    start += PAGE_SIZE;

    console.log(
      `Downloaded ${allCompanies.length} / ${total}`
    );

    if (
      allCompanies.length %
        CHECKPOINT_EVERY ===
      0
    ) {
      saveCheckpoint(
        allCompanies,
        start,
        total
      );
    }

    // Piccola pausa per non sovraccaricare ESA
    await sleep(500);
  }

  if (allCompanies.length !== total) throw new Error("Downloaded count does not match ESA total");
  const profileIds = allCompanies.map(c => c.companyProfileId);
  if (profileIds.some(id => id == null) || new Set(profileIds).size !== profileIds.length) {
    throw new Error("Missing or duplicate profile IDs; restart download with a fresh checkpoint");
  }
  // Ultimo checkpoint prima dell'Excel
  saveCheckpoint(
    allCompanies,
    start,
    total
  );

  return allCompanies;
}


// ======================================================
// PULIZIA HTML
// ======================================================

function cleanHtml(text) {
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

    .replace(/&#(\d+);/g, (match, dec) =>
      String.fromCharCode(dec)
    )

    .replace(/\n{3,}/g, "\n\n")

    .replace(/[ \t]{2,}/g, " ")

    .trim();
}


// ======================================================
// CREA TESTO OTTIMIZZATO PER IL RAG
// ======================================================

function createRagText(company) {
  const description =
    cleanHtml(
      company.entityDescription ||
      company.description
    );

  const parts = [];

  if (company.entityName) {
    parts.push(
      `Company or organisation: ${company.entityName}`
    );
  }

  if (company.entityCode) {
    parts.push(
      `ESA Entity Code: ${company.entityCode}`
    );
  }

  if (company.countryOfRegistration) {
    parts.push(
      `Country of registration: ${company.countryOfRegistration}`
    );
  }

  if (
    company.nationality &&
    company.nationality !==
      company.countryOfRegistration
  ) {
    parts.push(
      `Nationality: ${company.nationality}`
    );
  }

  if (company.city) {
    parts.push(
      `City: ${company.city}`
    );
  }

  if (company.smestatus) {
    parts.push(
      `ESA SME status: ${company.smestatus}`
    );
  }

  if (company.smelsi) {
    parts.push(
      `LSI status: ${company.smelsi}`
    );
  }

  if (
    company.isLegalEntity !==
    undefined &&
    company.isLegalEntity !==
    null
  ) {
    parts.push(
      `Legal entity: ${
        company.isLegalEntity
          ? "Yes"
          : "No"
      }`
    );
  }

  if (company.entityStatus) {
    parts.push(
      `ESA entity status: ${company.entityStatus}`
    );
  }

  if (company.isEsaAmbassador) {
    parts.push(
      "ESA Ambassador: Yes"
    );
  }

  if (
    company.isEsaTechnologyBroker
  ) {
    parts.push(
      "ESA Technology Broker: Yes"
    );
  }

  if (
    company.isSupportedByScaleUp
  ) {
    parts.push(
      "Supported by ESA ScaleUp: Yes"
    );
  }

  if (company.startUpAttribute) {
    parts.push(
      `Startup attribute: ${company.startUpAttribute}`
    );
  }

  if (
    company.entityNameLegalEntity &&
    company.entityNameLegalEntity !==
      company.entityName
  ) {
    parts.push(
      `Parent legal entity: ${company.entityNameLegalEntity}`
    );
  }

  if (company.webSite) {
    parts.push(
      `Website: ${company.webSite}`
    );
  }

  if (description) {
    parts.push(
      `Company description: ${description}`
    );
  }

  return parts.join("\n");
}


// ======================================================
// CREA FOGLIO EXCEL
// ======================================================

function createSheet(
  workbook,
  sheetName,
  companies
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
      header: "companyProfileId",
      key: "companyProfileId",
      width: 16
    },

    {
      header: "entityId",
      key: "entityId",
      width: 14
    },

    {
      header: "entityName",
      key: "entityName",
      width: 38
    },

    {
      header: "description",
      key: "description",
      width: 35
    },

    {
      header: "entityDescription",
      key: "entityDescription",
      width: 60
    },

    {
      header: "entityCode",
      key: "entityCode",
      width: 18
    },

    {
      header: "businessUnitCode",
      key: "businessUnitCode",
      width: 18
    },

    {
      header: "smestatus",
      key: "smestatus",
      width: 12
    },

    {
      header: "smelsi",
      key: "smelsi",
      width: 12
    },

    {
      header: "address",
      key: "address",
      width: 28
    },

    {
      header: "number",
      key: "number",
      width: 10
    },

    {
      header: "city",
      key: "city",
      width: 22
    },

    {
      header: "nationality",
      key: "nationality",
      width: 22
    },

    {
      header: "countryOfRegistration",
      key: "countryOfRegistration",
      width: 24
    },

    {
      header: "postalCode",
      key: "postalCode",
      width: 14
    },

    {
      header: "entityStatus",
      key: "entityStatus",
      width: 16
    },

    {
      header: "isLegalEntity",
      key: "isLegalEntity",
      width: 14
    },

    {
      header: "isEsaAmbassador",
      key: "isEsaAmbassador",
      width: 16
    },

    {
      header: "isEsaTechnologyBroker",
      key: "isEsaTechnologyBroker",
      width: 20
    },

    {
      header: "isSupportedByScaleUp",
      key: "isSupportedByScaleUp",
      width: 20
    },

    {
      header: "webSite",
      key: "webSite",
      width: 35
    },

    {
      header: "companyProfileIdIsLegalEntity",
      key: "companyProfileIdIsLegalEntity",
      width: 24
    },

    {
      header: "entityNameLegalEntity",
      key: "entityNameLegalEntity",
      width: 34
    },

    {
      header: "entityCodeLegalEntity",
      key: "entityCodeLegalEntity",
      width: 22
    },

    {
      header: "entityWebSite",
      key: "entityWebSite",
      width: 35
    },

    {
      header: "startUpAttribute",
      key: "startUpAttribute",
      width: 18
    },

    // NUOVA COLONNA PER IL RAG
    {
      header: "ragText",
      key: "ragText",
      width: 80
    }
  ];


  companies.forEach(company => {

    const cleanDescription =
      cleanHtml(
        company.description
      );

    const cleanEntityDescription =
      cleanHtml(
        company.entityDescription
      );

    sheet.addRow({
      ...company,

      description:
        cleanDescription,

      entityDescription:
        cleanEntityDescription,

      ragText:
        createRagText(company)
    });
  });


  // ====================================================
  // FORMATTAZIONE HEADER
  // ====================================================

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


  // ====================================================
  // FILTRI
  // Ora arriviamo fino alla colonna AA
  // ====================================================

  sheet.autoFilter = {
    from: "A1",
    to: "AA1"
  };


  // ====================================================
  // FORMATTAZIONE RIGHE
  // ====================================================

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


      // SME = verde
      const smeCell =
        row.getCell(8);

      if (
        smeCell.value === "Yes"
      ) {
        smeCell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: {
            argb: "FFE2F0D9"
          }
        };

        smeCell.font = {
          bold: true,
          color: {
            argb: "FF375623"
          }
        };
      }
    }
  );

  return sheet;
}


// ======================================================
// MAIN
// ======================================================

async function main() {
  try {

    // Crea la cartella se non esiste
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


    const args = process.argv.slice(2);
    const offline = args[0] === "--from-jsonl";
    if (args.length && (!offline || args.length < 2)) {
      throw new Error("Usage: node esa-companies.js [--from-jsonl file1.jsonl file2.jsonl ...]");
    }
    if (offline && !process.env.ESA_SOURCE_DATE) throw new Error("Offline import requires ESA_SOURCE_DATE=YYYY-MM-DD");
    const sourceFiles = offline ? args.slice(1) : [];
    const allCompanies = offline ? readJsonlFiles(sourceFiles) : await downloadCompanies();
    // Offline migration preserves existing JSONL records exactly (no repeated HTML cleaning).
    const records = offline ? allCompanies : allCompanies.map(company => ({
      ...company, description: cleanHtml(company.description),
      entityDescription: cleanHtml(company.entityDescription), ragText: createRagText(company)
    }));



    const smeCompanies =
      allCompanies.filter(
        company =>
          company.smestatus ===
          "Yes"
      );


    const legalEntities =
      allCompanies.filter(
        company =>
          company.isLegalEntity ===
          true
      );


    const workbook =
      new ExcelJS.Workbook();


    workbook.creator =
      "ESA Companies Downloader";


    workbook.created =
      new Date();


    createSheet(
      workbook,
      "All Companies",
      allCompanies
    );


    createSheet(
      workbook,
      "SMEs",
      smeCompanies
    );


    createSheet(
      workbook,
      "Legal Entities",
      legalEntities
    );


    const today =
      process.env.ESA_SOURCE_DATE || new Date().toISOString().slice(0, 10);


    const filename =
      `ESA_Companies_${today}.xlsx`;


    console.log("");
    console.log(
      "Creating Excel file..."
    );


    const manifest = await exportSnapshot(records, {
      outputDir: OUTPUT_FOLDER, sourceDate: today,
      sourceFiles: sourceFiles.map(filename => ({ filename: path.basename(filename),
        sha256: require("node:crypto").createHash("sha256").update(fs.readFileSync(filename)).digest("hex") })),
      writeWorkbook: filename => workbook.xlsx.writeFile(filename)
    });
    console.log(`Published ${manifest.parts.length} JSONL parts via esa-companies-manifest.json`);

    console.log("");
    console.log("DONE!");

    console.log(
      `Total companies/entities: ${allCompanies.length}`
    );

    console.log(
      `SMEs: ${smeCompanies.length}`
    );

    console.log(
      `Legal entities: ${legalEntities.length}`
    );

    console.log("");

    console.log(
      "File created:"
    );

    console.log(
      path.join(OUTPUT_FOLDER, manifest.generation, filename)
    );


    // Cancella checkpoint SOLO
    // se Excel è stato creato correttamente

    if (
      !offline && fs.existsSync(
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
    process.exitCode = 1;
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


if (require.main === module) main();
module.exports = { cleanHtml, createRagText, createSheet, downloadCompanies };