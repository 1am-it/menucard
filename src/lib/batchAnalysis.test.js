'use strict';

// BE-25 fase 2 — pure Batchanalyse logic: pre-check, status per URL, the
// conservative high-certainty rule and the summary.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_BATCH_URLS,
  COPY,
  ACTION_LABELS,
  precheckLines,
  menuSourceUrls,
  deriveItemView,
  summarizeItems,
  amsterdamDayStart,
} = require('./batchAnalysis');

const RESTAURANTS = {
  bistro: { name: 'Bistro Voorbeeld', website: 'https://www.bistro-voorbeeld.example' },
  grand: { name: 'Grand Café Test', website: 'https://grandcafe-test.example/' },
};
const NOW = new Date('2026-10-10T12:00:00Z');
const item = (extra) => ({ item_position: 1, canonical_source_url: 'https://bistro-voorbeeld.example/', outcome: 'queued', job_id: 'j1', reused_job_id: null, ...extra });
const job = (extra) => ({ id: 'j1', status: 'succeeded', attempt_count: 1, finished_at: '2026-10-10T11:00:00Z', result_receipt_id: 'r1', unknown_menu_contexts: [], menu_source_urls: ['https://bistro-voorbeeld.example/menukaart.pdf'], ...extra });
const menus = [{ categories: [{ items: [{ name: 'Soep' }] }] }];
const receipt = (extra) => ({ id: 'r1', restaurant_match_type: 'exact', matched_restaurant_id: 'bistro', menus, ...extra });
const derive = (extra) => deriveItemView({ item: item(), job: job(), receipt: receipt(), restaurants: RESTAURANTS, proposals: [], now: NOW, ...extra });

test('pre-check: canonical URLs, invalid lines and duplicates are reported per line; more than 10 is flagged, never cut', () => {
  const result = precheckLines('https://a.example\n\n  https://a.example/  \nhttps:/b\nhttps://c.example/menu?x=1#y\nwww.d.example');
  assert.deepEqual(result.entries.map((e) => e.status), ['ok', 'duplicate', 'invalid', 'ok', 'invalid']);
  assert.equal(result.entries[1].duplicateOf, 1);
  assert.equal(result.entries[3].url, 'https://c.example/menu');
  assert.equal(result.queueableCount, 2);
  const many = Array.from({ length: MAX_BATCH_URLS + 1 }, (_, i) => `https://r${i}.example`).join('\n');
  assert.equal(precheckLines(many).tooMany, true);
  assert.equal(precheckLines(many).entries.length, MAX_BATCH_URLS + 1);
});

test('high certainty: known restaurant, recognised items, menu on the restaurant\'s own host → "Bevestig bron"', () => {
  const v = derive();
  assert.equal(v.label, 'Menukaart gevonden · controle nodig');
  assert.equal(v.role, 'file');
  assert.equal(v.high, true);
  assert.equal(v.foundUrl, 'https://bistro-voorbeeld.example/menukaart.pdf');
  assert.deepEqual(v.actions, ['confirm']);
  assert.equal(ACTION_LABELS.confirm, 'Bevestig bron');
});

test('conservative rule: another host, a subdomain, the already-known source or an unknown menu source go to "Beoordeel handmatig"', () => {
  for (const urls of [['https://other.example/menu'], ['https://menu.bistro-voorbeeld.example/kaart'], ['https://www.bistro-voorbeeld.example/'], []]) {
    const v = derive({ job: job({ menu_source_urls: urls }) });
    assert.equal(v.label, 'Controle nodig', JSON.stringify(urls));
    assert.equal(v.role, 'old');
    assert.equal(v.high, false);
    assert.deepEqual(v.actions, ['review_manually']);
  }
});

