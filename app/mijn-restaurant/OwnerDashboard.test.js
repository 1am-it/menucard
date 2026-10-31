'use strict';

// BE-57 herstel (#139) — bronregressie voor de kop van "Mijn restaurant".
//
// Waarom deze test bestaat: de eerste oplevering zette `<PrimaryNav />` als
// losse broer van `.header-right` in de kop. Op de telefoon gaf `app/globals.css`
// die pil daardoor een eigen regel (`.primary-nav { flex-basis: 100% }` bij
// max-width 768px), waardoor de kop ongeveer 200 px hoog werd en de titel "Deze
// week" onder de vaste kop verdween.
//
// De goedgekeurde opbouw is die van /mijn-restaurant/claimen (BE-54): woordmerk
// en themaknop op één regel, PrimaryNav binnen `.header-right` (op mobiel
// verborgen) en de navigatie onderaan via de bestaande MobileTabBar.
//
// Bronregressie (fs + regex), dezelfde conventie als
// app/alle-restaurants/page.test.js. Het echte beeld blijft bewezen door
// ops/browser/run-be57-browser-check.js, dat de kophoogte meet en vóór elke
// opname titel en cijfers in beeld controleert.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..');
const DASHBOARD = path.join(REPO_ROOT, 'app/mijn-restaurant/OwnerDashboard.js');
const CLAIMEN = path.join(REPO_ROOT, 'app/mijn-restaurant/claimen/page.js');
const CSS = path.join(REPO_ROOT, 'app/mijn-restaurant/mijn-restaurant.css');

const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

test('de kop gebruikt dezelfde opbouw als /mijn-restaurant/claimen: PrimaryNav en ThemeToggle binnen .header-right', () => {
  const source = read(DASHBOARD);
  assert.match(source, /import PrimaryNav from ['"]@\/src\/components\/PrimaryNav['"]/);
  assert.match(source, /import ThemeToggle from ['"]@\/src\/components\/ThemeToggle['"]/);
  assert.match(
    source,
    /<div className="header-inner">\s*<Wordmark \/>\s*<div className="header-right">\s*<PrimaryNav \/>\s*<ThemeToggle \/>\s*<AccountMenuButton \/>\s*<\/div>\s*<\/div>/,
    'de kop moet woordmerk + .header-right(PrimaryNav, ThemeToggle, AccountMenuButton) zijn, net als bij claimen',
  );
  assert.equal(
    (source.match(/<PrimaryNav \/>/g) || []).length,
    1,
    'PrimaryNav hoort maar op één plek te staan: binnen .header-right',
  );
  // BE-59 (#146): de accountknop komt er als enige toevoeging bij, als laatste
  // binnen dezelfde `.header-right`; een losse broer zou op mobiel (flex-wrap)
  // een eigen regel krijgen en de kop weer laten groeien.
  assert.equal(
    (source.match(/<AccountMenuButton \/>/g) || []).length,
    1,
    'AccountMenuButton hoort maar op één plek te staan: binnen .header-right',
  );
});

test('onder 360 px blijft de kop één regel: eigen smalle regel, geen verborgen accountknop', () => {
  const css = read(CSS);
  assert.match(
    read(DASHBOARD),
    /<header className="site-header owner-header">/,
    'de smalle kopregels moeten aan deze pagina hangen, niet aan de gedeelde kop',
  );
  const narrow = css.match(/@media \(max-width: 360px\) \{[\s\S]*?\n\}/);
  assert.ok(narrow, 'de pagina hoort een eigen regel onder 360 px te hebben');
  assert.match(
    narrow[0],
    /\.owner-header \.wordmark-text \{ display: none; \}/,
    'op 320 px past woordmerk + themablok + avatar niet naast elkaar; de tekst vervalt, de tegel blijft',
  );
  assert.doesNotMatch(
    narrow[0],
    /account-menu|theme-switch|theme-btn/,
    'de accountknop en het themablok mogen op smalle schermen niet verdwijnen of kleiner worden',
  );
});

test('op mobiel doet de bestaande MobileTabBar de navigatie, na de main', () => {
  const source = read(DASHBOARD);
  assert.match(source, /import MobileTabBar from ['"]@\/src\/components\/MobileTabBar['"]/);
  assert.match(source, /<\/main>\s*\n\s*<MobileTabBar \/>/, 'de tabbar hoort direct na </main>');
  assert.match(read(CLAIMEN), /<MobileTabBar \/>/, 'claimen gebruikt dezelfde tabbar; die opbouw is de referentie');
});

test('de pagina houdt op mobiel ruimte vrij onder de vaste tabbar', () => {
  const css = read(CSS);
  assert.match(
    css,
    /@media \(max-width: 720px\) \{\s*\.owner-main \{ padding-bottom: \d+px; \}\s*\}/,
    'zonder padding-bottom verdwijnt de laatste inhoud achter de vaste tabbar (die boven 720px verborgen is)',
  );
});
