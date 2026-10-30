'use strict';

// BE-44 (#105, criterium 5) — de structurele controle op
// supabase/migrations/0021_be44_dish_counters.sql.
//
// Zelfde conventie als batchAnalysisMigration.test.js en sourceTriageMigration.test.js:
// het migratiebestand zelf lezen. Dit is geen vervanging van het toepassen: de
// bestaande validate-migrations-workflow (CI) speelt élke migratie op een lege
// Postgres. Hier wordt bewezen dat het bestand doet wat het contract vraagt en
// niet meer dan dat: één tabel per gerecht per dag met drie tellers, geen
// identiteit, geen leesrechten voor buiten, één schrijffunctie, additief.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS = path.join(REPO_ROOT, 'supabase/migrations');
const FILE = '0021_be44_dish_counters.sql';
const SQL = fs.readFileSync(path.join(MIGRATIONS, FILE), 'utf8');
const code = SQL.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
const flat = code.replace(/\s+/g, ' ').toLowerCase();

/** Het create-table-blok van dish_counters. */
function tableBlock() {
  const start = code.indexOf('create table if not exists dish_counters');
  assert.ok(start >= 0, 'de tabel dish_counters ontbreekt');
  const end = code.indexOf(');', start);
  return code.slice(start, end);
}

/** De functie increment_dish_counter, van create tot $$;. */
function functionBlock() {
  const start = code.indexOf('create or replace function increment_dish_counter(');
  assert.ok(start >= 0, 'de functie increment_dish_counter ontbreekt');
  const end = code.indexOf('$$;', start);
  return code.slice(start, end);
}

test('0021: één nieuw, uniek migratienummer na 0020', () => {
  const files = fs.readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort();
  assert.deepEqual(files.filter((name) => name.startsWith('0021')), [FILE]);
  const numbers = files.map((name) => name.slice(0, 4));
  assert.equal(new Set(numbers).size, numbers.length, 'elk nummer is uniek');
  // 0021 is het nummer van deze migratie; latere migraties (0022, BE-46) staan
  // er los van en veranderen 0021 niet.
  assert.ok(files.includes(FILE));
  assert.match(SQL, /^-- 0021 /);
  assert.match(SQL, /NOT YET APPLIED/i, 'het bestand wordt niet uitgevoerd in deze PR');
});

test('0021: één tabel dish_counters met per gerecht per dag drie tellers', () => {
  const block = tableBlock();
  const columns = [...block.matchAll(/^\s{2}([a-z_]+)\s+(text|date|integer)\b/gm)].map((match) => match[1]);
  assert.deepEqual(columns, ['dish_key', 'day', 'shared', 'saved', 'reservation_clicks']);
  assert.match(block, /dish_key\s+text not null check \(char_length\(dish_key\) between 3 and 96\)/);
  assert.match(block, /day\s+date not null/);
  for (const [name, column] of [['shared', 'shared'], ['saved', 'saved'], ['reservation_clicks', 'reservation_clicks']]) {
    assert.match(block, new RegExp(`${column}\\s+integer not null default 0 check \\(${name} >= 0\\)`));
  }
  // Eén rij per gerecht per dag: dat is de primaire sleutel.
  assert.match(block, /primary key \(dish_key, day\)/);
  // Geen eigen id, geen tijdstip per gebeurtenis, geen verwijzing naar een mens.
  assert.doesNotMatch(block, /identity|serial|created_at|updated_at|uuid|references/i);
});

test('0021: geen persoonsgegevens — geen ip, user-agent, user-id, cookie of sessie', () => {
  const block = tableBlock();
  for (const forbidden of ['ip_address', 'user_agent', 'user_id', 'cookie', 'session', 'email', 'actor', 'device']) {
    assert.doesNotMatch(block, new RegExp(forbidden, 'i'), `${forbidden} in de tabel`);
  }
  // De functie accepteert alleen een gerecht-id en een gebeurtenis.
  assert.match(code, /create or replace function increment_dish_counter\(p_dish_key text, p_event text\)/);
  // De enige kolommen die iets over de gebeurtenis zeggen zijn de drie tellers.
  assert.doesNotMatch(block, /jsonb|json|text\[\]|inet/i);
});

