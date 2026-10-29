'use strict';

// BE-49 (#115) — de deelvoorkeur en de deellinks, tegen de echte projectdata.
//
// De load-bearing punten uit het contract:
// - de link per manier (WhatsApp, Telegram, Sms, E-mail) met url-encoding en
//   zonder begeleidende tekst, op de bestaande BE-44-deeplink;
// - de voorkeur lezen en schrijven in localStorage, inclusief een kapotte of
//   geblokkeerde opslag: dan het gedrag van het telefoonmenu;
// - de keuze van het gedrag bij 0, 1 of meer favorieten en bij "telefoonmenu";
// - de bestaande `gedeeld`-teller precies één keer per geslaagde deelactie, via
//   welke manier ook, en nooit bij een afgebroken of mislukte actie.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const {
  MAX_SHARE_FAVORITES,
  PHONE_MENU,
  SHARE_METHODS,
  SHARE_PREFERENCE_KEY,
  clearSharePreference,
  normalizeShareMethods,
  normalizeSharePreference,
  performShare,
  readSharePreference,
  shareMethodLabel,
  shareMethodLink,
  sharePlan,
  storageAvailable,
  writeSharePreference,
} = require('./sharePreference');

// De echte deeplink van BE-12/BE-44 voor "Poussin" uit de dinerkaart van
// restaurant 6, met de stand van dit moment. Precies wat de knop doorgeeft.
const SHARE_URL = 'https://example.org/menu/6-diner?dish=6-diner-0-0&name=Poussin&cat=Specialiteiten+van+Bardot&stand=licht';
const TITLE = 'Poussin · Brasserie Bardot';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
    read: (key) => (data.has(key) ? data.get(key) : null),
  };
}

// ─── De deellinks per manier ────────────────────────────────────────────────

test('de vijf manieren uit het contract, in de vaste volgorde, met een label', () => {
  assert.deepEqual(SHARE_METHODS.map((entry) => entry.id), ['whatsapp', 'copy', 'sms', 'telegram', 'email']);
  assert.deepEqual(SHARE_METHODS.map((entry) => entry.label), ['WhatsApp', 'Link kopiëren', 'Sms', 'Telegram', 'E-mail']);
  assert.equal(shareMethodLabel('telegram'), 'Telegram');
  assert.equal(shareMethodLabel('onbekend'), null);
});

test('WhatsApp en Telegram krijgen exact de url, zonder begeleidende tekst', () => {
  const whatsapp = shareMethodLink('whatsapp', { url: SHARE_URL, title: TITLE });
  assert.equal(whatsapp, `https://wa.me/?text=${encodeURIComponent(SHARE_URL)}`);
  const telegram = shareMethodLink('telegram', { url: SHARE_URL, title: TITLE });
  assert.equal(telegram, `https://t.me/share/url?url=${encodeURIComponent(SHARE_URL)}`);
  // Er is geen tweede parameter en er gaat geen tekst mee.
  assert.deepEqual([...new URL(whatsapp).searchParams.keys()], ['text']);
  assert.deepEqual([...new URL(telegram).searchParams.keys()], ['url']);
  // De url overleeft de url-encoding precies.
  assert.equal(new URL(whatsapp).searchParams.get('text'), SHARE_URL);
  assert.equal(new URL(telegram).searchParams.get('url'), SHARE_URL);
});

test('Sms en E-mail dragen de url; e-mail ook alleen het onderwerp', () => {
  const sms = shareMethodLink('sms', { url: SHARE_URL, title: TITLE });
  assert.equal(sms, `sms:?&body=${encodeURIComponent(SHARE_URL)}`);
  assert.equal(decodeURIComponent(sms.slice('sms:?&body='.length)), SHARE_URL);

  const email = shareMethodLink('email', { url: SHARE_URL, title: TITLE });
  assert.equal(email, `mailto:?subject=${encodeURIComponent(TITLE)}&body=${encodeURIComponent(SHARE_URL)}`);
  const params = new URLSearchParams(email.slice('mailto:?'.length));
  assert.deepEqual([...params.keys()], ['subject', 'body']);
  assert.equal(params.get('subject'), TITLE);
  assert.equal(params.get('body'), SHARE_URL);
});

