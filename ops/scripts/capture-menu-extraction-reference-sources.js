#!/usr/bin/env node
'use strict';

// Pin the exact source version of the five #59 reference sources BEFORE any
// controlled reference is written (Delivery Lead review 6318225879). This is
// capture-only: it follows at most the same bounded, same-host menu links the
// analysis pipeline itself follows, stores the response bytes locally under the
// gitignored `ops/benchmark/output/reference-captures/` folder and commits only
// URL, content-type, time, size and SHA-256.
//
// It never parses a menu, copies parser output into a reference, calls a
// provider, writes a database or publishes. A blocked or failed source is
// recorded with its exact reason, never as an empty menu.
//
// Usage:
//   node ops/scripts/capture-menu-extraction-reference-sources.js
//
// The metadata file is create-only: a second run is refused, so a pinned
// version cannot be silently replaced. To retry before the metadata is
// committed, remove the local capture folder and metadata file explicitly.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { fetchWebsiteSafely } = require('../../src/lib/safeOutboundFetch');
const {
  checkRobotsForUrl,
  fetchSameSiteWithRedirects,
  describeRobotsBlock,
} = require('../../src/lib/restaurantSourceFetch');
const {
  findSameHostMenuCandidates,
  findSameHostSubPageLinks,
} = require('../../src/lib/sameHostDiscovery');
const { runRestaurantSourceAnalysis } = require('../../src/lib/restaurantSourceAnalysis');
const { buildDirectPdfAnalysis } = require('../../src/lib/sourceAnalysisPipeline');
const {
  CAPTURE_MAX_BYTES,
  CAPTURE_MAX_CANDIDATES,
  captureLookupKey,
  classifyCaptureKind,
  createOfflineCandidateFetcher,
  validateReferenceCaptureManifest,
} = require('../benchmark/referenceCaptureSources');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'ops', 'benchmark', 'reference-capture-sources.json');
const METADATA_PATH = path.join(REPO_ROOT, 'ops', 'benchmark', 'reference-captures.json');
const CAPTURE_ROOT = path.join(REPO_ROOT, 'ops', 'benchmark', 'output', 'reference-captures');
const FETCH_TIMEOUT_MS = 25000;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function assertApprovedHost(url, allowedHosts) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`capture refused: ${url} is not a valid URL`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`capture refused: ${url} is not https`);
  if (parsed.username || parsed.password) throw new Error(`capture refused: credentials in ${url}`);
  if (!Array.isArray(allowedHosts) || !allowedHosts.includes(parsed.hostname)) {
    throw new Error(`capture refused: ${parsed.hostname} is not a pinned reference host`);
  }
}

function slugFor(url, order) {
  try {
    const parsed = new URL(url);
    const leaf = parsed.pathname.replace(/\/+$/, '').split('/').filter(Boolean).pop();
    const safe = (leaf || 'home').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return `${String(order).padStart(2, '0')}-${safe || 'home'}`;
  } catch {
    return `${String(order).padStart(2, '0')}-capture`;
  }
}

