const axios = require("axios");
const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");

const BASE_URL =
  "https://esastar-esamatch-ext.sso.esa.int/api/companiesDirectory/filter";

const PAGE_SIZE = 10;

// Salva un checkpoint ogni 500 aziende
const CHECKPOINT_EVERY = 500;

// NUOVA CARTELLA
const OUTPUT_FOLDER =
  "C:\\Users\\angel\\OneDrive\\Desktop\\knowledge\\eu-space-rag\\05_COMPANIES";

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
    CHECKPOINT_FILE,
    JSON.stringify(checkpoint),
    "utf8"
  );

  console.log("");
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

    return JSON.parse(raw);

  } catch (error) {
    console.log(
      "Checkpoint exists but could not be read."
    );

    return null;
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

    if (items.length === 0) {
      console.log(
        "No records returned. Waiting and retrying..."
      );

      await sleep(10000);

      continue;
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


    const allCompanies =
      await downloadCompanies();


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
      new Date()
        .toISOString()
        .slice(0, 10);


    const filename =
      `ESA_Companies_${today}.xlsx`;


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
      fullPath
    );


    // Cancella checkpoint SOLO
    // se Excel è stato creato correttamente

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