test('een geaccentueerde of rare url en titel overleven de encoding', () => {
  const url = 'https://example.org/menu/6-diner?dish=6-diner-0-0&name=Caf%C3%A9%20Sp%C3%A9cial%20%26%20Zo&stand=donker';
  const title = 'Café Spécial & Zo · Brasserie Bardot';
  for (const method of ['whatsapp', 'telegram', 'sms', 'email']) {
    const link = shareMethodLink(method, { url, title });
    assert.ok(link, `${method} moet een link geven`);
    assert.equal(link.includes(' '), false, `${method}: geen losse spaties`);
    const body = method === 'email'
      ? new URLSearchParams(link.slice('mailto:?'.length)).get('body')
      : method === 'sms'
        ? decodeURIComponent(link.slice('sms:?&body='.length))
        : new URL(link).searchParams.get(method === 'whatsapp' ? 'text' : 'url');
    assert.equal(body, url, `${method}: de url komt er ongewijzigd uit`);
  }
  assert.equal(new URLSearchParams(shareMethodLink('email', { url, title }).slice(7)).get('subject'), title);
});

test('kopiëren en onbekende manieren hebben geen link; zonder url is er niets', () => {
  assert.equal(shareMethodLink('copy', { url: SHARE_URL, title: TITLE }), null);
  assert.equal(shareMethodLink('linkedin', { url: SHARE_URL, title: TITLE }), null);
  assert.equal(shareMethodLink('whatsapp', { url: '', title: TITLE }), null);
  assert.equal(shareMethodLink('whatsapp', {}), null);
});

// ─── De voorkeur lezen en schrijven ─────────────────────────────────────────

test('een gekozen voorkeur wordt bewaard en teruggelezen', () => {
  const storage = memoryStorage();
  assert.equal(writeSharePreference(storage, ['whatsapp', 'copy']), true);
  assert.deepEqual(JSON.parse(storage.read(SHARE_PREFERENCE_KEY)), { methods: ['whatsapp', 'copy'] });
  assert.deepEqual(readSharePreference(storage), { phone: false, methods: ['whatsapp', 'copy'] });

  assert.equal(writeSharePreference(storage, { methods: ['telegram'] }), true);
  assert.deepEqual(readSharePreference(storage), { phone: false, methods: ['telegram'] });

  assert.equal(writeSharePreference(storage, PHONE_MENU), true);
  assert.deepEqual(JSON.parse(storage.read(SHARE_PREFERENCE_KEY)), { phone: true });
  assert.deepEqual(readSharePreference(storage), { phone: true, methods: [] });
});

test('alleen bekende manieren, zonder dubbelen, hoogstens drie', () => {
  assert.equal(MAX_SHARE_FAVORITES, 3);
  assert.deepEqual(
    normalizeShareMethods(['whatsapp', 'whatsapp', 'onbekend', 'telegram', 'sms', 'email']),
    ['whatsapp', 'telegram', 'sms'],
  );
  assert.deepEqual(normalizeShareMethods('whatsapp'), []);
  assert.deepEqual(normalizeShareMethods(null), []);
  // Ook een met de hand geschreven opslagwaarde kan niet meer dan drie worden.
  assert.deepEqual(
    normalizeSharePreference({ methods: ['whatsapp', 'copy', 'sms', 'telegram'] }),
    { phone: false, methods: ['whatsapp', 'copy', 'sms'] },
  );
});

test('een lege, kapotte of onbekende opgeslagen waarde betekent geen voorkeur', () => {
  assert.equal(normalizeSharePreference([]), null);
  assert.equal(normalizeSharePreference({}), null);
  assert.equal(normalizeSharePreference({ methods: [] }), null);
  assert.equal(normalizeSharePreference({ methods: ['onbekend'] }), null);
  assert.equal(normalizeSharePreference({ phone: false, methods: ['onbekend'] }), null);
  assert.equal(normalizeSharePreference('iets anders'), null);
  assert.equal(normalizeSharePreference(42), null);
  assert.equal(normalizeSharePreference(undefined), null);

  const storage = memoryStorage({ [SHARE_PREFERENCE_KEY]: '{geen json' });
  assert.equal(readSharePreference(storage), null);
  assert.equal(writeSharePreference(storage, []), false, 'niets te bewaren is geen schrijfactie');
});

