#!/usr/bin/env node
'use strict';

// One honest re-attempt for the two blocked existing cards (#59 Delivery Lead
// order 6347355753, K3). Wolfslaar failed on TLS and T-Huis sits in a
// maintenance redirect loop. This tool makes exactly one new read attempt per
// pinned probe URL through the existing safe route, which also performs the
// robots.txt check, and records the outcome with its reason and time. A failed
// attempt stays "blocked": no alternative URL, no other location, no bypass and
// no synthetic success.
//
// Usage:
//   node ops/scripts/probe-menu-extraction-blocked-cards.js
//
// Output: ops/benchmark/existing-card-probe-attempts.json (create-only, so one
// attempt cannot be replaced by a later one).

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { fetchWebsiteSafely } = require('../../src/lib/safeOutboundFetch');
const { assertApprovedHost, repositoryTextSha256 } = require('../benchmark/holdoutManifest');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CARD_REFERENCES_PATH = path.join(REPO_ROOT, 'ops', 'benchmark', 'existing-card-references.json');
const OUT_PATH = path.join(REPO_ROOT, 'ops', 'benchmark', 'existing-card-probe-attempts.json');
const SOURCE_IDS = ['wolfslaar', 'thuis'];
const MAX_BYTES = 15 * 1024 * 1024;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function relative(file) {
  return path.relative(REPO_ROOT, file).split(path.sep).join('/');
}

async function attempt(url, allowedHosts) {
  const at = new Date().toISOString();
  try {
    assertApprovedHost(url, allowedHosts);
    const fetched = await fetchWebsiteSafely(url, { encoding: 'buffer', maxBytes: MAX_BYTES, timeoutMs: 20000 });
    assertApprovedHost(fetched.finalUrl, allowedHosts);
    const contentType = fetched.contentType || 'unknown';
    const kind = contentType === 'application/pdf'
      ? 'pdf'
      : (contentType === 'text/html' || contentType === 'application/xhtml+xml' ? 'html' : 'unsupported');
    const read = kind !== 'unsupported';
    return {
      url,
      at,
      status: read ? 'readable' : 'blocked',
      finalUrl: fetched.finalUrl,
      contentType,
      kind,
      bytes: fetched.bytes.length,
      bytesSha256: sha256(fetched.bytes),
      error: read ? null : 'unsupported_content_type',
      note: read
        ? 'The safe route returned a readable public document. This attempt pins nothing; the card capture stays unchanged.'
        : 'The safe route returned content this project does not read as a menu source; nothing was parsed.',
    };
  } catch (error) {
    const statusCode = error && Number.isInteger(error.statusCode) ? error.statusCode : null;
    return {
      url,
      at,
      status: 'blocked',
      finalUrl: null,
      contentType: null,
      kind: 'unsupported',
      bytes: 0,
      bytesSha256: null,
      httpStatus: statusCode,
      redirectLocation: (error && error.location) || null,
      error: (error && error.reason) || (error && error.message) || 'fetch_failed',
      note: 'The pinned URL was not readable through the safe route. No alternative URL, other location or bypass was substituted.',
    };
  }
}

async function main() {
  if (fs.existsSync(OUT_PATH)) {
    throw new Error(`probe refused: ${relative(OUT_PATH)} already exists; this round is one attempt, not a retry loop`);
  }
  const cardBytes = fs.readFileSync(CARD_REFERENCES_PATH);
  const cardReferences = JSON.parse(cardBytes.toString('utf8'));
  const sources = [];
  for (const id of SOURCE_IDS) {
    const source = cardReferences.sources[id];
    if (!source) throw new Error(`probe refused: ${id} is not a pinned card source`);
    const urls = [...new Set((source.captures || []).map((capture) => capture.url))];
    if (urls.length === 0) throw new Error(`probe refused: ${id} has no pinned URLs`);
    const attempts = [];
    for (const url of urls) attempts.push(await attempt(url, source.allowedHosts));
    sources.push({
      id,
      label: source.label,
      entryUrl: source.entryUrl,
      allowedHosts: source.allowedHosts,
      attemptedAt: attempts[0].at,
      attempts,
      outcome: attempts.some((entry) => entry.status === 'readable') ? 'readable' : 'blocked',
      blockingReason: attempts.filter((entry) => entry.status !== 'readable').map((entry) => `${entry.url}: ${entry.error}${entry.httpStatus ? ` (HTTP ${entry.httpStatus})` : ''}`).join('; ') || null,
    });
  }
  const output = {
    version: '1.0.0',
    issue: 59,
    purpose: 'criterion 5 - one honest re-attempt for the two blocked existing cards',
    oneShot: true,
    authorization: cardReferences.authorization,
    cardCapture: { path: relative(CARD_REFERENCES_PATH), bytesSha256: repositoryTextSha256(cardBytes) },
    method: 'One read-only attempt per pinned probe URL through the existing safe fetch, which also performs the robots.txt check. A failure is recorded as blocked with its reason, HTTP status and time; no alternative URL, other location, crawl or bypass is used.',
    sources,
  };
  fs.writeFileSync(OUT_PATH, `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${relative(OUT_PATH)}\n`);
  for (const source of sources) {
    process.stdout.write(`${source.id}: ${source.outcome}${source.blockingReason ? ` (${source.blockingReason})` : ''}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error && error.message ? error.message : 'card probe failed'}\n`);
  process.exitCode = 1;
});
