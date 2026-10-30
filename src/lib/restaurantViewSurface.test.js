'use strict';

// BE-57 (#139, deel 1) — de beacon staat echt op de twee pagina's.
//
// Zelfde conventie als dishCounterSurface.test.js: het bronbestand lezen. Een
// groene lib bewijst nog niet dat de teller ergens draait; dit toetst dat
// /restaurant/<id> en /menu/<id> de beacon mounten, dat de beacon niets tekent
// en dat de beacon zelf geen pagina-blokkerende code bevat.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BEACON = fs.readFileSync(path.join(REPO_ROOT, 'src/components/ViewBeacon.js'), 'utf8');
const RESTAURANT_VIEW = fs.readFileSync(path.join(REPO_ROOT, 'app/restaurant/[id]/RestaurantDetailView.js'), 'utf8');
const MENU_VIEW = fs.readFileSync(path.join(REPO_ROOT, 'app/menu/[id]/MenuView.js'), 'utf8');
const ROUTE = fs.readFileSync(path.join(REPO_ROOT, 'app/api/v1/bekeken/route.js'), 'utf8');

test('bekeken: de beacon staat op /restaurant/[id] en op /menu/[id]', () => {
  assert.match(RESTAURANT_VIEW, /import ViewBeacon from '@\/src\/components\/ViewBeacon'/);
  assert.match(RESTAURANT_VIEW, /<ViewBeacon restaurantId=\{id\} \/>/);
  assert.match(MENU_VIEW, /import ViewBeacon from '@\/src\/components\/ViewBeacon'/);
  assert.match(MENU_VIEW, /<ViewBeacon restaurantId=\{baseId\} \/>/);
});

test('bekeken: het menu telt het restaurant, niet de menukaart', () => {
  // baseId is het restaurantdeel van de menukaart-id (6-diner → 6): de teller
  // is per restaurant per dag, niet per kaart.
  assert.match(MENU_VIEW, /const baseId\s+= id\.split\('-'\)\[0\]/);
});

test('bekeken: de beacon wacht niet, tekent niets en vangt elke fout af', () => {
  assert.match(BEACON, /^'use client'/);
  assert.match(BEACON, /useEffect\(/);
  assert.match(BEACON, /scheduleRestaurantView\(/);
  assert.match(BEACON, /return null/);
  // Fire-and-forget: geen await, geen wachttijd en geen zichtbare stand.
  assert.doesNotMatch(BEACON, /await /);
  assert.doesNotMatch(BEACON, /useState|setTimeout\(/);
  // Respect voor de browserinstelling: de lib beslist, de beacon geeft alleen
  // de echte navigator mee.
  assert.match(BEACON, /navigator: typeof navigator === 'undefined' \? null : navigator/);
  assert.match(BEACON, /storage: sessionStore\(\)/);
});

test('bekeken: de route antwoordt altijd 204 en leest nooit iets terug', () => {
  assert.match(ROUTE, /export async function POST/);
  assert.doesNotMatch(ROUTE, /export async function GET/, 'niets leest de teller via deze route');
  assert.match(ROUTE, /'Cache-Control': 'no-store'/);
  assert.match(ROUTE, /'X-Robots-Tag': 'noindex'/);
  assert.doesNotMatch(ROUTE, /NextResponse\.json/, 'geen inhoud, dus ook geen verklappend antwoord');
});
