'use strict';

// Pure guard for the pre-declared #59 acceptance set. It is deliberately
// separate from the file-level assertions so the holdout state machine can be
// tested with negative fixtures.
//
// Delivery Lead review 6248407225 corrected an internal contradiction: an
// "unseen" holdout must be able to record one legitimate first evaluation.
// There are therefore three explicit states:
//
//   unused          - not fetched, no result; status blocked/not_available.
//   evaluated_once  - exactly one recorded, independent first evaluation. It is
//                     still not used for tuning, and no second evaluation is
//                     allowed on the same pinned source version.
//   used_for_tuning - no longer a holdout. It must move to the representative
//                     set and a new, unused holdout must be pinned.
//
// A result is never invented: an evaluated holdout carries a concrete result
// and timestamp, and a zero-item outcome is recorded as a limitation, not as a
// successful complete menu.

const EVALUATION_STATES = ['unused', 'evaluated_once', 'used_for_tuning'];
const STATUSES = ['executed', 'executed_with_limitation', 'blocked', 'unsupported', 'not_available'];

function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validateHoldoutEntry(entry) {
  const errors = [];
  const where = entry && entry.id ? entry.id : 'holdout entry';
  if (!entry || typeof entry !== 'object') return { ok: false, errors: [`${where}: not an object`] };
  if (!EVALUATION_STATES.includes(entry.evaluationState)) {
    errors.push(`${where}: evaluationState must be one of ${EVALUATION_STATES.join(', ')}`);
  }
  if (typeof entry.usedForTuning !== 'boolean') {
    errors.push(`${where}: usedForTuning must be explicit`);
  }
  if (!Number.isInteger(entry.evaluationCount) || entry.evaluationCount < 0) {
    errors.push(`${where}: evaluationCount must be a non-negative integer`);
  }
  if (!STATUSES.includes(entry.status)) {
    errors.push(`${where}: status must be one of ${STATUSES.join(', ')}`);
  }

  if (entry.evaluationState === 'used_for_tuning') {
    errors.push(`${where}: a tuned source is no longer a holdout; move it to representative and pin a new holdout`);
  }
  if (entry.evaluationState === 'unused') {
    if (entry.usedForTuning !== false) errors.push(`${where}: unused holdout cannot be used for tuning`);
    if (entry.evaluationCount !== 0) errors.push(`${where}: unused holdout cannot have an evaluation count`);
    if (entry.fetched === true) errors.push(`${where}: unused holdout cannot be marked fetched`);
    if (entry.firstEvaluatedAt != null) errors.push(`${where}: unused holdout cannot have an evaluation timestamp`);
    if (entry.result != null && String(entry.result).trim() !== '') errors.push(`${where}: unused holdout cannot carry a result`);
    if (!['blocked', 'not_available'].includes(entry.status)) {
      errors.push(`${where}: unused holdout status must be blocked or not_available`);
    }
  }
  if (entry.evaluationState === 'evaluated_once') {
    if (entry.usedForTuning !== false) errors.push(`${where}: an evaluated holdout is still not a tuning source`);
    if (entry.evaluationCount !== 1) errors.push(`${where}: evaluated_once requires exactly one recorded evaluation`);
    if (entry.fetched !== true) errors.push(`${where}: evaluated_once requires fetched=true`);
    if (!isDate(entry.firstEvaluatedAt)) errors.push(`${where}: evaluated_once requires a firstEvaluatedAt date`);
    if (typeof entry.result !== 'string' || entry.result.trim() === '') {
      errors.push(`${where}: evaluated_once requires a concrete result`);
    }
    if (!['executed', 'executed_with_limitation', 'blocked', 'unsupported', 'not_available'].includes(entry.status)) {
      errors.push(`${where}: evaluated_once has an invalid status`);
    }
  }
  if (entry.evaluationCount > 1) {
    errors.push(`${where}: a holdout may be evaluated at most once per pinned source version; pin a new holdout`);
  }
  if (entry.provenance === 'real_source') {
    if (!entry.referenceId) errors.push(`${where}: a real holdout needs a pinned referenceId`);
    if (entry.evaluationState === 'unused' && entry.fetched === true) {
      errors.push(`${where}: a real unused source cannot already be fetched`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function validateHoldout(holdout) {
  const errors = [];
  if (!holdout || typeof holdout !== 'object') return { ok: false, errors: ['holdout: not an object'] };
  if (!holdout.evaluationStates || typeof holdout.evaluationStates !== 'object') {
    errors.push('holdout: evaluationStates must document the three states');
  } else {
    for (const state of EVALUATION_STATES) {
      if (!holdout.evaluationStates[state]) errors.push(`holdout: missing state definition for ${state}`);
    }
  }
  const entries = Array.isArray(holdout.entries) ? holdout.entries : [];
  if (entries.length === 0) errors.push('holdout: at least one entry is required');
  for (const entry of entries) errors.push(...validateHoldoutEntry(entry).errors);
  return { ok: errors.length === 0, errors };
}

function validateRepresentative(representative) {
  const errors = [];
  for (const entry of representative || []) {
    if (entry.provenance === 'real_source' && entry.usedForTuning !== true) {
      errors.push(`${entry.id}: a real representative source must be marked usedForTuning`);
    }
  }
  return { ok: errors.length === 0, errors };
}

module.exports = {
  EVALUATION_STATES,
  STATUSES,
  validateHoldoutEntry,
  validateHoldout,
  validateRepresentative,
};
