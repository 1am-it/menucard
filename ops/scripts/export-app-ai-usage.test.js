'use strict';

// #59 K4 (Lead-bevinding F6) — regressies op het ops-exportscript.
//
// Geen database en geen netwerk: de client is een fake en het schrijven gebeurt
// in een tijdelijke map. Bewezen wordt dat het script alleen een lokale
// database accepteert, dat het document geldig is, en dat een mislukte
// schrijfactie het bestaande bestand met rust laat.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { validateUsageExport } = require('../../src/lib/manualMenuImportUsage');
const {
  DEFAULT_OUT,
  localConfigFromEnv,
  parseArgs,
  writeJsonAtomically,
  runExport,
} = require('./export-app-ai-usage');

const NOW = new Date('2026-10-23T12:00:00.000Z');

function provenance(aiName = 'Claude') {
  return {
    kind: 'handmatige_ai_import',
    aiName,
    importedAt: '2026-10-22T21:09:43.345Z',
    rows: [{ action: 'drop' }],
  };
}

function fakeClient(rows) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => Promise.resolve({ data: rows, error: null }),
  };
  return { from: () => builder };
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'app-ai-usage-'));
}

test('K2: het standaardpad is het gitignored benchmarkpad', () => {
  assert.equal(DEFAULT_OUT, 'ops/benchmark/output/app-ai-usage.json');
  const ignore = fs.readFileSync(path.resolve(__dirname, '..', '..', '.gitignore'), 'utf8');
  assert.ok(ignore.includes('ops/benchmark/output/'));
  assert.deepEqual(parseArgs(['--out', 'x.json', '--ander']), { out: 'x.json', ander: undefined });
});

test('K2: alleen een lokale database en volledige configuratie', () => {
  assert.equal(localConfigFromEnv({}).code, 'config_missing');
  assert.equal(localConfigFromEnv({ SUPABASE_URL: 'http://127.0.0.1:54331' }).code, 'config_missing');
  const missingKey = localConfigFromEnv({ SUPABASE_URL: 'http://127.0.0.1:54331', SUPABASE_SERVICE_ROLE_KEY: ' ' });
  assert.equal(missingKey.code, 'config_missing');
  assert.equal(localConfigFromEnv({ SUPABASE_URL: 'geen url', SUPABASE_SERVICE_ROLE_KEY: 'k' }).code, 'config_invalid');
  assert.equal(
    localConfigFromEnv({ SUPABASE_URL: 'ftp://127.0.0.1/x', SUPABASE_SERVICE_ROLE_KEY: 'k' }).code,
    'config_invalid',
  );
  const remote = localConfigFromEnv({ SUPABASE_URL: 'https://abcdefgh.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' });
  assert.equal(remote.code, 'not_local');
  assert.equal(remote.message.includes('abcdefgh.supabase.co'), true);
  const local = localConfigFromEnv({ SUPABASE_URL: 'http://127.0.0.1:54331', SUPABASE_SERVICE_ROLE_KEY: 'lokale-sleutel' });
  assert.deepEqual(local, { ok: true, url: 'http://127.0.0.1:54331', key: 'lokale-sleutel' });
  assert.equal(localConfigFromEnv({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_SERVICE_ROLE_KEY: 'k' }).ok, true);
});

test('K4: de schrijfactie is atomisch en laat geen tijdelijk bestand achter', () => {
  const dir = tempDir();
  const file = path.join(dir, 'nested', 'app-ai-usage.json');
  const written = writeJsonAtomically({ file, text: '{"een":1}\n' });
  assert.equal(written.ok, true);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"een":1}\n');
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['app-ai-usage.json']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('K4: een mislukte schrijfactie bewaart het bestaande bestand', () => {
  const dir = tempDir();
  const file = path.join(dir, 'app-ai-usage.json');
  fs.writeFileSync(file, '{"oud":true}\n', 'utf8');
  const failingWrite = {
    mkdirSync: fs.mkdirSync,
    renameSync: fs.renameSync,
    unlinkSync: fs.unlinkSync,
    writeFileSync: () => {
      throw new Error('schijf vol');
    },
  };
  const written = writeJsonAtomically({ file, text: '{"nieuw":true}\n', fsImpl: failingWrite });
  assert.equal(written.ok, false);
  assert.equal(written.code, 'write_failed');
  assert.equal(fs.readFileSync(file, 'utf8'), '{"oud":true}\n');
  assert.deepEqual(fs.readdirSync(dir), ['app-ai-usage.json']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('K2: het script schrijft een geldig metagegevensdocument', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'app-ai-usage.json');
  const result = await runExport({
    supabase: fakeClient([
      { id: 3, captured_content: { importProvenance: provenance('Claude') } },
      { id: 4, captured_content: { importProvenance: provenance('ChatGPT') } },
    ]),
    generatedAt: NOW,
    out: file,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(validateUsageExport(doc), []);
  assert.equal(doc.totals.conceptSaved, 2);
  assert.equal(doc.totals.promptCreated, 'niet bijgehouden');
  assert.equal(doc.costs.label, 'via abonnement, niet gemeten');
  assert.equal(doc.reviewOutcomes.omittedRows, 2);
  assert.equal(doc.source.kind, 'durable');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('K4: een leesfout schrijft niets en houdt het oude bestand', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'app-ai-usage.json');
  fs.writeFileSync(file, '{"oud":true}\n', 'utf8');
  const brokenClient = {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({ limit: () => Promise.resolve({ data: null, error: { message: 'neer' } }) }),
        }),
      }),
    }),
  };
  const result = await runExport({ supabase: brokenClient, generatedAt: NOW, out: file });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'read_failed');
  assert.equal(fs.readFileSync(file, 'utf8'), '{"oud":true}\n');
  assert.deepEqual(fs.readdirSync(dir), ['app-ai-usage.json']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('K4: zonder client wordt niet geschreven', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'app-ai-usage.json');
  const noClient = await runExport({ supabase: null, generatedAt: NOW, out: file });
  assert.equal(noClient.ok, false);
  assert.equal(noClient.code, 'no_client');
  assert.equal(fs.existsSync(file), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
