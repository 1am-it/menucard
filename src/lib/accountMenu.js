'use strict';

// BE-59 (#146, "Delen 1") — pure beslissingen achter het accountmenu.
//
// Net als src/lib/internalNav.js bewust CommonJS: direct testbaar met
// `node --test`, geen nieuwe dependency, en het werkt prima vanuit de
// ESM 'use client'-componenten die het importeren. Deze module raakt geen
// Supabase, geen DOM, geen netwerk en geen klok; ze classificeert alleen wat er
// al bekend is (rollen, een sessie-opslag, countingen) tot wat het menu toont.
//
// Belangrijk voor criterium 2 (performance): deze module importeert
// internalNav.js NIET. internalNav trekt via importInbox.js ruim duizend regels
// mee, en dat mag niet in de eerste lading van een publieke pagina terechtkomen.
// De telling hieronder gebruikt daarom dezelfde bron (GET
// /api/internal/v1/workqueue-counts, dat al rolgefilterd precies de
// open-werk-secties van deze gebruiker teruggeeft) met dezelfde regels als
// resolveOpenWorkTotal: een ontbrekend of ongeldig aantal maakt het totaal
// onbekend (null) in plaats van een nep-getal.
//
// Dit is uitsluitend een zichtbaarheidslaag. Elke bestaande route houdt zijn
// eigen, ongewijzigde servercontrole; niets hier verleent toegang.

// De opslagsleutel en de goedkope sessiecontrole staan in accountSession.js:
// de koppen laden alleen dat kleine bestand, en pas bij een sessie het menu.
const { AUTH_STORAGE_PATTERN, hasSupabaseSessionKey } = require('./accountSession');

const BEHEER_HREF = '/internal';
const MIJN_RESTAURANT_HREF = '/mijn-restaurant';
const MIJN_LIJSTJE_HREF = '/mijn-lijstje';
const SITE_HREF = '/';

// Volgorde is de volgorde in het menu (issue #146, scherm 1 en 2).
const ITEM_LABELS = {
  beheer: 'Beheer',
  'mijn-restaurant': 'Mijn restaurant',
  'mijn-lijstje': 'Mijn lijstje',
  'bekijk-de-site': 'Bekijk de site',
  uitloggen: 'Uitloggen',
};

// De rol in gewone woorden (issue #146, aanvulling 30 okt, punten 6-8). Nooit
// de technische rolnaam in de uitvoer: `internal` heet "Beheerder", `editor`
// "Redacteur", en een houder "Restauranthouder van [naam]". Onbekende
// rolwaarden leveren geen regel op (fail closed: liever niets dan een verzonnen
// rol).
const ROLE_WORDS = [
  ['internal', 'Beheerder'],
  ['editor', 'Redacteur'],
];

function roleValues(roles) {
  if (!Array.isArray(roles)) return [];
  return roles.map((entry) => (entry && typeof entry === 'object' ? entry.role : entry));
}

function hasRole(roles, role) {
  return roleValues(roles).includes(role);
}

/** Alleen `internal` of `editor` kennen openstaand werk (issue #146). */
function hasWorkRoles(roles) {
  return hasRole(roles, 'internal') || hasRole(roles, 'editor');
}

/** De restaurants waar deze houder van is, als namen, in de volgorde van de
 * rollen en zonder dubbelen. De naam komt uit de server
 * (src/lib/ownerRoleNames.js); zonder naam blijft de lijst leeg. */
function ownerRestaurantNames(roles) {
  const names = [];
  for (const entry of Array.isArray(roles) ? roles : []) {
    if (!entry || typeof entry !== 'object' || entry.role !== 'owner') continue;
    const name = typeof entry.restaurant_name === 'string' ? entry.restaurant_name.trim() : '';
    if (!name || names.includes(name)) continue;
    names.push(name);
  }
  return names;
}

/** "Restauranthouder van [A]", "… van [A] en [B]" of "… van 3 restaurants"
 * (issue #146, punt 6). Zonder bekende naam alleen "Restauranthouder" — nooit
 * een verzonnen of technische naam. */
function ownerDescription(roles) {
  const names = ownerRestaurantNames(roles);
  if (names.length === 0) return 'Restauranthouder';
  if (names.length === 1) return `Restauranthouder van ${names[0]}`;
  if (names.length === 2) return `Restauranthouder van ${names[0]} en ${names[1]}`;
  return `Restauranthouder van ${names.length} restaurants`;
}

/** De rollen in gewone woorden, in vaste volgorde, zonder dubbelen. Een account
 * zonder bekende rol krijgt een lege lijst — nooit "Gast" of een andere
 * verzonnen aanduiding. */
function resolveRoleDescriptions(roles) {
  const descriptions = ROLE_WORDS.filter(([role]) => hasRole(roles, role)).map(([, word]) => word);
  if (hasRole(roles, 'owner')) descriptions.push(ownerDescription(roles));
  return descriptions;
}

