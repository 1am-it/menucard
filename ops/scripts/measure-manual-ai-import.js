'use strict';

// #59 fase 2 — meet één geïmporteerd AI-resultaat tegen een vastgezette #59-
// referentie (K9). Dit is een **handmatige proef, geen schaalacceptatie**: het
// script meet één werkelijk getest antwoord per AI en telt gemist, verzonnen,
// prijzen, varianten, rubrieken en bewijsdekking. Het wijzigt geen referentie,
// geen telregels en geen meetcode van #59; het leest ze alleen.
//
// Gebruik:
//   node ops/scripts/measure-manual-ai-import.js --input <json> --answer <txt>
//     [--reference ops/benchmark/reference-references/bardot.json] [--out <map>]
//
// input.json:
//   { "restaurantId": "23", "restaurantName": "Voorbeeld",
//     "fetchedAt": "2026-10-22T12:00:00.000Z", "ai": "Claude",
//     "sources": [{ "id": "source-1", "url": "https://…",
//                   "kind": "html", "textPath": "bron.txt" }] }
//
// De uitvoer is JSON plus Markdown in de opgegeven map (gitignored) met
// hashes, aantallen en de vergelijking. Er gaat geen netwerk aan te pas.

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const { loadMenuExtractionProtocol } = require('../../src/lib/menuExtractionProtocol');
const { buildImportBundle, canonicalText } = require('../../src/lib/manualMenuImportBundle');
const { extractCodeBlock, buildImportReport } = require('../../src/lib/manualMenuImportImport');
const { compareMenuSource } = require('../../src/lib/menuSourceComparison');

const LABEL = 'handmatige proef, geen schaalacceptatie';
const ROOT = path.resolve(__dirname, '..', '..');

function readIndifferent(file) {
  return fs.readFileSync(file, 'utf8');
}

function comparableMenus(validated) {
  const menus = Array.isArray(validated && validated.menus) ? validated.menus : [];
  return menus.map((menu) => ({
    title: menu.title,
    categories: (Array.isArray(menu.categories) ? menu.categories : []).map((category) => {
      const own = Array.isArray(category.path) && category.path.length > 0 ? category.path : [category.name];
      // De #59-referenties nemen de menukaart als buitenste padlevel; dezelfde
      // conventie houdt de vergelijking per rubriek eerlijk.
      const pathLabels = typeof menu.title === 'string' && menu.title.trim() ? [menu.title, ...own] : own;
      return {
        path: pathLabels,
        items: (Array.isArray(category.items) ? category.items : []).map((item) => {
          let price = null;
          if (item.priceStatus === 'known' && Number.isInteger(item.amountMinorUnits)) price = (item.amountMinorUnits / 100).toFixed(2);
          else if (Array.isArray(item.priceVariants) && item.priceVariants.length > 0 && Number.isInteger(item.priceVariants[0].amountMinorUnits)) {
            // Alleen voor de vergelijking: de eerste variant. De variant zelf
            // blijft in de telling staan en wordt nooit stil afgeplat.
            price = (item.priceVariants[0].amountMinorUnits / 100).toFixed(2);
          }
          return { name: item.name, price };
        }),
      };
    }),
  }));
}

function countSections(rows) {
  return new Set(rows.map((row) => row.pathLabel)).size;
}

/** De pure meting; los getest in measure-manual-ai-import.test.js. */
function measureImport({ report, reference, aiName, generatedAt = new Date(), protocol, bundle } = {}) {
  const rows = Array.isArray(report && report.rows) ? report.rows : [];
  const withQuote = rows.filter((row) => typeof row.quote === 'string' && row.quote.trim() !== '').length;
  const verified = rows.filter((row) => row.evidenceVerified === true).length;
  const comparable = comparableMenus(report && report.validated);
  const comparison = reference ? compareMenuSource(reference, comparable) : null;
  return {
    label: LABEL,
    application: 'handmatige-ai-import',
    ai: aiName || (report && report.aiName) || null,
    aiSelfReported: true,
    generatedAt: (generatedAt instanceof Date ? generatedAt : new Date(generatedAt)).toISOString(),
    protocol: protocol ? { version: protocol.version, hash: protocol.hash, schemaVersion: protocol.schemaVersion } : null,
    schemaVersion: report ? report.technical.schemaVersion : null,
    bundleHash: bundle ? bundle.bundleHash : report ? report.bundleHash : null,
    counts: {
      menus: report && report.summary ? report.summary.menus : 0,
      items: rows.length,
      valid: report && report.summary ? report.summary.valid : 0,
      blocked: report && report.summary ? report.summary.blocked : 0,
      unverifiable: report && report.summary ? report.summary.unverifiable : 0,
      unsupported: report && report.summary ? report.summary.unsupported : 0,
      sections: countSections(rows),
      variants: rows.filter((row) => Array.isArray(row.priceVariants) && row.priceVariants.length > 0).length,
      supplements: rows.filter((row) => row.code === 'supplement_as_main_price').length,
      arrangements: rows.filter((row) => row.code === 'arrangement_like').length,
    },
    evidence: {
      rows: rows.length,
      withQuote,
      verifiedInSource: verified,
      // Dekking van automatisch gecontroleerd bewijs; een scan telt nooit mee.
      coverage: rows.length === 0 ? 0 : Number((verified / rows.length).toFixed(4)),
      notVerifiable: rows.filter((row) => row.state === 'unverifiable').length,
    },
    comparison,
    // Dekking zoals de AI hem zelf opgaf: getoond, nooit als bewijs gebruikt.
    coverageClaim: report ? report.coverage : null,
  };
}

