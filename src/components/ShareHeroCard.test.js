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
// Commentaar noemt soms juist wat er NIET in mag; voor de controles hieronder
// telt alleen de echte code.
const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const CARD_CODE = withoutComments(CARD);
// Commentaar noemt het issuenummer (#157): alleen de echte regels tellen mee
// voor de tokencontrole hieronder.
const CARD_CSS_RULES = CARD_CSS.replace(/\/\*[\s\S]*?\*\//g, '');

test('deelkaart: titel, ondertitel en drie tabjes', () => {
  assert.match(CARD, /Zin in iets\? Stuur het door\./);
  assert.match(CARD, /Met prijs en restaurant erbij\. Niemand hoeft iets te installeren\./);
  for (const label of ['Eén gerecht', 'Een lijstje', 'Laat stemmen']) {
    assert.ok(CARD.includes(`label: '${label}'`), `tabje "${label}" staat in de kaart`);
  }
});

test('deelkaart is een Server Component zonder client-JS', () => {
  // Lead-review ronde 3, punt 3: de kaart kost niets van het eerste JS-pakket.
  assert.doesNotMatch(CARD, /^\s*'use client'/m, 'de kaart hoort geen client component te zijn');
  assert.doesNotMatch(CARD_CODE, /useState|useEffect|useId|useCallback|useMemo|useRef|onClick=/);
  // De serverpagina maakt de kaart en geeft hem als prop aan de clientweergave.
  assert.match(read('app/page.js'), /import ShareHeroCard from '@\/src\/components\/ShareHeroCard'/);
  assert.match(read('app/page.js'), /<HomeView candidates=\{buildTonightCandidates\(\)\} shareCard=\{<ShareHeroCard \/>\} \/>/);
  assert.doesNotMatch(read('app/HomeView.js'), /import ShareHeroCard from/, 'de clientweergave importeert de kaart niet meer');
  assert.match(read('app/HomeView.js'), /export default function HomeView\(\{ candidates = \[\], shareCard = null \}\)/);
  assert.match(read('app/HomeView.js'), /\{shareCard\}/);
});

test('deelkaart: drie radio\'s in een fieldset, gelabeld als tabje', () => {
  assert.match(CARD, /<fieldset className="share-hero-switch" aria-label="Kies een voorbeeld van delen">/);
  assert.match(CARD, /<input\n\s+className="share-hero-radio"\n\s+type="radio"\n\s+name=\{GROUP_NAME\}\n\s+id=\{`\$\{ID_PREFIX\}-\$\{tab\.id\}`\}/);
  assert.match(CARD, /defaultChecked=\{index === 0\}/, 'het eerste tabje staat standaard aan');
  assert.match(CARD, /<label className="share-hero-tab" htmlFor=\{`\$\{ID_PREFIX\}-\$\{tab\.id\}`\}>/);
  assert.match(CARD, /const ID_PREFIX = 'share-hero-kaart'/);
  assert.match(CARD, /const GROUP_NAME = `\$\{ID_PREFIX\}-voorbeeld`/);
  // De aria-pressed-knoppen van ronde 2 zijn vervangen door de radiogroep.
  assert.doesNotMatch(CARD_CODE, /aria-pressed|<button/);
  assert.doesNotMatch(CARD_CODE, /role="tab(list)?"/);
});

test('deelkaart: alle drie de voorbeelden staan als HTML in de pagina', () => {
  // Elk voorbeeld is een eigen figuur met een aria-label; CSS toont alleen het
  // gekozen voorbeeld (display: none voor de andere).
  assert.match(CARD, /className=\{`share-hero-example share-hero-example--\$\{tab\.id\}`\}/);
  assert.match(CARD, /const EXAMPLES = \{ een: OneDishExample, lijstje: ListExample, stemmen: VoteExample \}/);
  for (const bubble of ['Zaterdag hier lunchen?', 'Welke zullen we doen?', 'Stem even, ik reserveer!']) {
    assert.ok(CARD.includes(`bubble: '${bubble}'`), `spreekwolk "${bubble}" staat in de kaart`);
  }
  for (const name of ['Pasta pesto', 'Huisgemaakte burger', 'Steak tartaar']) {
    assert.ok(CARD.includes(name), `voorbeeldgerecht "${name}" staat in de kaart`);
  }
  assert.match(CARD, /restaurant: 'Restaurant in Breda'/);
  assert.match(CARD, /heading: 'Lijstje · 3 gerechten'/);
  assert.match(CARD, /heading: 'Stem mee · 4 van 5 gestemd'/);
  assert.match(CARD, /const DOMAIN = 'onzemenukaarten\.nl'/);
  assert.match(CARD, /<span className="share-hero-strip" aria-hidden="true" \/>/);
  assert.match(CARD_CSS, /#share-hero-kaart-een:checked ~ \.share-hero-example--een,\n#share-hero-kaart-lijstje:checked ~ \.share-hero-example--lijstje,\n#share-hero-kaart-stemmen:checked ~ \.share-hero-example--stemmen \{\n\s+display: flex;/);
  assert.match(CARD_CSS, /\.share-hero-example \{\n\s+display: none;/);
});

test('deelkaart: het stemvoorbeeld noemt de gerechten en toont de balkjes', () => {
  // Lead-review ronde 3, punt 1: per regel de gerechtnaam links (vet bij de
  // koploper), "n× lekker" rechts en daaronder een balkje van 75% en 25%.
  assert.match(CARD, /\{ name: 'Pasta pesto', votes: '3× lekker', share: 75, leader: true \}/);
  assert.match(CARD, /\{ name: 'Huisgemaakte burger', votes: '1× lekker', share: 25, leader: false \}/);
  assert.match(CARD, /<span className="share-hero-vote-line">/);
  assert.match(CARD, /className=\{`share-hero-vote-name\$\{row\.leader \? ' is-leader' : ''\}`\}/);
  assert.match(CARD, /<span className="share-hero-vote-count">\{row\.votes\}<\/span>/);
  assert.match(CARD, /className=\{`share-hero-vote-fill share-hero-vote-fill--\$\{row\.share\}`\}/);
  assert.match(CARD_CSS, /\.share-hero-vote-track \{[^}]*background: var\(--border\);/);
  assert.match(CARD_CSS, /\.share-hero-vote-fill \{[^}]*background: var\(--text-primary\);/);
  assert.match(CARD_CSS, /\.share-hero-vote-fill--75 \{ width: 75%; \}/);
  assert.match(CARD_CSS, /\.share-hero-vote-fill--25 \{ width: 25%; \}/);
  assert.match(CARD_CSS, /\.share-hero-vote-name\.is-leader \{ font-weight: 800; \}/);
});

test('deelkaart: korte labels op smalle schermen, één regel', () => {
  // Lead-review ronde 3, punt 2: tot en met 640 px "Eén gerecht", "Lijstje" en
  // "Stemmen", ook op 320 px op één regel.
  assert.ok(CARD.includes("short: 'Eén gerecht'"));
  assert.ok(CARD.includes("short: 'Lijstje'"));
  assert.ok(CARD.includes("short: 'Stemmen'"));
  assert.match(CARD, /<span className="share-hero-tab-full">\{tab\.label\}<\/span>/);
  assert.match(CARD, /<span className="share-hero-tab-short">\{tab\.short\}<\/span>/);
  assert.match(CARD_CSS, /@media \(max-width: 640px\) \{[\s\S]*?\.share-hero-tab-full \{ display: none; \}[\s\S]*?\.share-hero-tab-short \{ display: inline; \}[\s\S]*?\}/);
  assert.match(CARD_CSS, /\.share-hero-tab \{[^}]*?white-space: nowrap;/);
  // De tabjes staan in drie gelijke kolommen en kunnen dus niet over twee
  // regels vallen.
  assert.match(CARD_CSS, /\.share-hero-switch \{[^}]*?display: grid;[^}]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  assert.doesNotMatch(CARD_CSS, /flex-wrap: wrap/);
});

test('deelkaart: één regel uitleg per tabje, letterlijk uit het contract', () => {
  assert.ok(CARD.includes("note: 'Tik bij een gerecht op Delen.'"));
  assert.ok(CARD.includes("note: 'Bewaar een paar gerechten en stuur je lijstje in één keer.'"));
  assert.ok(
    CARD.includes("note: 'Stuur je lijstje met stemmen aan. Iedereen kiest, jij ziet de winnaar. Zonder account.'")
  );
  assert.match(CARD, /<figcaption className="share-hero-note">\{tab\.note\}<\/figcaption>/);
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
  assert.match(CARD_CSS, /\.share-hero-radio:checked \+ \.share-hero-tab \{[^}]*?background: var\(--card-surface\);[^}]*?font-weight: 800;[^}]*?box-shadow:/);
  assert.match(CARD_CSS, /\.share-hero-bubble \{[\s\S]*?border-radius: 16px 16px 4px 16px;/);
  assert.match(CARD_CSS, /@media \(max-width: 720px\) \{[\s\S]*?\.share-hero \{ padding: 18px;[\s\S]*?\.share-hero-title \{ font-size: 22px;/);
  // Geen kleurwaarden in de component of zijn CSS: alles via tokens.
  assert.doesNotMatch(CARD_CSS_RULES, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(CARD_CSS_RULES, /rgb\(|hsl\(|gradient/);
  assert.doesNotMatch(CARD.replace(/^\s*\/\/.*$/gm, ''), /#[0-9a-fA-F]{3,8}\b/);
});
