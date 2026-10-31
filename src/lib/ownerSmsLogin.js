'use strict';

// BE-66 (#162) — de sms-vlag als eigen, piepklein bestand.
//
// De vlag beslist bij het renderen of er een telefoonveld bestaat, dus die moet
// synchroon beschikbaar zijn. Tot BE-66 kwam hij uit src/lib/claimEmailCodeFlow.js,
// en daarmee kwam de hele inloglogica in de eerste lading van /inloggen. Sinds
// deze ronde laadt die logica pas bij het versturen (src/lib/ownerLoginClient.js);
// alleen deze regel blijft staan. De regel zelf is niet veranderd: uitsluitend
// `1` of `true` zet hem aan, zodat een typefout nooit een kanaal opent dat de
// eigenaar niet heeft goedgekeurd.

const SMS_LOGIN_FLAG = 'NEXT_PUBLIC_OWNER_SMS_LOGIN';

/**
 * Whether the (default off) sms login is switched on. Only the exact value `1`
 * or a boolean `true` enables it: `'0'`, `'true'`, `''` and an unset variable
 * all leave it off, so a typo can never open a channel the owner did not approve.
 */
function isSmsLoginEnabled(value) {
  return value === true || value === 1 || value === '1';
}

module.exports = { SMS_LOGIN_FLAG, isSmsLoginEnabled };
