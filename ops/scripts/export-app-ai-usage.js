#!/usr/bin/env node
'use strict';

// #59 K2 (Lead-bevinding F6) — schrijft het app-AI-gebruik als één
// metagegevensdocument naar een gitignored pad, zodat DevDashboardTower het als
// alleen-lezen bron kan lezen.
//
// Gebruik:
//   node --env-file=.env.local ops/scripts/export-app-ai-usage.js [--out <pad>]
//
// Standaardpad: ops/benchmark/output/app-ai-usage.json (gitignored per BE-21).
//
// Regels:
//   - alleen lezen: één `select` op `menu_snapshot_proposals`, nooit een insert,
//     update, delete, migratie of provideroproep;
//   - alleen een lokale database: een niet-loopback SUPABASE_URL wordt geweigerd;
//   - geen menu-inhoud, prompts, sleutels of persoonsgegevens in het bestand;
//   - atomisch schrijven: eerst een tijdelijk bestand in dezelfde map, dan een
//     rename. Mislukt het schrijven, dan blijft het bestaande bestand staan;
//   - het document wordt vóór het schrijven met hetzelfde schema gevalideerd als
//     de interne GET, en de uitvoer toont nooit een sleutel.

const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');

const { buildUsageExport, validateUsageExport } = require('../../src/lib/manualMenuImportUsage');
const { readDurableUsageRows } = require('../../src/lib/manualMenuImportUsageSource');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_OUT = 'ops/benchmark/output/app-ai-usage.json';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

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

/** Alleen de lokale database; een productie-URL wordt hier geweigerd. */
function localConfigFromEnv(env = {}) {
  const url = typeof env.SUPABASE_URL === 'string' ? env.SUPABASE_URL.trim() : '';
  const key = typeof env.SUPABASE_SERVICE_ROLE_KEY === 'string' ? env.SUPABASE_SERVICE_ROLE_KEY.trim() : '';
  if (url === '' || key === '') {
    return {
      ok: false,
      code: 'config_missing',
      message: 'SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY zijn nodig; gebruik --env-file=.env.local.',
    };
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, code: 'config_invalid', message: 'SUPABASE_URL is geen geldige URL.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, code: 'config_invalid', message: 'SUPABASE_URL moet http of https zijn.' };
  }
  const host = parsed.hostname.toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) {
    return {
      ok: false,
      code: 'not_local',
      message: `Alleen de lokale database: ${host} is geen loopback-adres.`,
    };
  }
  return { ok: true, url: parsed.origin, key };
}

/** Schrijft eerst naar een tijdelijk bestand in dezelfde map en hernoemt dat. */
function writeJsonAtomically({ file, text, fsImpl = fs } = {}) {
  if (typeof file !== 'string' || file.trim() === '') return { ok: false, code: 'no_target', message: 'geen doelpad' };
  const dir = path.dirname(file);
  const temp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`);
  try {
    fsImpl.mkdirSync(dir, { recursive: true });
    fsImpl.writeFileSync(temp, text, 'utf8');
    fsImpl.renameSync(temp, file);
    return { ok: true, file, bytes: Buffer.byteLength(text, 'utf8') };
  } catch (err) {
    try {
      fsImpl.unlinkSync(temp);
    } catch {
      // Een half geschreven tijdelijk bestand kan al weg zijn; het doelbestand
      // is hoe dan ook niet aangeraakt.
    }
    return { ok: false, code: 'write_failed', message: err && err.message ? err.message : 'onbekende schrijffout' };
  }
}

/** Leest, bouwt, valideert en schrijft in die volgorde; los testbaar. */
async function runExport({ supabase, generatedAt = new Date(), out, fsImpl = fs } = {}) {
  const read = await readDurableUsageRows(supabase);
  if (!read || read.ok !== true) return { ok: false, code: (read && read.code) || 'read_failed' };
  const doc = buildUsageExport({ rows: read.rows, limit: read.limit, bounded: read.bounded, generatedAt });
  const problems = validateUsageExport(doc);
  if (problems.length > 0) return { ok: false, code: 'invalid_document', problems };
  const file = path.resolve(ROOT, out || DEFAULT_OUT);
  const written = writeJsonAtomically({ file, text: `${JSON.stringify(doc, null, 2)}\n`, fsImpl });
  if (!written.ok) return { ok: false, code: 'write_failed', file, message: written.message };
  return { ok: true, doc, file, bytes: written.bytes };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = localConfigFromEnv(process.env);
  if (!config.ok) {
    console.error(config.message);
    process.exit(2);
  }
  const supabase = createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false } });
  const result = await runExport({ supabase, out: args.out });
  if (!result.ok) {
    if (result.problems) {
      console.error('Het document is niet geldig:');
      for (const problem of result.problems) console.error(`- ${problem}`);
    } else if (result.code === 'write_failed') {
      console.error(`Schrijven mislukte; het bestaande bestand is niet aangepast (${result.message}).`);
    } else {
      console.error(`De lokale database kon niet worden gelezen (${result.code}).`);
    }
    process.exit(1);
  }
  const { doc } = result;
  console.log(
    `${doc.applicationLabel}: ${doc.totals.conceptSaved} opgeslagen concepten · ${doc.ai.length} AI-naam/namen · ${doc.schemaVersion}`,
  );
  console.log(`kosten ${doc.costs.status}${doc.costs.label ? ` (${doc.costs.label})` : ''}`);
  console.log(`bestand ${path.relative(ROOT, result.file)}`);
}

if (require.main === module) main();

module.exports = {
  DEFAULT_OUT,
  LOOPBACK_HOSTS,
  parseArgs,
  localConfigFromEnv,
  writeJsonAtomically,
  runExport,
};
