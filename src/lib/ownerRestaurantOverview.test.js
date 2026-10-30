'use strict';

// BE-47 (#111) — "Mijn restaurant": de drie claimstatussen, de restaurantkaarten
// en de links uit de statische data. Alleen een rollenlijst, een claimlijst en de
// statische index; geen Supabase, geen React, geen netwerk.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  CLAIM_STATUS_LABELS,
  OWNER_OVERVIEW_MESSAGES,
  approvedClaimRestaurantIds,
  buildOwnerOverview,
  ownedRestaurantIds,
  statusLabel,
} = require('./ownerRestaurantOverview');
const { buildOwnerRestaurantIndex } = require('./ownerRestaurantIndex');
const restaurantsData = require('../../data/restaurants.json');
const menusData = require('../../data/menus.json');

const RESTAURANTS = {
  '1': { name: 'Restaurant Wolfslaar', menuIds: ['1-lunch', '1-diner'] },
  '2': { name: 'Restaurant Blossem', menuIds: [] },
};

test('overview: an approved claim becomes a restaurant card with both public links', () => {
  const overview = buildOwnerOverview({
    roles: [{ role: 'owner', restaurant_id: '1' }],
    claims: [{ id: 12, restaurant_id: '1', status: 'approved', created_at: '2026-10-01T09:00:00.000Z' }],
    restaurants: RESTAURANTS,
  });

  assert.equal(overview.restaurants.length, 1);
  const card = overview.restaurants[0];
  assert.equal(card.name, 'Restaurant Wolfslaar');
  assert.equal(card.status, 'approved');
  assert.equal(card.statusLabel, CLAIM_STATUS_LABELS.approved);
  assert.equal(card.restaurantHref, '/restaurant/1');
  assert.equal(card.menuHref, '/menu/1-lunch');
  assert.match(card.note, /goedgekeurd/i);
  // The approved claim is not repeated in the claim list.
  assert.deepEqual(overview.claims, []);
  assert.equal(overview.empty, false);
  assert.equal(overview.hasOwnerAccess, true);
});

test('overview: a claim in behandeling shows the neutral waiting text and no buttons', () => {
  const overview = buildOwnerOverview({
    roles: [],
    claims: [{ id: 5, restaurant_id: '2', status: 'pending', created_at: '2026-10-28T10:00:00.000Z' }],
    restaurants: RESTAURANTS,
  });

  assert.deepEqual(overview.restaurants, []);
  const claim = overview.claims[0];
  assert.equal(claim.status, 'pending');
  assert.equal(claim.statusLabel, 'In behandeling');
  assert.equal(claim.name, 'Restaurant Blossem');
  assert.match(claim.note, /beoordeelt je aanvraag/i);
  // No management buttons: a pending claim has no retry and no menu link.
  assert.equal(claim.retryHref, null);
  assert.equal(claim.submittedOn, '2026-10-28');
  assert.equal(overview.hasOwnerAccess, false);
});

test('overview: a rejected claim is neutral and offers the way back to the claim route', () => {
  const overview = buildOwnerOverview({
    roles: [],
    claims: [
      { id: 6, restaurant_id: '1', status: 'rejected', decided_at: '2026-10-29T12:00:00.000Z' },
      { id: 7, restaurant_id: '2', status: 'rejected' },
    ],
    restaurants: RESTAURANTS,
  });

  assert.equal(overview.claims.length, 2);
  for (const claim of overview.claims) {
    assert.equal(claim.statusLabel, 'Afgewezen');
    assert.match(claim.note, /niet goedgekeurd/i);
    assert.equal(claim.retryHref, `/claim/${claim.restaurantId}`);
    assert.equal(claim.retryLabel, OWNER_OVERVIEW_MESSAGES.retryClaim);
  }
  assert.equal(overview.claims[0].decidedOn, '2026-10-29');
});


test('overview: an unknown status never looks approved and offers no button', () => {
  const overview = buildOwnerOverview({
    roles: [],
    claims: [{ id: 8, restaurant_id: '1', status: 'on_hold' }],
    restaurants: RESTAURANTS,
  });
  const claim = overview.claims[0];
  assert.equal(claim.status, 'on_hold');
  assert.equal(claim.statusLabel, CLAIM_STATUS_LABELS.unknown);
  assert.match(claim.note, /nog niet kent/i);
  assert.equal(claim.retryHref, null);
  assert.equal(statusLabel('iets-anders'), 'Onbekende status');
});

test('overview: a restaurant outside the static data gets no link at all', () => {
  const overview = buildOwnerOverview({
    roles: [{ role: 'owner', restaurant_id: '999' }],
    claims: [{ id: 9, restaurant_id: '999', status: 'rejected' }],
    restaurants: RESTAURANTS,
  });
  assert.equal(overview.restaurants[0].known, false);
  assert.equal(overview.restaurants[0].name, null);
  assert.equal(overview.restaurants[0].restaurantHref, null);
  assert.equal(overview.restaurants[0].menuHref, null);
  assert.equal(overview.claims[0].restaurantHref, null);
  // Re-claiming does not need the restaurant to be in our data: the id is enough.
  assert.equal(overview.claims[0].retryHref, '/claim/999');
});

test('overview: no claim and no owner row is the honest empty state, never invented data', () => {
  const overview = buildOwnerOverview({ roles: [], claims: [], restaurants: RESTAURANTS });
  assert.deepEqual(overview.restaurants, []);
  assert.deepEqual(overview.claims, []);
  assert.equal(overview.empty, true);
  assert.equal(overview.hasOwnerAccess, false);
  assert.equal(overview.heading, 'Mijn restaurant');
  // Junk in, empty out.
  const junk = buildOwnerOverview({ roles: 'owner', claims: 'claim', restaurants: null });
  assert.equal(junk.empty, true);
  assert.deepEqual(junk.restaurants, []);
});

test('overview: owner rows and approved claims for the same restaurant show one card', () => {
  const overview = buildOwnerOverview({
    roles: [
      { role: 'owner', restaurant_id: '1' },
      { role: 'internal', restaurant_id: null },
    ],
    claims: [{ id: 13, restaurant_id: '1', status: 'approved' }],
    restaurants: RESTAURANTS,
  });
  assert.equal(overview.restaurants.length, 1);
  assert.deepEqual(ownedRestaurantIds([{ role: 'owner', restaurant_id: '1' }]), ['1']);
  assert.deepEqual(approvedClaimRestaurantIds([{ status: 'approved', restaurant_id: '1' }]), ['1']);
});

test('overview: the static index carries the real names and published menu ids', () => {
  const index = buildOwnerRestaurantIndex(restaurantsData, menusData);
  assert.equal(Object.keys(index).length, 25);
  assert.equal(index['1'].name, 'Restaurant Wolfslaar');
  assert.deepEqual(index['1'].menuIds, ['1-lunch', '1-diner']);
  // A restaurant without published menu links has an empty list: the page then
  // says honestly that there is no menu online yet.
  assert.deepEqual(index['2'].menuIds, []);
  // Junk in, nothing out.
  assert.deepEqual(buildOwnerRestaurantIndex(null, null), {});
});
