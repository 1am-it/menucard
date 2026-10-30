'use strict';

// BE-58 deel 1 (#143, criterium 1 en 5) — de structurele controle op
// supabase/migrations/0025_be58_snel_aanpassen.sql.
//
// Zelfde conventie als daghapMigration.test.js en kiesMigration.test.js: het
// migratiebestand zelf lezen. Dit vervangt het toepassen niet — de
// validate-migrations-workflow speelt élke migratie op een lege Postgres en de
// eigenaar past 0025 na de merge toe. Hier wordt bewezen dat het bestand doet
// wat het contract vraagt en niet meer dan dat: drie tabellen, de regels uit het
// contract als check, RLS dicht voor anon en authenticated, alleen service_role
// rechten, geen foreign key naar de nog niet gemergede 0023 en volledig
// additief.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS = path.join(REPO_ROOT, 'supabase/migrations');
const FILE = '0025_be58_snel_aanpassen.sql';
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

/** De kolomnamen van een tabelblok, in volgorde. */
function kolommen(block) {
  return [...block.matchAll(/^\s{2}([a-z_]+)\s+(bigint|text|integer|boolean|jsonb|uuid|timestamptz)\b/gm)]
    .map((match) => match[1]);
}

test('0025: één nieuw, uniek migratienummer na 0022', () => {
  const files = fs.readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort();
  assert.deepEqual(files.filter((name) => name.startsWith('0025')), [FILE]);
  const nummers = files.map((name) => name.slice(0, 4));
  assert.equal(new Set(nummers).size, nummers.length, 'elk nummer is uniek');
  assert.ok(files.includes(FILE), '0025 staat in de reeks');
  assert.match(SQL, /^-- 0025 /);
  assert.match(SQL, /NOT YET APPLIED/i, 'het bestand wordt niet uitgevoerd in deze PR');
});

test('0025: drie tabellen — wijzigingen, bevestiging en geschiedenis', () => {
  assert.deepEqual(kolommen(tableBlock('menukaart_wijzigingen')), [
    'wijziging_id', 'restaurant_id', 'menu_id', 'categorie_index', 'gerecht_index',
    'gerecht_naam', 'user_id', 'soort', 'oude_prijs_cent', 'prijs_cent',
    'beschikbaar', 'status', 'grote_wijziging', 'afwijs_reden', 'beoordeeld_door',
    'beoordeeld_op', 'created_at', 'updated_at',
  ]);
  assert.deepEqual(kolommen(tableBlock('menukaart_bevestigingen')), [
    'restaurant_id', 'user_id', 'bevestigd_op', 'updated_at',
  ]);
  assert.deepEqual(kolommen(tableBlock('menukaart_gebeurtenissen')), [
    'gebeurtenis_id', 'wijziging_id', 'restaurant_id', 'actie', 'door', 'gegevens', 'moment',
  ]);
});

test('0025: de contractregels staan als check in de database', () => {
  // Prijs tussen € 0,50 en € 150.
  assert.match(flat, /prijs_cent between 50 and 15000/);
  // Alleen de twee soorten en de drie statussen.
  assert.match(flat, /soort in \('prijs', 'beschikbaarheid'\)/);
  assert.match(flat, /status in \('in_controle', 'goedgekeurd', 'afgewezen'\)/);
  // Een afwijzing heeft een reden; een beoordeling hoort bij een beslissing.
  assert.match(flat, /status = 'afgewezen' and beoordeeld_op is not null and afwijs_reden is not null/);
  // Een prijswijziging heeft een prijs, een beschikbaarheidswijziging een boolean.
  assert.match(flat, /soort = 'prijs' and prijs_cent is not null and beschikbaar is null/);
  assert.match(flat, /soort = 'beschikbaarheid' and beschikbaar is not null and prijs_cent is null/);
  // De markering en de geschiedenisacties.
  assert.match(flat, /grote_wijziging boolean not null default false/);
  assert.match(flat, /actie in \('ingediend', 'goedgekeurd', 'afgewezen', 'bevestigd'\)/);
});

test('0025: de bevestiging is één rij per restaurant en de oude kaart blijft', () => {
  assert.match(flat, /create table if not exists menukaart_bevestigingen \( restaurant_id text primary key/);
  assert.match(flat, /bevestigd_op timestamptz not null default now\(\)/);
  // De statische menudata wordt nooit beschreven: geen tabel of kolom daarvan.
  assert.doesNotMatch(flat, /alter table (menus|menu_items|restaurants)\b/);
  assert.doesNotMatch(flat, /delete from (menus|restaurants)\b/);
});

test('0025: RLS aan en alleen service_role, geen policy voor anon of authenticated', () => {
  for (const tabel of ['menukaart_wijzigingen', 'menukaart_bevestigingen', 'menukaart_gebeurtenissen']) {
    assert.match(flat, new RegExp(`alter table ${tabel} enable row level security`));
    assert.match(flat, new RegExp(`revoke all on public\\.${tabel} from public, anon, authenticated`));
    assert.match(flat, new RegExp(`grant select, insert`));
  }
  assert.doesNotMatch(flat, /create policy/);
  assert.doesNotMatch(flat, /grant [a-z, ]+ on public\.menukaart_[a-z_]+ to (anon|authenticated)/);
});

test('0025: additief en zonder afhankelijkheid van de nog niet gemergede 0023', () => {
  assert.doesNotMatch(flat, /daghap_plaatsrecht/);
  assert.doesNotMatch(flat, /drop table|drop column|alter table [a-z_]+ (add|drop) column/);
  assert.doesNotMatch(flat, /drop function|create or replace function/);
  // Niets uit de bestaande reeks wordt aangeraakt.
  assert.doesNotMatch(flat, /alter table (staff_roles|restaurant_claims|field_provenance|pending_changes)\b/);
  assert.match(flat, /grant usage, select on sequence public\.menukaart_wijzigingen_wijziging_id_seq to service_role/);
});
