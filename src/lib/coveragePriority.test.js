'use strict';

// PLATFORM-12 Phase 1 — Coverage Dashboard v2: prioritized data gaps.
// Unit tests for the pure presentation helpers in
// src/lib/coveragePriority.js, plus structural safety-net tests
// (fs.readFileSync + regex, this project's existing convention) for
// app/internal/coverage/page.js's own wiring.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  PRIORITY_DEFAULT_VISIBLE,
  menuDataGap,
  sortByMenuDataGap,
  visiblePriorityRows,
  metricState,
} = require('./coveragePriority');

const REPO_ROOT = path.join(__dirname, '..', '..');
const COVERAGE_PAGE_PATH = path.join(REPO_ROOT, 'app/internal/coverage/page.js');
const COVERAGE_ROUTE_PATH = path.join(REPO_ROOT, 'app/api/internal/v1/coverage/route.js');
const COVERAGE_METRICS_PATH = path.join(REPO_ROOT, 'src/services/coverageMetrics.js');
const GLOBALS_CSS_PATH = path.join(REPO_ROOT, 'app/globals.css');

const row = (label, total, withMenuData, pct = null) => ({ label, total, withMenuData, pct });

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

// ─── Priority sort ─────────────────────────────────────────────────────────

test('menuDataGap is total - withMenuData, from the raw counts (never the nullable pct)', () => {
  assert.equal(menuDataGap(row('A', 16, 2, 12.5)), 14);
  assert.equal(menuDataGap(row('B', 2, 0, null)), 2);
  assert.equal(menuDataGap(row('C', 1, 1, null)), 0);
  assert.equal(menuDataGap({}), 0);
});

test('sortByMenuDataGap orders by absolute number of restaurants missing menu data, not by total or percentage', () => {
  const rows = [
    row('Groot maar compleet', 10, 10, 100),
    row('Klein gat', 1, 0),
    row('Groot gat', 6, 1, 16.7),
    row('Middel', 4, 2, 50),
  ];
  assert.deepEqual(sortByMenuDataGap(rows).map((r) => [r.label, r.missingMenuData]), [
    ['Groot gat', 5],
    ['Middel', 2],
    ['Klein gat', 1],
    ['Groot maar compleet', 0],
  ]);
});

test('sortByMenuDataGap breaks ties by the larger neighbourhood first, then alphabetically by name', () => {
  const rows = [
    row('Station', 1, 0),
    row('Brabantpark', 3, 1),
    row('blauwe Kei', 1, 0),
    row('Abdij', 2, 0),
    row('Heusdenhout', 1, 0),
  ];
  // Gap 2: Brabantpark (total 3) before Abdij (total 2). Gap 1, total 1:
  // alphabetical, case-insensitive (Dutch collation).
  assert.deepEqual(sortByMenuDataGap(rows).map((r) => r.label), ['Brabantpark', 'Abdij', 'blauwe Kei', 'Heusdenhout', 'Station']);
});

test('sortByMenuDataGap is deterministic regardless of input order', () => {
  const rows = [row('Mastbos', 1, 0), row('Binnenstad', 16, 2), row('Wolfslaar', 1, 1), row('Princenhage', 1, 0), row('Brabantpark', 2, 0)];
  const expected = sortByMenuDataGap(rows).map((r) => r.label);
  for (const shuffled of [[...rows].reverse(), [rows[2], rows[0], rows[4], rows[1], rows[3]]]) {
    assert.deepEqual(sortByMenuDataGap(shuffled).map((r) => r.label), expected);
  }
});

test('sortByMenuDataGap never mutates its input — not the array, not the row objects', () => {
  const rows = deepFreeze([row('B', 2, 0), row('A', 16, 2, 12.5), row('C', 1, 1)]);
  const before = JSON.stringify(rows);
  const sorted = sortByMenuDataGap(rows); // would throw on a frozen array/object if it mutated
  assert.equal(JSON.stringify(rows), before);
  assert.notEqual(sorted, rows);
  for (const r of sorted) assert.ok(!rows.includes(r), 'returns new row objects, never the originals');
  assert.deepEqual(sorted.map(({ missingMenuData, ...rest }) => rest), [rows[1], rows[0], rows[2]], 'every original field is carried over unchanged');
});

