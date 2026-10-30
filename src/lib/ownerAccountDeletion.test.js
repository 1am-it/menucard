'use strict';

// BE-47 (#111), criterium 4 — de verwijderroute: alleen de eigen gebruiker, met
// een verse code. Alles met een fictieve Supabase-client; geen netwerk, geen
// service-role key, geen echte gebruiker.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  DELETION_MESSAGES,
  createAccountDeletionHandler,
  isForeignKeyViolation,
  readBearerToken,
} = require('./ownerAccountDeletion');
const { MESSAGES } = require('./authErrors');

const TOKEN = 'fixture-access-token';
const CODE = '654321';
const USER = { id: 'user-1', email: 'houder@example.invalid' };

function fakeRequest(options = {}) {
  return {
    headers: {
      get(name) {
        if (String(name).toLowerCase() !== 'authorization') return null;
        return options.authorization === undefined ? `Bearer ${TOKEN}` : options.authorization;
      },
    },
    async json() {
      if (options.body instanceof Error) throw options.body;
      return options.body === undefined ? { code: CODE } : options.body;
    },
  };
}

function fakeSupabase(options = {}) {
  const calls = [];
  const sessionUser = options.user === undefined ? USER : options.user;
  return {
    calls,
    auth: {
      async getUser(token) {
        calls.push({ method: 'getUser', token });
        if (options.getUserError) return { data: { user: null }, error: options.getUserError };
        return { data: { user: sessionUser }, error: null };
      },
      async verifyOtp(credentials) {
        calls.push({ method: 'verifyOtp', credentials });
        if (options.verifyError) return { data: null, error: options.verifyError };
        const verifiedUser = options.verifiedUser === undefined ? sessionUser : options.verifiedUser;
        return { data: { user: verifiedUser, session: {} }, error: null };
      },
      admin: {
        async deleteUser(userId) {
          calls.push({ method: 'deleteUser', userId });
          return { data: {}, error: options.deleteError || null };
        },
      },
    },
  };
}

function handlerFor(supabase, options = {}) {
  return createAccountDeletionHandler({
    getSupabase:
      options.getSupabase ||
      (() => {
        if (options.throws) throw new Error('not configured');
        return supabase;
      }),
  });
}

test('delete: without a bearer token nothing happens', async () => {
  const supabase = fakeSupabase();
  const outcome = await handlerFor(supabase)(fakeRequest({ authorization: null }));
  assert.equal(outcome.status, 401);
  assert.equal(outcome.body.error, DELETION_MESSAGES.notSignedIn);
  assert.deepEqual(supabase.calls, []);
});

test('delete: an incomplete code is refused before Supabase is touched', async () => {
  const supabase = fakeSupabase();
  for (const body of [{ code: '' }, { code: '12345' }, { code: 'abcdef' }, {}, null, new Error('bad json')]) {
    const outcome = await handlerFor(supabase)(fakeRequest({ body }));
    assert.equal(outcome.status, 400, JSON.stringify(body));
    assert.match(outcome.body.error, /code/i);
  }
  assert.deepEqual(supabase.calls, []);
});

test('delete: a wrong or expired code never deletes anything', async () => {
  const supabase = fakeSupabase({ verifyError: { code: 'otp_expired', status: 403, message: 'Token expired' } });
  const outcome = await handlerFor(supabase)(fakeRequest());
  assert.equal(outcome.status, 400);
  assert.equal(outcome.body.error, MESSAGES.invalidEmailCode);
  assert.doesNotMatch(outcome.body.error, /token|expired/i);
  assert.ok(!supabase.calls.some((call) => call.method === 'deleteUser'));
});

test('delete: a code that belongs to another account is refused with 403', async () => {
  const supabase = fakeSupabase({ verifiedUser: { id: 'someone-else' } });
  const outcome = await handlerFor(supabase)(fakeRequest());
  assert.equal(outcome.status, 403);
  assert.equal(outcome.body.error, DELETION_MESSAGES.otherUser);
  assert.ok(!supabase.calls.some((call) => call.method === 'deleteUser'));
});

