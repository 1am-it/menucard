'use strict';

// Kleurtaal v2 — src/lib/statusRoles.js: which business state gets which
// semantic status role. Conservative: only states the design source names
// explicitly get a non-neutral role, and "Actie nodig" is never assigned.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const roles = require('./statusRoles');

const ALL_ROLE_FUNCTIONS = Object.entries(roles);

// Every business state the internal screens can show today.
const REVIEW_STATES = ['new', 'needs_enrichment', 'approved_internal', 'rejected', 'deferred', 'unreviewed', 'needs_review'];
const SAMPLE_INPUTS = [
  ...REVIEW_STATES,
  'complete', 'incomplete',
  'succeeded', 'failed', 'running', 'partial', 'pending',
  'success', 'exists', 'error',
  'draft', 'discarded', 'active', 'none',
  'hoog', 'middel', 'laag',
  true, false, undefined, null, '',
];

test('statusRoles: "Actie nodig" (action) is a reserved role and never assigned to any business state', () => {
  for (const [name, fn] of ALL_ROLE_FUNCTIONS) {
    for (const input of SAMPLE_INPUTS) {
      assert.notEqual(fn(input), 'action', `${name}(${String(input)}) must not return "action"`);
    }
  }
});

test('statusRoles: every function only returns positive, blocked or neutral', () => {
  for (const [name, fn] of ALL_ROLE_FUNCTIONS) {
    for (const input of SAMPLE_INPUTS) {
      assert.ok(['positive', 'blocked', 'neutral'].includes(fn(input)), `${name}(${String(input)}) = ${fn(input)}`);
    }
  }
});

test('review status: only an internal approval is positive; new, not yet reviewed, needs enrichment, deferred and rejected stay neutral', () => {
  assert.equal(roles.reviewStatusRole('approved_internal'), 'positive');
  for (const s of ['new', 'unreviewed', 'needs_review', 'needs_enrichment', 'deferred', 'rejected']) {
    assert.equal(roles.reviewStatusRole(s), 'neutral', s);
  }
});

test('quality status: complete is positive, incomplete is neutral (never blocked/old) — same role in list and detail', () => {
  assert.equal(roles.qualityStatusRole('complete'), 'positive');
  assert.equal(roles.qualityStatusRole('incomplete'), 'neutral');
});

test('import run: only a failed run is a real technical error; running or succeeded are not a success/approval status', () => {
  assert.equal(roles.importRunRole('failed'), 'blocked');
  for (const s of ['succeeded', 'running', 'partial', 'pending']) assert.equal(roles.importRunRole(s), 'neutral', s);
});

test('proposal request ("Bezig…", "Voorstel aangemaakt", "Al voorgesteld", "Mislukt"): only the error is blocked', () => {
  assert.equal(roles.proposalRequestRole('error'), 'blocked');
  for (const s of ['pending', 'success', 'exists']) assert.equal(roles.proposalRequestRole(s), 'neutral', s);
});

test('a profile draft (concept) is never an approval, active or discarded', () => {
  for (const s of ['draft', 'discarded', 'active', 'none', undefined]) assert.equal(roles.profileDraftRole(s), 'neutral', String(s));
});

test('owner claim: a domain match is positive, a mismatch has no decided role and stays neutral', () => {
  assert.equal(roles.domainMatchRole(true), 'positive');
  assert.equal(roles.domainMatchRole(false), 'neutral');
});

test('confidence (hoog/middel/laag) is not a status: no role function maps it', () => {
  assert.equal(Object.keys(roles).some((k) => /confidence/i.test(k)), false);
});