test('sortByMenuDataGap keeps every neighbourhood — nothing is dropped', () => {
  const rows = [row('A', 1, 1), row('B', 1, 0), row('C', 5, 5), row('D', 2, 1)];
  assert.equal(sortByMenuDataGap(rows).length, rows.length);
  assert.deepEqual(sortByMenuDataGap(null), []);
});

test('with today\'s Breda figures the top 3 are Binnenstad, Brabantpark, then the alphabetically first 1-of-1 gap', () => {
  const breda = [
    row('Binnenstad', 16, 2, 12.5), row('Brabantpark', 2, 0), row('Wolfslaar', 1, 1), row('Princenhage', 1, 0), row('Heusdenhout', 1, 0),
    row('Mastbos', 1, 0), row('Blauwe Kei', 1, 0), row('Valkenberg', 1, 1), row('Station', 1, 0),
  ];
  const sorted = sortByMenuDataGap(breda).map((r) => r.label);
  assert.deepEqual(sorted.slice(0, 3), ['Binnenstad', 'Brabantpark', 'Blauwe Kei']);
  assert.deepEqual(sorted.slice(-2), ['Valkenberg', 'Wolfslaar'], 'complete neighbourhoods (gap 0) go last');
});

// ─── "Show all neighbourhoods" ─────────────────────────────────────────────

test('visiblePriorityRows shows the top 3 by default and everything once expanded', () => {
  const sorted = sortByMenuDataGap([row('A', 5, 0), row('B', 4, 0), row('C', 3, 0), row('D', 2, 0), row('E', 1, 0)]);
  assert.equal(PRIORITY_DEFAULT_VISIBLE, 3);
  const collapsed = visiblePriorityRows(sorted, false);
  assert.deepEqual(collapsed.rows.map((r) => r.label), ['A', 'B', 'C']);
  assert.equal(collapsed.hiddenCount, 2);
  const expanded = visiblePriorityRows(sorted, true);
  assert.equal(expanded.rows.length, 5);
  assert.equal(expanded.hiddenCount, 2, 'hiddenCount describes the collapsed view, so the toggle stays available to collapse again');
});

test('visiblePriorityRows offers nothing to expand when there are 3 or fewer neighbourhoods', () => {
  const sorted = sortByMenuDataGap([row('A', 2, 0), row('B', 1, 0)]);
  assert.deepEqual(visiblePriorityRows(sorted, false), { rows: sorted, hiddenCount: 0 });
  assert.deepEqual(visiblePriorityRows(null, false), { rows: [], hiddenCount: 0 });
});

// ─── Metric card state ─────────────────────────────────────────────────────

test('metricState is complete / partial / empty from the existing count and total', () => {
  assert.equal(metricState(25, 25), 'complete');
  assert.equal(metricState(4, 25), 'partial');
  assert.equal(metricState(354, 367), 'partial');
  assert.equal(metricState(0, 25), 'empty');
  assert.equal(metricState(0, 0), 'empty', 'nothing to count is never shown as complete');
});

// ─── Structural safety net: app/internal/coverage/page.js ─────────────────

function pageSource() {
  return fs.readFileSync(COVERAGE_PAGE_PATH, 'utf8');
}

/** The page source without comments (line comments and JSX/block
 * comments), so checks for rendered actions are not tripped by the header
 * comment that explains which action is deliberately NOT built. */
