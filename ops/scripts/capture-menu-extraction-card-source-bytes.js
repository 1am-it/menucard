#!/usr/bin/env node
'use strict';

// One-time create-only byte capture of Wolfslaar and T-Huis (#59 Delivery Lead
// order review 6349832755, K1).
//
// The 2026-10-21 card capture recorded both sources as `failed`; the later
// probe recorded them as readable again (`existing-card-probe-attempts.json`,
// commit 6ea987c1). This tool takes the one read-only attempt the order allows:
//
//   - the pinned entry URL, the menu URLs the historical export names and the
//     probe URLs that same export pinned;
//   - plus, at most once and only from the captured entry page itself, the
//     same-host menu links that page names (one hop, never a crawl).
//
// Every URL is read through the existing safe fetch (SSRF guards, redirect,
// timeout and byte limits). The bytes are stored under the gitignored
// `ops/benchmark/output/card-captures/`; only hash, size, content type, role and
// time are committed in `ops/benchmark/card-reference-captures.<source>.json`,
// opened with `flag: 'wx'`. A second run is refused: this is one capture, not a
// re-pin loop. A readable page that is not a menu (a maintenance page) is
// recorded as `not-a-menu`; an unreadable page as `blocked` with its error.
//
// No provider, AI, database, publication or production action is involved.
//
// Usage:
//   node ops/scripts/capture-menu-extraction-card-source-bytes.js --source wolfslaar --dry-run
//   node ops/scripts/capture-menu-extraction-card-source-bytes.js --source wolfslaar

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { fetchWebsiteSafely } = require('../../src/lib/safeOutboundFetch');
const { findSameHostMenuCandidates } = require('../../src/lib/sameHostDiscovery');
const { extractDigitalPdfText } = require('../../src/lib/pdfTextExtraction');
const { assertApprovedHost, repositoryTextSha256 } = require('../benchmark/holdoutManifest');
const { htmlVisibleText } = require('../benchmark/referenceIntegrity');
const { classifyCaptureKind } = require('../benchmark/referenceCaptureSources');
const {
  LOCAL_CAPTURE_PREFIX,
} = require('../benchmark/cardReferenceCaptures');
const {
  cardCaptureSeeds,
  cardSourcePinPath,
  historicalUrlsOf,
  looksLikeMaintenance,
  pageKey,
  decimalAmountCount,
  REATTEMPT_SOURCE_IDS,
  validateCardSourceCapturePin,
} = require('../benchmark/cardSourceCaptures');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CARD_REFERENCES_PATH = path.join(REPO_ROOT, 'ops', 'benchmark', 'existing-card-references.json');
const CARD_SOURCES_PATH = path.join(REPO_ROOT, 'ops', 'benchmark', 'existing-card-sources.json');
const MAX_BYTES = 15 * 1024 * 1024;
const TIMEOUT_MS = 20000;

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function relative(file) {
  return path.relative(REPO_ROOT, file).split(path.sep).join('/');
}

function extensionFor(contentType, kind) {
  if (kind === 'pdf') return 'pdf';
  if (kind === 'html') return 'html';
  return 'bin';
}

function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  let sourceId = null;
  let dryRun = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--source') {
      sourceId = args[i + 1];
      if (!sourceId || sourceId.startsWith('--')) throw new Error('--source requires a source id');
      i += 1;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!sourceId) throw new Error('--source is required');
  if (!REATTEMPT_SOURCE_IDS.includes(sourceId)) {
    throw new Error(`capture refused: ${sourceId} is not one of the two sources this order may capture`);
  }
  return { sourceId, dryRun };
}

/** Visible text of a readable capture, for the honest maintenance check. */
async function visibleText(kind, bytes, label) {
  try {
    if (kind === 'pdf') return { text: (await extractDigitalPdfText(bytes, { maxBytes: MAX_BYTES })).text, error: null };
    if (kind === 'html') return { text: htmlVisibleText(bytes.toString('utf8')), error: null };
    return { text: '', error: null };
  } catch (error) {
    return { text: null, error: `${label}: ${error && error.message ? error.message : 'text unreadable'}` };
  }
}

