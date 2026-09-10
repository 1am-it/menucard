'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { generateUuidV7 } = require('./uuidv7');

// Mirrors ops/scripts/capture-market-boundary.test.js's own
// "generateUuidV7 produces RFC 9562-conformant UUIDv7 values" test — same
// assertions, since this is a functionally identical, independently
// extracted copy for MARKET-05C's own use.
test('generateUuidV7 produces RFC 9562-conformant UUIDv7 values', () => {
  const samples = Array.from({ length: 200 }, () => generateUuidV7());
  const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  for (const id of samples) {
    assert.match(id, UUID_SHAPE, `not a valid UUID string: ${id}`);

    const groups = id.split('-');
    assert.equal(groups[2][0], '7', `expected version nibble 7, got ${groups[2][0]} in ${id}`);

    const variantNibble = parseInt(groups[3][0], 16);
    assert.ok(
      variantNibble >= 0b1000 && variantNibble <= 0b1011,
      `expected RFC variant bits "10xx" (nibble 8-b), got ${groups[3][0]} in ${id}`
    );
  }

  assert.equal(new Set(samples).size, samples.length, 'expected all generated UUIDs to be unique');

  const timestamps = samples.map((id) => id.replace(/-/g, '').slice(0, 12));
  const sorted = [...timestamps].sort();
  assert.deepEqual(timestamps, sorted, 'expected UUIDv7 timestamp prefixes to be non-decreasing over time');
});
