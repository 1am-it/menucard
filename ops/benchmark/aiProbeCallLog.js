'use strict';

// L1 of the Delivery Lead order for #59 / BE-21 (review 6373183699): one durable
// line per provider call, written immediately after that call.
//
// Why a separate file next to the report: `ai-probe-report.json` is only
// rewritten with a whole run's results, so an interrupted run (the first live
// run was stopped after ~11 minutes) lost every per-call fact. A JSONL line is
// appended right after its call and flushed, so an interruption can at most lose
// the call that was still running.
//
// Safety boundaries:
//   - only the whitelisted fields below are ever serialised. A key, an
//     `Authorization` header or a raw request body cannot reach the file, even
//     if a caller passes it in;
//   - no source text, no prompt and no response body — only identifiers,
//     provider-reported numbers and error metadata. Q1 of review 6375125413
//     adds a reference to the saved answer (`rawOutputFile` + hash + length);
//     the answer text itself stays in its own gitignored file;
//   - one line is one `writeSync` on an `O_APPEND` handle, followed by fsync.
//     That keeps an appended line intact; a hard kill can leave a partial
//     trailing line, which `readCallLog` ignores on purpose.

const fs = require('node:fs');
const path = require('node:path');

const CALL_LOG_SCHEMA_VERSION = 'menu-extraction-ai-probe-call/v1';

const RECORD_FIELDS = Object.freeze([
  'schemaVersion',
  'at',
  'kind',
  'call',
  'sourceId',
  'run',
  'chunkIndex',
  'captureIds',
  'ok',
  'reason',
  'errorCode',
  'httpStatus',
  'stopReason',
  'usage',
  'costEurCents',
  'costUnknown',
  'durationMs',
  'requestId',
  'messageId',
  'provider',
  'model',
  'transport',
  // M1-M3 of review 6373786786: the output mode and the error identity are part
  // of the audit trail. `errorMessage` is sanitised and capped upstream and is
  // never a source text, prompt or header.
  'outputMode',
  'errorClass',
  'errorType',
  'errorMessage',
  'errorCause',
  'deadlineHit',
  'protocolHash',
  'stopCode',
  'code',
  'detail',
  // N3 of review 6374528099: how much of the billed output went to reasoning,
  // and which block types the answer had. Numbers and type names only.
  'thinkingTokens',
  'contentBlockTypes',
  // Q1 of review 6375125413: the reference to the saved literal answer. The
  // answer text itself is never inlined here: the path, its hash and its length
  // are enough to find and verify the file, and they keep one line readable.
  'rawOutputFile',
  'rawOutputSha256',
  'rawOutputChars',
  'rawOutputError',
]);

// Field names that would carry a credential or a request header. Refusing them
// by name makes the boundary explicit instead of relying on review. N3 adds the
// reasoning text and the response body to that list: only `thinkingTokens` and
// `contentBlockTypes` may be logged, never the thinking itself.
const FORBIDDEN_KEYS = Object.freeze([
  'key',
  'apiKey',
  'api_key',
  'authorization',
  'headers',
  'x-api-key',
  'body',
  'prompt',
  'system',
  'thinking',
  'thinkingText',
  'content',
]);

function pickRecord(record) {
  const picked = {};
  for (const field of RECORD_FIELDS) {
    if (record && Object.prototype.hasOwnProperty.call(record, field) && record[field] !== undefined) {
      picked[field] = record[field];
    }
  }
  return picked;
}

function assertNoForbiddenKeys(record) {
  if (!record || typeof record !== 'object') return;
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_KEYS.includes(key)) throw new Error(`the call log refuses the field "${key}"`);
  }
}

/** The exact line that will be appended, without writing it. */
function toLine(record) {
  assertNoForbiddenKeys(record);
  const now = new Date().toISOString();
  const picked = pickRecord({ ...record, schemaVersion: CALL_LOG_SCHEMA_VERSION, at: record && record.at ? record.at : now });
  return `${JSON.stringify(picked)}\n`;
}

/** One O_APPEND write plus fsync: a line is either there or not there. */
function appendLine(file, line) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, 'a');
  try {
    fs.writeSync(fd, line);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function createCallLog({ file, append = appendLine } = {}) {
  if (typeof file !== 'string' || file.length === 0) throw new Error('the call log needs a file path');
  if (typeof append !== 'function') throw new Error('the call log needs an append function');
  let lines = 0;
  return {
    file,
    get lines() {
      return lines;
    },
    append(record) {
      const line = toLine(record);
      append(file, line);
      lines += 1;
      return line;
    },
  };
}

/**
 * Reads the log back. A trailing line without a newline is a partial write from
 * an interrupted run and is reported, never parsed as a record.
 */
function readCallLog(file) {
  if (!fs.existsSync(file)) return { records: [], partial: null, lines: 0 };
  const text = fs.readFileSync(file, 'utf8');
  const endsWithNewline = text.endsWith('\n');
  const raw = text.split('\n').filter((line) => line.length > 0);
  const records = [];
  let partial = null;
  raw.forEach((line, index) => {
    const isLast = index === raw.length - 1;
    if (isLast && !endsWithNewline) {
      partial = line;
      return;
    }
    records.push(JSON.parse(line));
  });
  return { records, partial, lines: records.length };
}

module.exports = {
  CALL_LOG_SCHEMA_VERSION,
  FORBIDDEN_KEYS,
  RECORD_FIELDS,
  appendLine,
  createCallLog,
  pickRecord,
  readCallLog,
  toLine,
};
