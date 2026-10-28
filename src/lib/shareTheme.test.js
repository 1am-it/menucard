'use strict';

// BE-44 (#105) — de kleuren van de voorvertoningsafbeelding tegenover het echte
// thema. De eigenaar wil de kleuren van de app, en dat ze meeveranderen als het
// thema verandert. ImageResponse kan `app/globals.css` niet lezen; daarom staat
// de vertaling in src/lib/shareTheme.js en bewijst deze test dat elke waarde
// gelijk is aan het themablok in globals.css — inclusief de doorverwijzing
// `--card-surface: var(--bg-card)`.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { APP_ICON_SVG, SHARE_THEME, SHARE_THEME_TOKENS, shareThemeFor } = require('./shareTheme');

const CSS_PATH = path.join(__dirname, '..', '..', 'app', 'globals.css');
const css = fs.readFileSync(CSS_PATH, 'utf8');

/** Het declaratieblok van één selector, zonder geneste regels. */
function blockFor(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `selector ${selector} staat niet in app/globals.css`);
  const open = css.indexOf('{', start);
  const end = css.indexOf('\n}', open);
  return css.slice(open + 1, end);
}

function tokensOf(block) {
  const tokens = {};
  const pattern = /--([a-z0-9-]+)\s*:\s*([^;]+);/g;
  let match;
  while ((match = pattern.exec(block)) !== null) tokens[match[1]] = match[2].trim();
  return tokens;
}

/** `var(--x)` oplossen binnen hetzelfde blok, zodat een alias geen eigen kopie is. */
function resolve(tokens, name, seen = []) {
  const value = tokens[name];
  assert.ok(value !== undefined, `token --${name} ontbreekt in het themablok`);
  const alias = value.match(/^var\(--([a-z0-9-]+)\)$/);
  if (!alias) return value;
  assert.ok(!seen.includes(name), `kringverwijzing via --${name}`);
  return resolve(tokens, alias[1], [...seen, name]);
}

// Het donkere thema is het basisblok `:root`; het lichte thema staat onder
// `:root[data-theme="light"]` (en, voor een systeemvoorkeur zonder override,
// onder `:root:not([data-theme="dark"])`). Beide lichte blokken moeten gelijk
// zijn aan de constante, anders wijkt de voorvertoning af van de pagina.
const THEME_BLOCKS = {
  donker: [':root'],
  licht: [':root[data-theme="light"]', ':root:not([data-theme="dark"])'],
};

test('de donkere kleuren komen uit het donkere themablok van app/globals.css', () => {
  const tokens = tokensOf(blockFor(':root'));
  for (const [key, token] of Object.entries(SHARE_THEME_TOKENS.donker)) {
    assert.equal(SHARE_THEME.donker[key], resolve(tokens, token.slice(2)).toUpperCase(), `donker.${key} moet --${token.slice(2)} zijn`);
  }
});

test('de lichte kleuren komen uit beide lichte themablokken van app/globals.css', () => {
  for (const selector of THEME_BLOCKS.licht) {
    const tokens = tokensOf(blockFor(selector));
    for (const [key, token] of Object.entries(SHARE_THEME_TOKENS.licht)) {
      assert.equal(SHARE_THEME.licht[key], resolve(tokens, token.slice(2)).toUpperCase(), `${selector}: licht.${key} moet --${token.slice(2)} zijn`);
    }
  }
});

test('de waarden zijn de waarden uit het contract, in beide standen', () => {
  assert.deepEqual(SHARE_THEME.licht, {
    frame: '#F6C057',
    card: '#FFFFFF',
    textPrimary: '#1A1410',
    textSecondary: '#5C5650',
    priceBg: '#F3F1EC',
    priceText: '#1A1410',
    border: '#EEEAE2',
  });
  assert.deepEqual(SHARE_THEME.donker, {
    frame: '#1F2328',
    card: '#2A2F35',
    textPrimary: '#F2F3F4',
    textSecondary: '#B6BCC3',
    priceBg: '#353A41',
    priceText: '#F2F3F4',
    border: '#3A4048',
  });
});

test('een onbekende stand valt terug op licht en donker is donker', () => {
  assert.deepEqual(shareThemeFor('donker'), SHARE_THEME.donker);
  assert.deepEqual(shareThemeFor('dark'), SHARE_THEME.donker);
  assert.deepEqual(shareThemeFor('licht'), SHARE_THEME.licht);
  assert.deepEqual(shareThemeFor('paars'), SHARE_THEME.licht);
  assert.deepEqual(shareThemeFor(undefined), SHARE_THEME.licht);
});

test('het "om"-beeldmerk is exact het bestaande app/icon.svg', () => {
  const iconFile = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'icon.svg'), 'utf8').trim();
  assert.equal(APP_ICON_SVG, iconFile);
  assert.match(APP_ICON_SVG, /#F6C057/);
  // Scherp op elk formaat: een vector, geen bitmap.
  assert.match(APP_ICON_SVG, /viewBox="0 0 32 32"/);
});
