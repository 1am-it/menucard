'use strict';

// BE-57 (#139, deel 2) — de schermen van "Mijn restaurant" als geheel: de
// pagina haalt de cijfers bij de eigen route op, toont ze per restaurant, en
// bevat niets uit een volgend ticket (QR, mail, "Bevestigd", "Menukaart
// bijwerken"), en geen nieuwe dependency.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8').replace(/\r\n/g, '\n');

const DASHBOARD = read('app/mijn-restaurant/OwnerDashboard.js');
const PANEL = read('app/mijn-restaurant/OwnerStatsPanel.js');
const CSS = read('app/mijn-restaurant/mijn-restaurant-cijfers.css');
const VIEW = read('src/lib/ownerStatsView.js');
const ROUTE = read('app/api/mijn-restaurant/[id]/cijfers/route.js');

test('BE-57: het overzicht haalt de cijfers bij de eigen route, met de sessie', () => {
  assert.match(DASHBOARD, /\/api\/mijn-restaurant\/\$\{encodeURIComponent\(id\)\}\/cijfers/);
  assert.match(DASHBOARD, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.match(DASHBOARD, /buildStatsView\(/);
  assert.match(DASHBOARD, /ownedRestaurantIds\(roles\)/);
  assert.match(DASHBOARD, /<OwnerStatsPanel view=\{statsById\[restaurant\.id\]\} \/>/);
  // En de route bestaat en gebruikt de geteste handler.
  assert.match(ROUTE, /createOwnerStatsHandlers\(/);
});

test('BE-57: elk cijferblok staat bij het restaurant en nergens anders', () => {
  assert.equal(DASHBOARD.match(/<OwnerStatsPanel/g).length, 1);
  // Alleen voor de eigen owner-rijen: een goedgekeurde claim zonder owner-rij
  // krijgt geen cijferblok.
  assert.match(DASHBOARD, /overview\.hasOwnerAccess && ownedIds\.includes\(restaurant\.id\)/);
  // Een mislukte telling blijft bij de ene kaart.
  assert.match(DASHBOARD, /if \(res\.status === 403\) \{[\s\S]*forbidden: true/);
});

test('BE-57: het cijferblok toont "Deze week", de top, de privacyregel en "Je menukaart"', () => {
  assert.match(PANEL, /\{week\.title\}/);
  assert.match(PANEL, /\{week\.privacy\}/);
  assert.match(PANEL, /\{top\.title\}/);
  assert.match(PANEL, /\{menu\.title\}/);
  assert.match(PANEL, /\{menu\.note\}/);
  // De balkjes zijn decoratief: het aantal staat ernaast als tekst.
  assert.match(PANEL, /aria-hidden="true"/);
  assert.match(PANEL, /style=\{\{ width: `\$\{row\.percent\}%` \}\}/);
  // De standen.
  assert.match(PANEL, /view\.status === 'cijfers'/);
  assert.match(PANEL, /view\.status === 'net-geclaimd'/);
  assert.match(PANEL, /role="status"/);
});

test('BE-57: de stand "net geclaimd" noemt de maand en drie dingen, zonder links', () => {
  const startBlock = PANEL.slice(PANEL.indexOf('function WelcomeBlock'), PANEL.indexOf('export default function OwnerStatsPanel'));
  assert.match(startBlock, /welcome\.monthTitle/);
  assert.match(startBlock, /welcome\.startTitle/);
  assert.match(startBlock, /welcome\.startItems\.map/);
  // Geen <Link> in het welkomstblok: wat nog niet bestaat is geen knop.
  assert.equal(startBlock.includes('<Link'), false);
  // De drie punten komen uit het geteste model.
  assert.match(VIEW, /Drie dingen om mee te beginnen/);
});

test('BE-57: niets uit een volgend ticket staat op dit scherm', () => {
  // Commentaar mag een grens benoemen; wat telt is de code die het scherm tekent.
  const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const code = { paneel: stripComments(PANEL), dashboard: stripComments(DASHBOARD), model: stripComments(VIEW) };
  // 'Bevestigd' en 'Menukaart bijwerken' kwamen met BE-58 (#143) en mogen nu.
  for (const forbidden of ['QR-code', 'qr-code']) {
    for (const [name, source] of Object.entries(code)) {
      assert.equal(source.includes(forbidden), false, `${forbidden} hoort niet in ${name}`);
    }
  }
});

test('BE-57: de opmaak staat in een eigen bestand met de bestaande tokens', () => {
  assert.match(PANEL, /import '\.\/mijn-restaurant-cijfers\.css'/);
  assert.match(CSS, /BE-57 \(issue 139\)/);
  // Geen eigen kleuren: alleen tokens uit app/globals.css.
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(CSS), false, 'geen hardgecodeerde kleur');
  assert.equal(/rgba?\(/.test(CSS), false, 'geen hardgecodeerde kleur');
  assert.match(CSS, /var\(--accent\)/);
  assert.match(CSS, /var\(--text-primary\)/);
  // Licht en donker volgen de tokens; geen enkele theme-override nodig.
  assert.equal(CSS.includes('data-theme'), false);
});

test('BE-57: geen nieuwe dependency voor dit scherm', () => {
  const pkg = JSON.parse(read('package.json'));
  const panelImports = [...PANEL.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
  for (const specifier of panelImports) {
    const isLocal = specifier.startsWith('.') || specifier.startsWith('@/');
    assert.ok(isLocal || specifier === 'next/link', `onverwachte import: ${specifier}`);
  }
  assert.equal(Object.keys(pkg.dependencies).includes('@axe-core/puppeteer'), false);
});
