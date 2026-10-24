'use strict';

// Regression for the one honest re-attempt of the two blocked cards (#59 order
// 6347355753, K3). The attempt may only touch the pinned card URLs, must never
// claim a menu it did not read, and stays a single attempt.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const attempts = require('./existing-card-probe-attempts.json');
const cardReferences = require('./existing-card-references.json');
const { repositoryTextSha256 } = require('./holdoutManifest');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

test('the attempt covers exactly the two blocked cards and stays one shot', () => {
  assert.equal(attempts.oneShot, true);
  assert.deepEqual(attempts.sources.map((source) => source.id), ['wolfslaar', 'thuis']);
  assert.equal(attempts.authorization.appProviderActivation, false);
  const hash = repositoryTextSha256(fs.readFileSync(path.join(REPO_ROOT, attempts.cardCapture.path)));
  assert.equal(attempts.cardCapture.bytesSha256, hash, 'the attempt names the card capture it belongs to');
});

test('every attempt uses a pinned card URL on the allowed host and records a time', () => {
  for (const source of attempts.sources) {
    const pinned = new Set(cardReferences.sources[source.id].captures.map((capture) => capture.url));
    assert.ok(source.attempts.length > 0, `${source.id}: at least one attempt`);
    for (const attempt of source.attempts) {
      assert.ok(pinned.has(attempt.url), `${source.id}: ${attempt.url} is not a pinned card URL`);
      assert.ok(Array.isArray(source.allowedHosts) && source.allowedHosts.includes(new URL(attempt.url).hostname), `${source.id}: host`);
      assert.match(attempt.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, `${source.id}: time`);
      assert.ok(['readable', 'blocked'].includes(attempt.status), `${source.id}: status`);
      if (attempt.status === 'readable') {
        assert.ok(attempt.bytes > 0, `${source.id}: readable bytes`);
        assert.match(attempt.bytesSha256, /^[0-9a-f]{64}$/, `${source.id}: readable hash`);
        assert.equal(attempt.error, null);
      } else {
        assert.ok(attempt.error && attempt.error.trim(), `${source.id}: a blocked attempt names its reason`);
      }
    }
    const readable = source.attempts.some((attempt) => attempt.status === 'readable');
    assert.equal(source.outcome, readable ? 'readable' : 'blocked', `${source.id}: outcome matches the attempts`);
    assert.equal(source.blockingReason === null, readable, `${source.id}: blocking reason only when blocked`);
  }
});

test('a readable attempt is not reported as a read or extracted menu', () => {
  const serialized = JSON.stringify(attempts);
  assert.equal(/itemCount|dishes|extracted/.test(serialized), false, 'the attempt records reachability, never a menu result');
  assert.match(attempts.method, /no alternative URL, other location, crawl or bypass/i);
  for (const source of attempts.sources) {
    for (const attempt of source.attempts.filter((entry) => entry.status === 'readable')) {
      assert.match(attempt.note, /pins nothing/i);
    }
  }
});
