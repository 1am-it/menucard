'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  loadMenuExtractionProtocol,
  extractionReadiness,
  protocolMetadata,
  MenuExtractionProtocolError,
} = require('./menuExtractionProtocol');

function tempRoot(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-protocol-'));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(root, name), content);
  return root;
}

test('loads the pinned instruction with a stable SHA-256 and no local machine path', () => {
  const protocol = loadMenuExtractionProtocol();
  assert.equal(protocol.version, '0.2');
  assert.equal(protocol.file, 'MENU-EXTRACTION.md');
  // Pinned LF hash of the committed instruction (MENU-EXTRACTION.md v0.2).
  // The same hash is recorded in docs/guides/menu-extraction-acceptance.md and
  // docs/guides/menu-extraction-representative-set.md.
  assert.equal(protocol.hash, '15510b4c0b74fee722ac2c51a3f40aa21b03e0161ccffdcb2008f3d27350b762');
  assert.match(protocol.text, /Modelonafhankelijke extractie-instructie/);
  assert.doesNotMatch(protocol.text, /\r/);
  assert.deepEqual(Object.keys(protocolMetadata(protocol)).sort(), ['instructionFile', 'instructionHash', 'instructionVersion', 'schemaVersion']);
  assert.doesNotMatch(JSON.stringify(protocolMetadata(protocol)), /C:\\\\|Documents/);
});

test('the instruction hash is checkout-independent: CRLF and LF give the same hash', () => {
  const lf = '# MENU-EXTRACTION - Menucard\n\nStatus: CONCEPT v0.2 - test\n';
  const crlf = lf.replace(/\n/g, '\r\n');
  const hashOf = (content) => {
    const root = tempRoot({ 'MENU-EXTRACTION.md': content });
    return loadMenuExtractionProtocol({ root });
  };
  const lfProtocol = hashOf(lf);
  const crlfProtocol = hashOf(crlf);
  assert.equal(crlfProtocol.hash, lfProtocol.hash);
  assert.equal(crlfProtocol.text, lfProtocol.text);
  assert.equal(crlfProtocol.hash.length, 64);
});

test('a missing instruction fails with a concrete, non-secret reason', () => {
  const root = tempRoot({});
  assert.throws(() => loadMenuExtractionProtocol({ root }), (err) => err instanceof MenuExtractionProtocolError && err.code === 'protocol_unavailable');
});

test('an unversioned instruction is rejected instead of being treated as approved', () => {
  const root = tempRoot({ 'MENU-EXTRACTION.md': '# Menu extraction\n\nNo version here.\n' });
  assert.throws(() => loadMenuExtractionProtocol({ root }), (err) => err.code === 'protocol_unversioned');
});

test('readiness is false without explicit provider approval, even if provider variables exist', () => {
  const readiness = extractionReadiness({ env: { MENU_EXTRACTION_PROVIDER: 'x', MENU_EXTRACTION_MODEL: 'y' } });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, 'provider_not_approved');
  assert.equal(readiness.limits.maxCostEurCents, null);
});