test('een kapotte of geblokkeerde opslag geeft nooit een fout', () => {
  const throwingRead = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => {}, removeItem: () => {} };
  assert.equal(readSharePreference(throwingRead), null);
  assert.equal(storageAvailable(throwingRead), true, 'lezen kan mislukken terwijl schrijven werkt');

  const throwingWrite = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => {} };
  assert.equal(writeSharePreference(throwingWrite, ['whatsapp']), false);
  assert.equal(storageAvailable(throwingWrite), false);
  assert.equal(clearSharePreference(throwingWrite), true, 'wissen van niets is geen fout');

  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
  assert.equal(storageAvailable(blocked), false);
  assert.equal(readSharePreference(blocked), null);
  assert.equal(writeSharePreference(blocked, PHONE_MENU), false);
  assert.equal(clearSharePreference(blocked), false);

  assert.equal(storageAvailable(null), false);
  assert.equal(storageAvailable(undefined), false);
  assert.equal(readSharePreference(null), null);
  assert.equal(writeSharePreference(null, ['whatsapp']), false);
  assert.equal(clearSharePreference(null), false);
});

test('de voorkeur wissen laat niets achter', () => {
  const storage = memoryStorage({ [SHARE_PREFERENCE_KEY]: JSON.stringify({ methods: ['sms'] }), andere: 'blijft' });
  assert.equal(clearSharePreference(storage), true);
  assert.equal(storage.read(SHARE_PREFERENCE_KEY), null);
  assert.equal(storage.read('andere'), 'blijft');
  assert.equal(readSharePreference(storage), null);
});

// ─── De keuze van het gedrag ────────────────────────────────────────────────

test('zonder voorkeur opent het blad; zonder opslag het telefoonmenu', () => {
  assert.deepEqual(sharePlan(null), { kind: 'choose' });
  assert.deepEqual(sharePlan(readSharePreference(memoryStorage())), { kind: 'choose' });
  assert.deepEqual(sharePlan(null, { canStore: false }), { kind: 'phone' });
  // Een kapotte opgeslagen waarde is geen voorkeur.
  assert.deepEqual(sharePlan({ methods: ['onbekend'] }), { kind: 'choose' });
});

test('één favoriet deelt meteen, twee of drie favorieten openen het kleine menu', () => {
  assert.deepEqual(sharePlan({ methods: ['whatsapp'] }), { kind: 'direct', method: 'whatsapp' });
  assert.deepEqual(sharePlan(['email']), { kind: 'direct', method: 'email' });
  assert.deepEqual(sharePlan({ methods: ['whatsapp', 'copy'] }), { kind: 'menu', methods: ['whatsapp', 'copy'] });
  assert.deepEqual(sharePlan({ methods: ['whatsapp', 'copy', 'sms'] }), { kind: 'menu', methods: ['whatsapp', 'copy', 'sms'] });
  // Meer dan drie kan niet: de lezer kort zelf in.
  assert.deepEqual(sharePlan({ methods: ['whatsapp', 'copy', 'sms', 'email'] }), { kind: 'menu', methods: ['whatsapp', 'copy', 'sms'] });
});

test('"telefoonmenu" houdt het gedrag van nu', () => {
  assert.deepEqual(sharePlan({ phone: true }), { kind: 'phone' });
  assert.deepEqual(sharePlan(PHONE_MENU), { kind: 'phone' });
  assert.deepEqual(sharePlan({ phone: true }, { canStore: false }), { kind: 'phone' });
});


// ─── De teller bij elke manier ──────────────────────────────────────────────

function deps() {
  const calls = { opened: [], copied: [], shared: [], count: 0 };
  return {
    calls,
    clipboard: { writeText: async (value) => { calls.copied.push(value); } },
    open: (link) => { calls.opened.push(link); },
    share: async (payload) => { calls.shared.push(payload); },
    count: () => { calls.count += 1; },
  };
}

test('elke webmanier opent zijn eigen link en telt precies één keer', async () => {
  for (const method of ['whatsapp', 'telegram', 'sms', 'email']) {
    const d = deps();
    const result = await performShare({ method, url: SHARE_URL, title: TITLE, ...d });
    assert.equal(result.ok, true, method);
    assert.equal(result.message, '', method);
    assert.equal(result.method, method);
    assert.deepEqual(d.calls.opened, [shareMethodLink(method, { url: SHARE_URL, title: TITLE })], method);
    assert.equal(d.calls.count, 1, `${method}: de teller telt één keer`);
    assert.deepEqual(d.calls.shared, [], `${method}: het systeemmenu wordt niet gebruikt`);
    assert.deepEqual(d.calls.copied, [], `${method}: het klembord wordt niet gebruikt`);
  }
});

