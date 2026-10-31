// BE-49 (#115) — de deelvoorkeur van een bezoeker en de deellinks per manier.
//
// Alles wat "snel delen" bepaalt staat hier op één plek, los van React:
//   - de vijf manieren uit het contract (WhatsApp, Link kopiëren, Sms, Telegram,
//     E-mail) en de uitzondering "Liever altijd het telefoonmenu";
//   - de link per manier, met url-encoding en zonder begeleidende tekst
//     (eigenaarsbesluit 28 oktober blijft gelden: alleen de url, bij e-mail ook
//     het onderwerp);
//   - de voorkeur lezen en schrijven, alleen in `localStorage` onder
//     `deelvoorkeur`, met try/catch: geen opslag of een kapotte opslag betekent
//     het gedrag van het telefoonmenu (contract criterium 2);
//   - de keuze van het gedrag: nog geen voorkeur → het blad, één favoriet →
//     meteen delen, twee of drie → het kleine menu, telefoonmenu → zoals nu;
//   - de uitvoering van één deelactie, inclusief de bestaande `gedeeld`-teller
//     (BE-44): precies één keer bij een geslaagde actie, welke manier ook.
//
// De manier zelf wordt nergens opgeslagen of verstuurd: de teller kent alleen
// `{ dish, event }`. Er is geen cookie en er gaat niets naar de server behalve
// die bestaande teller.
//
// Bewust CommonJS, zoals dishShare.js en dishList.js: direct testbaar met
// `node --test`, zonder browser, React of netwerk.

'use strict';

const { buildSharePayload, copyShareLink } = require('./dishShare');

// De opslagsleutel uit het contract (criterium 2). Eén sleutel, geen cookie.
const SHARE_PREFERENCE_KEY = 'deelvoorkeur';
const MAX_SHARE_FAVORITES = 3;

// De volgorde uit het contract: WhatsApp, Link kopiëren, Sms, Telegram, E-mail.
const SHARE_METHODS = [
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'copy', label: 'Link kopiëren' },
  { id: 'sms', label: 'Sms' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'email', label: 'E-mail' },
];
const SHARE_METHOD_IDS = SHARE_METHODS.map((method) => method.id);

// De uitzondering: altijd het systeemmenu (op de telefoon) of kopiëren.
const PHONE_MENU = 'telefoonmenu';
const PHONE_MENU_LABEL = 'Liever altijd het telefoonmenu';
const SHARE_MORE_LABEL = 'Meer…';

// De teksten van het blad en de instellingen (contract criterium 2 en 5). De
// exacte teksten zijn gedelegeerd; deze staan hier zodat component en tests
// nooit uit elkaar lopen.
//
// BE-61 (#152, variant A): het blad heeft nu één schakelaar met twee delen
// ("Mijn favorieten" en "Telefoonmenu"), een kop met een sluitknop en de hint
// uit het goedgekeurde ontwerp. "Annuleren" is uit het blad verdwenen: sluiten
// gaat met het kruisje, met Esc of met een tik naast het paneel. De kleine
// deelmenu (`ShareMenu`) houdt zijn eigen "Annuleren".
const SHARE_SHEET_TITLE = 'Hoe deel je meestal?';
const SHARE_SHEET_HINT = 'Kies tot 3 favorieten. Daarna deel je met één tik.';
const SHARE_HINT_FULL = 'Je hebt 3 favorieten gekozen. Kies er eerst een af om een andere te nemen.';
const SHARE_SEGMENT_LEGEND = 'Hoe wil je delen?';
const SHARE_SEGMENT_METHODS_LABEL = 'Mijn favorieten';
const SHARE_SEGMENT_PHONE_LABEL = 'Telefoonmenu';
const SHARE_FAVORITES_LABEL = 'Favorieten';
const SHARE_CLOSE_LABEL = 'Sluiten';
const SHARE_SETTINGS_LABEL = 'Delen via';
const SHARE_SETTINGS_TITLE = 'Delen via';
const SHARE_SAVE_LABEL = 'Opslaan';
const SHARE_CLEAR_LABEL = 'Wissen';
const SHARE_CANCEL_LABEL = 'Annuleren';
const SHARE_MENU_TITLE = 'Delen via';

const EMPTY_RESULT = { ok: false, message: '', method: null };

