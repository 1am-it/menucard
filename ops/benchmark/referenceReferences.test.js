'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const index = require('./reference-references/index.json');
const metadata = require('./reference-captures.json');
const { extractDigitalPdfText } = require('../../src/lib/pdfTextExtraction');
const { htmlVisibleText, normalizeQuoteText, validateReferenceShape, verifyReferenceQuotes } = require('./referenceIntegrity');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function reference(id) {
  const entry = index.sources.find((source) => source.id === id);
  assert.ok(entry, `reference for ${id}`);
  return require(path.join(REPO_ROOT, entry.file));
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('the index pins exactly the five approved sources and the counting rules', () => {
  assert.deepEqual(index.sources.map((source) => source.id), ['zuyd', 'andalous', 'pellens', 'chocolat', 'senang-makan']);
  assert.match(index.countingRules.sha256, /^[0-9a-f]{64}$/);
  const actual = sha256(path.join(REPO_ROOT, index.countingRules.path));
  assert.equal(actual, index.countingRules.sha256, 'the counting rules may not change after the references were authored');
});

test('every captured reference is structurally comparable and carries a locator and quote per item', () => {
  for (const entry of index.sources) {
    const ref = reference(entry.id);
    assert.equal(ref.sourceId, entry.id);
    assert.equal(ref.captureStatus, metadata.sources[entry.id].captureStatus);
    const shape = validateReferenceShape(ref);
    assert.deepEqual(shape.errors, [], `${entry.id}: ${shape.errors.join('; ')}`);
    if (ref.captureStatus !== 'captured') {
      assert.equal(ref.menus.length, 0, `${entry.id}: a blocked source has no dish reference`);
      assert.ok(ref.limitations.length > 0, `${entry.id}: a blocked source names its reason`);
      continue;
    }
    const items = ref.menus.flatMap((menu) => menu.categories.flatMap((category) => category.items));
    assert.ok(items.length > 0, `${entry.id}: at least one dish`);
    for (const item of items) {
      assert.ok(item.quote && item.quote.trim(), `${entry.id}: ${item.name} quote`);
      assert.ok(item.locator && item.locator.trim(), `${entry.id}: ${item.name} locator`);
      assert.ok(item.price || (Array.isArray(item.priceVariants) && item.priceVariants.length > 0), `${entry.id}: ${item.name} price`);
    }
  }
});

test('Senang Makan is recorded as blocked, not as an empty successful menu', () => {
  const ref = reference('senang-makan');
  assert.equal(ref.captureStatus, 'blocked');
  assert.match(ref.blockedReason, /503/);
  assert.equal(ref.menus.length, 0);
  const source = metadata.sources['senang-makan'];
  assert.equal(source.captureStatus, 'blocked');
  assert.equal(source.captures[0].httpStatus, 503);
});

test('every committed capture hash and size matches the local pinned bytes', (t) => {
  let checked = 0;
  for (const [id, source] of Object.entries(metadata.sources)) {
    for (const capture of source.captures) {
      if (capture.captureStatus !== 'captured') continue;
      const file = path.join(REPO_ROOT, capture.localPath);
      if (!fs.existsSync(file)) continue;
      const bytes = fs.readFileSync(file);
      assert.equal(bytes.length, capture.bytes, `${id}: byte size`);
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), capture.bytesSha256, `${id}: SHA-256`);
      checked += 1;
    }
  }
  if (checked === 0) t.skip('local gitignored capture bytes are not present in this checkout');
});

