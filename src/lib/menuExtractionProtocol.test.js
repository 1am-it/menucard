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
  assert.equal(protocol.hash.length, 64);
  assert.match(protocol.text, /Modelonafhankelijke extractie-instructie/);
  assert.deepEqual(Object.keys(protocolMetadata(protocol)).sort(), ['instructionFile', 'instructionHash', 'instructionVersion', 'schemaVersion']);
  assert.doesNotMatch(JSON.stringify(protocolMetadata(protocol)), /C:\\\\|Documents/);
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