function textOf(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

/** Het label van een manier, of null voor iets dat geen manier is. */
function shareMethodLabel(method) {
  const found = SHARE_METHODS.find((entry) => entry.id === method);
  return found ? found.label : null;
}

/**
 * De teller rechts in het blad (BE-61, ontwerp): "0 van 3 gekozen" tot en met
 * "3 van 3 gekozen". Een onbruikbaar aantal telt als nul.
 */
function shareFavoriteCountLabel(count) {
  const number = Number(count);
  const chosen = Number.isFinite(number) ? Math.min(MAX_SHARE_FAVORITES, Math.max(0, Math.trunc(number))) : 0;
  return `${chosen} van ${MAX_SHARE_FAVORITES} gekozen`;
}

/**
 * Alleen de echte manieren, zonder dubbelen, in de volgorde van het contract en
 * hoogstens drie (contract criterium 2).
 */
function normalizeShareMethods(value) {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set();
  const methods = [];
  for (const entry of list) {
    const id = textOf(entry).toLowerCase();
    if (!SHARE_METHOD_IDS.includes(id) || seen.has(id)) continue;
    seen.add(id);
    methods.push(id);
    if (methods.length >= MAX_SHARE_FAVORITES) break;
  }
  return methods;
}

/**
 * Een opgeslagen of gekozen voorkeur als `{ phone, methods }`, of null als er
 * niets bruikbaars staat. Een losse lijst en de tekst "telefoonmenu" worden ook
 * gelezen, zodat een handmatig gezette of oude waarde geen fout geeft.
 */
function normalizeSharePreference(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') {
    const text = textOf(value).toLowerCase();
    if (text === PHONE_MENU) return { phone: true, methods: [] };
    return null;
  }
  if (Array.isArray(value)) {
    const methods = normalizeShareMethods(value);
    return methods.length > 0 ? { phone: false, methods } : null;
  }
  if (typeof value !== 'object') return null;
  if (value.phone === true) return { phone: true, methods: [] };
  const methods = normalizeShareMethods(value.methods || value.favorieten);
  return methods.length > 0 ? { phone: false, methods } : null;
}

/** De vorm die in `localStorage` gaat; null als er niets te bewaren is. */
function preferenceStorageValue(value) {
  const preference = normalizeSharePreference(value);
  if (!preference) return null;
  if (preference.phone) return { phone: true };
  return { methods: preference.methods.slice() };
}



