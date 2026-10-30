'use strict';

// BE-47 (#111) — wat "Mijn restaurant" toont, als één geteste beslissing.
//
// De pagina haalt alleen gegevens op (`GET /api/internal/v1/me` voor de
// owner-rijen met `restaurant_id`, `GET /api/claims/mine` voor de claims) en
// rendert daarna wat deze module teruggeeft. Namen en links komen uit de
// bestaande statische data (data/restaurants.json en data/menus.json via
// src/lib/menuTabs.js); er wordt niets uit de database gelezen en niets
// geschreven.
//
// De drie claimstatussen uit het contract hebben elk hun eigen, neutrale vorm:
//   - `approved`  → een restaurantkaart met de naam, de link naar de publieke
//                    pagina en naar de menukaart, plus hoe wijzigingen nu lopen;
//   - `pending`   → "Je claim voor X wordt bekeken", zonder beheerknoppen;
//   - `rejected`  → neutrale tekst met de route om opnieuw te claimen;
//   - alles anders (een toekomstige status) → een eerlijke "onbekend"-regel en
//     géén knoppen: onbekend is nooit hetzelfde als goedgekeurd.
//
// Alles wat niet in de statische data bestaat levert géén link op (fail closed).

const CLAIM_STATUS_LABELS = Object.freeze({
  pending: 'In behandeling',
  approved: 'Goedgekeurd',
  rejected: 'Afgewezen',
  unknown: 'Onbekende status',
});

const OWNER_OVERVIEW_MESSAGES = Object.freeze({
  title: 'Mijn restaurant',
  intro:
    'Dit is je eigen overzicht. Wijzigingen aan je pagina en menukaart lopen nu via de redactie; zelf bewerken volgt in een latere stap.',
  restaurantLink: 'Bekijk je restaurantpagina',
  menuLink: 'Bekijk je menukaart',
  noMenuLink: 'Er staat nog geen menukaart online.',
  approvedNote: 'Je claim is goedgekeurd. Je bent geverifieerd als eigenaar van dit restaurant.',
  pendingNote: 'Een medewerker beoordeelt je aanvraag. Je hoeft nu niets te doen.',
  rejectedNote:
    'Je claim is niet goedgekeurd. Je kunt opnieuw een claim indienen. Klopt dit niet, neem dan contact op met de redactie.',
  unknownNote: 'Deze claim heeft een status die dit scherm nog niet kent.',
  retryClaim: 'Opnieuw claimen',
  unknownRestaurant: 'Restaurant niet gevonden in onze gegevens',
  noRestaurants: 'Je account is nog niet aan een restaurant gekoppeld.',
  noRestaurantsHelp: 'Claim je restaurant om je pagina te beheren.',
  noClaims: 'Je hebt nog geen claim ingediend.',
  signOut: 'Uitloggen',
  deleteAccount: 'Account verwijderen',
});

const CLAIM_HREF_PREFIX = '/claim/';
const RESTAURANT_HREF_PREFIX = '/restaurant/';
const MENU_HREF_PREFIX = '/menu/';

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function restaurantEntry(restaurants, restaurantId) {
  const id = text(restaurantId);
  if (!id) return null;
  const all = restaurants && typeof restaurants === 'object' ? restaurants : {};
  const entry = all[id];
  if (!entry || typeof entry !== 'object') return null;
  const name = text(entry.name);
  if (!name) return null;
  const menuIds = Array.isArray(entry.menuIds) ? entry.menuIds.filter((menuId) => text(menuId)) : [];
  return {
    id,
    name,
    restaurantHref: `${RESTAURANT_HREF_PREFIX}${encodeURIComponent(id)}`,
    menuHref: menuIds.length > 0 ? `${MENU_HREF_PREFIX}${encodeURIComponent(text(menuIds[0]))}` : null,
  };
}