/** One read-only attempt. Returns a capture row; only readable bytes reach disk. */
async function captureOne(url, options) {
  const { role, discovery, discoveredFrom, sourceId, allowedHosts, at, index } = options;
  assertApprovedHost(url, allowedHosts);
  let fetched;
  try {
    fetched = await fetchWebsiteSafely(url, { encoding: 'buffer', maxBytes: MAX_BYTES, timeoutMs: TIMEOUT_MS });
  } catch (error) {
    return {
      requestedUrl: url,
      finalUrl: null,
      contentType: null,
      kind: 'unsupported',
      role,
      discovery: discovery || null,
      discoveredFrom: discoveredFrom || null,
      status: 'blocked',
      bytes: 0,
      bytesSha256: null,
      capturedAt: at,
      localPath: null,
      decimalAmountCount: null,
      error: error && error.code ? `${error.code}: ${error.message}` : String(error && error.message ? error.message : error),
      note: 'The pinned URL did not yield a readable public source. No alternative URL, other location or crawl was substituted.',
    };
  }
  assertApprovedHost(fetched.finalUrl, allowedHosts);
  const bytes = fetched.bytes;
  const digest = sha256(bytes);
  const contentType = fetched.contentType || 'unknown';
  const kind = classifyCaptureKind(contentType);
  const localPath = `${LOCAL_CAPTURE_PREFIX}${sourceId}/${String(index + 1).padStart(2, '0')}-${kind}-${digest.slice(0, 12)}.${extensionFor(contentType, kind)}`;
  const target = path.join(REPO_ROOT, localPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes, { flag: 'wx' });

  const read = await visibleText(kind, bytes, url);
  const decimalAmountCountValue = read.text === null ? null : decimalAmountCount(read.text);
  const maintenance = read.text === null ? false : looksLikeMaintenance(read.text);
  const base = {
    requestedUrl: url,
    finalUrl: fetched.finalUrl,
    contentType,
    kind,
    role,
    discovery: discovery || null,
    discoveredFrom: discoveredFrom || null,
    bytes: bytes.length,
    bytesSha256: digest,
    capturedAt: at,
    localPath,
    decimalAmountCount: decimalAmountCountValue,
  };
  if (read.error) {
    return { ...base, status: 'captured', reason: null, error: null, note: `The bytes are readable but no text layer could be read (${read.error}); no menu content is claimed from this page.` };
  }
  if (kind === 'unsupported') {
    return { ...base, status: 'not-a-menu', reason: `content type ${contentType} is neither HTML nor PDF`, error: null, note: 'A readable response that this route cannot read as a menu. The bytes are kept as proof; no reference is authored from it.' };
  }
  if (role === 'menu' && maintenance) {
    return { ...base, status: 'not-a-menu', reason: 'the page reads like a maintenance page, not a menu', error: null, note: 'Readable bytes without menu content. The page is recorded as not-a-menu; no reference is authored from it.' };
  }
  return { ...base, status: 'captured', reason: null, error: null, note: null };
}

