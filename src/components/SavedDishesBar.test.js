'use strict';

// BE-65 (#157, uitkomst 3) — de balk na het bewaren.
//
// Bronregressie (fs + regex) plus de teksten uit de kleine lezer
// (src/lib/savedListRead.js). Wat hier bewezen wordt:
//  - de tekst "n gerecht(en) bewaard · Stuur je lijstje, met of zonder stemmen",
//    enkelvoud bij 1, en dezelfde telling als dishCountLabel() in dishList;
//  - "Versturen" gaat voorlopig naar /mijn-lijstje;
//  - de balk verschijnt pas vanaf 1 bewaard gerecht en is te sluiten met een
//    knop met `aria-label`, blijft dicht in deze sessie (`sessionStorage`, in
//    try/catch);
//  - de balk staat boven de tabbalk, rechtsonder op desktop (max 420 px), met
//    alleen tokens en `--accent-fill` voor de knop;
//  - home en /search zetten hem vóór de tabbalk.
// Dit is ontwikkelaarsbewijs, geen browserbewijs.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

const BAR = read('src/components/SavedDishesBar.js');
const CSS = read('src/components/saved-dishes-bar.css');
const HOME = read('app/HomeView.js');
const SEARCH = read('app/search/page.js');
const saved = require('../lib/savedListRead');
const dishList = require('../lib/dishList');

test('de tekst noemt het aantal en dezelfde telling als dishList', () => {
  assert.equal(saved.savedBarText(1), '1 gerecht bewaard · Stuur je lijstje, met of zonder stemmen');
  assert.equal(saved.savedBarText(3), '3 gerechten bewaard · Stuur je lijstje, met of zonder stemmen');
  assert.equal(saved.savedBarText(0), '0 gerechten bewaard · Stuur je lijstje, met of zonder stemmen');
  for (const count of [0, 1, 2, 12, 20]) {
    assert.ok(
      saved.savedCountLabel(count).startsWith(`${count} `) &&
        saved.savedCountLabel(count).endsWith(' bewaard'),
      `label voor ${count}`
    );
    assert.ok(
      dishList.dishCountLabel(count) === saved.savedCountLabel(count).replace(/ bewaard$/, ''),
      `dezelfde telling als dishCountLabel voor ${count}`
    );
  }
  assert.match(BAR, /savedBarText\(count\)/);
});

test('de balk verschijnt vanaf één bewaard gerecht en is te sluiten', () => {
  assert.match(BAR, /if \(!ready \|\| hidden \|\| count < 1\) return null/);
  assert.match(BAR, /aria-label=\{BAR_CLOSE_LABEL\}/);
  assert.match(BAR, /const BAR_CLOSE_LABEL = '[^']+'/);
  assert.match(BAR, /onClick=\{handleClose\}/);
  assert.match(BAR, /writeHidden\(sessionStore\(\), true\)/);
  assert.match(BAR, /const BAR_HIDDEN_KEY = 'bredaeats_balk_gesloten'/);
  // Sluiten geldt voor deze sessie, in try/catch: zonder opslag geen fout.
  assert.match(BAR, /function sessionStore\(\) \{\n\s+try \{\n\s+return typeof window === 'undefined' \? null : window\.sessionStorage\n\s+\} catch \(error\) \{\n\s+return null/);
  assert.match(BAR, /try \{\n\s+if \(hidden\) storage\.setItem[^]*?\} catch \(error\) \{\n\s+return false/);
  assert.match(BAR, /const BAR_SEND_LABEL = 'Versturen'/);
  assert.match(BAR, /const BAR_HREF = '\/mijn-lijstje'/);
  assert.match(BAR, /<Link className="saved-bar-send" href=\{BAR_HREF\}>\{BAR_SEND_LABEL\}<\/Link>/);
});

test('de opmaak: rechtsonder, boven de tabbalk, alleen tokens', () => {
  assert.match(CSS, /\.saved-bar \{[\s\S]*?position: fixed;[\s\S]*?right: 20px;[\s\S]*?max-width: 420px;/);
  assert.match(CSS, /\.saved-bar \{[\s\S]*?background: var\(--text-primary\);[\s\S]*?color: var\(--bg\);/);
  assert.match(CSS, /\.saved-bar-send \{[\s\S]*?background: var\(--accent-fill\);[\s\S]*?color: var\(--on-accent-fill\);/);
  // Boven de tabbalk: de tabbalk staat op 12 px en is 60 px hoog.
  assert.match(CSS, /@media \(max-width: 720px\) \{[\s\S]*?\.saved-bar \{[\s\S]*?bottom: calc\(80px \+ env\(safe-area-inset-bottom\)\);/);
  assert.match(CSS, /\.saved-bar \{[\s\S]*?z-index: 119;/);
  const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(rules, /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(|gradient/);
});

test('home en /search zetten de balk vóór de tabbalk', () => {
  for (const [name, source] of [['home', HOME], ['search', SEARCH]]) {
    assert.match(source, /import SavedDishesBar from '@\/src\/components\/SavedDishesBarLazy'/, name);
    const bar = source.indexOf('<SavedDishesBar />');
    const tabs = source.indexOf('<MobileTabBar />');
    assert.ok(bar > -1 && tabs > bar, `${name}: de balk staat vóór de tabbalk`);
  }
});

test('de balk komt pas binnen als er iets bewaard is (geen statische import)', () => {
  // Lead-review ronde 3, punt 3: de balk hoorde bij het eerste JS-pakket van /
  // en /search, ook zonder bewaard gerecht. De lezer laadt hem pas bij een
  // aantal van één of meer, via next/dynamic.
  const LAZY = read('src/components/SavedDishesBarLazy.js');
  assert.match(LAZY, /^'use client'/m);
  assert.match(LAZY, /import dynamic from 'next\/dynamic'/);
  assert.match(LAZY, /dynamic\(\(\) => import\('\.\/SavedDishesBar'\), \{ ssr: false, loading: \(\) => null \}\)/);
  assert.match(LAZY, /const sync = \(\) => setShow\(savedCount\(browserStorage\(\)\) > 0\)/);
  assert.match(LAZY, /window\.addEventListener\(SAVED_LIST_EVENT_NAME, sync\)/);
  assert.match(LAZY, /return show \? <SavedDishesBar \/> : null/);
  assert.doesNotMatch(
    LAZY,
    /^import \{[^}]*SavedDishesBar[^}]*\} from '\.\/SavedDishesBar'/m,
    'de balk staat weer in een statische import'
  );
  assert.doesNotMatch(LAZY, /^import SavedDishesBar from '\.\/SavedDishesBar'/m);
  // De balk zelf blijft ongewijzigd werken als hij eenmaal geladen is.
  assert.match(BAR, /^'use client'/m);
});
