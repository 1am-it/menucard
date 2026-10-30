'use strict';

// BE-47 (#111) — waar een restauranthouder binnenkomt, en waar een interne
// beheerder blijft. Eén kleine, geteste regel voor de drie schermen die hem
// nodig hebben (`/mijn-restaurant/inloggen`, `/mijn-restaurant` en `/internal`),
// zodat de doorsturing nergens een tweede, net iets andere kopie krijgt.
//
// De rollen komen uit de bestaande, onveranderde `GET /api/internal/v1/me`
// (`[{ role, restaurant_id }]`, zie src/lib/internalAuthCore.js). Deze module
// kent geen Supabase, geen React, geen netwerk en geen klok: ze classificeert
// alleen een al opgehaalde rollenlijst. Ze verleent zelf niets — elke route
// houdt zijn eigen server-side controle.
//
// De regel uit het contract (voorbeelden bij #111):
//   - `internal` of `editor` → naar `/internal/login`, want die rol heeft de
//     tweede stap uit BE-48 (wachtwoord + app). Een houder-login mag daar nooit
//     omheen lopen.
//   - alleen `owner` (eventueel meerdere restaurants) → `/mijn-restaurant`; op
//     `/internal` werd dat voorheen "Nog niets te openen" en nu dus een
//     doorsturing naar het eigen scherm.
//   - geen bekende rol → `null`: de bestaande statussen (inloggen of "geen
//     interne toegang") blijven ongewijzigd.

const OWNER_LOGIN_HREF = '/mijn-restaurant/inloggen';
const OWNER_HOME_HREF = '/mijn-restaurant';
const INTERNAL_LOGIN_HREF = '/internal/login';
// BE-54 (#133): "Claim je restaurant" gaat naar het zoekscherm, niet meer naar
// de volledige lijst /alle-restaurants. Eén bron voor beide links.
const CLAIM_SEARCH_HREF = '/mijn-restaurant/claimen';

// Dezelfde twee rollen als src/lib/internalAuthCore.js's SECOND_FACTOR_ROLES.
const SECOND_FACTOR_ROLES = Object.freeze(['internal', 'editor']);

/** Dutch text on the owner screens; no message ever says whether an account exists. */
const OWNER_ACCESS_MESSAGES = Object.freeze({
  signInTitle: 'Inloggen voor restauranthouders',
  signInIntro:
    'Vul het e-mailadres waarmee je je restaurant hebt geclaimd. Je krijgt een code van zes cijfers; daarmee log je in zonder wachtwoord.',
  codeTitle: 'Vul de code in',
  sessionExpired: 'Je sessie is verlopen. Log opnieuw in om verder te gaan.',
  internalAccount:
    'Dit account hoort bij het interne beheer. Log daar in met je wachtwoord en je code uit de authenticator-app.',
  noRestaurantYet: 'Je account is nog niet aan een restaurant gekoppeld.',
  claimRouteLabel: 'Claim je restaurant',
});

function isRoleRow(row) {
  return Boolean(row) && typeof row === 'object' && typeof row.role === 'string';
}

function roleRows(roles) {
  return Array.isArray(roles) ? roles.filter(isRoleRow) : [];
}

/** Whether this account must use the internal sign-in (second step included). */
function hasInternalRole(roles) {
  return roleRows(roles).some((row) => SECOND_FACTOR_ROLES.includes(row.role));
}

function hasOwnerRole(roles) {
  return roleRows(roles).some((row) => row.role === 'owner');
}

/** The `restaurant_id`s of this account's `owner` rows, in the order the API returned them. */
function ownerRestaurantIds(roles) {
  return roleRows(roles)
    .filter((row) => row.role === 'owner' && typeof row.restaurant_id === 'string' && row.restaurant_id)
    .map((row) => row.restaurant_id);
}

/** An owner-only account: at least one owner row, and no internal/editor role. */
function isOwnerOnly(roles) {
  return hasOwnerRole(roles) && !hasInternalRole(roles);
}

/**
 * Where the owner sign-in continues after a verified code:
 * `{ href, reason }`. An internal/editor account is sent to `/internal/login`
 * (it needs BE-48's second step); everything else continues to `/mijn-restaurant`,
 * which itself shows the honest "no restaurant yet" state when nothing is linked.
 */
function resolveOwnerEntry(roles) {
  if (hasInternalRole(roles)) return { href: INTERNAL_LOGIN_HREF, reason: 'internal-login' };
  return { href: OWNER_HOME_HREF, reason: 'owner-home' };
}

/**
 * The one addition to `/internal` (#111 criterion 5): an owner-only account is
 * sent to `/mijn-restaurant` instead of the old "Nog niets te openen" note.
 * Every other account keeps its existing behaviour, so this returns `null`.
 */
function resolveInternalOwnerRedirect(roles) {
  return isOwnerOnly(roles) ? OWNER_HOME_HREF : null;
}

module.exports = {
  CLAIM_SEARCH_HREF,
  INTERNAL_LOGIN_HREF,
  OWNER_ACCESS_MESSAGES,
  OWNER_HOME_HREF,
  OWNER_LOGIN_HREF,
  SECOND_FACTOR_ROLES,
  hasInternalRole,
  hasOwnerRole,
  isOwnerOnly,
  ownerRestaurantIds,
  resolveInternalOwnerRedirect,
  resolveOwnerEntry,
};
