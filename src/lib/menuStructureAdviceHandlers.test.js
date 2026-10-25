'use strict';

// BE-30 (#72) — het AI-advies als servergedrag, met een nagebootst transport:
// één aanroep per bronversie, hetzelfde budget en dezelfde teller als "Lees met
// AI", een citaat dat echt in de bron staat, en een advies dat apart van het
// menselijke besluit wordt vastgelegd. Geen betaalde aanroep in deze tests.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMenuStructureAdviceHandlers } = require('./menuStructureAdviceHandlers');
const { adviceRecord } = require('./menuStructureAdvice');

const HASH = 'a'.repeat(64);

const MENUS = [
  {
    title: 'Fictief Diner',
    structure: 'uncertain',
    sourceUrl: 'https://voorbeeld.example/menukaart.pdf',
    categories: [
      {
        name: 'Voor',
        path: ['Voor'],
        sourcePath: ['DINNER', 'VOORGERECHTEN'],
        locator: 'pdf:3',
        uncertain: true,
        items: [{ name: 'Fictieve burrata', price: '13.00', evidence: { locator: 'pdf:3:item:1', quote: 'Fictieve burrata 13,00' } }],
      },
      {
        name: 'Hoofd',
        path: ['Hoofd'],
        sourcePath: ['DINNER', 'HOOFDGERECHTEN'],
        locator: 'pdf:4',
        uncertain: true,
        items: [{ name: 'Fictieve zeebaars', price: '24.00', evidence: { locator: 'pdf:4:item:1', quote: 'Fictieve zeebaars 24,00' } }],
      },
    ],
  },
];

const ANSWER = {
  sections: [
    { rubriekId: '0.0', decision: 'keep', confidence: 'hoog', quote: 'Fictieve burrata 13,00' },
    { rubriekId: '0.1', decision: 'correct', correctedPath: ['Diner', 'Hoofdgerechten'], confidence: 'midden', quote: 'Fictieve zeebaars 24,00' },
  ],
};

