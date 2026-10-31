'use strict';

// BE-60 (#150) — de bedrading van /api/search naar de overlay.
//
// De logica zelf is getest in src/lib/zoekOverlay.test.js (met nep-functies) en
// src/services/dishSearch.test.js (tegen de echte data). Hier blijft over: de
// route gebruikt die twee, en de serverloader hergebruikt de gecachte opvraag
// van BE-58 in plaats van een eigen Supabase-vraag. Dat is met een broncheck te
// bewijzen, zoals app/search/page.test.js en src/lib/menukaartSurface.test.js
// dat voor hun eigen pagina's doen.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..');
const ROUTE = path.join(REPO_ROOT, 'app/api/search/route.js');
const LOADER = path.join(REPO_ROOT, 'src/lib/zoekOverlayServer.js');
const PAGE = path.join(REPO_ROOT, 'app/search/page.js');
const CSS = path.join(REPO_ROOT, 'app/search/search.css');

function bron(bestand) {
  return fs.readFileSync(bestand, 'utf8');
}

test('BE-60: /api/search haalt de overlay op en geeft hem aan de zoeklaag', () => {
  const route = bron(ROUTE);
  assert.match(route, /import \{ zoekMetOverlay \} from '@\/src\/lib\/zoekOverlay'/, 'de route gebruikt de geteste zoekfunctie');
  assert.match(route, /import \{ laadZoekOverlay \} from '@\/src\/lib\/zoekOverlayServer'/, 'en de serverloader met de BE-58-cache');
  assert.match(route, /await zoekMetOverlay\(\{/, 'het antwoord komt uit één wachtende zoekopdracht');
  assert.match(route, /\n\s+overlay,/, 'de overlay gaat mee naar searchDishes');
});

test('BE-60: de serverloader hergebruikt de gecachte overlay van BE-58', () => {
  const loader = bron(LOADER);
  assert.match(loader, /import \{ laadPubliekeOverlay \} from '@\/src\/lib\/menukaartOverlayServer'/, 'dezelfde gecachte opvraag per restaurant, met de tag van BE-58');
  assert.doesNotMatch(loader, /@supabase/, 'geen eigen Supabase-client en dus geen tweede querypad');
  assert.doesNotMatch(loader, /unstable_cache/, 'de cache staat in BE-58, niet hier nog een keer');
});

test('BE-60: de zoekpagina toont het label "Tijdelijk niet beschikbaar"', () => {
  const page = bron(PAGE);
  assert.match(page, /const TIJDELIJK_NIET_BESCHIKBAAR = 'Tijdelijk niet beschikbaar'/, 'hetzelfde label als op de menukaart');
  assert.match(page, /example\.tijdelijkNietBeschikbaar &&/, 'alleen als het gerecht het echt heeft');
  assert.match(page, /className="dish-result-unavailable"/, 'met een eigen klasse');
});

test('BE-60: het label heeft eigen opmaak in het CSS-bestand van de pagina', () => {
  const css = bron(CSS);
  assert.match(css, /\.dish-result-unavailable \{/, 'eigen klasse in app/search/search.css (BE-52)');
  const zonderCommentaar = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(zonderCommentaar, /#[0-9a-fA-F]{3,6}\b/, 'kleuren alleen via de bestaande tokens');
});

test('BE-60: geen migratie en geen nieuwe dependency', () => {
  const pkg = JSON.parse(bron(path.join(REPO_ROOT, 'package.json')));
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), [
    '@anthropic-ai/sdk', '@supabase/supabase-js', 'next', 'pdfjs-dist', 'qrcode-generator', 'react', 'react-dom',
  ], 'BE-68 voegde qrcode-generator toe; verder dezelfde afhankelijkheden als voor BE-60');
});
