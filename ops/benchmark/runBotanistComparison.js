#!/usr/bin/env node
'use strict';

// Reproducible, read-only comparison of the deterministic PDF chain against
// the controlled De Botanist reference (#59). The pinned PDF is deliberately
// NOT committed (source copyright/size); pass its local, hash-checked copy:
//
//   node ops/benchmark/runBotanistComparison.js --pdf=ops/benchmark/output/botanist-menu.pdf
//
// The script never fetches anything, never calls a provider, and refuses to
// score a PDF whose SHA-256 differs from the pinned reference. The default
// reference is the accepted v1 baseline; a proposed correction can be scored
// explicitly without replacing the baseline:
//
//   node ops/benchmark/runBotanistComparison.js --reference=ops/benchmark/botanist-reference.proposed-v2.json --out=ops/benchmark/botanist-comparison.proposed-v2.json

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { buildDirectPdfAnalysis } = require('../../src/lib/sourceAnalysisPipeline');

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const pdfPath = path.resolve(argValue('pdf', 'ops/benchmark/output/botanist-menu.pdf'));
const referencePath = path.resolve(argValue('reference', 'ops/benchmark/botanist-reference.json'));
const outPath = path.resolve(argValue('out', 'ops/benchmark/botanist-comparison.json'));

const reference = JSON.parse(fs.readFileSync(referencePath, 'utf8'));
const pdfBytes = fs.readFileSync(pdfPath);
const pdfSha256 = crypto.createHash('sha256').update(pdfBytes).digest('hex');
if (pdfSha256 !== reference.source.menuBytesSha256) {
  console.error(`PDF hash mismatch: expected ${reference.source.menuBytesSha256}, got ${pdfSha256}. No comparison written.`);
  process.exit(1);
}

function cents(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const match = value.trim().match(/^(\d{1,3})(?:[.,](\d{1,2}))?$/);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
}

function norm(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?]+$/g, '')
    .trim();
}

(async () => {
  const analysis = await buildDirectPdfAnalysis({
    pdfBytes,
    sourceUrl: reference.source.menuUrl,
  });
  const menus = Array.isArray(analysis.menuContexts) ? analysis.menuContexts : [];

  // The reference keys one supported section by its top-level path label. A
  // nested brand sub-heading therefore stays part of its parent section.
  const referenceSections = new Map(reference.sections.map((section) => [section.path[0], section]));
  const sectionAliases = { 'KOREMAN´S': "KOREMAN'S" };
  const parserBySection = new Map();
  const unmapped = [];
  for (const menu of menus) {
    for (const category of menu.categories || []) {
      const top = sectionAliases[category.path[0]] || category.path[0];
      const target = referenceSections.has(top) ? top : null;
      for (const item of category.items || []) {
        if (!target) {
          unmapped.push({ path: category.path, name: item.name, price: item.price });
          continue;
        }
        if (!parserBySection.has(target)) parserBySection.set(target, []);
        parserBySection.get(target).push({ name: item.name, price: item.price, path: category.path });
      }
    }
  }

  const report = {
    referenceVersion: reference.version,
    referenceMode: reference.referenceMode,
    source: {
      menuUrl: reference.source.menuUrl,
      menuBytesSha256: pdfSha256,
      menuContentHash: reference.source.menuContentHash,
      pageCount: reference.source.pageCount,
    },
    measurement: {
      command: 'node ops/benchmark/runBotanistComparison.js',
      reference: path.basename(referencePath),
      deterministicOnly: true,
      providerCalled: false,
      networkUsed: false,
    },
    referenceItems: reference.referenceItemCount,
    parserItems: menus.reduce(
      (total, menu) => total + (menu.categories || []).reduce((sum, category) => sum + (category.items || []).length, 0),
      0,
    ),
    sections: {},
    totals: { matched: 0, missing: 0, extra: 0, priceMismatch: 0 },
    layout: (analysis.unknownMenuContexts && analysis.unknownMenuContexts[0] && analysis.unknownMenuContexts[0].layout) || null,
    unmapped,
  };

  for (const section of reference.sections) {
    const key = section.path[0];
    const actual = parserBySection.get(key) || [];
    const usedActual = new Set();
    const missing = [];
    let matched = 0;
    let priceMismatch = 0;
    for (const expectedItem of section.items) {
      const index = actual.findIndex(
        (candidate, candidateIndex) => !usedActual.has(candidateIndex) && norm(candidate.name) === norm(expectedItem.name),
      );
      if (index === -1) {
        missing.push(expectedItem);
        continue;
      }
      usedActual.add(index);
      matched += 1;
      if (cents(actual[index].price) !== cents(expectedItem.price)) priceMismatch += 1;
    }
    const extra = actual
      .filter((_, index) => !usedActual.has(index))
      .map((item) => ({ name: item.name, price: item.price, path: item.path }));
    report.sections[key] = { expected: section.items.length, actual: actual.length, matched, missing, extra, priceMismatch };
    report.totals.matched += matched;
    report.totals.missing += missing.length;
    report.totals.extra += extra.length;
    report.totals.priceMismatch += priceMismatch;
  }

  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

  for (const [key, value] of Object.entries(report.sections)) {
    console.log(
      `${key}: expected ${value.expected}, actual ${value.actual}, matched ${value.matched}, missing ${value.missing.length}, extra ${value.extra.length}, priceMismatch ${value.priceMismatch}`,
    );
  }
  console.log('TOTALS', report.totals, 'unmapped', unmapped.length);
  console.log('LAYOUT', JSON.stringify(report.layout));
  console.log('wrote', path.relative(process.cwd(), outPath));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