test('kopiëren telt één keer, met de melding "Link gekopieerd"', async () => {
  const d = deps();
  const result = await performShare({ method: 'copy', url: SHARE_URL, title: TITLE, ...d });
  assert.deepEqual(result, { ok: true, message: 'Link gekopieerd', method: 'copy' });
  assert.deepEqual(d.calls.copied, [SHARE_URL]);
  assert.deepEqual(d.calls.opened, []);
  assert.equal(d.calls.count, 1);
});

test('het telefoonmenu deelt via navigator.share met alleen url en title', async () => {
  const d = deps();
  const result = await performShare({ method: 'phone', url: SHARE_URL, title: TITLE, ...d });
  assert.deepEqual(result, { ok: true, message: '', method: 'phone' });
  assert.deepEqual(d.calls.shared, [{ url: SHARE_URL, title: TITLE }]);
  assert.equal('text' in d.calls.shared[0], false);
  assert.equal(d.calls.count, 1);
});

test('zonder navigator.share valt het telefoonmenu terug op kopiëren', async () => {
  const d = deps();
  const result = await performShare({ ...d, method: 'phone', url: SHARE_URL, title: TITLE, share: null });
  assert.deepEqual(result, { ok: true, message: 'Link gekopieerd', method: 'phone' });
  assert.deepEqual(d.calls.copied, [SHARE_URL]);
  assert.equal(d.calls.count, 1);
});

test('afgebroken, geweigerd of ontbrekend telt niet en meldt niets', async () => {
  const aborted = deps();
  aborted.share = async () => { throw new Error('AbortError'); };
  assert.deepEqual(await performShare({ method: 'phone', url: SHARE_URL, title: TITLE, ...aborted }), { ok: false, message: '', method: 'phone' });
  assert.equal(aborted.calls.count, 0);

  const denied = deps();
  denied.clipboard = { writeText: async () => { throw new Error('NotAllowedError'); } };
  assert.deepEqual(await performShare({ method: 'copy', url: SHARE_URL, ...denied }), { ok: false, message: '', method: 'copy' });
  assert.equal(denied.calls.count, 0);

  const noClipboard = deps();
  noClipboard.clipboard = null;
  const noShare = await performShare({ method: 'phone', url: SHARE_URL, share: null, clipboard: null, count: noClipboard.count });
  assert.deepEqual(noShare, { ok: false, message: '', method: 'phone' });
  assert.equal(noClipboard.calls.count, 0);

  const broken = deps();
  broken.open = () => { throw new Error('geblokkeerd'); };
  assert.deepEqual(await performShare({ method: 'whatsapp', url: SHARE_URL, ...broken }), { ok: false, message: '', method: 'whatsapp' });
  assert.equal(broken.calls.count, 0);

  const noOpen = deps();
  noOpen.open = null;
  assert.deepEqual(await performShare({ method: 'sms', url: SHARE_URL, ...noOpen }), { ok: false, message: '', method: 'sms' });
  assert.equal(noOpen.calls.count, 0);
});

test('zonder url is er geen deelactie en geen telling', async () => {
  const d = deps();
  assert.deepEqual(await performShare({ method: 'whatsapp', url: '', ...d }), { ok: false, message: '', method: 'whatsapp' });
  assert.equal(d.calls.count, 0);
  assert.deepEqual(d.calls.opened, []);
});

test('een mislukte telling breekt de deelactie niet', async () => {
  const d = deps();
  d.count = () => { throw new Error('teller kapot'); };
  const result = await performShare({ method: 'telegram', url: SHARE_URL, ...d });
  assert.equal(result.ok, true);
});

// ─── Grenzen: geen cookie, geen netwerk, geen opgeslagen manier ─────────────

test('de module schrijft geen cookie en doet zelf geen netwerkverzoek', () => {
  const source = fs.readFileSync(path.join(__dirname, 'sharePreference.js'), 'utf8');
  assert.doesNotMatch(source, /document\.cookie/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /new XMLHttpRequest/);
  assert.match(source, /SHARE_PREFERENCE_KEY = 'deelvoorkeur'/);
  // De teller kent alleen dish en event: de gekozen manier gaat nooit mee.
  assert.doesNotMatch(source, /sendDishCounter/);
});

