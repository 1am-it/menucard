'use strict';

// Negative tests for the corrected holdout state machine (Delivery Lead review
// 6248407225). The old guard made a legitimate first, pre-pinned holdout
// evaluation impossible. These tests prove that:
//   - an unused holdout cannot already carry a result;
//   - exactly one evaluation is recordable without becoming tuning;
//   - a second evaluation is refused;
//   - a tuned source may not stay in the holdout.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  EVALUATION_STATES,
  validateHoldoutEntry,
  validateHoldout,
  validateRepresentative,
} = require('./acceptanceSetGuard');

function entry(overrides = {}) {
  return {
    id: 'HOLD-TEST-01',
    class: 'html',
    provenance: 'real_source',
    sourceRef: 'ops/benchmark/holdout-references.json#test',
    referenceId: 'test',
    url: 'https://approved.invalid/',
    fetched: false,
    status: 'blocked',
    evaluationState: 'unused',
    evaluationCount: 0,
    firstEvaluatedAt: null,
    usedForTuning: false,
    reason: 'pinned, not yet evaluated',
    ...overrides,
  };
}

function holdout(entries) {
  return {
    evaluationStates: Object.fromEntries(EVALUATION_STATES.map((state) => [state, `${state} definition`])),
    entries,
  };
}

test('an unused holdout is valid but may not carry a result or execution', () => {
  assert.equal(validateHoldoutEntry(entry()).ok, true);

  const executed = entry({ status: 'executed', result: 'invented result' });
  assert.equal(validateHoldoutEntry(executed).ok, false);
  assert.match(validateHoldoutEntry(executed).errors.join('; '), /cannot carry a result|cannot be marked fetched|status must be blocked/);

  const fetched = entry({ fetched: true });
  assert.equal(validateHoldoutEntry(fetched).ok, false);
  assert.match(validateHoldoutEntry(fetched).errors.join('; '), /cannot be marked fetched/);
});

test('one legitimate first evaluation is recordable without becoming tuning', () => {
  const evaluated = entry({
    fetched: true,
    status: 'executed_with_limitation',
    evaluationState: 'evaluated_once',
    evaluationCount: 1,
    firstEvaluatedAt: '2026-10-18',
    usedForTuning: false,
    result: '151 items, quality-limited; not a complete-menu claim.',
  });
  assert.equal(validateHoldoutEntry(evaluated).ok, true);
});

test('an evaluated holdout cannot be used for tuning or evaluated twice', () => {
  const tuned = entry({
    fetched: true,
    status: 'executed_with_limitation',
    evaluationState: 'evaluated_once',
    evaluationCount: 1,
    firstEvaluatedAt: '2026-10-18',
    usedForTuning: true,
    result: 'result',
  });
  assert.equal(validateHoldoutEntry(tuned).ok, false);
  assert.match(validateHoldoutEntry(tuned).errors.join('; '), /still not a tuning source/);

  const twice = entry({
    fetched: true,
    status: 'executed_with_limitation',
    evaluationState: 'evaluated_once',
    evaluationCount: 2,
    firstEvaluatedAt: '2026-10-18',
    usedForTuning: false,
    result: 'result',
  });
  assert.equal(validateHoldoutEntry(twice).ok, false);
  assert.match(validateHoldoutEntry(twice).errors.join('; '), /at most once|exactly one recorded evaluation/);
});

test('a source used for tuning must move out of the holdout', () => {
  const moved = entry({
    fetched: true,
    status: 'executed_with_limitation',
    evaluationState: 'used_for_tuning',
    evaluationCount: 1,
    firstEvaluatedAt: '2026-10-18',
    usedForTuning: true,
    result: 'result',
  });
  assert.equal(validateHoldoutEntry(moved).ok, false);
  assert.match(validateHoldoutEntry(moved).errors.join('; '), /no longer a holdout/);
});

test('the holdout requires the three explicit states and a representative real source is marked as tuned', () => {
  const valid = holdout([entry()]);
  assert.equal(validateHoldout(valid).ok, true);

  const missing = { entries: [entry()] };
  assert.equal(validateHoldout(missing).ok, false);

  assert.equal(validateRepresentative([{ id: 'REP-1', provenance: 'real_source', usedForTuning: true }]).ok, true);
  assert.equal(validateRepresentative([{ id: 'REP-2', provenance: 'real_source', usedForTuning: false }]).ok, false);
});
