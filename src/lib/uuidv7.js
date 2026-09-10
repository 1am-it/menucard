// Shared UUIDv7 generator (MARKET-05C).
//
// Functionally identical to ops/scripts/capture-market-boundary.js's own
// generateUuidV7 (written for MARKET-01/04's MarketBoundaryVersion
// capture) — extracted here as its own small, reusable module rather than
// importing across the app/ops boundary, matching this project's existing
// precedent (e.g. app/internal/import-inbox/page.js keeps its own
// hardcoded copy of ops/scripts/import-breda-osm.config.js's category
// list rather than importing it directly). ops/scripts/capture-market-boundary.js
// is intentionally left untouched — this is a new file, not a refactor of
// an existing one.
//
// Used by app/api/internal/v1/profile-drafts/route.js to generate a
// restaurant_profile_drafts.id application-side (UUIDv7, matching
// MARKET-04A's convention for identity-bearing entities like
// `markets`/`import_runs`) — never Postgres's own `gen_random_uuid()`
// (UUIDv4), per docs/api/restaurant-profile-drafts-schema.md's own
// "Open decisions" (draft id generation).

'use strict';

const crypto = require('node:crypto');

/**
 * Generates an RFC 9562-conformant UUIDv7, using only `node:crypto` — no
 * dependency. Layout (128 bits): 48-bit big-endian Unix ms timestamp,
 * 4-bit version (0111), 12-bit random `rand_a`, 2-bit variant (10),
 * 62-bit random `rand_b`.
 */
function generateUuidV7() {
  const unixTsMs = BigInt(Date.now());
  const rand = crypto.randomBytes(10); // 80 bits of entropy source

  const bytes = Buffer.alloc(16);

  // Bytes 0-5: 48-bit big-endian Unix timestamp in milliseconds.
  bytes[0] = Number((unixTsMs >> 40n) & 0xffn);
  bytes[1] = Number((unixTsMs >> 32n) & 0xffn);
  bytes[2] = Number((unixTsMs >> 24n) & 0xffn);
  bytes[3] = Number((unixTsMs >> 16n) & 0xffn);
  bytes[4] = Number((unixTsMs >> 8n) & 0xffn);
  bytes[5] = Number(unixTsMs & 0xffn);

  // Byte 6: high nibble = version (0111 = 7); low nibble = top 4 bits of rand_a.
  bytes[6] = 0x70 | (rand[0] & 0x0f);
  // Byte 7: remaining 8 bits of rand_a (12 bits total across bytes 6-7).
  bytes[7] = rand[1];

  // Byte 8: top 2 bits = variant (10, the RFC 4122/9562 variant);
  // remaining 6 bits = start of rand_b.
  bytes[8] = 0x80 | (rand[2] & 0x3f);
  // Bytes 9-15: remaining 56 bits of rand_b (62 bits total across byte 8's
  // low 6 bits + bytes 9-15).
  bytes[9] = rand[3];
  bytes[10] = rand[4];
  bytes[11] = rand[5];
  bytes[12] = rand[6];
  bytes[13] = rand[7];
  bytes[14] = rand[8];
  bytes[15] = rand[9];

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

module.exports = { generateUuidV7 };
