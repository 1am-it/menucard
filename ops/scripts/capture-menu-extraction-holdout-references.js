#!/usr/bin/env node
'use strict';

// Pin the source version of the four Product Owner-approved public holdouts
// BEFORE any parser outcome is recorded or used. This script only fetches the
// exact approved entry URLs through safeOutboundFetch, computes a byte hash and
// writes capture metadata. It does not parse a menu, call a provider, touch a
// database or publish anything.
//
// Usage:
//   node ops/scripts/capture-menu-extraction-holdout-references.js
//
// The reference file is create-only: a second run refuses to overwrite it, so
// the pinned version cannot be silently replaced. A legitimate new source
// version needs a separate, explicit decision and a new holdout pin.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { fetchWebsiteSafely } = require('../../src/lib/safeOutboundFetch');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SOURCES_PATH = path.join(REPO_ROOT, 'ops', 'benchmark', 'holdout-sources.json');
const REFERENCES_PATH = path.join(REPO_ROOT, 'ops', 'benchmark', 'holdout-references.json');
const MAX_BYTES = 15 * 1024 * 1024;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function assertApprovedHost(url, allowedHosts) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error(`holdout capture refused: ${url} is not https`);
  if (parsed.username || parsed.password) throw new Error(`holdout capture refused: credentials in ${url}`);
  if (!allowedHosts.includes(parsed.hostname)) {
    throw new Error(`holdout capture refused: ${parsed.hostname} is not an approved holdout host`);
  }
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf8'));
  if (manifest.authorization.appProviderActivation !== false) {
    throw new Error('holdout capture refused: app provider activation must remain false');
  }
  if (fs.existsSync(REFERENCES_PATH)) {
    throw new Error(`holdout capture refused: ${path.relative(REPO_ROOT, REFERENCES_PATH)} already exists; the pinned source version is immutable`);
  }

  const captured = {};
  for (const source of manifest.sources) {
    assertApprovedHost(source.url, source.allowedHosts);
    const capturedAt = new Date().toISOString();
    try {
      const fetched = await fetchWebsiteSafely(source.url, { encoding: 'buffer', maxBytes: MAX_BYTES, timeoutMs: 15000 });
      assertApprovedHost(fetched.finalUrl, source.allowedHosts);
      const contentType = fetched.contentType || 'unknown';
      const kind = contentType === 'application/pdf' ? 'pdf' : (contentType === 'text/html' || contentType === 'application/xhtml+xml' ? 'html' : 'unsupported');
      captured[source.id] = {
        label: source.label,
        url: source.url,
        finalUrl: fetched.finalUrl,
        contentType,
        kind,
        bytes: fetched.bytes.length,
        bytesSha256: sha256(fetched.bytes),
        capturedAt,
        captureStatus: 'captured',
        referenceMode: 'capture_only',
        groundTruth: null,
        authorization: manifest.authorization.reference,
        note: 'Only this source version is pinned. No parser outcome, item count or category count is recorded here.',
      };
    } catch (error) {
      // A blocked or failed first read is a real, honest outcome. The pinned
      // entry records exactly what happened; it never substitutes another URL.
      const reason = (error && error.reason) || 'fetch_failed';
      const httpStatus = error && Number.isInteger(error.statusCode) ? error.statusCode : null;
      captured[source.id] = {
        label: source.label,
        url: source.url,
        finalUrl: null,
        contentType: null,
        kind: 'unsupported',
        bytes: 0,
        bytesSha256: null,
        capturedAt,
        captureStatus: httpStatus === 404 ? 'blocked' : 'failed',
        httpStatus,
        error: reason,
        referenceMode: 'capture_only',
        groundTruth: null,
        authorization: manifest.authorization.reference,
        note: 'The approved entry URL did not yield a readable public source. No alternative URL, other location or crawl was substituted.',
      };
    }
  }

  const references = {
    version: '1.0.0',
    pinnedAt: manifest.pinnedAt,
    capturedAt: new Date().toISOString(),
    note: 'Capture-only references for the four Product Owner-approved #59 holdouts. Read-only; no parser result, item count or publication.',
    authorization: manifest.authorization,
    sources: captured,
  };
  fs.writeFileSync(REFERENCES_PATH, `${JSON.stringify(references, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ captured: Object.keys(captured), path: path.relative(REPO_ROOT, REFERENCES_PATH) }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error && error.message ? error.message : 'holdout capture failed'}\n`);
  process.exitCode = 1;
});
