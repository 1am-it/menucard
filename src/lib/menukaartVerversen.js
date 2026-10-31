'use strict';

// BE-58 deel 3 (#143) — welke publieke pagina's verversen, en onder welke
// cache-tag de overlay van één restaurant hangt.
//
// De Lead besloot (31 okt) dat een goedgekeurde wijziging en een bevestiging
// meteen zichtbaar moeten zijn. De handler roept daarvoor een geïnjecteerde
// `revalidate` aan; dit bestand bepaalt de paden en de tag en heeft zelf geen
// Next.js nodig, zodat `node --test` de bedrading kan bewijzen.
//
// Bewust CommonJS, zoals de andere BE-58-modules: de serverpagina's (ESM) en
// de tests gebruiken dezelfde code.

/** De cache-tag van de overlay van precies dit restaurant (of ''). */
function overlayTag(restaurantId) {
  const id = String(restaurantId === undefined || restaurantId === null ? '' : restaurantId).trim();
  if (!id) return '';
  return `menukaart-overlay-${id}`;
}

/**
 * De twee publieke pagina's die dit restaurant tonen. Alleen bestaande
 * waarden: een ontbrekende menu-id levert geen pad `/menu/` op.
 */
function publiekePaden(context) {
  const { menuId, restaurantId } = context || {};
  const paden = [];
  const menu = String(menuId === undefined || menuId === null ? '' : menuId).trim();
  const restaurant = String(restaurantId === undefined || restaurantId === null ? '' : restaurantId).trim();
  if (menu) paden.push(`/menu/${menu}`);
  if (restaurant) paden.push(`/restaurant/${restaurant}`);
  return paden;
}

/**
 * De echte ververser: `revalidatePath` voor beide pagina's en `revalidateTag`
 * voor de overlay van dat restaurant. Next.js levert die twee functies; de
 * tests geven hun eigen nep-versies mee.
 */
function maakMenukaartVerversen({ revalidatePath, revalidateTag } = {}) {
  return function ververs(context = {}) {
    const { menuId, restaurantId } = context || {};
    for (const pad of publiekePaden({ menuId, restaurantId })) {
      if (typeof revalidatePath === 'function') revalidatePath(pad);
    }
    const tag = overlayTag(restaurantId);
    if (tag && typeof revalidateTag === 'function') revalidateTag(tag);
  };
}

module.exports = {
  maakMenukaartVerversen,
  overlayTag,
  publiekePaden,
};
