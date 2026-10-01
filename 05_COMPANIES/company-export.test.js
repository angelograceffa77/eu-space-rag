const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { exportSnapshot, readJsonlFiles, MAX_PART_BYTES } = require('./company-export');
const ExcelJS = require('exceljs');
const { createSheet } = require('./esa-companies');

test('UTF-8 splitting, lossless records, index pointers, XLSX sheets and repeat publication', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'esa-export-test-'));
  try {
    const records = Array.from({ length: 30 }, (_, i) => ({ companyProfileId: i,
      entityName: `Company ${i}`, countryOfRegistration: i % 2 ? 'DE-Germany' : 'FR-France',
      entityDescription: '星🚀 propulsion '.repeat(500), smestatus: 'Yes', isLegalEntity: true }));
    const options = { outputDir: dir, sourceDate: '2026-10-01', writeWorkbook: async file => {
      const book = new ExcelJS.Workbook();
      for (const name of ['All Companies', 'SMEs', 'Legal Entities']) createSheet(book, name, records);
      await book.xlsx.writeFile(file);
    } };
    const first = await exportSnapshot(records, options);
    assert.ok(first.parts.length > 1);
    const root = path.join(dir, first.pathBase);
    assert.deepEqual(readJsonlFiles(first.parts.map(p => path.join(root, p.filename))), records);
    const index = readJsonlFiles(first.indexParts.map(p => path.join(root, p.filename)));
    index.forEach((r, i) => assert.equal(readJsonlFiles([path.join(root, r.filename)])[r.line - 1].companyProfileId, records[i].companyProfileId));
    for (const part of [...first.parts, ...first.indexParts, ...first.searchParts]) assert.ok(part.bytes <= MAX_PART_BYTES);
    for (const part of first.searchParts) {
      for (const line of fs.readFileSync(path.join(root, part.filename), 'utf8').split('\n')) assert.ok(Buffer.byteLength(line) <= 640);
    }
    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(path.join(root, first.workbook.filename));
    assert.deepEqual(book.worksheets.map(s => s.rowCount), [31, 31, 31]);
    assert.equal(first.countryCounts['DE-Germany'], 15);
    const second = await exportSnapshot(records.slice(0, 1), options);
    assert.notEqual(first.generation, second.generation);
    assert.ok(fs.existsSync(root));
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'esa-companies-manifest.json'))).totalRecordCount, 1);
    const before = fs.readFileSync(path.join(dir, 'esa-companies-manifest.json'));
    await assert.rejects(exportSnapshot(records, { ...options, writeWorkbook: async () => { throw new Error('Injected XLSX failure'); } }), /Injected/);
    await assert.rejects(exportSnapshot([{ entityDescription: '星'.repeat(MAX_PART_BYTES) }], options), /exceeds/);
    await assert.rejects(exportSnapshot([], options), /empty/);
    const rename = fs.renameSync;
    try {
      fs.renameSync = (from, to) => {
        if (to === path.join(dir, 'esa-companies-manifest.json')) throw new Error('Injected pointer failure');
        return rename(from, to);
      };
      await assert.rejects(exportSnapshot(records, options), /Injected pointer/);
    } finally { fs.renameSync = rename; }
    assert.deepEqual(fs.readFileSync(path.join(dir, 'esa-companies-manifest.json')), before);
    assert.ok(!fs.readdirSync(dir).some(n => n.startsWith('.esa-')));
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('malformed JSONL identifies file and line', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'esa-jsonl-test-'));
  try {
    const file = path.join(dir, 'invalid.jsonl');
    fs.writeFileSync(file, '{}\ninvalid\n');
    assert.throws(() => readJsonlFiles([file]), /invalid.jsonl:2/);
  } finally { fs.rmSync(dir, { recursive: true }); }
});
