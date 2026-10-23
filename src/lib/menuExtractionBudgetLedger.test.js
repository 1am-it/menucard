'use strict';

// K3/K6 regressions for the probe budget ledger (#59 / BE-21 review
// 6370840673). Every test writes to a temporary directory; nothing here
// touches the real gitignored ledger or the network.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  BudgetLedgerError,
  DEFAULT_LEDGER_LIMITS,
  createFileBudgetLedger,
  emptyState,
  validateLimits,
} = require('./menuExtractionBudgetLedger');
const { createStructuredExtractionAdapter, runStructuredExtraction } = require('./menuExtractionAdapter');

const protocol = { text: 'pinned instruction', hash: 'b'.repeat(64) };
const sources = [{ id: 'source-1', url: 'https://fictief.example/menu', kind: 'html', text: 'Fictieve soep 6.50' }];
const output = {
  menus: [
    {
      title: 'Lunch',
      sourceId: 'source-1',
      categories: [{ name: 'Voor', items: [{ name: 'Fictieve soep', priceStatus: 'on_request', evidence: { sourceId: 'source-1', locator: 'regel 1', quote: 'Fictieve soep 6.50' } }] }],
    },
  ],
  coverage: { status: 'complete', sourcesRead: 1, pagesRead: 1, itemsExtracted: 1, unreadSources: [], limitations: [] },
};

function temporaryLedger(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'menucard-ledger-'));
  const file = path.join(directory, 'ledger.json');
  return { directory, file, ledger: createFileBudgetLedger({ file, ...options }) };
}

function adapterWith(call, budget) {
  const adapter = createStructuredExtractionAdapter({ call });
  return runStructuredExtraction({
    adapter,
    protocol,
    sources,
    limits: { callTimeoutMs: 100, maxCostEurCents: 30, maxOutputTokens: 4000 },
    budget,
  });
}

test('K3: the documented caps are the defaults and a bad cap is refused', () => {
  assert.deepEqual(DEFAULT_LEDGER_LIMITS, {
    cumulativeLimitEurCents: 900,
    perCallLimitEurCents: 30,
    maxCalls: 40,
    maxConcurrency: 1,
  });
  assert.deepEqual(validateLimits(DEFAULT_LEDGER_LIMITS), []);
  assert.match(validateLimits({ ...DEFAULT_LEDGER_LIMITS, maxConcurrency: 2 }).join(' '), /maxConcurrency must be 1/);
  assert.match(validateLimits({ ...DEFAULT_LEDGER_LIMITS, perCallLimitEurCents: 1000 }).join(' '), /cannot exceed/);
  const { file } = temporaryLedger();
  assert.throws(() => createFileBudgetLedger({ file, limits: { maxConcurrency: 2 } }), /maxConcurrency must be 1/);
  assert.throws(
    () => createFileBudgetLedger({}),
    (err) => err instanceof BudgetLedgerError && err.code === 'budget_ledger_path_required',
  );
});

test('K3: reserve and settle are durable, atomic and leave no lock or temporary file behind', () => {
  const { directory, file, ledger } = temporaryLedger();
  assert.equal(ledger.reserve(30), true);
  assert.equal(ledger.settle(1), true);
  const snapshot = ledger.snapshot();
  assert.equal(snapshot.calls, 1);
  assert.equal(snapshot.spentEurCents, 1);
  assert.equal(snapshot.reservedEurCents, 0);
  assert.equal(snapshot.remainingEurCents, 899);
  assert.equal(snapshot.lastOutcome, 'settled');
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(onDisk.spentEurCents, 1);
  assert.equal(onDisk.schemaVersion, 'menu-extraction-ai-probe-budget/v1');
  const leftovers = fs.readdirSync(directory).filter((name) => name.endsWith('.tmp') || name.endsWith('.lock'));
  assert.deepEqual(leftovers, []);
});

test('K3: the per-call cap and the cumulative cap are enforced before a call', async () => {
  const perCall = temporaryLedger();
  assert.equal(perCall.ledger.reserve(31), false, 'a reservation above the per-call cap is refused');
  assert.equal(perCall.ledger.reserve(30), true);

  const cumulative = temporaryLedger({ limits: { cumulativeLimitEurCents: 30, perCallLimitEurCents: 30, maxCalls: 10 } });
  assert.equal(cumulative.ledger.reserve(30), true);
  assert.equal(cumulative.ledger.settle(30), true);
  assert.equal(cumulative.ledger.reserve(30), false, 'a spent budget cannot be reserved again');

  let calls = 0;
  const result = await adapterWith(async () => {
    calls += 1;
    return output;
  }, cumulative.ledger);
  assert.equal(result.reason, 'budget_exceeded');
  assert.equal(calls, 0, 'the provider is never called when the reservation is refused');
});

test('K3: the call cap stops the probe even when budget is left', () => {
  const { ledger } = temporaryLedger({ limits: { cumulativeLimitEurCents: 900, perCallLimitEurCents: 30, maxCalls: 2 } });
  assert.equal(ledger.reserve(1), true);
  assert.equal(ledger.settle(1), true);
  assert.equal(ledger.reserve(1), true);
  assert.equal(ledger.settle(1), true);
  assert.equal(ledger.reserve(1), false);
  assert.equal(ledger.snapshot().callsRemaining, 0);
});

