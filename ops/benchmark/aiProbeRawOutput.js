'use strict';

// Q1 of the Delivery Lead order for #59 / BE-21 (review 6375125413): keep the
// literal JSON answer of every live provider call.
//
// Why: the probe stored only the validator's verdict, so a rejected answer
// ("evidence.quote is not present in the cited source") could not be inspected
// afterwards. The run that produced the finding is gone; the next rejected
// answer must not be.
//
// Safety boundaries:
//   - only the `text` block of an answer is written (`answerText` from
//     src/lib/menuExtractionAnthropicCall.js). A `thinking` block, a signature,
//     a request header or a key never reaches this module;
//   - the content is public menu text, no credential and no prompt;
//   - the file lives in the gitignored `ops/benchmark/output/` tree, and the
//     name carries a content hash so two different answers of the same call can
//     never silently overwrite each other;
//   - the write is atomic (temp file + rename) and idempotent for identical
//     content, so a resumed or repeated run does not duplicate evidence.

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const RAW_OUTPUT_SCHEMA_VERSION = 'menu-extraction-ai-probe-raw/v1';
// An answer is a JSON document of at most 32,000 output tokens (~130 KB). The
// ceiling is a refusal guard against an absurd body, not a target.
const MAX_RAW_ANSWER_BYTES = 4 * 1024 * 1024;
const SOURCE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function assertNonNegativeInteger(value, name) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
}

/**
 * The file name of one answer: source, run, chunk, call and the first 12
 * characters of the content hash. The hash makes the reference verifiable and
 * keeps two different answers apart; the identifiers keep it findable.
 */
function rawOutputFileName({ sourceId, run, chunkIndex, call, hash }) {
  if (typeof sourceId !== 'string' || !SOURCE_ID_PATTERN.test(sourceId)) throw new Error('the raw output needs a safe source id');
  assertNonNegativeInteger(run, 'run');
  assertNonNegativeInteger(chunkIndex, 'chunkIndex');
  assertNonNegativeInteger(call, 'call');
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) throw new Error('the raw output needs a SHA-256');
  return `${sourceId}-r${run}-c${chunkIndex}-call${call}-${hash.slice(0, 12)}${'.json.txt'}`;
}

function relativeFile(file, root) {
  const base = path.resolve(root || process.cwd());
  return path.relative(base, path.resolve(file)).split(path.sep).join('/');
}

/**
 * Writes one answer and returns the reference for the report and the call log.
 * Identical content that is already there is left alone (`alreadySaved`).
 */
function writeRawAnswer({ directory, root, sourceId, run, chunkIndex, call, text, writeFile = fs.writeFileSync, rename = fs.renameSync } = {}) {
  if (typeof directory !== 'string' || directory.length === 0) throw new Error('the raw output needs a directory');
  if (typeof text !== 'string' || text.trim().length === 0) throw new Error('the raw output needs the answer text');
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > MAX_RAW_ANSWER_BYTES) throw new Error(`the raw answer exceeds ${MAX_RAW_ANSWER_BYTES} bytes`);
  const hash = sha256(text);
  const file = path.join(directory, rawOutputFileName({ sourceId, run, chunkIndex, call, hash }));
  fs.mkdirSync(directory, { recursive: true });
  let alreadySaved = false;
  if (fs.existsSync(file)) {
    alreadySaved = fs.readFileSync(file, 'utf8') === text;
    if (!alreadySaved) throw new Error(`the raw output file ${path.basename(file)} exists with other content`);
  } else {
    const temp = `${file}.${process.pid}.tmp`;
    writeFile(temp, text, 'utf8');
    rename(temp, file);
  }
  return {
    file: relativeFile(file, root),
    absoluteFile: path.resolve(file),
    sha256: hash,
    chars: text.length,
    bytes,
    alreadySaved,
  };
}

/**
 * Reads a saved answer back and verifies it against the recorded hash. A wrong
 * hash is an integrity error, not a warning: the diagnosis must run on the
 * answer that was actually rejected.
 */
function readRawAnswer({ file, root, expectedHash } = {}) {
  if (typeof file !== 'string' || file.length === 0) throw new Error('the raw output needs a file');
  const absolute = path.isAbsolute(file) ? file : path.resolve(root || process.cwd(), file);
  const text = fs.readFileSync(absolute, 'utf8');
  const hash = sha256(text);
  if (typeof expectedHash === 'string' && expectedHash.length > 0 && expectedHash !== hash) {
    throw new Error(`the raw output file ${file} does not match its recorded SHA-256`);
  }
  return { text, hash, absoluteFile: absolute, bytes: Buffer.byteLength(text, 'utf8') };
}

module.exports = {
  MAX_RAW_ANSWER_BYTES,
  RAW_OUTPUT_SCHEMA_VERSION,
  rawOutputFileName,
  readRawAnswer,
  relativeFile,
  sha256,
  writeRawAnswer,
};
