'use strict';

// K3 of the Delivery Lead order for #59 / BE-21 (review 6370840673): the durable
// budget log for the bounded AI probe.
//
// The existing adapter (src/lib/menuExtractionAdapter.js) reserves a hard
// maximum before a call and settles the reported cost afterwards, synchronously.
// This ledger is that guard: a JSON file in a gitignored path, written
// atomically (temporary file + rename, fsync) and locked for the duration of
// one mutation so a second probe process cannot spend the same eurocents.
//
// Caps are fixed by default (900 eurocent cumulative, 30 per call, 40 calls,
// 1 at a time) and a persisted ledger keeps its own recorded caps: changing the
// options cannot raise a cap that already exists on disk. A reservation that was
// never settled stays charged on purpose — the next reader sees the spend
// instead of a free budget. An unknown cost settles as the full reservation and
// increments `unknownCostCalls`; it is never booked as zero.
//
// Pure file I/O, no network, no provider, no database. The caller supplies the
// ledger path, so this module stays free of any tooling or benchmark location;
// the ops probe decides where its gitignored file lives.

const fs = require('node:fs');
const path = require('node:path');

const LEDGER_SCHEMA_VERSION = 'menu-extraction-ai-probe-budget/v1';
const STALE_LOCK_MS = 60_000;

const DEFAULT_LEDGER_LIMITS = Object.freeze({
  cumulativeLimitEurCents: 900,
  perCallLimitEurCents: 30,
  maxCalls: 40,
  maxConcurrency: 1,
});

class BudgetLedgerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BudgetLedgerError';
    this.code = code;
  }
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function validateLimits(limits) {
  const problems = [];
  for (const key of ['cumulativeLimitEurCents', 'perCallLimitEurCents', 'maxCalls', 'maxConcurrency']) {
    if (!Number.isInteger(limits[key]) || limits[key] <= 0) problems.push(`${key} must be a positive integer`);
  }
  if (problems.length === 0) {
    if (limits.perCallLimitEurCents > limits.cumulativeLimitEurCents) {
      problems.push('perCallLimitEurCents cannot exceed cumulativeLimitEurCents');
    }
    // The probe is deliberately single-flight: the lock and the reservation
    // arithmetic both assume one call at a time.
    if (limits.maxConcurrency !== 1) problems.push('maxConcurrency must be 1 for the probe');
  }
  return problems;
}

function emptyState(limits) {
  return {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    limits: { ...limits },
    calls: 0,
    spentEurCents: 0,
    reservedEurCents: 0,
    unknownCostCalls: 0,
    openReservation: null,
    lastCallAt: null,
    lastOutcome: null,
  };
}

function validateState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return ['the ledger is not an object'];
  const problems = [];
  if (state.schemaVersion !== LEDGER_SCHEMA_VERSION) problems.push('schemaVersion is not the probe ledger version');
  for (const problem of validateLimits(state.limits || {})) problems.push(`limits: ${problem}`);
  for (const key of ['calls', 'spentEurCents', 'reservedEurCents', 'unknownCostCalls']) {
    if (!isNonNegativeInteger(state[key])) problems.push(`${key} must be a non-negative integer`);
  }
  const open = state.openReservation;
  if (open !== null) {
    if (!open || typeof open !== 'object' || Array.isArray(open)) problems.push('openReservation must be null or an object');
    else {
      if (!Number.isInteger(open.pid) || open.pid <= 0) problems.push('openReservation.pid must be a positive integer');
      if (!isNonNegativeInteger(open.amountEurCents) || open.amountEurCents <= 0) problems.push('openReservation.amountEurCents must be a positive integer');
      if (typeof open.at !== 'string' || open.at.length === 0) problems.push('openReservation.at must be a timestamp');
    }
  }
  if (state.lastCallAt !== null && typeof state.lastCallAt !== 'string') problems.push('lastCallAt must be null or a string');
  if (state.lastOutcome !== null && typeof state.lastOutcome !== 'string') problems.push('lastOutcome must be null or a string');
  return problems;
}

