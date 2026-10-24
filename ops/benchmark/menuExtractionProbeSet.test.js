'use strict';

// K4 regressions for the pinned capture loader (#59 / BE-21 review 6370840673).
// The fixture root is an in-memory map: no real capture file is read, no
// network is touched and every pin is verified the same way the probe does.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');

const {
  attachCaptureTexts,
  loadProbeSet,
  normalizeAcceptanceReference,
  normalizePrintedPrice,
} = require('./menuExtractionProbeSet');

const ROOT = path.resolve('C:/fixture-root');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function relativeOf(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function buildFixtures() {
  const files = new Map();
  const add = (relative, value) => files.set(relative, typeof value === 'string' ? value : JSON.stringify(value));

  const controlled = { version: '1.0.0', pinnedAt: '2026-10-21', sources: {} };
  for (const id of ['zuyd', 'andalous', 'pellens', 'chocolat']) {
    const bytes = `${id} pagina`;
    add(`ops/benchmark/output/reference-captures/${id}/01.html`, bytes);
    controlled.sources[id] = {
      label: id,
      captureStatus: 'captured',
      captures: [
        {
          order: 1,
          finalUrl: `https://${id}.example/`,
          kind: 'html',
          localPath: `ops/benchmark/output/reference-captures/${id}/01.html`,
          bytesSha256: sha256(bytes),
          captureStatus: 'captured',
        },
      ],
    };
  }
  add('ops/benchmark/reference-captures.json', controlled);

  const bardotBytes = 'bardot pdf';
  add('ops/benchmark/output/card-captures/bardot/03.pdf', bardotBytes);
  add('ops/benchmark/card-reference-captures.json', {
    sourceId: 'bardot',
    label: 'Brasserie Bardot',
    captureStatus: 'partially-verified',
    captures: [
      { requestedUrl: 'https://bardot.example/', kind: 'html', status: 'source-changed', error: 'source-changed' },
      {
        requestedUrl: 'https://bardot.example/menu.pdf',
        finalUrl: 'https://bardot.example/menu.pdf',
        kind: 'pdf',
        status: 'verified',
        localPath: 'ops/benchmark/output/card-captures/bardot/03.pdf',
        bytesSha256: sha256(bardotBytes),
      },
    ],
  });

  const wolfslaarBytes = 'wolfslaar pagina';
  add('ops/benchmark/output/card-captures/wolfslaar/02.html', wolfslaarBytes);
  add('ops/benchmark/card-reference-captures.wolfslaar.json', {
    sourceId: 'wolfslaar',
    label: 'Restaurant Wolfslaar',
    captureStatus: 'captured',
    captures: [
      {
        requestedUrl: 'https://wolfslaar.example/nl/menu-lunch',
        finalUrl: 'https://wolfslaar.example/nl/menu-lunch',
        kind: 'html',
        role: 'menu',
        status: 'captured',
        localPath: 'ops/benchmark/output/card-captures/wolfslaar/02.html',
        bytesSha256: sha256(wolfslaarBytes),
      },
    ],
  });

  const smeltBytes = 'smelt pdf';
  const blossemBytes = 'blossem html';
  add('ops/benchmark/output/smelt-menu.pdf', smeltBytes);
  add('ops/benchmark/output/blossem-live.html', blossemBytes);
  add('ops/benchmark/source-references.json', {
    sources: {
      smelt: {
        label: 'Smelt Breda',
        url: 'https://smelt.example/menu.pdf',
        kind: 'pdf',
        bytesSha256: sha256(smeltBytes),
        pageCount: 2,
        categories: [{ path: ['KAASFONDUE'], items: [{ name: 'Hollands', price: '27' }, { name: 'Truffel', price: '28.5' }] }],
      },
      blossem: {
        label: 'Blossem Breda',
        url: 'https://blossem.example/nl/restaurant',
        kind: 'html',
        bytesSha256: sha256(blossemBytes),
        categories: [{ path: ['BITES'], items: [{ name: 'Nibbit', price: '3.00' }] }],
      },
    },
  });

  for (const id of ['zuyd', 'andalous', 'pellens', 'chocolat', 'bardot', 'wolfslaar']) {
    add(`ops/benchmark/reference-references/${id}.json`, { label: id, menus: [{ title: id, categories: [] }] });
  }
  return files;
}

function readerFor(files) {
  return (file, encoding) => {
    const relative = relativeOf(file);
    if (!files.has(relative)) throw new Error(`missing fixture ${relative}`);
    const value = files.get(relative);
    return encoding ? value : Buffer.from(value);
  };
}

test('K4: printed whole and one-decimal amounts become euro cents without touching the reference file', () => {
  assert.equal(normalizePrintedPrice('27'), '27.00');
  assert.equal(normalizePrintedPrice('29.5'), '29.50');
  assert.equal(normalizePrintedPrice('4.50'), '4.50');
  assert.equal(normalizePrintedPrice('8,50'), '8.50');
  assert.equal(normalizePrintedPrice(null), null);

  const raw = { label: 'Smelt Breda', categories: [{ path: ['KAASFONDUE'], items: [{ name: 'Hollands', price: '27' }] }] };
  const snapshot = JSON.stringify(raw);
  const reference = normalizeAcceptanceReference(raw, 'smelt');
  assert.equal(JSON.stringify(raw), snapshot, 'the pinned reference object is never rewritten');
  assert.deepEqual(reference.menus[0].categories[0].items, [{ name: 'Hollands', price: '27.00' }]);
  assert.equal(reference.menus[0].title, 'Smelt Breda');
  assert.equal(reference.menus[0].captureKey, 'ops/benchmark/output/smelt-menu.pdf');
});

test('K4: every pinned capture is hash-verified and a changed or missing file is blocked, not skipped', () => {
  const files = buildFixtures();
  const set = loadProbeSet({ root: ROOT, readFile: readerFor(files), exists: (file) => files.has(relativeOf(file)) });
  assert.deepEqual(set.problems, []);
  assert.deepEqual(set.sources.map((source) => source.id), ['zuyd', 'andalous', 'pellens', 'chocolat', 'smelt', 'blossem', 'bardot', 'wolfslaar']);
  assert.equal(set.sources.every((source) => source.captureStatus === 'captured'), true);
  assert.equal(set.sources.find((source) => source.id === 'smelt').referenceItems, 2);
  assert.equal(set.sources.find((source) => source.id === 'bardot').captures[0].kind, 'pdf');

  const changed = buildFixtures();
  changed.set('ops/benchmark/output/blossem-live.html', 'andere bytes');
  const changedSet = loadProbeSet({ root: ROOT, readFile: readerFor(changed), exists: (file) => changed.has(relativeOf(file)) });
  const blossem = changedSet.sources.find((source) => source.id === 'blossem');
  assert.equal(blossem.captureStatus, 'blocked');
  assert.match(blossem.blockedReason, /SHA-256/);

  const missing = buildFixtures();
  missing.delete('ops/benchmark/output/reference-captures/pellens/01.html');
  const missingSet = loadProbeSet({ root: ROOT, readFile: readerFor(missing), exists: (file) => missing.has(relativeOf(file)) });
  assert.equal(
    missingSet.sources.find((source) => source.id === 'pellens').blockedReason,
    'missing local capture ops/benchmark/output/reference-captures/pellens/01.html',
  );
});

test('K4: a page without readable text blocks its source with that exact reason (no OCR fallback)', async () => {
  const files = buildFixtures();
  const set = loadProbeSet({ root: ROOT, readFile: readerFor(files), exists: (file) => files.has(relativeOf(file)) });
  const zuyd = set.sources.filter((source) => source.id === 'zuyd');
  await attachCaptureTexts(zuyd, {
    root: ROOT,
    readFile: readerFor(files),
    readText: async (capture) => {
      capture.text = 'gelezen tekst';
      return 'gelezen tekst';
    },
  });
  assert.equal(zuyd[0].captureStatus, 'captured');
  assert.equal(zuyd[0].captures[0].text, 'gelezen tekst');

  const empty = loadProbeSet({ root: ROOT, readFile: readerFor(files), exists: (file) => files.has(relativeOf(file)) }).sources.filter((source) => source.id === 'andalous');
  await attachCaptureTexts(empty, { root: ROOT, readFile: readerFor(files), readText: async () => '   ' });
  assert.equal(empty[0].captureStatus, 'blocked');
  assert.match(empty[0].blockedReason, /capture_no_text/);

  const scanned = loadProbeSet({ root: ROOT, readFile: readerFor(files), exists: (file) => files.has(relativeOf(file)) }).sources.filter((source) => source.id === 'pellens');
  await attachCaptureTexts(scanned, {
    root: ROOT,
    readFile: readerFor(files),
    readText: async () => {
      const error = new Error('no text layer');
      error.reason = 'pdf_no_text_layer';
      throw error;
    },
  });
  assert.equal(scanned[0].captureStatus, 'blocked');
  assert.match(scanned[0].blockedReason, /pdf_no_text_layer/);
});

test('K4: the loader and the harness never fetch, call a provider or write a capture', () => {
  const loader = require('node:fs').readFileSync(path.join(__dirname, 'menuExtractionProbeSet.js'), 'utf8');
  const probe = require('node:fs').readFileSync(path.join(__dirname, 'menuExtractionProbe.js'), 'utf8');
  for (const source of [loader, probe]) {
    assert.equal(/\bfetch\s*\(/.test(source), false);
    assert.equal(/require\('node:https?'\)/.test(source), false);
    assert.equal(/writeFileSync|createWriteStream/.test(source), false);
    assert.equal(source.includes('api.anthropic.com'), false);
  }
});
