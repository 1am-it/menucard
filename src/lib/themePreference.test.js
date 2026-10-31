'use strict';

// BE-63 (#155) — de weergavekeuze: Licht, Donker en Automatisch.
//
// De rekenregels tegen de echte module: welke stand geldt, wat er bewaard wordt
// en dat 'auto' het systeem volgt zonder de opgeslagen keuze te verliezen.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const {
  AUTO_THEME,
  DEFAULT_THEME,
  THEME_KEY,
  THEME_OPTIONS,
  applyThemeChoice,
  normalizeTheme,
  readThemePreference,
  resolveTheme,
  systemTheme,
  writeThemePreference,
} = require('./themePreference');

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    read: (key) => (data.has(key) ? data.get(key) : null),
  };
}

test('de drie standen uit het ontwerp, in deze volgorde, met dezelfde opslagsleutel', () => {
  assert.equal(THEME_KEY, 'bredaeats_theme');
  assert.deepEqual(THEME_OPTIONS.map((option) => option.value), ['light', 'dark', 'auto']);
  assert.deepEqual(THEME_OPTIONS.map((option) => option.label), ['Licht', 'Donker', 'Automatisch']);
  assert.equal(AUTO_THEME, 'auto');
  assert.equal(DEFAULT_THEME, 'dark');
});

test('normalizeTheme accepteert alleen de drie standen', () => {
  assert.equal(normalizeTheme('light'), 'light');
  assert.equal(normalizeTheme(' DARK '), 'dark');
  assert.equal(normalizeTheme('auto'), 'auto');
  assert.equal(normalizeTheme('system'), null);
  assert.equal(normalizeTheme('paars'), null);
  assert.equal(normalizeTheme(undefined), null);
  assert.equal(normalizeTheme(null), null);
});

test('Automatisch volgt het systeem; zonder keuze blijft de pagina donker', () => {
  assert.equal(systemTheme(true), 'light');
  assert.equal(systemTheme(false), 'dark');
  assert.equal(resolveTheme('auto', true), 'light');
  assert.equal(resolveTheme('auto', false), 'dark');
  assert.equal(resolveTheme('light', false), 'light');
  assert.equal(resolveTheme('dark', true), 'dark');
  assert.equal(resolveTheme(null, true), 'dark');
  assert.equal(resolveTheme('onbekend', true), 'dark');
});

test('de keuze bewaren: auto blijft auto, onbruikbare waarden worden niet bewaard', () => {
  const storage = memoryStorage();
  assert.equal(writeThemePreference(storage, 'auto'), true);
  assert.equal(storage.read(THEME_KEY), 'auto');
  assert.equal(readThemePreference(storage), 'auto');
  assert.equal(writeThemePreference(storage, 'system'), false);
  assert.equal(storage.read(THEME_KEY), 'auto');
  assert.equal(readThemePreference(memoryStorage({ [THEME_KEY]: 'licht' })), null);
});

test('zonder opslag of met een kapotte opslag werkt de knop zonder fout', () => {
  assert.equal(readThemePreference(null), null);
  assert.equal(writeThemePreference(null, 'light'), false);
  const broken = {
    getItem: () => { throw new Error('geblokkeerd'); },
    setItem: () => { throw new Error('geblokkeerd'); },
  };
  assert.equal(readThemePreference(broken), null);
  assert.equal(writeThemePreference(broken, 'light'), false);
});

test('applyThemeChoice zet alleen data-theme, met de stand die echt geldt', () => {
  const written = [];
  const root = { setAttribute: (name, value) => written.push([name, value]) };
  assert.equal(applyThemeChoice('light', false, root), true);
  assert.equal(applyThemeChoice('auto', true, root), true);
  assert.equal(applyThemeChoice('auto', false, root), true);
  assert.deepEqual(written, [
    ['data-theme', 'light'],
    ['data-theme', 'light'],
    ['data-theme', 'dark'],
  ]);
});

test('de blokkerende startscript kent de stand auto en houdt hem vast', () => {
  const layout = fs.readFileSync(path.join(__dirname, '..', '..', 'app/layout.js'), 'utf8');
  assert.match(layout, /else if\(t==='auto'\)\{/);
  assert.match(layout, /prefers-color-scheme: light/);
  // Alleen de oude 'system'-waarde wordt één keer omgezet naar light of dark.
  assert.match(layout, /t==='system'/);
  assert.match(layout, /localStorage\.setItem\('bredaeats_theme',r\)/);
});