/** Één regel voor bovenin het accountmenu: de rollen in gewone woorden,
 * gescheiden door " · " (issue #146, punt 6). Leeg als er geen bekende rol is. */
function resolveRoleDescription(roles) {
  return resolveRoleDescriptions(roles).join(' · ');
}

function withoutDiacritics(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** De eerste letter of het eerste cijfer van een deel, als hoofdletter. */
function firstLetter(part) {
  const match = withoutDiacritics(part).match(/[a-zA-Z0-9]/);
  return match ? match[0].toUpperCase() : '';
}

/** Initialen uit een naam ("Jan Jansen" → "JJ") of uit het e-mailadres
 * ("jan.jansen@restaurant.nl" → "JJ", "info@…" → "I"). Nooit meer dan twee
 * tekens; zonder bruikbare invoer een vraagteken, zodat de avatar nooit leeg is. */
function initialsFrom(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '?';
  const at = text.indexOf('@');
  const source = at >= 0 ? text.slice(0, at) : text;
  const parts = source.split(/[\s._+,;-]+/).filter((part) => part.length > 0);
  if (parts.length === 0) return '?';
  const letters = parts
    .map(firstLetter)
    .filter((letter) => letter.length > 0)
    .slice(0, 2)
    .join('');
  return letters || '?';
}

/** De naam uit de sessie: eerst de volledige naam uit de metadata, dan de
 * gebruikersnaam, dan het e-mailadres. Nooit een lege regel. */
function resolveAccountName(user) {
  const metadata = (user && user.user_metadata) || {};
  const candidates = [metadata.full_name, metadata.name, metadata.display_name, user && user.email];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return 'Account';
}

/** Het schermlezerlabel van de knop: "Account van [naam]", plus het aantal
 * openstaande taken als dat er echt is (issue #146). */
function accountAriaLabel(name, count) {
  const base = `Account van ${typeof name === 'string' && name.trim() ? name.trim() : 'Account'}`;
  if (!Number.isInteger(count) || count <= 0) return base;
  return `${base}, ${count} ${count === 1 ? 'openstaande taak' : 'openstaande taken'}`;
}

/** De stip: alleen voor `internal` of `editor`, en alleen bij een echt aantal
 * groter dan 0. Een onbekend aantal (null) is geen stip. */
function shouldShowDot(roles, count) {
  return hasWorkRoles(roles) && Number.isInteger(count) && count > 0;
}

function isInternalPath(pathname) {
  return typeof pathname === 'string' && (pathname === '/internal' || pathname.startsWith('/internal/'));
}

/** Het totaal van de Werkvoorraad, uit hetzelfde, al rolgefilterde antwoord van
 * /api/internal/v1/workqueue-counts: de som van alle open-werk-secties. Ontbreekt
 * er één aantal, dan is het totaal onbekend (null) — geen nep-getal. */
function openWorkTotal(counts) {
  if (!counts || typeof counts !== 'object') return null;
  const keys = Object.keys(counts);
  if (keys.length === 0) return null;
  let total = 0;
  for (const key of keys) {
    const value = counts[key];
    if (!Number.isInteger(value) || value < 0) return null;
    total += value;
  }
  return total;
}

/** De items die bij deze rollen (en deze pagina) horen, in de vaste volgorde
 * van het contract: Beheer, Mijn restaurant, Mijn lijstje, Bekijk de site
 * (alleen op interne pagina's), Uitloggen. */
function resolveAccountMenuItems({ roles, pathname } = {}) {
  const items = [];
  if (hasWorkRoles(roles)) items.push({ id: 'beheer', label: ITEM_LABELS.beheer, href: BEHEER_HREF });
  if (hasRole(roles, 'owner')) {
    items.push({ id: 'mijn-restaurant', label: ITEM_LABELS['mijn-restaurant'], href: MIJN_RESTAURANT_HREF });
  }
  items.push({ id: 'mijn-lijstje', label: ITEM_LABELS['mijn-lijstje'], href: MIJN_LIJSTJE_HREF });
  if (isInternalPath(pathname)) {
    items.push({ id: 'bekijk-de-site', label: ITEM_LABELS['bekijk-de-site'], href: SITE_HREF });
  }
  items.push({ id: 'uitloggen', label: ITEM_LABELS.uitloggen, href: null });
  return items;
}

module.exports = {
  AUTH_STORAGE_PATTERN,
  BEHEER_HREF,
  MIJN_RESTAURANT_HREF,
  MIJN_LIJSTJE_HREF,
  SITE_HREF,
  hasRole,
  hasWorkRoles,
  ownerRestaurantNames,
  ownerDescription,
  resolveRoleDescriptions,
  resolveRoleDescription,
  hasSupabaseSessionKey,
  initialsFrom,
  resolveAccountName,
  accountAriaLabel,
  shouldShowDot,
  isInternalPath,
  openWorkTotal,
  resolveAccountMenuItems,
};
