'use strict';

// X1/X5 of the Delivery Lead order 6382189724 (variant 1): the deterministic
// comparison between a captured source and the dishes of a concept. Pure
// tests: no provider, no network, no database.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_LINES,
  UNAVAILABLE_MESSAGE,
  analyseCapture,
  looksLikeSectionHeading,
  nameFromLine,
  pricedLinesOfSource,
  sourceTextLines,
  compareCaptureWithConcept,
  itemFromPricedLine,
} = require('./menuSourceCoverage');
const { quoteIsPresentInSource } = require('./menuExtractionSchema');

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

test('X1: een platgeslagen bronregel levert per geprinte prijs een regel met de cel ervoor als naam', () => {
  const text =
    'Formule du Jour     2 gangen voor- en hoofdgerecht of hoofdgerecht en dessert   €45,00    3 gangen voor-, hoofdgerecht en dessert   €55,00      ' +
    'Brioches    Entrecôte zwarte knoflook   €21,50    Jamón Ibérico  €19,50 ' +
    'x'.repeat(400);
  const result = compareCaptureWithConcept({ sources: [source(text)], menus: menuWith([]) });
  assert.equal(result.available, true);
  assert.deepEqual(
    result.lines.map((line) => [line.id, line.name, line.priceText]),
    [
      ['source-1:1:1', '2 gangen voor- en hoofdgerecht of hoofdgerecht en dessert', '€45,00'],
      ['source-1:1:2', '3 gangen voor-, hoofdgerecht en dessert', '€55,00'],
      ['source-1:1:3', 'Entrecôte zwarte knoflook', '€21,50'],
      ['source-1:1:4', 'Jamón Ibérico', '€19,50'],
    ],
  );
  assert.equal(result.lines[0].locator, 'regel 1, deel 1');
  // The citation of a fragment is present under the validator's normalization.
  assert.equal(quoteIsPresentInSource(result.lines[2].text, text), true);
  assert.deepEqual(result.lines.map((line) => line.section), ['Formule du Jour', 'Formule du Jour', 'Brioches', 'Brioches']);
});

test('Z1: een prijs op een eigen regel hoort bij de naamregel erboven en telt als één regel', () => {
  const text = ['DINER', 'Voorgerechten', 'Fictieve carpaccio', '11,00', 'Fictieve steak 24,50'].join('\n');
  const records = pricedLinesOfSource(source(text));
  assert.equal(records.length, 2);
  const pair = records[0];
  assert.equal(pair.paired, true);
  assert.equal(pair.lineNumber, 4);
  assert.equal(pair.nameLineNumber, 3);
  assert.equal(pair.name, 'Fictieve carpaccio');
  assert.equal(pair.text, 'Fictieve carpaccio 11,00');
  assert.equal(pair.priceText, '11,00');
  assert.equal(pair.amountMinorUnits, 1100);
  assert.equal(pair.section, 'Voorgerechten');
  // The pair is covered by a citation of the name line or of the price line.
  const byName = compareCaptureWithConcept({
    sources: [source(text)],
    menus: menuWith([item('Fictieve carpaccio', 'Fictieve carpaccio'), item('Fictieve steak', 'Fictieve steak 24,50')]),
  });
  assert.equal(byName.total, 0, JSON.stringify(byName.lines));
  const byPrice = compareCaptureWithConcept({
    sources: [source(text)],
    menus: menuWith([item('Fictieve carpaccio', 'Voorgerechten\nFictieve carpaccio\n11,00'), item('Fictieve steak', 'Fictieve steak 24,50')]),
  });
  assert.equal(byPrice.total, 0, JSON.stringify(byPrice.lines));
  // Without a dish the pair is one uncovered line of its own section.
  const uncovered = compareCaptureWithConcept({ sources: [source(text)], menus: menuWith([]) });
  assert.deepEqual(
    uncovered.lines.map((line) => [line.id, line.text, line.locator, line.section]),
    [
      ['source-1:4', 'Fictieve carpaccio 11,00', 'regels 3–4', 'Voorgerechten'],
      ['source-1:5', 'Fictieve steak 24,50', 'regel 5', 'Voorgerechten'],
    ],
  );
});

test('Z1: een prijsregel verder dan twee regels terug wordt niet gekoppeld', () => {
  const text = ['Diner', 'Fictieve carpaccio', '—', '—', '—', '11,00'].join('\n');
  const records = pricedLinesOfSource(source(text));
  assert.equal(records.length, 1);
  assert.equal(records[0].paired, false);
  assert.equal(records[0].loose, true);
  assert.equal(records[0].name, null);
  assert.equal(records[0].text, '11,00');
  assert.equal(records[0].lineNumber, 6);
});

