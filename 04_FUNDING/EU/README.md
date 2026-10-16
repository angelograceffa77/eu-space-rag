# EU funding collector folder convention

Keep one folder per official source under `04_FUNDING/EU`. Use its recognizable official name or acronym, with hyphens between words. Avoid spaces, version numbers, dates and phase numbers in folder names: the location should remain stable when implementation order or versions change.

Current collector: `EU-Funding-Tenders-Portal`.

Future source names: `CORDIS`, `EUSPA`, `DG-DEFIS`, `EUDIS`, `CASSINI`, `CINEA`, `DG-CONNECT`, `EIC`, `Interreg`, `Kohesio`, `TED`. These are naming examples only; those collectors have not been created.

Each source owns its code, dependencies and outputs:

```text
04_FUNDING/
  EU/
    README.md                       this convention
    EU-Funding-Tenders-Portal/
      README.md                     source setup and run commands
      VALIDATION.md
      package.json
      package-lock.json
      scrapers/
      tests/
      evidence/                     validation evidence
      node_modules/                 installed dependencies, not published
      raw/                          created when a collector runs
      checkpoints/                  created when a collector runs
      logs/                         created when a collector runs
      generated/                    created when a collector runs
```

Keep original evidence and source-generated data within the owning source folder. Use run IDs inside raw/snapshot directories, not in the source folder name. Put any future cross-source consolidated dataset in a separately documented shared location rather than mixing it into a source collector.

## Run the installed first collector

```powershell
Set-Location -LiteralPath 'C:\Users\angel\OneDrive\Desktop\knowledge\eu-space-rag\04_FUNDING\EU\EU-Funding-Tenders-Portal'
node .\scrapers\scrape-eu-funding-tenders.js --mode all --since 2020
```

Dependencies were already installed during item 1. After downloading a clean copy, run `npm.cmd ci --ignore-scripts --no-audit --no-fund` first.

Migration: the item 1 `scrapers`, `tests`, `evidence`, `node_modules`, `.gitignore`, `package.json`, `package-lock.json`, `README.md` and `VALIDATION.md` moved from `EU/` into `EU/EU-Funding-Tenders-Portal/`. No datasets were deleted. The new EU-level README documents this convention; the source README contains the updated commands.

Scope remains Phase 1 item 1. CORDIS awaits permission.
