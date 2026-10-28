'use strict';

// BE-36 (#87) — the pure part of the page-by-page reading. No network, no AI:
// the plan, the repair, the merge, the coverage and the sentences are proven
// directly, so a failure points at one rule instead of at a fixture.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_CONCURRENT_PAGES,
  PAGE_MAX_OUTPUT_TOKENS,
  mergeReadingOutputs,
  mergedCoverage,
  pageFailure,
  publicUnit,
  readingCostPlan,
  readingUnits,
  repairPageOutput,
  retryUnits,
  unitLimits,
  unitSource,
} = require('./menuReadingPages');
const { describeNormalizations } = require('./menuExtractionNormalization');
const schema = require('./menuExtractionSchema');

function image(n) {
  return { url: `https://voorbeeld.example/kaart-${n}.jpg`, mediaType: 'image/jpeg', data: 'AAAA', number: n };
}

function item(name, amount, locator) {
  return {
    name,
    priceStatus: 'known',
    amountMinorUnits: amount,
    currency: 'EUR',
    evidence: { sourceId: 'source-1', locator, quote: name },
  };
}

test('BE-36: een lezing wordt per afbeelding en per pagina genummerd, met eigen herkomst', () => {
  const plan = { sources: [{ id: 'source-1', mode: 'image', imageCount: 3 }, { id: 'source-2', mode: 'text' }] };
  const sources = [
    { id: 'source-1', url: 'https://voorbeeld.example/menu', kind: 'image', images: [image(1), image(2), image(3)] },
    { id: 'source-2', url: 'https://voorbeeld.example/lunch', kind: 'html', text: 'Soep 4,00\nBrood 3,00\nBier 2,50' },
  ];
  const units = readingUnits(plan, sources);
  assert.equal(units.length, 4);
  assert.deepEqual(units.map((unit) => unit.locator), ['afbeelding 1', 'afbeelding 2', 'afbeelding 3', 'tekst 4']);
  assert.deepEqual(units.map((unit) => unit.label), ['Pagina 1', 'Pagina 2', 'Pagina 3', 'De tekst']);
  assert.equal(MAX_CONCURRENT_PAGES, 2);
  // One call carries exactly one page.
  const sent = unitSource(units[1]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].images.length, 1);
  assert.equal(sent[0].images[0].number, 2);
  assert.equal(unitSource(units[3])[0].text.startsWith('Soep'), true);
  assert.equal(unitLimits(units[1]).maxOutputTokens, PAGE_MAX_OUTPUT_TOKENS);
  assert.equal(unitLimits(units[1]).maxPages, 1);
  // A text source keeps the ceiling it always had: a long text menu is one page
  // and must not be narrowed to an image page's budget.
  assert.equal(unitLimits(units[3], { maxOutputTokens: 10_000, maxPages: 10 }).maxOutputTokens, 10_000);
  assert.equal(unitLimits(units[3], { maxOutputTokens: 10_000, maxPages: 10 }).maxPages, 10);
});

test('BE-36: een scan blijft een document en krijgt ruimte per pagina', () => {
  const plan = { sources: [{ id: 'source-1', mode: 'document', pageCount: 2 }] };
  const sources = [{ id: 'source-1', url: 'https://voorbeeld.example/scan.pdf', kind: 'pdf', documentBase64: 'AAAA', pageCount: 2 }];
  const units = readingUnits(plan, sources);
  assert.equal(units.length, 1);
  assert.equal(units[0].kind, 'document');
  const limits = unitLimits(units[0]);
  assert.equal(limits.maxPages, 2);
  assert.equal(limits.maxOutputTokens, PAGE_MAX_OUTPUT_TOKENS * 2);
  assert.equal(unitSource(units[0])[0].documentBase64, 'AAAA');
});

