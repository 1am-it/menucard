'use strict';

// BE-48 (#112) — de serverafdwinging van de tweede inlogstap.
//
// Bewijst met een fictieve Supabase-client (geen database, geen netwerk):
//  - aal1 + internal  → 403 "Tweede inlogstap vereist";
//  - aal1 + editor    → 403;
//  - aal2 + editor    → ok;
//  - aal1 + alleen owner → ok (restauranthouder, BE-47/#111);
//  - geen token       → 401;
//  - een kapot token-payload → 403 (fail closed) of 401, nooit een crash;
//  - een rollenquery die faalt → 500, geen crash.
//
// De token is hier een echt gevormde JWT (header.payload.signature) met een
// payload die `aal` noemt, precies wat Supabase afgeeft; de handtekening is
// fictief omdat `getUser` in het echt al heeft geverifieerd.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  SECOND_FACTOR_ERROR,
  SECOND_FACTOR_REASON,
  createInternalAuth,
  getAccessForRestaurant,
  readAssuranceLevel,
  readBearerToken,
  rolesRequireSecondFactor,
  secondFactorMissing,
} = require('./internalAuthCore');

function base64url(value) {
  return Buffer.from(value, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function tokenWithAal(aal) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ sub: 'fixture-user', role: 'authenticated', aal, amr: [{ method: 'password' }] }));
  return `${header}.${payload}.fixture-signature`;
}

function requestWith(token) {
  return { headers: { get: (name) => (name.toLowerCase() === 'authorization' && token ? `Bearer ${token}` : null) } };
}

// A fictional Supabase client: `auth.getUser` accepts exactly the fixtures it
// was given, and staff_roles answers with the rows of the same user.
function fakeSupabase({ validTokens = [], roles = [], rolesError = null, throwOnRoles = false, throwOnGetUser = false } = {}) {
  const queries = [];
  return {
    queries,
    auth: {
      getUser: async (token) => {
        if (throwOnGetUser) throw new Error('network down');
        if (validTokens.includes(token)) return { data: { user: { id: 'fixture-user' } }, error: null };
        return { data: { user: null }, error: { message: 'invalid JWT' } };
      },
    },
    from: (table) => {
      queries.push(table);
      const builder = {
        select: () => builder,
        eq: () => {
          if (throwOnRoles) throw new Error('relation does not exist');
          return Promise.resolve({ data: rolesError ? null : roles, error: rolesError });
        },
      };
      return builder;
    },
  };
}

function guardFor(client) {
  return createInternalAuth({ getSupabase: () => client });
}

test('internalAuth: aal1 + internal is refused with 403 "Tweede inlogstap vereist"', async () => {
  const token = tokenWithAal('aal1');
  const client = fakeSupabase({ validTokens: [token], roles: [{ role: 'internal', restaurant_id: null }] });
  const auth = await guardFor(client).authenticateInternalRequest(requestWith(token));
  assert.equal(auth.ok, false);
  assert.equal(auth.status, 403);
  assert.equal(auth.error, SECOND_FACTOR_ERROR);
  assert.equal(auth.error, 'Tweede inlogstap vereist');
  assert.equal(auth.reason, SECOND_FACTOR_REASON);
  // The role lookup really ran before the refusal.
  assert.deepEqual(client.queries, ['staff_roles']);
});

test('internalAuth: aal1 + editor is refused the same way', async () => {
  const token = tokenWithAal('aal1');
  const client = fakeSupabase({ validTokens: [token], roles: [{ role: 'editor', restaurant_id: '6' }] });
  const auth = await guardFor(client).authenticateInternalRequest(requestWith(token));
  assert.equal(auth.status, 403);
  assert.equal(auth.error, SECOND_FACTOR_ERROR);
});