test('every reference quote is present in the pinned bytes', async (t) => {
  const anyCaptured = Object.values(metadata.sources).some((source) =>
    source.captures.some((capture) => capture.captureStatus === 'captured' && fs.existsSync(path.join(REPO_ROOT, capture.localPath))));
  if (!anyCaptured) {
    t.skip('local gitignored capture bytes are not present in this checkout');
    return;
  }
  for (const entry of index.sources) {
    const ref = reference(entry.id);
    if (ref.captureStatus !== 'captured') continue;
    const texts = new Map();
    for (const menu of ref.menus) {
      const capture = metadata.sources[entry.id].captures.find((candidate) => candidate.localPath === menu.captureKey);
      assert.ok(capture, `${entry.id}: ${menu.captureKey} is pinned`);
      const file = path.join(REPO_ROOT, menu.captureKey);
      const bytes = fs.readFileSync(file);
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), capture.bytesSha256, `${entry.id}: capture hash`);
      texts.set(menu.captureKey, capture.kind === 'pdf'
        ? (await extractDigitalPdfText(bytes, { maxBytes: 15 * 1024 * 1024 })).text
        : htmlVisibleText(bytes.toString('utf8')));
    }
    for (const row of [...ref.arrangements, ...ref.supplements]) {
      if (!row.captureKey || texts.has(row.captureKey)) continue;
      const capture = metadata.sources[entry.id].captures.find((candidate) => candidate.localPath === row.captureKey);
      assert.ok(capture, `${entry.id}: ${row.captureKey} is pinned`);
      const bytes = fs.readFileSync(path.join(REPO_ROOT, row.captureKey));
      texts.set(row.captureKey, capture.kind === 'pdf'
        ? (await extractDigitalPdfText(bytes, { maxBytes: 15 * 1024 * 1024 })).text
        : htmlVisibleText(bytes.toString('utf8')));
    }
    const result = verifyReferenceQuotes(ref, texts);
    assert.deepEqual(result.errors, [], `${entry.id}: ${result.errors.join('; ')}`);
  }
});

// ── Lead-review 6319894232: the repaired references, from the pinned bytes ──

function capturedText(captureKey) {
  const file = path.join(REPO_ROOT, captureKey);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8');
}

/** Visible text of the HTML between two unique markers, in document order. */
function textBetween(html, fromMarker, toMarker) {
  const start = html.indexOf(fromMarker);
  const end = html.indexOf(toMarker, start + 1);
  assert.ok(start >= 0, `marker not found: ${fromMarker}`);
  assert.ok(end > start, `closing marker not found after ${fromMarker}: ${toMarker}`);
  return htmlVisibleText(html.slice(start, end));
}

function referenceItems(ref) {
  return ref.menus.flatMap((menu) =>
    menu.categories.flatMap((category) => category.items.map((item) => ({ item, path: category.path }))));
}

test('Pellens: the diner tab carries the same a-la-carte table and its dishes are separate reference items (R1)', (t) => {
  const ref = reference('pellens');
  const menu = ref.menus[0];
  const html = capturedText(menu.captureKey);
  if (!html) {
    t.skip('local gitignored capture bytes are not present in this checkout');
    return;
  }
  // The diner panel is its own tab panel; its bytes decide the reference.
  const dinerText = normalizeQuoteText(textBetween(html, 'id="kaart-diner"', 'id="kaart-vragen"'));
  const dinerItems = referenceItems(ref).filter(({ path }) => path.includes('Diner'));
  assert.equal(dinerItems.length, 13, 'six a-la-carte dishes, six vegetable dishes and one dessert');
  for (const { item } of dinerItems) {
    assert.ok(
      dinerText.includes(normalizeQuoteText(item.quote)),
      `${item.name}: the quote must occur inside the diner panel, not only elsewhere on the page`,
    );
  }
  // The same dish in two rubrics is two reference items (counting rule 5).
  const lunch = new Set(referenceItems(ref).filter(({ path }) => path.includes('Lunch')).map(({ item }) => item.name));
  for (const { item } of dinerItems) {
    assert.ok(lunch.has(item.name), `${item.name}: the lunch rubric keeps its own row`);
  }
  // The old limitation ("the diner tab is arrangement-only") was false.
  const limitations = ref.limitations.join(' ');
  assert.doesNotMatch(limitations, /alleen arrangementen/);
  assert.match(limitations, /dezelfde à-la-cartekaart/);
  const dinerPrices = dinerItems.map(({ item }) => item.price || item.priceVariants.map((variant) => variant.price).join('/'));
  assert.ok(dinerPrices.includes('23.00/38.00'), 'Langoustine keeps both portion prices');
  assert.ok(dinerPrices.includes('24.00/39.00'), 'Wilde eend keeps both portion prices');
});

