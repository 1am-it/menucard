'use strict';

// BE-34 (#81, criterion 4) — the words the screens use while the app is busy.
// Pure: fixed inputs, fixed outputs, no clock of its own.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  NEW_FOUND_LOADING,
  ROW_SEARCHING,
  BUSY_LABEL,
  RETRY_LABEL,
  discoveryPlan,
  discoverySteps,
  countAiSearches,
  updatedLabel,
  discoveryFailure,
} = require('./discoveryProgress');

test('"Nieuw gevonden" says what it is fetching, not "(0)" over a bare line', () => {
  assert.equal(NEW_FOUND_LOADING, '🗺️ OpenStreetMap wordt opgehaald… (± 20 seconden, eerste keer per dag)');
  assert.equal(ROW_SEARCHING, '⏳ Zoeken…');
  assert.equal(BUSY_LABEL, 'Bezig…');
  assert.equal(RETRY_LABEL, 'Opnieuw proberen');
});

test('the plan counts one website check per restaurant and an AI search only without one', () => {
  const plan = discoveryPlan([
    { restaurantId: 'a', url: 'https://a.nl' },
    { restaurantId: 'b', url: '' },
    { restaurantId: 'c' },
  ]);
  assert.deepEqual(plan, { total: 3, websites: 3, aiSearches: 2 });
  assert.deepEqual(discoveryPlan([]), { total: 0, websites: 0, aiSearches: 0 });
  assert.deepEqual(discoveryPlan(null), { total: 0, websites: 0, aiSearches: 0 });
});

test('the running step list is the agreed line and a real percentage', () => {
  const plan = { total: 10, websites: 10, aiSearches: 2 };
  const half = discoverySteps({ plan, done: 4, aiDone: 1, osmDone: true });
  assert.equal(half.line, '🗺️ OpenStreetMap ✓ · 🌐 Websites 4 van 10 · 🤖 AI-zoeken 1 van 2');
  assert.equal(half.percent, 40);
  assert.equal(half.steps[0].state, 'done');
  assert.equal(half.steps[1].state, 'running');

  const busy = discoverySteps({ plan, done: 0, aiDone: 0, osmDone: false });
  assert.equal(busy.line, '🗺️ OpenStreetMap… · 🌐 Websites 0 van 10 · 🤖 AI-zoeken 0 van 2');
  assert.equal(busy.percent, 0);
  assert.equal(busy.steps[0].state, 'running');

  const done = discoverySteps({ plan, done: 10, aiDone: 2, osmDone: true });
  assert.equal(done.percent, 100);
  assert.equal(done.steps.every((step) => step.state === 'done'), true);
});

test('the step list never shows a number it cannot have', () => {
  const over = discoverySteps({ plan: { total: 2, websites: 2, aiSearches: 1 }, done: 5, aiDone: 3, osmDone: true });
  assert.match(over.line, /Websites 2 van 2/);
  assert.match(over.line, /AI-zoeken 3 van 3/);
  assert.equal(over.percent, 100);

  const empty = discoverySteps({ plan: { total: 0, websites: 0, aiSearches: 0 }, done: 0 });
  assert.equal(empty.percent, 0);
  assert.equal(empty.steps[2].state, 'skip');
});

test('AI searches are counted from the engine\'s own layers', () => {
  const results = [
    { layers: [{ key: 'osm', outcome: 'hit' }, { key: 'ai_search', outcome: 'skipped', detail: 'website_known' }] },
    { layers: [{ key: 'ai_search', outcome: 'hit' }] },
    { layers: [{ key: 'ai_search', outcome: 'rejected' }] },
    { layers: [{ key: 'ai_search', outcome: 'skipped', detail: 'ai_not_configured' }] },
    { layers: [] },
  ];
  assert.equal(countAiSearches(results), 2);
  assert.equal(countAiSearches(null), 0);
});

test('afterwards the time is named', () => {
  const label = updatedLabel(new Date(2026, 9, 27, 14, 5));
  assert.match(label, /^Bijgewerkt om \d{2}[:.]05$/);
  assert.equal(updatedLabel(null), null);
  assert.equal(updatedLabel('not a date'), null);
});

test('a failure names "duurde te lang" or "server bezet" in plain language', () => {
  assert.equal(discoveryFailure({ timedOut: true }).reasonLabel, 'duurde te lang');
  assert.match(discoveryFailure({ timedOut: true }).message, /duurde te lang/);
  assert.equal(discoveryFailure({ status: 504 }).reasonLabel, 'server bezet');
  assert.equal(discoveryFailure({ status: 502 }).message, 'De server is even bezet.');
  assert.equal(discoveryFailure({ status: 429 }).reasonLabel, 'te veel gevraagd');
  const denied = discoveryFailure({ status: 403 });
  assert.equal(denied.retryLabel, null);
  // The server's own Dutch message is used as it is.
  assert.equal(discoveryFailure({ status: 400, error: 'Kies minstens één bekend restaurant.' }).message, 'Kies minstens één bekend restaurant.');
  assert.equal(discoveryFailure({}).message, 'Het zoeken lukte niet.');
  assert.equal(discoveryFailure({}).retryLabel, RETRY_LABEL);
});