async function captureOne({ url, allowedHosts, sourceId, order }) {
  const capturedAt = new Date().toISOString();
  const base = {
    order,
    requestedUrl: url,
    finalUrl: null,
    contentType: null,
    kind: 'unsupported',
    bytes: 0,
    bytesSha256: null,
    capturedAt,
    captureStatus: 'failed',
    httpStatus: null,
    error: null,
    localPath: null,
    note: 'Only this source version is pinned. No parser outcome, item count or category count is recorded here.',
  };
  try {
    assertApprovedHost(url, allowedHosts);
    const gate = await checkRobotsForUrl(url, { fetchImpl: fetchWebsiteSafely });
    if (!gate.shouldFetchPage) {
      return {
        ...base,
        captureStatus: 'blocked',
        httpStatus: gate.httpStatus || null,
        error: describeRobotsBlock(gate),
        note: 'The safe route refused this URL before reading it. No alternative URL, other location or bypass was substituted.',
      };
    }
    const fetched = await fetchSameSiteWithRedirects(url, {
      fetchImpl: fetchWebsiteSafely,
      fetchOptions: { encoding: 'buffer', maxBytes: CAPTURE_MAX_BYTES, timeoutMs: FETCH_TIMEOUT_MS },
      robotsCheck: async (next) => {
        assertApprovedHost(next, allowedHosts);
        return checkRobotsForUrl(next, { fetchImpl: fetchWebsiteSafely });
      },
    });
    const response = fetched.response;
    assertApprovedHost(response.finalUrl, allowedHosts);
    const contentType = response.contentType || 'unknown';
    const kind = classifyCaptureKind(contentType);
    const bytes = response.bytes;
    const bytesSha256 = sha256(bytes);
    const dir = path.join(CAPTURE_ROOT, sourceId);
    fs.mkdirSync(dir, { recursive: true });
    const extension = kind === 'pdf' ? 'pdf' : kind === 'html' ? 'html' : 'bin';
    const file = path.join(dir, `${slugFor(response.finalUrl || url, order)}-${bytesSha256.slice(0, 12)}.${extension}`);
    fs.writeFileSync(file, bytes, { flag: 'wx' });
    return {
      ...base,
      finalUrl: response.finalUrl || url,
      contentType,
      kind,
      bytes: bytes.length,
      bytesSha256,
      captureStatus: 'captured',
      localPath: relativeLocalPath(file),
      redirects: fetched.redirects,
    };
  } catch (error) {
    const statusCode = error && Number.isInteger(error.statusCode) ? error.statusCode : null;
    const reason = (error && error.reason) || (error && error.message) || 'fetch_failed';
    return {
      ...base,
      captureStatus: statusCode !== null && statusCode < 500 ? 'blocked' : 'failed',
      httpStatus: statusCode,
      error: reason,
      note: 'The pinned URL did not yield a readable public source. No alternative URL, other location or bypass was substituted.',
    };
  }
}

function captureBudget(source) {
  const extras = Array.isArray(source.extraUrls) ? source.extraUrls.length : 0;
  return 1 + CAPTURE_MAX_CANDIDATES + extras;
}

/**
 * The analysis pipeline's own bounded discovery decides which pages it will
 * read (a hub page can contribute a PDF and a language variant). To pin the
 * complete source version the measurement will replay, run that discovery
 * offline on the bytes captured so far and report only the URLs it requested
 * but that are not pinned yet. The parser result is deliberately not written
 * anywhere: this closure exists to enumerate pages, never to author a
 * reference from parser output.
 */
async function missingCandidateUrls(sourceId, captures) {
  const loaded = captures
    .filter((capture) => capture.captureStatus === 'captured')
    .map((capture) => ({ ...capture, bytesBuffer: fs.readFileSync(path.join(REPO_ROOT, capture.localPath)) }));
  const entry = loaded.find((capture) => capture.order === 1) || null;
  if (!entry) return [];
  const { fetchCandidate, missing } = createOfflineCandidateFetcher(loaded);
  if (entry.kind === 'html') {
    await runRestaurantSourceAnalysis({
      homepageHtml: entry.bytesBuffer.toString('utf8'),
      homepageUrl: entry.finalUrl,
      fetchCandidate,
    });
  } else if (entry.kind === 'pdf') {
    await buildDirectPdfAnalysis({ pdfBytes: entry.bytesBuffer, sourceUrl: entry.finalUrl });
  }
  return missing;
}