/** Kan deze opslag lezen en schrijven? Proef met een eigen sleutel. */
function storageAvailable(storage) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') return false;
  const probeKey = `${SHARE_PREFERENCE_KEY}__proef`;
  try {
    storage.setItem(probeKey, '1');
    if (typeof storage.removeItem === 'function') storage.removeItem(probeKey);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Lezen. Zonder opslag, met een fout of met kapotte JSON: geen voorkeur, dus
 * het blad (of, als de opslag helemaal niet werkt, het telefoonmenu).
 */
function readSharePreference(storage) {
  if (!storage || typeof storage.getItem !== 'function') return null;
  try {
    const raw = storage.getItem(SHARE_PREFERENCE_KEY);
    if (!raw) return null;
    return normalizeSharePreference(JSON.parse(raw));
  } catch (error) {
    return null;
  }
}

/**
 * Schrijven. Lukt het niet (privémodus, beleid, volle schijf), dan blijft de
 * knop werken; alleen het onthouden lukt dan niet.
 */
function writeSharePreference(storage, value) {
  const payload = preferenceStorageValue(value);
  if (!payload) return false;
  if (!storage || typeof storage.setItem !== 'function') return false;
  try {
    storage.setItem(SHARE_PREFERENCE_KEY, JSON.stringify(payload));
    return true;
  } catch (error) {
    return false;
  }
}

/** De voorkeur wissen (instellingen: "Wissen"). */
function clearSharePreference(storage) {
  if (!storage || typeof storage.getItem !== 'function') return false;
  if (typeof storage.removeItem !== 'function') return false;
  try {
    storage.removeItem(SHARE_PREFERENCE_KEY);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Welk gedrag hoort bij deze voorkeur (contract, "Voorbeelden"):
 *   - geen voorkeur (en opslag werkt) → het blad "Hoe deel je meestal?";
 *   - geen opslag → het telefoonmenu, nooit een blad dat niets onthoudt;
 *   - één favoriet → meteen delen;
 *   - twee of drie favorieten → het kleine menu met "Meer…";
 *   - "telefoonmenu" → het systeemmenu, anders kopiëren.
 */
function sharePlan(preference, { canStore = true } = {}) {
  const normalized = normalizeSharePreference(preference);
  if (!normalized) {
    return canStore ? { kind: 'choose' } : { kind: 'phone' };
  }
  if (normalized.phone) return { kind: 'phone' };
  if (normalized.methods.length === 1) return { kind: 'direct', method: normalized.methods[0] };
  return { kind: 'menu', methods: normalized.methods.slice() };
}

/**
 * De link per manier (contract criterium 3). Alleen de bestaande deeplink
 * (`absoluteShareUrl`) gaat mee, met url-encoding en zonder begeleidende tekst:
 * bij e-mail ook alleen het onderwerp.
 */
function shareMethodLink(method, { url, title } = {}) {
  const href = textOf(url);
  if (!href) return null;
  const encoded = encodeURIComponent(href);
  switch (method) {
    case 'whatsapp':
      return `https://wa.me/?text=${encoded}`;
    case 'telegram':
      return `https://t.me/share/url?url=${encoded}`;
    case 'sms':
      return `sms:?&body=${encoded}`;
    case 'email': {
      const subject = encodeURIComponent(textOf(title));
      return `mailto:?subject=${subject}&body=${encoded}`;
    }
    default:
      // 'copy' heeft geen link nodig (het klembord) en al het andere is geen
      // manier.
      return null;
  }
}

function callCount(count) {
  if (typeof count !== 'function') return;
  try {
    count();
  } catch (error) {
    // Een mislukte telling verandert nooit iets aan de deelactie zelf.
  }
}

/**
 * Eén deelactie uitvoeren. `deps` maakt dit testbaar zonder browser:
 *   - `clipboard`: het klembord (`navigator.clipboard`);
 *   - `share`: `navigator.share` (bind hem in de component);
 *   - `open`: een functie die een link opent (WhatsApp, Telegram, Sms, E-mail);
 *   - `count`: de bestaande `gedeeld`-teller.
 *
 * Een afgebroken systeemmenu of een geweigerd klembord telt niet en geeft geen
 * melding. De teller gaat precies één keer mee per geslaagde actie, ongeacht de
 * manier; de manier zelf gaat nooit mee.
 */
async function performShare({ method, url, title, clipboard, share, open, count } = {}) {
  const href = textOf(url);
  if (!href) return { ...EMPTY_RESULT, method: method || null };
  const result = (ok, message) => {
    if (ok) callCount(count);
    return { ok, message: ok ? message : '', method };
  };

  if (method === 'phone') {
    if (typeof share === 'function') {
      try {
        await share(buildSharePayload({ title, url: href }));
      } catch (error) {
        return result(false, '');
      }
      return result(true, '');
    }
    // Geen systeemmenu (desktop): kopiëren met "Link gekopieerd".
    const copied = await copyShareLink(clipboard, href);
    return result(copied.ok, copied.message);
  }

  if (method === 'copy') {
    const copied = await copyShareLink(clipboard, href);
    return result(copied.ok, copied.message);
  }

  const link = shareMethodLink(method, { url: href, title });
  if (!link || typeof open !== 'function') return result(false, '');
  try {
    open(link);
  } catch (error) {
    return result(false, '');
  }
  return result(true, '');
}

module.exports = {
  MAX_SHARE_FAVORITES,
  PHONE_MENU,
  PHONE_MENU_LABEL,
  SHARE_CANCEL_LABEL,
  SHARE_CLEAR_LABEL,
  SHARE_CLOSE_LABEL,
  SHARE_FAVORITES_LABEL,
  SHARE_HINT_FULL,
  SHARE_MENU_TITLE,
  SHARE_METHODS,
  SHARE_METHOD_IDS,
  SHARE_MORE_LABEL,
  SHARE_PREFERENCE_KEY,
  SHARE_SAVE_LABEL,
  SHARE_SEGMENT_LEGEND,
  SHARE_SEGMENT_METHODS_LABEL,
  SHARE_SEGMENT_PHONE_LABEL,
  SHARE_SETTINGS_LABEL,
  SHARE_SETTINGS_TITLE,
  SHARE_SHEET_HINT,
  SHARE_SHEET_TITLE,
  clearSharePreference,
  normalizeShareMethods,
  normalizeSharePreference,
  performShare,
  preferenceStorageValue,
  readSharePreference,
  shareFavoriteCountLabel,
  shareMethodLabel,
  shareMethodLink,
  sharePlan,
  storageAvailable,
  writeSharePreference,
};
