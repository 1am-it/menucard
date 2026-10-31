'use strict';

// BE-67 (#164, criterium 1) — de structurele controle op
// supabase/migrations/0026_be67_daghap_b.sql.
//
// Zelfde conventie als daghapMigration.test.js (0023): het migratiebestand zelf
// lezen. Dit vervangt het toepassen niet — de validate-migrations-workflow
// speelt élke migratie op een lege Postgres en de eigenaar past 0026 na de merge
// toe. Hier wordt bewezen dat het bestand doet wat het contract vraagt en niet
// meer dan dat: vijf kolommen erbij, de checks van het contract, dezelfde RLS en
// rechten als 0023, en volledig additief en herhaalbaar.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS = path.join(REPO_ROOT, 'supabase/migrations');
const FILE = '0026_be67_daghap_b.sql';
const SQL = fs.readFileSync(path.join(MIGRATIONS, FILE), 'utf8');
const code = SQL.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
const flat = code.replace(/\s+/g, ' ').toLowerCase();
// Dezelfde tekst, maar inclusief de toelichting: een bewering over wat het
// bestand uitlegt (de kleinste keuze, de 90-dagengrens) hoort daar thuis.
const alles = SQL.replace(/--/g, ' ').replace(/\s+/g, ' ').toLowerCase();

/** Het blok vanaf `start` tot en met het eerste `eind` erna. */
function blok(start, eind) {
  const vanaf = flat.indexOf(start.toLowerCase());
  assert.ok(vanaf >= 0, `dit blok ontbreekt: ${start}`);
  const tot = flat.indexOf(eind.toLowerCase(), vanaf);
  return flat.slice(vanaf, tot > vanaf ? tot : undefined);
}

test('0026: één nieuw, uniek migratienummer na 0025', () => {
  const files = fs.readdirSync(MIGRATIONS).filter((naam) => naam.endsWith('.sql')).sort();
  assert.deepEqual(files.filter((naam) => naam.startsWith('0026')), [FILE]);
  const nummers = files.map((naam) => naam.slice(0, 4));
  assert.equal(new Set(nummers).size, nummers.length, 'elk nummer is uniek');
  // De eerdere migraties blijven staan; de Lead past die lijst aan, niet deze PR.
  for (const ouder of ['0023', '0024', '0025']) {
    assert.ok(files.some((naam) => naam.startsWith(ouder)), `${ouder} staat nog in de reeks`);
  }
  assert.match(SQL, /^-- 0026 /);
  assert.match(SQL, /NOT YET APPLIED/i, 'het bestand wordt niet uitgevoerd in deze PR');
});

test('0026: vijf kolommen erbij op daghap_aanbod, met add column if not exists', () => {
  const kolommen = blok('alter table daghap_aanbod', 'comment on column');
  for (const kolom of ['gangen', 'prijs_3_cent', 'herhaal_weekdagen', 'herhaal_tot', 'uitverkocht_op']) {
    assert.match(kolommen, new RegExp(`add column if not exists ${kolom}\\b`), `de kolom ${kolom} ontbreekt`);
  }
  // De types uit het contract: een gangenlijst, centen, weekdagen als
  // smallint[], een einddatum en de datum van uitverkocht.
  assert.match(kolommen, /add column if not exists gangen jsonb/);
  assert.match(kolommen, /add column if not exists prijs_3_cent integer/);
  assert.match(kolommen, /add column if not exists herhaal_weekdagen smallint\[\]/);
  assert.match(kolommen, /add column if not exists herhaal_tot date/);
  assert.match(kolommen, /add column if not exists uitverkocht_op date/);
  // Eén extra prijskolom naast prijs_cent, niet twee: de kleinste keuze uit het
  // contract, met de uitleg in het bestand zelf.
  assert.match(alles, /one column instead of two/);
  assert.match(alles, /two-course price/);
});

test('0026: de soort dagmenu komt bij de bestaande soorten', () => {
  assert.match(flat, /drop constraint if exists daghap_aanbod_soort_check/);
  assert.match(
    flat,
    /add constraint daghap_aanbod_soort_check check \(soort in \('daghap', 'dagmenu', 'seizoensgerecht'\)\)/,
  );
});


