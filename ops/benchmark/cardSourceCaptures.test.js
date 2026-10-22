'use strict';

// Regression for the two remaining criterion-5 card captures (#59 Delivery Lead
// order review 6349832755, K1). The pins may only name the pinned entry URL, the
// menu URLs the historical export names, the pinned probe URLs and same-host
// menu links the captured entry page itself named. A readable page that is not
// a menu and an unreadable page each keep their own honest state.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const cardReferences = require('./existing-card-references.json');
const cardSources = require('./existing-card-sources.json');
const wolfslaarPin = require('./card-reference-captures.wolfslaar.json');
const thuisPin = require('./card-reference-captures.thuis.json');
const { repositoryTextSha256 } = require('./holdoutManifest');
const {
  cardCaptureSeeds,
  cardSourcePinPath,
  historicalUrlsOf,
  looksLikeMaintenance,
  pageKey,
  decimalAmountCount,
  REATTEMPT_SOURCE_IDS,
  validateCardSourceCapturePin,
} = require('./cardSourceCaptures');
const { htmlVisibleText } = require('./referenceIntegrity');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CARD_CAPTURE = path.join(REPO_ROOT, 'ops', 'benchmark', 'existing-card-references.json');
const PINS = { wolfslaar: wolfslaarPin, thuis: thuisPin };

function source(id) {
  return (cardSources.sources || []).find((candidate) => candidate.id === id);
}

function cardCaptureSha256() {
  return repositoryTextSha256(fs.readFileSync(CARD_CAPTURE));
}

function validate(pin, id) {
  return validateCardSourceCapturePin(pin, source(id), {
    historicalUrls: historicalUrlsOf(cardReferences, id),
    cardCaptureSha256: cardCaptureSha256(),
  });
}

function clone(pin) {
  return JSON.parse(JSON.stringify(pin));
}

function expectError(id, mutate, pattern) {
  const candidate = clone(PINS[id]);
  mutate(candidate);
  const result = validate(candidate, id);
  assert.equal(result.ok, false, 'the pin must be refused');
  assert.ok(result.errors.some((error) => pattern.test(error)), `expected /${pattern.source}/ in: ${result.errors.join('; ')}`);
}

for (const id of REATTEMPT_SOURCE_IDS) {
  test(`the committed ${id} pin is valid and only names pinned or self-named URLs`, () => {
    const pin = PINS[id];
    assert.deepEqual(validate(pin, id).errors, []);
    assert.equal(pin.oneShot, true);
    assert.equal(pin.authorization.appProviderActivation, false);
    assert.equal(pin.sourceId, id);
    assert.equal(pin.entryUrl, source(id).entryUrl);
    assert.equal(pin.previousCardCapture.previousCaptureStatus, 'failed');
    assert.equal(cardSourcePinPath(id), `ops/benchmark/card-reference-captures.${id}.json`);
    const seeds = new Set(pin.seeds.map((seed) => seed.url));
    for (const capture of pin.captures) {
      const selfNamed = capture.discovery === 'same-host-menu-link' && Boolean(capture.discoveredFrom);
      assert.ok(seeds.has(capture.requestedUrl) || selfNamed, capture.requestedUrl);
      if (capture.status === 'blocked') {
        assert.equal(capture.localPath, null);
        assert.ok(capture.error, `${capture.requestedUrl}: blocked names its reason`);
      } else {
        assert.match(capture.bytesSha256, /^[0-9a-f]{64}$/);
        assert.ok(capture.localPath.startsWith('ops/benchmark/output/card-captures/'));
        assert.ok(capture.contentType);
      }
    }
    const entry = pin.captures.filter((capture) => capture.role === 'entry');
    assert.equal(entry.length, 1, 'exactly one entry capture');
    assert.equal(entry[0].requestedUrl, pin.entryUrl);
  });
}

test('the pinned source bytes still match the recorded hash and size when present', () => {
  for (const id of REATTEMPT_SOURCE_IDS) {
    for (const capture of PINS[id].captures) {
      if (capture.status === 'blocked') continue;
      const file = path.join(REPO_ROOT, capture.localPath);
      if (!fs.existsSync(file)) continue; // the bytes are gitignored; a fresh clone has the hashes only
      const bytes = fs.readFileSync(file);
      assert.equal(bytes.length, capture.bytes, `${capture.requestedUrl}: size`);
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), capture.bytesSha256, `${capture.requestedUrl}: hash`);
    }
  }
});

test('a URL outside the pinned seed set is refused', () => {
  expectError('wolfslaar', (candidate) => {
    candidate.captures[1].requestedUrl = 'https://www.restaurantwolfslaar.com/nl/menu-wijn';
  }, /is not a pinned seed URL or a menu link the entry page itself named/);
  expectError('thuis', (candidate) => {
    candidate.captures[1].requestedUrl = 'https://t-huis.online/wp-content/uploads/2026/09/THS-Diner_Herfst-2026.2_DIGI.svg';
  }, /is not a pinned seed URL or a menu link the entry page itself named/);
});

