'use strict';

// BE-46 (#106, criterium 1, 2, 5, 6 en 8) — de rekenregels van "samen kiezen"
// tegen de echte projectdata. Geen React, geen Supabase, geen netwerk.
//
// De load-bearing punten uit het contract:
// - de code en het browserkenmerk zijn willekeurig (128 bit, url-veilig) en
//   nooit afgeleid van een gerecht, een persoon of een teller;
// - hooguit 12 gerechten, 50 stemmers en een roepnaam van 24 tekens;
// - de gerechten komen uit de echte menukaarten, met de bestaande
//   reserveerroutering (BE-07) en dezelfde routelink als de menukaart;
// - de uitslag sorteert op de meeste "lekker", bij gelijkspel op de minste
//   "liever niet", daarna op de volgorde van de stemming;
// - de drempel van het swipen is 30% van de kaartbreedte, met een label;
// - de eigen voortgang staat in `localStorage`, altijd in try/catch;
// - een ontbrekende tabel is één nette melding, geen crash.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const menusData = require('../../data/menus.json');
const restaurantsData = require('../../data/restaurants.json');
const {
  KIES_CLOSED_MESSAGE,
  KIES_FULL_MESSAGE,
  KIES_MAX_DISHES,
  KIES_MAX_STEMMERS,
  KIES_NOT_AVAILABLE_MESSAGE,
  KIES_PROGRESS_KEY,
  KIES_UNDO_LABEL,
  SWIPE_THRESHOLD,
  generateKiesCode,
  generateStemmerId,
  isKiesCode,
  isMissingKiesStorage,
  isStemmingClosed,
  kiesHref,
  kiesImageHref,
  kiesImageTitle,
  kiesLekkerShare,
  kiesMetadata,
  kiesProgressLabel,
  lastVoteOf,
  nextDishIndex,
  normalizeDishKeys,
  normalizeKiesCode,
  normalizeLekker,
  normalizeRoepnaam,
  normalizeStemmer,
  normalizeStemming,
  normalizeVotes,
  parseSluitOm,
  readKiesProgress,
  resolveKiesDishes,
  sluitOmFromTime,
  stemmerCount,
  stemmingResult,
  swipeFeedback,
  swipeOutcome,
  voteOf,
  writeKiesProgress,
} = require('./kiesStemming');

// De echte fixture: "Poussin" (€20,95) uit de dinerkaart van restaurant 6,
// precies de kaart die de BE-44-browsercheck ook gebruikt.
const MENU_ID = '6-diner';
const DISH_ID = '6-diner-0-0';
const DISH_NAME = 'Poussin';
const RESTAURANT_NAME = 'Brasserie Bardot';
const ADDRESS = 'Van Coothplein 12, 4811 NE Breda';
const SECOND_DISH_ID = '6-diner-0-1';
const UNKNOWN_DISH_ID = '99-diner-0-0';

const CODE = 'A'.repeat(22);
const STEMMER = 'b'.repeat(22);

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    dump: () => Object.fromEntries(map),
  };
}

function vote(stemmer, roepnaam, dishKey, lekker, gestemdOp = '2026-10-30T10:00:00.000Z') {
  return { stemmer, roepnaam, dishKey, lekker, gestemdOp };
}

// ─── De code en het anonieme kenmerk ────────────────────────────────────────

test('de stemcode is 128 bit url-veilig en nooit twee keer hetzelfde', () => {
  const codes = new Set();
  for (let i = 0; i < 200; i += 1) {
    const code = generateKiesCode();
    assert.match(code, /^[A-Za-z0-9_-]{22}$/, code);
    assert.ok(isKiesCode(code), code);
    codes.add(code);
  }
  assert.equal(codes.size, 200, 'geen dubbele codes');
  // Dezelfde ondergrens als de check in supabase/migrations/0022.
  assert.equal(generateKiesCode({ random: () => Buffer.alloc(16, 7) }).length, 22);
});

test('een kapotte of te korte bron levert geen code of kenmerk op', () => {
  assert.equal(generateKiesCode({ random: () => Buffer.alloc(0) }), null);
  assert.equal(generateKiesCode({ random: () => { throw new Error('geen entropie'); } }), null);
  assert.equal(generateStemmerId({ random: () => Buffer.from('kort') }), null);
  assert.match(generateStemmerId(), /^[A-Za-z0-9_-]{22}$/);
});