test('doubt, robots.txt and no usable menu → "Beoordeel handmatig"; "Robots geblokkeerd" is blocked with a lock', () => {
  const structure = derive({ receipt: receipt({ menus: [{ categories: [] }] }) });
  assert.equal(structure.label, 'Controle nodig');
  assert.deepEqual(structure.actions, ['review_manually']);

  const robots = derive({ job: job({ status: 'failed', error_reason: 'robots_disallowed', result_receipt_id: null }), receipt: null });
  assert.equal(robots.label, 'Robots geblokkeerd');
  assert.equal(robots.role, 'blocked');
  assert.equal(robots.icon, 'lock');
  assert.deepEqual(robots.actions, ['review_manually']);

  const none = derive({ receipt: receipt({ menus: [] }) });
  assert.equal(none.label, 'Geen bruikbare menukaart gevonden');
  assert.match(none.text, /Dat betekent niet dat het restaurant geen menukaart heeft\./);
  assert.deepEqual(none.actions, ['review_manually']);
  assert.ok(!none.actions.includes('retry'));
});

test('"Opnieuw proberen" only for a technical failure or an expired job; an invalid URL gets "URL aanpassen"', () => {
  const failed = derive({ job: job({ status: 'failed', error_reason: 'fetch_failed', attempt_count: 5, result_receipt_id: null }), receipt: null });
  assert.equal(failed.label, 'Fout');
  assert.deepEqual(failed.actions, ['retry']);
  const expired = derive({ job: job({ status: 'pending', expired_at: '2026-10-10T10:00:00Z', result_receipt_id: null }), receipt: null });
  assert.equal(expired.label, 'Fout');
  assert.deepEqual(expired.actions, ['retry']);
  const unsafe = derive({ job: job({ status: 'failed', error_reason: 'unsafe_url', result_receipt_id: null }), receipt: null });
  assert.equal(unsafe.label, 'Ongeldige URL');
  assert.deepEqual(unsafe.actions, ['adjust_url']);
  const invalid = deriveItemView({ item: item({ outcome: 'invalid', canonical_source_url: null, job_id: null }), job: null, receipt: null, restaurants: RESTAURANTS, now: NOW });
  assert.deepEqual(invalid.actions, ['adjust_url']);
  for (const v of [failed, expired, unsafe, invalid]) assert.ok(!v.actions.includes('reanalyze'));
});

test('unknown restaurant → "Naar Onboarding Restaurant"; several matches → "Beoordeel handmatig"', () => {
  const unknown = derive({ receipt: receipt({ restaurant_match_type: 'none', matched_restaurant_id: null }) });
  assert.deepEqual(unknown.actions, ['onboarding']);
  assert.equal(unknown.high, false);
  const multiple = derive({ receipt: receipt({ restaurant_match_type: 'multiple', matched_restaurant_id: null }) });
  assert.deepEqual(multiple.actions, ['review_manually']);
});

test('queue states: "In wachtrij" with the next attempt, "Bezig" while running', () => {
  const later = derive({ job: job({ status: 'pending', attempt_count: 2, next_attempt_at: '2026-10-10T12:10:00Z', result_receipt_id: null }), receipt: null, formatTime: () => '14:10' });
  assert.equal(later.label, 'In wachtrij');
  assert.equal(later.text, 'Nieuwe poging om 14:10 · poging 2 van 5.');
  assert.equal(later.terminal, false);
  const running = derive({ job: job({ status: 'running', result_receipt_id: null }), receipt: null });
  assert.equal(running.label, 'Bezig');
  assert.equal(running.terminal, false);
});

test('recent: shown as "Recent geanalyseerd" with "Opnieuw analyseren", plus "Bevestig bron" only for a high-certainty earlier result', () => {
  const recent = derive({ item: item({ outcome: 'recent', job_id: null, reused_job_id: 'j1' }), job: job({ finished_at: '2026-10-07T12:00:00Z' }) });
  assert.equal(recent.label, 'Recent geanalyseerd');
  assert.deepEqual(recent.actions, ['confirm', 'reanalyze']);
  assert.match(recent.text, /3 dagen geleden/);
  const doubtful = derive({ item: item({ outcome: 'recent', job_id: null, reused_job_id: 'j1' }), job: job({ menu_source_urls: [] }) });
  assert.deepEqual(doubtful.actions, ['reanalyze']);
});

