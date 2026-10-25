'use strict';

// BE-28 (#65) — de zwevende telefoonmenubalk en het gedeelde Emoji-component.
// Zelfde conventie als de andere componenttests: fs.readFileSync + regex,
// geen gerenderde DOM-harness.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const BAR = read('src/components/MobileTabBar.js');

test('is a client component and derives the active tab from usePathname() only', () => {
  assert.match(BAR, /^'use client'/);
  assert.match(BAR, /const pathname = usePathname\(\)/);
  assert.match(BAR, /aria-current=\{pathname === destination\.href \? 'page' : undefined\}/);
  assert.doesNotMatch(BAR, /useSearchParams/);
});

test('offers exactly the two existing public destinations — no new route', () => {
  const block = BAR.match(/const DESTINATIONS = \[([\s\S]*?)\]/);
  assert.ok(block);
  const entries = [...block[1].matchAll(/href:\s*'([^']+)',\s*label:\s*'([^']+)',\s*glyph:\s*'([^']+)'/g)];
  assert.deepEqual(
    entries.map((m) => [m[1], m[2]]),
    [['/search', 'Zoeken'], ['/alle-restaurants', 'Restaurants']],
    'only the two existing destinations, in the mockup order'
  );
});

test('renders a labelled <nav> with real links and decorative emoji via <Emoji/>', () => {
  assert.match(BAR, /<nav className="mobile-tabbar" aria-label="Hoofdmenu">/);
  assert.match(BAR, /import Emoji from '@\/src\/components\/Emoji'/);
  assert.match(BAR, /<Emoji glyph=\{destination\.glyph\} \/>/);
  assert.match(BAR, /import Link from 'next\/link'/);
  assert.doesNotMatch(BAR, /<button|<img|<svg/);
  const withoutGlyphSlots = BAR.replace(/glyph="[^"]*"/g, '').replace(/glyph: '[^']*'/g, '');
  assert.doesNotMatch(withoutGlyphSlots, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, 'no bare emoji');
});

test('every public page mounts the bar and reserves room for it on the phone', () => {
  for (const file of [
    'app/HomeView.js',
    'app/search/page.js',
    'app/alle-restaurants/page.js',
    'app/restaurants/page.js',
    'app/restaurant/[id]/RestaurantDetailView.js',
    'app/menu/[id]/MenuView.js',
  ]) {
    const src = read(file);
    assert.match(src, /import MobileTabBar from '@\/src\/components\/MobileTabBar'/, file);
    assert.match(src, /<MobileTabBar \/>/, file);
  }
});
