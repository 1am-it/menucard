#!/usr/bin/env node
'use strict';

// One-time verification capture of the Bardot card bytes (#59 Delivery Lead
// order 6347355753, K1). The existing card capture pinned URL, content type,
// size and SHA-256 for three Bardot URLs but stored no bytes, so a controlled
// reference cannot be authored from them yet. This tool reads exactly those
// three pinned URLs once through the existing safe route (robots and redirect
// checks), recomputes the SHA-256 and keeps the bytes only when they are
// identical to the pinned hash. A different hash is a source change, recorded
// honestly and stored nowhere; the pinned version then simply has no
// reference.
//
// Usage:
//   node ops/scripts/verify-menu-extraction-card-reference-bytes.js
//
// Output: ops/benchmark/card-reference-captures.json (create-only) plus the
// verified bytes under the gitignored ops/benchmark/output/card-captures/.
// A second run is refused: this is one attempt, not a re-pin loop.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { fetchWebsiteSafely } = require('../../src/lib/safeOutboundFetch');
const { assertApprovedHost, repositoryTextSha256 } = require('../benchmark/holdoutManifest');
const {
  LOCAL_CAPTURE_PREFIX,
  validateCardReferenceCapturePin,
} = require('../benchmark/cardReferenceCaptures');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CARD_REFERENCES_PATH = path.join(REPO_ROOT, 'ops', 'benchmark', 'existing-card-references.json');
const OUT_PATH = path.join(REPO_ROOT, 'ops', 'benchmark', 'card-reference-captures.json');
const SOURCE_ID = 'bardot';
const MAX_BYTES = 15 * 1024 * 1024;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function relative(file) {
  return path.relative(REPO_ROOT, file).split(path.sep).join('/');
}

function extensionFor(contentType, kind) {
  if (kind === 'pdf') return 'pdf';
  return contentType === 'text/html' ? 'html' : 'bin';
}

