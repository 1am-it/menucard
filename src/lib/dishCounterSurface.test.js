'use strict';

// BE-44 (#105, criterium 5) — de bedrading van de anonieme tellers.
//
// Zelfde conventie als dishShareSurface.test.js en dishListSurface.test.js: het
// bronbestand lezen met fs + regex. De rekenregels en de volgorde staan in
// dishCounters.test.js en dishCounterHandlers.test.js; hier gaat het om de vraag
// of de route, de knoppen en de menukaart ze ook echt zo gebruiken.
//
// Wat deze test bewijst:
//   - er is één openbare route (POST /api/v1/tellers) en geen leesroute;
//   - die route antwoordt altijd met de status van de handler (204) en noemt
//     nooit een fout, een gerecht of een teller in zijn antwoord;
//   - de echte client en de echte menukaarten komen alleen via de route-deps
//     binnen;
//   - "Delen" telt na een geslaagd delen of kopiëren, "Bewaren" alleen bij
//     aanzetten, "Reserveer" bij een klik — alle drie fire-and-forget;
//   - er gaat geen cookie, localStorage of eigen id mee, en niets toont de
//     tellers.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const code = (source) => source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');

const ROUTE = read('app/api/v1/tellers/route.js');
const DEPS = read('src/lib/dishCounterRouteDeps.js');
const HANDLERS = read('src/lib/dishCounterHandlers.js');
const COUNTERS = read('src/lib/dishCounters.js');
const SHARE_BUTTON = read('src/components/DishShareButton.js');
const SAVE_BUTTON = read('src/components/DishSaveButton.js');
const MENU_VIEW = read('app/menu/[id]/MenuView.js');
const MENU_BODY = read('src/components/MenuBody.js');