function markdown(measurement) {
  const c = measurement.counts;
  const e = measurement.evidence;
  const cmp = measurement.comparison;
  const lines = [
    `# Handmatige AI-import — meting (${measurement.ai || 'AI onbekend'})`,
    '',
    `**Label: ${measurement.label}.** Eén werkelijk getest antwoord; dit is geen schaalacceptatie.`,
    '',
    `- Datum: ${measurement.generatedAt}`,
    `- Instructie: ${measurement.protocol ? `${measurement.protocol.version} · ${measurement.protocol.hash}` : 'onbekend'}`,
    `- Schemaversie: ${measurement.schemaVersion || 'onbekend'}`,
    `- Exportbundel: ${measurement.bundleHash || 'onbekend'}`,
    '',
    '## Aantallen',
    '',
    `- Menukaarten: ${c.menus} · gerechten: ${c.items} · rubrieken: ${c.sections}`,
    `- In orde: ${c.valid} · geblokkeerd: ${c.blocked} · niet controleerbaar: ${c.unverifiable} · niet op te slaan: ${c.unsupported}`,
    `- Varianten: ${c.variants} · supplementen: ${c.supplements} · arrangementen: ${c.arrangements}`,
    `- Bewijsdekking (automatisch gecontroleerd): ${e.verifiedInSource}/${e.rows} (${Math.round(e.coverage * 100)}%)`,
    '',
  ];
  if (cmp) {
    lines.push(
      `## Vergelijking met de referentie (${cmp.label})`,
      '',
      `- Referentie: ${cmp.expectedItems} · gemeten: ${cmp.actualItems} · match: ${cmp.matched}`,
      `- Gemist: ${cmp.missing.length} · verzonnen: ${cmp.extra.length} · prijsfouten: ${cmp.priceMismatches.length} · rubriekfouten: ${cmp.categoryMismatches.length} · duplicaten: ${cmp.duplicates.length}`,
      '',
      `- Balans referentie: ${cmp.accounting.expected.accounted}/${cmp.accounting.expected.total}`,
      `- Balans meting: ${cmp.accounting.actual.accounted}/${cmp.accounting.actual.total}`,
      '',
    );
  } else {
    lines.push('## Vergelijking', '', 'Geen referentie opgegeven; alleen aantallen en bewijsdekking gemeten.', '');
  }
  lines.push('## Grenzen', '', '- Dit is één handmatige proef per AI, geen benchmark en geen acceptatie van schaal of dekking.', '');
  return lines.join('\n');
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    args[key.slice(2)] = argv[i + 1];
    i += 1;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input || !args.answer) {
    console.error('Gebruik: --input <json> --answer <txt> [--reference <json>] [--out <map>]');
    process.exit(2);
  }
  const inputPath = path.resolve(ROOT, args.input);
  const inputDir = path.dirname(inputPath);
  const input = JSON.parse(readIndifferent(inputPath));
  const answer = readIndifferent(path.resolve(ROOT, args.answer));
  const protocol = loadMenuExtractionProtocol({ root: ROOT });
  const sources = (Array.isArray(input.sources) ? input.sources : []).map((source) => ({
    id: source.id,
    url: source.url,
    kind: source.kind,
    status: source.status || 'read',
    sha256: source.sha256,
    text: source.textPath ? readIndifferent(path.resolve(inputDir, source.textPath)) : source.text || '',
    limitation: source.limitation,
  }));
  const bundle = buildImportBundle({
    bundleId: input.bundleId || 'manual-proef',
    actorUserId: 'handmatige-proef',
    restaurantId: input.restaurantId,
    restaurantName: input.restaurantName,
    fetchedAt: input.fetchedAt,
    sources,
    protocol,
  });
  const code = extractCodeBlock(answer);
  if (!code.ok) {
    console.error(`${code.message} (${code.code})`);
    process.exit(1);
  }
  const report = buildImportReport({ importId: 'manual-proef', bundle, output: code.value, aiName: input.ai });
  if (!report.ok) {
    console.error(`${report.message} (${report.code})`);
    if (report.problems && report.problems.length > 0) console.error(report.problems.join('\n'));
    process.exit(1);
  }
  const referencePath = args.reference
    ? path.resolve(ROOT, args.reference)
    : input.referencePath
      ? path.resolve(inputDir, input.referencePath)
      : null;
  const reference = referencePath ? JSON.parse(readIndifferent(referencePath)) : null;
  const measurement = measureImport({ report, reference, aiName: input.ai, protocol, bundle });
  const outDir = path.resolve(ROOT, args.out || 'ops/benchmark/output/manual-ai-import');
  fs.mkdirSync(outDir, { recursive: true });
  const json = JSON.stringify(measurement, null, 2);
  fs.writeFileSync(path.join(outDir, 'measurement.json'), `${json}\n`, 'utf8');
  fs.writeFileSync(path.join(outDir, 'measurement.md'), `${markdown(measurement)}\n`, 'utf8');
  const hash = createHash('sha256').update(canonicalText(json)).digest('hex');
  console.log(`${measurement.label}: ${measurement.ai}`);
  console.log(
    `gerechten ${measurement.counts.items} · in orde ${measurement.counts.valid} · bewijs ${measurement.evidence.verifiedInSource}/${measurement.evidence.rows}`
  );
  if (measurement.comparison) {
    const c = measurement.comparison;
    console.log(
      `referentie ${c.expectedItems} · gemeten ${c.actualItems} · match ${c.matched} · gemist ${c.missing.length} · verzonnen ${c.extra.length}`
    );
  }
  console.log(`json sha256 ${hash}`);
}

if (require.main === module) main();

module.exports = { measureImport, comparableMenus, markdown, LABEL };

