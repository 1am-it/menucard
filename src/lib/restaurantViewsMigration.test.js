'use strict';

// BE-57 (#139) — de structurele controle op
// supabase/migrations/0024_be57_bekeken.sql.
//
// Zelfde conventie als dishCountersMigration.test.js en kiesMigration.test.js:
// het migratiebestand zelf lezen. Dit vervangt het toepassen niet — de
// bestaande validate-migrations-workflow (CI) speelt élke migratie op een lege
// Postgres. Hier wordt bewezen dat het bestand doet wat het contract vraagt en
// niet meer dan dat: één tabel per restaurant per UTC-dag met één teller, geen
// identiteit, geen leesrechten voor buiten, één schrijffunctie, additief.
//
// 0023 is gereserveerd voor BE-55 (de daghap, nog niet gemerged). Daarom toetst
// deze test de doorlopende nummering op uniciteit en op "0024 is de laatste",
// niet op een sluitende reeks zonder gaten.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS = path.join(REPO_ROOT, 'supabase/migrations');
const FILE = '0024_be57_bekeken.sql';
const SQL = fs.readFileSync(path.join(MIGRATIONS, FILE), 'utf8');
const code = SQL.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');

/** Het create-table-blok van restaurant_views. */
function tableBlock() {
  const start = code.indexOf('create table if not exists restaurant_views');
  assert.ok(start >= 0, 'de tabel restaurant_views ontbreekt');
  const end = code.indexOf(');', start);
  return code.slice(start, end);
}

/** De functie increment_restaurant_view, van create tot $$;. */
function functionBlock() {
  const start = code.indexOf('create or replace function increment_restaurant_view(');
  assert.ok(start >= 0, 'de functie increment_restaurant_view ontbreekt');
  const end = code.indexOf('$$;', start);
  return code.slice(start, end);
}

test('0024: een uniek migratienummer, en 0024 is het hoogste', () => {
  const files = fs.readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort();
  assert.deepEqual(files.filter((name) => name.startsWith('0024')), [FILE]);
  const numbers = files.map((name) => name.slice(0, 4));
  assert.equal(new Set(numbers).size, numbers.length, 'elk nummer is uniek');
  // 0023 hoort bij BE-55 en staat hier bewust nog niet: geen sluitende reeks
  // eisen, wel dat deze migratie het hoogste nummer is.
  assert.equal(numbers[numbers.length - 1], '0024');
  assert.match(SQL, /^-- 0024 /);
  assert.match(SQL, /NOT YET APPLIED/i, 'het bestand wordt niet uitgevoerd in deze PR');
});

test('0024: één tabel restaurant_views met per restaurant per dag één teller', () => {
  const block = tableBlock();
  const columns = [...block.matchAll(/^\s{2}([a-z_]+)\s+(text|date|integer)\b/gm)].map((match) => match[1]);
  assert.deepEqual(columns, ['restaurant_id', 'day', 'viewed']);
  assert.match(block, /restaurant_id\s+text not null check \(restaurant_id ~ '\^\[a-z0-9\]\{1,24\}\$'\)/);
  assert.match(block, /day\s+date not null/);
  assert.match(block, /viewed\s+integer not null default 0 check \(viewed >= 0\)/);
  // Eén rij per restaurant per dag: dat is de primaire sleutel.
  assert.match(block, /primary key \(restaurant_id, day\)/);
  // Geen eigen id, geen tijdstip per bezoek, geen verwijzing naar een mens.
  assert.doesNotMatch(block, /identity|serial|created_at|updated_at|uuid|references/i);
});

test('0024: geen persoonsgegevens — geen ip, user-agent, user-id, cookie of sessie', () => {
  const block = tableBlock();
  for (const forbidden of ['ip_address', 'user_agent', 'user_id', 'cookie', 'session', 'stemmer', 'referrer']) {
    assert.doesNotMatch(block, new RegExp(`\\b${forbidden}\\b`, 'i'), forbidden);
  }
  // De schrijffunctie neemt alleen een restaurant-id aan: geen bezoekersgegeven.
  const fn = functionBlock();
  assert.doesNotMatch(fn, /ip_address|user_agent|user_id|cookie|session|referrer/i);
});

