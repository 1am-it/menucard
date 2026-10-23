'use strict';

// K4: the pinned capture loader for the bounded AI probe (#59 / BE-21 review
// 6370840673). It reads only files that already exist in this checkout:
//
//   - the five controlled reference sources (Zuyd, Andalous, Pellens,
//     Chocolat) from ops/benchmark/reference-captures.json;
//   - Bardot from ops/benchmark/card-reference-captures.json (only its
//     hash-verified PDF, exactly like the card measurement);
//   - Wolfslaar from ops/benchmark/card-reference-captures.wolfslaar.json;
//   - Smelt and Blossem from the hashes in ops/benchmark/source-references.json
//     and the two pinned local capture files the earlier probe produced.
//
// Every byte is verified against its pinned SHA-256 before use. A missing or
// changed file makes the source `blocked` with the exact reason; it is never
// silently skipped and never refetched here. The text of an HTML page is its
// visible text; a PDF must have a real text layer, otherwise it is reported as
// an honest limitation (no OCR in this round).
//
// No network, provider, key, database or write in this module.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { htmlVisibleText } = require('./referenceIntegrity');
const { extractDigitalPdfText } = require('../../src/lib/pdfTextExtraction');
const { referenceRows } = require('./referenceComparison');
const { PROBE_SOURCE_IDS } = require('./menuExtractionProbe');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const REFERENCE_CAPTURES = 'ops/benchmark/reference-captures.json';
const CARD_CAPTURES = 'ops/benchmark/card-reference-captures.json';
const WOLFSLAAR_CAPTURES = 'ops/benchmark/card-reference-captures.wolfslaar.json';
const SOURCE_REFERENCES = 'ops/benchmark/source-references.json';

// The two acceptance-set sources have no capture manifest of their own: their
// bytes and hashes are pinned in source-references.json and the earlier
// read-only probe left exactly these files in the gitignored output folder.
const LOCAL_ACCEPTANCE_CAPTURES = Object.freeze({
  smelt: 'ops/benchmark/output/smelt-menu.pdf',
  blossem: 'ops/benchmark/output/blossem-live.html',
});

const REFERENCE_FILES = Object.freeze({
  zuyd: 'ops/benchmark/reference-references/zuyd.json',
  andalous: 'ops/benchmark/reference-references/andalous.json',
  pellens: 'ops/benchmark/reference-references/pellens.json',
  chocolat: 'ops/benchmark/reference-references/chocolat.json',
  bardot: 'ops/benchmark/reference-references/bardot.json',
  wolfslaar: 'ops/benchmark/reference-references/wolfslaar.json',
  smelt: SOURCE_REFERENCES,
  blossem: SOURCE_REFERENCES,
});

const CAPTURE_MAX_BYTES = 15 * 1024 * 1024;
const CAPTURE_MAX_PAGES = 30;

