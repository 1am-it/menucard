'use strict';

// BE-62 (#153) — het geheel op bronniveau: waar het terugkomvlak staat, waar de
// tip vandaan komt en wat er niet bij hoort (geen pop-up, geen modal, geen
// nieuwe dependency, geen eigen kleuren). De teksten zelf staan in
// returnVisit.test.js en homeScreenTip.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8').replace(/\r\n/g, '\n');

const KIES = read('app/kies/[code]/KiesView.js');
const MENU_BODY = read('src/components/MenuBody.js');
const MENU_VIEW = read('app/menu/[id]/MenuView.js');
const LIJST = read('app/mijn-lijstje/MijnLijstjeView.js');
const LAYOUT = read('app/layout.js');
const GATE = read('src/components/BeginschermTipGate.js');
const TIP = read('src/components/BeginschermTip.js');
const BLOCK = read('src/components/ZoekGerechtBlock.js');
const BLOCK_CSS = read('src/components/zoek-gerecht-block.css');
const TIP_CSS = read('src/components/beginscherm-tip.css');
const GLOBALS = read('app/globals.css');

const {
  SHARED_RETURN_BODY,
  SHARED_RETURN_CTA,
  SHARED_RETURN_TITLE,
} = require('./returnVisit');

const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('BE-62: /kies toont de vraag alleen na een eigen stem', () => {
  assert.match(KIES, /const ZoekGerechtBlock = dynamic\(\(\) => import\('@\/src\/components\/ZoekGerechtBlock'\), \{ ssr: false \}\)/);
  assert.match(KIES, /const hasOwnVotes = !!\(progress && Array\.isArray\(progress\.gestemd\) && progress\.gestemd\.length > 0\)/);
  assert.match(KIES, /\{hasOwnVotes \? \(/);
  assert.match(KIES, /title=\{kiesReturnTitle\(ownLekkerName\)\}/);
  // De kop komt uit het eerste "lekker"-gerecht van deze bezoeker.
  assert.match(KIES, /firstLekkerDishName\(\{ dishes, lekker: ownLekker \}\)/);
  assert.match(KIES, /nextVotedDishes\(progress, \{ dishKey: dish\.id, lekker \}\)/);
  assert.match(KIES, /undoVotedDishes\(progress\)/);
  // Precies één vlak, en alleen binnen de uitslag.
  assert.equal(KIES.match(/<ZoekGerechtBlock/g).length, 1);
  const results = KIES.slice(KIES.indexOf("{phase === 'uitslag' && stemming ? ("));
  assert.ok(results.indexOf('<ZoekGerechtBlock') > 0, 'het vlak staat in de uitslag');
});

test('BE-62: een gedeeld gerecht krijgt hetzelfde vlak ná de kaart met Bewaar', () => {
  // Eén component en één stylesheet voor alle drie de plekken: de menukaart, het
  // gedeelde lijstje en /kies. Ronde 1 zette de opmaak hier zelf neer; dan laadde
  // de menukaart de CSS nooit en stond het vlak zonder vorm in de pagina.
  assert.match(MENU_BODY, /import ZoekGerechtBlock from '@\/src\/components\/ZoekGerechtBlock'/);
  assert.match(MENU_BODY, /import \{ SHARED_RETURN_BODY, SHARED_RETURN_CTA, SHARED_RETURN_TITLE \} from '@\/src\/lib\/returnVisit'/);
  assert.equal(MENU_BODY.match(/<ZoekGerechtBlock/g).length, 1);
  assert.match(MENU_BODY, /<ZoekGerechtBlock\s+variant="dish"\s+title=\{SHARED_RETURN_TITLE\}\s+body=\{SHARED_RETURN_BODY\}\s+cta=\{SHARED_RETURN_CTA\}/);
  // Geen tweede kopie van de opmaak in dit bestand.
  assert.equal(MENU_BODY.includes('className="zoek-gerecht zoek-gerecht--dish"'), false);
  // De volgorde in de markup (review ronde 2, punt 2): eerst de deelregel, dan
  // het gedeelde gerecht met de bestaande Bewaar-knop, en pas daarna het vlak.
  const note = MENU_BODY.indexOf('{shareNote && <div className="dish-share-note">');
  const save = MENU_BODY.indexOf('entry={saveEntry}');
  const block = MENU_BODY.indexOf('<ZoekGerechtBlock');
  assert.ok(note > 0, 'de deelregel ontbreekt');
  assert.ok(save > note, 'de Bewaar-knop hoort ná de deelregel');
  assert.ok(block > save, 'het vlak hoort ná het gedeelde gerecht met Bewaar');
  // En het vlak staat buiten de gerechtkaart: tussen Bewaar en het vlak sluiten
  // de voet van de kaart en de kaart zelf.
  assert.match(MENU_BODY.slice(save, block), /<\/div>\s*<\/div>/, 'het vlak staat nog in de gerechtkaart');
  // Deelregel en vlak delen dezelfde voorwaarde (alleen bij een gedeelde link).
  assert.match(MENU_BODY, /\{shareNote && \(/);
  // De bestaande bewaarknop blijft op de kaart staan (Bewaar + Delen).
  assert.match(MENU_BODY, /<DishShareButton[\s\S]*?entry=\{saveEntry\}/);
  // En de deelregel verschijnt alleen bij een gedeelde link, zoals voorheen.
  assert.match(MENU_VIEW, /shareNote=\{isResolvedTarget && hasShareTheme\(standParam\)\}/);
});

test('BE-62: een gedeeld lijstje krijgt hetzelfde vlak, naast de bestaande bewaarknop', () => {
  assert.match(LIJST, /import ZoekGerechtBlock from '@\/src\/components\/ZoekGerechtBlock'/);
  assert.match(LIJST, /\{ADD_TO_OWN_LIST_LABEL\}/);
  assert.equal(LIJST.match(/<ZoekGerechtBlock/g).length, 1);
  const sharedBranch = LIJST.slice(LIJST.indexOf('{shared ? ('), LIJST.indexOf(') : own.length === 0 ? ('));
  assert.ok(sharedBranch.includes('<ZoekGerechtBlock'), 'het vlak staat in de tak van het gedeelde lijstje');
  assert.ok(sharedBranch.includes('ADD_TO_OWN_LIST_LABEL'), 'de bestaande bewaarknop staat ernaast');
  // De woorden in het lijstje zijn dezelfde als die van het gedeelde gerecht;
  // het vlak op de menukaart staat in MenuBody (zie de test hierboven).
  for (const source of [LIJST]) {
    assert.ok(source.includes(`title="${SHARED_RETURN_TITLE}"`));
    assert.ok(source.includes(`body="${SHARED_RETURN_BODY}"`));
    assert.ok(source.includes(`cta="${SHARED_RETURN_CTA}"`));
    assert.doesNotMatch(source, /from '@\/src\/lib\/returnVisit'/);
  }
});

test('BE-62: de tip laadt pas na de check en staat op elke publieke pagina', () => {
  assert.match(LAYOUT, /import BeginschermTipGate from '@\/src\/components\/BeginschermTipGate'/);
  assert.match(LAYOUT, /<body>\{children\}<BeginschermTipGate \/><\/body>/);
  // Pas na de voorwaarden: de regels en de kaart zelf komen via dynamic import.
  assert.match(GATE, /import dynamic from 'next\/dynamic'/);
  assert.match(GATE, /const BeginschermTip = dynamic\(\(\) => import\('\.\/BeginschermTip'\), \{ ssr: false \}\)/);
  assert.match(GATE, /import\('@\/src\/lib\/homeScreenTip'\)/);
  assert.doesNotMatch(GATE, /^import .*homeScreenTip/m, 'de regels horen niet in de eerste lading');
  assert.match(GATE, /if \(cancelled \|\| !tip\.isPublicPath\(pathname\)\) return/);
  assert.match(GATE, /tip\.decideTip\(\{/);
  assert.match(GATE, /tip\.dismissTip\(tip\.browserStorage\('localStorage'\)\)/);
  // Geen pop-up, geen modal en geen focus stelen.
  for (const source of [stripComments(GATE), stripComments(TIP)]) {
    assert.equal(source.includes('role="dialog"'), false);
    assert.equal(source.includes('aria-modal'), false);
    assert.equal(source.includes('autoFocus'), false);
    assert.equal(source.includes('<dialog'), false);
  }
  assert.match(TIP, /aria-label=\{TIP_CLOSE_LABEL\}/);
  assert.match(TIP, /className="beginscherm-tip"/);
});

test('BE-62: de opmaak staat in eigen bestanden met alleen tokens', () => {
  assert.match(BLOCK, /import '\.\/zoek-gerecht-block\.css'/);
  assert.match(TIP, /import '\.\/beginscherm-tip\.css'/);
  for (const cssFile of [BLOCK_CSS, TIP_CSS]) {
    // Commentaar mag het ticketnummer noemen; wat telt zijn de regels zelf.
    const css = cssFile.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(css), false, 'geen hardgecodeerde kleur');
    assert.equal(/rgba?\(/.test(css), false, 'geen hardgecodeerde kleur');
    assert.equal(css.includes('data-theme'), false, 'geen eigen themavariant nodig');
  }
  assert.match(BLOCK_CSS, /var\(--bg-elevated\)/);
  assert.match(BLOCK_CSS, /var\(--accent-fill\)/);
  assert.match(BLOCK_CSS, /var\(--on-accent-fill\)/);
  // De vorm uit de review van ronde 2: eigen vlak, radius 16, padding 16-18,
  // h2 op 18/800, tekst op 14 in --text-secondary en een knop van 46 px hoog.
  assert.match(BLOCK_CSS, /border-radius: 16px/);
  assert.match(BLOCK_CSS, /padding: 1[68]px/);
  assert.match(BLOCK_CSS, /margin: 16px 0/);
  assert.match(BLOCK_CSS, /\.zoek-gerecht-title \{[^}]*font-size: 18px[^}]*font-weight: 800/);
  assert.match(BLOCK_CSS, /\.zoek-gerecht-body \{[^}]*font-size: 14px[^}]*color: var\(--text-secondary\)/);
  assert.match(BLOCK_CSS, /\.zoek-gerecht-btn \{[^}]*min-height: 46px/);
  // In de menukaart spant het vlak de volle breedte van de gerechtengrid.
  assert.match(BLOCK_CSS, /\.zoek-gerecht--dish \{ grid-column: 1 \/ -1; \}/);
  assert.match(TIP_CSS, /var\(--bg-card\)/);
  assert.match(TIP_CSS, /var\(--border-focus\)/);
  // De tip hoort bij de telefoon; dezelfde grens als het ontwerp.
  assert.match(TIP_CSS, /@media \(min-width: 641px\)/);
  // En niets van dit ticket is in het gedeelde basisbestand gezet (BE-52).
  assert.equal(GLOBALS.includes('.zoek-gerecht'), false);
  assert.equal(GLOBALS.includes('.beginscherm-tip'), false);
});

test('BE-62: geen nieuwe dependency en geen nieuwe serverdata', () => {
  const pkg = JSON.parse(read('package.json'));
  const allowed = new Set(['react', 'next/dynamic', 'next/link', 'next/navigation']);
  for (const [name, source] of Object.entries({ BLOCK, GATE, TIP })) {
    for (const match of source.matchAll(/from '([^']+)'/g)) {
      const specifier = match[1];
      const isLocal = specifier.startsWith('.') || specifier.startsWith('@/');
      assert.ok(isLocal || allowed.has(specifier), `${name}: onverwachte import ${specifier}`);
    }
  }
  assert.equal(Object.keys(pkg.dependencies).includes('ua-parser-js'), false);
  // De opslag blijft in de browser; geen fetch en geen cookie.
  for (const source of [GATE, TIP]) {
    assert.equal(source.includes('fetch('), false);
    assert.equal(source.includes('document.cookie'), false);
  }
});