test('0024: row level security aan, en alleen de service role heeft rechten', () => {
  assert.match(SQL, /alter table restaurant_views enable row level security;/);
  assert.match(SQL, /revoke all on public\.restaurant_views from public, anon, authenticated;/);
  assert.match(SQL, /grant select, insert, update on public\.restaurant_views to service_role;/);
  assert.doesNotMatch(SQL, /create policy/i, 'geen policy voor anon of authenticated');
  assert.doesNotMatch(SQL, /grant [^;]* to (anon|authenticated|public)/i, 'geen lees- of schrijfrecht voor de buitenwereld');
});

test('0024: één functie increment_restaurant_view(text), security definer met vaste search_path', () => {
  assert.match(code, /create or replace function increment_restaurant_view\(p_restaurant_id text\)\s+returns void/);
  assert.equal((code.match(/create or replace function /g) || []).length, 1, 'precies één nieuwe functie');
  const fn = functionBlock();
  assert.match(fn, /security definer/);
  assert.match(fn, /set search_path = public, pg_temp/);
  // De upsert gaat naar vandaag in UTC, niet naar de lokale dag van de server.
  assert.match(fn, /v_day\s+date := \(now\(\) at time zone 'utc'\)::date/);
  assert.match(fn, /insert into restaurant_views/);
  assert.match(fn, /on conflict \(restaurant_id, day\) do update set/);
  assert.match(fn, /viewed = v\.viewed \+ 1/);
  // Een ongeldige id schrijft niets.
  assert.match(fn, /raise exception 'invalid restaurant id/);
});

test('0024: execute alleen voor de service role, niet voor anon, authenticated of public', () => {
  assert.match(SQL, /revoke all on function public\.increment_restaurant_view\(text\) from public, anon, authenticated;/);
  assert.match(SQL, /grant execute on function public\.increment_restaurant_view\(text\) to service_role;/);
  assert.match(SQL, /revoke all on function public\.increment_restaurant_view\(text\) from service_role;/);
  assert.doesNotMatch(SQL, /grant execute on function [^;]* to (anon|authenticated|public)/i);
});

test('0024: additief — geen bestaand object wordt gewijzigd, verwijderd of hernoemd', () => {
  assert.doesNotMatch(code, /drop table|drop column|drop function|drop constraint|delete from|truncate|alter column|rename to/i);
  // Alleen de nieuwe tabel krijgt een alter table (row level security).
  const altered = [...code.matchAll(/alter table (\w+)\s+(\w+)/gi)].map((match) => [match[1], match[2]]);
  assert.deepEqual(altered, [['restaurant_views', 'enable']]);
  // De bestaande dish_counters (0021) blijft ongemoeid: geen vierde event, geen
  // extra kolom.
  assert.doesNotMatch(code, /dish_counters/i);
  assert.match(SQL, /Additive only/);
});

test('0024: de lib, de route en de migratie gebruiken dezelfde namen', () => {
  const views = fs.readFileSync(path.join(REPO_ROOT, 'src/lib/restaurantViews.js'), 'utf8');
  const beacon = fs.readFileSync(path.join(REPO_ROOT, 'src/lib/viewBeacon.js'), 'utf8');
  // De endpointnaam staat in de browsercode (die gaat naar de pagina's), de
  // functie- en tabelnaam in de serverkant.
  assert.match(beacon, /VIEW_ENDPOINT = '\/api\/v1\/bekeken'/);
  assert.match(views, /VIEW_FUNCTION = 'increment_restaurant_view'/);
  assert.match(views, /VIEW_TABLE = 'restaurant_views'/);
  assert.ok(fs.existsSync(path.join(REPO_ROOT, 'app/api/v1/bekeken/route.js')));
});
