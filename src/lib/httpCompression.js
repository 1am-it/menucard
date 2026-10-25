// BE-28b (#68) — transport-only gzip for an existing JSON route.
//
// De responsvorm, velden en route veranderen niet: alleen een body die groot
// genoeg is en waarvan de client gzip accepteert, gaat gecomprimeerd over de
// lijn. Zo blijft de overdracht van /alle-restaurants (die de bestaande
// restaurantindex in één keer nodig heeft voor sorteren en tellen) niet
// groter dan de oude, ongecomprimeerde pagina. Geen dependency: node:zlib.
//
// Bewust CommonJS, zoals de andere src/lib-helpers: direct testbaar met
// `node --test`, importeerbaar vanuit de ESM-routehandler.

'use strict';

const { gzipSync } = require('node:zlib');

const MIN_GZIP_BYTES = 1024;

function acceptsGzip(acceptEncoding) {
  return /\bgzip\b/i.test(String(acceptEncoding || ''));
}

function encodeJson(body, acceptEncoding) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const raw = Buffer.from(text, 'utf8');
  if (raw.length >= MIN_GZIP_BYTES && acceptsGzip(acceptEncoding)) {
    return { body: gzipSync(raw), encoding: 'gzip' };
  }
  return { body: text, encoding: null };
}

module.exports = { MIN_GZIP_BYTES, acceptsGzip, encodeJson };
