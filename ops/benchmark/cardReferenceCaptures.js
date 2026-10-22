'use strict';

// Pin rules for the criterion-5 existing-card reference (#59 Delivery Lead order
// 6347355753, K1). The four existing-card captures in
// `ops/benchmark/existing-card-references.json` recorded URL, content type, size
// and SHA-256 only: the bytes were never stored. A reference may only be
// authored from bytes whose SHA-256 equals the hash in that capture, so this
// module validates a separate one-time verification pin that stores the bytes
// locally (gitignored) and repeats the pinned hash next to the recomputed one.
//
// The rules are deliberately closed: a URL that is not in the pinned card
// capture is refused, a byte difference is a source change (never a correction)
// and a capture that cannot be read is recorded as blocked with its reason.
//
// Pure: no fetch, parser, provider, database or publication here.

const CARD_SOURCE_IDS = ['wolfslaar', 'bardot', 'zuyd', 'thuis'];
// `verified` = every pinned URL returned the pinned bytes; `partially-verified`
// = at least one pinned URL did (and only those may carry a reference);
// `source-changed` = none matched; `blocked` = not readable.
const CARD_VERIFICATION_STATES = ['verified', 'partially-verified', 'source-changed', 'blocked'];
const CAPTURE_KINDS = ['html', 'pdf', 'unsupported'];
const LOCAL_CAPTURE_PREFIX = 'ops/benchmark/output/card-captures/';

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSha256(value) {
  return /^[0-9a-f]{64}$/.test(String(value));
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** The URLs the pinned card capture itself names for one source. */
function pinnedUrlSet(cardSource) {
  const urls = new Set();
  for (const capture of (cardSource && Array.isArray(cardSource.captures) ? cardSource.captures : [])) {
    for (const value of [capture.url, capture.finalUrl]) {
      if (nonEmptyString(value)) urls.add(value);
    }
  }
  return urls;
}

/** The pinned SHA-256 of one URL in the card capture, or null. */
function pinnedHash(cardSource, url) {
  const captures = (cardSource && Array.isArray(cardSource.captures) ? cardSource.captures : []);
  for (const capture of captures) {
    if ((capture.url === url || capture.finalUrl === url) && isSha256(capture.bytesSha256)) return capture.bytesSha256;
  }
  return null;
}

/**
 * Validates one verification pin against the card capture it belongs to.
 * `cardCaptureSha256` is the SHA-256 of the committed
 * `existing-card-references.json` file, so the pin cannot drift away from the
 * version it verified.
 */
function validateCardReferenceCapturePin(pin, cardSource, cardCaptureSha256) {
  const errors = [];
  if (!pin || typeof pin !== 'object' || Array.isArray(pin)) {
    return { ok: false, errors: ['pin: not an object'] };
  }
  if (!nonEmptyString(pin.version)) errors.push('pin: version is required');
  if (!CARD_SOURCE_IDS.includes(pin.sourceId)) errors.push('pin: sourceId must be one of the four pinned card sources');
  if (!nonEmptyString(pin.verifiedAt)) errors.push('pin: verifiedAt is required');
  if (!nonEmptyString(pin.verification)) errors.push('pin: verification method is required');
  if (!pin.authorization || pin.authorization.appProviderActivation !== false) {
    errors.push('pin: app provider activation must remain false');
  }
  if (pin.oneShot !== true) errors.push('pin: oneShot must be true; a second verification attempt is refused');
  if (!pin.pinnedCardCapture || pin.pinnedCardCapture.path !== 'ops/benchmark/existing-card-references.json') {
    errors.push('pin: the pin must name the committed card capture it verified');
  } else if (!isSha256(pin.pinnedCardCapture.bytesSha256)) {
    errors.push('pin: the card capture needs a SHA-256');
  } else if (cardCaptureSha256 && pin.pinnedCardCapture.bytesSha256 !== cardCaptureSha256) {
    errors.push('pin: the card capture changed after the verification');
  }
  if (!CARD_VERIFICATION_STATES.includes(pin.captureStatus)) {
    errors.push('pin: captureStatus is invalid');
  }
  if (!cardSource || typeof cardSource !== 'object') {
    errors.push('pin: the pinned card source is missing');
    return { ok: errors.length === 0, errors };
  }
  if (pin.sourceId !== cardSource.captureSourceId) {
    errors.push(`pin: the card source is not ${pin.sourceId}`);
  }
  const allowed = pinnedUrlSet(cardSource);
  const captures = Array.isArray(pin.captures) ? pin.captures : [];
  const verifiedIndexes = captures.filter((capture) => capture && capture.status === 'verified');
  if (pin.captureStatus === 'verified') {
    const pinnedCaptures = (cardSource.captures || []).filter((capture) => capture.captureStatus === 'captured');
    if (captures.length !== pinnedCaptures.length) {
      errors.push(`pin: a verified source pins exactly the ${pinnedCaptures.length} captured card URLs`);
    }
    if (verifiedIndexes.length !== captures.length) {
      errors.push('pin: a verified source has only verified captures');
    }
  }
  if (pin.captureStatus === 'partially-verified') {
    if (verifiedIndexes.length === 0) errors.push('pin: partially verified needs at least one verified capture');
    if (verifiedIndexes.length === captures.length) errors.push('pin: all captures verified is a fully verified pin');
    if (!nonEmptyString(pin.partialReason)) errors.push('pin: a partially verified pin names what changed');
  }
  if (pin.captureStatus === 'source-changed' && verifiedIndexes.length > 0) {
    errors.push('pin: a source change has no verified capture');
  }
  if (captures.length === 0) errors.push('pin: at least one capture is required');
  for (const [index, capture] of captures.entries()) {
    const where = `capture #${index + 1}`;
    if (!capture || typeof capture !== 'object') {
      errors.push(`${where}: not an object`);
      continue;
    }
    if (!nonEmptyString(capture.requestedUrl) || !parseUrl(capture.requestedUrl)) {
      errors.push(`${where}: requestedUrl is invalid`);
    } else if (!allowed.has(capture.requestedUrl)) {
      errors.push(`${where}: ${capture.requestedUrl} is not one of the pinned card URLs`);
    }
    if (!CAPTURE_KINDS.includes(capture.kind)) errors.push(`${where}: kind is invalid`);
    if (!nonEmptyString(capture.verifiedAt)) errors.push(`${where}: verifiedAt is required`);
    if (capture.status === 'verified') {
      if (!isSha256(capture.bytesSha256)) errors.push(`${where}: a verified capture needs a SHA-256`);
      if (!Number.isInteger(capture.bytes) || capture.bytes <= 0) errors.push(`${where}: a verified capture needs a positive size`);
      if (!nonEmptyString(capture.localPath) || !capture.localPath.startsWith(LOCAL_CAPTURE_PREFIX)) {
        errors.push(`${where}: verified bytes must point inside the gitignored card capture folder`);
      }
      const pinned = pinnedHash(cardSource, capture.requestedUrl);
      if (!pinned) {
        errors.push(`${where}: the card capture has no hash for ${capture.requestedUrl}`);
      } else if (capture.bytesSha256 !== pinned || capture.pinnedBytesSha256 !== pinned) {
        errors.push(`${where}: only a capture with the pinned SHA-256 may be used as a reference source`);
      }
    } else if (capture.status === 'source-changed') {
      if (!isSha256(capture.observedBytesSha256)) errors.push(`${where}: a source change records the observed SHA-256`);
      if (isSha256(capture.bytesSha256) && capture.bytesSha256 === pinnedHash(cardSource, capture.requestedUrl)) {
        errors.push(`${where}: identical bytes are a match, not a source change`);
      }
      if (nonEmptyString(capture.localPath)) errors.push(`${where}: a source change stores no reference bytes`);
    } else if (capture.status === 'blocked') {
      if (!nonEmptyString(capture.error)) errors.push(`${where}: a blocked capture names its reason`);
    } else {
      errors.push(`${where}: status must be verified, source-changed or blocked`);
    }
  }
  if (pin.captureStatus === 'source-changed' && !isSha256(pin.observedBytesSha256)) {
    errors.push('pin: a source change names the observed SHA-256');
  }
  if (pin.captureStatus === 'blocked' && !nonEmptyString(pin.blockedReason)) {
    errors.push('pin: a blocked pin names its reason');
  }
  return { ok: errors.length === 0, errors };
}

module.exports = {
  CAPTURE_KINDS,
  CARD_SOURCE_IDS,
  CARD_VERIFICATION_STATES,
  LOCAL_CAPTURE_PREFIX,
  pinnedHash,
  pinnedUrlSet,
  validateCardReferenceCapturePin,
};
