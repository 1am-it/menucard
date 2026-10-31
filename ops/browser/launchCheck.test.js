'use strict';

// BE-70 (#173) — de regressietest van de lanceringscheck.
//
// Het oordeel en het rapport staan in ops/browser/lib/launch-check-report.js en
// zijn zonder browser te testen; dat doet deze file. Daarnaast bewaakt de test
// de bedrading van het echte meetscript: alle pagina's uit het contract, de
// themakeuze via het instellingenpaneel met themeProof, de koude laadmeting via
// CDP Network.loadingFinished met de cache uit, en de gedeelde scenariofilter.
//
// Zelfde conventie als scenarioFilterWiring.test.js: fs.readFileSync + regex,
// geen browser, geen server en geen netwerk.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const report = require('./lib/launch-check-report');

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const CHECK = 'ops/browser/run-launch-check.js';

const groen = (overrides = {}) => ({
  page: 'home',
  path: '/',
  viewport: '1280',
  theme: 'light',
  bytes: 120 * 1024,
  requests: 20,
  imageUrls: ['/icon.svg'],
  overflow: 0,
  targets: [
    { selector: 'a.nav-link', name: 'Restaurants', width: 120, height: 44, inlineInText: false },
    { selector: 'button.icon', name: 'Bewaar Poussin', width: 44, height: 44, inlineInText: false },
  ],
  mainButtons: [{ selector: 'a.btn-primary', text: 'Zoek een gerecht', width: 180, height: 44 }],
  headings: [
    { level: 1, text: 'Wat eten we vandaag?' },
    { level: 2, text: 'Vanavond op de kaart' },
    { level: 3, text: 'Bijna uitverkocht' },
  ],
  focusStep: { done: false, inPage: true, selector: 'a.skip-link', indicator: { visible: true } },
  a11yErrors: [],
  ...overrides,
});

test('BE-70: alleen het logo en de iconen zijn toegestane afbeeldingen', () => {
  assert.equal(report.imageAllowed('/icon.svg'), true);
  assert.equal(report.imageAllowed('/icons/favicon.ico'), true);
  assert.equal(report.imageAllowed('/apple-touch-icon.png?v=2'), true);
  assert.equal(report.imageAllowed('/assets/logo-wordmark.svg#x'), true);
  assert.equal(report.imageAllowed('/photos/poussin.jpg'), false);
  assert.equal(report.imageAllowed('/menu/6-diner/opengraph-image'), false);
  assert.equal(report.imageAllowed(''), false);
  assert.equal(report.imageAllowed(null), false);
});

test('BE-70: de laadgrootte heeft een harde grens van 250 kB', () => {
  assert.equal(report.BUDGET_KB, 250);
  assert.equal(report.loadVerdict(120).passed, true);
  assert.equal(report.loadVerdict(250).passed, true, 'precies op het budget is nog goed');
  assert.equal(report.loadVerdict(250.1).passed, false, 'erboven is rood');
  assert.equal(report.loadVerdict(0).passed, true);
  assert.equal(report.loadVerdict(undefined).passed, false, 'geen meting is geen groen');
  assert.equal(report.roundKb(1024), 1);
  assert.equal(report.roundKb(256000), 250);
  assert.equal(report.roundKb('onzin'), 0);
});

test('BE-70: overloop is pas groen zonder horizontale overloop', () => {
  assert.equal(report.overflowVerdict(0).passed, true);
  assert.equal(report.overflowVerdict(-1).passed, true);
  assert.equal(report.overflowVerdict(1).passed, false);
  assert.equal(report.overflowVerdict(null).passed, false, 'geen meting is rood');
});

test('BE-70: tikdoelen minstens 24 px, tekstlinks in een zin uitgezonderd', () => {
  const klein = report.targetVerdict([{ selector: 'a.x', name: 'x', width: 23, height: 24 }]);
  assert.equal(klein.passed, false);
  assert.equal(klein.tooSmall.length, 1);
  assert.equal(report.targetVerdict([{ selector: 'a.x', name: 'x', width: 24, height: 24 }]).passed, true);
  assert.equal(report.targetVerdict([{ selector: 'a.x', name: 'x', width: 10, height: 10, inlineInText: true }]).passed, true);
  assert.equal(report.targetVerdict([]).passed, true);
});

