'use strict';

// BE-46 (#106, criterium 1 en 3) — de structurele controle op
// supabase/migrations/0022_be46_samen_kiezen.sql.
//
// Zelfde conventie als dishCountersMigration.test.js en
// batchAnalysisMigration.test.js: het migratiebestand zelf lezen. Dit vervangt
// het toepassen niet — de bestaande validate-migrations-workflow speelt élke
// migratie op een lege Postgres, en de eigenaar past 0022 na de merge toe via
// "Apply production database migrations". Hier wordt bewezen dat het bestand
// doet wat het contract vraagt en niet meer dan dat: twee tabellen, geen
// persoonsgegevens, RLS dicht voor anon en authenticated, alleen service_role
// rechten, één opruimfunctie en volledig additief.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS = path.join(REPO_ROOT, 'supabase/migrations');
const FILE = '0022_be46_samen_kiezen.sql';
const SQL = fs.readFileSync(path.join(MIGRATIONS, FILE), 'utf8');
const code = SQL.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
const flat = code.replace(/\s+/g, ' ').toLowerCase();

/** Het create-table-blok van één tabel, van `create table` tot `);`. */
function tableBlock(name) {
  const start = code.indexOf(`create table if not exists ${name}`);
  assert.ok(start >= 0, `de tabel ${name} ontbreekt`);
  const end = code.indexOf(');', start);
  return code.slice(start, end);
}

/** De opruimfunctie, van create tot `$$;`. */
function functionBlock() {
  const start = code.indexOf('create or replace function verwijder_oude_kies_stemmingen(');
  assert.ok(start >= 0, 'de opruimfunctie ontbreekt');
  const end = code.indexOf('$$;', start);
  return code.slice(start, end);
}

test('0022: één nieuw, uniek migratienummer na 0021', () => {
  const files = fs.readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort();
  assert.deepEqual(files.filter((name) => name.startsWith('0022')), [FILE]);
  const numbers = files.map((name) => name.slice(0, 4));
  assert.equal(new Set(numbers).size, numbers.length, 'elk nummer is uniek');
  assert.equal(files[files.length - 1], FILE, '0022 is de nieuwste migratie');
  assert.match(SQL, /^-- 0022 /);
  assert.match(SQL, /NOT YET APPLIED/i, 'het bestand wordt niet uitgevoerd in deze PR');
});

test('0022: kies_stemmingen heeft een niet te raden code, 1-12 gerechten en een optionele sluitingstijd', () => {
  const block = tableBlock('kies_stemmingen');
  const columns = [...block.matchAll(/^\s{2}([a-z_]+)\s+(text|text\[\]|timestamptz)\b/gm)].map((match) => match[1]);
  assert.deepEqual(columns, ['code', 'dish_keys', 'sluit_om', 'created_at']);
  // De code is de primaire sleutel: 128 bit als 22 url-veilige tekens.
  assert.match(block, /code\s+text primary key check \(code ~ '\^\[A-Za-z0-9_-\]\{22,86\}\$'\)/);
  // 1 tot 12 gerechten, als echte array van de bestaande deeplink-id's.
  assert.match(block, /dish_keys\s+text\[\] not null check \(array_length\(dish_keys, 1\) between 1 and 12\)/);
  // Optioneel: geen waarde betekent geen sluitingstijd.
  assert.match(block, /sluit_om\s+timestamptz,/);
  assert.doesNotMatch(block, /sluit_om\s+timestamptz not null/);
  assert.match(block, /created_at\s+timestamptz not null default now\(\)/);
  // Geen verwijzing naar een maker, een account of een apparaat.
  assert.doesNotMatch(block, /maker|owner|user_id|account|session|email|cookie/i);
});

test('0022: kies_stemmen heeft een anoniem kenmerk, een roepnaam en één stem per gerecht', () => {
  const block = tableBlock('kies_stemmen');
  const columns = [...block.matchAll(/^\s{2}([a-z_]+)\s+(bigint|text|boolean|timestamptz)\b/gm)].map((match) => match[1]);
  assert.deepEqual(columns, ['stem_id', 'stemming_code', 'stemmer', 'roepnaam', 'dish_key', 'lekker', 'gestemd_op']);
  assert.match(block, /stem_id\s+bigint generated always as identity primary key/);
  // Het anonieme kenmerk uit de browser, nooit het IP-adres.
  assert.match(block, /stemmer\s+text not null check \(stemmer ~ '\^\[A-Za-z0-9_-\]\{16,64\}\$'\)/);
  assert.doesNotMatch(block, /ip_address|user_agent|inet|cookie|session/i);
  // De roepnaam is zichtbaar en hooguit 24 tekens, ook in de database.
  assert.match(block, /roepnaam\s+text not null check \(char_length\(btrim\(roepnaam\)\) between 1 and 24\)/);
  assert.match(block, /dish_key\s+text not null check \(char_length\(dish_key\) between 3 and 96\)/);
  // Geen neutrale stem: alleen true of false.
  assert.match(block, /lekker\s+boolean not null/);
  // Een nieuwe stem vervangt de vorige voor dat gerecht.
  assert.match(block, /constraint kies_stemmen_uniek unique \(stemming_code, stemmer, dish_key\)/);
  // De stemming verdwijnt met cascade, inclusief de stemmen (7 dagen).
  assert.match(block, /stemming_code text not null references kies_stemmingen \(code\) on delete cascade/);
});

