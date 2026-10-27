'use strict';

// BE-35 (#84, criterion 4) — structural proof that both restaurant search
// fields really use the one tested automatic choice: on leaving the field, on
// Enter and on the primary button, with the chosen restaurant visible and a
// clear question when several match. Structure only; the rule itself is proven
// in restaurantPick.test.js.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

const PAGES = [
  { name: '/internal/menu-import', file: 'app/internal/menu-import/page.js', input: 'mai-restaurant' },
  { name: '/internal/toevoegen', file: 'app/internal/toevoegen/page.js', input: 'add-restaurant' },
];

for (const page of PAGES) {
  test(`BE-35: ${page.name} chooses an unambiguous restaurant by itself`, () => {
    const source = read(page.file);
    // One pure rule, no second copy of the decision in the page.
    assert.match(source, /import \{ decideRestaurantPick, restaurantChoiceLabel \} from '@\/src\/lib\/restaurantPick'/);
    assert.match(source, /decideRestaurantPick\(\{ query, choices \}\)/);
    // The choices of an older query may never decide for a newer name.
    assert.match(source, /choicesQuery === query \? restaurantChoices : \[\]/);
    // Leaving the field, Enter and the primary button all call the same rule.
    assert.match(source, /onBlur=\{\(\) => \{\s*resolveRestaurantChoice\(\)\s*\}\}/);
    assert.match(source, /event\.key === 'Enter'/);
    assert.match(source, /const pick = await resolveRestaurantChoice\(\)/);
    // The chosen restaurant is visibly shown with name and neighbourhood.
    assert.match(source, /restaurantChoiceLabel\(selectedRestaurant\)/);
    // Several matches give a clear question and never a guess.
    assert.match(source, /Kies één van de|pick\.status === 'multiple'/);
    assert.match(source, /role="status"/);
    // The rule is not re-implemented as a name comparison in the page.
    assert.doesNotMatch(source, /toLowerCase\(\)\s*===\s*restaurantQuery/);
  });
}

test('BE-35: the manual import primary actions stay usable while a name is typed', () => {
  const source = read('app/internal/menu-import/page.js');
  // "Prompt maken" and "Opnieuw maken" may not be disabled just because the
  // restaurant is not chosen yet: the click itself resolves the name.
  const promptButtons = source.match(/disabled=\{busy \|\| \(!restaurantId && restaurantQuery\.trim\(\)\.length < 2\) \|\| !urls\.trim\(\)\}/g) || [];
  assert.equal(promptButtons.length, 2);
  // The AI card accepts a typed name too, so "Lees met AI" follows the same rule.
  assert.match(source, /canRead=\{Boolean\(restaurantId\) \|\| Boolean\(aiJobId\) \|\| restaurantQuery\.trim\(\)\.length >= 2\}/);
});

test('BE-35: several matches stop the add form instead of starting a new restaurant', () => {
  const source = read('app/internal/toevoegen/page.js');
  const start = source.indexOf('const pick = await resolveRestaurantChoice()');
  assert.ok(start > 0);
  const guard = source.indexOf("if (pick.status === 'multiple')", start);
  const decide = source.indexOf('decideAddEntry({ restaurant, urls })', start);
  // The question comes before any route is chosen: no onboarding for a name
  // that matches several restaurants.
  assert.ok(guard > start && guard < decide);
});
