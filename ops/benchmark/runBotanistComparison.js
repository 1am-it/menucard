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

function ratio(matched, total) {
  return total > 0 ? Number((matched / total).toFixed(4)) : null;
}

/** A row marked with an unsupported readability/support class stays in the
 * reference and in the total denominator. It is only excluded from the
 * explicitly limited subset score, never from source coverage. */
function supportOf(section, item) {
  return (item && item.support) || (section && section.support) || null;
}

function isLimitedSupport(support) {
  return typeof support === 'string' && support.length > 0 && support !== 'supported';
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
  const unmappedCategoryMeta = [];
  for (const menu of menus) {
    for (const category of menu.categories || []) {
      const top = sectionAliases[category.path[0]] || category.path[0];
      const target = referenceSections.has(top) ? top : null;
      for (const item of category.items || []) {
        if (!target) {
          unmapped.push({ path: category.path, name: item.name, price: item.price });
          unmappedCategoryMeta.push({
            sourcePath: Array.isArray(category.sourcePath) ? category.sourcePath : [],
            categoryUncertain: category.uncertain === true,
          });
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

  // A readable name/amount pair whose parser category is absent (an explicit
  // unheaded block) is not a section match. Report it separately from both
  // `matched` and `missing`, with the reference sections its name/amount
  // occurs in, so a reader can see correct reading without a score change.
  const referenceByRowKey = new Map();
  for (const section of reference.sections) {
    for (const item of section.items) {
      const key = `${norm(item.name)}|${cents(item.price)}`;
      if (!referenceByRowKey.has(key)) referenceByRowKey.set(key, []);
      const list = referenceByRowKey.get(key);
      const label = section.path[0];
      if (!list.includes(label)) list.push(label);
    }
  }
  report.categoryUnknown = {
    explanation:
      'Parser rows whose name and amount match a reference row, but whose own category is absent/unmapped. Never added to matched or coverage.',
    count: 0,
    rows: [],
  };
  for (let index = 0; index < unmapped.length; index += 1) {
    const item = unmapped[index];
    const sections = referenceByRowKey.get(`${norm(item.name)}|${cents(item.price)}`);
    if (!sections) continue;
    const meta = unmappedCategoryMeta[index] || {};
    const parserSourcePath = meta.sourcePath || [];
    report.categoryUnknown.rows.push({
      name: item.name,
      price: item.price,
      parserPath: item.path,
      parserSourcePath,
      parserCategoryStatus: parserSourcePath.length === 0 ? 'unheaded_fallback' : 'other_section',
      categoryUncertain: meta.categoryUncertain === true,
      referenceSections: sections,
    });
  }
  report.categoryUnknown.count = report.categoryUnknown.rows.length;

  const limitedRows = [];
  const productGapRows = [];
  const supportedSubset = { referenceItems: 0, matched: 0, missing: 0, extra: 0, priceMismatch: 0 };
  // A printed supplement section is readable but cannot be stored as ordinary
  // dishes with a main price. Its rows stay in the reference and in the total
  // denominator; they are classified as an explicit product gap, never as
  // matched dishes and never silently dropped.
  const supplementHeadings = new Set(
    ((report.layout && Array.isArray(report.layout.supplementSections) && report.layout.supplementSections) || [])
      .map((entry) => (entry && typeof entry.heading === 'string' ? entry.heading.trim() : ''))
      .filter(Boolean),
  );

  for (const section of reference.sections) {
    const key = section.path[0];
    const actual = parserBySection.get(key) || [];
    if (supplementHeadings.has(String(key).trim())) {
      const extra = actual.map((item) => ({ name: item.name, price: item.price, path: item.path }));
      report.sections[key] = {
        expected: section.items.length,
        actual: actual.length,
        matched: 0,
        missing: [],
        extra,
        priceMismatch: 0,
        limited: 0,
        productGap: section.items.length,
      };
      report.totals.extra += extra.length;
      for (const item of section.items) {
        productGapRows.push({
          section: key,
          name: item.name,
          price: item.price,
          support: 'unsupported_product_field',
          reason:
            'Explicit supplement section: the rows are readable, but the product concept cannot store supplement relations. They must never flow through as ordinary dishes with a main price.',
        });
      }
      continue;
    }
    const usedActual = new Set();
    const missing = [];
    let matched = 0;
    let priceMismatch = 0;
    let limited = 0;
    for (const expectedItem of section.items) {
      const support = supportOf(section, expectedItem);
      const limitedRow = isLimitedSupport(support);
      if (limitedRow) {
        limited += 1;
        limitedRows.push({
          section: key,
          name: expectedItem.name,
          price: expectedItem.price,
          support,
          reason: expectedItem.supportReason || section.supportReason || null,
        });
      }
      const index = actual.findIndex(
        (candidate, candidateIndex) => !usedActual.has(candidateIndex) && norm(candidate.name) === norm(expectedItem.name),
      );
      if (index === -1) {
        missing.push(expectedItem);
        if (!limitedRow) supportedSubset.missing += 1;
        continue;
      }
      usedActual.add(index);
      matched += 1;
      if (!limitedRow) supportedSubset.matched += 1;
      if (cents(actual[index].price) !== cents(expectedItem.price)) {
        priceMismatch += 1;
        if (!limitedRow) supportedSubset.priceMismatch += 1;
      }
    }
    const extra = actual
      .filter((_, index) => !usedActual.has(index))
      .map((item) => ({ name: item.name, price: item.price, path: item.path }));
    report.sections[key] = { expected: section.items.length, actual: actual.length, matched, missing, extra, priceMismatch, limited };
    report.totals.matched += matched;
    report.totals.missing += missing.length;
    report.totals.extra += extra.length;
    report.totals.priceMismatch += priceMismatch;
    supportedSubset.referenceItems += section.items.length - limited;
    supportedSubset.extra += extra.length;
  }

  // Two honest views on the same measurement:
  // - coverage: every readable reference row counts, even when the parser
  //   cannot read its grid or the product cannot store the relation;
  //   unsupported itemless blocks stay out of the denominator and are named
  //   separately in the reference;
  // - supportedSubset: the same score with explicitly limited readability
  //   classes and explicit product-gap rows excluded, including the excluded
  //   rows and their reason.
  report.coverage = {
    referenceItems: report.referenceItems,
    matched: report.totals.matched,
    missing: report.totals.missing,
    productGap: productGapRows.length,
    extra: report.totals.extra,
    priceMismatch: report.totals.priceMismatch,
    matchedRatio: ratio(report.totals.matched, report.referenceItems),
    limitedRows: limitedRows.length,
  };
  report.supportedSubset = {
    label: 'rows_with_unsupported_readability_or_product_fields_excluded',
    referenceItems: supportedSubset.referenceItems,
    matched: supportedSubset.matched,
    missing: supportedSubset.missing,
    extra: supportedSubset.extra,
    priceMismatch: supportedSubset.priceMismatch,
    matchedRatio: ratio(supportedSubset.matched, supportedSubset.referenceItems),
    excludedRows: [...limitedRows, ...productGapRows],
  };
  report.accounting = {
    referenceItems: report.referenceItems,
    matched: report.totals.matched,
    missing: report.totals.missing,
    productGap: productGapRows.length,
    extra: report.totals.extra,
    explainedRows: report.totals.matched + report.totals.missing + productGapRows.length + report.totals.extra,
    expectedRows: report.referenceItems + report.totals.extra,
    balanced:
      report.totals.matched + report.totals.missing + productGapRows.length + report.totals.extra ===
      report.referenceItems + report.totals.extra,
  };

  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

  for (const [key, value] of Object.entries(report.sections)) {
    console.log(
      `${key}: expected ${value.expected}, actual ${value.actual}, matched ${value.matched}, missing ${value.missing.length}, extra ${value.extra.length}, priceMismatch ${value.priceMismatch}`,
    );
  }
  console.log('TOTALS', report.totals, 'unmapped', unmapped.length);
  console.log('COVERAGE', report.coverage);
  console.log('SUPPORTED SUBSET', {
    referenceItems: report.supportedSubset.referenceItems,
    matched: report.supportedSubset.matched,
    missing: report.supportedSubset.missing,
    extra: report.supportedSubset.extra,
    priceMismatch: report.supportedSubset.priceMismatch,
    matchedRatio: report.supportedSubset.matchedRatio,
    excludedRows: report.supportedSubset.excludedRows.length,
  });
  console.log('LAYOUT', JSON.stringify(report.layout));
  console.log('wrote', path.relative(process.cwd(), outPath));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
