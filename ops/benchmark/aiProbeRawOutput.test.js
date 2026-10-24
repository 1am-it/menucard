'use strict';

// Q1 of the Delivery Lead order for #59 / BE-21 (review 6375125413): the saved
// literal answer. Offline: every test writes to its own temp folder, no key, no
// network, no provider.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  MAX_RAW_ANSWER_BYTES,
  RAW_OUTPUT_SCHEMA_VERSION,
  rawOutputFileName,
  readRawAnswer,
  sha256,
  writeRawAnswer,
} = require('./aiProbeRawOutput');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function tempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'menucard-raw-'));
}

const answer = '{"menus":[],"coverage":{"status":"no_items"}}';

test('Q1: the answer is written in the given folder, with its hash in the name', () => {
  const directory = tempDirectory();
  const saved = writeRawAnswer({ directory, root: REPO_ROOT, sourceId: 'zuyd', run: 1, chunkIndex: 2, call: 3, text: answer });
  assert.equal(RAW_OUTPUT_SCHEMA_VERSION, 'menu-extraction-ai-probe-raw/v1');
  assert.equal(saved.sha256, sha256(answer));
  assert.equal(saved.chars, answer.length);
  assert.equal(saved.bytes, Buffer.byteLength(answer, 'utf8'));
  assert.equal(saved.alreadySaved, false);
  assert.match(path.basename(saved.file), /^zuyd-r1-c2-call3-[0-9a-f]{12}\.json\.txt$/);
  assert.equal(fs.readFileSync(saved.absoluteFile, 'utf8'), answer);
  // The reference is repository-relative, so a report is machine independent.
  assert.equal(path.isAbsolute(saved.file), false);
  assert.equal(saved.file.includes('\\'), false);
});

test('Q1: identical content is not written twice and different content gets its own file', () => {
  const directory = tempDirectory();
  const first = writeRawAnswer({ directory, root: REPO_ROOT, sourceId: 'zuyd', run: 1, chunkIndex: 0, call: 1, text: answer });
  const again = writeRawAnswer({ directory, root: REPO_ROOT, sourceId: 'zuyd', run: 1, chunkIndex: 0, call: 1, text: answer });
  assert.equal(again.alreadySaved, true);
  assert.equal(again.file, first.file);
  assert.equal(fs.readdirSync(directory).length, 1);
  const other = writeRawAnswer({ directory, root: REPO_ROOT, sourceId: 'zuyd', run: 1, chunkIndex: 0, call: 1, text: `${answer} ` });
  assert.notEqual(other.file, first.file);
  assert.equal(fs.readdirSync(directory).length, 2);
});

test('Q1: an empty answer, an unsafe source id and an oversized answer are refused', () => {
  const directory = tempDirectory();
  const base = { directory, root: REPO_ROOT, sourceId: 'zuyd', run: 1, chunkIndex: 0, call: 1 };
  assert.throws(() => writeRawAnswer({ ...base, text: '   ' }), /answer text/);
  assert.throws(() => writeRawAnswer({ ...base, text: answer, sourceId: '../escape' }), /safe source id/);
  assert.throws(() => writeRawAnswer({ ...base, text: answer, run: -1 }), /non-negative integer/);
  const huge = 'x'.repeat(MAX_RAW_ANSWER_BYTES + 1);
  assert.throws(() => writeRawAnswer({ ...base, text: huge }), /exceeds/);
  assert.equal(fs.readdirSync(directory).length, 0);
});

test('Q1: the name is deterministic and a hash mismatch is an integrity error', () => {
  const hash = sha256(answer);
  const name = rawOutputFileName({ sourceId: 'zuyd', run: 2, chunkIndex: 1, call: 9, hash });
  assert.equal(name, rawOutputFileName({ sourceId: 'zuyd', run: 2, chunkIndex: 1, call: 9, hash }));
  assert.match(name, /^zuyd-r2-c1-call9-[0-9a-f]{12}\.json\.txt$/);
  const directory = tempDirectory();
  const saved = writeRawAnswer({ directory, root: REPO_ROOT, sourceId: 'zuyd', run: 2, chunkIndex: 1, call: 9, text: answer });
  assert.equal(readRawAnswer({ file: saved.file, root: REPO_ROOT, expectedHash: saved.sha256 }).text, answer);
  assert.throws(() => readRawAnswer({ file: saved.file, root: REPO_ROOT, expectedHash: 'f'.repeat(64) }), /does not match/);
});

test('Q1: a failed write leaves no half answer under the evidence name', () => {
  const directory = tempDirectory();
  assert.throws(
    () =>
      writeRawAnswer({
        directory,
        root: REPO_ROOT,
        sourceId: 'zuyd',
        run: 1,
        chunkIndex: 0,
        call: 1,
        text: answer,
        rename: () => {
          throw new Error('rename refused');
        },
      }),
    /rename refused/,
  );
  assert.equal(fs.readdirSync(directory).filter((name) => name.endsWith('.json.txt')).length, 0);
});
