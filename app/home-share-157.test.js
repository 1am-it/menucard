'use strict';

// BE-65 (#157) — de bedrading op de home: de deelkaart in de hero, en bij elk
// gerecht van "Vanavond op de kaart" de bestaande bewaar- en deelknoppen.
//
// Bronregressie (fs + regex), dezelfde conventie als de andere paginatests.
// Wat deze test bewijst:
//   - de hero heeft twee kolommen met de deelkaart ernaast;
//   - de kaart staat onder de zoekbalk en de chips in dezelfde hero;
//   - bij elk gerecht staan "Bewaren" en "Delen" als knoppen naast de link,
//     nooit erin, met de bestaande componenten en de echte gerechtgegevens;
//   - de opmaak staat in een eigen bestand naast de pagina (BE-52).

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

const HOME = read('app/HomeView.js');
const HOME_CSS = read('app/home.css');
const SHARE_BUTTON = read('src/components/DishShareButton.js');

test('home: de deelkaart staat in de hero, naast zoeken en chips', () => {
  assert.match(HOME, /import ShareHeroCard from '@\/src\/components\/ShareHeroCard'/);
  assert.match(HOME, /<ShareHeroCard \/>/);
  const hero = HOME.slice(HOME.indexOf('className="home-hero"'), HOME.indexOf('</section>'));
  const form = hero.indexOf('className="home-search"');
  const chips = hero.indexOf('className="home-chips"');
  const card = hero.indexOf('<ShareHeroCard />');
  assert.ok(form > -1 && chips > form && card > chips, 'de kaart volgt op de zoekbalk en de chips');
  assert.match(HOME_CSS, /\.home-hero-grid \{[\s\S]*?grid-template-columns: minmax\(0, 1\.2fr\) minmax\(0, 1fr\);/);
  assert.match(HOME_CSS, /@media \(max-width: 900px\) \{[\s\S]*?\.home-hero-grid \{ grid-template-columns: minmax\(0, 1fr\);/);
});

test('home: elk gerecht van "Vanavond op de kaart" heeft Bewaren en Delen', () => {
  assert.match(HOME, /import DishShareButton from '@\/src\/components\/DishShareButton'/);
  assert.match(HOME, /import \{ entryFromDish \} from '@\/src\/lib\/dishList'/);
  assert.match(HOME, /import \{ dishShareTitle \} from '@\/src\/lib\/dishShare'/);
  // De knoppen staan in een eigen cel naast de link, niet in de link.
  const item = HOME.slice(HOME.indexOf('className="tonight-item"'), HOME.indexOf('</li>', HOME.indexOf('className="tonight-item"')));
  assert.ok(item.includes('className="tonight-actions"'), 'de knoppen hebben een eigen cel');
  assert.ok(item.indexOf('</Link>') < item.indexOf('className="tonight-actions"'), 'de knoppen staan na de link');
  assert.match(HOME, /<DishShareButton\n(\s+[^\n]+\n)*?\s+withLabel\n/);
  assert.match(HOME, /entry=\{entryFromDish\(\{[\s\S]*?dishId: dish\.dishId,[\s\S]*?name: dish\.name,[\s\S]*?category: dish\.category,[\s\S]*?price: dish\.priceDisplay,[\s\S]*?restaurantName: dish\.restaurantName,/);
  assert.match(HOME, /dishKey=\{dish\.dishId\}/);
  assert.match(HOME, /href=\{dish\.href\}/);
  assert.match(HOME_CSS, /\.tonight-item \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.match(HOME_CSS, /@media \(max-width: 560px\) \{[\s\S]*?\.tonight-item \{ grid-template-columns: minmax\(0, 1fr\);/);
});

test('delen met het woord "Delen": alleen daar, de menukaart houdt zijn icoonknop', () => {
  assert.match(SHARE_BUTTON, /withLabel = false/);
  assert.match(SHARE_BUTTON, /className=\{`dish-share-btn\$\{withLabel \? ' dish-share-btn--label' : ''\}`\}/);
  assert.match(SHARE_BUTTON, /aria-label=\{withLabel \? `Delen: \$\{shareName\}` : `Deel \$\{shareName\}`\}/);
  assert.match(SHARE_BUTTON, /withLabel \? <span className="dish-share-btn-text">Delen<\/span> : null/);
  assert.match(SHARE_BUTTON, /import '\.\/dish-share-button\.css'/);
  const css = read('src/components/dish-share-button.css');
  assert.match(css, /\.dish-share \.dish-share-btn--label \{[\s\S]*?background: var\(--button-primary-bg\);/);
  assert.match(css, /@media \(max-width: 700px\) \{[\s\S]*?\.dish-share-btn-text \{ display: none; \}/);
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /#[0-9a-fA-F]{3,8}\b|rgb\(/);
});

test('home: de eigen opmaak staat naast de pagina, niet in globals.css (BE-52)', () => {
  assert.match(HOME, /import '\.\/home\.css'/);
  assert.doesNotMatch(read('app/globals.css'), /\.home-hero-grid/);
  assert.doesNotMatch(read('app/globals.css'), /\.tonight-item \{/);
  assert.doesNotMatch(HOME_CSS.replace(/\/\*[\s\S]*?\*\//g, ''), /#[0-9a-fA-F]{3,8}\b|rgb\(|gradient/);
});