test('alleen de echte vorm van een code en een kenmerk is geldig', () => {
  assert.equal(normalizeKiesCode(` ${CODE} `), CODE);
  assert.equal(normalizeKiesCode('kort'), null);
  assert.equal(normalizeKiesCode('A'.repeat(23) + '!'), null);
  assert.equal(normalizeKiesCode(null), null);
  assert.equal(normalizeStemmer(STEMMER), STEMMER);
  assert.equal(normalizeStemmer('b'.repeat(10)), null);
  assert.equal(normalizeStemmer('niet-urL-veilig!'), null);
});

test('een roepnaam is platte tekst van hooguit 24 tekens, nooit stil afgekapt', () => {
  assert.equal(normalizeRoepnaam('  San   de Vries '), 'San de Vries');
  assert.equal(normalizeRoepnaam('A'.repeat(24)), 'A'.repeat(24));
  assert.equal(normalizeRoepnaam('A'.repeat(25)), null);
  assert.equal(normalizeRoepnaam('   '), null);
  assert.equal(normalizeRoepnaam(undefined), null);
});

test('alleen een echte boolean telt als stem', () => {
  assert.equal(normalizeLekker(true), true);
  assert.equal(normalizeLekker(false), false);
  for (const value of ['ja', 1, 0, null, undefined, 'true']) {
    assert.equal(normalizeLekker(value), null, String(value));
  }
});

// ─── De gerechten ───────────────────────────────────────────────────────────

test('de gerechten van een stemming komen uit de echte statische data', () => {
  const { dishes, skipped } = resolveKiesDishes({
    dishKeys: [DISH_ID, SECOND_DISH_ID],
    menus: menusData,
    restaurants: restaurantsData,
  });
  assert.equal(skipped, 0);
  assert.equal(dishes.length, 2);
  const [dish] = dishes;
  assert.equal(dish.id, DISH_ID);
  assert.equal(dish.name, DISH_NAME);
  assert.equal(dish.price, '€20,95');
  assert.equal(dish.restaurant, RESTAURANT_NAME);
  assert.ok(dish.description.length > 0, 'de beschrijving komt uit de data');
  assert.ok(dish.category.length > 0);
  // Dezelfde routelink als de menukaart (app/menu/[id]/MenuView.js).
  assert.equal(
    dish.route,
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${ADDRESS}, Breda`)}`,
  );
});

test('een onbekend gerecht wordt overgeslagen en geteld', () => {
  const { dishes, skipped } = resolveKiesDishes({
    dishKeys: [DISH_ID, UNKNOWN_DISH_ID, 'geen-id'],
    menus: menusData,
    restaurants: restaurantsData,
  });
  assert.deepEqual(dishes.map((dish) => dish.id), [DISH_ID]);
  assert.equal(skipped, 2);
});

test('de reserveerroute komt van buiten (BE-07) en valt stil weg', () => {
  const withReserve = resolveKiesDishes({
    dishKeys: [DISH_ID],
    menus: menusData,
    restaurants: restaurantsData,
    reservationFor: () => ({ method: 'phone', label: 'Bel restaurant', href: 'tel:0761234567' }),
  }).dishes[0];
  assert.equal(withReserve.reserve.href, 'tel:0761234567');

  const broken = resolveKiesDishes({
    dishKeys: [DISH_ID],
    menus: menusData,
    restaurants: restaurantsData,
    reservationFor: () => { throw new Error('geen routering'); },
  }).dishes[0];
  assert.equal(broken.reserve, null, 'zonder route blijft het gerecht staan');
  assert.equal(broken.name, DISH_NAME);
});

test('hooguit 12 gerechten, zonder dubbelen, in de volgorde van de maker', () => {
  const list = [];
  for (let menu = 6; menu < 12; menu += 1) {
    for (let cat = 0; cat < 2; cat += 1) {
      for (let item = 0; item < 2; item += 1) list.push(`${menu}-diner-${cat}-${item}`);
    }
  }
  const { dishKeys, skipped } = normalizeDishKeys([list[0], list[1], list[0], ...list.slice(2)]);
  assert.equal(dishKeys.length, KIES_MAX_DISHES);
  assert.equal(new Set(dishKeys).size, KIES_MAX_DISHES);
  assert.equal(dishKeys[0], list[0]);
  assert.ok(skipped >= 1, 'de dubbelen en het overschot worden geteld');
  assert.deepEqual(normalizeDishKeys([]).dishKeys, []);
  assert.deepEqual(normalizeDishKeys(null).dishKeys, []);
});

