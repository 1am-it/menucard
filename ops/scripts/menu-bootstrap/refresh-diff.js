'use strict';

// BE-78 (#193) — "Verversen op verschillen":
//   node ops/scripts/menu-bootstrap/refresh-diff.js <kaartsleutel|--all>
// Fetches every source again and reports per card what changed: a changed price,
// a dish that may have disappeared, and a printed price that belongs to no dish
// on our card yet. The report goes to docs/menu-refresh-report.md.
//
// This script never changes data/: the Lead decides. Only sources that are
// already in data/menus.json are fetched, through the existing BE-71 rules
// (robots.txt, rest between requests, cache in .local/).
//
// Exit: 0 = the report was written, 1 = usage or an unknown card.

const fs = require('node:fs');
const path = require('node:path');
const { fetchSourceText, diffCard, flattenItems } = require('./sourceText');

const MENUS_FILE = path.join('data', 'menus.json');
const REPORT_FILE = path.join('docs', 'menu-refresh-report.md');
const MAX_ROWS_PER_SECTION = 40;
const USAGE = [
  'node ops/scripts/menu-bootstrap/refresh-diff.js <kaartsleutel|--all>',
  '',
  '  kaartsleutel   een sleutel uit data/menus.json, bijvoorbeeld 6-diner',
  '  --all          alle kaarten in data/menus.json',
  '',
  `Het rapport gaat naar ${REPORT_FILE}; dit script past data/ nooit aan.`,
].join('\n');

function formatPrice(value) {
  if (!Number.isFinite(value)) return '?';
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? `€ ${rounded}` : `€ ${rounded.toFixed(2).replace('.', ',')}`;
}

function parseArgs(argv) {
  const options = { target: null, all: false, help: false };
  for (const arg of argv) {
    if (arg === '--all' || arg === '--alle') options.all = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (!options.target) options.target = arg;
  }
  return options;
}

function readMenus() {
  return JSON.parse(fs.readFileSync(MENUS_FILE, 'utf8'));
}

function cardTitle(key, card) {
  const subtitle = typeof card.subtitle === 'string' && card.subtitle.trim() ? card.subtitle.trim() : null;
  return subtitle ? `${key} — ${subtitle}` : key;
}

function section(lines, title, rows, render) {
  lines.push('', `### ${title} (${rows.length})`, '');
  if (rows.length === 0) {
    lines.push('- niets');
    return;
  }
  for (const row of rows.slice(0, MAX_ROWS_PER_SECTION)) lines.push(`- ${render(row)}`);
  if (rows.length > MAX_ROWS_PER_SECTION) lines.push(`- … en nog ${rows.length - MAX_ROWS_PER_SECTION}`);
}

/** One card: fetch, compare, and remember the totals for the summary table. */
async function compareCard(key, card) {
  const source = typeof card.source === 'string' ? card.source : null;
  if (!source) return { key, card, source, read: { ok: false, reason: 'geen-source', detail: null } };
  const read = await fetchSourceText(source);
  if (!read.ok) return { key, card, source, read };
  return { key, card, source, read, diff: diffCard(read.text, card), total: flattenItems(card).length };
}

function writeReport(results, startedAt) {
  const lines = [
    '# Menukaarten verversen — de verschillen',
    '',
    `Gegenereerd: ${startedAt} · bron: \`data/menus.json\` · script: \`ops/scripts/menu-bootstrap/refresh-diff.js\``,
    '',
    'Dit rapport is een voorstel. Het script past `data/` nooit aan; de Lead beslist',
    'wat er in de kaarten verandert. Alleen bronnen die al als `source` in',
    '`data/menus.json` staan zijn opnieuw opgehaald, volgens robots.txt, met rust',
    'tussen verzoeken en via de cache in `.local/`.',
    '',
    '## Samenvatting',
    '',
    '| kaart | bron | gelezen | ok | gewijzigde prijs | mogelijk verdwenen | mogelijk nieuw |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const result of results) {
    const kind = result.read && result.read.ok ? result.read.kind : (result.read && result.read.reason) || '?';
    if (!result.diff) {
      lines.push(`| ${result.key} | ${result.source || '—'} | ${kind} | — | — | — | — |`);
      continue;
    }
    lines.push(
      `| ${result.key} | ${result.source} | ${kind} | ${result.diff.ok} van ${result.total} | ${result.diff.changed.length} | ${result.diff.gone.length} | ${result.diff.possibleNew.length} |`,
    );
  }
  for (const result of results) {
    lines.push('', '---', '', `## ${cardTitle(result.key, result.card)}`, '');
    if (result.source) lines.push(`Bron: ${result.source}`);
    if (!result.read || !result.read.ok) {
      const reason = (result.read && result.read.reason) || 'onbekend';
      const detail = result.read && result.read.detail ? ` (${result.read.detail})` : '';
      lines.push('', `Deze bron is niet opnieuw te lezen: ${reason}${detail}.`);
      continue;
    }
    if (result.read.fromCache) lines.push('', '_Uit de cache van een eerdere ophaalpoging._');
    lines.push('', `Gecontroleerd: ${result.diff.checked} van ${result.total} gerechten · ${result.diff.ok} daarvan ongewijzigd.`);
    section(lines, 'Gewijzigde prijs', result.diff.changed, (row) => {
      const expected = row.expected.map(formatPrice).join(' / ');
      const missing = row.missing.map(formatPrice).join(' / ');
      return `${row.category ? `${row.category} · ` : ''}${row.name} — verwacht ${expected}, in de bron ${formatPrice(row.found)} (${missing} niet teruggevonden)`;
    });
    section(lines, 'Mogelijk verdwenen', result.diff.gone, (row) => `${row.category ? `${row.category} · ` : ''}${row.name} — ${row.reason}`);
    section(lines, 'Mogelijk nieuw', result.diff.possibleNew, (row) => `${row.label || '(naam onbekend)'} — ${formatPrice(row.value)}`);
  }
  lines.push('');
  fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
  fs.writeFileSync(REPORT_FILE, `${lines.join('\n')}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  if (!options.target && !options.all) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  const menus = readMenus();
  if (!options.all && !Object.prototype.hasOwnProperty.call(menus, options.target)) {
    console.error(`refresh-diff: onbekende kaartsleutel "${options.target}"; bekend: ${Object.keys(menus).join(', ')}`);
    process.exitCode = 1;
    return;
  }
  const keys = options.all ? Object.keys(menus) : [options.target];

  const startedAt = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const results = [];
  for (const key of keys) {
    process.stdout.write(`refresh-diff ${key}: ${menus[key].source || '—'}\n`);
    results.push(await compareCard(key, menus[key]));
  }
  writeReport(results, startedAt);
  const totals = results.reduce(
    (sum, result) => ({
      changed: sum.changed + (result.diff ? result.diff.changed.length : 0),
      gone: sum.gone + (result.diff ? result.diff.gone.length : 0),
      possibleNew: sum.possibleNew + (result.diff ? result.diff.possibleNew.length : 0),
      unreadable: sum.unreadable + (result.diff ? 0 : 1),
    }),
    { changed: 0, gone: 0, possibleNew: 0, unreadable: 0 },
  );
  console.log(
    `${results.length} kaarten · ${totals.changed} gewijzigde prijzen · ${totals.gone} mogelijk verdwenen · ${totals.possibleNew} mogelijk nieuw · ${totals.unreadable} bron(nen) niet leesbaar → ${REPORT_FILE}`,
  );
}

main().catch((error) => {
  console.error(`refresh-diff: ${error && error.message ? error.message : error}`);
  process.exitCode = 1;
});
