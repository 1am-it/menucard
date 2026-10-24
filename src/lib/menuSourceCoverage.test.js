'use strict';

// X1/X5 of the Delivery Lead order 6382189724 (variant 1): the deterministic
// comparison between a captured source and the dishes of a concept. Pure
// tests: no provider, no network, no database.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_LINES,
  UNAVAILABLE_MESSAGE,
  looksLikeSectionHeading,
  nameFromLine,
  pricedLinesOfSource,
  compareCaptureWithConcept,
  itemFromPricedLine,
} = require('./menuSourceCoverage');

const SOURCE_TEXT = [
  'LUNCH',
  'Bites',
  'Broodplank 8,50',
  'Fictief glas wijn 4,50',
  'Koffie 2,80',
].join('\n');

function source(text = SOURCE_TEXT, extra = {}) {
  return { id: 'source-1', url: 'https://fictief-brasserie.invalid/menu', kind: 'html', hasText: true, text, ...extra };
}

function item(name, quote, sourceId = 'source-1') {
  return { name, evidence: { sourceId, locator: 'regel 1', quote } };
}

function menuWith(items) {
  return [{ title: 'Lunch', sourceId: 'source-1', categories: [{ name: 'Bites', items }] }];
}

test('X1: een gedekte regel verschijnt niet, een ongedekte regel wel met bron en regelnummer', () => {
  const result = compareCaptureWithConcept({
    sources: [source()],
    menus: menuWith([item('Broodplank', 'Broodplank 8,50'), item('Koffie', 'Koffie 2,80')]),
  });
  assert.equal(result.available, true);
  assert.equal(result.total, 1);
  assert.equal(result.lines.length, 1);
  const line = result.lines[0];
  assert.equal(line.id, 'source-1:4');
  assert.equal(line.text, 'Fictief glas wijn 4,50');
  assert.equal(line.sourceId, 'source-1');
  assert.equal(line.lineNumber, 4);
  assert.equal(line.section, 'Bites');
  assert.equal(line.locator, 'regel 4');
  assert.equal(line.sourceLabel, 'source-1 · website');
  assert.equal(line.priceText, '4,50');
  assert.equal(line.amountMinorUnits, 450);
});

test('X1: een citaat dat de regel gedeeltelijk of ruimer dekt telt als gedekt', () => {
  const partial = compareCaptureWithConcept({
    sources: [source()],
    // The dish quotes only the name; the price came from the same line.
    menus: menuWith([item('Broodplank', 'Broodplank'), item('Fictief glas wijn', 'Fictief glas wijn'), item('Koffie', 'Koffie')]),
  });
  assert.equal(partial.total, 0, JSON.stringify(partial.lines));
  const wider = compareCaptureWithConcept({
    sources: [source()],
    menus: menuWith([item('Broodplank', 'Bites\nBroodplank 8,50'), item('Fictief glas wijn', 'Fictief glas wijn 4,50'), item('Koffie', 'Koffie 2,80')]),
  });
  assert.equal(wider.total, 0, JSON.stringify(wider.lines));
});

test('X1: typografische tekens volgen de bestaande normalisatie, geen tweede regel', () => {
  const text = ['Warm', 'Café “de Hoek” – 4,50'].join('\n');
  const result = compareCaptureWithConcept({
    sources: [source(text)],
    menus: menuWith([item('Café "de Hoek" - 4,50', 'Café "de Hoek" - 4,50')]),
  });
  assert.equal(result.total, 0, JSON.stringify(result.lines));
  const uncovered = compareCaptureWithConcept({ sources: [source(text)], menus: menuWith([]) });
  assert.equal(uncovered.total, 1);
  assert.equal(uncovered.lines[0].text, 'Café “de Hoek” – 4,50');
});

test('X1/X5: een regel zonder prijs en een hoeveelheid zoals 0,75 L zijn geen gerechtregel', () => {
  const text = ['Wijnen', 'Onze wijnen komen uit de streek.', 'Fles wijn 0,75 L 24,00'].join('\n');
  const result = compareCaptureWithConcept({ sources: [source(text)], menus: menuWith([]) });
  assert.equal(result.total, 1, JSON.stringify(result.lines));
  assert.equal(result.lines[0].text, 'Fles wijn 0,75 L 24,00');
  assert.equal(result.lines[0].priceText, '24,00');
});

test('X1: rejected regels en arrangementen gelden als verantwoord', () => {
  const text = ['LUNCH', 'Soep van de dag 6,50', '3-gangen arrangement 32,50'].join('\n');
  const result = compareCaptureWithConcept({
    sources: [source(text)],
    menus: menuWith([item('3-gangen arrangement', '3-gangen arrangement 32,50')]),
    rejected: [{ sourceId: 'source-1', locator: 'regel 2', reason: 'not_menu', text: 'Soep van de dag 6,50' }],
  });
  assert.equal(result.total, 0, JSON.stringify(result.lines));
});