test('0022: RLS aan, geen policy en geen recht voor anon of authenticated', () => {
  assert.match(flat, /alter table kies_stemmingen enable row level security/);
  assert.match(flat, /alter table kies_stemmen enable row level security/);
  assert.doesNotMatch(code, /create policy/i, 'geen policy: niemand leest of schrijft rechtstreeks');
  assert.doesNotMatch(code, /grant [^;]* to (anon|authenticated|public)/i);
  assert.doesNotMatch(code, /to anon\b|to authenticated\b/i);
  assert.match(SQL, /revoke all on public\.kies_stemmingen from public, anon, authenticated;/);
  assert.match(SQL, /revoke all on public\.kies_stemmen from public, anon, authenticated;/);
  // Alleen de serverroute (service role) krijgt rechten, en niets meer.
  assert.match(SQL, /grant select, insert, update, delete on public\.kies_stemmingen to service_role;/);
  assert.match(SQL, /grant select, insert, update, delete on public\.kies_stemmen to service_role;/);
  assert.match(SQL, /grant usage, select on sequence public\.kies_stemmen_stem_id_seq to service_role;/);
  // Eén index voor de uitslag: alle stemmen van één stemming.
  assert.match(code, /create index if not exists kies_stemmen_stemming_idx on kies_stemmen \(stemming_code\);/);
});

test('0022: één opruimfunctie na zeven dagen, security definer met vaste search_path', () => {
  assert.match(
    code,
    /create or replace function verwijder_oude_kies_stemmingen\(p_dagen integer default 7\)\s+returns integer/,
  );
  assert.equal((code.match(/create or replace function /g) || []).length, 1, 'precies één nieuwe functie');
  const fn = functionBlock();
  assert.match(fn, /security definer/);
  assert.match(fn, /set search_path = public, pg_temp/);
  assert.match(fn, /delete from kies_stemmingen/);
  assert.match(fn, /where created_at < now\(\) - make_interval\(days => v_dagen\)/);
  assert.match(fn, /greatest\(coalesce\(p_dagen, 7\), 1\)/, 'nooit alles of niets in één keer');
  // De stemmen gaan mee via on delete cascade; de functie verwijdert ze niet zelf.
  assert.doesNotMatch(fn, /delete from kies_stemmen/);
  // Alleen de service role mag hem uitvoeren; PostgreSQL geeft anders execute aan PUBLIC.
  assert.match(SQL, /revoke all on function public\.verwijder_oude_kies_stemmingen\(integer\) from public, anon, authenticated;/);
  assert.match(SQL, /grant execute on function public\.verwijder_oude_kies_stemmingen\(integer\) to service_role;/);
  assert.doesNotMatch(code, /grant execute on function [^;]* to (anon|authenticated|public)/i);
});

test('0022: additief — geen bestaand object wordt gewijzigd, verwijderd of hernoemd', () => {
  assert.doesNotMatch(code, /drop table|drop column|drop function|drop constraint|truncate|alter column|rename to/i);
  // De enige delete staat in de nieuwe functie; de migratie zelf verwijdert niets.
  const outsideFunction = code.replace(functionBlock(), '');
  assert.doesNotMatch(outsideFunction, /delete from/i);
  assert.match(SQL, /Additive only/, 'de kop zegt het, zodat niemand een wijziging aan een bestaand object verwacht');
});

test('0022: de grenzen en patronen zijn dezelfde als in de app', () => {
  const stemming = fs.readFileSync(path.join(REPO_ROOT, 'src/lib/kiesStemming.js'), 'utf8');
  assert.match(stemming, /KIES_MAX_DISHES = 12/);
  assert.match(stemming, /KIES_MAX_STEMMERS = 50/);
  assert.match(stemming, /KIES_ROEPNAAM_MAX = 24/);
  assert.match(stemming, /KIES_RETENTION_DAYS = 7/);
  assert.match(stemming, /KIES_CODE_PATTERN = \/\^\[A-Za-z0-9_-\]\{22,86\}\$\//);
  assert.match(stemming, /KIES_STEMMER_PATTERN = \/\^\[A-Za-z0-9_-\]\{16,64\}\$\//);
  for (const table of ['kies_stemmingen', 'kies_stemmen']) assert.ok(SQL.includes(table), table);
  assert.match(SQL, /verwijder_oude_kies_stemmingen/);
});

