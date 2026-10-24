'use strict';

// BE-25 fase 2 (#59, Delivery Lead review 6309694854) — de idempotentiesleutel
// van één bronbevestiging.
//
// Een bevestiging maakt precies één BE-24-voorstel aan en accepteert het
// daarna. Twee identieke aanvragen (dubbel geklikt, twee tabbladen of echt
// gelijktijdig) mogen nooit twee geaccepteerde voorstellen en twee
// `accepted`-events opleveren. In plaats van een nieuwe uniciteitsconstraint
// gebruikt deze module de bestaande primaire sleutel van
// `source_triage_proposals`: het voorstel-ID is deterministisch afgeleid van
// het opgeslagen analyseresultaat (job, restaurant en gevonden URL). De
// tweede insert botst dan op de PK; 0015 vertaalt die botsing al naar P0030
// en de handler geeft een expliciete reden terug. Geen schemawijziging en
// geen versoepeling.
//
// Het resultaat is een RFC 9562-vormige UUID met versie 8 (custom): SHA-256
// over de drie velden, 16 bytes, versie- en variantbits gezet. Versie 8 is
// bewust gekozen: dit is geen naamgebaseerde v5 (SHA-1) en ook geen
// tijdgebaseerde v7. Alle bestaande voorstel-ID's in dit project zijn UUIDv7,
// dus een afgeleide v8 kan nooit met een bestaand, ongerelateerd voorstel
// botsen.

const crypto = require('node:crypto');

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The stable proposal id of one confirmation of one stored result.
 * The same (jobId, restaurantId, url) always yields the same UUID; any of the
 * three changing yields a different one, so a new analysis can be confirmed
 * again while a retry of the same result cannot.
 */
function confirmationProposalId({ jobId, restaurantId, url } = {}) {
  for (const [name, value] of Object.entries({ jobId, restaurantId, url })) {
    if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`confirmationProposalId: ${name} is required`);
  }
  const digest = crypto
    .createHash('sha256')
    .update(`menucard/source-confirmation/v1\n${jobId.trim()}\n${restaurantId.trim()}\n${url.trim()}`)
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  // Version 8 (custom) and the RFC 4122/9562 variant "10".
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  if (!UUID_SHAPE.test(id)) throw new Error('confirmationProposalId: derived value is not a UUID');
  return id;
}

module.exports = { confirmationProposalId };