async function verifyOne(capture, index, allowedHosts, verifiedAt) {
  const pinned = capture.bytesSha256;
  try {
    assertApprovedHost(capture.url, allowedHosts);
    const fetched = await fetchWebsiteSafely(capture.url, { encoding: 'buffer', maxBytes: MAX_BYTES, timeoutMs: 20000 });
    assertApprovedHost(fetched.finalUrl, allowedHosts);
    const bytes = fetched.bytes;
    const digest = sha256(bytes);
    const contentType = fetched.contentType || 'unknown';
    const kind = contentType === 'application/pdf'
      ? 'pdf'
      : (contentType === 'text/html' || contentType === 'application/xhtml+xml' ? 'html' : 'unsupported');
    if (digest !== pinned) {
      return {
        requestedUrl: capture.url,
        finalUrl: fetched.finalUrl,
        contentType,
        kind,
        status: 'source-changed',
        observedBytes: bytes.length,
        observedBytesSha256: digest,
        pinnedBytes: capture.bytes,
        pinnedBytesSha256: pinned,
        verifiedAt,
        error: 'source-changed',
        note: 'The source now returns different bytes than the pinned card capture. That is a source change, not a correction, so no reference is authored from it.',
      };
    }
    const localPath = `${LOCAL_CAPTURE_PREFIX}${SOURCE_ID}/${String(index + 1).padStart(2, '0')}-${kind}-${digest.slice(0, 12)}.${extensionFor(contentType, kind)}`;
    const target = path.join(REPO_ROOT, localPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
    return {
      requestedUrl: capture.url,
      finalUrl: fetched.finalUrl,
      contentType,
      kind,
      status: 'verified',
      bytes: bytes.length,
      bytesSha256: digest,
      pinnedBytes: capture.bytes,
      pinnedBytesSha256: pinned,
      verifiedAt,
      localPath,
      note: 'Bytes are identical to the pinned card capture; only this hash-verified version may carry a reference.',
    };
  } catch (error) {
    return {
      requestedUrl: capture.url,
      finalUrl: null,
      contentType: null,
      kind: 'unsupported',
      status: 'blocked',
      observedBytes: 0,
      pinnedBytes: capture.bytes,
      pinnedBytesSha256: pinned,
      verifiedAt,
      httpStatus: error && Number.isInteger(error.statusCode) ? error.statusCode : null,
      error: (error && error.reason) || (error && error.message) || 'fetch_failed',
      note: 'The pinned URL was not readable through the safe route. No alternative URL, other location or bypass was substituted.',
    };
  }
}

async function main() {
  if (fs.existsSync(OUT_PATH)) {
    throw new Error(`verification refused: ${relative(OUT_PATH)} already exists; the card bytes are verified once, not re-pinned`);
  }
  const cardBytes = fs.readFileSync(CARD_REFERENCES_PATH);
  const cardReferences = JSON.parse(cardBytes.toString('utf8'));
  const cardSource = cardReferences.sources[SOURCE_ID];
  if (!cardSource) throw new Error(`verification refused: ${SOURCE_ID} is not a pinned card source`);
  const pinnedCaptures = (cardSource.captures || []).filter((capture) => capture.captureStatus === 'captured');
  if (pinnedCaptures.length === 0) throw new Error(`verification refused: ${SOURCE_ID} has no captured URLs`);

  const verifiedAt = new Date().toISOString();
  const captures = [];
  for (const [index, capture] of pinnedCaptures.entries()) {
    captures.push(await verifyOne(capture, index, cardSource.allowedHosts, verifiedAt));
  }

  const verifiedCaptures = captures.filter((capture) => capture.status === 'verified');
  const changed = captures.filter((capture) => capture.status === 'source-changed');
  const blocked = captures.filter((capture) => capture.status === 'blocked');
  const captureStatus = verifiedCaptures.length === captures.length
    ? 'verified'
    : (verifiedCaptures.length > 0
      ? 'partially-verified'
      : (changed.length > 0 ? 'source-changed' : 'blocked'));
  const pin = {
    version: '1.0.0',
    issue: 59,
    sourceId: SOURCE_ID,
    label: cardSource.label,
    verifiedAt,
    oneShot: true,
    captureStatus,
    verification: 'One read-only attempt per pinned card URL through the existing safe fetch (robots and redirect checks). Bytes are kept only when the recomputed SHA-256 equals the hash in ops/benchmark/existing-card-references.json; a different hash is recorded as a source change without bytes.',
    authorization: cardReferences.authorization,
    pinnedCardCapture: {
      path: relative(CARD_REFERENCES_PATH),
      bytesSha256: repositoryTextSha256(cardBytes),
    },
    captures,
  };
  if (captureStatus === 'partially-verified') {
    pin.verifiedCaptures = verifiedCaptures.length;
    pin.sourceChangedCaptures = changed.length;
    pin.partialReason = `${changed.length} pinned HTML page(s) return different bytes than the pinned capture; only the hash-verified PDF is used as a reference source`;
  } else if (captureStatus === 'source-changed') {
    pin.observedBytesSha256 = changed[0].observedBytesSha256;
    pin.blockedReason = 'the source no longer returns the pinned card bytes';
  } else if (captureStatus === 'blocked') {
    pin.blockedReason = blocked.map((capture) => `${capture.requestedUrl}: ${capture.error}`).join('; ');
  }

  const check = validateCardReferenceCapturePin(pin, { ...cardSource, captureSourceId: SOURCE_ID }, pin.pinnedCardCapture.bytesSha256);
  if (!check.ok) throw new Error(`verification pin is invalid: ${check.errors.join('; ')}`);

  fs.writeFileSync(OUT_PATH, `${JSON.stringify(pin, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${relative(OUT_PATH)}: ${captureStatus}\n`);
  for (const capture of captures) {
    const hash = capture.bytesSha256 || capture.observedBytesSha256 || capture.error;
    process.stdout.write(`  ${capture.status}\t${capture.requestedUrl}\t${hash}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error && error.message ? error.message : 'card byte verification failed'}\n`);
  process.exitCode = 1;
});
