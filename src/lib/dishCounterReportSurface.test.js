'use strict';

// BE-45 (#114) — de bedrading van de tellertabel.
//
// Zelfde conventie als dishCounterSurface.test.js: de bronbestanden lezen met
// fs + regex. De rekenregels en de rollen staan in dishCounterReport.test.js en
// dishCounterReportHandlers.test.js; hier gaat het om de vraag of de route, de
// pagina en de navigatie ze ook echt zo gebruiken.
//
// Wat deze test bewijst:
//   - er is één interne leesroute (GET /api/internal/v1/tellers) met no-store;
//   - de route authenticeert via de bestaande authenticateInternalRequest en
//     leest via de bestaande server-admin-client, alleen `dish_counters`;
//   - de handler schrijft nooit en leest niet vóór de rolcheck;
//   - de pagina gebruikt de geteste module, aria-pressed, aria-sort, de
//     periodekeuze, de sorteerkeuze op de telefoon en de eerlijke staten;
//   - de gerechtnaam linkt naar de publieke pagina;
//   - Tellers staat in de navigatie (rol internal, secondary) en niet bij een
//     editor of owner;
//   - er komt geen export, geen grafiek, geen nieuwe tabel en geen migratie;
//   - de nieuwe stijlen gebruiken alleen tokens uit app/globals.css.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const code = (source) => source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');

const ROUTE = read('app/api/internal/v1/tellers/route.js');
const DEPS = read('src/lib/dishCounterReportRouteDeps.js');
const HANDLERS = read('src/lib/dishCounterReportHandlers.js');
const REPORT = read('src/lib/dishCounterReport.js');
const PAGE = read('app/internal/tellers/page.js');
const NAV = read('src/lib/internalNav.js');
const CSS = read('app/globals.css');
// BE-52 (#128): de tellerstijlen staan naast de pagina, niet meer in globals.css.
const TELLERS_CSS = read('app/internal/tellers/tellers.css');

const { INTERNAL_MODULES, resolveVisibleModules, groupModulesByPlacement } = require('./internalNav');

