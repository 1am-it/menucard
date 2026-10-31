'use strict';

// BE-58 deel 2 (#143) — de publieke overlay als pure, geteste stap.
//
// De pagina's halen de overlay van precies één restaurant op
// (GET /api/v1/menukaart/overlay) en leggen die daarna op de statische kaart.
// Deze module doet alleen dat laatste en het lezen van het antwoord, zonder
// Supabase, zonder request en zonder clock-afhankelijkheid; daardoor is het met
// `node --test` te bewijzen dat de overlay alleen de prijs en de beschikbaarheid
// van het juiste gerecht verandert.
//
// Bewust CommonJS, zoals snelAanpassen.js: de serverpagina's (ESM) en de tests
// gebruiken dezelfde code.

const { pasOverlayToe } = require('./snelAanpassen');

const LEGE_BEVESTIGING = Object.freeze({ actief: false, label: '', datum: '', verlooptOp: null });

/** Geen wijzigingen en geen label: de pagina toont dan de statische kaart. */
function legeOverlay() {
  return { wijzigingen: [], bevestiging: LEGE_BEVESTIGING };
}

/**
 * Het antwoord van de handler (`{status, body}`) naar `{wijzigingen,
 * bevestiging}`. Alles wat geen geldig 200-antwoord is — 503 zonder migratie,
 * 401, een netwerkfout — wordt een lege overlay, nooit een fout op de pagina.
 */
function leesPubliekeOverlay(result) {
  const body = result && result.status === 200 ? result.body : null;
  if (!body || body.ok !== true) return legeOverlay();
  const bevestiging = body.bevestiging && body.bevestiging.actief === true
    ? {
        actief: true,
        label: String(body.bevestiging.label || ''),
        datum: String(body.bevestiging.datum || ''),
        verlooptOp: body.bevestiging.verlooptOp || null,
      }
    : LEGE_BEVESTIGING;
  return {
    wijzigingen: Array.isArray(body.wijzigingen) ? body.wijzigingen : [],
    bevestiging,
  };
}

/** De kaart met de overlay van precies deze menukaart erop. */
function overlayVoorMenu(menu, overlay, menuId) {
  const wijzigingen = overlay && Array.isArray(overlay.wijzigingen) ? overlay.wijzigingen : [];
  if (wijzigingen.length === 0) return menu;
  return pasOverlayToe(menu, wijzigingen, { menuId: menuId || null });
}

module.exports = {
  LEGE_BEVESTIGING,
  legeOverlay,
  leesPubliekeOverlay,
  overlayVoorMenu,
};
