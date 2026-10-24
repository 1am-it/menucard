'use strict';

// Regression for the criterion-5 card pin rules (#59 order 6347355753, K1): a
// reference may only use bytes whose SHA-256 equals the hash in the committed
// card capture, a new URL is refused, and a different hash is a source change.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const pin = require('./card-reference-captures.json');
const cardReferences = require('./existing-card-references.json');
const { repositoryTextSha256 } = require('./holdoutManifest');
const {
  pinnedHash,
  pinnedUrlSet,
  validateCardReferenceCapturePin,
} = require('./cardReferenceCaptures');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CARD_CAPTURE = path.join(REPO_ROOT, 'ops', 'benchmark', 'existing-card-references.json');

function cardSource(id) {
  return { ...cardReferences.sources[id], captureSourceId: id };
}

function cardCaptureSha256() {
  return repositoryTextSha256(fs.readFileSync(CARD_CAPTURE));
}

function clonePin() {
  return JSON.parse(JSON.stringify(pin));
}

function expectError(mutate, pattern) {
  const candidate = clonePin();
  mutate(candidate);
  const result = validateCardReferenceCapturePin(candidate, cardSource('bardot'), cardCaptureSha256());
  assert.equal(result.ok, false, 'the pin must be refused');
  assert.ok(result.errors.some((error) => pattern.test(error)), `expected /${pattern.source}/ in: ${result.errors.join('; ')}`);
}

test('the committed Bardot pin is valid and only uses the pinned card URLs', () => {
  const source = cardSource('bardot');
  const result = validateCardReferenceCapturePin(pin, source, cardCaptureSha256());
  assert.deepEqual(result.errors, []);
  assert.equal(pin.captureStatus, 'partially-verified');
  assert.equal(pin.oneShot, true);
  assert.equal(pin.authorization.appProviderActivation, false);
  const allowed = pinnedUrlSet(source);
  for (const capture of pin.captures) assert.ok(allowed.has(capture.requestedUrl), capture.requestedUrl);
  const verified = pin.captures.filter((capture) => capture.status === 'verified');
  assert.equal(verified.length, 1, 'exactly the dinerkaart PDF matched the pinned hash');
  assert.equal(verified[0].kind, 'pdf');
  assert.equal(verified[0].bytesSha256, pinnedHash(source, verified[0].requestedUrl));
});

test('a capture whose hash differs from the card capture is a source change, not a reference source', () => {
  expectError((candidate) => {
    const capture = candidate.captures.find((entry) => entry.status === 'source-changed');
    capture.status = 'verified';
    capture.bytesSha256 = capture.observedBytesSha256;
    capture.pinnedBytesSha256 = capture.bytesSha256;
    capture.bytes = capture.observedBytes;
    capture.localPath = 'ops/benchmark/output/card-captures/bardot/01-html-fc058ebee25a.html';
  }, /only a capture with the pinned SHA-256/);
});

test('a URL that is not in the pinned card capture is refused', () => {
  expectError((candidate) => {
    candidate.captures[0].requestedUrl = 'https://www.brasseriebardot.nl/lunch';
  }, /is not one of the pinned card URLs/);
});

test('a source change must record the observed hash and stores no bytes', () => {
  expectError((candidate) => {
    const capture = candidate.captures.find((entry) => entry.status === 'source-changed');
    delete capture.observedBytesSha256;
  }, /a source change records the observed SHA-256/);
  expectError((candidate) => {
    const capture = candidate.captures.find((entry) => entry.status === 'source-changed');
    capture.localPath = 'ops/benchmark/output/card-captures/bardot/01-html.html';
  }, /a source change stores no reference bytes/);
});

test('a partially verified pin names what changed, and a fully verified pin has only matches', () => {
  expectError((candidate) => { delete candidate.partialReason; }, /a partially verified pin names what changed/);
  expectError((candidate) => {
    candidate.captureStatus = 'verified';
  }, /a verified source has only verified captures/);
});

test('the pin cannot drift from the card capture it verified, nor activate a provider', () => {
  expectError((candidate) => { candidate.pinnedCardCapture.bytesSha256 = 'a'.repeat(64); }, /the card capture changed after the verification/);
  expectError((candidate) => { candidate.authorization.appProviderActivation = true; }, /app provider activation must remain false/);
  expectError((candidate) => { candidate.oneShot = false; }, /oneShot must be true/);
  expectError((candidate) => { candidate.sourceId = 'somewhere-else'; }, /sourceId must be one of the four pinned card sources/);
});
