'use strict';

// BE-55 stap A (#135, criterium 1 en 5) — de structurele controle op
// supabase/migrations/0023_be55_daghap.sql.
//
// Zelfde conventie als kiesMigration.test.js en dishCountersMigration.test.js:
// het migratiebestand zelf lezen. Dit vervangt het toepassen niet — de
// validate-migrations-workflow speelt élke migratie op een lege Postgres en de
// eigenaar past 0023 na de merge toe via "Apply production database
// migrations". Hier wordt bewezen dat het bestand doet wat het contract vraagt
// en niet meer dan dat: drie tabellen, de regels uit het contract als check,
// RLS dicht voor anon en authenticated, alleen service_role rechten, één
// opruimfunctie en volledig additief.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS = path.join(REPO_ROOT, 'supabase/migrations');
const FILE = '0023_be55_daghap.sql';
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
  return [...block.matchAll(/^\s{2}([a-z_]+)\s+(bigint|text|integer|text\[\]|jsonb|uuid|timestamptz)\b/gm)]
    .map((match) => match[1]);
}

test('0023: één nieuw, uniek migratienummer na 0022', () => {
  const files = fs.readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort();
  assert.deepEqual(files.filter((name) => name.startsWith('0023')), [FILE]);
  const nummers = files.map((name) => name.slice(0, 4));
  assert.equal(new Set(nummers).size, nummers.length, 'elk nummer is uniek');
  // Niet "de nieuwste migratie": een volgende migratie (0024, ...) zou deze
  // test dan breken. Alleen dat 0023 bestaat en uniek is telt hier.
  assert.ok(files.includes(FILE), '0023 staat in de reeks');
  assert.match(SQL, /^-- 0023 /);
  assert.match(SQL, /NOT YET APPLIED/i, 'het bestand wordt niet uitgevoerd in deze PR');
});

test('0023: vier tabellen — aanbod, meldingen, geschiedenis en plaatsrecht', () => {
  assert.deepEqual(kolommen(tableBlock('daghap_aanbod')), [
    'id', 'restaurant_id', 'user_id', 'soort', 'naam', 'prijs_cent', 'beschrijving',
    'labels', 'status', 'filter_reden', 'verloopt_op', 'created_at', 'updated_at',
  ]);
  assert.deepEqual(kolommen(tableBlock('daghap_meldingen')), ['melding_id', 'aanbod_id', 'apparaat', 'created_at']);
  assert.deepEqual(kolommen(tableBlock('daghap_gebeurtenissen')), [
    'gebeurtenis_id', 'aanbod_id', 'restaurant_id', 'actie', 'door', 'apparaat', 'gegevens', 'moment',
  ]);
  // De geschiedenis hangt aan het aanbod: verwijderen ruimt de regels mee op.
  // Sinds de interne werkvoorraad (stap B) mag hij leeg zijn: een ontnomen of
  // teruggegeven plaatsrecht hoort bij een restaurant, niet bij één aanbod.
  // Elke plaatsing, wijziging, melding en goedkeuring vult hem nog steeds.
  assert.match(flat, /aanbod_id bigint references daghap_aanbod \(id\) on delete cascade/);
  assert.doesNotMatch(tableBlock('daghap_gebeurtenissen'), /aanbod_id\s+bigint not null/, 'een rechtactie heeft geen aanbod');
  // De vierde tabel: één rij per houder die per restaurant geen aanbod meer
  // mag plaatsen. De API leest hem bij plaatsen en wijzigen.
  assert.deepEqual(kolommen(tableBlock('daghap_plaatsrecht')), [
    'restaurant_id', 'user_id', 'door', 'ingetrokken_op',
  ]);
  assert.match(tableBlock('daghap_plaatsrecht'), /primary key \(restaurant_id, user_id\)/);
  assert.match(tableBlock('daghap_plaatsrecht'), /user_id\s+uuid not null references auth\.users \(id\) on delete cascade/);
});

