'use strict';

// BE-59 (#146) — de goedkope sessiecontrole, bewust in een eigen, klein bestand.
//
// De koppen van de publieke pagina's laden alleen dit bestand (via
// AccountMenuButton.js). Staat er geen Supabase-sessiesleutel in localStorage,
// dan gebeurt er verder niets: geen Supabase-client, geen accountmenu, geen
// verzoek. Zo blijft de eerste lading van een gast vrijwel gelijk.

// De opslagsleutel die de Supabase-client zelf gebruikt: `sb-<projectref>-auth-token`
// (bij grote tokens opgeknipt in `...-auth-token.0`, `.1`, ...).
const AUTH_STORAGE_PATTERN = /^sb-.+-auth-token(\.\d+)?$/;

/** Goedkope controle of er een Supabase-sessiesleutel in de opslag staat.
 * Nooit een exception naar buiten: zonder bruikbare opslag is het antwoord
 * "geen sessie" (dus een gast), precies zoals de pagina zich dan gedraagt. */
function hasSupabaseSessionKey(storage) {
  if (!storage || typeof storage !== 'object') return false;
  try {
    const length = Number(storage.length);
    if (!Number.isInteger(length) || length <= 0) return false;
    for (let index = 0; index < length; index += 1) {
      const key = storage.key(index);
      if (typeof key === 'string' && AUTH_STORAGE_PATTERN.test(key)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

module.exports = { AUTH_STORAGE_PATTERN, hasSupabaseSessionKey };
