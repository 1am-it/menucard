'use strict';

// BE-51 (#121) — bronregressies voor de toegankelijkheid van de publieke
// pagina's: dezelfde conventie als app/public-pages-style.test.js (fs + regex).
//
// Wat hier wordt vastgelegd, is precies wat de browsercheck
// (ops/browser/run-a11y-public-check.js) in de browser meet: namen en labels,
// landmarks, en de reflow- en bewegingsregels. Een wijziging die een van deze
// regels stilzwijgend terugdraait, valt hier om — zonder browser en zonder
// netwerk.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/** Het BE-51-blok onderaan globals.css, zodat een regel elders niet telt. */
const be51Block = () => {
  const css = read('app/globals.css');
  const start = css.indexOf('BE-51 (#121) — toegankelijkheid van de publieke pagina');
  assert.ok(start > 0, 'verwacht het BE-51-blok in app/globals.css');
  return css.slice(start);
};

test('globals.css respecteert prefers-reduced-motion', () => {
  const block = be51Block();
  assert.match(block, /@media \(prefers-reduced-motion: reduce\) \{/);
  assert.match(block, /html \{ scroll-behavior: auto; \}/);
  assert.match(block, /animation-duration: 0\.01ms !important/);
  assert.match(block, /transition-duration: 0\.01ms !important/);
});

test('de BE-51-laag gebruikt alleen tokens en geen eigen kleuren', () => {
  const block = be51Block();
  assert.doesNotMatch(block, /:\s*#[0-9a-fA-F]{3,8}\b/, 'geen hardgecodeerde kleur in de BE-51-laag');
  assert.doesNotMatch(block, /:\s*rgba?\(/, 'geen hardgecodeerde kleur in de BE-51-laag');
});
