'use strict';

// BE-47 (#111) — de doorsturing van en naar de houder-omgeving.
//
// Bewijst de regel uit het contract met alleen een rollenlijst (de vorm die
// GET /api/internal/v1/me teruggeeft), zonder Supabase, React of netwerk:
//   - internal/editor → /internal/login (die heeft BE-48 se tweede stap);
//   - een owner-only account → /mijn-restaurant, ook op /internal;
//   - een account zonder rol houdt zijn bestaande "geen toegang".

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  INTERNAL_LOGIN_HREF,
  OWNER_ACCESS_MESSAGES,
  OWNER_HOME_HREF,
  OWNER_LOGIN_HREF,
  hasInternalRole,
  hasOwnerRole,
  isOwnerOnly,
  ownerRestaurantIds,
  resolveInternalOwnerRedirect,
  resolveOwnerEntry,
} = require('./ownerAccess');

const OWNER = [{ role: 'owner', restaurant_id: '7' }];
const INTERNAL = [{ role: 'internal', restaurant_id: null }];
const EDITOR = [{ role: 'editor', restaurant_id: null }];

test('ownerAccess: the three hrefs are the contract paths', () => {
  assert.equal(OWNER_LOGIN_HREF, '/mijn-restaurant/inloggen');
  assert.equal(OWNER_HOME_HREF, '/mijn-restaurant');
  assert.equal(INTERNAL_LOGIN_HREF, '/internal/login');
});

test('ownerAccess: an internal or editor account continues to /internal/login', () => {
  assert.deepEqual(resolveOwnerEntry(INTERNAL), { href: INTERNAL_LOGIN_HREF, reason: 'internal-login' });
  assert.deepEqual(resolveOwnerEntry(EDITOR), { href: INTERNAL_LOGIN_HREF, reason: 'internal-login' });
  // Even when the same account also owns a restaurant: the second step wins.
  assert.equal(resolveOwnerEntry(INTERNAL.concat(OWNER)).href, INTERNAL_LOGIN_HREF);
  assert.equal(hasInternalRole(INTERNAL.concat(OWNER)), true);
});

test('ownerAccess: an owner-only account continues to /mijn-restaurant', () => {
  assert.deepEqual(resolveOwnerEntry(OWNER), { href: OWNER_HOME_HREF, reason: 'owner-home' });
  assert.deepEqual(resolveOwnerEntry([{ role: 'owner', restaurant_id: '7' }, { role: 'owner', restaurant_id: '9' }]), {
    href: OWNER_HOME_HREF,
    reason: 'owner-home',
  });
  assert.equal(hasOwnerRole(OWNER), true);
  assert.equal(isOwnerOnly(OWNER), true);
});

test('ownerAccess: on /internal an owner-only account is redirected, nobody else', () => {
  assert.equal(resolveInternalOwnerRedirect(OWNER), '/mijn-restaurant');
  assert.equal(resolveInternalOwnerRedirect(INTERNAL.concat(OWNER)), null);
  assert.equal(resolveInternalOwnerRedirect(EDITOR.concat(OWNER)), null);
  assert.equal(resolveInternalOwnerRedirect(INTERNAL), null);
  assert.equal(resolveInternalOwnerRedirect([]), null);
  assert.equal(resolveInternalOwnerRedirect(null), null);
});

test('ownerAccess: an account without a role gets no invented destination', () => {
  assert.deepEqual(resolveOwnerEntry([]), { href: OWNER_HOME_HREF, reason: 'owner-home' });
  assert.equal(resolveInternalOwnerRedirect([]), null);
  assert.equal(isOwnerOnly([]), false);
  assert.equal(hasOwnerRole([{ role: 'editor' }]), false);
  assert.equal(hasInternalRole([{ role: 'owner', restaurant_id: '7' }]), false);
});

test('ownerAccess: ownerRestaurantIds keeps the API order and drops junk', () => {
  assert.deepEqual(ownerRestaurantIds(OWNER), ['7']);
  assert.deepEqual(
    ownerRestaurantIds([
      { role: 'owner', restaurant_id: '9' },
      { role: 'internal', restaurant_id: null },
      { role: 'owner', restaurant_id: '7' },
      { role: 'owner', restaurant_id: '' },
      { role: 'owner', restaurant_id: null },
      { role: 'owner' },
      null,
      'owner',
    ]),
    ['9', '7'],
  );
  assert.deepEqual(ownerRestaurantIds(null), []);
});

test('ownerAccess: the texts are Dutch and never say whether an account exists', () => {
  for (const text of Object.values(OWNER_ACCESS_MESSAGES)) {
    assert.equal(typeof text, 'string');
    assert.ok(text.length > 0);
    assert.doesNotMatch(text, /bestaat niet|unknown user|not found/i);
  }
});