test('Andalous: Loaded Fries Scampi sits inside the Hoofdgerechten* block and is a reference dish (R2)', (t) => {
  const ref = reference('andalous');
  const menu = ref.menus[0];
  const html = capturedText(menu.captureKey);
  if (!html) {
    t.skip('local gitignored capture bytes are not present in this checkout');
    return;
  }
  const text = htmlVisibleText(html);
  const heading = text.indexOf('Hoofdgerechten*');
  const nextSection = text.indexOf("Pasta's", heading + 1);
  const dish = text.indexOf('Loaded Fries Scampi');
  assert.ok(heading >= 0 && nextSection > heading, 'both section headings are in the pinned text');
  assert.ok(dish > heading, 'the dish is in the menukaart after the Hoofdgerechten* heading');
  assert.ok(dish < nextSection, 'the dish is inside the Hoofdgerechten* block, before the Pasta section');
  const row = referenceItems(ref).find(({ item }) => item.name === 'Loaded Fries Scampi');
  assert.ok(row, 'the reference carries the dish');
  assert.equal(row.item.price, '17.00');
  assert.match(row.item.locator, /Hoofdgerechten\*/);
  assert.match(row.item.locator, /Visgerechten/, 'the h4 subsection the source shows stays visible in the locator');
  assert.ok(row.path.includes('Hoofdgerechten*'), 'the rubric is the section the source shows');
});

test('Zuyd: the surprise menus carry the wine-arrangement prices the source row shows (R3)', (t) => {
  const ref = reference('zuyd');
  const arrangement = ref.arrangements.find((entry) => entry.name === "VERRASSINGSMENU'S");
  assert.ok(arrangement, 'the surprise menus are a reference arrangement');
  const capture = metadata.sources.zuyd.captures.find((candidate) => candidate.localPath === arrangement.captureKey);
  assert.ok(capture, 'the arrangement is pinned to the diner capture');
  const html = capturedText(arrangement.captureKey);
  if (!html) {
    t.skip('local gitignored capture bytes are not present in this checkout');
    return;
  }
  const text = htmlVisibleText(html);
  // Four menu prices, four wine arrangements and four half-glass arrangements.
  assert.equal(arrangement.prices.length, 12);
  assert.equal(arrangement.prices.filter((price) => /wijnarrangement/.test(price.label) && !/½ glas/.test(price.label)).length, 4);
  assert.equal(arrangement.prices.filter((price) => /½ glas wijnarrangement/.test(price.label)).length, 4);
  for (const amount of ['32.00', '22.00', '40.00', '27.50', '48.00', '33.00', '56.00', '38.50']) {
    assert.ok(arrangement.prices.some((price) => price.price === amount), `the wine price ${amount} is recorded`);
    // The source writes whole euros without decimals ("wijnarr. 32") and half
    // euros with a comma ("27,50"); accept the notation the pinned bytes use.
    const notations = [amount, amount.replace('.', ','), String(Number(amount)), String(Number(amount)).replace('.', ',')];
    assert.ok(
      notations.some((candidate) => normalizeQuoteText(text).includes(normalizeQuoteText(candidate))),
      `the amount ${amount} occurs in the pinned bytes`,
    );
  }
  // Arrangement prices never become dish rows: no dish is a wine arrangement.
  const dishNames = referenceItems(ref).map(({ item }) => item.name);
  for (const name of dishNames) {
    assert.doesNotMatch(name, /wijnarr|glas wijnarrangement|verrassingsmenu/i, `${name} is not a dish`);
  }
});


