'use strict';

// BE-65 (#157, uitkomst 4) — het venster "Stuur je lijstje", de beslissingen.
//
// Echte vergelijkingen, geen broncodes: de twee keuzes, de standaardkeuze, de
// rij van drie deelmanieren, de grens van 12 gerechten en het maken van de
// stemlink tegen een gestubde API. De teksten worden met de bron van
// KiesStartButton vergeleken, zodat "de bestaande melding" ook echt de bestaande
// melding blijft.
//
// Dit is ontwikkelaarsbewijs; het echte beeld komt uit de browsercheck.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const send = require('./savedListSend');
const { KIES_ENDPOINT, KIES_STARTED_MESSAGE, KIES_NOT_AVAILABLE_MESSAGE } = require('./kiesStemming');

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const KIES_BUTTON = read('src/components/KiesStartButton.js');

// Een geldige stemcode volgens de bestaande kiesStemming-patroon (22 tekens).
const CODE = 'abcdefghijklmnopqrstuv';
const KEYS = ['6-diner-0-0', '6-diner-0-1'];

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test('de standaardkeuze is "Gewoon delen"', () => {
  assert.equal(send.SEND_TITLE, 'Stuur je lijstje');
  assert.equal(send.SEND_CLOSE_LABEL, 'Sluiten');
  assert.equal(send.SEND_MODE_QUESTION, 'Hoe wil je het sturen?');
  assert.equal(send.SEND_PLAIN_MODE, 'plain');
  assert.equal(send.SEND_VOTE_MODE, 'vote');
  assert.equal(send.normalizeSendMode(undefined), send.SEND_PLAIN_MODE);
  assert.equal(send.normalizeSendMode(null), send.SEND_PLAIN_MODE);
  assert.equal(send.normalizeSendMode('iets anders'), send.SEND_PLAIN_MODE);
  assert.equal(send.normalizeSendMode('vote'), send.SEND_VOTE_MODE);
  // De twee regels uitleg uit het contract.
  assert.equal(send.sendModeHint(send.SEND_PLAIN_MODE), 'Je vrienden zien je lijstje met prijzen en restaurants.');
  assert.equal(
    send.sendModeHint(send.SEND_VOTE_MODE),
    "Iedereen kiest 'lekker' of 'liever niet'. Jij ziet de winnaar. Zonder account."
  );
  assert.equal(send.SEND_PLAIN_LABEL, 'Gewoon delen');
  assert.equal(send.SEND_VOTE_LABEL, 'Laat stemmen');
});

test('de bestaande meldingen zijn letterlijk die van KiesStartButton', () => {
  assert.match(KIES_BUTTON, new RegExp(`Samen kiezen kan met hooguit \\$\\{KIES_MAX_DISHES\\} gerechten\\.`));
  assert.match(KIES_BUTTON, /const START_FAILED_MESSAGE = 'De stemlink is niet gemaakt\. Probeer het opnieuw\.'/);
  assert.equal(send.SEND_TOO_MANY_MESSAGE, 'Samen kiezen kan met hooguit 12 gerechten.');
  assert.equal(send.SEND_TOO_MANY_MESSAGE, `Samen kiezen kan met hooguit ${send.KIES_MAX_DISHES} gerechten.`);
  assert.equal(send.SEND_FAILED_MESSAGE, 'De stemlink is niet gemaakt. Probeer het opnieuw.');
});

test('de grens van 12 gerechten', () => {
  assert.equal(send.KIES_MAX_DISHES, 12);
  assert.equal(send.tooManyForVote(0), false);
  assert.equal(send.tooManyForVote(1), false);
  assert.equal(send.tooManyForVote(12), false);
  assert.equal(send.tooManyForVote(13), true);
  assert.equal(send.canSendVote(12), true);
  assert.equal(send.canSendVote(13), false);
  assert.equal(send.canSendVote(0), false);
});

test('de rij houdt drie knoppen: de favorieten uit "Delen via" en "Meer…"', () => {
  const zonder = send.sendMethods(null);
  assert.deepEqual(zonder, ['whatsapp', 'copy', 'phone']);
  assert.equal(zonder.length, send.SEND_METHOD_COUNT);
  assert.equal(send.sendMethodLabel(zonder[0]), 'WhatsApp');
  assert.equal(send.sendMethodLabel(zonder[2]), 'Meer…');
  // Eén favoriet: die ene, aangevuld tot twee met de gewone manieren.
  assert.deepEqual(send.sendMethods({ methods: ['telegram'] }), ['telegram', 'whatsapp', 'phone']);
  // Drie favorieten: de eerste twee plus "Meer…", dus nog steeds drie.
  const drie = send.sendMethods({ methods: ['telegram', 'email', 'sms'] });
  assert.deepEqual(drie, ['telegram', 'email', 'phone']);
  assert.equal(drie.length, 3);
  // Alleen het telefoonmenu bewaard: de gewone twee plus "Meer…".
  assert.deepEqual(send.sendMethods({ phone: true }), ['whatsapp', 'copy', 'phone']);
});


