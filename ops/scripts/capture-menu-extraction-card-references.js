#!/usr/bin/env node
'use strict';

// Pin the source version of the four existing-card sources BEFORE comparing
// them with the historical data/menus.json export (#59 Delivery Lead review
// 6315269210). This is capture-only: it fetches the pinned entry URL plus the
// menu routes/PDFs that the historical export itself names, computes a byte
// hash and records an honest read outcome. It never parses a menu, calls a
// provider, writes a database or publishes anything.
//
// Usage:
//   node ops/scripts/capture-menu-extraction-card-references.js
//
// Output: ops/benchmark/existing-card-references.json (create-only). A second
// run is refused, so the pinned version cannot be silently replaced.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { fetchWebsiteSafely } = require('../../src/lib/safeOutboundFetch');
const { assertApprovedHost } = require('../benchmark/holdoutManifest');
const { validateExistingCardManifest, historicalEntries } = require('../benchmark/existingCardSources');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'ops', 'benchmark', 'existing-card-sources.json');
const REFERENCES_PATH = path.join(REPO_ROOT, 'ops', 'benchmark', 'existing-card-references.json');
const MAX_BYTES = 15 * 1024 * 1024;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function captureUrl(url, allowedHosts) {
  const capturedAt = new Date().toISOString();
  try {
    assertApprovedHost(url, allowedHosts);
    const fetched = await fetchWebsiteSafely(url, { encoding: 'buffer', maxBytes: MAX_BYTES, timeoutMs: 20000 });
    assertApprovedHost(fetched.finalUrl, allowedHosts);
    const contentType = fetched.contentType || 'unknown';
    const kind = contentType === 'application/pdf'
      ? 'pdf'
      : (contentType === 'text/html' || contentType === 'application/xhtml+xml' ? 'html' : 'unsupported');
    return {
      url,
      finalUrl: fetched.finalUrl,
      contentType,
      kind,
      bytes: fetched.bytes.length,
      bytesSha256: sha256(fetched.bytes),
      capturedAt,
      captureStatus: 'captured',
      note: 'Only this source version is pinned. No parser outcome, item count or category count is recorded here.',
    };
  } catch (error) {
    const httpStatus = error && Number.isInteger(error.statusCode) ? error.statusCode : null;
    return {
      url,
      finalUrl: null,
      contentType: null,
      kind: 'unsupported',
      bytes: 0,
      bytesSha256: null,
      capturedAt,
      captureStatus: httpStatus === 404 ? 'blocked' : 'failed',
      httpStatus,
      error: (error && error.reason) || (error && error.message) || 'fetch_failed',
      note: 'The pinned URL did not yield a readable public source. No alternative URL, other location or crawl was substituted.',
    };
  }
}

async function main() {
  if (fs.existsSync(REFERENCES_PATH)) {
    throw new Error(`card capture refused: ${path.relative(REPO_ROOT, REFERENCES_PATH)} already exists; the pinned source version is immutable`);
  }
  const manifestBytes = fs.readFileSync(MANIFEST_PATH);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const menus = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'data', 'menus.json'), 'utf8'));
  const validation = validateExistingCardManifest(manifest, menus);
  if (!validation.ok) {
    throw new Error(`card capture refused: ${validation.errors.join('; ')}`);
  }

  const sources = {};
  for (const source of manifest.sources) {
    const urls = [...new Set([source.entryUrl, ...source.probeUrls])];
    const captures = [];
    for (const url of urls) captures.push(await captureUrl(url, source.allowedHosts));
    sources[source.id] = {
      label: source.label,
      restaurantId: source.restaurantId,
      entryUrl: source.entryUrl,
      allowedHosts: source.allowedHosts,
      captures,
      captureStatus: captures[0].captureStatus,
      historical: historicalEntries(menus, source).map((entry) => ({
        key: entry.key,
        name: entry.name,
        subtitle: entry.subtitle,
        scraped: entry.scraped,
        sourceUrl: entry.sourceUrl,
        itemCount: entry.itemCount,
      })),
    };
  }

  const references = {
    version: '1.0.0',
    pinnedAt: manifest.pinnedAt,
    capturedAt: new Date().toISOString(),
    manifest: {
      path: path.relative(REPO_ROOT, MANIFEST_PATH).split(path.sep).join('/'),
      bytesSha256: sha256(manifestBytes),
      sourceCount: manifest.sources.length,
    },
    note: 'Capture-only references for the four #59 existing-card sources. The historical data/menus.json rows are dated observations, not ground truth for a later source version.',
    authorization: manifest.authorization,
    sources,
  };
  fs.writeFileSync(REFERENCES_PATH, `${JSON.stringify(references, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ path: path.relative(REPO_ROOT, REFERENCES_PATH), sources: Object.keys(sources) }, null, 2)}\n`);
  for (const [id, source] of Object.entries(sources)) {
    process.stderr.write(`${id}: ${source.captureStatus}; ${source.captures.map((capture) => `${capture.captureStatus} ${capture.url}`).join(' | ')}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error && error.message ? error.message : 'card capture failed'}\n`);
  process.exitCode = 1;
});