function httpRequest(body) {
  return {
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function fakeCall({ budget, state, answer = ANSWER, cost = 3, fail = null }) {
  const module = {
    enabled: true,
    provider: 'anthropic',
    model: 'claude-haiku-5-5',
    lastCall: null,
    async call(input) {
      state.calls.push(input);
      if (fail) throw fail;
      budget.costEurCents = cost;
      module.lastCall = { requestId: 'req-1', costEurCents: cost, reason: null };
      return answer;
    },
  };
  return module;
}

function setup(overrides = {}) {
  const state = { createCall: 0, calls: [], saved: [] };
  const handlers = createMenuStructureAdviceHandlers({
    authenticate: async () => ({ ok: true, userId: 'user-1', roles: [{ role: 'internal', restaurant_id: null }] }),
    env: () => ({ ANTHROPIC_API_KEY: 'fixture-key', MENU_AI_FALLBACK_ENABLED: 'true' }),
    now: () => new Date('2026-10-25T12:00:00Z'),
    readSource: async () => ({ ok: true, receiptId: 'receipt-1', receiptHash: HASH, menus: MENUS, storedAdvice: null }),
    readUsageRows: async () => ({ ok: true, rows: [] }),
    createCall: ({ budget }) => {
      state.createCall += 1;
      return fakeCall({ budget, state });
    },
    saveAdvice: async ({ record }) => {
      state.saved.push(record);
      return { ok: true };
    },
    generateId: () => 'advice-read-1',
    ...overrides,
  });
  return { handlers, state };
}

test('BE-30: with AI off there is no call and an honest message', async () => {
  const { handlers, state } = setup({ env: () => ({ ANTHROPIC_API_KEY: 'fixture-key' }) });
  const res = await handlers.advise(httpRequest({ job_id: 'job-1' }));
  assert.equal(res.status, 503);
  assert.equal(res.body.reason, 'ai_flagged_off');
  assert.equal(res.body.enabled, false);
  assert.equal(state.createCall, 0);
});

test('BE-30: an exhausted month budget stops the call before it happens', async () => {
  const { handlers, state } = setup({
    readUsageRows: async () => ({
      ok: true,
      rows: [
        {
          id: 'c1',
          created_at: '2026-10-02T10:00:00Z',
          captured_content: { importProvenance: { readId: 'r1', cost: { eurCents: 995, known: true } } },
        },
      ],
    }),
  });
  const res = await handlers.advise(httpRequest({ job_id: 'job-1' }));
  assert.equal(res.status, 429);
  assert.equal(res.body.reason, 'budget_exhausted');
  assert.equal(state.createCall, 0);
  assert.equal(state.saved.length, 0);
});

test('BE-30: one call covers every uncertain section and the advice is stored as ai_suggested', async () => {
  const { handlers, state } = setup();
  const res = await handlers.advise(httpRequest({ job_id: 'job-1' }));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(state.createCall, 1);
  assert.equal(state.calls.length, 1);
  // All uncertain sections of this source version went into that one call.
  assert.equal(state.calls[0].sections.length, 2);
  assert.deepEqual(state.calls[0].sections.map((section) => section.label), ['Voor', 'Hoofd']);
  assert.equal(state.calls[0].limits.callTimeoutMs, 60_000);
  // Nothing from the client but the job id is used; the model input carries the
  // advised sections and the literal source fragments only.
  assert.equal(res.body.advice.sections.length, 2);
  assert.equal(res.body.advice.sections[1].label, 'Corrigeer naar Diner › Hoofdgerechten');
  assert.equal(res.body.cost.known, true);
  assert.equal(res.body.monthly.spentEurCents, 3);
  const saved = state.saved[0];
  assert.equal(saved.kind, 'ai_suggested');
  assert.equal(saved.outcome, 'advised');
  assert.equal(saved.receiptHash, HASH);
  assert.equal(saved.jobId, 'job-1');
  assert.equal(saved.readId, 'advice-read-1');
  assert.deepEqual(
    saved.sections.map((section) => [section.decision, section.kind]),
    [['keep', 'ai_suggested'], ['correct', 'ai_suggested']],
  );
  // The advice is never a human decision: no decision rows are written here.
  assert.equal('decision' in saved, false);
});

test('BE-30: an invented quote is rejected; the paid attempt is booked without an advice', async () => {
  const invented = {
    sections: [
      { rubriekId: '0.0', decision: 'keep', confidence: 'hoog', quote: 'Deze rubriek klopt volgens mij.' },
      { rubriekId: '0.1', decision: 'keep', confidence: 'laag', quote: 'Fictieve zeebaars 24,00' },
    ],
  };
  let created = 0;
  const saved = [];
  const handlers = createMenuStructureAdviceHandlers({
    authenticate: async () => ({ ok: true, userId: 'user-1', roles: [{ role: 'internal', restaurant_id: null }] }),
    env: () => ({ ANTHROPIC_API_KEY: 'fixture-key', MENU_AI_FALLBACK_ENABLED: 'true' }),
    now: () => new Date('2026-10-25T12:00:00Z'),
    readSource: async () => ({ ok: true, receiptId: 'receipt-1', receiptHash: HASH, menus: MENUS, storedAdvice: null }),
    readUsageRows: async () => ({ ok: true, rows: [] }),
    createCall: ({ budget }) => {
      created += 1;
      return fakeCall({ budget, state: { calls: [] }, answer: invented, cost: 2 });
    },
    saveAdvice: async ({ record }) => {
      saved.push(record);
      return { ok: true };
    },
    generateId: () => 'advice-read-2',
  });
  const res = await handlers.advise(httpRequest({ job_id: 'job-1' }));
  assert.equal(created, 1);
  assert.equal(res.status, 422);
  assert.equal(res.body.reason, 'advice_rejected');
  assert.equal(res.body.advice, undefined);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].outcome, 'rejected');
  assert.deepEqual(
    saved[0].rejected.map((entry) => entry.reason),
    ['quote_not_in_source', 'low_confidence'],
  );
  assert.deepEqual(saved[0].sections, []);
  assert.deepEqual(saved[0].cost, { eurCents: 2, known: true });
});

test('BE-30: a timeout is reported honestly and the paid attempt stays booked', async () => {
  const timeout = Object.assign(new Error('timeout'), { code: 'timeout' });
  const { handlers, state } = setup({
    createCall: ({ budget }) => {
      state.createCall += 1;
      // The provider module books the measured cost on the guard, also on failure.
      budget.costEurCents = 1;
      return {
        enabled: true,
        provider: 'anthropic',
        model: 'claude-haiku-5-5',
        lastCall: null,
        async call() {
          throw timeout;
        },
      };
    },
  });
  const res = await handlers.advise(httpRequest({ job_id: 'job-1' }));
  assert.equal(res.status, 502);
  assert.equal(res.body.reason, 'advice_timeout');
  assert.match(res.body.error, /zelf beoordelen/);
  assert.equal(state.saved.length, 1);
  assert.equal(state.saved[0].outcome, 'failed');
  assert.equal(state.saved[0].cost.eurCents, 1);
});