// ─── De stemmen en de uitslag ──────────────────────────────────────────────

test('stemmen van de database: alleen de nodige velden, kapotte rijen vallen af', () => {
  const votes = normalizeVotes([
    { stemmer: STEMMER, roepnaam: 'Sam', dish_key: DISH_ID, lekker: true, gestemd_op: '2026-10-30T10:00:00Z' },
    { stemmer: 'te-kort', roepnaam: 'X', dish_key: DISH_ID, lekker: true },
    { stemmer: STEMMER, roepnaam: '', dish_key: DISH_ID, lekker: true },
    { stemmer: STEMMER, roepnaam: 'Sam', dish_key: '', lekker: true },
    { stemmer: STEMMER, roepnaam: 'Sam', dish_key: DISH_ID, lekker: 'ja' },
    null,
  ]);
  assert.equal(votes.length, 1);
  assert.deepEqual(votes[0], {
    stemmer: STEMMER,
    roepnaam: 'Sam',
    dishKey: DISH_ID,
    lekker: true,
    gestemdOp: '2026-10-30T10:00:00Z',
  });
});

test('de uitslag sorteert op de meeste lekker, dan de minste liever niet, dan de volgorde', () => {
  const dishes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const votes = [
    vote(STEMMER, 'Sam', 'a', true),
    vote('c'.repeat(22), 'Noa', 'a', false),
    vote(STEMMER, 'Sam', 'b', true),
    vote('c'.repeat(22), 'Noa', 'b', true),
    vote(STEMMER, 'Sam', 'c', true),
    vote('c'.repeat(22), 'Noa', 'c', false),
    vote('d'.repeat(22), 'Pip', 'c', false),
    vote(STEMMER, 'Sam', 'd', false),
  ];
  const result = stemmingResult({ dishes, votes });
  // b: 2 lekker, 0 liever niet. a en c: 1 lekker; a heeft 1 liever niet, c heeft
  // 2, dus a staat vóór c. d: 0 lekker.
  assert.deepEqual(result.uitslag.map((row) => row.id), ['b', 'a', 'c', 'd']);
  assert.deepEqual(result.uitslag[0].kiezers, ['Sam', 'Noa']);
  assert.deepEqual(result.uitslag[0].lieverNietKiezers, []);
  assert.equal(result.uitslag[1].lekker, 1);
  assert.equal(result.uitslag[1].lieverNiet, 1);
  assert.equal(result.stemmers, 3);
  assert.equal(result.stemmen, 8);
});

test('een gelijke stand houdt de volgorde van de stemming, ook bij twee keer lezen', () => {
  const dishes = [{ id: 'x' }, { id: 'y' }];
  const votes = [vote(STEMMER, 'Sam', 'x', true), vote('c'.repeat(22), 'Noa', 'y', true)];
  const first = stemmingResult({ dishes, votes });
  const second = stemmingResult({ dishes, votes: votes.slice().reverse() });
  assert.deepEqual(first.uitslag.map((row) => row.id), ['x', 'y']);
  assert.deepEqual(second.uitslag.map((row) => row.id), ['x', 'y']);
});

test('de balk in de uitslag toont het aandeel "lekker" per gerecht', () => {
  // Het aandeel, niet het absolute aantal: een gerecht met twee stemmen is niet
  // automatisch kleiner dan een gerecht met tien stemmen (mockup, scherm 6).
  assert.equal(kiesLekkerShare({ lekker: 3, lieverNiet: 1 }), 75);
  assert.equal(kiesLekkerShare({ lekker: 2, lieverNiet: 2 }), 50);
  assert.equal(kiesLekkerShare({ lekker: 0, lieverNiet: 4 }), 0);
  assert.equal(kiesLekkerShare({ lekker: 4, lieverNiet: 0 }), 100);
  // Zonder stemmen: geen balk, en nooit een verkeerde deling.
  assert.equal(kiesLekkerShare({ lekker: 0, lieverNiet: 0 }), 0);
  assert.equal(kiesLekkerShare(null), 0);
  assert.equal(kiesLekkerShare({}), 0);
  // Onzin telt niet mee als stem.
  assert.equal(kiesLekkerShare({ lekker: -2, lieverNiet: 1 }), 0);
  // Afronden op hele procenten, zodat de balk altijd tussen 0 en 100 past.
  assert.equal(kiesLekkerShare({ lekker: 1, lieverNiet: 2 }), 33);
  assert.equal(kiesLekkerShare({ lekker: 2, lieverNiet: 1 }), 67);
  // En de uitslag levert precies de velden die de balk nodig heeft.
  const result = stemmingResult({
    dishes: [{ id: 'a' }],
    votes: [vote(STEMMER, 'Sam', 'a', true), vote('c'.repeat(22), 'Noa', 'a', false)],
  });
  assert.equal(kiesLekkerShare(result.uitslag[0]), 50);
});