test('0026: de gangen zijn een lijst van 2 of 3 met één hoofdgerecht', () => {
  const helper = blok('create or replace function daghap_gangen_geldig', '$$;');
  assert.match(helper, /returns boolean/);
  assert.match(helper, /immutable/);
  assert.match(helper, /set search_path = public, pg_temp/, 'vaste search_path, zoals 0016-0023');
  assert.match(helper, /jsonb_typeof\(gangen\) = 'array'/);
  assert.match(helper, /jsonb_array_length\(gangen\) between 2 and 3/);
  assert.match(helper, /element ->> 'gang' in \('voor', 'hoofd', 'na'\)/);
  assert.match(helper, /count\(\*\) filter \(where element ->> 'gang' = 'hoofd'\) = 1/, 'precies één hoofdgerecht');
  assert.match(helper, /count\(distinct element ->> 'gang'\) = count\(\*\)/, 'geen dubbele gang');
  assert.match(helper, /between 1 and 80/, 'een naam per gang');
  assert.match(helper, /coalesce\(/, 'een lege of onbekende lijst is ongeldig, niet onbekend');
  // Alleen een dagmenu heeft gangen.
  assert.match(flat, /when soort = 'dagmenu' then daghap_gangen_geldig\(gangen\)/);
  assert.match(flat, /else gangen is null/);
});

test('0026: de derde prijs hoort bij drie gangen en alleen bij een dagmenu', () => {
  const prijs = blok('add constraint daghap_aanbod_prijs_3_check', 'alter table');
  assert.match(prijs, /jsonb_array_length\(gangen\) = 2 and prijs_3_cent is null/);
  assert.match(prijs, /jsonb_array_length\(gangen\) = 3 and prijs_3_cent between 50 and 15000/);
  assert.match(prijs, /else prijs_3_cent is null/, 'buiten een dagmenu is er geen derde prijs');
});

test('0026: de herhaling is een lijst ISO-weekdagen met een einddatum', () => {
  const herhaling = blok('add constraint daghap_aanbod_herhaling_check', 'alter table');
  assert.match(herhaling, /when herhaal_weekdagen is null then herhaal_tot is null/);
  assert.match(herhaling, /array_ndims\(herhaal_weekdagen\) = 1/);
  assert.match(herhaling, /array_length\(herhaal_weekdagen, 1\) between 1 and 7/);
  assert.match(herhaling, /herhaal_weekdagen <@ array\[1, 2, 3, 4, 5, 6, 7\]::smallint\[\]/);
  assert.match(herhaling, /herhaal_tot is not null/);
  // De 90-dagengrens en "vandaag" staan in de API, niet in de database: een
  // check kent geen klok en geen tijdzone.
  assert.match(alles, /the 90-day boundary is the api's rule/);
  assert.doesNotMatch(flat, /herhaal_tot <= (now\(\)|current_date)/, 'geen klok in een check');
});

test('0026: uitverkocht is een datum, geen moment, en vervalt bij het lezen', () => {
  assert.match(flat, /add column if not exists uitverkocht_op date/);
  assert.match(flat, /comment on column daghap_aanbod\.uitverkocht_op is/);
  assert.match(flat, /de stand vervalt vanzelf de volgende dag/);
  // Geen opruimfunctie nodig: elke lezing vergelijkt de datum met vandaag in
  // Europe/Amsterdam, dus een herhaling is morgen weer beschikbaar.
  assert.doesNotMatch(flat, /update daghap_aanbod set uitverkocht_op = null/);
});

test('0026: de geschiedenis kent de twee acties van Op = op', () => {
  const acties = blok('daghap_gebeurtenissen_actie_check', 'same posture');
  for (const actie of [
    'geplaatst', 'gewijzigd', 'offline', 'in_controle', 'gemeld', 'goedgekeurd',
    'verwijderd', 'verlopen', 'recht_afgenomen', 'recht_teruggegeven',
    'uitverkocht', 'beschikbaar',
  ]) {
    assert.ok(acties.includes(`'${actie}'`), `de actie ${actie} ontbreekt`);
  }
});

test('0026: de geschiedenis kent de drie tellers van een aanbod', () => {
  // Uitkomst 4: bekeken, bewaard en gedeeld per aanbod, in de bestaande
  // gebeurtenissentabel — geen nieuwe tabel.
  const acties = blok('daghap_gebeurtenissen_actie_check', 'same posture');
  for (const actie of ['bekeken', 'bewaard', 'gedeeld']) {
    assert.ok(acties.includes(`'${actie}'`), `de teller ${actie} ontbreekt`);
  }
});

test('0026: dezelfde RLS en rechten als 0023, en geen policy', () => {
  assert.match(flat, /alter table daghap_aanbod enable row level security/);
  assert.match(flat, /revoke all on public\.daghap_aanbod from public, anon, authenticated/);
  assert.match(flat, /grant select, insert, update, delete on public\.daghap_aanbod to service_role/);
  // De nieuwe functie is van service_role en van niemand anders.
  assert.match(flat, /revoke all on function public\.daghap_gangen_geldig\(jsonb\) from public, anon, authenticated/);
  assert.match(flat, /grant execute on function public\.daghap_gangen_geldig\(jsonb\) to service_role/);
  assert.doesNotMatch(flat, /create policy/, 'bewust geen policy: alleen de service role komt erbij');
});

test('0026: volledig additief en herhaalbaar', () => {
  assert.doesNotMatch(flat, /drop table|drop column|truncate|delete from/);
  // Alleen de twee daghap-tabellen worden aangeraakt, geen enkel ander object.
  const aangeraakt = [...flat.matchAll(/alter table ([a-z_]+)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(aangeraakt)].sort(), ['daghap_aanbod', 'daghap_gebeurtenissen']);
  // Elke constraint wordt eerst weggehaald als hij bestaat en daarna opnieuw
  // gezet; elke kolom komt er alleen bij als hij nog niet bestaat.
  const toegevoegd = [...flat.matchAll(/add constraint ([a-z_0-9]+)/g)].map((match) => match[1]);
  assert.ok(toegevoegd.length >= 4);
  for (const naam of toegevoegd) {
    assert.match(flat, new RegExp(`drop constraint if exists ${naam}`), `${naam} is niet herhaalbaar`);
  }
  assert.match(flat, /create or replace function daghap_gangen_geldig/);
});