test('a same-host menu link needs the captured entry page that named it', () => {
  expectError('wolfslaar', (candidate) => {
    const capture = candidate.captures.find((entry) => entry.discovery === 'same-host-menu-link');
    capture.discoveredFrom = null;
  }, /is not a pinned seed URL or a menu link/);
  expectError('wolfslaar', (candidate) => {
    const capture = candidate.captures.find((entry) => entry.discovery === 'same-host-menu-link');
    capture.discovery = 'crawl';
  }, /discovery is invalid/);
});

test('a historical seed must be a URL the export names and there is one entry seed', () => {
  expectError('thuis', (candidate) => {
    candidate.seeds[1].url = 'https://t-huis.online/over-ons/';
  }, /is not a menu URL the historical export names/);
  expectError('thuis', (candidate) => {
    candidate.seeds.push({ url: candidate.seeds[0].url, origin: 'entry' });
  }, /exactly one entry seed is required/);
});

test('a not-a-menu page names its reason and a blocked page stores no bytes', () => {
  expectError('thuis', (candidate) => {
    candidate.captures[1].status = 'blocked';
    candidate.captures[1].error = null;
  }, /a blocked capture names its reason/);
  expectError('thuis', (candidate) => {
    candidate.captures[1].status = 'not-a-menu';
    candidate.captures[1].reason = null;
  }, /a not-a-menu page names its reason/);
  expectError('thuis', (candidate) => {
    candidate.captures[1].status = 'not-a-menu';
    candidate.captures[1].reason = 'geen menu';
    candidate.captures[1].localPath = null;
  }, /bytes must point inside the gitignored card capture folder/);
});

test('a captured source needs a readable menu capture and a readable entry page', () => {
  expectError('wolfslaar', (candidate) => {
    for (const capture of candidate.captures) {
      if (capture.role === 'menu') {
        capture.status = 'not-a-menu';
        capture.reason = 'geen menu';
      }
    }
  }, /a captured source needs at least one readable menu capture/);
  expectError('wolfslaar', (candidate) => {
    candidate.captures[0].status = 'blocked';
    candidate.captures[0].error = 'request-error';
    candidate.captures[0].localPath = null;
  }, /exactly one readable entry capture is required/);
  expectError('wolfslaar', (candidate) => { candidate.oneShot = false; }, /oneShot must be true/);
  expectError('wolfslaar', (candidate) => { candidate.authorization.appProviderActivation = true; }, /app provider activation must remain false/);
});

test('the pin cannot drift from the card capture it replaces, and only these two sources may be pinned', () => {
  expectError('wolfslaar', (candidate) => { candidate.previousCardCapture.bytesSha256 = 'a'.repeat(64); }, /cannot drift from the card capture it replaces/);
  expectError('wolfslaar', (candidate) => { candidate.previousCardCapture.previousCaptureStatus = 'captured'; }, /previous card capture must be recorded as failed/);
  expectError('wolfslaar', (candidate) => { candidate.sourceId = 'zuyd'; }, /sourceId must be wolfslaar or thuis/);
});

test('the seed plan keeps the entry first and the historical URLs stable', () => {
  assert.deepEqual(cardCaptureSeeds(source('wolfslaar'), cardReferences).map((seed) => seed.url), [
    'https://www.restaurantwolfslaar.com',
    'https://www.restaurantwolfslaar.com/nl/menu-lunch',
    'https://www.restaurantwolfslaar.com/nl/menu-diner',
  ]);
  assert.deepEqual(cardCaptureSeeds(source('thuis'), cardReferences).map((seed) => seed.origin), ['entry', 'historical']);
  assert.equal(pageKey('https://www.t-huis.online/menu/'), pageKey('https://t-huis.online/menu'));
});

test('a fully blocked source is representable, and keeps its own entry error', () => {
  const blocked = clone(PINS.thuis);
  for (const capture of blocked.captures) {
    capture.status = 'blocked';
    capture.error = 'request-error: connect ENETUNREACH';
    capture.localPath = null;
    capture.bytes = 0;
    capture.bytesSha256 = null;
  }
  blocked.captureStatus = 'blocked';
  blocked.blockedReason = 'the entry page is not readable';
  assert.deepEqual(validate(blocked, 'thuis').errors, []);
  blocked.blockedReason = '';
  const result = validate(blocked, 'thuis');
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /a blocked source names its reason/.test(error)));
});

test('a maintenance page and a page without decimal amounts are recognised honestly', () => {
  assert.equal(looksLikeMaintenance('Deze website is in onderhoud. Probeer het later opnieuw.'), true);
  assert.equal(looksLikeMaintenance('Signature Menu Maarten Camps'), false);
  assert.equal(decimalAmountCount('Witte Heilbot 32 zeeuwse mossel'), 0, 'whole euros without decimals are not an amount proof');
  assert.equal(decimalAmountCount('Oesterproeverij - 6 stuks - 23,50'), 1);
});

