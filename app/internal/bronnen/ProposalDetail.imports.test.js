'use strict';

// BE-40 (#95) — bronregressie voor de voorsteldetailkaart.
//
// Op `main` gebruikte app/internal/bronnen/ProposalDetail.js de vier etiketten
// STATUS_LABELS, SOURCE_BADGES, MENU_BADGES en EVENT_LABELS wel, maar
// importeerde ze niet uit src/lib/sourceTriage. Renderen liep daardoor op een
// ReferenceError. De test leest de bron (zelfde conventie als de andere app/-
// tests: fs.readFileSync + regex) en faalt zodra een gebruikt etiket uit
// sourceTriage weer niet geïmporteerd is. Geen browser, geen bundel.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const DETAIL_PATH = path.join(REPO_ROOT, 'app/internal/bronnen/ProposalDetail.js');
const SOURCE_TRIAGE_PATH = path.join(REPO_ROOT, 'src/lib/sourceTriage.js');

// The four labels that were missing on main; also the reason this test exists.
const BE_40_LABELS = ['STATUS_LABELS', 'SOURCE_BADGES', 'MENU_BADGES', 'EVENT_LABELS'];

const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

/** Names of the named import from '@/src/lib/sourceTriage' (empty when absent). */
function importedFromSourceTriage(source) {
  // `[^}]*` keeps the match inside one import clause; `[\s\S]*?` would run on
  // to the next `} from '...'` and swallow the imports in between.
  const match = source.match(/import\s*\{([^}]*)\}\s*from\s*'@\/src\/lib\/sourceTriage'/);
  if (!match) return [];
  return match[1]
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

/** The component body without its import statements. */
function bodyOf(source) {
  return source
    .replace(/import\s+[\s\S]*?\s+from\s*'[^']+';?/g, '')
    .replace(/import\s*'[^']+';?/g, '');
}

/** Names that src/lib/sourceTriage.js actually exports. */
function sourceTriageExports() {
  const source = read(SOURCE_TRIAGE_PATH);
  const match = source.match(/module\.exports = \{([\s\S]*?)\n\};/);
  assert.ok(match, 'src/lib/sourceTriage.js moet een module.exports-blok houden');
  return match[1]
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name && !name.includes(':'));
}

const uses = (body, name) => new RegExp(`\\b${name}\\b`).test(body);

test('BE-40: ProposalDetail importeert de vier etiketten die het gebruikt', () => {
  const source = read(DETAIL_PATH);
  const imported = importedFromSourceTriage(source);
  const body = bodyOf(source);

  for (const name of BE_40_LABELS) {
    assert.ok(uses(body, name), `verwacht dat ProposalDetail ${name} nog gebruikt`);
    assert.ok(
      imported.includes(name),
      `ProposalDetail gebruikt ${name} maar importeert het niet uit @/src/lib/sourceTriage`
    );
  }
});

test('BE-40: elk gebruikt etiket uit sourceTriage is ook geïmporteerd', () => {
  const source = read(DETAIL_PATH);
  const imported = importedFromSourceTriage(source);
  const body = bodyOf(source);

  const usedButNotImported = sourceTriageExports()
    .filter((name) => uses(body, name))
    .filter((name) => !imported.includes(name));

  assert.deepEqual(
    usedButNotImported,
    [],
    `deze namen komen uit @/src/lib/sourceTriage en moeten in de import staan: ${usedButNotImported.join(', ')}`
  );
});