test('de roepnamen staan zichtbaar bij de stemmen, het maximum is 50 stemmers', () => {
  const dishes = [{ id: 'a' }];
  const votes = [vote(STEMMER, 'Sam', 'a', true), vote('c'.repeat(22), 'Noa', 'a', false)];
  const result = stemmingResult({ dishes, votes });
  assert.deepEqual(result.uitslag[0].kiezers, ['Sam']);
  assert.deepEqual(result.uitslag[0].lieverNietKiezers, ['Noa']);
  assert.equal(result.stemmers, 2);
  assert.equal(KIES_MAX_STEMMERS, 50);
});

test('de laatste stem van een stemmer is te vinden voor "ongedaan maken"', () => {
  const votes = [
    vote(STEMMER, 'Sam', 'a', true, '2026-10-30T10:00:00.000Z'),
    vote(STEMMER, 'Sam', 'b', false, '2026-10-30T10:05:00.000Z'),
    vote('c'.repeat(22), 'Noa', 'a', true, '2026-10-30T10:09:00.000Z'),
  ];
  assert.equal(lastVoteOf(votes, STEMMER).dishKey, 'b');
  assert.equal(lastVoteOf(votes, 'd'.repeat(22)), null);
  assert.equal(voteOf(votes, STEMMER, 'a').lekker, true);
  assert.equal(voteOf(votes, STEMMER, 'z'), null);
  assert.equal(stemmerCount(votes), 2);
});


// ─── De sluitingstijd ──────────────────────────────────────────────────────

test('geen sluitingstijd is geldig, een onzin-tijd is een fout', () => {
  assert.deepEqual(parseSluitOm(null), { ok: true, value: null });
  assert.deepEqual(parseSluitOm(''), { ok: true, value: null });
  assert.deepEqual(parseSluitOm('2026-10-30T18:00:00+01:00'), { ok: true, value: '2026-10-30T17:00:00.000Z' });
  assert.equal(parseSluitOm('morgen').ok, false);
  assert.equal(parseSluitOm('18:00').ok, false);
});

test('"tot 18:00" is vandaag, of morgen als die tijd al voorbij is', () => {
  const morning = Date.parse('2026-10-30T09:00:00+01:00');
  const evening = Date.parse('2026-10-30T20:00:00+01:00');
  assert.equal(sluitOmFromTime('18:00', () => morning), new Date(2026, 9, 30, 18, 0, 0, 0).toISOString());
  const later = new Date(sluitOmFromTime('18:00', () => evening));
  assert.equal(later.getDate(), 31, 'morgen, niet een tijd in het verleden');
  assert.equal(later.getHours(), 18);
  assert.equal(sluitOmFromTime('25:00'), null);
  assert.equal(sluitOmFromTime('avond'), null);
  assert.equal(sluitOmFromTime(''), null);
});

test('een stemming is gesloten vanaf de gekozen tijd en niet eerder', () => {
  const stemming = { sluitOm: '2026-10-30T17:00:00.000Z' };
  assert.equal(isStemmingClosed(stemming, Date.parse('2026-10-30T16:59:59Z')), false);
  assert.equal(isStemmingClosed(stemming, Date.parse('2026-10-30T17:00:00Z')), true);
  assert.equal(isStemmingClosed({ sluitOm: null }, Date.parse('2030-01-01T00:00:00Z')), false);
  assert.equal(isStemmingClosed(null), false);
});

