'use strict';

// BE-35 (#84, criterion 4) — unit tests for the one automatic restaurant
// choice: one match or an exact name is chosen, several matches ask, and the
// chosen line carries name and neighbourhood. Fictional restaurants only; no
// network, no React, no database.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  MIN_RESTAURANT_QUERY,
  decideRestaurantPick,
  foldRestaurantName,
  restaurantChoiceLabel,
  restaurantChoiceQuestion,
} = require('./restaurantPick');

const AL_DENTE = { id: '8', name: 'Al Dente Ristorante', buurt: 'Binnenstad' };
const BARDOT = { id: '6', name: 'Brasserie Bardot', buurt: 'Binnenstad' };
const WOLFSLAAR = { id: '1', name: 'Restaurant Wolfslaar', buurt: 'Wolfslaar' };

test('BE-35: the typed name is folded the same way as the server search', () => {
  assert.equal(foldRestaurantName('  Al  Dente Ristorante '), 'al dente ristorante');
  assert.equal(foldRestaurantName('Café Crème'), 'cafe creme');
  assert.equal(foldRestaurantName("Blonde d'Aquitaine"), 'blonde d aquitaine');
  assert.equal(foldRestaurantName(null), '');
  assert.equal(MIN_RESTAURANT_QUERY, 2);
});

test('BE-35: exactly one match is chosen automatically and shown with its neighbourhood', () => {
  const pick = decideRestaurantPick({ query: 'Al Dente', choices: [AL_DENTE] });
  assert.equal(pick.status, 'chosen');
  assert.deepEqual(pick.choice, AL_DENTE);
  assert.equal(pick.label, '✓ Al Dente Ristorante · Binnenstad');
  assert.equal(pick.message, '✓ Al Dente Ristorante · Binnenstad');
  assert.equal(pick.count, 1);
  // A partial query with one match is enough: the server already filtered it.
  assert.equal(decideRestaurantPick({ query: 'wolf', choices: [WOLFSLAAR] }).choice.id, '1');
  // A restaurant without a neighbourhood still gets a clean label.
  assert.equal(restaurantChoiceLabel({ id: '9', name: 'Zonder Buurt', buurt: '' }), '✓ Zonder Buurt');
  assert.equal(restaurantChoiceLabel({ id: '9', name: '  ' }), '');
  assert.equal(restaurantChoiceLabel(null), '');
});

test('BE-35: several matches are only chosen for the exact name, otherwise the page asks', () => {
  const many = [BARDOT, AL_DENTE, WOLFSLAAR];
  // "Bardot" is an exact name among several matches → that one is chosen.
  const exact = decideRestaurantPick({ query: 'brasserie bardot', choices: many });
  assert.equal(exact.status, 'chosen');
  assert.equal(exact.choice.id, BARDOT.id);
  assert.equal(exact.count, 3);

  // Diacritics and punctuation do not change an exact match.
  const folded = decideRestaurantPick({ query: 'AL-DENTE   ristorante', choices: many });
  assert.equal(folded.status, 'chosen');
  assert.equal(folded.choice.id, AL_DENTE.id);

  // "Restaurant" matches several names and is not an exact name → ask.
  const ask = decideRestaurantPick({ query: 'restaurant', choices: many });
  assert.equal(ask.status, 'multiple');
  assert.equal(ask.choice, null);
  assert.equal(ask.label, null);
  assert.equal(ask.message, 'Kies één van de 3 restaurants hieronder.');
  assert.equal(ask.count, 3);
  assert.equal(restaurantChoiceQuestion(1), 'Kies één van de 1 restaurant hieronder.');
});

test('BE-35: nothing is chosen for a short or empty query, or without a match', () => {
  assert.equal(decideRestaurantPick({ query: '', choices: [AL_DENTE] }).status, 'idle');
  assert.equal(decideRestaurantPick({ query: 'A', choices: [AL_DENTE] }).status, 'idle');
  assert.equal(decideRestaurantPick({ query: '  ', choices: [AL_DENTE] }).status, 'idle');
  const none = decideRestaurantPick({ query: 'Pizzeria Onbekend', choices: [] });
  assert.equal(none.status, 'none');
  assert.equal(none.choice, null);
  assert.equal(none.message, null);
  // A broken or duplicated choice is ignored, so it can never be "the one".
  const cleaned = decideRestaurantPick({ query: 'al dente', choices: [{ id: '', name: 'X' }, { id: '8' }, AL_DENTE, AL_DENTE] });
  assert.equal(cleaned.status, 'chosen');
  assert.equal(cleaned.choice.id, '8');
  assert.equal(cleaned.count, 1);
  // No choices at all is not an automatic choice either.
  assert.equal(decideRestaurantPick().status, 'idle');
  assert.equal(decideRestaurantPick({ query: 'al dente' }).status, 'none');
});
