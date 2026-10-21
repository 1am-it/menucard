'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  captureLookupKey,
  classifyCaptureKind,
  createOfflineCandidateFetcher,
  validateCaptureMetadata,
  validateReferenceCaptureManifest,
} = require('./referenceCaptureSources');
const manifest = require('./reference-capture-sources.json');
const metadata = require('./reference-captures.json');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('the five-source manifest pins exactly the approved hosts and no app provider', () => {
  assert.deepEqual(validateReferenceCaptureManifest(manifest), { ok: true, errors: [] });
  assert.equal(manifest.authorization.appProviderActivation, false);

  const wrongCount = clone(manifest);
  wrongCount.sources.pop();
  assert.equal(validateReferenceCaptureManifest(wrongCount).ok, false);

  const provider = clone(manifest);
  provider.authorization.appProviderActivation = true;
  assert.match(validateReferenceCaptureManifest(provider).errors.join(' '), /provider activation/);

  const foreignHost = clone(manifest);
  foreignHost.sources[0].entryUrl = 'https://example.invalid';
  assert.match(validateReferenceCaptureManifest(foreignHost).errors.join(' '), /allowedHosts/);

  const duplicate = clone(manifest);
  duplicate.sources[1].id = duplicate.sources[0].id;
  assert.match(validateReferenceCaptureManifest(duplicate).errors.join(' '), /duplicate id/);
});

test('committed capture metadata is internally consistent and points into the gitignored folder', () => {
  const result = validateCaptureMetadata(metadata, manifest);
  assert.deepEqual(result, { ok: true, errors: [] });
  for (const source of Object.values(metadata.sources)) {
    for (const capture of source.captures) {
      if (capture.captureStatus === 'captured') {
        assert.match(capture.bytesSha256, /^[0-9a-f]{64}$/);
        assert.ok(capture.localPath.startsWith('ops/benchmark/output/reference-captures/'));
      }
    }
  }
});

test('content type classification is closed and honest', () => {
  assert.equal(classifyCaptureKind('text/html; charset=UTF-8'), 'html');
  assert.equal(classifyCaptureKind('application/xhtml+xml'), 'html');
  assert.equal(classifyCaptureKind('application/pdf'), 'pdf');
  assert.equal(classifyCaptureKind('image/png'), 'unsupported');
  assert.equal(classifyCaptureKind(undefined), 'unsupported');
});

test('the offline fetcher serves only pinned bytes and reports a missing page', () => {
  const html = Buffer.from('<html><body>Kaart</body></html>');
  const pdf = Buffer.from('%PDF-1.4');
  const captures = [
    { captureStatus: 'captured', kind: 'html', requestedUrl: 'https://example.invalid/menu', finalUrl: 'https://www.example.invalid/menu/', bytesBuffer: html },
    { captureStatus: 'captured', kind: 'pdf', requestedUrl: 'https://example.invalid/menu.pdf', finalUrl: 'https://example.invalid/menu.pdf', bytesBuffer: pdf },
    { captureStatus: 'blocked', kind: 'html', requestedUrl: 'https://example.invalid/blocked' },
  ];
  const { fetchCandidate, missing } = createOfflineCandidateFetcher(captures);

  const page = fetchCandidate('https://example.invalid/menu');
  assert.equal(page.status, 'html');
  assert.match(page.body, /Kaart/);
  assert.equal(page.finalUrl, 'https://www.example.invalid/menu/');

  assert.equal(fetchCandidate('https://example.invalid/menu.pdf').status, 'pdf');
  assert.equal(fetchCandidate('https://example.invalid/blocked').status, 'error');
  assert.equal(fetchCandidate('https://example.invalid/not-pinned').status, 'error');
  assert.deepEqual(missing, ['https://example.invalid/blocked', 'https://example.invalid/not-pinned']);
  assert.equal(captureLookupKey('https://www.example.invalid/menu/'), captureLookupKey('https://example.invalid/menu'));
});
