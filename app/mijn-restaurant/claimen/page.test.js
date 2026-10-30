'use strict';

// BE-54 (#133) — bronregressies voor /mijn-restaurant/claimen.
//
// De zoekregels zelf staan in src/lib/claimSearch.test.js (met een vergelijking
// tegen de bestaande zoeklogica op de echte data). Hier gaat het om de vraag of
// de pagina, de twee links en de eigen opmaak ze ook echt zo gebruiken:
// dezelfde gegevens als /alle-restaurants, geen nieuwe API, geen claimstatus in
// de regels, role="status", mailto alleen uit NEXT_PUBLIC_CONTACT_EMAIL, en
// opmaak in een eigen CSS-bestand naast de pagina.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const code = (source) => source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');

const PAGE = read('app/mijn-restaurant/claimen/page.js');
const CSS = read('app/mijn-restaurant/claimen/claimen.css');
const LOGIN_VIEW = read('app/mijn-restaurant/inloggen/OwnerLoginView.js');
const DASHBOARD = read('app/mijn-restaurant/OwnerDashboard.js');
const OWNER_ACCESS = read('src/lib/ownerAccess.js');

test('BE-54: de pagina gebruikt de gedeelde header met een nav-landmark en de telefoonbalk', () => {
  assert.match(PAGE, /import PrimaryNav from '@\/src\/components\/PrimaryNav'/);
  assert.match(PAGE, /import MobileTabBar from '@\/src\/components\/MobileTabBar'/);
  assert.match(
    PAGE,
    /<div className="header-right">\s*<PrimaryNav \/>\s*<ThemeToggle \/>\s*<\/div>/,
    'zelfde header als /alle-restaurants, met de nav vóór de themaknop',
  );
  assert.match(PAGE, /<MobileTabBar \/>/);
});

test('BE-54: de pagina zoekt met dezelfde gegevens als /alle-restaurants', () => {
  assert.match(PAGE, /fetch\(`\/api\/restaurants\?\$\{params\.toString\(\)\}`\)/);
  assert.match(PAGE, /params\.set\('limit', String\(PAGE_LIMIT\)\)/);
  assert.match(PAGE, /if \(!data\.hasMore \|\| data\.nextCursor == null\) break/);
  // Geen nieuwe API-route en geen eigen databron.
  assert.doesNotMatch(PAGE, /\/api\/(?!restaurants)/, 'alleen de bestaande /api/restaurants');
  assert.doesNotMatch(PAGE, /data\/(restaurants|menus)\.json|supabase/i);
  // De zoekregel is de geteste pure module, niet een tweede kopie in de pagina.
  assert.match(PAGE, /from '@\/src\/lib\/claimSearch'/);
  assert.match(PAGE, /claimResultRows\(restaurants, query\)/);
  assert.match(PAGE, /countClaimMatches\(restaurants, query\)/);
  assert.match(PAGE, /claimResultStatus\(query, \{ matched, shown: rows\.length \}\)/);
  assert.doesNotMatch(PAGE, /\.toLowerCase\(\)\.includes/, 'geen eigen tweede zoeklogica');
});


