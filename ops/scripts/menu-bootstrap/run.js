'use strict';

// BE-71 (#176, besluit 021) — the one-off run over the 25 Breda restaurants.
//
//   node ops/scripts/menu-bootstrap/run.js --dry-run        # report only
//   node ops/scripts/menu-bootstrap/run.js --dry-run --only=6
//   node ops/scripts/menu-bootstrap/run.js --write --only=6  # one card
//
// `--dry-run` writes only docs/menu-bootstrap-report.{json,md}. `--write` also
// puts the one card in data/menus.json (one restaurant per invocation, so every
// restaurant gets its own commit). `--write` refuses a card that does not meet
// the completeness requirement; nothing is ever written "almost".
//
// No AI, no database, no migration, no new dependency.

const fs = require('node:fs');
const path = require('node:path');
const { bootstrapRestaurant } = require('./engine');
const { buildReport, renderMarkdown } = require('./report');
const { applyMenuItem } = require('./menuEntry');
const { serialize } = require('../../../src/lib/menuExport');

const DATA_MENUS = path.join('data', 'menus.json');
const DATA_RESTAURANTS = path.join('data', 'restaurants.json');
const REPORT_MD = path.join('docs', 'menu-bootstrap-report.md');
const REPORT_JSON = path.join('docs', 'menu-bootstrap-report.json');

function parseArgs(argv) {
  const args = { dryRun: false, write: false, only: null };
  for (const arg of argv) {
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--write') args.write = true;
    else if (arg.startsWith('--only=')) args.only = arg.slice('--only='.length).split(',').map((id) => id.trim()).filter(Boolean);
  }
  if (!args.dryRun && !args.write) args.dryRun = true;
  return args;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const restaurants = readJson(DATA_RESTAURANTS);
  const menusBefore = readJson(DATA_MENUS);
  const ids = Object.keys(restaurants).filter((id) => !args.only || args.only.includes(id));
  const scraped = today();
  const results = [];
  let menus = menusBefore;

  console.log(`Startvulling: ${ids.length} restaurant(s), ${args.write ? 'schrijven' : 'droogloop'}.`);

  for (const id of ids) {
    const result = await bootstrapRestaurant({ restaurantId: id, restaurant: restaurants[id], menus, scraped });
    results.push(result);
    const state = result.status === 'done' ? `geslaagd, ${result.dishCount} gerechten` : `${result.status}: ${result.reasons.map((r) => r.text).join('; ')}`;
    console.log(`${id} ${result.name}: ${state}`);
    if (args.write && result.status === 'done') {
      menus = applyMenuItem({ menus, restaurants, restaurantId: id, entry: result.entry });
      fs.writeFileSync(DATA_MENUS, serialize(menus));
      console.log(`${id}: data/menus.json bijgewerkt (${result.dishCount} gerechten, ${result.sourceUrl}).`);
    }
  }

  const report = buildReport({
    results,
    previousMenus: menusBefore,
    scraped,
    generatedAt: new Date().toISOString(),
  });
  fs.writeFileSync(REPORT_JSON, serialize(report));
  fs.writeFileSync(REPORT_MD, renderMarkdown(report));
  console.log(`Rapport: ${REPORT_MD} en ${REPORT_JSON}.`);
  console.log(`Geslaagd ${report.totals.done}, overgeslagen ${report.totals.skipped}, geblokkeerd ${report.totals.blocked}.`);
  for (const [text, count] of Object.entries(report.groups).sort((a, b) => b[1] - a[1])) console.log(`  ${text}: ${count}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, main };
