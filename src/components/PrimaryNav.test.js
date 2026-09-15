'use strict';

// BE-11 — structural source tests for the permanent, text-only primary
// navigation. Same convention as RestaurantBrowseCard.test.js and
// src/lib/nvwaComplianceCopy.test.js: fs.readFileSync + regex, since this
// project has no rendered-DOM test harness for 'use client' components.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..');
const COMPONENT_PATH = path.join(REPO_ROOT, 'src/components/PrimaryNav.js');

function readSource() {
  return fs.readFileSync(COMPONENT_PATH, 'utf8');
}

// First-slice scope regression guard: PrimaryNav must only ever be
// imported by /search and /alle-restaurants in this slice. Every other
// route is deliberately excluded (see PrimaryNav.js's own header comment
// and the BE-11 ticket's "Primary navigation" section) — this test makes
// that an enforced fact, not just a documented intention, so a future
// change can't silently widen the scope without a test failing here.
const EXCLUDED_PAGES = [
  'app/page.js',
  'app/restaurants/page.js',
  'app/restaurant/[id]/RestaurantDetailView.js',
  'app/menu/[id]/MenuView.js',
  'app/nvwa/[id]/NvwaView.js',
];

for (const relativePath of EXCLUDED_PAGES) {
  test(`${relativePath} does not import or render PrimaryNav`, () => {
    const source = fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
    assert.doesNotMatch(source, /PrimaryNav/, `${relativePath} must stay excluded from the first navigation slice`);
  });
}

test('is a client component', () => {
  const source = readSource();
  assert.match(source, /^'use client'/);
});

test('renders a semantic <nav> with the required Dutch aria-label', () => {
  const source = readSource();
  assert.match(source, /<nav className="primary-nav" aria-label="Hoofdnavigatie">/);
});

test('defines exactly the two decided destinations, in order, with the exact required labels', () => {
  const source = readSource();
  const destinationsBlock = source.match(/const DESTINATIONS = \[([\s\S]*?)\]/);
  assert.ok(destinationsBlock, 'expected a DESTINATIONS array');
  const entries = [...destinationsBlock[1].matchAll(/href:\s*'([^']+)',\s*label:\s*'([^']+)'/g)];
  assert.deepEqual(
    entries.map((m) => [m[1], m[2]]),
    [['/search', 'Zoeken'], ['/alle-restaurants', 'Alle restaurants']],
    'expected exactly /search "Zoeken" then /alle-restaurants "Alle restaurants", no other destination'
  );
});

test('aria-current is derived from usePathname() only — never from search params or any other signal', () => {
  const source = readSource();
  assert.match(source, /const pathname = usePathname\(\)/);
  assert.match(source, /aria-current=\{pathname === destination\.href \? 'page' : undefined\}/);
  assert.doesNotMatch(source, /useSearchParams/, 'active state must never depend on query-string content');
});

test('renders real <Link> elements, not <button> or a <div> with a click handler', () => {
  const source = readSource();
  assert.match(source, /import Link from 'next\/link'/);
  assert.match(source, /<Link\s/);
  assert.doesNotMatch(source, /<button/i);
  assert.doesNotMatch(source, /onClick/);
});

test('carries no emoji, icon library import, or new dependency', () => {
  const source = readSource();
  // Broad emoji/pictograph ranges, same check convention used elsewhere in
  // this project's structural tests for "no icon" navigation requirements.
  const emojiPattern = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  assert.doesNotMatch(source, emojiPattern, 'no emoji allowed anywhere in this component');
  assert.doesNotMatch(source, /react-icons|lucide|heroicons|<svg/i, 'no icon library or inline SVG — text-only per the ticket');
  const importLines = source.match(/^import .+$/gm) || [];
  assert.deepEqual(
    importLines.map((l) => l.trim()),
    ["import Link from 'next/link'", "import { usePathname } from 'next/navigation'"],
    'no import beyond Link and usePathname — no new dependency'
  );
});