test('K3: an unknown cost keeps the whole reservation charged and is counted', async () => {
  const { ledger } = temporaryLedger();
  let calls = 0;
  const result = await adapterWith(async () => {
    calls += 1;
    ledger.costEurCents = null;
    return output;
  }, ledger);
  assert.equal(result.reason, 'cost_unknown');
  assert.equal(calls, 1);
  const snapshot = ledger.snapshot();
  assert.equal(snapshot.spentEurCents, 30);
  assert.equal(snapshot.unknownCostCalls, 1);
  assert.equal(snapshot.lastOutcome, 'cost_unknown');
  assert.equal(snapshot.remainingEurCents, 870);
  // A second call still fits the budget but the ledger no longer treats the
  // unknown call as free.
  assert.equal(ledger.reserve(30), true);
  assert.equal(ledger.settle(null), true);
  assert.equal(ledger.snapshot().spentEurCents, 60);
});

test('K3/K6: a restarted ledger continues counting and a real adapter call settles through it', async () => {
  const { file, ledger } = temporaryLedger();
  let calls = 0;
  const result = await adapterWith(async () => {
    calls += 1;
    ledger.costEurCents = 1;
    return output;
  }, ledger);
  assert.equal(result.ok, true);
  assert.equal(result.meta.actualCostEurCents, 1);
  assert.equal(calls, 1);
  assert.equal(ledger.snapshot().spentEurCents, 1);

  // A new process: same file, same caps. The numbers continue.
  const restarted = createFileBudgetLedger({ file });
  const before = restarted.snapshot();
  assert.equal(before.calls, 1);
  assert.equal(before.spentEurCents, 1);
  assert.equal(before.remainingEurCents, 899);

  restarted.costEurCents = 2;
  const second = await adapterWith(async () => {
    calls += 1;
    return output;
  }, restarted);
  assert.equal(second.ok, true);
  assert.equal(calls, 2);
  const after = createFileBudgetLedger({ file }).snapshot();
  assert.equal(after.calls, 2);
  assert.equal(after.spentEurCents, 3);
});

test('K3: a corrupt ledger, changed caps or a live lock stop the probe instead of spending', () => {
  const corrupt = temporaryLedger();
  fs.writeFileSync(corrupt.file, '{not json', 'utf8');
  assert.throws(
    () => createFileBudgetLedger({ file: corrupt.file }),
    (err) => err instanceof BudgetLedgerError && err.code === 'budget_ledger_corrupt',
  );

  const changed = temporaryLedger();
  assert.equal(changed.ledger.reserve(1), true);
  assert.equal(changed.ledger.settle(1), true);
  assert.throws(
    () => createFileBudgetLedger({ file: changed.file, limits: { cumulativeLimitEurCents: 1000 } }),
    (err) => err instanceof BudgetLedgerError && err.code === 'budget_ledger_limits_changed',
  );

  const locked = temporaryLedger();
  fs.writeFileSync(`${locked.file}.lock`, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), 'utf8');
  assert.throws(
    () => locked.ledger.reserve(1),
    (err) => err instanceof BudgetLedgerError && err.code === 'budget_ledger_locked',
  );
  fs.unlinkSync(`${locked.file}.lock`);
  assert.equal(locked.ledger.reserve(1), true);
});

test('K3: a lock left by a dead process is broken, an unreadable fresh lock is not', () => {
  const { file, ledger } = temporaryLedger();
  fs.writeFileSync(`${file}.lock`, JSON.stringify({ pid: 999_999, at: new Date().toISOString() }), 'utf8');
  assert.equal(ledger.reserve(5), true);
  assert.equal(ledger.settle(5), true);

  const fresh = temporaryLedger();
  fs.writeFileSync(`${fresh.file}.lock`, 'not json', 'utf8');
  assert.throws(
    () => fresh.ledger.reserve(5),
    (err) => err instanceof BudgetLedgerError && err.code === 'budget_ledger_locked',
  );
});

test('K3: a ledger that cannot write a settlement never reports a successful extraction', async () => {
  const { ledger } = temporaryLedger();
  let writes = 0;
  const failing = createFileBudgetLedger({
    file: `${path.dirname(ledger.file)}/failing.json`,
    deps: {
      writeState: () => {
        writes += 1;
        if (writes > 1) throw new BudgetLedgerError('budget_settle_failed', 'disk full (fixture)');
      },
      now: () => '2026-10-23T00:00:00.000Z',
    },
  });
  const result = await adapterWith(async () => {
    failing.costEurCents = 1;
    return output;
  }, failing);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'budget_settle_failed');
});

test('K3: the empty state is the documented zero, never a hidden spend', () => {
  const state = emptyState(DEFAULT_LEDGER_LIMITS);
  assert.equal(state.calls, 0);
  assert.equal(state.spentEurCents, 0);
  assert.equal(state.reservedEurCents, 0);
  assert.equal(state.unknownCostCalls, 0);
  assert.equal(state.schemaVersion, 'menu-extraction-ai-probe-budget/v1');
});