test('BE-30: an earlier advice for this exact source version costs nothing again', async () => {
  const stored = adviceRecord({
    jobId: 'job-1',
    receiptHash: HASH,
    advices: [{ key: '["Voor"]', decision: 'keep', correctedPath: null, confidence: 'hoog', quote: 'Fictieve burrata 13,00' }],
    cost: { eurCents: 1, known: true },
    now: new Date('2026-10-25T11:00:00Z'),
    readId: 'earlier',
  });
  const { handlers, state } = setup({
    readSource: async () => ({ ok: true, receiptId: 'receipt-1', receiptHash: HASH, menus: MENUS, storedAdvice: stored }),
  });
  const res = await handlers.advise(httpRequest({ job_id: 'job-1' }));
  assert.equal(res.status, 200);
  assert.equal(res.body.reused, true);
  assert.equal(res.body.cost, null);
  assert.equal(state.createCall, 0);
  // A new analysis (other receipt hash) never reuses an old advice.
  const fresh = setup({
    readSource: async () => ({ ok: true, receiptId: 'receipt-2', receiptHash: 'b'.repeat(64), menus: MENUS, storedAdvice: stored }),
  });
  const second = await fresh.handlers.advise(httpRequest({ job_id: 'job-1' }));
  assert.equal(second.status, 200);
  assert.equal(second.body.reused, false);
  assert.equal(fresh.state.createCall, 1);
});

test('BE-30: without literal source text nothing is called and the screen stays usable', async () => {
  const { handlers, state } = setup({
    readSource: async () => ({
      ok: true,
      receiptId: 'receipt-1',
      receiptHash: HASH,
      menus: [
        {
          title: 'Fictief',
          structure: 'uncertain',
          categories: [{ name: 'Voor', path: ['Voor'], uncertain: true, items: [{ name: 'Fictieve burrata', price: '13.00' }] }],
        },
      ],
      storedAdvice: null,
    }),
  });
  const res = await handlers.advise(httpRequest({ job_id: 'job-1' }));
  assert.equal(res.status, 422);
  assert.equal(res.body.reason, 'source_text_unavailable');
  assert.match(res.body.error, /Beoordeel de rubrieken zelf/);
  assert.equal(state.createCall, 0);
});

test('BE-30: no sections, another job, a non-internal role or a bad body never call the AI', async () => {
  const empty = setup({
    readSource: async () => ({
      ok: true,
      receiptId: 'receipt-1',
      receiptHash: HASH,
      menus: [{ title: 'Fictief', categories: [{ name: 'Voor', path: ['Voor'], items: [] }] }],
      storedAdvice: null,
    }),
  });
  assert.equal((await empty.handlers.advise(httpRequest({ job_id: 'job-1' }))).body.reason, 'structure_sections_unknown');
  assert.equal(empty.state.createCall, 0);

  const other = setup({ readSource: async () => ({ ok: false }) });
  assert.equal((await other.handlers.advise(httpRequest({ job_id: 'job-2' }))).status, 404);
  assert.equal(other.state.createCall, 0);

  const role = setup({ authenticate: async () => ({ ok: true, userId: 'user-1', roles: [{ role: 'owner', restaurant_id: '23' }] }) });
  const denied = await role.handlers.advise(httpRequest({ job_id: 'job-1' }));
  assert.equal(denied.status, 403);
  assert.equal(role.state.createCall, 0);

  const anonymous = setup({ authenticate: async () => null });
  assert.equal((await anonymous.handlers.advise(httpRequest({ job_id: 'job-1' }))).status, 401);

  const bad = setup();
  assert.equal((await bad.handlers.advise(httpRequest({}))).body.reason, 'invalid_request');
  assert.equal((await bad.handlers.advise(httpRequest('geen json'))).body.reason, 'invalid_request');
  assert.equal(bad.state.createCall, 0);
});

test('BE-30: an advice that cannot be stored is reported, never claimed as saved', async () => {
  const { handlers, state } = setup({ saveAdvice: async () => ({ ok: false, reason: 'advice_not_stored' }) });
  const res = await handlers.advise(httpRequest({ job_id: 'job-1' }));
  assert.equal(res.status, 502);
  assert.equal(res.body.reason, 'advice_not_stored');
  assert.equal(res.body.advice, undefined);
  assert.equal(state.calls.length, 1);
});

test('BE-30: a provider failure other than a timeout is a concrete, honest error', async () => {
  const { handlers, state } = setup({
    createCall: ({ budget }) => {
      state.createCall += 1;
      return {
        enabled: true,
        provider: 'anthropic',
        model: 'claude-haiku-5-5',
        lastCall: null,
        async call() {
          budget.costEurCents = null;
          throw Object.assign(new Error('provider'), { code: 'provider_unavailable' });
        },
      };
    },
  });
  const res = await handlers.advise(httpRequest({ job_id: 'job-1' }));
  assert.equal(res.status, 502);
  assert.equal(res.body.reason, 'advice_failed');
  // An unknown cost is never booked as zero.
  assert.equal(state.saved[0].cost.known, false);
  assert.equal(state.saved[0].outcome, 'failed');
});
