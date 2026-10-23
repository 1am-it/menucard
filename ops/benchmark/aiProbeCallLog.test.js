'use strict';

// L1 regressions for the per-call JSONL log (#59 / BE-21, review 6373183699).
// Offline only: a temporary file, no key, no network, no provider.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { CALL_LOG_SCHEMA_VERSION, createCallLog, pickRecord, readCallLog, toLine } = require('./aiProbeCallLog');

function temporaryFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'menucard-call-log-')), 'nested', 'calls.jsonl');
}

test('L1: a line carries only the whitelisted fields and a fixed schema version', () => {
  const line = toLine({
    call: 3,
    sourceId: 'smelt',
    run: 2,
    costEurCents: 4,
    costUnknown: false,
    usage: { inputTokens: 20_000, outputTokens: 8_000 },
    at: '2026-10-23T20:00:00.000Z',
    // An unknown field is dropped; a credential field is refused (next test).
    notes: 'not part of the record',
    unknownField: 1,
  });
  const record = JSON.parse(line);
  assert.equal(record.schemaVersion, CALL_LOG_SCHEMA_VERSION);
  assert.equal(record.at, '2026-10-23T20:00:00.000Z');
  assert.equal(record.call, 3);
  assert.equal(record.costEurCents, 4);
  assert.equal(Object.prototype.hasOwnProperty.call(record, 'notes'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(record, 'unknownField'), false);
  assert.equal(line.endsWith('\n'), true);
});

test('L1: a credential or a header is refused by name, not silently dropped', () => {
  const file = temporaryFile();
  const log = createCallLog({ file });
  assert.throws(() => log.append({ sourceId: 'smelt', apiKey: 'sk-never-written' }), /refuses the field "apiKey"/);
  assert.throws(() => log.append({ sourceId: 'smelt', headers: { authorization: 'Bearer x' } }), /refuses the field "headers"/);
  assert.throws(() => log.append({ sourceId: 'smelt', prompt: 'source text' }), /refuses the field "prompt"/);
  assert.equal(fs.existsSync(file), false, 'a refused record never touches the file');
});

test('L1: every append is one line on disk, also for a nested output folder', () => {
  const file = temporaryFile();
  const log = createCallLog({ file });
  log.append({ call: 1, sourceId: 'smelt', ok: true, costEurCents: 1 });
  log.append({ call: 2, sourceId: 'blossem', ok: false, reason: 'timeout', costUnknown: true });
  assert.equal(log.lines, 2);
  const text = fs.readFileSync(file, 'utf8');
  assert.equal(text.split('\n').filter(Boolean).length, 2);
  const read = readCallLog(file);
  assert.equal(read.lines, 2);
  assert.equal(read.records[1].reason, 'timeout');
  assert.equal(read.partial, null);
});

test('L1: a partial trailing line from an interrupted run is reported, never parsed', () => {
  const file = temporaryFile();
  const log = createCallLog({ file });
  log.append({ call: 1, sourceId: 'smelt', ok: true });
  fs.appendFileSync(file, '{"call":2,"sourceId":"bloss');
  const read = readCallLog(file);
  assert.equal(read.records.length, 1);
  assert.match(read.partial, /^\{"call":2/);
});

test('L1: a missing log file is empty, not an error', () => {
  const read = readCallLog(path.join(os.tmpdir(), 'menucard-does-not-exist', 'calls.jsonl'));
  assert.deepEqual(read.records, []);
  assert.equal(read.partial, null);
  assert.equal(read.lines, 0);
});

test('L1: the field whitelist keeps provider metadata and drops everything else', () => {
  const picked = pickRecord({ requestId: 'req_1', httpStatus: 529, unknownField: 1, stopReason: 'refusal' });
  assert.deepEqual(picked, { requestId: 'req_1', httpStatus: 529, stopReason: 'refusal' });
});
