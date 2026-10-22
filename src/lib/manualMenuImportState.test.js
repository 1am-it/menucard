'use strict';

// #59 fase 2 — herstelronde 6350337273 (K1): het toestandstoken.
//
// Bewijst dat de tussenstap alleen leesbaar is met het servergeheim, dat een
// gewijzigd of verlopen token geweigerd wordt en dat de grootte begrensd is.
// Geen netwerk, geen database en geen browseropslag.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createManualImportStateCipher,
  deriveStateKey,
  MAX_STATE_TOKEN_CHARS,
  STATE_TOKEN_PREFIX,
} = require('./manualMenuImportState');

const SECRET = 'service-role-key-for-tests-0123456789';
const OTHER_SECRET = 'another-service-role-key-9876543210';
const NOW = new Date('2026-10-22T12:00:00.000Z');

function bundle(overrides = {}) {
  return {
    bundleHash: 'a'.repeat(64),
    actorUserId: 'user-1',
    restaurantId: '23',
    fetchedAt: NOW.toISOString(),
    sources: [{ id: 'source-1', url: 'https://voorbeeld.example/menu', sha256: 'b'.repeat(64), text: 'Broodplank 8,50' }],
    ...overrides,
  };
}

function state(overrides = {}) {
  return {
    userId: 'user-1',
    restaurantId: '23',
    bundle: bundle(),
    report: null,
    decisions: [],
    followUps: {},
    followUpTotal: 0,
    ...overrides,
  };
}

function cipher(options = {}) {
  return createManualImportStateCipher({ secret: SECRET, now: () => NOW, ...options });
}

test('K1: HKDF geeft een stabiele sleutel per geheim en een andere sleutel voor een ander geheim', () => {
  const first = deriveStateKey(SECRET);
  const second = deriveStateKey(SECRET);
  const other = deriveStateKey(OTHER_SECRET);
  assert.equal(first.length, 32);
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, other);
  assert.throws(() => deriveStateKey(''), /niet geconfigureerd/);
});

test('K1: het token reist heen en terug en bevat de brontekst niet leesbaar', () => {
  const sealed = cipher().seal(
    state({
      report: {
        importId: 'import-1',
        bundleHash: 'a'.repeat(64),
        summary: { items: 1 },
      },
    }),
  );
  assert.ok(sealed.token.startsWith(`${STATE_TOKEN_PREFIX}.`));
  assert.equal(sealed.token.includes('Broodplank'), false);
  assert.equal(sealed.token.includes('source-1'), false);
  assert.equal(sealed.expiresAt, '2026-10-22T12:30:00.000Z');
  const opened = cipher().open(sealed.token);
  assert.equal(opened.ok, true);
  assert.equal(opened.state.userId, 'user-1');
  assert.equal(opened.state.report.importId, 'import-1');
  assert.equal(opened.state.bundle.sources[0].text, 'Broodplank 8,50');
});

test('K1: elke stap geeft een nieuw token met een eigen IV', () => {
  const first = cipher().seal(state());
  const second = cipher().seal(state());
  assert.notEqual(first.token, second.token);
});

test('K1: een gewijzigd token, een vreemd token en een gewijzigd voorvoegsel worden geweigerd', () => {
  const sealed = cipher().seal(state());
  const parts = sealed.token.split('.');
  const flipped = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -1)}${parts[2].slice(-1) === 'A' ? 'B' : 'A'}.${parts[3]}`;
  assert.equal(cipher().open(flipped).code, 'state_invalid');
  assert.equal(cipher().open('mmis1.abc.def.ghi').code, 'state_invalid');
  assert.equal(cipher().open('iets anders').code, 'state_invalid');
  assert.equal(cipher().open('').code, 'state_invalid');
  assert.equal(cipher().open('mmis9.abc.def.ghi').code, 'state_invalid');
});

test('K1: een token van een andere server (ander geheim) is niet te openen', () => {
  const sealed = cipher().seal(state());
  const other = createManualImportStateCipher({ secret: OTHER_SECRET, now: () => NOW });
  const opened = other.open(sealed.token);
  assert.equal(opened.ok, false);
  assert.equal(opened.code, 'state_invalid');
});

test('K1: een verlopen token geeft state_expired, een token net binnen de tijd niet', () => {
  const sealed = cipher().seal(state());
  const justBefore = createManualImportStateCipher({
    secret: SECRET,
    now: () => new Date(NOW.getTime() + 29 * 60 * 1000),
  });
  assert.equal(justBefore.open(sealed.token).ok, true);
  const after = createManualImportStateCipher({
    secret: SECRET,
    now: () => new Date(NOW.getTime() + 30 * 60 * 1000),
  });
  const opened = after.open(sealed.token);
  assert.equal(opened.ok, false);
  assert.equal(opened.code, 'state_expired');
  assert.match(opened.message, /verlopen/);
});

test('K1: een te groot token wordt bij het maken en bij het openen geweigerd', () => {
  const small = cipher({ maxTokenChars: 120 });
  assert.throws(() => small.seal(state()), /te groot/);
  const sealed = cipher().seal(state());
  const opened = small.open(sealed.token);
  assert.equal(opened.ok, false);
  assert.equal(opened.code, 'state_too_large');
  // De productiegrens is ruim boven een normale stap.
  assert.ok(MAX_STATE_TOKEN_CHARS >= 1024 * 1024);
});

test('K1: een ontbrekend geheim geeft een concrete configuratiefout', () => {
  const missing = createManualImportStateCipher({ secret: undefined });
  assert.throws(() => missing.seal(state()), /niet geconfigureerd/);
  const opened = missing.open('mmis1.abc.def.ghi');
  assert.equal(opened.ok, false);
  assert.equal(opened.code, 'state_config_missing');
});

test('K1: een inconsistente staat wordt niet ondertekend', () => {
  assert.throws(() => cipher().seal(state({ userId: '' })), /geldige import/);
  assert.throws(() => cipher().seal(state({ bundle: bundle({ actorUserId: 'user-2' }) })), /geldige import/);
  assert.throws(
    () => cipher().seal(state({ report: { importId: 'import-1', bundleHash: 'c'.repeat(64) } })),
    /geldige import/,
  );
});

test('K1: het token bevat gebruikers-ID, restaurant, hashes en vervaltijd', () => {
  const sealed = cipher().seal(state());
  const opened = cipher().open(sealed.token);
  assert.equal(opened.ok, true);
  assert.equal(opened.state.userId, 'user-1');
  assert.equal(opened.state.restaurantId, '23');
  assert.equal(opened.state.bundle.bundleHash, 'a'.repeat(64));
  assert.equal(opened.expiresAt, sealed.expiresAt);
});
