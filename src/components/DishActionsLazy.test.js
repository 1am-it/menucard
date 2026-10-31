'use strict';

// BE-65 (#157, ronde 2) — de knoppen blijven klein, de logica komt bij de klik.
//
// Bronregressie (fs + regex), dezelfde conventie als de andere oppervlaktetests.
// Wat hier bewezen wordt:
//  - geen statische import van de zware modules in de knop zelf;
//  - de klikhandler laadt `dishList` en `dishShare`/`sharePreference` pas dan;
//  - de stand van "Bewaren" komt meteen uit de kleine lezer (localStorage),
//    zodat de knop bij het laden klopt (de pariteit met isDishSaved staat in
//    src/lib/savedListRead.test.js);
//  - zonder opslag geen fout: de lezer geeft null/false terug in plaats van te
//    gooien (zie ook daar).
// Dit is ontwikkelaarsbewijs, geen browserbewijs.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

const SHARE = read('src/components/DishShareButton.js');
const SAVE = read('src/components/DishSaveButton.js');
const SHARE_CSS = read('src/components/dish-share-button.css');

test('de deellogica wordt pas bij de klik geladen', () => {
  for (const module of ['dishShare', 'sharePreference', 'dishCounters']) {
    assert.doesNotMatch(
      SHARE,
      new RegExp(`^import [^;]*from '@/src/lib/${module}'`, 'm'),
      `${module} hoort niet statisch in de eerste lading`
    );
    assert.match(SHARE, new RegExp(`import\\('@/src/lib/${module}'\\)`), `${module} wordt dynamisch geladen`);
  }
  // De dynamische import staat in de loader die de klikhandler gebruikt.
  const loader = SHARE.slice(SHARE.indexOf('function loadShareModules()'), SHARE.indexOf('/**\n * Een gekozen webmanier'));
  assert.match(loader, /import\('@\/src\/lib\/dishShare'\)/);
  assert.match(loader, /import\('@\/src\/lib\/sharePreference'\)/);
  assert.match(SHARE, /const handleShare = useCallback\(async \(\) => \{\n\s+const mods = await loadShareModules\(\)/);
});

test('de bewaarlogica wordt pas bij de klik geladen, de stand meteen gelezen', () => {
  assert.doesNotMatch(SAVE, /^import [^;]*from '@\/src\/lib\/dishList'/m);
  assert.match(SAVE, /import\('@\/src\/lib\/dishList'\)/);
  assert.match(SAVE, /import\('@\/src\/lib\/dishCounters'\)/);
  // De stand bij het laden: kleine lezer, geen zware module.
  assert.match(SAVE, /import \{\n\s+SAVED_LIST_EVENT_NAME,\n\s+browserStorage,\n\s+hasSavedId,\n\} from '@\/src\/lib\/savedListRead'/);
  assert.match(SAVE, /setSaved\(hasSavedId\(browserStorage\(\), id\)\)/);
  // De opslag gebeurt via de bestaande dishList-functies.
  assert.match(SAVE, /list\.toggleSavedDish\(browserStorage\(\), wanted\)/);
  assert.match(SAVE, /const wanted = entry \|\| \(dish \? list\.entryFromDish\(dish\) : null\)/);
});

test('de knop blijft een echte knop met dezelfde naam en dezelfde maten', () => {
  assert.match(SHARE, /aria-label=\{withLabel \? `Delen: \$\{shareName\}` : `Deel \$\{shareName\}`\}/);
  assert.match(SHARE, /aria-haspopup="dialog"/);
  assert.match(SHARE, /aria-expanded=\{open\}/);
  assert.match(SHARE, /<DishSaveButton entry=\{entry\} dish=\{dish\} name=\{shareName\} \/>/);
  assert.match(SAVE, /aria-pressed=\{saved\}/);
  assert.match(SAVE, /aria-label={`Bewaar \$\{saveName\}`}/);
  assert.match(SHARE_CSS, /min-width: 44px/);
  assert.match(SHARE_CSS, /width: 44px/);
});
