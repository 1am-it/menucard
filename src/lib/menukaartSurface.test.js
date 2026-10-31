'use strict';

// BE-58 deel 2 (#143) — bronregressie op de schermen.
//
// De pure regels en de API's hebben hun eigen tests; dit bestand bewaakt de
// bedrading die daar tussen zit en die je met `node --test` kunt zien:
//   - de publieke pagina's halen de overlay server-side op, per restaurant, en
//     geven het bevestigingslabel door aan de weergave;
//   - de weergave toont "Bevestigd door het restaurant" en "Tijdelijk niet
//     beschikbaar" alleen op basis van die gegevens;
//   - de houder- en de interne pagina bestaan, gebruiken hun eigen CSS-bestand
//     en praten met de afgesproken routes;
//   - "Menukaart bijwerken" staat in het overzicht van Mijn restaurant.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

test('BE-58: de publieke pagina\'s halen de overlay server-side op en geven het label door', () => {
  for (const file of ['app/menu/[id]/page.js', 'app/restaurant/[id]/page.js']) {
    const bron = read(file);
    assert.match(bron, /laadPubliekeOverlay/, `${file} haalt de overlay op`);
    assert.match(bron, /overlayVoorMenu/, `${file} legt de overlay op de kaart`);
    assert.match(bron, /bevestiging=/, `${file} geeft het bevestigingslabel door`);
    assert.doesNotMatch(bron, /fetch\(/, `${file} doet geen clientfetch en geen tweede route`);
  }
});

test('BE-58: de overlay gaat alleen over het restaurant van deze pagina', () => {
  const menuPage = read('app/menu/[id]/page.js');
  assert.match(menuPage, /laadPubliekeOverlay\(baseId\)/);
  const restaurantPage = read('app/restaurant/[id]/page.js');
  assert.match(restaurantPage, /laadPubliekeOverlay\(id\)/);
  assert.match(restaurantPage, /restaurant \? await laadPubliekeOverlay/, 'geen restaurant, geen opvraag');
});

test('BE-58: de weergave toont het label en het tijdelijk-niet-beschikbaar-label', () => {
  const body = read('src/components/MenuBody.js');
  assert.match(body, /export function MenuConfirmation/);
  assert.match(body, /Bevestigd door het restaurant/);
  assert.match(body, /tijdelijkNietBeschikbaar/);
  assert.match(body, /import '\.\/menu-body\.css'/);
  for (const file of ['app/menu/[id]/MenuView.js', 'app/restaurant/[id]/RestaurantDetailView.js']) {
    assert.match(read(file), /MenuConfirmation/, `${file} rendert het label`);
  }
});

test('BE-58: de houderpagina en de interne lijst bestaan met eigen opmaak en de afgesproken routes', () => {
  const houder = read('app/mijn-restaurant/menukaart/MenukaartBeheer.js');
  assert.match(houder, /import '\.\/menukaart\.css'/);
  assert.match(houder, /\/api\/v1\/menukaart\/gerechten/);
  assert.match(houder, /\/api\/v1\/menukaart\/wijzigingen/);
  assert.match(houder, /\/api\/v1\/menukaart\/bevestigen/);
  assert.match(houder, /inputMode="decimal"/);
  assert.match(houder, /Wijzigingen opslaan/);
  assert.match(houder, /Bevestig je menukaart/);
  assert.match(houder, /IN_CONTROLE_MESSAGE/);
  assert.match(houder, /\{IN_CONTROLE_MESSAGE\}/, 'de regel staat onder de gerechten');

  const intern = read('app/internal/menukaart-wijzigingen/page.js');
  assert.match(intern, /import '\.\/wijzigingen\.css'/);
  assert.match(intern, /\/api\/internal\/v1\/menukaart-wijzigingen/);
  assert.match(intern, /goedkeuren/);
  assert.match(intern, /afwijzen/);
  assert.match(intern, /Grote wijziging/);
});

test('BE-58: "Menukaart bijwerken" staat in Mijn restaurant en in de interne navigatie', () => {
  assert.match(read('app/mijn-restaurant/OwnerDashboard.js'), /href="\/mijn-restaurant\/menukaart"/);
  const nav = require('./internalNav');
  const item = nav.INTERNAL_MODULES.find((m) => m.id === 'menukaart-wijzigingen');
  assert.ok(item, 'het item bestaat');
  assert.equal(item.href, '/internal/menukaart-wijzigingen');
  assert.equal(item.requiredRole, 'internal');
  assert.equal(item.placement, 'secondary', 'onder de scheidingslijn, zodat het totaal geen nep-getal wordt');
  assert.ok(!('countKey' in item), 'geen verzonnen telling');
});

test('BE-58: de overlay komt uit de cache, niet uit een nieuwe vraag per bezoek', () => {
  const loader = read('src/lib/menukaartOverlayServer.js');
  assert.match(loader, /unstable_cache/, 'de overlay hangt in de Data Cache');
  assert.match(loader, /OVERLAY_CACHE_SECONDS/, 'met een vangnet-revalidate');
  assert.match(loader, /overlayTag\(id\)/, 'met een tag per restaurant');
  assert.match(loader, /cachePerRestaurant/, 'één gecachte functie per restaurant');
  // Alleen dit restaurant, nooit de hele tabel.
  assert.match(loader, /overlay\?restaurant=/);
});

test('BE-58: goedkeuren en bevestigen verversen de publieke pagina\'s via een dependency', () => {
  const handler = read('src/lib/snelAanpassenHandlers.js');
  assert.match(handler, /revalidate = null/, 'de dependency is optioneel en testbaar');
  assert.match(handler, /await verseKaart\(rij\.menu_id, rij\.restaurant_id\)/, 'goedkeuren ververst');
  assert.match(handler, /await verseKaart\(menuId, restaurantId\)/, 'bevestigen ververst');

  const deps = read('src/lib/snelAanpassenRouteDeps.js');
  assert.match(deps, /revalidate: maakMenukaartVerversen\(\{ revalidatePath, revalidateTag \}\)/);

  const verversen = require('./menukaartVerversen');
  assert.deepEqual(verversen.publiekePaden({ menuId: '9-lunch', restaurantId: '9' }), [
    '/menu/9-lunch',
    '/restaurant/9',
  ]);
});

test('BE-58: afwijzen verandert niets publiek en ververst dus niet', () => {
  const handler = read('src/lib/snelAanpassenHandlers.js');
  const afwijzen = handler.slice(handler.indexOf('async function wijsAf'));
  assert.equal(afwijzen.includes('verseKaart('), false);
});