test('0021: row level security aan zonder policy, en alleen de service role heeft rechten', () => {
  assert.match(SQL, /alter table dish_counters enable row level security;/);
  assert.doesNotMatch(code, /create policy|drop policy|alter policy|for select|for insert|for update/i, 'geen policy voor anon of authenticated');
  assert.match(SQL, /revoke all on public\.dish_counters from public, anon, authenticated;/);
  assert.match(SQL, /grant select, insert, update on public\.dish_counters to service_role;/);
  assert.doesNotMatch(SQL, /grant [^;]* to (anon|authenticated|public)/i, 'geen lees- of schrijfrecht voor de buitenwereld');
});

test('0021: één functie increment_dish_counter(text, text), security definer met vaste search_path', () => {
  assert.match(code, /create or replace function increment_dish_counter\(p_dish_key text, p_event text\)\s+returns void/);
  assert.equal((code.match(/create or replace function /g) || []).length, 1, 'precies één nieuwe functie');
  const fn = functionBlock();
  assert.match(fn, /security definer/);
  assert.match(fn, /set search_path = public, pg_temp/);
  // De upsert gaat naar vandaag in UTC, niet naar de lokale dag van de server.
  assert.match(fn, /v_day\s+date := \(now\(\) at time zone 'utc'\)::date/);
  assert.match(fn, /insert into dish_counters/);
  assert.match(fn, /on conflict \(dish_key, day\) do update set/);
  // Alleen de drie bekende gebeurtenissen, met hun eigen kolom.
  assert.match(fn, /p_event not in \('gedeeld', 'bewaard', 'reserveren'\)/);
  assert.match(fn, /shared\s+= c\.shared \+ case when p_event = 'gedeeld' then 1 else 0 end/);
  assert.match(fn, /saved\s+= c\.saved \+ case when p_event = 'bewaard' then 1 else 0 end/);
  assert.match(fn, /reservation_clicks = c\.reservation_clicks \+ case when p_event = 'reserveren' then 1 else 0 end/);
  // Een onbekend event of een ongeldige id schrijft niets.
  assert.match(fn, /raise exception 'unknown dish counter event/);
  assert.match(fn, /raise exception 'invalid dish key/);
  assert.match(fn, /v_dish_key !~ '\^\[a-z0-9\]\+/);
});

test('0021: execute alleen voor de service role, niet voor anon, authenticated of public', () => {
  assert.match(SQL, /revoke all on function public\.increment_dish_counter\(text, text\) from public, anon, authenticated;/);
  assert.match(SQL, /grant execute on function public\.increment_dish_counter\(text, text\) to service_role;/);
  assert.doesNotMatch(SQL, /grant execute on function [^;]* to (anon|authenticated|public)/i);
});

test('0021: additief — geen bestaand object wordt gewijzigd, verwijderd of hernoemd', () => {
  assert.doesNotMatch(code, /drop table|drop column|drop function|drop constraint|delete from|truncate|alter column|rename to/i);
  // Alleen de nieuwe tabel krijgt een alter table (row level security).
  const altered = [...code.matchAll(/alter table (\w+)\s+(\w+)/gi)].map((match) => [match[1], match[2]]);
  assert.deepEqual(altered, [['dish_counters', 'enable']]);
  assert.match(SQL, /Additive only/, 'de kop zegt het, zodat niemand een wijziging aan een bestaand object verwacht');
});

test('0021: de route, de lib en de migratie gebruiken dezelfde namen', () => {
  const counters = fs.readFileSync(path.join(REPO_ROOT, 'src/lib/dishCounters.js'), 'utf8');
  assert.match(counters, /DISH_COUNTER_ENDPOINT = '\/api\/v1\/tellers'/);
  assert.match(counters, /DISH_COUNTER_FUNCTION = 'increment_dish_counter'/);
  assert.match(counters, /DISH_COUNTER_EVENTS = \[SHARED_EVENT, SAVED_EVENT, RESERVATION_EVENT\]/);
  // Dezelfde drie woorden als de functie in de migratie.
  for (const event of ['gedeeld', 'bewaard', 'reserveren']) {
    const literal = event === 'gedeeld' ? 'SHARED_EVENT' : event === 'bewaard' ? 'SAVED_EVENT' : 'RESERVATION_EVENT';
    assert.match(counters, new RegExp(`${literal} = '${event}'`), event);
    assert.ok(SQL.includes(`'${event}'`), `${event} staat in de migratie`);
  }
  // En de route bestaat echt op het pad dat de browser gebruikt.
  assert.ok(fs.existsSync(path.join(REPO_ROOT, 'app/api/v1/tellers/route.js')));
});