test('tellers: één openbare POST-route, geen leesroute en geen tweede schrijver', () => {
  assert.match(ROUTE, /export async function POST\(request\)/);
  assert.doesNotMatch(ROUTE, /export (async )?function (GET|PUT|PATCH|DELETE)/, 'niets leest of overschrijft de tellers');
  assert.match(ROUTE, /dishCounterHandlers\.countDishEvent\(request\)/);
  assert.match(ROUTE, /new NextResponse\(null, \{/);
  assert.match(ROUTE, /'Cache-Control': 'no-store'/);
  // Het antwoord is leeg: geen teller, geen gerechtnaam en geen foutdetail.
  assert.doesNotMatch(code(ROUTE), /error|message|catch|console\./i);
});

test('tellers: de echte client en de echte menukaarten komen alleen via de route-deps binnen', () => {
  assert.match(DEPS, /import \{ getSupabaseAdmin \} from '@\/src\/lib\/supabaseAdmin'/);
  assert.match(DEPS, /import menusData from '@\/data\/menus\.json'/);
  assert.match(DEPS, /createDishCounterHandlers\(\{/);
  assert.match(DEPS, /getSupabase: getSupabaseAdmin/);
  assert.match(DEPS, /menus: menusData/);

  // De handler zelf kent geen Supabase en geen omgeving: alles is ingespoten.
  assert.doesNotMatch(code(HANDLERS), /supabaseAdmin|process\.env/);
  assert.match(HANDLERS, /supabase\.rpc\(DISH_COUNTER_FUNCTION, \{/);
  assert.match(HANDLERS, /p_dish_key: dish\.dishKey/);
  assert.match(HANDLERS, /p_event: body\.event/);
  // En de limiet: één verzoek per seconde per gerecht en gebeurtenis.
  assert.match(HANDLERS, /limiter\.allow\(dish\.dishKey, body\.event\)/);
});

test('tellers: "Delen" telt na een geslaagde deelactie, nooit na een afbreking', () => {
  assert.match(SHARE_BUTTON, /import \{ SHARED_EVENT, sendDishCounter \} from '@\/src\/lib\/dishCounters'/);
  assert.match(SHARE_BUTTON, /void sendDishCounter\(\{ dish, event: SHARED_EVENT \}\)/);
  // BE-49 (#115) — elke manier gaat door de ene deeluitvoering, met dezelfde
  // teller. Die telt in src/lib/sharePreference.js alleen bij een geslaagde
  // actie (unit-tests daar) en nooit bij een afbreking of weigering.
  assert.match(SHARE_BUTTON, /await performShare\(\{/);
  assert.match(SHARE_BUTTON, /count: countShared/);
  // De knop wacht nooit op de teller.
  assert.doesNotMatch(SHARE_BUTTON, /await sendDishCounter/);
});

test('tellers: "Bewaren" telt alleen bij aanzetten, "Reserveer" bij een klik, allebei fire-and-forget', () => {
  assert.match(SAVE_BUTTON, /import \{ SAVED_EVENT, sendDishCounter \} from '@\/src\/lib\/dishCounters'/);
  assert.match(SAVE_BUTTON, /if \(result\.saved\) void sendDishCounter\(\{ dish: entry && entry\.id, event: SAVED_EVENT \}\)/);
  assert.doesNotMatch(SAVE_BUTTON, /await sendDishCounter/, 'de knop wacht nooit op de teller');

  assert.match(MENU_VIEW, /import \{ RESERVATION_EVENT, sendDishCounter \} from '@\/src\/lib\/dishCounters'/);
  assert.match(MENU_VIEW, /const reservationDishKey = dishTarget \? `\$\{id\}-\$\{dishTarget\.catIdx\}-\$\{dishTarget\.itemIdx\}` : null/);
  assert.match(MENU_VIEW, /void sendDishCounter\(\{ dish: reservationDishKey, event: RESERVATION_EVENT \}\)/);
  const primary = MENU_VIEW.slice(MENU_VIEW.indexOf('rp-btn-reserveer') - 400, MENU_VIEW.indexOf('rp-btn-reserveer') + 400);
  assert.match(primary, /onClick=\{countReservationClick\}/, 'de reserveringslink is de klik waar geteld wordt');
  assert.doesNotMatch(MENU_VIEW, /await sendDishCounter/);
});

test('tellers: elke gerechtkaart geeft zijn eigen id mee aan de teller', () => {
  assert.match(MENU_BODY, /dishKey = null/);
  // BE-49 (#115) — dezelfde kaart geeft ook de gerechtnaam mee voor de
  // aria-labels; de id blijft de id van dit gerecht.
  assert.match(MENU_BODY, /<DishShareButton\n\s*href=\{shareHref\}\n\s*title=\{shareTitle\}\n\s*entry=\{saveEntry\}\n\s*dishKey=\{dishKey\}\n\s*name=\{item\.name\}\n\s*\/>/);
  assert.match(MENU_VIEW, /dishKey=\{originalItemIndex >= 0 && origIdx >= 0 \? `\$\{id\}-\$\{origIdx\}-\$\{originalItemIndex\}` : null\}/);
  // Het Publicatievoorbeeld geeft geen id en telt dus niets.
  const staticMenu = MENU_BODY.slice(MENU_BODY.indexOf('export function StaticMenu'));
  assert.doesNotMatch(staticMenu, /dishKey/);
});

test('tellers: geen cookie, geen opslag en geen eigen id in de telcode', () => {
  for (const source of [COUNTERS, HANDLERS, ROUTE, SHARE_BUTTON, SAVE_BUTTON]) {
    assert.doesNotMatch(code(source), /document\.cookie|localStorage|sessionStorage|navigator\.sendBeacon/);
  }
  // De browserkant stuurt geen cookie en geen herkomst mee.
  assert.match(code(COUNTERS), /credentials: 'omit'/);
  assert.match(code(COUNTERS), /referrerPolicy: 'no-referrer'/);
  assert.match(code(COUNTERS), /keepalive: true/);
});

test('tellers: niets toont de stand van de tellers', () => {
  for (const source of [MENU_VIEW, MENU_BODY, SHARE_BUTTON, SAVE_BUTTON, ROUTE]) {
    const text = code(source);
    assert.doesNotMatch(text, /dish_counters|shared_count|saved_count|reservation_clicks/, 'geen teller in de weergave');
  }
});