function readStateFromDisk(file) {
  if (!fs.existsSync(file)) return null;
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    throw new BudgetLedgerError('budget_ledger_unreadable', 'the budget ledger cannot be read');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BudgetLedgerError('budget_ledger_corrupt', 'the budget ledger is not valid JSON');
  }
  const problems = validateState(parsed);
  if (problems.length > 0) throw new BudgetLedgerError('budget_ledger_corrupt', `the budget ledger is invalid: ${problems.join('; ')}`);
  return parsed;
}

/** Temporary file + fsync + rename: a reader never sees a half-written ledger. */
function writeStateToDisk(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  let handle = null;
  try {
    handle = fs.openSync(temporary, 'w');
    fs.writeFileSync(handle, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = null;
    fs.renameSync(temporary, file);
  } catch {
    if (handle !== null) {
      try {
        fs.closeSync(handle);
      } catch {
        // best effort
      }
    }
    try {
      fs.unlinkSync(temporary);
    } catch {
      // best effort
    }
    throw new BudgetLedgerError('budget_settle_failed', 'the budget ledger could not be written');
  }
}

function defaultIsProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

function readLockHolder(lockFile) {
  try {
    return JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  } catch {
    return null;
  }
}

function lockIsStale(lockFile, isProcessAlive) {
  const holder = readLockHolder(lockFile);
  if (holder && Number.isInteger(holder.pid) && isProcessAlive(holder.pid)) return false;
  let age = 0;
  try {
    age = Date.now() - fs.statSync(lockFile).mtimeMs;
  } catch {
    return true;
  }
  // An unreadable lock is only broken once it is old enough that no live
  // mutation can explain it.
  return holder ? true : age > STALE_LOCK_MS;
}

function acquireLock(file, isProcessAlive) {
  const lockFile = `${file}.lock`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = fs.openSync(lockFile, 'wx');
      fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), 'utf8');
      fs.closeSync(handle);
      return lockFile;
    } catch (err) {
      if (err.code !== 'EEXIST') {
        throw new BudgetLedgerError('budget_settle_failed', 'the budget ledger lock could not be created');
      }
      if (!lockIsStale(lockFile, isProcessAlive)) {
        const holder = readLockHolder(lockFile);
        throw new BudgetLedgerError(
          'budget_ledger_locked',
          `another probe holds the budget ledger${holder && holder.pid ? ` (pid ${holder.pid})` : ''}`,
        );
      }
      try {
        fs.unlinkSync(lockFile);
      } catch {
        // another process removed the stale lock first
      }
    }
  }
  throw new BudgetLedgerError('budget_ledger_locked', 'the budget ledger lock could not be acquired');
}

function releaseLock(lockFile) {
  try {
    fs.unlinkSync(lockFile);
  } catch {
    // A lock that is already gone needs no release.
  }
}

/**
 * The synchronous reserve/settle guard the adapter expects. Every mutation
 * re-reads the file under a lock, so a second process (or a restart) continues
 * from the durable numbers instead of from stale memory.
 */