test('Z1: een rubriekkop tussen naam en prijs verbreekt de koppeling', () => {
  const text = ['Diner', 'Fictieve carpaccio', 'Hoofdgerechten', '—', '11,00'].join('\n');
  const records = pricedLinesOfSource(source(text));
  assert.equal(records.length, 1);
  assert.equal(records[0].paired, false);
  assert.equal(records[0].loose, true);
  assert.equal(records[0].section, 'Hoofdgerechten');
  // The name line above belongs to the previous section and is never reused.
  const result = compareCaptureWithConcept({ sources: [source(text)], menus: menuWith([item('Fictieve carpaccio', 'Fictieve carpaccio')]) });
  assert.deepEqual(result.lines.map((line) => line.text), ['11,00']);
});

test('Z1: een kop direct boven een prijs is de naam van die prijs, niet de rubriek', () => {
  const text = ['DINER', 'Hoofdgerechten', 'Fictieve steak', '24,50', 'Fictieve carpaccio', '11,00'].join('\n');
  const records = pricedLinesOfSource(source(text));
  assert.deepEqual(
    records.map((record) => [record.text, record.paired, record.section]),
    [
      ['Fictieve steak 24,50', true, 'Hoofdgerechten'],
      ['Fictieve carpaccio 11,00', true, 'Hoofdgerechten'],
    ],
  );
});

test('Z1: onduidelijk blijft los — geen tweede prijs gekoppeld, geen hergebruikte naam', () => {
  const text = ['Diner', 'Fictieve carpaccio', '11,00', '12,00', 'Steak van de grill.', '—', '24,50'].join('\n');
  const records = pricedLinesOfSource(source(text));
  assert.deepEqual(
    records.map((record) => [record.lineNumber, record.paired, record.loose, record.text]),
    [
      [3, true, false, 'Fictieve carpaccio 11,00'],
      // The name above is already used: this price stays loose.
      [4, false, true, '12,00'],
      // The decorative "—" is skipped, so the name two lines back is used.
      [7, true, false, 'Steak van de grill. 24,50'],
    ],
  );
  const twoPrices = pricedLinesOfSource(source(['Diner', 'Fictieve carpaccio', '11,00 12,00'].join('\n')));
  assert.equal(twoPrices.length, 1);
  assert.equal(twoPrices[0].paired, false);
  assert.equal(twoPrices[0].loose, true);
});

test('Z1: een form feed is een paginagrens en verandert de regelnummers niet', () => {
  const text = ['Diner', 'Fictieve carpaccio', '11,00', 'Hoofdgerechten', 'Fictieve steak', '24,50'].join('\n');
  const paged = text.replace('Hoofdgerechten', '\fHoofdgerechten');
  const lines = sourceTextLines(source(paged));
  assert.equal(lines.pageCount, 2);
  assert.deepEqual(
    lines.lines.map((line) => [line.number, line.page]),
    [
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 2],
      [5, 2],
      [6, 2],
    ],
  );
  const records = pricedLinesOfSource(source(paged));
  assert.deepEqual(
    records.map((record) => [record.text, record.page]),
    [
      ['Fictieve carpaccio 11,00', 1],
      ['Fictieve steak 24,50', 2],
    ],
  );
});

test('Z2: de kaart onderscheidt overgenomen, afwijkende prijs, niet overgenomen en geen gerecht', () => {
  const text = ['Diner', 'Voorgerechten', 'Soep 6,50', 'Carpaccio 11,00', 'Steak 24,50', 'Friet 3,50'].join('\n');
  const menus = menuWith([
    item('Soep', 'Soep 6,50'),
    // Covered, but the concept prints another price: red.
    { name: 'Carpaccio', priceStatus: 'known', amountMinorUnits: 1250, currency: 'EUR', evidence: { sourceId: 'source-1', locator: 'regel 4', quote: 'Carpaccio 11,00' } },
    // Covered, two printed prices, one of them the dish price: green.
    {
      name: 'Steak',
      priceStatus: 'multiple_undecomposed',
      priceVariants: [
        { label: 'Glas', amountMinorUnits: 2450, currency: 'EUR' },
        { label: 'Fles', amountMinorUnits: 4800, currency: 'EUR' },
      ],
      evidence: { sourceId: 'source-1', locator: 'regel 5', quote: 'Steak 24,50' },
    },
  ]);
  const analysis = analyseCapture({ sources: [source(text)], menus, rejected: [{ sourceId: 'source-1', text: 'Friet 3,50', reason: 'not_a_dish' }] });
  assert.deepEqual(
    analysis.sources[0].records.map((record) => [record.text, record.tone, record.dish ? record.dish.rowId : null]),
    [
      ['Soep 6,50', 'covered', '0.0.0'],
      ['Carpaccio 11,00', 'price_mismatch', '0.0.1'],
      ['Steak 24,50', 'covered', '0.0.2'],
      ['Friet 3,50', 'not_dish', null],
    ],
  );
  // An earlier human "Geen gerecht" is accounted, never asked again.
  const accounted = analyseCapture({ sources: [source(text)], menus: [], accounted: [{ sourceId: 'source-1', lineNumber: 6, text: 'Friet 3,50' }] });
  assert.equal(accounted.sources[0].records.find((record) => record.text === 'Friet 3,50').tone, 'not_dish');
  // A dish without a price is taken over; it is not a different price.
  const unpriced = analyseCapture({
    sources: [source(text)],
    menus: menuWith([{ name: 'Soep', priceStatus: 'unknown', evidence: { sourceId: 'source-1', locator: 'regel 3', quote: 'Soep 6,50' } }]),
  });
  assert.equal(unpriced.sources[0].records[0].tone, 'covered');
});