test('een rij uit de database wordt een stemming met geldige sleutels', () => {
  const stemming = normalizeStemming({
    code: CODE,
    dish_keys: [DISH_ID, DISH_ID, UNKNOWN_DISH_ID],
    sluit_om: '2026-10-30T17:00:00+00:00',
    created_at: '2026-10-30T09:00:00+00:00',
  });
  assert.equal(stemming.code, CODE);
  assert.deepEqual(stemming.dishKeys, [DISH_ID, UNKNOWN_DISH_ID]);
  assert.equal(stemming.sluitOm, '2026-10-30T17:00:00.000Z');
  assert.equal(stemming.createdAt, '2026-10-30T09:00:00+00:00');
  assert.equal(normalizeStemming(null), null);
  assert.equal(normalizeStemming({ code: 'kort', dish_keys: [DISH_ID] }), null);
  assert.equal(normalizeStemming({ code: CODE, dish_keys: [] }), null);
});

// ─── Swipen ────────────────────────────────────────────────────────────────

test('de drempel van het swipen is 30% van de kaartbreedte, beide kanten op', () => {
  assert.equal(SWIPE_THRESHOLD, 0.3);
  assert.equal(swipeOutcome({ dx: 120, width: 400 }), 'lekker');
  assert.equal(swipeOutcome({ dx: -120, width: 400 }), 'liever-niet');
  assert.equal(swipeOutcome({ dx: 119, width: 400 }), null, 'net onder de drempel');
  assert.equal(swipeOutcome({ dx: -119, width: 400 }), null, 'net onder de drempel');
  assert.equal(swipeOutcome({ dx: 60, width: 400 }), null, 'de helft is geen keuze');
  assert.equal(swipeOutcome({ dx: 60, width: 200 }), 'lekker', 'de drempel schaalt mee');
  assert.equal(swipeOutcome({ dx: 300, width: 0 }), null, 'zonder breedte geen keuze');
  assert.equal(swipeOutcome({ dx: 'x', width: 400 }), null);
  assert.equal(swipeOutcome({ dx: 50, width: 100, threshold: 0.5 }), 'lekker');
});

test('tijdens het slepen wordt het label van de richting zichtbaar', () => {
  assert.deepEqual(swipeFeedback({ dx: 0, width: 400 }), { label: null, direction: null, outcome: null });
  assert.equal(swipeFeedback({ dx: 12, width: 400 }).label, 'Lekker →');
  assert.equal(swipeFeedback({ dx: -12, width: 400 }).label, '← Liever niet');
  // Het label is er al vóór de drempel; de keuze pas erna.
  assert.equal(swipeFeedback({ dx: 40, width: 400 }).outcome, null);
  assert.equal(swipeFeedback({ dx: 140, width: 400 }).outcome, 'lekker');
  assert.equal(swipeFeedback({ dx: -140, width: 400 }).outcome, 'liever-niet');
});

test('de voortgang staat als "Gerecht <n> van <m>" in de stapel', () => {
  assert.equal(kiesProgressLabel(0, 4), 'Gerecht 1 van 4');
  assert.equal(kiesProgressLabel(1, 4), 'Gerecht 2 van 4');
  assert.equal(kiesProgressLabel(3, 4), 'Gerecht 4 van 4');
  assert.equal(kiesProgressLabel(9, 4), 'Gerecht 4 van 4');
  assert.equal(kiesProgressLabel(0, 0), '');
  assert.equal(kiesProgressLabel(-2, 0), '');
});

test('na een stem gaat de stapel naar het volgende onbeoordeelde gerecht', () => {
  const dishes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(nextDishIndex(dishes, []), 0);
  assert.equal(nextDishIndex(dishes, ['a']), 1);
  assert.equal(nextDishIndex(dishes, ['a', 'b', 'c']), -1);
  assert.equal(nextDishIndex(dishes, ['b']), 0);
  assert.equal(nextDishIndex([], ['a']), -1);
});


// ─── De eigen voortgang in localStorage ────────────────────────────────────

test('de eigen stand gaat in localStorage en komt er heel uit', () => {
  const storage = memoryStorage();
  const written = writeKiesProgress(storage, CODE, { stemmer: STEMMER, roepnaam: ' Sam ', gestemd: ['a', 'a', 'b'] });
  assert.equal(written.ok, true);
  assert.deepEqual(written.progress, { stemmer: STEMMER, roepnaam: 'Sam', gestemd: ['a', 'b'] });
  assert.deepEqual(readKiesProgress(storage, CODE), { stemmer: STEMMER, roepnaam: 'Sam', gestemd: ['a', 'b'] });
  assert.ok(storage.dump()[KIES_PROGRESS_KEY], 'één sleutel voor alle stemmingen');
  assert.equal(readKiesProgress(storage, 'A'.repeat(21)), null, 'een andere code heeft een eigen stand');
});