test('BE-36: een afwijkende herkomst en een ontbrekende prijs worden gerepareerd, niet geweigerd', () => {
  const unit = { number: 2, kind: 'image', sourceId: 'source-1', locator: 'afbeelding 2', label: 'Pagina 2' };
  const output = {
    menus: [{
      title: 'Menukaart',
      sourceId: 'bron-verkeerd',
      categories: [{
        name: 'Pasta',
        items: [
          { name: 'Lasagne', priceStatus: 'known', amountMinorUnits: 1200, currency: 'EUR', evidence: { sourceId: 'bron-verkeerd', locator: 'regel 3', quote: 'Lasagne 12,00' } },
          { name: 'Pizza', priceStatus: 'known', evidence: { sourceId: 'source-1', locator: 'afbeelding 2', quote: 'Pizza' } },
        ],
      }],
    }],
    rejected: [],
    coverage: { status: 'complete', sourcesRead: 5, pagesRead: 9, itemsExtracted: 7, unreadSources: [], limitations: [] },
  };
  const repaired = repairPageOutput(output, unit);
  // The strict validator still decides, and its answer is: usable.
  assert.deepEqual(schema.validateStructuredOutput(repaired.output, [{ id: 'source-1', kind: 'image', imageRead: true }]), []);
  const items = repaired.output.menus[0].categories[0].items;
  assert.equal(items[0].evidence.locator, 'afbeelding 2');
  assert.equal(items[0].evidence.sourceId, 'source-1');
  // A missing price becomes the existing "price unknown" review point; nothing
  // is invented.
  assert.equal(items[1].priceStatus, 'unknown');
  assert.equal(items[1].amountMinorUnits, undefined);
  // The repairs are readable sentences, not silent changes.
  const notices = describeNormalizations(repaired.repairs);
  assert.ok(notices.some((notice) => /Herkomst aangevuld/.test(notice)));
  assert.ok(notices.some((notice) => /ontbrekende prijs/i.test(notice)));
  // The bookkeeping of one page is derived, not trusted.
  assert.equal(repaired.output.coverage.itemsExtracted, 2);
  assert.equal(repaired.output.coverage.pagesRead, 1);
});

test('BE-36: een gerecht zonder naam blijft een echte afkeuring', () => {
  const unit = { number: 1, kind: 'image', sourceId: 'source-1', locator: 'afbeelding 1' };
  const output = {
    menus: [{ title: 'Menukaart', sourceId: 'source-1', categories: [{ name: 'Pasta', items: [item('', 1200, 'afbeelding 1')] }] }],
    rejected: [],
    coverage: { status: 'complete', sourcesRead: 1, pagesRead: 1, itemsExtracted: 1, unreadSources: [], limitations: [] },
  };
  const repaired = repairPageOutput(output, unit);
  const problems = schema.validateStructuredOutput(repaired.output, [{ id: 'source-1', kind: 'image', imageRead: true }]);
  assert.ok(problems.some((problem) => /name/.test(problem)));
});

test('BE-36: pagina\'s worden samengevoegd en een gerecht op de paginagrens telt één keer', () => {
  const pageOne = {
    menus: [{
      title: 'Menukaart',
      sourceId: 'source-1',
      categories: [
        { name: 'Pasta', items: [item('Lasagne', 1200, 'afbeelding 1'), item('Pizza', 900, 'afbeelding 1')] },
        { name: 'Dolci', items: [item('Tiramisu', 700, 'afbeelding 1')] },
      ],
    }],
    rejected: [],
  };
  const pageTwo = {
    menus: [{
      title: 'menukaart',
      sourceId: 'source-1',
      categories: [
        { name: 'Pasta', items: [item('Pizza', 900, 'afbeelding 2'), item('Risotto', 1400, 'afbeelding 2')] },
        { name: 'Dolci', items: [item('Panna cotta', 750, 'afbeelding 2')] },
      ],
    }],
    rejected: [],
  };
  const merged = mergeReadingOutputs([
    { unit: { number: 1, sourceId: 'source-1' }, output: pageOne },
    { unit: { number: 2, sourceId: 'source-1' }, output: pageTwo },
  ]);
  assert.equal(merged.menus.length, 1, 'the same menu title is one menu');
  assert.deepEqual(merged.menus[0].categories.map((category) => category.name), ['Pasta', 'Dolci']);
  assert.deepEqual(merged.menus[0].categories[0].items.map((entry) => entry.name), ['Lasagne', 'Pizza', 'Risotto']);
  assert.deepEqual(merged.duplicates, [{ name: 'Pizza', page: 2, firstPage: 1 }]);
  // The origin of every dish is still its own page.
  assert.deepEqual(
    merged.menus[0].categories[0].items.map((entry) => entry.evidence.locator),
    ['afbeelding 1', 'afbeelding 1', 'afbeelding 2'],
  );
  // A legitimate repetition inside one page is not a duplicate.
  const twice = mergeReadingOutputs([{ unit: { number: 1, sourceId: 'source-1' }, output: { menus: [{ title: 'Kaart', sourceId: 'source-1', categories: [{ name: 'Pasta', items: [item('Pizza', 900, 'afbeelding 1'), item('Pizza', 900, 'afbeelding 1')] }] }], rejected: [] } }]);
  assert.equal(twice.menus[0].categories[0].items.length, 2);
  assert.deepEqual(twice.duplicates, []);
});