function createFileBudgetLedger(options = {}) {
  const file = typeof options.file === 'string' && options.file.trim() ? path.resolve(options.file) : null;
  if (!file) throw new BudgetLedgerError('budget_ledger_path_required', 'createFileBudgetLedger needs an explicit file path');
  const limits = { ...DEFAULT_LEDGER_LIMITS, ...(options.limits || {}) };
  const limitProblems = validateLimits(limits);
  if (limitProblems.length > 0) {
    throw new BudgetLedgerError('budget_ledger_invalid_limits', limitProblems.join('; '));
  }
  const deps = {
    readState: readStateFromDisk,
    writeState: writeStateToDisk,
    acquireLock,
    releaseLock,
    isProcessAlive: defaultIsProcessAlive,
    now: () => new Date().toISOString(),
    ...(options.deps || {}),
  };

  let state = deps.readState(file);
  if (state) {
    for (const key of Object.keys(limits)) {
      if (state.limits[key] !== limits[key]) {
        throw new BudgetLedgerError(
          'budget_ledger_limits_changed',
          `the persisted ledger uses ${key}=${state.limits[key]} and cannot be reopened with ${limits[key]}`,
        );
      }
    }
  } else {
    state = emptyState(limits);
  }

  function underLock(mutate) {
    const lock = deps.acquireLock(file, deps.isProcessAlive);
    try {
      const persisted = deps.readState(file);
      if (persisted) state = persisted;
      return mutate();
    } finally {
      deps.releaseLock(lock);
    }
  }

  /**
   * One call at a time, across processes. An open reservation from a process
   * that is gone keeps its money charged (the call may have been paid) and
   * frees the slot; nothing is silently refunded.
   */
  function releaseAbandonedReservation() {
    const open = state.openReservation;
    if (!open) return;
    if (deps.isProcessAlive(open.pid)) return;
    const amount = Math.min(open.amountEurCents, state.reservedEurCents);
    state.spentEurCents += amount;
    state.reservedEurCents = Math.max(0, state.reservedEurCents - amount);
    state.unknownCostCalls += 1;
    state.openReservation = null;
    state.lastOutcome = 'abandoned_reservation_charged';
  }

  return {
    file,
    limits: { ...limits },
    // The adapter reads this after the call; the provider module writes it.
    costEurCents: undefined,

    reserve(maxCost) {
      if (!Number.isInteger(maxCost) || maxCost < 0 || maxCost > limits.perCallLimitEurCents) return false;
      return underLock(() => {
        releaseAbandonedReservation();
        if (state.openReservation) return false;
        if (state.calls + 1 > limits.maxCalls) return false;
        if (state.spentEurCents + state.reservedEurCents + maxCost > limits.cumulativeLimitEurCents) return false;
        state.calls += 1;
        state.reservedEurCents += maxCost;
        state.openReservation = { pid: process.pid, amountEurCents: maxCost, at: deps.now() };
        state.lastCallAt = deps.now();
        state.lastOutcome = 'reserved';
        deps.writeState(file, state);
        return true;
      });
    },

    settle(actual) {
      return underLock(() => {
        const open = state.openReservation;
        if (!open || open.pid !== process.pid) {
          throw new BudgetLedgerError('budget_settle_failed', 'there is no open reservation for this process');
        }
        const reserved = Math.min(open.amountEurCents, state.reservedEurCents);
        if (actual === null || actual === undefined) {
          // Unknown is never free: the whole reservation stays spent.
          state.spentEurCents += reserved;
          state.unknownCostCalls += 1;
          state.lastOutcome = 'cost_unknown';
        } else if (Number.isInteger(actual) && actual >= 0) {
          state.spentEurCents += actual;
          state.lastOutcome = 'settled';
        } else {
          throw new BudgetLedgerError('budget_settle_failed', 'the settled amount must be a non-negative integer or null');
        }
        state.reservedEurCents = Math.max(0, state.reservedEurCents - reserved);
        state.openReservation = null;
        deps.writeState(file, state);
        return true;
      });
    },

    snapshot() {
      const persisted = deps.readState(file);
      if (persisted) state = persisted;
      const remaining = limits.cumulativeLimitEurCents - state.spentEurCents - state.reservedEurCents;
      return {
        schemaVersion: LEDGER_SCHEMA_VERSION,
        file,
        limits: { ...limits },
        calls: state.calls,
        spentEurCents: state.spentEurCents,
        reservedEurCents: state.reservedEurCents,
        unknownCostCalls: state.unknownCostCalls,
        openReservation: state.openReservation ? { ...state.openReservation } : null,
        remainingEurCents: remaining,
        exhausted: remaining <= 0,
        callsRemaining: Math.max(0, limits.maxCalls - state.calls),
        lastCallAt: state.lastCallAt,
        lastOutcome: state.lastOutcome,
      };
    },
  };
}

module.exports = {
  BudgetLedgerError,
  DEFAULT_LEDGER_LIMITS,
  LEDGER_SCHEMA_VERSION,
  STALE_LOCK_MS,
  acquireLock,
  createFileBudgetLedger,
  defaultIsProcessAlive,
  emptyState,
  readStateFromDisk,
  releaseLock,
  validateLimits,
  validateState,
  writeStateToDisk,
};
