'use strict';

// BE-78 (#193) — "De prijscontrole":
//   node ops/scripts/menu-bootstrap/price-check.js <kaartsleutel|bestand.json> [--source <url>]
// Checks every price of one card against its own `source` (or the given url) and
// prints only what the Lead has to look at: the dishes whose printed price
// differs and the dishes it could not find. Dishes with `priceOnRequest` are
// skipped. It never writes: data/ stays untouched and no report file is made.
//
// Exit: 0 = the check ran (findings are results, not errors), 1 = usage or an
// unknown card, 2 = the source could not be read.

const fs = require('node:fs');
const path = require('node:path');
const { fetchSourceText, flattenItems, matchItem } = require('./sourceText');

const MENUS_FILE = path.join('data', 'menus.json');
const USAGE = [
  'node ops/scripts/menu-bootstrap/price-check.js <kaartsleutel|bestand.json> [--source <url>]',
  '',
  '  kaartsleutel   een sleutel uit data/menus.json, bijvoorbeeld 1-diner',
  '  bestand.json   een kandidaatbestand, bijvoorbeeld ops/scripts/menu-bootstrap/lead-transcriptions/1-diner.json',
  '  --source <url> controleer tegen deze bron in plaats van de eigen `source`',
].join('\n');

/** "€ 12,50", and a whole euro without cents: "€ 70". */
function formatPrice(value) {
  if (!Number.isFinite(value)) return '?';
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? `€ ${rounded}` : `€ ${rounded.toFixed(2).replace('.', ',')}`;
}

function parseArgs(argv) {
  const options = { target: null, source: null, help: false };
  const rest = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--source') {
      options.source = argv[index + 1] || null;
      index += 1;
      continue;
    }
    if (arg.startsWith('--source=')) {
      options.source = arg.slice('--source='.length);
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    rest.push(arg);
  }
  options.target = rest[0] || null;
  return options;
}

function loadCard(target) {
  const isFile = /\.json$/i.test(target) || target.includes('/') || target.includes('\\');
  if (isFile) {
    const file = path.resolve(target);
    return { key: path.basename(file, '.json'), card: JSON.parse(fs.readFileSync(file, 'utf8')), from: file };
  }
  const all = JSON.parse(fs.readFileSync(MENUS_FILE, 'utf8'));
  if (!Object.prototype.hasOwnProperty.call(all, target)) {
    throw new Error(`onbekende kaartsleutel "${target}"; bekend: ${Object.keys(all).join(', ')}`);
  }
  return { key: target, card: all[target], from: MENUS_FILE };
}

function rowLabel(category, name) {
  return category ? `${category} · ${name}` : name;
}

function notFoundReason(result) {
  return result.reason === 'naam-gevonden-zonder-prijs'
    ? 'naam gevonden, geen prijs erbij'
    : 'naam niet in de bron';
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  if (!options.target) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  let loaded;
  try {
    loaded = loadCard(options.target);
  } catch (error) {
    console.error(`price-check: ${error && error.message ? error.message : error}`);
    process.exitCode = 1;
    return;
  }
  const { key, card } = loaded;
  const source = options.source || card.source || null;
  if (!source) {
    console.error(`${key}: de kaart heeft geen source; geef --source <url>`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`price-check ${key}: ${source}\n`);
  const read = await fetchSourceText(source);
  if (!read.ok) {
    console.log(`${key} — ${source}`);
    console.log(`bron niet leesbaar: ${read.reason}${read.detail ? ` (${read.detail})` : ''}`);
    process.exitCode = 2;
    return;
  }

  const rows = flattenItems(card);
  const deviations = [];
  const notFound = [];
  let ok = 0;
  let skipped = 0;
  for (const { category, item } of rows) {
    const result = matchItem(read.text, item);
    if (result.status === 'ok') ok += 1;
    else if (result.status === 'skipped') skipped += 1;
    else if (result.status === 'price-deviates') deviations.push({ category, item, result });
    else notFound.push({ category, item, result });
  }

  const counts = [`${ok} van ${rows.length} ok`];
  if (skipped > 0) counts.push(`${skipped} overgeslagen`);
  if (deviations.length > 0) counts.push(`${deviations.length} afwijkingen`);
  if (notFound.length > 0) counts.push(`${notFound.length} niet gevonden`);
  console.log(`${key} — ${source} (${read.kind}${read.fromCache ? ', uit cache' : ''})`);
  console.log(counts.join(' · '));

  if (deviations.length > 0) {
    console.log('afwijkingen:');
    for (const { category, item, result } of deviations) {
      const expected = result.expected.map(formatPrice).join(' / ');
      const printed = result.foundPrices.map((price) => price.raw).slice(0, 4).join(', ');
      console.log(`  ${rowLabel(category, item.name)} — verwacht ${expected}, gevonden ${formatPrice(result.found)}${printed ? ` [${printed}]` : ''}`);
    }
  }
  if (notFound.length > 0) {
    console.log('niet gevonden:');
    for (const { category, item, result } of notFound) {
      console.log(`  ${rowLabel(category, item.name)} — ${notFoundReason(result)}`);
    }
  }
}

main().catch((error) => {
  console.error(`price-check: ${error && error.message ? error.message : error}`);
  process.exitCode = 1;
});
