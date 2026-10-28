'use strict';

// BE-39 "Klaar voor publicatie" — structural safety net over the files: the
// list and the detail render the one publication rule instead of their own
// copy of the gates, the second badge only appears for an approved card, the
// count hides at zero, the export texts stay the existing ones, and no colour,
// GitHub token or write is introduced.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// The working copy keeps CRLF line endings; normalise them so the source
// patterns below describe the code, not the checkout.
const readCode = (rel) => read(rel).replace(/\r\n/g, '\n');
const VIEW_PATH = 'app/internal/menu-concepts/MenuConceptsView.js';
const VIEW = readCode(VIEW_PATH);

test('one rule: the view imports the pure publication rule and its export texts', () => {
  // BE-41 adds the next-step rule from the same module: one import, one rule.
  assert.match(VIEW, /import \{ deriveNextStep, derivePublicationReadiness, EXPORT_STATUS_LABELS \} from '@\/src\/lib\/menuConceptPublication'/);
  // The detail derives canExport from that function, with only `dirty` coming
  // from the browser.
  assert.match(VIEW, /const publication = derivePublicationReadiness\(\{/);
  assert.match(VIEW, /dirty,/);
  assert.match(VIEW, /const canExport = Boolean\(publication && publication\.canExport\)/);
  // The old hand-written gate copy is gone.
  assert.doesNotMatch(VIEW, /exportBlockers/);
  assert.doesNotMatch(VIEW, /if \(!sourceOk\) /);
  // The existing export texts come from the shared constant, so they cannot drift.
  for (const status of ['opened', 'merged', 'closed', 'failed', 'pending']) {
    assert.match(VIEW, new RegExp(`${status}: \\{ role: '[a-z]+', icon: '[a-z]+', label: EXPORT_STATUS_LABELS\\.${status} \\}`), status);
  }
});

test('the list shows exactly one second badge for an approved card and hides the count at zero', () => {
  // The badge renders the server's label and only the existing badge roles.
  assert.match(VIEW, /function PublicationBadge\(\{ publication \}\)/);
  assert.match(VIEW, /const view = publicationView\(publication && publication\.state\)/);
  assert.match(VIEW, /<span>\{publication\.label\}<\/span>/);
  // BE-41 (criterion 3): "Nog niet klaar" is the existing oker attention role,
  // a ready card keeps the positive role. No colour is written here.
  assert.match(VIEW, /const PUBLICATION_VIEW = \{\n  ready: \{ role: 'positive', icon: 'check' \},\n  not_ready: \{ role: 'old', icon: 'alert' \},\n\}/);
  assert.match(VIEW, /<StatusBadge status=\{item\.status\} \/>\n          <PublicationBadge publication=\{item\.publication\} \/>/);
  // Criterion 3: "N klaar voor publicatie", and nothing at all when N = 0.
  assert.match(VIEW, /const readyCount = items\.filter\(\(i\) => i\.publication && i\.publication\.ready\)\.length/);
  assert.match(VIEW, /\{readyCount > 0 && <p className="mcr-ready-count">\{readyCount\} klaar voor publicatie<\/p>\}/);
  // Criterion 4: merged is not live.
  assert.match(VIEW, /\{item\.publication && item\.publication\.liveNote && <p className="mcr-meta">\{item\.publication\.liveNote\}<\/p>\}/);
});

test('the new styling reuses theme tokens and adds no new badge colour', () => {
  const css = readCode('app/globals.css');
  const block = css.slice(css.indexOf('.mcr-item-badges'), css.indexOf('.mcr-ready-count') + 200);
  assert.match(block, /\.mcr-item-badges \{ display: flex;/);
  assert.match(block, /\.mcr-ready-count \{ margin: 0; font-size: 14px; font-weight: 600; color: var\(--text-primary\); \}/);
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/);
  assert.doesNotMatch(VIEW, /status-badge--(blocked|old)/);
});

test('no GitHub call, token, write or migration is introduced by the publication badge', () => {
  assert.doesNotMatch(VIEW, /GITHUB_EXPORT_TOKEN|NEXT_PUBLIC_GITHUB|api\.github\.com|\bfetch\(/);
  const lib = read('src/lib/menuConceptPublication.js');
  assert.doesNotMatch(lib, /\bfetch\(|require\('node:(fs|http|https)'\)|process\.env|\.from\(|\.insert\(|\.update\(/);
  const handlers = read('src/lib/menuConceptReviewHandlers.js');
  // The list only displays the stored export: no refresh and no GitHub lookup.
  assert.doesNotMatch(handlers, /refreshExport\(/);
  assert.match(handlers, /storedExportsForSnapshots\(supabase, latest\.map/);
});