test('an accepted BE-24 proposal for the found URL shows "Bron bevestigd" without naming the person', () => {
  const proposals = [{ status: 'accepted', restaurant_id: 'bistro', proposed_url: 'https://bistro-voorbeeld.example/menukaart.pdf', decided_at: '2026-10-10T11:30:00Z', decided_by: 'someone' }];
  const v = derive({ proposals, formatTime: () => '13:30' });
  assert.equal(v.label, 'Bron bevestigd');
  assert.equal(v.role, 'positive');
  assert.equal(v.text, COPY.confirmedText('13:30'));
  assert.equal(v.text, 'Bevestigd om 13:30 na menselijke controle. Er is niets gepubliceerd.');
  assert.deepEqual(v.actions, []);
  assert.doesNotMatch(JSON.stringify(v), /someone/);
  // An older acceptance (before this result) does not count.
  assert.equal(derive({ proposals: [{ ...proposals[0], decided_at: '2026-10-01T00:00:00Z' }] }).label, 'Menukaart gevonden · controle nodig');
});

test('pre-batch outcomes: duplicate and already active are explained, without actions', () => {
  const dup = deriveItemView({ item: item({ outcome: 'duplicate', job_id: null }), duplicateOf: 2, restaurants: RESTAURANTS, now: NOW });
  assert.equal(dup.text, 'Zelfde adres als regel 2; wordt één keer geanalyseerd.');
  const active = deriveItemView({ item: item({ outcome: 'already_active', job_id: null }), restaurants: RESTAURANTS, now: NOW });
  assert.equal(active.text, 'Deze URL staat al in een actieve analysebatch.');
  assert.deepEqual(active.actions, []);
});

test('summary: progress counts terminal results; duplicates are not counted twice; per next step', () => {
  const views = [derive(), derive({ job: job({ status: 'running' }) }), deriveItemView({ item: item({ outcome: 'duplicate' }), restaurants: RESTAURANTS, now: NOW })];
  const s = summarizeItems(views);
  assert.equal(s.total, 2);
  assert.equal(s.done, 1);
  assert.equal(s.running, 1);
  assert.equal(s.highCertainty, 1);
  assert.deepEqual(s.byAction, { confirm: 1 });
});

test('menu source URLs: only menus with recognised items, canonical, deduplicated', () => {
  const urls = menuSourceUrls({
    menuContexts: [
      { sourceUrl: 'https://a.example/menu?x=1', categories: [{ items: [{ name: 'x' }] }] },
      { sourceUrl: 'https://a.example/empty', categories: [{ items: [] }] },
    ],
    unknownMenuContexts: [
      { sourceUrl: 'https://a.example/kaart.pdf', recognizedSections: [{ items: [{ name: 'y' }] }] },
      { sourceUrl: 'https://a.example/menu', recognizedSections: [{ items: [{ name: 'z' }] }] },
    ],
  });
  assert.deepEqual(urls, ['https://a.example/menu', 'https://a.example/kaart.pdf']);
});

test('daily limit day starts at midnight Europe/Amsterdam, summer and winter time', () => {
  assert.equal(amsterdamDayStart('2026-10-10T11:00:00Z'), '2026-10-09T22:00:00.000Z');
  assert.equal(amsterdamDayStart('2026-01-15T23:30:00Z'), '2026-01-15T23:00:00.000Z');
  assert.equal(amsterdamDayStart('2026-03-29T12:00:00Z'), '2026-03-28T23:00:00.000Z');
});

test('fixed copy is verbatim and never says the screen may be closed', () => {
  assert.equal(COPY.keepOpen, 'Houd dit scherm open. Sluit je het, dan pauzeert de analyse en gaat hij verder zodra je terugkomt.');
  assert.equal(COPY.nothingPublished, 'Niets wordt automatisch gepubliceerd.');
  assert.doesNotMatch(JSON.stringify(COPY), /gerust verlaten|mag (je )?sluiten/i);
});
