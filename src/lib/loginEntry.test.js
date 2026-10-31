'use strict';

// BE-59 (#146, punt 4) / BE-63 (#155, ronde 4) — de tekst van /inloggen als één
// geteste bron: het accentlabel, de titel, de intro, het formulier, het
// claimblok met drie stappen, de bezoekerszin en de teamlink. Geen
// rolherkenning aan het e-mailadres en geen tweede, losse paden.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { CLAIM_LINK, LOGIN_PAGE, LOGIN_PAGE_HREF } = require('./loginEntry');
const { CLAIM_SEARCH_HREF, INTERNAL_LOGIN_HREF } = require('./ownerAccess');

test('/inloggen heeft het accentlabel, de titel en de intro uit het ontwerp', () => {
  assert.equal(LOGIN_PAGE.eyebrow, 'Voor restaurants');
  assert.equal(LOGIN_PAGE.title, 'Inloggen bij je restaurant');
  assert.match(LOGIN_PAGE.intro, /^Werk je menukaart, prijzen en daghap bij\./);
  assert.match(LOGIN_PAGE.intro, /inlogcode per e-mail, een wachtwoord is niet nodig\./);
  assert.equal(LOGIN_PAGE_HREF, '/inloggen');
});

test('het formulier gebruikt de bestaande houder-inlog en de knop uit het ontwerp', () => {
  assert.equal(LOGIN_PAGE.submitLabel, 'Stuur mij een inlogcode');
  assert.equal(LOGIN_PAGE.emailHelp, 'Gebruik het adres waarmee je je restaurant hebt geclaimd.');
});

test('het claimblok heeft drie genummerde stappen en gaat naar het claimscherm', () => {
  assert.equal(LOGIN_PAGE.claim.title, 'Nog geen account?');
  assert.match(LOGIN_PAGE.claim.body, /Claim het gratis en beheer je eigen kaart\./);
  assert.deepEqual(LOGIN_PAGE.claim.steps, [
    'Zoek je restaurant',
    'Bevestig dat het van jou is',
    'Log in met je e-mailcode',
  ]);
  assert.equal(LOGIN_PAGE.claim.actionLabel, 'Claim je restaurant');
  assert.equal(LOGIN_PAGE.claim.actionHref, CLAIM_SEARCH_HREF);
  assert.equal(LOGIN_PAGE.claim.actionHref, '/mijn-restaurant/claimen');
  assert.equal(CLAIM_LINK.href, CLAIM_SEARCH_HREF, 'de claimlink blijft één bron');
});

test('de bezoekerszin en de kleine teamlink staan er, zonder rolherkenning', () => {
  assert.equal(LOGIN_PAGE.visitor, 'Bezoeker? Je hebt geen account nodig om te zoeken, te bewaren of samen te kiezen.');
  assert.equal(LOGIN_PAGE.teamLabel, 'Werk je bij onze menukaarten? Team-inlog');
  assert.equal(LOGIN_PAGE.teamHref, INTERNAL_LOGIN_HREF);
  assert.equal(LOGIN_PAGE.teamHref, '/internal/login');
  const all = JSON.stringify(LOGIN_PAGE);
  assert.doesNotMatch(all, /@[a-z]|\bemail\b.*role|detect/i, 'geen herkenning aan het adres');
});

test('de teksten zijn bevroren, zodat een pagina ze niet stilzwijgend overschrijft', () => {
  assert.ok(Object.isFrozen(LOGIN_PAGE));
  assert.ok(Object.isFrozen(LOGIN_PAGE.claim));
  assert.ok(Object.isFrozen(LOGIN_PAGE.claim.steps));
});
