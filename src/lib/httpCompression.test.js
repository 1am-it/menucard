'use strict';

// BE-28b (#68) — regressies voor de transport-only gzip-helper. De JSON zelf
// blijft byte-voor-byte gelijk na uitpakken; zonder gzip of onder de drempel
// gaat er niets door de compressor.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { gunzipSync } = require('node:zlib');
const { MIN_GZIP_BYTES, acceptsGzip, encodeJson } = require('./httpCompression');

test('acceptsGzip herkent gzip tussen andere coderingen, maar niet br of leeg', () => {
  assert.equal(acceptsGzip('gzip, deflate, br'), true);
  assert.equal(acceptsGzip('GZIP'), true);
  assert.equal(acceptsGzip('deflate, br'), false);
  assert.equal(acceptsGzip(''), false);
  assert.equal(acceptsGzip(undefined), false);
});

test('een grote JSON gaat met gzip en pakt exact hetzelfde uit', () => {
  const payload = { results: Array.from({ length: 25 }, (_, i) => ({ restaurantId: String(i), name: `Restaurant ${i}` })) };
  const text = JSON.stringify(payload);
  assert.ok(Buffer.byteLength(text) >= MIN_GZIP_BYTES);
  const encoded = encodeJson(payload, 'gzip, deflate');
  assert.equal(encoded.encoding, 'gzip');
  assert.ok(Buffer.isBuffer(encoded.body));
  assert.deepEqual(JSON.parse(gunzipSync(encoded.body).toString('utf8')), payload);
});

test('zonder gzip blijft de body leesbare JSON met dezelfde inhoud', () => {
  const payload = { results: [], total: 0 };
  const encoded = encodeJson(payload, '');
  assert.equal(encoded.encoding, null);
  assert.equal(typeof encoded.body, 'string');
  assert.deepEqual(JSON.parse(encoded.body), payload);
});

test('een kleine body wordt nooit gecomprimeerd, ook niet met gzip', () => {
  const encoded = encodeJson({ ok: true }, 'gzip');
  assert.equal(encoded.encoding, null);
  assert.equal(encoded.body, '{"ok":true}');
});