test('BE-36: de dekking van de samengevoegde lezing is echt compleet of echt gedeeltelijk', () => {
  const sources = [{ id: 'source-1', imageRead: true }];
  const menuWith = (count) => [{ title: 'Kaart', sourceId: 'source-1', categories: [{ name: 'Pasta', items: Array.from({ length: count }, (_, index) => item(`Gerecht ${index + 1}`, 900 + index, 'afbeelding 1')) }] }];
  const complete = mergedCoverage({
    readUnits: [{ number: 1, kind: 'image', sourceId: 'source-1' }, { number: 2, kind: 'image', sourceId: 'source-1' }],
    failedUnits: [],
    itemCount: 5,
    sourceCount: 1,
  });
  assert.equal(complete.status, 'complete');
  assert.equal(complete.sourcesRead, 1);
  assert.equal(complete.pagesRead, 2);
  assert.deepEqual(schema.validateStructuredOutput({ menus: menuWith(5), coverage: complete }, sources), []);

  const partial = mergedCoverage({
    readUnits: [{ number: 1, kind: 'image', sourceId: 'source-1' }],
    failedUnits: [{ number: 2, kind: 'image', sourceId: 'source-1', locator: 'afbeelding 2' }],
    itemCount: 2,
    sourceCount: 1,
  });
  assert.equal(partial.status, 'partial');
  assert.deepEqual(partial.unreadSources, [{ sourceId: 'source-1', locator: 'afbeelding 2', reason: 'unreadable' }]);
  assert.deepEqual(schema.validateStructuredOutput({ menus: menuWith(2), coverage: partial }, sources), []);
  assert.equal(mergedCoverage({ readUnits: [], failedUnits: [], itemCount: 0, sourceCount: 0 }).status, 'no_items');
});

test('BE-36: elke mislukte pagina heeft een eigen zin, een volgende stap en een retry-keuze', () => {
  const unit = { number: 4, kind: 'image', sourceId: 'source-1', locator: 'afbeelding 4', label: 'Pagina 4' };
  const truncated = pageFailure(unit, { reason: 'output_truncated', attempts: 2 });
  assert.equal(truncated.message, 'Pagina 4 kon niet gelezen worden. Het antwoord was afgekapt.');
  assert.equal(truncated.nextStep, 'Opnieuw proberen');
  assert.equal(truncated.retryable, true);
  const budget = pageFailure(unit, { reason: 'budget_exhausted', attempts: 0 });
  assert.equal(budget.message, 'Pagina 4 kon niet gelezen worden. Het budget van deze maand is op.');
  assert.equal(budget.retryable, false, 'a month budget does not change within a minute');
  const offline = pageFailure(unit, { reason: 'provider_unavailable', attempts: 2 });
  assert.match(offline.message, /niet bereikbaar/);
});

test('BE-36: het budget van een lezing volgt het aantal pagina\'s', () => {
  const units = Array.from({ length: 9 }, (_, index) => ({ number: index + 1 }));
  assert.deepEqual(readingCostPlan(units), { pages: 9, maxEurCents: 27, estimatedEurCents: 9 });
  assert.equal(readingCostPlan([]).maxEurCents, 3);
  assert.equal(readingCostPlan(Array.from({ length: 20 }, () => ({}))).maxEurCents, 30, 'never above the existing per-reading maximum');
});

test('BE-36: een retry leest alleen de gevraagde pagina, uit dezelfde bron-URL', () => {
  const descriptors = [
    { number: 1, kind: 'image', sourceId: 'source-1', sourceUrl: 'https://voorbeeld.example/menu', sourceKind: 'image', locator: 'afbeelding 1', label: 'Pagina 1', imageIndex: 0, imageUrl: 'https://voorbeeld.example/kaart-1.jpg', mediaType: 'image/jpeg' },
    { number: 2, kind: 'image', sourceId: 'source-1', sourceUrl: 'https://voorbeeld.example/menu', sourceKind: 'image', locator: 'afbeelding 2', label: 'Pagina 2', imageIndex: 1, imageUrl: 'https://voorbeeld.example/kaart-2.jpg', mediaType: 'image/jpeg' },
  ];
  const fetched = [{ url: 'https://voorbeeld.example/menu', kind: 'image', images: [{ url: 'https://voorbeeld.example/kaart-1.jpg', mediaType: 'image/jpeg', data: 'AAAA' }, { url: 'https://voorbeeld.example/kaart-2.jpg', mediaType: 'image/jpeg', data: 'BBBB' }] }];
  const retried = retryUnits(descriptors, [2], fetched);
  assert.equal(retried.units.length, 1);
  assert.equal(retried.units[0].number, 2);
  assert.equal(retried.units[0].data, 'BBBB');
  // A page that is no longer on the source is reported, never invented.
  const gone = retryUnits(descriptors, [2], [{ url: 'https://voorbeeld.example/menu', images: [] }]);
  assert.equal(gone.units.length, 0);
  assert.equal(gone.missing.length, 1);
  // The sealed state keeps metadata only, never bytes.
  const sealed = publicUnit({ ...descriptors[0], data: 'AAAA', documentBase64: 'AAAA' });
  assert.equal(sealed.data, undefined);
  assert.equal(sealed.documentBase64, undefined);
});