function pageCode() {
  return pageSource()
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function heroSource() {
  const source = pageSource();
  const start = source.indexOf('aria-labelledby="coverage-hero-heading"');
  const end = source.indexOf('{/* Four secondary metric cards');
  assert.ok(start >= 0 && end > start, 'expected to find the hero section before the metric cards');
  return source.slice(start, end);
}

test('structural: the hero is the dominant metric and reads exactly metrics.menuData — no other figure', () => {
  const hero = heroSource();
  assert.match(hero, /\{data\.metrics\.menuData\.pct === null \? '—' : `\$\{data\.metrics\.menuData\.pct\}%`\}/);
  assert.match(hero, /\{data\.metrics\.menuData\.count\} of \{data\.metrics\.menuData\.total\} restaurants have digitized menu data\./);
  for (const other of ['basicInfo', 'priceCoverage', 'reservationConfirmed', 'byBuurt', 'byCuisine']) {
    assert.doesNotMatch(hero, new RegExp(`data\\.(metrics\\.)?${other}`), `the hero must not show ${other}`);
  }
  // Dominant: a larger figure than any metric card.
  assert.match(hero, /fontSize: 'clamp\(44px, 10vw, 64px\)'/);
  assert.match(pageSource(), /function Metric[\s\S]*?fontSize: 22,/);
});

test('structural: the hero presents data presence, never verified accuracy', () => {
  assert.match(heroSource(), /not whether it has been verified as accurate/);
});

test('structural: the four existing metric cards remain, each with its exact existing figures', () => {
  const source = pageSource();
  const cards = source.match(/<Metric\b[\s\S]*?\/>/g) || [];
  assert.equal(cards.length, 4, 'exactly the four existing metric cards');
  const keys = ['basicInfo', 'menuData', 'priceCoverage', 'reservationConfirmed'];
  cards.forEach((card, i) => {
    for (const field of ['count', 'total', 'pct']) {
      assert.match(card, new RegExp(`${field}=\\{data\\.metrics\\.${keys[i]}\\.${field}\\}`), `card ${i + 1} must read data.metrics.${keys[i]}.${field}`);
    }
  });
});

test('structural: the priority table renders byBuurt through the pure gap sort and the top-3 split', () => {
  const source = pageSource();
  assert.match(source, /import \{[^}]*sortByMenuDataGap[^}]*\} from '@\/src\/lib\/coveragePriority'/);
  assert.match(source, /sortByMenuDataGap\(data\.byBuurt\)/);
  assert.match(source, /visiblePriorityRows\(priorityRows, showAllBuurten\)/);
  assert.match(source, /<BreakdownTable title="Priority gaps by neighbourhood" rows=\{visibleBuurten\}/);
  assert.doesNotMatch(source, /data\.byBuurt\.sort\(|data\.byBuurt\.(splice|reverse|push)\(/, 'the fetched data must never be mutated');
});

test('structural: "show all neighbourhoods" is a real in-page button with aria-expanded/aria-controls, no route or fetch', () => {
  const source = pageSource();
  const button = (source.match(/<button[\s\S]*?<\/button>/g) || []);
  assert.equal(button.length, 1, 'exactly one button on the page: the inline expand toggle');
  assert.match(button[0], /type="button"/);
  assert.match(button[0], /aria-expanded=\{showAllBuurten\}/);
  assert.match(button[0], /aria-controls=\{PRIORITY_TBODY_ID\}/);
  assert.match(button[0], /onClick=\{\(\) => setShowAllBuurten\(\(open\) => !open\)\}/);
  assert.match(source, /<tbody id=\{tbodyId\}>/);
  assert.match(source, /\{hiddenCount > 0 && \(/, 'only offered when there is more to show');
  const css = fs.readFileSync(GLOBALS_CSS_PATH, 'utf8');
  assert.match(css, /\.cov-toggle:focus-visible \{[^}]*outline:/, 'visible keyboard focus (decision 014)');
});

test('structural: the cuisine table is no longer rendered in the primary view, but its limitation is explained', () => {
  const source = pageSource();
  assert.doesNotMatch(source, /rows=\{data\.byCuisine\}/, 'no table renders byCuisine');
  assert.doesNotMatch(source, /title="By cuisine"/);
  assert.equal((source.match(/<BreakdownTable\b/g) || []).length, 1, 'exactly one table: the neighbourhood priority table');
  const details = source.slice(source.indexOf('<details'), source.indexOf('</details>'));
  assert.match(details, /Why there is no cuisine breakdown/);
  assert.match(details, /near-unique free-text description per restaurant/);
  assert.match(details, /\{data\.byCuisine\.length\} distinct values across \{data\.totals\.restaurants\} restaurants/, 'the count comes from the real data, never a hardcoded figure');
});

test('structural: exactly one methodology section, collapsed by default, holding every caveat', () => {
  const source = pageSource();
  const detailsTags = source.match(/<details\b[^>]*>/g) || [];
  assert.equal(detailsTags.length, 1, 'exactly one details/summary section');
  assert.doesNotMatch(detailsTags[0], /\bopen\b/, 'collapsed by default');
  assert.equal((source.match(/<summary\b/g) || []).length, 1);
  const details = source.slice(source.indexOf('<details'), source.indexOf('</details>'));
  assert.match(details, /Methodology &amp; data notes/);
  assert.match(details, /Percentages are only shown for groups with at least \{data\.sampleThreshold\} restaurants\./, 'sample threshold');
  assert.match(details, /near-unique free-text/, 'cuisine limitation');
  assert.match(details, /data <em>presence<\/em>, not verified trust\/provenance/, 'trust/provenance caveat');
  assert.match(details, /PLATFORM-03/);
  assert.match(details, /docs\/coverage\/breda-baseline-2026-08-30\.md/, 'baseline reference');
  assert.match(details, /How the priority order works/, 'the sort definition is documented on the page');
  // None of these caveats is stated a second time outside the section.
  const outside = source.slice(0, source.indexOf('<details')) + source.slice(source.indexOf('</details>'));
  assert.doesNotMatch(outside, /breda-baseline-2026-08-30|Percentages are only shown|near-unique free-text/);
});

test('structural: no new external action, link, route or API call — the one fetch is the existing gated route', () => {
  const source = pageCode();
  assert.doesNotMatch(source, /<a\b|href=|next\/link|window\.open|location\.(assign|href)|router\.push\(/, 'no link or navigation action of any kind');
  assert.doesNotMatch(source, /View restaurants without menus|restaurants without menu/i, 'the Phase 2+ worklist action is not built');
  const fetches = source.match(/fetch\(/g) || [];
  assert.equal(fetches.length, 1, 'exactly one fetch');
  assert.match(source, /fetch\('\/api\/internal\/v1\/coverage', \{\s*headers: \{ Authorization: `Bearer \$\{token\}` \},\s*\}\)/);
  assert.doesNotMatch(source, /https?:\/\//, 'no external URL');
  assert.doesNotMatch(source, /<img\b|next\/image|\.png|\.jpg|\.svg['"]/i, 'no image asset');
});

test('structural: no left-hand navigation column or new navigation chrome — InternalNav stays the only navigation', () => {
  const source = pageSource();
  assert.match(source, /<InternalNav accessToken=\{session\.access_token\} \/>/);
  assert.doesNotMatch(source, /<nav\b|<aside\b|sidebar/i);
});

test('structural: the coverage route and metrics computation are byte-for-byte unchanged (LF-normalized)', () => {
  const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
  // Hashes of app/api/internal/v1/coverage/route.js and
  // src/services/coverageMetrics.js exactly as on origin/main 9040099.
  // PLATFORM-12 forbids changing either without a separate decision; if
  // one ever changes deliberately, update the hash in that change.
  assert.equal(sha(COVERAGE_ROUTE_PATH), 'd256917f7d72032fe2c767898ae95d5079c3fa3ec154133e2df2dbc5564b97cb');
  assert.equal(sha(COVERAGE_METRICS_PATH), '59631f66903a5ec07f41b4379da250df71206c864ce66f885c8029c153fb2355');
});