test('zonder opslag, met een fout of met kapotte JSON blijft de pagina werken', () => {
  const progress = { stemmer: STEMMER, roepnaam: 'Sam', gestemd: ['a'] };
  assert.equal(writeKiesProgress(null, CODE, progress).ok, false);
  const broken = { getItem: () => '{kapot', setItem: () => { throw new Error('vol'); } };
  assert.equal(readKiesProgress(broken, CODE), null);
  assert.equal(writeKiesProgress(broken, CODE, progress).ok, false);
  assert.equal(readKiesProgress(memoryStorage({ [KIES_PROGRESS_KEY]: '[]' }), CODE), null);
  // Een kapot kenmerk in de opslag telt niet als eigen stand.
  const wrong = memoryStorage({ [KIES_PROGRESS_KEY]: JSON.stringify({ [CODE]: { stemmer: 'kort', roepnaam: 'Sam' } }) });
  assert.equal(readKiesProgress(wrong, CODE), null);
});

// ─── De link, de voorvertoning en de fout ──────────────────────────────────

test('de stemlink is /kies/<code>, de preview in de stijl van BE-44', () => {
  assert.equal(kiesHref(CODE), `/kies/${CODE}`);
  assert.equal(kiesHref(CODE, 'donker'), `/kies/${CODE}?stand=donker`);
  assert.equal(kiesHref('kort'), null);
  assert.equal(kiesImageHref({ code: CODE }), `/kies/${CODE}/share-image`);
  assert.equal(kiesImageHref({ code: CODE, theme: 'donker' }), `/kies/${CODE}/share-image?stand=donker`);
  assert.equal(kiesImageTitle(4), 'Kies mee: 4 gerechten');
  assert.equal(kiesImageTitle(1), 'Kies mee: 1 gerecht');
});

test('de metadata noemt de kop, de url en de voorvertoningsafbeelding', () => {
  const metadata = kiesMetadata({
    count: 4,
    baseUrl: 'https://voorbeeld.test',
    href: `/kies/${CODE}`,
    imageHref: `/kies/${CODE}/share-image`,
  });
  assert.equal(metadata.title, 'Kies mee: 4 gerechten');
  assert.equal(metadata.openGraph.title, 'Kies mee: 4 gerechten');
  assert.equal(metadata.openGraph.url, `https://voorbeeld.test/kies/${CODE}`);
  assert.deepEqual(metadata.openGraph.images, [
    { url: `https://voorbeeld.test/kies/${CODE}/share-image`, width: 1200, height: 630, alt: 'Kies mee: 4 gerechten' },
  ]);
  assert.equal(metadata.metadataBase.href, 'https://voorbeeld.test/');
  // Zonder telling (migratie ontbreekt of stemming onbekend): geen verzonnen aantal.
  const bare = kiesMetadata({ href: `/kies/${CODE}` });
  assert.equal(bare.title, 'Kies mee');
  assert.equal(bare.openGraph.images, undefined);
});

test('een ontbrekende tabel is één herkenbare fout, geen crash', () => {
  assert.equal(isMissingKiesStorage({ code: '42P01' }), true);
  assert.equal(isMissingKiesStorage({ code: '42883' }), true);
  assert.equal(isMissingKiesStorage({ code: 'PGRST205' }), true);
  assert.equal(isMissingKiesStorage({ message: 'relation "kies_stemmingen" does not exist' }), true);
  assert.equal(isMissingKiesStorage({ message: 'Could not find the table in the schema cache' }), true);
  assert.equal(isMissingKiesStorage({ code: '23505', message: 'duplicate key' }), false);
  assert.equal(isMissingKiesStorage(null), false);
  assert.equal(KIES_NOT_AVAILABLE_MESSAGE, 'Samen kiezen is nog niet beschikbaar');
  assert.equal(KIES_CLOSED_MESSAGE, 'De stemming is gesloten');
  assert.equal(KIES_FULL_MESSAGE, 'Deze stemming heeft het maximum van 50 stemmers bereikt');
  assert.equal(KIES_UNDO_LABEL, 'Vorige stem ongedaan maken');
});