test('BE-70: de hoofdknoppen zijn minstens 44 px', () => {
  assert.equal(report.mainButtonVerdict([{ selector: 'a.btn', text: 'Zoek', width: 120, height: 44 }]).passed, true);
  const teKlein = report.mainButtonVerdict([{ selector: 'a.btn', text: 'Zoek', width: 120, height: 43 }]);
  assert.equal(teKlein.passed, false);
  assert.equal(teKlein.small.length, 1);
  // Een pagina zonder hoofdknoppen is niet rood; de reden staat er wel bij.
  const leeg = report.mainButtonVerdict([]);
  assert.equal(leeg.passed, true);
  assert.match(leeg.detail, /geen hoofdknoppen/);
});

test('BE-70: precies één h1 en geen overgeslagen kopniveau', () => {
  assert.equal(report.headingVerdict([{ level: 1, text: 'a' }, { level: 2, text: 'b' }]).passed, true);
  const twee = report.headingVerdict([{ level: 1, text: 'a' }, { level: 1, text: 'b' }]);
  assert.equal(twee.passed, false);
  assert.equal(twee.h1Count, 2);
  const sprong = report.headingVerdict([{ level: 1, text: 'a' }, { level: 3, text: 'c' }]);
  assert.equal(sprong.passed, false);
  assert.equal(sprong.jumps.length, 1);
  assert.equal(report.headingVerdict([{ level: 2, text: 'zonder h1' }]).passed, false);
});

test('BE-70: de eerste Tab moet op een zichtbare focus landen', () => {
  assert.equal(report.keyboardVerdict({ done: false, inPage: true, selector: 'a.skip', indicator: { visible: true } }).passed, true);
  assert.equal(report.keyboardVerdict({ done: false, inPage: true, selector: 'a.skip', indicator: { visible: false } }).passed, false);
  assert.equal(report.keyboardVerdict({ done: false, inPage: true, selector: 'a.skip', indicator: null }).passed, false);
  assert.equal(report.keyboardVerdict({ done: true, inPage: false }).passed, false);
  assert.equal(report.keyboardVerdict(null).passed, false);
});

test('BE-70: de a11y-audit is pas groen zonder fouten', () => {
  assert.equal(report.a11yVerdict([]).passed, true);
  const rood = report.a11yVerdict([{ criterion: 'contrast', reason: 'contrast-te-laag', name: 'p.tekst', detail: '3.1:1' }]);
  assert.equal(rood.passed, false);
  assert.equal(rood.errors[0].criterion, 'contrast');
  assert.match(rood.detail, /1 fouten/);
});

test('BE-70: een meting wordt één rij met de acht controles', () => {
  const rij = report.comboRow(groen());
  assert.equal(rij.passed, true, JSON.stringify(rij.red));
  assert.equal(rij.red.length, 0);
  assert.deepEqual(Object.keys(rij.controls), ['load', 'images', 'overflow', 'targets', 'mainButtons', 'headings', 'keyboard', 'a11y']);
  assert.equal(rij.bytes, 20 * 6144);
});

test('BE-70: elk rood punt noemt zijn eigen controle', () => {
  const rij = report.comboRow(groen({
    bytes: 300 * 1024,
    imageUrls: ['/icon.svg', '/photos/poussin.jpg'],
    overflow: 12,
    targets: [{ selector: 'a.klein', name: 'klein', width: 20, height: 20, inlineInText: false }],
    mainButtons: [{ selector: 'a.btn', text: 'Zoek', width: 120, height: 30 }],
    headings: [{ level: 1, text: 'a' }, { level: 1, text: 'b' }, { level: 3, text: 'c' }],
    focusStep: { done: false, inPage: true, selector: 'a.x', indicator: { visible: false } },
    a11yErrors: [{ criterion: 'naam', reason: 'geen-naam', name: 'button.icon' }],
  }));
  assert.equal(rij.passed, false);
  assert.deepEqual(rij.red, ['laadgrootte', 'afbeeldingen', 'overloop', 'tikdoelen', 'hoofdknoppen', 'koppen', 'toetsenbord', 'a11y']);
  assert.match(rij.controls.images.offending[0], /poussin/);
  assert.equal(rij.controls.a11y.errors[0].reason, 'geen-naam');
});

