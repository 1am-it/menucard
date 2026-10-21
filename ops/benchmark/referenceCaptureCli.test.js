'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'ops', 'scripts', 'capture-menu-extraction-reference-sources.js');
const METADATA = path.join(REPO_ROOT, 'ops', 'benchmark', 'reference-captures.json');

test('the capture tool is bounded, robots-aware and create-only', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(source, /safeOutboundFetch/);
  assert.match(source, /checkRobotsForUrl/);
  assert.match(source, /fetchSameSiteWithRedirects/);
  assert.match(source, /assertApprovedHost/);
  assert.match(source, /flag: 'wx'/);
  assert.match(source, /already exists; the pinned source version is immutable/);
  assert.match(source, /output\/reference-captures/);
  assert.equal(source.includes('process.env'), false, 'no environment-dependent capture path');
});

test('a second capture is refused before any network read', (t) => {
  if (!fs.existsSync(METADATA)) {
    t.skip('the pinned capture metadata is not present in this checkout');
    return;
  }
  const result = spawnSync(process.execPath, [SCRIPT], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /already exists; the pinned source version is immutable/);
});
