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
  assert.equal(protocol.version, '0.4');
  assert.equal(protocol.file, 'MENU-EXTRACTION.md');
  // Pinned LF hash of the committed instruction (MENU-EXTRACTION.md v0.4).
  // The same hash is recorded in docs/guides/menu-extraction-acceptance.md and
  // docs/guides/menu-extraction-representative-set.md.
  assert.equal(protocol.hash, 'ccbc4c03124cb3be8201d24b0a97ed41d962c2415339cf2c295658cca6e310f4');
  assert.match(protocol.text, /Modelonafhankelijke extractie-instructie/);
  // Q3 of review 6375125413: the citation rule is part of the shared protocol,
  // for every model the same. Removing it must fail a test, not only a review.
  assert.match(protocol.text, /aaneengesloten, letterlijke/);
  assert.match(protocol.text, /Voeg nooit regels samen/);
  assert.match(protocol.text, /Voeg nooit een scheidingsteken toe/);
  // S1/S2/S3 of review 6376108648: the three round rules are pinned text too.
  assert.match(protocol.text, /Neem `sourceId` letterlijk over uit de bronkop/);
  assert.match(protocol.text, /smelt-01\.BRON/);
  // S2: the equivalence is named as a character-class rule, not a free pass.
  assert.match(protocol.text, /uitsluitend typografische tekenvarianten/);
  assert.match(protocol.text, /Elk ander verschil blijft fout/);
  // S3: the one allowed combination for multiple printed prices, plus a fault
  // example, so the rule cannot be read as "pick one price".
  assert.match(protocol.text, /`priceStatus` `multiple_undecomposed`/);
  assert.match(protocol.text, /De backend keurt zo'n combinatie af en de adapter repareert geen prijzen/);
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
