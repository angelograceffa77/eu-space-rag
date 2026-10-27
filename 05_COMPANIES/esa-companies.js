const axios = require("axios");
const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");

const BASE_URL =
  "https://esastar-esamatch-ext.sso.esa.int/api/companiesDirectory/filter";

const PAGE_SIZE = 100;

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

const requestPage=require('./esa-request.cjs').requester({size:PAGE_SIZE,
 request:async(start,size)=>{
  const failures=path.join(OUTPUT_FOLDER,'large-page-timeouts.json'),known=fs.existsSync(failures)?JSON.parse(fs.readFileSync(failures)):[];
  if(size>10&&known.includes(start))throw Error('Previously timed-out large page; use small-page fallback');
  try{return (await axios.get(`${BASE_URL}/${size}/${start}`,{params:{sortBy:'LastUpdateTime'},timeout:60000,headers:{'User-Agent':'Gagarin-Company-Directory/1.0'}})).data;}
  catch(e){console.log(`ESA page ${start}/${size}: ${e.message}`);if(size>10&&e.code==='ECONNABORTED'&&!known.includes(start)){known.push(start);fs.writeFileSync(failures,JSON.stringify(known));}throw e;}
 },save:(start,size,data)=>{const raw=JSON.stringify(data),hash=require('node:crypto').createHash('sha256').update(raw).digest('hex');const dir=path.join(OUTPUT_FOLDER,'original-pages');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,start+'-'+size+'-'+hash+'.json');if(!fs.existsSync(file))fs.writeFileSync(file,raw,{flag:'wx'});}
});
async function getPage(start){return requestPage(start);}

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
  for(let retry=0;;retry++){try{fs.renameSync(CHECKPOINT_FILE+'.tmp',CHECKPOINT_FILE);break;}catch(e){if(!['EPERM','EACCES','EBUSY'].includes(e.code)||retry>=8)throw e;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,Math.min(100*2**retry,1000));}}
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
 return require('./esa-pagination.cjs').collect({getPage,checkpoint:loadCheckpoint(),pageSize:PAGE_SIZE,workers:3,allowSourceDuplicates:true,onSourceDuplicates:report=>fs.writeFileSync(path.join(OUTPUT_FOLDER,'source-duplicate-reconciliation.json'),JSON.stringify(report,null,2)),onCheckpoint:(rows,next,total)=>{saveCheckpoint(rows,next,total);console.log(`Downloaded ${rows.length} / ${total}`);}});
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