function sha256Of(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function readJsonFile(readFile, file) {
  return JSON.parse(readFile(file, 'utf8'));
}

function fileIn(root, relative) {
  return path.join(root, relative.split('/').join(path.sep));
}

/**
 * Whole-euro and one-decimal printed amounts become euro cents for the
 * comparison only. The pinned reference file itself is never rewritten.
 */
function normalizePrintedPrice(price) {
  if (typeof price !== 'string' || price.trim().length === 0) return price;
  const value = price.trim().replace(',', '.');
  if (/^\d+$/.test(value)) return `${value}.00`;
  if (/^\d+\.\d$/.test(value)) return `${value}0`;
  return value;
}

/** The acceptance-set references (Smelt, Blossem) wrapped in the compare shape. */
function normalizeAcceptanceReference(raw, sourceId) {
  const label = raw && typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : sourceId;
  const categories = (raw && Array.isArray(raw.categories) ? raw.categories : []).map((category) => ({
    path: Array.isArray(category.path) ? [...category.path] : [],
    items: (Array.isArray(category.items) ? category.items : []).map((item) => ({
      name: item.name,
      price: normalizePrintedPrice(item.price),
    })),
  }));
  return {
    sourceId,
    label,
    note: 'Reference rows from ops/benchmark/source-references.json; printed whole/one-decimal amounts are read as euro cents for the comparison only.',
    menus: [
      {
        title: label,
        captureKey: LOCAL_ACCEPTANCE_CAPTURES[sourceId] || null,
        categories,
      },
    ],
  };
}

function loadReference(sourceId, readFile, root) {
  const relative = REFERENCE_FILES[sourceId];
  const bytes = readFile(fileIn(root, relative));
  const digest = sha256Of(bytes);
  if (sourceId === 'smelt' || sourceId === 'blossem') {
    const parsed = JSON.parse(bytes.toString('utf8'));
    const raw = parsed.sources && parsed.sources[sourceId];
    if (!raw) return { ok: false, reason: `${sourceId} is missing from ${SOURCE_REFERENCES}` };
    return { ok: true, path: relative, sha256: digest, reference: normalizeAcceptanceReference(raw, sourceId), expectedBytesSha256: raw.bytesSha256 || null };
  }
  return { ok: true, path: relative, sha256: digest, reference: JSON.parse(bytes.toString('utf8')) };
}

function capturesFromReferenceManifest(manifest, sourceId) {
  const entry = manifest && manifest.sources ? manifest.sources[sourceId] : null;
  if (!entry) return { ok: false, reason: `${sourceId} is missing from ${REFERENCE_CAPTURES}` };
  if (entry.captureStatus !== 'captured') {
    const first = Array.isArray(entry.captures) ? entry.captures[0] : null;
    return { ok: false, reason: entry.blockedReason || (first && first.error) || 'source not captured' };
  }
  const captures = (Array.isArray(entry.captures) ? entry.captures : [])
    .filter((capture) => capture && capture.captureStatus === 'captured')
    .map((capture, index) => ({
      id: `${sourceId}-${String(capture.order || index + 1).padStart(2, '0')}`,
      url: capture.finalUrl || capture.requestedUrl,
      kind: capture.kind,
      localPath: capture.localPath,
      bytesSha256: capture.bytesSha256,
      pageCount: Number.isInteger(capture.pageCount) ? capture.pageCount : null,
      role: capture.order === 1 ? 'entry' : 'menu',
    }));
  if (captures.length === 0) return { ok: false, reason: 'the pinned manifest holds no captured page' };
  return { ok: true, label: entry.label || sourceId, captures };
}

function capturesFromCardManifest(manifest, sourceId) {
  const captures = (Array.isArray(manifest && manifest.captures) ? manifest.captures : [])
    .filter((capture) => capture && (capture.status === 'verified' || capture.status === 'captured') && capture.localPath)
    .map((capture, index) => ({
      id: `${sourceId}-${String(index + 1).padStart(2, '0')}`,
      url: capture.finalUrl || capture.requestedUrl,
      kind: capture.kind,
      localPath: capture.localPath,
      bytesSha256: capture.bytesSha256,
      pageCount: Number.isInteger(capture.pageCount) ? capture.pageCount : null,
      role: capture.role || (index === 0 ? 'entry' : 'menu'),
    }));
  if (captures.length === 0) {
    const first = manifest && Array.isArray(manifest.captures) ? manifest.captures[0] : null;
    return { ok: false, reason: (first && (first.error || first.reason)) || 'source not captured' };
  }
  return { ok: true, label: (manifest && manifest.label) || sourceId, captures };
}

function captureFromAcceptanceSet(readFile, root, sourceId) {
  let parsed;
  try {
    parsed = JSON.parse(readFile(fileIn(root, SOURCE_REFERENCES), 'utf8'));
  } catch {
    return { ok: false, reason: `${SOURCE_REFERENCES} cannot be read` };
  }
  const raw = parsed.sources ? parsed.sources[sourceId] : null;
  const localPath = LOCAL_ACCEPTANCE_CAPTURES[sourceId];
  if (!raw || !localPath) return { ok: false, reason: `${sourceId} is missing from ${SOURCE_REFERENCES}` };
  return {
    ok: true,
    label: raw.label || sourceId,
    captures: [
      {
        id: `${sourceId}-01`,
        url: raw.url,
        kind: raw.kind,
        localPath,
        bytesSha256: raw.bytesSha256,
        pageCount: Number.isInteger(raw.pageCount) ? raw.pageCount : null,
        role: 'menu',
      },
    ],
  };
}

function verifyCaptureBytes(captures, { root, readFile, exists }) {
  for (const capture of captures) {
    const file = fileIn(root, capture.localPath);
    if (!exists(file)) return { ok: false, reason: `missing local capture ${capture.localPath}` };
    let bytes;
    try {
      bytes = readFile(file);
    } catch {
      return { ok: false, reason: `cannot read ${capture.localPath}` };
    }
    if (bytes.length > CAPTURE_MAX_BYTES) return { ok: false, reason: `${capture.localPath} exceeds the ${CAPTURE_MAX_BYTES}-byte limit` };
    const digest = sha256Of(bytes);
    if (digest !== capture.bytesSha256) {
      return { ok: false, reason: `${capture.localPath} has SHA-256 ${digest}, pinned ${capture.bytesSha256}` };
    }
  }
  return { ok: true };
}

/**
 * Metadata for all eight probe sources, with every pinned byte verified.
 * A source that cannot be read stays in the list as `blocked` with its reason.
 */
function loadProbeSet({ root = REPO_ROOT, readFile = fs.readFileSync, exists = fs.existsSync } = {}) {
  const problems = [];
  const readManifest = (relative) => {
    try {
      return JSON.parse(readFile(fileIn(root, relative), 'utf8'));
    } catch {
      problems.push(`${relative} cannot be read`);
      return null;
    }
  };
  const referenceManifest = readManifest(REFERENCE_CAPTURES);
  const cardManifest = readManifest(CARD_CAPTURES);
  const wolfslaarManifest = readManifest(WOLFSLAAR_CAPTURES);

  const sources = PROBE_SOURCE_IDS.map((sourceId) => {
    let captureSet;
    if (['zuyd', 'andalous', 'pellens', 'chocolat'].includes(sourceId)) {
      captureSet = referenceManifest
        ? capturesFromReferenceManifest(referenceManifest, sourceId)
        : { ok: false, reason: `${REFERENCE_CAPTURES} cannot be read` };
    } else if (sourceId === 'bardot') {
      captureSet = cardManifest ? capturesFromCardManifest(cardManifest, sourceId) : { ok: false, reason: `${CARD_CAPTURES} cannot be read` };
    } else if (sourceId === 'wolfslaar') {
      captureSet = wolfslaarManifest
        ? capturesFromCardManifest(wolfslaarManifest, sourceId)
        : { ok: false, reason: `${WOLFSLAAR_CAPTURES} cannot be read` };
    } else {
      captureSet = captureFromAcceptanceSet(readFile, root, sourceId);
    }

    const reference = loadReference(sourceId, readFile, root);
    const source = {
      id: sourceId,
      label: captureSet.label || (reference.ok && reference.reference.label) || sourceId,
      captureStatus: 'blocked',
      blockedReason: captureSet.ok ? null : captureSet.reason,
      captures: captureSet.ok ? captureSet.captures : [],
      referenceStatus: reference.ok ? 'loaded' : 'blocked',
      referencePath: reference.ok ? reference.path : null,
      referenceSha256: reference.ok ? reference.sha256 : null,
      reference: reference.ok ? reference.reference : null,
      referenceItems: reference.ok ? referenceRows(reference.reference).length : 0,
    };
    if (!reference.ok) problems.push(`${sourceId}: ${reference.reason}`);
    if (captureSet.ok) {
      const verified = verifyCaptureBytes(captureSet.captures, { root, readFile, exists });
      if (verified.ok) {
        source.captureStatus = 'captured';
        source.blockedReason = null;
      } else {
        source.blockedReason = verified.reason;
        source.captures = [];
      }
    }
    return source;
  });

  return { root, sources, problems };
}

/** The visible text of one pinned capture; a PDF must have a real text layer. */
async function captureTextFromBytes(capture, bytes) {
  if (capture.kind === 'html') return htmlVisibleText(bytes.toString('utf8'));
  if (capture.kind === 'pdf') {
    const extracted = await extractDigitalPdfText(bytes, { maxBytes: CAPTURE_MAX_BYTES, maxPages: CAPTURE_MAX_PAGES });
    return extracted.text;
  }
  const error = new Error(`unsupported capture kind ${capture.kind}`);
  error.code = 'capture_unsupported_kind';
  throw error;
}

/**
 * Reads the text of every captured page. A page that cannot be read blocks the
 * whole source with that exact reason (no OCR, no refetch, no partial silence).
 */
async function attachCaptureTexts(sources, { root = REPO_ROOT, readFile = fs.readFileSync, readText = captureTextFromBytes } = {}) {
  for (const source of Array.isArray(sources) ? sources : []) {
    if (source.captureStatus !== 'captured') continue;
    let failure = null;
    for (const capture of source.captures) {
      try {
        const bytes = readFile(fileIn(root, capture.localPath));
        const text = await readText(capture, bytes);
        if (typeof text !== 'string' || text.trim().length === 0) {
          failure = { capture: capture.id, reason: 'capture_no_text' };
          break;
        }
        capture.text = text;
        capture.textChars = text.length;
      } catch (err) {
        failure = { capture: capture.id, reason: (err && (err.reason || err.code)) || 'capture_unreadable' };
        break;
      }
    }
    if (failure) {
      source.captureStatus = 'blocked';
      source.blockedReason = `${failure.capture}: ${failure.reason}`;
      source.captures = [];
    }
  }
  return sources;
}

module.exports = {
  CAPTURE_MAX_BYTES,
  CAPTURE_MAX_PAGES,
  CARD_CAPTURES,
  LOCAL_ACCEPTANCE_CAPTURES,
  REFERENCE_CAPTURES,
  REFERENCE_FILES,
  REPO_ROOT,
  SOURCE_REFERENCES,
  WOLFSLAAR_CAPTURES,
  attachCaptureTexts,
  captureTextFromBytes,
  loadProbeSet,
  loadReference,
  normalizeAcceptanceReference,
  normalizePrintedPrice,
  sha256Of,
  verifyCaptureBytes,
};
