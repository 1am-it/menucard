'use strict';

// BE-65 (#157) — de deelkaart in de hero.
//
// Zelfde conventie als de andere componenttests: het bronbestand lezen met fs +
// regex (geen JSX-harness). De kaart is bewust statisch, dus de test kan alles
// wat het contract noemt letterlijk aanwijzen: drie tabjes, aria-pressed, de
// wisselende voorbeelden en de regel uitleg per tabje.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

const CARD = read('src/components/ShareHeroCard.js');
const CARD_CSS = read('src/components/share-hero-card.css');
// Commentaar noemt het issuenummer (#157): alleen de echte regels tellen mee
// voor de tokencontrole hieronder.
const CARD_CSS_RULES = CARD_CSS.replace(/\/\*[\s\S]*?\*\//g, '');

test('deelkaart: titel, ondertitel en drie echte tabjes', () => {
  assert.match(CARD, /Zin in iets\? Stuur het door\./);
  assert.match(CARD, /Met prijs en restaurant erbij\. Niemand hoeft iets te installeren\./);
  for (const label of ['Eén gerecht', 'Een lijstje', 'Laat stemmen']) {
    assert.ok(CARD.includes(`label: '${label}'`), `tabje "${label}" staat in de kaart`);
  }
});

test('deelkaart: de tabjes zijn buttons met aria-pressed in een group met aria-label', () => {
  assert.match(CARD, /role="group" aria-label="Kies een voorbeeld van delen"/);
  assert.match(CARD, /<button[\s\S]*?type="button"[\s\S]*?aria-pressed=\{tab\.id === active\.id\}/);
  assert.match(CARD, /className=\{`share-hero-tab\$\{tab\.id === active\.id \? ' is-active' : ''\}`\}/);
  // Eén tabje staat standaard aan: de eerste.
  assert.match(CARD, /useState\(SHARE_HERO_TABS\[0\]\.id\)/);
  assert.doesNotMatch(CARD, /<a [^>]*share-hero-tab/, 'de tabjes zijn geen links');
});

test('deelkaart: per tabje een statisch chatvoorbeeld in een figure met een aria-label', () => {
  assert.match(CARD, /<figure className="share-hero-example" aria-label=\{active\.figureLabel\}>/);
  for (const bubble of ['Zaterdag hier lunchen?', 'Welke zullen we doen?', 'Stem even, ik reserveer!']) {
    assert.ok(CARD.includes(`bubble: '${bubble}'`), `spreekwolk "${bubble}" staat in de kaart`);
  }
  // De vaste, duidelijke voorbeelden uit het contract, met een fictief restaurant.
  for (const name of ['Pasta pesto', 'Huisgemaakte burger', 'Steak tartaar']) {
    assert.ok(CARD.includes(name), `voorbeeldgerecht "${name}" staat in de kaart`);
  }
  assert.match(CARD, /restaurant: 'Restaurant in Breda'/);
  assert.match(CARD, /heading: 'Lijstje · 3 gerechten'/);
  assert.match(CARD, /heading: 'Stem mee · 4 van 5 gestemd'/);
  assert.match(CARD, /'3× lekker'/);
  assert.match(CARD, /'1× lekker'/);
  assert.match(CARD, /const DOMAIN = 'onzemenukaarten\.nl'/);
  // De gele strook bovenaan het linkkaartje is decoratief.
  assert.match(CARD, /<span className="share-hero-strip" aria-hidden="true" \/>/);
});

test('deelkaart: één regel uitleg per tabje, letterlijk uit het contract', () => {
  assert.ok(CARD.includes("note: 'Tik bij een gerecht op Delen.'"));
  assert.ok(CARD.includes("note: 'Bewaar een paar gerechten en stuur je lijstje in één keer.'"));
  assert.ok(
    CARD.includes("note: 'Stuur je lijstje met stemmen aan. Iedereen kiest, jij ziet de winnaar. Zonder account.'")
  );
  assert.match(CARD, /<p className="share-hero-note">\{active\.note\}<\/p>/);
});

test('deelkaart: vaste voorbeelden, geen live data en geen netwerk', () => {
  assert.doesNotMatch(CARD, /fetch\(|useEffect|usesRouter|usePathname/);
  assert.doesNotMatch(CARD, /\/api\//);
});

test('deelkaart: eigen CSS-bestand met alleen tokens, in licht en donker', () => {
  assert.match(CARD, /import '\.\/share-hero-card\.css'/);
  assert.match(CARD_CSS, /\.share-hero \{[\s\S]*?background: var\(--bg-elevated\);/);
  assert.match(CARD_CSS, /\.share-hero \{[\s\S]*?border-radius: 22px;/);
  assert.match(CARD_CSS, /\.share-hero \{[\s\S]*?padding: 26px;/);
  assert.match(CARD_CSS, /\.share-hero-strip \{[\s\S]*?background: var\(--accent-fill\);/);
  assert.match(CARD_CSS, /\.share-hero-tab\.is-active \{[\s\S]*?background: var\(--card-surface\);[\s\S]*?font-weight: 800;[\s\S]*?box-shadow:/);
  assert.match(CARD_CSS, /\.share-hero-bubble \{[\s\S]*?border-radius: 16px 16px 4px 16px;/);
  assert.match(CARD_CSS, /@media \(max-width: 720px\) \{[\s\S]*?\.share-hero \{ padding: 18px;[\s\S]*?\.share-hero-title \{ font-size: 22px;/);
  // Geen kleurwaarden in de component of zijn CSS: alles via tokens.
  assert.doesNotMatch(CARD_CSS_RULES, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(CARD_CSS_RULES, /rgb\(|hsl\(|gradient/);
  assert.doesNotMatch(CARD.replace(/^\s*\/\/.*$/gm, ''), /#[0-9a-fA-F]{3,8}\b/);
});
