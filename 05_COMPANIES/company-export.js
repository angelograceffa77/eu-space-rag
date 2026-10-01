// Immutable snapshots; esa-companies-manifest.json is the only publication pointer.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const MAX_PART_BYTES = 128 * 1024;
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');

function writeParts(directory, stem, entries, extension) {
  const parts = [];
  let content = '', count = 0, bytes = 0;
  function flush() {
    if (!count) return;
    const filename = `${stem}.part-${String(parts.length + 1).padStart(4, '0')}.${extension}`;
    fs.writeFileSync(path.join(directory, filename), content, { flag: 'wx' });
    parts.push({ filename, recordCount: count, bytes, sha256: sha256(content) });
    content = ''; count = 0; bytes = 0;
  }
  for (const entry of entries) {
    const size = Buffer.byteLength(entry);
    if (size > MAX_PART_BYTES) throw new Error(`One ${stem} record exceeds ${MAX_PART_BYTES} bytes; no data truncated or published`);
    if (bytes + size > MAX_PART_BYTES) flush();
    content += entry; bytes += size; count++;
  }
  flush();
  return parts;
}

// Preserve every character while avoiding GitHub's long-line search restrictions.
function wrap(text) {
  return String(text).split(/\r?\n/).map(line => {
    const chars = Array.from(line), lines = [];
    for (let i = 0; i < chars.length; i += 160) lines.push(chars.slice(i, i + 160).join(''));
    return lines.join('\n');
  }).join('\n');
}

async function exportSnapshot(records, { outputDir, sourceDate, sourceFiles = [], writeWorkbook }) {
  if (!Array.isArray(records) || records.length === 0) throw new Error('Refusing to publish an empty dataset');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sourceDate)) throw new Error('sourceDate must be YYYY-MM-DD');
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Invalid company record');
  }
  fs.mkdirSync(outputDir, { recursive: true });
  const generatedAt = new Date().toISOString();
  const generation = `snapshot-${sourceDate}-${crypto.randomUUID()}`;
  const stage = fs.mkdtempSync(path.join(outputDir, '.esa-stage-'));
  const destination = path.join(outputDir, generation);
  const pointerTemp = path.join(outputDir, `.esa-manifest-${crypto.randomUUID()}.tmp`);
  const stem = `ESA_Companies_${sourceDate}`;
  try {
    const parts = writeParts(stage, stem, records.map(r => JSON.stringify(r) + '\n'), 'jsonl');
    let recordOffset = 0;
    const index = [], search = [];
    for (const part of parts) {
      for (let line = 1; line <= part.recordCount; line++) {
        const r = records[recordOffset++];
        index.push(JSON.stringify({ companyProfileId: r.companyProfileId ?? null,
          entityId: r.entityId ?? null, entityName: r.entityName ?? null,
          entityCode: r.entityCode ?? null, country: r.countryOfRegistration ?? null,
          city: r.city ?? null, smestatus: r.smestatus ?? null,
          isLegalEntity: r.isLegalEntity ?? null, filename: part.filename, line }) + '\n');
        search.push(wrap(`Record: ${recordOffset}\nFile: ${part.filename}\nLine: ${line}\n` +
          Object.entries(r).map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`).join('\n')) + '\n\n');
      }
    }
    const indexParts = writeParts(stage, 'companies-index', index, 'jsonl');
    const searchParts = writeParts(stage, 'companies-search', search, 'txt');
    const countryCounts = Object.create(null);
    for (const r of records) {
      const country = r.countryOfRegistration || 'Unknown';
      countryCounts[country] = (countryCounts[country] || 0) + 1;
    }
    const ids = records.map(r => r.companyProfileId).filter(id => id !== null && id !== undefined);
    const workbookName = `${stem}.xlsx`;
    await writeWorkbook(path.join(stage, workbookName));
    const workbook = fs.readFileSync(path.join(stage, workbookName));
    const manifest = { schemaVersion: 1, dataset: 'ESA esa-match company directory',
      source: 'https://esastar-esamatch-ext.sso.esa.int/api/companiesDirectory/filter',
      sourceDate, generatedAt, generation, totalRecordCount: records.length,
      totalCompanyCount: records.length, countMeaning: 'Directory profiles, including business units; not distinct legal entities',
      uniqueCompanyProfileIdCount: new Set(ids).size, missingCompanyProfileIdCount: records.length - ids.length,
      duplicateCompanyProfileIdCount: ids.length - new Set(ids).size,
      smeCount: records.filter(r => r.smestatus === 'Yes').length,
      legalEntityCount: records.filter(r => r.isLegalEntity === true).length,
      countryCounts, sourceFiles, encoding: 'UTF-8', maxPartBytes: MAX_PART_BYTES,
      pathBase: generation, parts, indexParts, searchParts,
      workbook: { filename: workbookName, bytes: workbook.length, sha256: sha256(workbook) },
      queryInstructions: 'Read this manifest once; resolve filenames under pathBase. Use countryCounts for totals, indexParts for names/countries and record locations, parts for exhaustive filtering. Search is discovery only; never infer complete counts from search hits. Do not combine historical snapshots or legacy exports.' };
    const manifestText = JSON.stringify(manifest, null, 2) + '\n';
    if (Buffer.byteLength(manifestText) > 256 * 1024) throw new Error('Manifest exceeds retrieval budget');
    // Read back every part before publishing, including counts and checksums.
    for (const part of [...parts, ...indexParts, ...searchParts]) {
      const data = fs.readFileSync(path.join(stage, part.filename));
      if (data.length !== part.bytes || sha256(data) !== part.sha256 || data.length > MAX_PART_BYTES) throw new Error('Part verification failed');
      if (part.filename.endsWith('.jsonl')) {
        const lines = data.toString('utf8').trimEnd().split('\n');
        if (lines.length !== part.recordCount) throw new Error('Record count verification failed');
        lines.forEach(line => JSON.parse(line));
      }
    }
    fs.writeFileSync(path.join(stage, 'manifest.json'), manifestText, { flag: 'wx' });
    // Same-filesystem renames: readers see a complete old or complete new snapshot.
    fs.renameSync(stage, destination);
    fs.writeFileSync(pointerTemp, manifestText, { flag: 'wx' });
    fs.renameSync(pointerTemp, path.join(outputDir, 'esa-companies-manifest.json'));
    return manifest;
  } finally {
    // Only our own unpublished staging directory/temp pointer. Keep all snapshots.
    if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true });
    if (fs.existsSync(pointerTemp)) fs.unlinkSync(pointerTemp);
  }
}

function readJsonlFiles(filenames) {
  return filenames.flatMap(filename => {
    const raw = fs.readFileSync(filename, 'utf8');
    return raw.split(/\r?\n/).flatMap((line, i, lines) => {
      if (line === '' && i === lines.length - 1) return [];
      try { return [JSON.parse(line)]; }
      catch { throw new Error(`Invalid JSONL: ${filename}:${i + 1}`); }
    });
  });
}
module.exports = { exportSnapshot, readJsonlFiles, MAX_PART_BYTES };