test('tellers: één interne GET-route, no-store en geen schrijfactie', () => {
  assert.match(ROUTE, /export async function GET\(request\)/);
  assert.doesNotMatch(ROUTE, /export (async )?function (POST|PUT|PATCH|DELETE)/, 'niets schrijft of overschrijft de tellers');
  assert.match(ROUTE, /dishCounterReportHandlers\.getTellers\(request\)/);
  assert.match(ROUTE, /'Cache-Control': 'no-store'/);
  assert.match(ROUTE, /export const dynamic = 'force-dynamic'/);
  // De route is bedrading: geen eigen query, geen eigen rekenregel.
  assert.doesNotMatch(code(ROUTE), /supabase|from\('|gte\(|lte\(/);
});

test('tellers: authenticatie, server-admin-client en menudata komen via de route-deps', () => {
  assert.match(DEPS, /import \{ authenticateInternalRequest \} from '@\/src\/lib\/internalAuth'/);
  assert.match(DEPS, /import \{ getSupabaseAdmin \} from '@\/src\/lib\/supabaseAdmin'/);
  assert.match(DEPS, /import menusData from '@\/data\/menus\.json'/);
  assert.match(DEPS, /import restaurantsData from '@\/data\/restaurants\.json'/);
  assert.match(DEPS, /createDishCounterReportHandlers\(\{/);
  assert.match(DEPS, /authenticate: authenticateInternalRequest/);
  assert.match(DEPS, /getSupabase: getSupabaseAdmin/);
  // Criterium 2: naam en restaurant uit de bestaande resolutie, niet uit de database.
  assert.match(DEPS, /menus: menusData/);
  assert.match(DEPS, /restaurants: restaurantsData/);

  // De handler zelf kent geen Supabase en geen omgeving: alles is ingespoten.
  assert.doesNotMatch(code(HANDLERS), /supabaseAdmin|process\.env/);
  assert.match(HANDLERS, /\.from\(TABLE\)/);
  assert.match(HANDLERS, /const TABLE = 'dish_counters'/);
  assert.match(HANDLERS, /'dish_key, day, shared, saved, reservation_clicks'/);
  assert.match(HANDLERS, /\.gte\('day', range\.van\)/);
  assert.match(HANDLERS, /\.lte\('day', range\.tot\)/);
  assert.doesNotMatch(code(HANDLERS), /\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/);
  // De rolcheck staat vóór elke leesactie.
  assert.ok(
    HANDLERS.indexOf('isInternalOnly(auth.roles)') < HANDLERS.indexOf('getSupabase()'),
    'geen query vóór de rolcheck'
  );
  assert.match(REPORT, /const FORBIDDEN_MESSAGE = 'Alleen interne medewerkers kunnen de tellers zien.'/);
});

test('tellers: de pagina gebruikt de geteste module en toont de vier verplichte staten', () => {
  assert.match(PAGE, /^'use client'/);
  assert.match(PAGE, /const ENDPOINT = '\/api\/internal\/v1\/tellers'/);
  assert.match(PAGE, /import InternalNav from '@\/src\/components\/InternalNav'/);
  assert.match(PAGE, /from '@\/src\/lib\/dishCounterReport'/);
  // Periodeknoppen, totalen en de sorteerbare tabel.
  assert.match(PAGE, /aria-pressed=\{periode === period\.id\}/);
  assert.match(PAGE, /aria-sort=\{ariaSort\(sort, column\.id\)\}/);
  assert.match(PAGE, /aria-label=\{PERIOD_GROUP_LABEL\}/);
  assert.match(PAGE, /<Totals totalen=\{report\.totalen\} \/>/);
  assert.match(PAGE, /<table className="tellers-table">/);
  // De telefoon: een lijst met een sorteerkeuze.
  assert.match(PAGE, /className="tellers-list"/);
  assert.match(PAGE, /<label htmlFor="tellers-sort">\{SORT_LABEL\}<\/label>/);
  assert.match(PAGE, /parseSortOption\(event\.target\.value\)/);
  // De gerechtnaam linkt naar de publieke pagina, een onbekende sleutel niet.
  assert.match(PAGE, /function DishName\(\{ row \}\)/);
  assert.match(PAGE, /<a className="tellers-dish-link" href=\{row\.href\}>/);
  assert.match(PAGE, /UNKNOWN_DISH_LABEL/);
  // Lege staat, foutstaat en de standaardsortering.
  assert.match(PAGE, /EMPTY_MESSAGE/);
  assert.match(PAGE, /UNAVAILABLE_MESSAGE/);
  assert.match(PAGE, /useState\(DEFAULT_SORT\)/);
  assert.match(PAGE, /role="alert"/);
  // Geen export, geen grafiek.
  assert.doesNotMatch(code(PAGE), /csv|download|Blob|chart|grafiek/i);
});

test('tellers: het navigatie-item staat er voor internal, secundair, en niet voor editor of owner', () => {
  const tellers = INTERNAL_MODULES.find((module) => module.id === 'tellers');
  assert.ok(tellers, 'Tellers staat in INTERNAL_MODULES');
  assert.equal(tellers.label, 'Tellers');
  assert.equal(tellers.href, '/internal/tellers');
  assert.equal(tellers.requiredRole, 'internal');
  assert.equal(tellers.placement, 'secondary');
  assert.ok(!('countKey' in tellers), 'Tellers is geen open werk en toont geen aantal');

  assert.ok(resolveVisibleModules([{ role: 'internal' }]).some((module) => module.id === 'tellers'));
  assert.ok(!resolveVisibleModules([{ role: 'editor' }]).some((module) => module.id === 'tellers'));
  assert.ok(!resolveVisibleModules([{ role: 'owner' }]).some((module) => module.id === 'tellers'));
  const groups = groupModulesByPlacement(resolveVisibleModules([{ role: 'internal' }]));
  assert.ok(groups.secondary.some((module) => module.id === 'tellers'));

  // De navigatie zelf noemt de route, zodat het item ook echt klikbaar is.
  assert.match(NAV, /label: 'Tellers', href: '\/internal\/tellers'/);
});

test('tellers: geen migratie, geen nieuwe tabel, geen wijziging aan dish_counters', () => {
  const migrations = fs.readdirSync(path.join(ROOT, 'supabase', 'migrations'));
  assert.ok(!migrations.some((file) => /be45|teller/i.test(file)), 'BE-45 voegt geen migratie toe');
  assert.ok(migrations.includes('0021_be44_dish_counters.sql'), 'de bestaande migratie blijft de enige tellertabel');
  const migration = read('supabase/migrations/0021_be44_dish_counters.sql');
  assert.match(migration, /create table if not exists dish_counters/);
  // De API leest, de migratie schrijft: geen tweede schrijfpad in deze ronde.
  assert.doesNotMatch(REPORT + HANDLERS + ROUTE + PAGE, /increment_dish_counter/);
});

test('tellers: de stijlen naast de pagina gebruiken alleen tokens uit app/globals.css', () => {
  const start = TELLERS_CSS.indexOf('.tellers-periods');
  assert.ok(start > 0, 'de teller-stijlen staan in app/internal/tellers/tellers.css');
  const block = TELLERS_CSS.slice(start);
  assert.ok(block.includes('.tellers-table'), 'de tabelstijl staat er');
  assert.ok(block.includes('.tellers-cards'), 'de lijststijl staat er');
  assert.ok(block.includes('@media (max-width: 640px)'), 'het telefoonbreekpunt staat er');
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b/, 'geen hardgecodeerde kleur');
  assert.doesNotMatch(block, /\brgba?\(/, 'geen hardgecodeerde kleur');
  const tokens = block.match(/var\(--[a-z-]+\)/g) || [];
  assert.ok(tokens.length > 0);
  for (const token of tokens) {
    const name = token.slice(4, -1); // var(--x) -> --x
    assert.ok(CSS.includes(`${name}:`), `token ${name} bestaat in app/globals.css`);
  }
});