test('X1: een regel die een mens "Geen gerecht" gaf, komt niet terug', () => {
  const accounted = [{ sourceId: 'source-1', lineNumber: 4, text: 'Fictief glas wijn 4,50' }];
  const byLine = compareCaptureWithConcept({ sources: [source()], menus: menuWith([]), accounted });
  assert.equal(byLine.total, 2, JSON.stringify(byLine.lines));
  assert.equal(byLine.lines.some((line) => line.text === 'Fictief glas wijn 4,50'), false);
  // Only the text was kept: the same line still stays away.
  const byText = compareCaptureWithConcept({
    sources: [source()],
    menus: menuWith([]),
    accounted: [{ sourceId: 'source-1', text: 'Fictief glas wijn 4,50' }],
  });
  assert.equal(byText.lines.some((line) => line.text === 'Fictief glas wijn 4,50'), false);
});

test('X1: de lijst is begrensd op 100 regels met een eerlijke "en nog N"', () => {
  const text = Array.from({ length: MAX_LINES + 25 }, (_value, index) => `Gerecht ${index + 1} 12,50`).join('\n');
  const result = compareCaptureWithConcept({ sources: [source(text)], menus: menuWith([]) });
  assert.equal(result.total, MAX_LINES + 25);
  assert.equal(result.shown, MAX_LINES);
  assert.equal(result.omitted, 25);
  assert.equal(result.omittedLabel, 'en nog 25');
});

test('X2: een bron zonder tekst geeft "Vergelijking niet beschikbaar", nooit nul regels', () => {
  const result = compareCaptureWithConcept({
    sources: [{ id: 'source-1', url: 'https://fictief.invalid/menu', kind: 'pdf', hasText: false, text: '' }],
    menus: menuWith([]),
  });
  assert.equal(result.available, false);
  assert.equal(result.reason, 'capture_unavailable');
  assert.equal(result.message, UNAVAILABLE_MESSAGE);
  assert.deepEqual(result.lines, []);
  assert.equal(result.total, 0);
  const none = compareCaptureWithConcept({ sources: [], menus: menuWith([]) });
  assert.equal(none.available, false);
  assert.equal(none.message, UNAVAILABLE_MESSAGE);
});

test('X1: de dichtstbijzijnde rubriekkop wordt per regel bepaald', () => {
  const text = ['LUNCH', 'Bites', 'Broodplank 8,50', 'Diner', 'Steak 22,00'].join('\n');
  const result = compareCaptureWithConcept({ sources: [source(text)], menus: menuWith([]) });
  assert.deepEqual(
    result.lines.map((line) => [line.text, line.section]),
    [
      ['Broodplank 8,50', 'Bites'],
      ['Steak 22,00', 'Diner'],
    ],
  );
});

test('X1: rubriekkoppen en namen zijn herkenbaar zonder een nieuwe prijsfamilie', () => {
  assert.equal(looksLikeSectionHeading('LUNCH'), true);
  assert.equal(looksLikeSectionHeading('Small bites'), true);
  assert.equal(looksLikeSectionHeading('Onze wijnen komen uit de streek.'), false);
  assert.equal(looksLikeSectionHeading('Broodplank 8,50'), false);
  assert.equal(nameFromLine('Broodplank 8,50', [{ index: 11, length: 4 }]), 'Broodplank');
  assert.equal(nameFromLine('Broodplank ........ 8,50', [{ index: 20, length: 4 }]), 'Broodplank');
});

test('X3: Toevoegen maakt een item met de regel zelf als citaat; twee prijzen blijven twee prijzen', () => {
  const one = itemFromPricedLine({ text: 'Broodplank 8,50', sourceId: 'source-1', lineNumber: 3 });
  assert.equal(one.ok, true);
  assert.equal(one.item.name, 'Broodplank');
  assert.equal(one.item.priceStatus, 'known');
  assert.equal(one.item.amountMinorUnits, 850);
  assert.deepEqual(one.item.evidence, { sourceId: 'source-1', locator: 'regel 3', quote: 'Broodplank 8,50' });
  const two = itemFromPricedLine({ text: 'Fictief glas wijn 4,50 / 24,00', sourceId: 'source-1', lineNumber: 4 });
  assert.equal(two.ok, true);
  assert.equal(two.item.priceStatus, 'multiple_undecomposed');
  assert.deepEqual(two.item.priceVariants.map((variant) => variant.amountMinorUnits), [450, 2400]);
  assert.equal(itemFromPricedLine({ text: 'Geen prijs hier', sourceId: 'source-1', lineNumber: 1 }).ok, false);
});

