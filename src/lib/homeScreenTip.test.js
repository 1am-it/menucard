'use strict';

// BE-62 (#153, ontwerp punt 4) — de tip "Zet ons op je beginscherm": vanaf het
// tweede bezoek, nooit bij het eerste, nooit na sluiten, nooit zonder opslag,
// nooit in de app-stand en nooit op desktop.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TIP_BODY,
  TIP_BODY_SEGMENTS,
  TIP_CLOSE_LABEL,
  TIP_LOGO_TEXT,
  TIP_MAX_WIDTH,
  TIP_SESSION_KEY,
  TIP_STORAGE_KEY,
  TIP_TITLE,
  decideTip,
  dismissTip,
  isPhoneWidth,
  isPublicPath,
  isStandalone,
  readTipState,
} = require('./homeScreenTip');

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    map,
  };
}

function matchMediaFor({ phone: onPhone = true, standalone = false } = {}) {
  return (query) => {
    if (query === '(display-mode: standalone)') return { matches: standalone };
    if (query === `(max-width: ${TIP_MAX_WIDTH}px)`) return { matches: onPhone };
    return { matches: false };
  };
}

/** Een nieuw bezoek: nieuwe sessionStorage, dezelfde localStorage. */
function visit({ storage, standalone = false, onPhone = true } = {}) {
  return decideTip({
    storage,
    session: memoryStorage(),
    matchMedia: matchMediaFor({ phone: onPhone, standalone }),
  });
}

test('BE-62: de teksten en de vorm van de tip', () => {
  assert.equal(TIP_TITLE, 'Zet ons op je beginscherm');
  assert.equal(TIP_BODY, 'Dan vind je ons net zo snel als een app. Tik op Delen en daarna op Zet op beginscherm.');
  assert.equal(TIP_CLOSE_LABEL, 'Tip sluiten');
  assert.equal(TIP_LOGO_TEXT, 'om');
  assert.equal(TIP_MAX_WIDTH, 640);
  // De opgemaakte stukjes zijn samen precies dezelfde zin.
  assert.equal(TIP_BODY_SEGMENTS.map((part) => part.text).join(''), TIP_BODY);
  assert.deepEqual(
    TIP_BODY_SEGMENTS.filter((part) => part.bold).map((part) => part.text),
    ['Delen', 'Zet op beginscherm'],
  );
});

test('BE-62: de tip verschijnt niet bij het eerste bezoek', () => {
  const storage = memoryStorage();
  const first = visit({ storage });
  assert.equal(first.show, false);
  assert.equal(first.visits, 1);
  assert.equal(readTipState(storage).visits, 1);
});

test('BE-62: de tip verschijnt bij het tweede bezoek', () => {
  const storage = memoryStorage();
  visit({ storage });
  const second = visit({ storage });
  assert.equal(second.show, true);
  assert.equal(second.visits, 2);
  // En blijft daarna zichtbaar tot iemand hem sluit.
  assert.equal(visit({ storage }).show, true);
});

test('BE-62: na sluiten komt de tip nooit meer terug', () => {
  const storage = memoryStorage();
  visit({ storage });
  assert.equal(visit({ storage }).show, true);
  dismissTip(storage);
  assert.equal(readTipState(storage).dismissed, true);
  for (let i = 0; i < 3; i += 1) {
    assert.equal(visit({ storage }).show, false);
  }
  // Sluiten zelf blijft werken, ook als er nooit een bezoek geteld is.
  const fresh = memoryStorage();
  assert.equal(dismissTip(fresh).ok, true);
  assert.equal(visit({ storage: fresh }).show, false);
});

test('BE-62: een tweede pagina in hetzelfde bezoek telt niet als nieuw bezoek', () => {
  const storage = memoryStorage();
  const session = memoryStorage();
  const first = decideTip({ storage, session, matchMedia: matchMediaFor() });
  assert.equal(first.visits, 1);
  const again = decideTip({ storage, session, matchMedia: matchMediaFor() });
  assert.equal(again.visits, 1);
  assert.equal(again.show, false);
  assert.equal(session.getItem(TIP_SESSION_KEY), '1');
});

test('BE-62: zonder opslag geen tip en geen fout', () => {
  for (const storage of [null, undefined, {}]) {
    let result;
    assert.doesNotThrow(() => {
      result = visit({ storage });
    });
    assert.equal(result.show, false);
    assert.equal(result.visits, 0);
  }
  // Kapotte JSON is ook geen fout: het is een schone start, dus geen tip.
  const broken = memoryStorage();
  broken.setItem(TIP_STORAGE_KEY, '{niet-json');
  assert.deepEqual(readTipState(broken), { visits: 0, dismissed: false });
  assert.equal(visit({ storage: broken }).show, false);
  assert.equal(readTipState(broken).visits, 1);
});

test('BE-62: zonder sessionStorage geen tip en geen fout', () => {
  const storage = memoryStorage();
  visit({ storage });
  let result;
  assert.doesNotThrow(() => {
    result = decideTip({ storage, session: null, matchMedia: matchMediaFor() });
  });
  assert.equal(result.show, false);
  // En er is dan ook geen bezoek bijgeteld.
  assert.equal(readTipState(storage).visits, 1);
});

test('BE-62: niet in de app-stand en niet op desktop', () => {
  const storage = memoryStorage();
  visit({ storage });
  assert.equal(visit({ storage, standalone: true }).show, false);
  assert.equal(visit({ storage, onPhone: false }).show, false);
  assert.equal(visit({ storage }).show, true);
});

test('BE-62: matchMedia-helpers zijn veilig zonder browser', () => {
  assert.equal(isStandalone(null), false);
  assert.equal(isPhoneWidth(null), false);
  assert.equal(isStandalone(() => { throw new Error('kapot'); }), false);
  assert.equal(isPhoneWidth(() => { throw new Error('kapot'); }), false);
  assert.equal(isStandalone(matchMediaFor({ standalone: true })), true);
  assert.equal(isPhoneWidth(matchMediaFor({ phone: false })), false);
});

test('BE-62: de tip hoort alleen op publieke pagina\'s', () => {
  for (const pathname of ['/', '/menu/6-kaart', '/kies/AbC', '/mijn-lijstje', '/search']) {
    assert.equal(isPublicPath(pathname), true, pathname);
  }
  for (const pathname of ['/internal', '/internal/bronnen', '/mijn-restaurant', '/inloggen', '/api/v1/kies', '/claim', '', null]) {
    assert.equal(isPublicPath(pathname), false, String(pathname));
  }
  // Een pad dat alleen met dezelfde letters begint, is geen intern pad.
  assert.equal(isPublicPath('/internationaal'), true);
});
