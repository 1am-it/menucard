'use strict';

// BE-71 (#176, R6) — bronregressie voor de melding bij een kaart die zonder de
// twijfelgevallen op de site staat: "Niet alle gerechten staan erop · bekijk de
// volledige kaart bij het restaurant", met een link naar de bron. JSX rendert
// node --test niet, dus dit leest de bron en de opmaak, net als de andere
// oppervlaktetests.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const MENU_BODY = fs.readFileSync(path.join(ROOT, 'src', 'components', 'MenuBody.js'), 'utf8');
const MENU_VIEW = fs.readFileSync(path.join(ROOT, 'app', 'menu', '[id]', 'MenuView.js'), 'utf8');
const MENU_BODY_CSS = fs.readFileSync(path.join(ROOT, 'src', 'components', 'menu-body.css'), 'utf8');

test('R6: de melding noemt de tekst uit het correctielog en alleen bij incomplete kaarten', () => {
  const start = MENU_BODY.indexOf('export function MenuIncompleteNotice');
  assert.ok(start > -1, 'MenuIncompleteNotice hoort in MenuBody.js te staan');
  const body = MENU_BODY.slice(start, start + 900);
  assert.match(body, /entry\.incomplete !== true\) return null/);
  assert.match(body, /Niet alle gerechten staan erop/);
  assert.match(body, /bekijk de volledige kaart bij het restaurant/);
  assert.match(body, /href=\{entry\.source\}/);
  assert.match(body, /rel="noopener"/);
});

test('R6: de menupagina toont de melding en de opmaak staat naast de component', () => {
  assert.match(MENU_VIEW, /MenuIncompleteNotice\s*\n?\s*\} from '@\/src\/components\/MenuBody'/);
  assert.match(MENU_VIEW, /<MenuIncompleteNotice entry=\{r\} \/>/);
  assert.match(MENU_BODY_CSS, /\.menu-incomplete \{/);
  assert.match(MENU_BODY_CSS, /var\(--text-secondary\)/);
});