test('BE-54: een regel toont naam, adres en buurt en linkt naar de bestaande /claim/[id]', () => {
  assert.match(PAGE, /<h2 className="claimen-result-name">\{row\.name\}<\/h2>/);
  assert.match(PAGE, /\{row\.detail && <p className="claimen-result-detail">\{row\.detail\}<\/p>\}/);
  assert.match(PAGE, /<Link className="claimen-result-button" href=\{row\.claimHref\}>/);
  assert.match(PAGE, /key=\{row\.restaurantId\}/);
  // De claimflow zelf blijft ongemoeid: geen eigen claim-aanroep vanaf deze pagina.
  assert.doesNotMatch(PAGE, /\/api\/claims|insert\(|createClaim/);
  // Geen claimstatus in de resultaten (contractpunt 5).
  assert.doesNotMatch(code(PAGE), /geclaimd|claimStatus|isClaimed/i);
});

test('BE-54: het aantal resultaten staat in role="status" en het veld heeft een echt label', () => {
  assert.match(PAGE, /<p className="claimen-status" id="claimen-status" role="status">/);
  assert.match(PAGE, /<label className="claimen-label" htmlFor="claimen-q">/);
  assert.match(PAGE, /id="claimen-q"/);
  assert.match(PAGE, /aria-describedby="claimen-hint claimen-status"/);
  // "Zo werkt het" in drie stappen.
  assert.match(PAGE, /aria-labelledby="claimen-how-title"/);
  assert.match(PAGE, /\{CLAIM_SEARCH_MESSAGES\.howTitle\}/);
  assert.equal((PAGE.match(/title: '/g) || []).length, 3, 'drie stappen');
});

test('BE-54: "Niets gevonden" met de tip en alleen een mailto uit de omgevingsvariabele', () => {
  assert.match(PAGE, /Niets gevonden/);
  assert.match(PAGE, /\{CLAIM_SEARCH_MESSAGES\.emptyHelp\}/);
  assert.match(PAGE, /const mailto = contactMailto\(process\.env\.NEXT_PUBLIC_CONTACT_EMAIL\)/);
  assert.match(PAGE, /\{mailto \? \(/);
  assert.match(PAGE, /<a className="claimen-contact" href=\{mailto\}>/);
  // Zonder variabele blijft alleen de tekst staan; geen verzonnen adres.
  assert.doesNotMatch(code(PAGE), /mailto:[^\s'"]*@/, 'geen hardgecodeerd mailadres');
  assert.doesNotMatch(code(PAGE), /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i, 'geen verzonnen adres in de code');
});

test('BE-54: beide "Claim je restaurant"-links gaan naar de nieuwe pagina', () => {
  assert.match(OWNER_ACCESS, /const CLAIM_SEARCH_HREF = '\/mijn-restaurant\/claimen'/);
  assert.match(OWNER_ACCESS, /^\s+CLAIM_SEARCH_HREF,$/m);
  for (const source of [LOGIN_VIEW, DASHBOARD]) {
    assert.match(source, /CLAIM_SEARCH_HREF/);
    assert.match(source, /href=\{CLAIM_SEARCH_HREF\}/);
    assert.match(source, /\{OWNER_ACCESS_MESSAGES\.claimRouteLabel\}/);
    assert.doesNotMatch(code(source), /'\/alle-restaurants'/, 'de oude bestemming is weg');
  }
});

test('BE-54: de opmaak staat naast de pagina en gebruikt alleen tokens', () => {
  assert.match(PAGE, /^import '\.\/claimen\.css'$/m);
  assert.doesNotMatch(code(PAGE), /globals\.css/);
  // Kleurcontrole zonder commentaar (de kop noemt het issuenummer #133).
  const cssRules = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(cssRules, /#[0-9a-fA-F]{3,8}\b/, 'geen hardgecodeerde kleur');
  assert.doesNotMatch(cssRules, /\brgba?\(/, 'geen hardgecodeerde kleur');
  // Maten uit de mockup: zoekveld 52 px met rand van 2 px, naam 17 px vet,
  // en de gele knop van minimaal 44 px uit de bestaande tokens.
  assert.match(CSS, /\.claimen-input \{[^}]*min-height: 52px/);
  assert.match(CSS, /\.claimen-input \{[^}]*border: 2px solid var\(--border\)/);
  assert.match(CSS, /\.claimen-result-name \{[^}]*font-size: 17px[^}]*font-weight: 700/);
  assert.match(CSS, /\.claimen-result-button \{[^}]*min-height: 44px[^}]*\}/);
  assert.match(CSS, /background: var\(--button-primary-bg\)/);
  // Zichtbare focus op elk bedienbaar element.
  for (const selector of ['.claimen-input:focus-visible', '.claimen-result-button:focus-visible', '.claimen-contact:focus-visible']) {
    assert.ok(CSS.includes(selector), `${selector} bestaat`);
  }
});
