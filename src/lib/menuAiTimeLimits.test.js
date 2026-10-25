'use strict';

// Y1 of the Delivery Lead review 6381657192 (issue #59 / PR #60): the AI
// reading must fit inside the serverless function with a wide margin around the
// measured worst case, and that decision must be backed by the official Vercel
// duration limits instead of the old 60 s copied from the batch route.
//
// This test reads the real route, the real AI limits and the implementation
// guide. It makes no network call, uses no key and changes no project setting.
// Measured live-run 2 (one document per call): andalous 46.8 s, zuyd 41.5 s,
// smelt 38.8 s.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { AI_LIMITS } = require('./menuAiImport');

const ROOT = path.resolve(__dirname, '..', '..');
const ROUTE_PATH = path.join(ROOT, 'app', 'api', 'internal', 'v1', 'menu-ai-import', 'route.js');
const NEXT_CONFIG_PATH = path.join(ROOT, 'next.config.js');
const GUIDE_PATH = path.join(ROOT, 'docs', 'guides', 'menu-extraction-implementation.md');
const VERCEL_CONFIG_PATH = path.join(ROOT, 'vercel.json');

const MEASURED_MAX_MS = 46_800;
const FUNCTION_MS = 300_000;

test('Y1: the AI route allows 300 s and the provider call stops at 120 s', () => {
  const route = fs.readFileSync(ROUTE_PATH, 'utf8');
  const declared = route.match(/export const maxDuration = (\d+)/);
  assert.ok(declared, 'the route exports maxDuration');
  assert.equal(Number(declared[1]), FUNCTION_MS / 1000);
  assert.doesNotMatch(route, /export const runtime\s*=\s*['"]edge['"]/, 'the documented Node.js duration limits apply');

  assert.equal(AI_LIMITS.callTimeoutMs, 120_000);
  assert.equal(AI_LIMITS.jobDeadlineMs, 150_000);
  assert.equal(AI_LIMITS.maxRetries, 0, 'no automatic retry, so no double paid call');
  assert.equal(AI_LIMITS.maxConcurrency, 1);
});

test('Y1: the measured 46.8 s worst case has at least 2x margin and validation still fits', () => {
  assert.ok(
    AI_LIMITS.callTimeoutMs >= 2 * MEASURED_MAX_MS,
    `call timeout ${AI_LIMITS.callTimeoutMs} ms must be at least twice the measured ${MEASURED_MAX_MS} ms`,
  );
  assert.ok(AI_LIMITS.jobDeadlineMs > AI_LIMITS.callTimeoutMs, 'the job deadline covers the call');
  assert.ok(AI_LIMITS.jobDeadlineMs < FUNCTION_MS, 'the job deadline stays inside the function');
  assert.ok(
    FUNCTION_MS - AI_LIMITS.jobDeadlineMs >= 150_000,
    'validation and the concept write keep at least 150 s inside the function',
  );
});

test('Y1: no plan, Fluid or maxDuration override was added to the project configuration', () => {
  // The documented 300 s is the Hobby maximum with Fluid compute, so the route
  // value alone is enough and no project setting had to change.
  // vercel.json may exist for the daily Supabase keep-alive cron (PR #64), but it
  // must not carry a plan, Fluid or function-duration override.
  if (fs.existsSync(VERCEL_CONFIG_PATH)) {
    const vercelConfig = JSON.parse(fs.readFileSync(VERCEL_CONFIG_PATH, 'utf8'));
    assert.deepEqual(Object.keys(vercelConfig), ['crons'], 'vercel.json only holds crons');
    assert.doesNotMatch(JSON.stringify(vercelConfig), /maxDuration|fluid|functions/i);
  }
  const nextConfig = fs.readFileSync(NEXT_CONFIG_PATH, 'utf8');
  assert.doesNotMatch(nextConfig, /maxDuration|fluid/i);
});

test('Y1: the guide cites the official Vercel duration and Fluid pages with the measured durations', () => {
  const guide = fs.readFileSync(GUIDE_PATH, 'utf8');
  assert.match(guide, /https:\/\/vercel\.com\/docs\/functions\/configuring-functions\/duration/);
  assert.match(guide, /https:\/\/vercel\.com\/docs\/fluid-compute/);
  assert.match(guide, /April 23,\s+2025/);
  assert.match(guide, /Hobby 300 s/);
  assert.match(guide, /Pro en Enterprise 300 s default en 800 s maximum/);
  assert.match(guide, /andalous 46,8 s, zuyd 41,5 s en smelt 38,8 s/);
  assert.match(guide, /`maxDuration = 300`/);
  assert.match(guide, /`callTimeoutMs = 120_000`/);
  assert.match(guide, /`jobDeadlineMs = 150_000`/);
  assert.match(guide, /geen plan- of Vercel-instelling gewijzigd/);
});
