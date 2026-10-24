'use strict';

// #59 review 6309694854 — the confirmation idempotency key. Pure logic, no
// database: the same stored result must always yield the same proposal id so
// the existing primary key can refuse a second accepted proposal.

const test = require('node:test');
const assert = require('node:assert/strict');

const { confirmationProposalId } = require('./sourceConfirmation');

const JOB = '0192f000-0000-7000-8000-0000000000a1';
const URL = 'https://www.bistro-fictief-voorbeeld.nl/menukaart';

test('confirmation proposal id: a stable RFC-shaped UUIDv8 per stored result', () => {
  const id = confirmationProposalId({ jobId: JOB, restaurantId: 'bistro', url: URL });
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(id.split('-')[2][0], '8', 'custom (version 8) UUID, not a v7 row id');
  assert.ok(['8', '9', 'a', 'b'].includes(id.split('-')[3][0]), 'RFC variant bits 10xx');
  // The exact value is part of the contract: it must not drift silently.
  assert.equal(id, '50e90f9d-506c-84e5-b5d8-4d0db0304de6');
});

test('confirmation proposal id: deterministic for a retry, different for another result', () => {
  const base = { jobId: JOB, restaurantId: 'bistro', url: URL };
  assert.equal(confirmationProposalId(base), confirmationProposalId({ ...base }));
  const ids = new Set([
    confirmationProposalId(base),
    confirmationProposalId({ ...base, jobId: '0192f000-0000-7000-8000-0000000000a2' }),
    confirmationProposalId({ ...base, restaurantId: 'andere-zaak' }),
    confirmationProposalId({ ...base, url: 'https://www.bistro-fictief-voorbeeld.nl/' }),
  ]);
  assert.equal(ids.size, 4, 'job, restaurant and URL each take part in the key');
});

test('confirmation proposal id: refuses incomplete input instead of hashing "undefined"', () => {
  for (const bad of [{}, { jobId: JOB }, { jobId: JOB, restaurantId: 'bistro' }, { jobId: JOB, restaurantId: 'bistro', url: '   ' }]) {
    assert.throws(() => confirmationProposalId(bad), TypeError);
  }
});