test('0023: de regels uit het contract staan als check in de tabel', () => {
  const aanbod = tableBlock('daghap_aanbod');
  // Naam 3-80 tekens, prijs € 0,50 - € 150 in centen, beschrijving max 140.
  assert.match(aanbod, /naam\s+text not null check \(char_length\(btrim\(naam\)\) between 3 and 80\)/);
  assert.match(aanbod, /prijs_cent\s+integer not null check \(prijs_cent between 50 and 15000\)/);
  assert.match(aanbod, /beschrijving\s+text check \(beschrijving is null or char_length\(beschrijving\) <= 140\)/);
  // Alleen de drie labels en de vier statussen uit het contract.
  assert.match(aanbod, /labels <@ array\['vegetarisch', 'veganistisch', 'glutenvrij'\]::text\[\]/);
  assert.match(aanbod, /status in \('online', 'in_controle', 'offline', 'verlopen'\)/);
  assert.match(aanbod, /soort in \('daghap', 'seizoensgerecht'\)/);
  // Een verlopen moment ligt na het moment van plaatsen.
  assert.match(aanbod, /check \(verloopt_op > created_at\)/);

  // Een melding is per apparaat uniek per aanbod: geen tweede melding van
  // hetzelfde apparaat, en geen persoonsgegevens.
  const meldingen = tableBlock('daghap_meldingen');
  assert.match(meldingen, /unique \(aanbod_id, apparaat\)/);
  assert.match(meldingen, /apparaat\s+text not null check \(apparaat ~ '\^\[A-Za-z0-9_-\]\{16,64\}\$'\)/);
  assert.doesNotMatch(meldingen, /ip|user_agent|cookie|email/i);

  // De geschiedenis kent alleen de acties uit het contract.
  const geschiedenis = tableBlock('daghap_gebeurtenissen');
  for (const actie of ['geplaatst', 'gewijzigd', 'offline', 'in_controle', 'gemeld', 'goedgekeurd', 'verwijderd', 'verlopen', 'recht_afgenomen', 'recht_teruggegeven']) {
    assert.ok(geschiedenis.includes(`'${actie}'`), `de actie ${actie} ontbreekt`);
  }
});

test('0023: maximaal één actieve daghap per restaurant in de database', () => {
  assert.match(
    flat,
    /create unique index if not exists daghap_aanbod_een_daghap_per_restaurant on daghap_aanbod \(restaurant_id\) where soort = 'daghap' and status in \('online', 'in_controle'\)/,
  );
});

test('0023: RLS aan en geen toegang voor public, anon of authenticated', () => {
  for (const tabel of ['daghap_aanbod', 'daghap_meldingen', 'daghap_gebeurtenissen', 'daghap_plaatsrecht']) {
    assert.match(flat, new RegExp(`alter table ${tabel} enable row level security`));
    assert.match(flat, new RegExp(`revoke all on public\\.${tabel} from public, anon, authenticated`));
    assert.match(flat, new RegExp(`grant select, insert, update, delete on public\\.${tabel} to service_role`));
  }
  // Bewust geen policy: niemand komt er langs RLS binnen, alleen de service role.
  assert.doesNotMatch(flat, /create policy/);
});

test('0023: de opruimfunctie zet verlopen aanbod op verlopen en schrijft geschiedenis', () => {
  const start = code.indexOf('create or replace function ruim_verlopen_daghap_op()');
  assert.ok(start >= 0, 'de opruimfunctie ontbreekt');
  const blok = code.slice(start, code.indexOf('$$;', start));
  assert.match(blok, /returns integer/);
  assert.match(blok, /security definer/);
  assert.match(blok, /set search_path = public, pg_temp/, 'vaste search_path, zoals 0016, 0021 en 0022');
  assert.match(blok, /where verloopt_op <= now\(\)/);
  assert.match(blok, /and status in \('online', 'in_controle'\)/);
  assert.match(blok, /insert into daghap_gebeurtenissen/);
  assert.match(blok, /'verlopen'/);
  // Alleen service_role mag hem aanroepen; PUBLIC krijgt niets.
  assert.match(flat, /revoke all on function public\.ruim_verlopen_daghap_op\(\) from public, anon, authenticated/);
  assert.match(flat, /grant execute on function public\.ruim_verlopen_daghap_op\(\) to service_role/);
});

test('0023: volledig additief — geen bestaand object wordt gewijzigd', () => {
  assert.doesNotMatch(flat, /drop table|drop function|drop column|truncate|delete from/);
  assert.doesNotMatch(flat, /alter table (?!daghap_)/, 'alleen de nieuwe tabellen worden aangeraakt');
  // De identiteitskolommen krijgen hun sequence, niets meer.
  for (const sequence of [
    'daghap_aanbod_id_seq',
    'daghap_meldingen_melding_id_seq',
    'daghap_gebeurtenissen_gebeurtenis_id_seq',
  ]) {
    assert.match(flat, new RegExp(`grant usage, select on sequence public\\.${sequence} to service_role`));
  }
});