test('Z1/X3: Toevoegen op een paar citeert beide geprinte regels', () => {
  const text = ['Diner', 'Fictieve carpaccio', '11,00'].join('\n');
  const pair = compareCaptureWithConcept({ sources: [source(text)], menus: menuWith([]) }).lines[0];
  const built = itemFromPricedLine(pair);
  assert.equal(built.ok, true);
  assert.equal(built.item.name, 'Fictieve carpaccio');
  assert.equal(built.item.amountMinorUnits, 1100);
  assert.equal(built.item.evidence.locator, 'regels 2–3');
  assert.equal(built.item.evidence.quote, 'Fictieve carpaccio 11,00');
  assert.equal(quoteIsPresentInSource(built.item.evidence.quote, text), true);
  // A loose price line has no name: adding it is refused, never invented.
  const loose = compareCaptureWithConcept({ sources: [source('11,00')], menus: menuWith([]) }).lines[0];
  assert.equal(loose.loose, true);
  assert.equal(itemFromPricedLine(loose).ok, false);
  assert.equal(itemFromPricedLine(loose).code, 'line_without_name');
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


// ─── AA1: whole euros in the comparison (Lead review 6383853638) ────────────

test('AA1: twee hele-getalprijzen in dezelfde rubriek tellen als prijsregels', () => {
  const text = ['FICTIEF DINER', 'Voorgerechten', 'Fictieve zeebaars 34    geschroeid | venkel', 'Fictieve bisque 12    van rivierkreeft'].join('\n');
  const result = compareCaptureWithConcept({ sources: [source(text)], menus: menuWith([]) });
  assert.equal(result.available, true);
  assert.equal(result.total, 2);
  assert.deepEqual(result.lines.map((line) => [line.name, line.amountMinorUnits]), [
    ['Fictieve zeebaars', 3400],
    ['Fictieve bisque', 1200],
  ]);
  assert.equal(result.lines[0].priceText, '34');
  assert.equal(result.lines[0].section, 'Voorgerechten');
});

test('AA1: één los heel getal in zijn eigen rubriek blijft een gewoon getal', () => {
  const text = ['Fictief', 'Wijnkaart', 'Fictieve huiswijn 24'].join('\n');
  const records = pricedLinesOfSource(source(text));
  assert.deepEqual(records, []);
  const result = compareCaptureWithConcept({ sources: [source(text)], menus: menuWith([]) });
  assert.equal(result.total, 0);
});

test('AA1: een samengevouwen rij met meerdere hele-getalprijzen is één prijskolom', () => {
  // De vorm van de gepinde Wolfslaar-capture: één lange regel met de cellen van
  // de kaart, elk met naam en hele-getalprijs (de capture vouwt de kolommen).
  const row = [
    'Fictieve heilbot 32    gebakken in boerenboter | zeewier | sjalot | escabeche | venkel | citroenolie | dille',
    'Fictieve zeebaars 34    geschroeid | oester | shiitake | kombucha | dashi | lente-ui | sesam | koriander',
    'Fictieve krab 38   als cocktail geserveerd | struikselderij | granny Smith | piment d espelette | mierikswortel',
  ].join('     ');
  assert.ok(row.length > 300, 'de regel moet de samengevouwen vorm hebben');
  const text = ['FICTIEF DINER', 'Voorgerechten', row].join('\n');
  const records = pricedLinesOfSource(source(text)).filter((record) => record.wholeEuro);
  assert.deepEqual(records.map((record) => [record.name, record.amountMinorUnits]), [
    ['Fictieve heilbot', 3200],
    ['Fictieve zeebaars', 3400],
    ['Fictieve krab', 3800],
  ]);
});

test('AA1: Toevoegen op een hele-getalprijs gebruikt de geprinte prijs', () => {
  const text = ['FICTIEF DINER', 'Voorgerechten', 'Fictieve zeebaars 34    geschroeid | venkel', 'Fictieve bisque 12    van rivierkreeft'].join('\n');
  const lines = compareCaptureWithConcept({ sources: [source(text)], menus: menuWith([]) }).lines;
  const built = itemFromPricedLine(lines[0]);
  assert.equal(built.ok, true);
  assert.equal(built.item.name, 'Fictieve zeebaars');
  assert.equal(built.item.priceStatus, 'known');
  assert.equal(built.item.amountMinorUnits, 3400);
  assert.equal(quoteIsPresentInSource(built.item.evidence.quote, text), true);
});

