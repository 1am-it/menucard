'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');
const { createDbKeepAlive, KEEPALIVE_TABLE } = require('./dbKeepAlive');

function fakeClient(result, calls = []) {
  return () => ({
    from(table) {
      calls.push(['from', table]);
      return {
        select(columns, options) {
          calls.push(['select', columns, options]);
          return {
            limit(n) {
              calls.push(['limit', n]);
              return typeof result === 'function' ? result() : Promise.resolve(result);
            },
          };
        },
      };
    },
  });
}

test('a successful head-only read answers ok without any data', async () => {
  const calls = [];
  const { ping } = createDbKeepAlive({ getClient: fakeClient({ error: null, count: 3, data: null }, calls) });
  assert.deepEqual(await ping(), { status: 200, body: { ok: true } });
  assert.deepEqual(calls[0], ['from', KEEPALIVE_TABLE]);
  assert.deepEqual(calls[1][2], { head: true, count: 'exact' });
});

test('a database error is 503 and leaks no details', async () => {
  const { ping } = createDbKeepAlive({ getClient: fakeClient({ error: { message: 'tenant not found' } }) });
  assert.deepEqual(await ping(), { status: 503, body: { ok: false } });
});

test('a thrown error (e.g. missing configuration) is 503, never a crash', async () => {
  const { ping } = createDbKeepAlive({ getClient: () => { throw new Error('Supabase is not configured'); } });
  assert.deepEqual(await ping(), { status: 503, body: { ok: false } });
});

test('vercel.json schedules the keep-alive once a day (Hobby plan limit)', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'vercel.json'), 'utf8'));
  const job = config.crons.find((c) => c.path === '/api/health/db');
  assert.ok(job, 'the keep-alive cron exists');
  assert.match(job.schedule, /^\d+ \d+ \* \* \*$/);
});