test('internalAuth: aal2 + editor is allowed', async () => {
  const token = tokenWithAal('aal2');
  const client = fakeSupabase({ validTokens: [token], roles: [{ role: 'editor', restaurant_id: '6' }] });
  const auth = await guardFor(client).authenticateInternalRequest(requestWith(token));
  assert.equal(auth.ok, true);
  assert.equal(auth.userId, 'fixture-user');
  assert.deepEqual(auth.roles, [{ role: 'editor', restaurant_id: '6' }]);
});

test('internalAuth: aal1 + only owner keeps working (BE-47 owns the restaurant route)', async () => {
  const token = tokenWithAal('aal1');
  const client = fakeSupabase({ validTokens: [token], roles: [{ role: 'owner', restaurant_id: '9001' }] });
  const auth = await guardFor(client).authenticateInternalRequest(requestWith(token));
  assert.equal(auth.ok, true);
  assert.deepEqual(auth.roles, [{ role: 'owner', restaurant_id: '9001' }]);
});

test('internalAuth: an internal account that also owns a restaurant still needs aal2', async () => {
  const token = tokenWithAal('aal1');
  const roles = [{ role: 'owner', restaurant_id: '9001' }, { role: 'internal', restaurant_id: null }];
  const client = fakeSupabase({ validTokens: [token], roles });
  const auth = await guardFor(client).authenticateInternalRequest(requestWith(token));
  assert.equal(auth.status, 403);
  assert.equal(auth.error, SECOND_FACTOR_ERROR);
});

test('internalAuth: no token, an empty header or another scheme gives 401 and touches nothing', async () => {
  const client = fakeSupabase({ roles: [{ role: 'internal' }] });
  const guard = guardFor(client);
  for (const request of [
    { headers: { get: () => null } },
    { headers: { get: () => '' } },
    { headers: { get: () => 'Basic abc' } },
    { headers: { get: () => 'Bearer ' } },
    {},
    null,
    { headers: {} },
  ]) {
    const auth = await guard.authenticateInternalRequest(request);
    assert.equal(auth.ok, false);
    assert.equal(auth.status, 401);
  }
  assert.deepEqual(client.queries, []);
});

test('internalAuth: an unverified or expired token gives 401', async () => {
  const client = fakeSupabase({ roles: [{ role: 'internal' }] });
  const auth = await guardFor(client).authenticateInternalRequest(requestWith(tokenWithAal('aal2')));
  assert.equal(auth.status, 401);
  assert.equal(auth.error, 'Invalid or expired session');
});



test('internalAuth: a broken token payload fails closed for internal, never crashes', async () => {
  const broken = [
    'not-a-jwt',
    'header.only',
    'a.b.c',
    `${base64url('{"alg":"HS256"}')}.%%%.sig`,
    `${base64url('{"alg":"HS256"}')}.${base64url('not json')}.sig`,
    `${base64url('{"alg":"HS256"}')}.${base64url('["aal2"]')}.sig`,
    `${base64url('{"alg":"HS256"}')}.${base64url('null')}.sig`,
  ];
  for (const token of broken) {
    assert.equal(readAssuranceLevel(token), null, token);
    const client = fakeSupabase({ validTokens: [token], roles: [{ role: 'internal' }] });
    const auth = await guardFor(client).authenticateInternalRequest(requestWith(token));
    // Verified by the fixture, but no readable level: the second step is missing.
    assert.equal(auth.ok, false);
    assert.equal(auth.status, 403);
    assert.equal(auth.error, SECOND_FACTOR_ERROR);
  }
});

test('internalAuth: a broken payload on an owner-only account still resolves, without a crash', async () => {
  const token = 'header.%%%.sig';
  const client = fakeSupabase({ validTokens: [token], roles: [{ role: 'owner', restaurant_id: '9001' }] });
  const auth = await guardFor(client).authenticateInternalRequest(requestWith(token));
  assert.equal(auth.ok, true);
});