test('de stemlink wordt eerst gemaakt en dan pas gedeeld: de bestaande API', async () => {
  const calls = [];
  const fetchRef = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({ code: CODE, sluitOm: null });
  };
  const result = await send.createVoteLink({ dishKeys: KEYS, fetchRef });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, KIES_ENDPOINT);
  assert.equal(calls[0].url, '/api/v1/kies');
  assert.equal(calls[0].options.method, 'POST');
  // Alleen de id's en géén sluitingstijd; anoniem en zonder cache.
  assert.deepEqual(JSON.parse(calls[0].options.body), { dish_keys: KEYS, sluit_om: null });
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.referrerPolicy, 'no-referrer');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(result.ok, true);
  assert.equal(result.href, `/kies/${CODE}`);
  assert.equal(result.message, KIES_STARTED_MESSAGE);
  // Met de stand van dit moment komt de stand in de link (zoals bij een gedeelde
  // deeplink), niet in het adres dat de maker zelf opent.
  const donker = await send.createVoteLink({ dishKeys: KEYS, fetchRef, theme: 'donker' });
  assert.equal(donker.href, `/kies/${CODE}?stand=donker`);
});

test('boven de grens van 12 wordt er niets gemaakt en niets gedeeld', async () => {
  let called = 0;
  const fetchRef = async () => {
    called += 1;
    return jsonResponse({ code: CODE });
  };
  const keys = Array.from({ length: 13 }, (_, index) => `6-diner-0-${index}`);
  const result = await send.createVoteLink({ dishKeys: keys, fetchRef });
  assert.equal(called, 0, 'de API mag niet eens gebeld worden');
  assert.equal(result.ok, false);
  assert.equal(result.href, null);
  assert.equal(result.reason, 'too_many');
  assert.equal(result.message, 'Samen kiezen kan met hooguit 12 gerechten.');
  // Precies 12 mag wel.
  const twaalf = await send.createVoteLink({ dishKeys: keys.slice(0, 12), fetchRef });
  assert.equal(called, 1);
  assert.equal(twaalf.ok, true);
});

test('een fout bij het maken geeft de bestaande melding en geen link', async () => {
  const cases = [
    [jsonResponse({ message: 'Samen kiezen is nog niet beschikbaar' }, 503), 'Samen kiezen is nog niet beschikbaar'],
    [jsonResponse({}, 503), KIES_NOT_AVAILABLE_MESSAGE],
    [jsonResponse({}, 500), send.SEND_FAILED_MESSAGE],
    [jsonResponse({ code: 'te-kort' }), send.SEND_FAILED_MESSAGE],
  ];
  for (const [response, message] of cases) {
    const result = await send.createVoteLink({ dishKeys: KEYS, fetchRef: async () => response });
    assert.equal(result.ok, false);
    assert.equal(result.href, null);
    assert.equal(result.message, message);
  }
  const netwerk = await send.createVoteLink({
    dishKeys: KEYS,
    fetchRef: async () => { throw new Error('offline'); },
  });
  assert.equal(netwerk.ok, false);
  assert.equal(netwerk.message, send.SEND_FAILED_MESSAGE);
  // Een leeg lijstje maakt ook niets.
  const leeg = await send.createVoteLink({ dishKeys: [], fetchRef: async () => jsonResponse({ code: CODE }) });
  assert.equal(leeg.ok, false);
  assert.equal(leeg.message, send.SEND_FAILED_MESSAGE);
});

test('de titel van de stemlink is die van de bestaande flow', () => {
  assert.equal(send.voteTitle(1), 'Kies mee: 1 gerecht');
  assert.equal(send.voteTitle(3), 'Kies mee: 3 gerechten');
  assert.match(KIES_BUTTON, /const title = `Kies mee: \$\{dishes\.length\} \$\{dishes\.length === 1 \? 'gerecht' : 'gerechten'\}`/);
});