test('delete: only the session’s own user is removed, never an id from the body', async () => {
  const supabase = fakeSupabase();
  const outcome = await handlerFor(supabase)(
    fakeRequest({ body: { code: CODE, userId: 'attacker-chosen', email: 'anders@example.invalid' } }),
  );
  assert.equal(outcome.status, 200);
  assert.deepEqual(outcome.body, { deleted: true, message: DELETION_MESSAGES.deleted });
  // The address for the code comes from the verified session…
  const verify = supabase.calls.find((call) => call.method === 'verifyOtp');
  assert.deepEqual(verify.credentials, { email: USER.email, token: CODE, type: 'email' });
  // …and the deleted id is the session user, not the one in the body.
  const deletes = supabase.calls.filter((call) => call.method === 'deleteUser');
  assert.deepEqual(deletes, [{ method: 'deleteUser', userId: USER.id }]);
});

test('delete: an invalid session token is a 401 and never reaches a delete', async () => {
  const supabase = fakeSupabase({ getUserError: { message: 'invalid JWT' } });
  const outcome = await handlerFor(supabase)(fakeRequest());
  assert.equal(outcome.status, 401);
  assert.ok(!supabase.calls.some((call) => call.method === 'deleteUser'));
});

test('delete: an account without an e-mail address is refused instead of guessed', async () => {
  const supabase = fakeSupabase({ user: { id: 'user-2', email: null } });
  const outcome = await handlerFor(supabase)(fakeRequest());
  assert.equal(outcome.status, 400);
  assert.equal(outcome.body.error, DELETION_MESSAGES.noEmail);
  assert.ok(!supabase.calls.some((call) => call.method === 'deleteUser'));
});

test('delete: a foreign key that still refers to the account keeps the account', async () => {
  const supabase = fakeSupabase({ deleteError: { code: '23503', message: 'update or delete violates foreign key' } });
  const outcome = await handlerFor(supabase)(fakeRequest());
  assert.equal(outcome.status, 409);
  assert.equal(outcome.body.error, DELETION_MESSAGES.blocked);
  assert.match(outcome.body.error, /contact/i);
});

test('delete: any other delete failure is a safe Dutch 500', async () => {
  const supabase = fakeSupabase({ deleteError: { message: 'Database error saving new user' } });
  const outcome = await handlerFor(supabase)(fakeRequest());
  assert.equal(outcome.status, 500);
  assert.equal(outcome.body.error, DELETION_MESSAGES.failed);
  assert.doesNotMatch(outcome.body.error, /database/i);
});

test('delete: without Supabase configuration the route says so and deletes nothing', async () => {
  const outcome = await handlerFor(null, { throws: true })(fakeRequest());
  assert.equal(outcome.status, 500);
  assert.equal(outcome.body.error, DELETION_MESSAGES.notConfigured);
});

test('delete: readBearerToken only accepts a real bearer header', () => {
  assert.equal(readBearerToken(null), null);
  assert.equal(readBearerToken({}), null);
  assert.equal(readBearerToken(fakeRequest({ authorization: '' })), null);
  assert.equal(readBearerToken(fakeRequest({ authorization: 'Basic abc' })), null);
  assert.equal(readBearerToken(fakeRequest({ authorization: 'Bearer ' })), null);
  assert.equal(readBearerToken(fakeRequest({ authorization: 'bearer  abcdef  ' })), 'abcdef');
});

test('delete: isForeignKeyViolation recognises Postgres 23503 and the FK wording', () => {
  assert.equal(isForeignKeyViolation({ code: '23503' }), true);
  assert.equal(isForeignKeyViolation({ message: 'violates foreign key constraint' }), true);
  assert.equal(isForeignKeyViolation({ code: '42501', message: 'permission denied' }), false);
  assert.equal(isForeignKeyViolation(null), false);
});

test('delete: the handler refuses to be built without a Supabase factory', () => {
  assert.throws(() => createAccountDeletionHandler({}), TypeError);
  assert.throws(() => createAccountDeletionHandler(), TypeError);
});

