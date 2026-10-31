'use strict';

// BE-60 (#150) — de regressie op het themabewijs van de browsercheck.
//
// De eerste levering van BE-60 noemde een donkere opname "390-light", omdat het
// thema met een losse opslagschrijfactie werd gezet in plaats van met de knop
// van de app. Deze tests leggen de keuring vast: een bewijs telt alleen als
// `data-theme`, de actieve themaknop én de helderheid van `--bg` alle drie
// kloppen. Geen browser, geen server, geen netwerk.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  THEME_LUMINANCE,
  parseColor,
  luminanceOf,
  themeProofScript,
  clickThemeScript,
  themeProofValue,
  themeOk,
} = require('./theme-proof');

// De echte tokenwaarden uit app/globals.css: donker is #1F2328, licht #FFFFFF.
const DONKER_BG = '#1F2328';
const LICHT_BG = '#FFFFFF';

const lightProof = (overrides = {}) => themeProofValue({
  attr: 'light',
  bg: LICHT_BG,
  bodyBg: 'rgb(255, 255, 255)',
  active: ['Licht'],
  buttons: ['Licht', 'Donker'],
  ...overrides,
});

const darkProof = (overrides = {}) => themeProofValue({
  attr: 'dark',
  bg: DONKER_BG,
  bodyBg: 'rgb(31, 35, 40)',
  active: ['Donker'],
  buttons: ['Licht', 'Donker'],
  ...overrides,
});

test('BE-60: #FFFFFF is licht en #1F2328 is donker', () => {
  assert.equal(luminanceOf(LICHT_BG), 255);
  assert.equal(luminanceOf(DONKER_BG), 35);
  assert.ok(THEME_LUMINANCE.light.above === 200);
  assert.ok(THEME_LUMINANCE.dark.below === 80);
});

test('BE-60: hex en rgb() geven dezelfde helderheid', () => {
  assert.deepEqual(parseColor('#1F2328'), [31, 35, 40]);
  assert.deepEqual(parseColor('#fff'), [255, 255, 255]);
  assert.deepEqual(parseColor('rgb(31, 35, 40)'), [31, 35, 40]);
  assert.deepEqual(parseColor('rgba(255, 255, 255, 0.98)'), [255, 255, 255]);
  assert.equal(parseColor('var(--bg)'), null);
  assert.equal(luminanceOf(''), null);
});

test('BE-60: het bewijs van een echte opname heeft alle drie de metingen', () => {
  const proof = lightProof();
  assert.equal(proof.attr, 'light');
  assert.deepEqual(proof.active, ['Licht']);
  assert.equal(proof.bg, LICHT_BG);
  assert.equal(proof.luminance, 255);
  assert.equal(proof.source, '--bg');
  assert.equal(themeOk(proof, 'light'), true);
});

test('BE-60: licht en donker worden alleen goedgekeurd als alles klopt', () => {
  assert.equal(themeOk(darkProof(), 'dark'), true);
  assert.equal(themeOk(lightProof(), 'dark'), false);
  assert.equal(themeOk(darkProof(), 'light'), false);
});

test('BE-60: de afgekeurde opname (donker bewijs onder de naam light) faalt', () => {
  // Precies de fout uit de review: de pagina stond donker terwijl de opname
  // "light" heette. Het thema-attribuut alleen is dan niet genoeg bewijs.
  const mislabeled = darkProof({ attr: 'light', active: ['Licht'] });
  assert.equal(mislabeled.attr, 'light');
  assert.deepEqual(mislabeled.active, ['Licht']);
  assert.equal(themeOk(mislabeled, 'light'), false);
});

test('BE-60: een ontbrekende of dubbele actieve knop keurt niet goed', () => {
  assert.equal(themeOk(lightProof({ active: [] }), 'light'), false);
  assert.equal(themeOk(lightProof({ active: ['Licht', 'Donker'] }), 'light'), false);
  assert.equal(themeOk(lightProof({ active: ['Donker'] }), 'light'), false);
  assert.equal(themeOk(themeProofValue({ attr: 'light', bg: '', bodyBg: '', active: ['Licht'] }), 'light'), false);
  assert.equal(themeOk(null, 'light'), false);
  assert.equal(themeOk(lightProof(), 'systeem'), false);
});

test('BE-60: zonder leesbare --bg geldt de achtergrond van de body', () => {
  const proof = themeProofValue({ attr: 'dark', bg: '', bodyBg: 'rgb(31, 35, 40)', active: ['Donker'] });
  assert.equal(proof.source, 'body');
  assert.equal(proof.luminance, 35);
  assert.equal(themeOk(proof, 'dark'), true);
});

test('BE-60: het pagina-script leest en zet niets, de klik komt van de knop', () => {
  const read = themeProofScript();
  assert.match(read, /getAttribute\('data-theme'\)/);
  assert.match(read, /getPropertyValue\('--bg'\)/);
  assert.match(read, /theme-btn/);
  assert.doesNotMatch(read, /localStorage|setAttribute\(/);
  assert.match(clickThemeScript('Licht'), /\.theme-btn/);
  assert.match(clickThemeScript('Donker'), /"Donker"/);
  assert.match(clickThemeScript('Licht'), /\.click\(\)/);
});
