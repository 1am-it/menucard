'use strict';

// BE-59 (#146, punt 4) — /inloggen: twee keuzes, elk naar de bestaande
// inlogpagina, en een claimlink. Geen rolherkenning aan het e-mailadres.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { CLAIM_LINK, LOGIN_CHOICES, LOGIN_INTRO } = require('./loginEntry');
const { CLAIM_SEARCH_HREF, INTERNAL_LOGIN_HREF, OWNER_LOGIN_HREF } = require('./ownerAccess');

test('/inloggen heeft precies twee keuzes, in deze volgorde', () => {
  assert.deepEqual(
    LOGIN_CHOICES.map((choice) => [choice.id, choice.label]),
    [
      ['owner', 'Ik heb een restaurant'],
      ['team', 'Ik werk bij onze menukaarten'],
    ],
  );
});

test('de keuzes gaan naar de bestaande inlogpagina\'s, niet naar een nieuwe route', () => {
  assert.equal(OWNER_LOGIN_HREF, '/mijn-restaurant/inloggen');
  assert.equal(INTERNAL_LOGIN_HREF, '/internal/login');
  assert.equal(LOGIN_CHOICES[0].href, OWNER_LOGIN_HREF);
  assert.equal(LOGIN_CHOICES[1].href, INTERNAL_LOGIN_HREF);
});

test('de claimlink gaat naar het bestaande claimscherm', () => {
  assert.equal(CLAIM_LINK.href, CLAIM_SEARCH_HREF);
  assert.equal(CLAIM_LINK.href, '/mijn-restaurant/claimen');
  assert.equal(CLAIM_LINK.label, 'Nog geen account? Claim je restaurant');
});

test('de uitleg noemt de keuze, en er is nergens een e-mail- of rolherkenning', () => {
  assert.match(LOGIN_INTRO, /Kies hieronder hoe je inlogt/);
  assert.match(LOGIN_INTRO, /e-mailadres/);
  for (const choice of LOGIN_CHOICES) {
    assert.ok(choice.detail.length > 0, `${choice.id} heeft een korte uitleg`);
    assert.ok(choice.hint.length > 0, `${choice.id} noemt de inlogmethode`);
  }
  const all = JSON.stringify({ LOGIN_CHOICES, CLAIM_LINK });
  assert.doesNotMatch(all, /@[a-z]|\bemail\b.*role|detect/i, 'geen herkenning aan het adres');
});