/** The `restaurant_id`s of this account's owner rows, in order, without duplicates. */
function ownedRestaurantIds(roles) {
  const ids = [];
  for (const row of Array.isArray(roles) ? roles : []) {
    if (!row || row.role !== 'owner') continue;
    const id = text(row.restaurant_id);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** The `restaurant_id`s of the approved claims, in the order the API returned them. */
function approvedClaimRestaurantIds(claims) {
  const ids = [];
  for (const claim of Array.isArray(claims) ? claims : []) {
    if (!claim || claim.status !== 'approved') continue;
    const id = text(claim.restaurant_id);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function statusLabel(status) {
  return CLAIM_STATUS_LABELS[status] || CLAIM_STATUS_LABELS.unknown;
}

function claimNote(status) {
  if (status === 'approved') return OWNER_OVERVIEW_MESSAGES.approvedNote;
  if (status === 'pending') return OWNER_OVERVIEW_MESSAGES.pendingNote;
  if (status === 'rejected') return OWNER_OVERVIEW_MESSAGES.rejectedNote;
  return OWNER_OVERVIEW_MESSAGES.unknownNote;
}

/** `YYYY-MM-DD` of a valid timestamp, or `null`. Never a date invented from junk. */
function formatDate(value) {
  const raw = text(value);
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}



/**
 * Bouwt het schermmodel voor `/mijn-restaurant`.
 *
 * @param {object} input
 * @param {Array<{role?:string, restaurant_id?:string|null}>} [input.roles]  uit GET /api/internal/v1/me
 * @param {Array<object>} [input.claims]  uit GET /api/claims/mine
 * @param {object} [input.restaurants]  statische index: `{ [id]: { name, menuIds } }`
 * @returns {{restaurants: Array<object>, claims: Array<object>, empty: boolean,
 *   hasOwnerAccess: boolean, heading: string, intro: string}}
 */
function buildOwnerOverview(input) {
  const settings = input || {};
  const roles = Array.isArray(settings.roles) ? settings.roles : [];
  const claims = Array.isArray(settings.claims) ? settings.claims : [];
  const restaurants = settings.restaurants;

  const ownedIds = ownedRestaurantIds(roles);
  const approvedIds = approvedClaimRestaurantIds(claims);
  const restaurantIds = [];
  for (const id of ownedIds.concat(approvedIds)) {
    if (!restaurantIds.includes(id)) restaurantIds.push(id);
  }

  const approved = restaurantIds.map((id) => {
    const entry = restaurantEntry(restaurants, id);
    return {
      id,
      name: entry ? entry.name : null,
      known: Boolean(entry),
      unknownLabel: entry ? null : OWNER_OVERVIEW_MESSAGES.unknownRestaurant,
      restaurantHref: entry ? entry.restaurantHref : null,
      menuHref: entry ? entry.menuHref : null,
      status: 'approved',
      statusLabel: statusLabel('approved'),
      note: OWNER_OVERVIEW_MESSAGES.approvedNote,
    };
  });

  // Approved claims are shown as restaurant cards above; repeating them in the
  // claim list would show the same restaurant twice. Pending, rejected and any
  // unknown status stay in their own list, because they answer "what is
  // happening with my claim?".
  const openClaims = claims
    .filter((claim) => claim && claim.status !== 'approved')
    .map((claim) => {
      const restaurantId = text(claim.restaurant_id);
      const entry = restaurantEntry(restaurants, restaurantId);
      const status = typeof claim.status === 'string' && claim.status ? claim.status : 'unknown';
      return {
        id: claim.id == null ? null : String(claim.id),
        restaurantId,
        name: entry ? entry.name : null,
        known: Boolean(entry),
        unknownLabel: entry ? null : OWNER_OVERVIEW_MESSAGES.unknownRestaurant,
        status,
        statusLabel: statusLabel(status),
        note: claimNote(status),
        submittedOn: formatDate(claim.created_at),
        decidedOn: formatDate(claim.decided_at),
        restaurantHref: entry ? entry.restaurantHref : null,
        // Only a rejected claim offers a way forward; an unknown status does not.
        retryHref:
          status === 'rejected' && restaurantId ? `${CLAIM_HREF_PREFIX}${encodeURIComponent(restaurantId)}` : null,
        retryLabel: status === 'rejected' ? OWNER_OVERVIEW_MESSAGES.retryClaim : null,
      };
    });

  return {
    restaurants: approved,
    claims: openClaims,
    empty: approved.length === 0 && openClaims.length === 0,
    hasOwnerAccess: ownedIds.length > 0,
    heading: OWNER_OVERVIEW_MESSAGES.title,
    intro: OWNER_OVERVIEW_MESSAGES.intro,
  };
}

module.exports = {
  CLAIM_STATUS_LABELS,
  OWNER_OVERVIEW_MESSAGES,
  approvedClaimRestaurantIds,
  buildOwnerOverview,
  claimNote,
  ownedRestaurantIds,
  statusLabel,
};
