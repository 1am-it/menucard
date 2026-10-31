'use strict';

// BE-65 (#157) — dezelfde bewaar- en deelknoppen in /search als op de home.
//
// Bronregressie (fs + regex), dezelfde conventie als de andere paginatests:
// het gaat om de bedrading (dezelfde componenten, de echte gerechtgegevens,
// de knoppen naast de link) en om de eigen opmaak naast de pagina.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

const SEARCH = read('app/search/page.js');
const SEARCH_CSS = read('app/search/search.css');

test('/search: elk resultaat krijgt de bestaande bewaar- en deelknoppen', () => {
  assert.match(SEARCH, /import DishShareButton from '@\/src\/components\/DishShareButton'/);
  assert.match(SEARCH, /import \{ entryFromDish \} from '@\/src\/lib\/dishList'/);
  assert.match(SEARCH, /import \{ dishShareTitle \} from '@\/src\/lib\/dishShare'/);
  assert.match(SEARCH, /<DishShareButton\n(\s+[^\n]+\n)*?\s+withLabel\n/);
});

test('/search: de knoppen staan naast de link, met de echte gegevens van het resultaat', () => {
  const row = SEARCH.slice(
    SEARCH.indexOf('className="dish-result-card-row dish-result-row--actions"'),
    SEARCH.indexOf('</li>', SEARCH.indexOf('className="dish-result-card-row dish-result-row--actions"'))
  );
  assert.ok(row.includes('className="dish-result-actions"'), 'de knoppen hebben een eigen cel');
  // De link van het gerecht sluit vóór de knoppen: geen knop in een link.
  const linkEnd = row.lastIndexOf('</Link>');
  assert.ok(linkEnd > -1 && linkEnd < row.indexOf('className="dish-result-actions"'));
  assert.match(SEARCH, /href=\{buildExampleDishHref\(example, menu, filters\.q\)\}/);
  assert.match(SEARCH, /title=\{dishShareTitle\(\{ name: example\.name, restaurantName: group\.restaurantName \}\)\}/);
  assert.match(SEARCH, /entry=\{entryFromDish\(\{[\s\S]*?dishId: example\.dishId,[\s\S]*?price: example\.priceDisplay,[\s\S]*?restaurantName: group\.restaurantName,/);
  assert.match(SEARCH, /dishKey=\{example\.dishId\}/);
});

test('/search: de knoppen krijgen eigen opmaak naast de pagina (BE-52)', () => {
  assert.match(SEARCH_CSS, /\.dish-result-actions \{[\s\S]*?display: flex;[\s\S]*?flex: none;/);
  assert.match(SEARCH_CSS, /@media \(max-width: 560px\) \{[\s\S]*?\.dish-result-row--actions \{ flex-wrap: wrap; \}/);
  assert.match(SEARCH_CSS, /\.dish-result-row--actions \.dish-result-actions \{[\s\S]*?width: 100%;[\s\S]*?justify-content: flex-end;/);
  // Kleuren alleen via tokens: geen eigen kleurwaarde, geen gradiënt.
  const rules = SEARCH_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(rules, /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(|gradient/);
});