async function main() {
  const { sourceId, dryRun } = parseArgs(process.argv.slice(2));
  const pinPath = path.join(REPO_ROOT, cardSourcePinPath(sourceId));
  if (fs.existsSync(pinPath)) {
    throw new Error(`capture refused: ${relative(pinPath)} already exists; this source is captured once, not re-pinned`);
  }
  const cardBytes = fs.readFileSync(CARD_REFERENCES_PATH);
  const cardReferences = JSON.parse(cardBytes.toString('utf8'));
  const cardSources = JSON.parse(fs.readFileSync(CARD_SOURCES_PATH, 'utf8'));
  const cardSource = (cardSources.sources || []).find((source) => source.id === sourceId);
  if (!cardSource) throw new Error(`capture refused: ${sourceId} is not a pinned card source`);
  const historicalUrls = historicalUrlsOf(cardReferences, sourceId);
  const seeds = cardCaptureSeeds(cardSource, cardReferences);

  if (dryRun) {
    process.stdout.write(`${sourceId}: ${seeds.length} seed URL(s), no fetch\n`);
    for (const seed of seeds) process.stdout.write(`  ${seed.origin}\t${seed.url}\n`);
    return;
  }

  const capturedAt = new Date().toISOString();
  const captures = [];
  for (const [index, seed] of seeds.entries()) {
    const capture = await captureOne(seed.url, {
      role: seed.origin === 'entry' ? 'entry' : 'menu',
      sourceId,
      allowedHosts: cardSource.allowedHosts,
      at: new Date().toISOString(),
      index,
    });
    captures.push({ ...capture, seedOrigin: seed.origin });
    process.stdout.write(`${capture.status}\t${seed.origin}\t${seed.url}\t${capture.bytesSha256 || capture.error}\n`);
  }

  // One hop only, and only links the captured entry page itself names. The
  // discovery helper is the project's existing closed same-host menu matcher.
  const entry = captures.find((capture) => capture.role === 'entry' && capture.status === 'captured' && capture.kind === 'html');
  if (entry) {
    const entryBytes = fs.readFileSync(path.join(REPO_ROOT, entry.localPath));
    const candidates = findSameHostMenuCandidates(entryBytes.toString('utf8'), entry.finalUrl);
    const known = new Set(captures.map((capture) => pageKey(capture.requestedUrl)));
    for (const candidate of candidates) {
      if (known.has(pageKey(candidate.url))) continue;
      const capture = await captureOne(candidate.url, {
        role: 'menu',
        discovery: 'same-host-menu-link',
        discoveredFrom: entry.requestedUrl,
        sourceId,
        allowedHosts: cardSource.allowedHosts,
        at: new Date().toISOString(),
        index: captures.length,
      });
      captures.push({ ...capture, seedOrigin: 'page-link' });
      known.add(pageKey(candidate.url));
      process.stdout.write(`${capture.status}\tpage-link\t${candidate.url}\t${capture.bytesSha256 || capture.error}\n`);
    }
  }

  const entryCaptures = captures.filter((capture) => capture.role === 'entry');
  const entryReadable = entryCaptures.filter((capture) => capture.status === 'captured');
  const readableMenus = captures.filter((capture) => capture.role === 'menu' && capture.status === 'captured');
  const blocked = captures.filter((capture) => capture.status === 'blocked');
  const notAMenu = captures.filter((capture) => capture.status === 'not-a-menu');
  const captureStatus = entryReadable.length !== 1
    ? 'blocked'
    : (readableMenus.length > 0 ? 'captured' : 'partially-captured');
  const limitations = [
    'One read-only attempt per URL through the existing safe fetch; robots.txt is not consulted by this benchmark capture route, exactly like the accepted Bardot capture.',
    'Only the pinned entry URL, the menu URLs the historical export names, the pinned probe URLs and the same-host menu links the entry page itself names (one hop). No crawl, no alternative URL, no other location.',
    'A readable page that is not a menu is recorded as not-a-menu; an unreadable page as blocked. Neither is ever counted as a menu.',
  ];
  if (notAMenu.length > 0) limitations.push(`${notAMenu.length} readable page(s) carry no menu content.`);
  if (blocked.length > 0) limitations.push(`${blocked.length} page(s) were not readable; see their recorded error.`);

  const pin = {
    version: '1.0.0',
    issue: 59,
    sourceId,
    label: cardSource.label,
    entryUrl: cardSource.entryUrl,
    allowedHosts: cardSource.allowedHosts,
    capturedAt,
    oneShot: true,
    captureStatus,
    method: 'One read-only attempt per URL through the existing safe fetch (SSRF guards, redirect limit, timeout and byte cap). Bytes are stored under the gitignored ops/benchmark/output/card-captures/; only SHA-256, size, content type, role and time are committed here. A readable page without menu content is recorded as not-a-menu, an unreadable page as blocked.',
    authorization: cardReferences.authorization,
    previousCardCapture: {
      path: relative(CARD_REFERENCES_PATH),
      bytesSha256: repositoryTextSha256(cardBytes),
      previousCaptureStatus: 'failed',
      note: 'The 2026-10-21 capture of this source failed. Review 6349832755 K1 is the one honest read-only re-attempt; these bytes are pinned for the first time.',
    },
    historicalUrls,
    seeds,
    captures,
    limitations,
  };
  if (captureStatus === 'blocked') {
    pin.blockedReason = entryCaptures.map((capture) => `${capture.requestedUrl}: ${capture.error || capture.status}`).join('; ') || 'no readable entry page';
  }

  const check = validateCardSourceCapturePin(pin, cardSource, { historicalUrls, cardCaptureSha256: pin.previousCardCapture.bytesSha256 });
  if (!check.ok) throw new Error(`capture pin is invalid: ${check.errors.join('; ')}`);

  fs.writeFileSync(pinPath, `${JSON.stringify(pin, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${relative(pinPath)}: ${captureStatus}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error && error.message ? error.message : 'card source capture failed'}\n`);
  process.exitCode = 1;
});