test('BE-70: de paginasamenvatting neemt de eerste meting en de zwaarste', () => {
  const rijen = [
    report.comboRow(groen({ viewport: '390', theme: 'light', bytes: 180 * 1024 })),
    report.comboRow(groen({ viewport: '1280', theme: 'light', bytes: 150 * 1024 })),
    report.comboRow(groen({ viewport: '320', theme: 'dark', bytes: 210 * 1024, overflow: 3 })),
  ];
  const samenvatting = report.pageSummary(rijen);
  assert.equal(samenvatting.page, 'home');
  assert.equal(samenvatting.combos, 3);
  assert.equal(samenvatting.loadKb, 150, 'de eerste meting is 1280 px in licht');
  assert.equal(samenvatting.worstLoadKb, 210);
  assert.equal(samenvatting.green, false);
  assert.equal(samenvatting.red.overflow, 1);
  assert.equal(report.summaryOf(rijen).length, 1);
});

test('BE-70: het rapport noemt per pagina de laadgrootte en groen of rood', () => {
  const goed = report.comboRow(groen());
  const fout = report.comboRow(groen({ page: 'menu', path: '/menu/6-diner', bytes: 260 * 1024, a11yErrors: [{ criterion: 'contrast', reason: 'contrast-te-laag', name: 'p.prijs' }] }));
  const md = report.markdownReport({
    ranAt: '2026-10-31T12:00:00.000Z',
    port: 3198,
    budgetKb: 250,
    rows: [goed, fout],
    openPoints: ['`/privacy` bestaat nog niet.'],
  });
  assert.match(md, /^# Lanceringscheck publieke pagina's/);
  assert.match(md, /\| `\/` \| 120 kB \(groen\)/);
  assert.match(md, /\| `\/menu\/6-diner` \| 260 kB \(rood \(1\/1\)\)/);
  assert.match(md, /260 kB/);
  assert.match(md, /rode punten met de reden/i);
  assert.match(md, /`\/menu\/6-diner` · 1280 px · light · \*\*laadgrootte\*\*/);
  assert.match(md, /contrast-te-laag/);
  assert.match(md, /`\/privacy` bestaat nog niet/);
  assert.match(md, /Ontwikkelaarsbewijs/);
});

test('BE-70: het rapport is groen zonder rode punten', () => {
  const md = report.markdownReport({ rows: [report.comboRow(groen())], openPoints: [] });
  assert.match(md, /Alle pagina's zijn groen op alle controles\./);
  assert.doesNotMatch(md, /Rode punten/);
  assert.match(md, /Nog geen open punten vastgelegd/);
});

// ─── De bedrading van het echte meetscript ───────────────────────────────────

test('BE-70: de check neemt alle pagina\'s uit het contract op', () => {
  const source = read(CHECK);
  for (const pad of [
    "path: '/'",
    "path: '/search?q=steak'",
    "path: '/search?q=qzxvbb'",
    "path: '/restaurant/6'",
    "path: '/menu/6-diner'",
    "path: '/restaurants'",
    "path: '/alle-restaurants'",
    "path: '/mijn-lijstje'",
    'path: `/kies/${KIES_CODE}`',
    "path: '/r/6'",
    "path: '/voor-restaurants'",
    "path: '/inloggen'",
  ]) {
    assert.ok(source.includes(pad), `de check mist ${pad}`);
  }
  // "Mijn lijstje" leeg en met drie gerechten, en een restaurant met dagmenu.
  assert.equal((source.match(/name: 'mijn-lijstje-leeg'/g) || []).length, 1);
  assert.equal((source.match(/name: 'mijn-lijstje-drie'/g) || []).length, 1);
  assert.match(source, /name: 'restaurant-met-dagmenu'/);
  // Licht en donker op 1280, 390 en 320 px.
  assert.match(source, /const THEMES = \['light', 'dark'\]/);
  assert.match(source, /\{ name: '1280', width: 1280, height: 900 \}/);
  assert.match(source, /\{ name: '390', width: 390, height: 844 \}/);
  assert.match(source, /\{ name: '320', width: 320, height: 720 \}/);
});

test('BE-70: de laadgrootte komt uit CDP met de cache uit', () => {
  const source = read(CHECK);
  assert.match(source, /Network\.enable/);
  assert.match(source, /Network\.setCacheDisabled', \{ cacheDisabled: true \}/);
  assert.match(source, /cdp\.on\('Network\.loadingFinished'/);
  assert.match(source, /params\.encodedDataLength/);
  assert.match(source, /mode: 'start'/);
  assert.match(source, /budgetKb: report\.BUDGET_KB/);
});

test('BE-70: het thema gaat via het instellingenpaneel en het paneel is dicht bij de opname', () => {
  const source = read(CHECK);
  assert.match(source, /const SETTINGS_PANEL = '\.pha-panel'/);
  assert.match(source, /clickThemeScript/);
  assert.match(source, /themeOk\(proof, theme\)/);
  assert.match(source, /theme_lost_after_close/);
  // Het paneel gaat dicht vóór de opname: closeSettings eerst, daarna pas shot().
  const meet = source.slice(source.indexOf('async function meetPagina'));
  assert.ok(meet.indexOf('applyTheme(cdp, theme, label)') < meet.indexOf('await shot('), 'de opname komt vóór het sluiten van het paneel');
  assert.match(meet, /themeProof: proof/);
});

test('BE-70: de controles uit het contract zitten in de check', () => {
  const source = read(CHECK);
  assert.match(source, /audit\.inPageSource\('auditPage', \[\{ minTarget: 44, midTarget: 24 \}\]\)/);
  assert.match(source, /audit\.checksFromAudit\(page\.name/);
  assert.match(source, /pressKey\(cdp, 'Tab', 'Tab', 9\)/);
  assert.match(source, /readFocusStep/);
  assert.match(source, /scrollWidth - window\.innerWidth/);
  assert.match(source, /MAIN_BUTTONS/);
  // De stubs van de bestaande checks, niet opnieuw geschreven.
  assert.match(source, /require\('\.\/lib\/be67-daghap-stub'\)/);
  assert.match(source, /require\('\.\/lib\/be62-kies-stub'\)/);
});

test('BE-70: de check gebruikt de gedeelde scenariofilter en schrijft het bewijs', () => {
  const source = read(CHECK);
  assert.match(source, /parseScenarioArgs\(process\.argv\.slice\(2\), SCENARIOS\)/);
  assert.match(source, /filteredEvidencePath\(BASE_EVIDENCE_PATH, SELECTION\.filter\)/);
  assert.match(source, /filter: SELECTION\.filter/);
  assert.match(source, /scenarios: scenarioRuns/);
  assert.match(source, /EVIDENCE_DIR, 'launch-check\.json'/);
  assert.match(source, /'docs', 'launch-check\.md'/);
  const guard = source.indexOf('scenarioSelectionOutcome({ selection: SELECTION');
  const start = source.indexOf('await startServer(');
  assert.ok(guard > 0 && guard < start, 'de vlag wordt gelezen nadat de check al is gestart');
});

test('BE-70: het bewijs noemt elke pagina met zes metingen', { skip: !fs.existsSync(path.join(ROOT, 'ops/browser/evidence/launch-check.json')) }, () => {
  const bewijs = JSON.parse(read('ops/browser/evidence/launch-check.json'));
  assert.equal(bewijs.budgetKb, 250);
  assert.equal(bewijs.rows.length, bewijs.summary.length * 6, 'elke pagina heeft licht en donker op drie breedtes');
  for (const samenvatting of bewijs.summary) {
    assert.ok(typeof samenvatting.loadKb === 'number', `${samenvatting.page} mist zijn laadgrootte`);
    assert.ok(samenvatting.loadKb > 0, `${samenvatting.page} meet 0 kB`);
  }
});