async function captureSource(source) {
  const queue = [{ url: source.entryUrl, depth: 0, matchedOn: 'entry' }];
  for (const extra of Array.isArray(source.extraUrls) ? source.extraUrls : []) {
    queue.push({ url: extra, depth: 1, matchedOn: 'pinned extra URL' });
  }
  const seen = new Set(queue.map((item) => captureLookupKey(item.url)));
  const captures = [];
  const budget = captureBudget(source);

  while (queue.length > 0 && captures.length < budget) {
    const item = queue.shift();
    const capture = await captureOne({
      url: item.url,
      allowedHosts: source.allowedHosts,
      sourceId: source.id,
      order: captures.length + 1,
    });
    captures.push(capture);

    if (capture.captureStatus !== 'captured' || capture.kind !== 'html' || item.depth >= 2) continue;
    // Same closed discovery as the analysis pipeline: menu-keyword links plus,
    // for a labelled hub, its own child pages. Never another host, never an
    // unbounded crawl. These are captures only; no menu is parsed here.
    const html = fs.readFileSync(path.join(REPO_ROOT, capture.localPath), 'utf8');
    const links = [
      ...findSameHostMenuCandidates(html, capture.finalUrl),
      ...findSameHostSubPageLinks(html, capture.finalUrl),
    ];
    for (const link of links) {
      if (captures.length + queue.length >= budget) break;
      const key = captureLookupKey(link.url);
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ url: link.url, depth: item.depth + 1, matchedOn: link.matchedOn || null });
    }
  }

  // Close the set over the pages the real bounded analysis actually requests
  // (for example a PDF or language variant linked from a hub page). Two passes
  // are enough for the pipeline's one-level hub expansion; a fixed hard cap
  // keeps a pathological source from turning this into a crawl.
  for (let pass = 0; pass < 2; pass += 1) {
    const missing = await missingCandidateUrls(source.id, captures);
    if (missing.length === 0) break;
    for (const url of missing) {
      if (captures.length >= 12) break;
      const key = captureLookupKey(url);
      if (seen.has(key)) continue;
      seen.add(key);
      assertApprovedHost(url, source.allowedHosts);
      const capture = await captureOne({
        url,
        allowedHosts: source.allowedHosts,
        sourceId: source.id,
        order: captures.length + 1,
      });
      captures.push(capture);
    }
  }

  const entry = captures[0] || null;
  return {
    label: source.label,
    class: source.class,
    entryUrl: source.entryUrl,
    allowedHosts: source.allowedHosts,
    captureStatus: entry ? entry.captureStatus : 'failed',
    captures,
  };
}

function relativeLocalPath(file) {
  return path.relative(REPO_ROOT, file).split(path.sep).join('/');
}

async function main() {
  if (fs.existsSync(METADATA_PATH)) {
    throw new Error(`reference capture refused: ${path.relative(REPO_ROOT, METADATA_PATH)} already exists; the pinned source version is immutable`);
  }
  if (fs.existsSync(CAPTURE_ROOT) && fs.readdirSync(CAPTURE_ROOT).length > 0) {
    throw new Error(`reference capture refused: ${path.relative(REPO_ROOT, CAPTURE_ROOT)} already contains bytes; remove them explicitly before a new pin`);
  }
  const manifestBytes = fs.readFileSync(MANIFEST_PATH);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const validation = validateReferenceCaptureManifest(manifest);
  if (!validation.ok) {
    throw new Error(`reference capture refused: ${validation.errors.join('; ')}`);
  }

  const sources = {};
  for (const source of manifest.sources) {
    sources[source.id] = await captureSource(source);
  }
  const values = Object.values(sources);
  const metadata = {
    version: '1.0.0',
    pinnedAt: manifest.pinnedAt,
    capturedAt: new Date().toISOString(),
    captureStatus: 'captured',
    deterministicReplay: true,
    manifest: {
      path: path.relative(REPO_ROOT, MANIFEST_PATH).split(path.sep).join('/'),
      bytesSha256: sha256(manifestBytes),
      sourceCount: manifest.sources.length,
    },
    authorization: manifest.authorization,
    note: 'Capture-only metadata for the five #59 controlled reference sources. The response bytes stay local and gitignored; only URL, content-type, time, size and SHA-256 are committed. The measurement replays the current extraction on exactly these bytes and never refetches them.',
    sources,
  };
  // The overall status is the worst per-source outcome, never a green summary
  // that hides a blocked source.
  if (values.some((source) => source.captureStatus !== 'captured')) metadata.captureStatus = 'blocked';
  if (values.every((source) => source.captureStatus !== 'captured')) metadata.captureStatus = 'failed';
  fs.writeFileSync(METADATA_PATH, `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ path: path.relative(REPO_ROOT, METADATA_PATH), sources: Object.keys(sources) }, null, 2)}\n`);
  for (const [id, source] of Object.entries(sources)) {
    process.stderr.write(
      `${id}: ${source.captureStatus}; ${source.captures.map((c) => `${c.captureStatus} ${c.kind} ${c.requestedUrl}${c.bytesSha256 ? ` ${c.bytesSha256.slice(0, 12)}` : ''}`).join(' | ')}\n`,
    );
  }
}

main().catch((error) => {
  process.stderr.write(`${error && error.message ? error.message : 'reference capture failed'}\n`);
  process.exitCode = 1;
});