test('internalAuth: an account without staff roles gets 403, and no aal is claimed', async () => {
  const token = tokenWithAal('aal1');
  const client = fakeSupabase({ validTokens: [token], roles: [] });
  const auth = await guardFor(client).authenticateInternalRequest(requestWith(token));
  assert.equal(auth.status, 403);
  assert.equal(auth.error, 'No staff role assigned for this account');
  assert.equal(auth.reason, undefined);
});

test('internalAuth: failing or throwing queries give a clean 500, never a crash', async () => {
  const token = tokenWithAal('aal2');
  const failed = fakeSupabase({ validTokens: [token], rolesError: { message: 'boom' } });
  assert.equal((await guardFor(failed).authenticateInternalRequest(requestWith(token))).status, 500);

  const throwing = fakeSupabase({ validTokens: [token], throwOnRoles: true });
  const thrown = await guardFor(throwing).authenticateInternalRequest(requestWith(token));
  assert.equal(thrown.status, 500);
  assert.equal(thrown.ok, false);

  const userThrows = fakeSupabase({ throwOnGetUser: true });
  const userThrown = await guardFor(userThrows).authenticateInternalRequest(requestWith(token));
  assert.equal(userThrown.status, 401);
});

test('internalAuth: a misconfigured deployment still answers with a clean 500', async () => {
  const guard = createInternalAuth({
    getSupabase: () => {
      throw new Error('Supabase is not configured');
    },
  });
  const auth = await guard.authenticateInternalRequest(requestWith(tokenWithAal('aal2')));
  assert.equal(auth.status, 500);
  assert.equal(auth.error, 'Internal API is not configured');
});

test('internalAuth: the pure helpers name exactly which levels and roles need a second step', () => {
  assert.equal(rolesRequireSecondFactor([{ role: 'internal' }]), true);
  assert.equal(rolesRequireSecondFactor([{ role: 'editor' }]), true);
  assert.equal(rolesRequireSecondFactor([{ role: 'owner', restaurant_id: '1' }]), false);
  assert.equal(rolesRequireSecondFactor([]), false);
  assert.equal(rolesRequireSecondFactor(null), false);

  assert.equal(secondFactorMissing([{ role: 'internal' }], 'aal1'), true);
  assert.equal(secondFactorMissing([{ role: 'internal' }], null), true);
  assert.equal(secondFactorMissing([{ role: 'internal' }], 'aal2'), false);
  assert.equal(secondFactorMissing([{ role: 'owner' }], 'aal1'), false);
  // A token whose payload only carries an unknown level is not aal2.
  assert.equal(secondFactorMissing([{ role: 'editor' }], 'aal3'), true);
});

test('internalAuth: the bearer token is read strictly, never from another header or scheme', () => {
  assert.equal(readBearerToken({ headers: { get: () => 'Bearer abc.def.ghi' } }), 'abc.def.ghi');
  assert.equal(readBearerToken({ headers: { get: () => 'bearer abc' } }), null);
  assert.equal(readBearerToken({ headers: { get: () => 'Bearer   ' } }), null);
  assert.equal(readBearerToken({}), null);
  assert.equal(readBearerToken(null), null);
});

test('internalAuth: getAccessForRestaurant keeps its role mapping unchanged', () => {
  assert.deepEqual(getAccessForRestaurant([{ role: 'editor', restaurant_id: '6' }], '999'), {
    allowed: true,
    source: 'editor',
    confidence: 'high',
  });
  assert.deepEqual(getAccessForRestaurant([{ role: 'owner', restaurant_id: '6' }], '6'), {
    allowed: true,
    source: 'owner',
    confidence: 'high',
  });
  assert.deepEqual(getAccessForRestaurant([{ role: 'owner', restaurant_id: '6' }], '7'), { allowed: false });
  assert.deepEqual(getAccessForRestaurant([{ role: 'internal', restaurant_id: null }], '7'), {
    allowed: true,
    source: 'imported',
    confidence: 'low',
  });
});
