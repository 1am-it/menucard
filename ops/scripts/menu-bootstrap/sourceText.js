'use strict';

// BE-78 (#193) — "Prijscontrole en verschillen". One shared module for the two
// new tools (./price-check.js and ./refresh-diff.js):
//   - fetchSourceText(url): the readable text of one source. Html without its
//     scripts and styles, or the text layer of a pdf through the existing
//     pdfjs-dist reader (src/lib/pdfTextExtraction.js). Fetched politely through
//     the existing BE-71 fetcher (./fetchSource.js: robots.txt, rest between two
//     requests to the same host, cache under .local/) — no new egress, no new
//     dependency, no AI.
//   - findPrices(text): every price form these cards print, as a number.
//   - matchItem(text, item): is the price printed around a dish name the same as
//     the price on our card? `ok`, `price-deviates` (with the price that was
//     found) or `name-not-found`; a dish with `priceOnRequest` is skipped.
//   - diffCard(text, card): what changed since we read the card (changed price,
//     possibly gone, possibly new). Pure: it never writes anything.

const { createSourceFetcher } = require('./fetchSource');
const { extractDigitalPdfLines } = require('../../../src/lib/pdfTextExtraction');
// The one-decimal point family (Blossem prints `4.5`): the same printed-line
// rule the review card already uses, reused instead of read a second way.
const { findDecimalPointPrices } = require('../../../src/lib/htmlMenuStructure');

/** Half a cent: two printed prices that differ less than that are the same. */
const PRICE_TOLERANCE = 0.005;

/**
 * The old character window, kept as the documented default for callers that pass
 * their own window. Matching itself now reads printed rows, not characters
 * (round 2, review #6560710718): a price belongs to the row it is printed on.
 */
const DEFAULT_WINDOW = { before: 40, after: 140 };
const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  euro: '€',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: "'",
  lsquo: "'",
  laquo: '«',
  raquo: '»',
  middot: '·',
  deg: '°',
  frac12: '½',
  times: '×',
  // The accents a Dutch menu prints ("Crème brûlée", "Zeetong à la meunière").
  agrave: 'à',
  aacute: 'á',
  acirc: 'â',
  atilde: 'ã',
  auml: 'ä',
  aring: 'å',
  aelig: 'æ',
  ccedil: 'ç',
  egrave: 'è',
  eacute: 'é',
  ecirc: 'ê',
  euml: 'ë',
  igrave: 'ì',
  iacute: 'í',
  icirc: 'î',
  iuml: 'ï',
  ntilde: 'ñ',
  ograve: 'ò',
  oacute: 'ó',
  ocirc: 'ô',
  otilde: 'õ',
  ouml: 'ö',
  oslash: 'ø',
  ugrave: 'ù',
  uacute: 'ú',
  ucirc: 'û',
  uuml: 'ü',
  yacute: 'ý',
  yuml: 'ÿ',
  szlig: 'ß',
  Agrave: 'À',
  Aacute: 'Á',
  Acirc: 'Â',
  Auml: 'Ä',
  Aring: 'Å',
  AElig: 'Æ',
  Ccedil: 'Ç',
  Egrave: 'È',
  Eacute: 'É',
  Ecirc: 'Ê',
  Euml: 'Ë',
  Igrave: 'Ì',
  Iacute: 'Í',
  Ouml: 'Ö',
  Oslash: 'Ø',
  Uuml: 'Ü',
  Uacute: 'Ú',
};

/** The handful of html entities a menu page really prints, plus numeric ones. */
function decodeEntities(value) {
  return String(value || '').replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body) => {
    if (body.charAt(0) === '#') {
      const hex = body.charAt(1) === 'x' || body.charAt(1) === 'X';
      const code = hex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES[body] !== undefined ? NAMED_ENTITIES[body] : NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? match : named;
  });
}

/**
 * The readable text of one html page: no scripts, no styles, no tags, one line
 * per printed block, so a price stays next to the name it belongs to.
 */
function htmlToReadableText(html) {
  let text = String(html || '');
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');
  text = text.replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ');
  text = text.replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ');
  text = text.replace(/<(?:br|hr)\s*\/?>/gi, '\n');
  text = text.replace(
    /<\/(?:p|div|li|tr|h[1-6]|section|article|header|footer|table|thead|tbody|ul|ol|dl|dd|dt|blockquote|figcaption|nav)\s*>/gi,
    '\n',
  );
  text = text.replace(/<\/(?:td|th)\s*>/gi, ' | ');
  text = text.replace(/<[^>]*>/g, ' ');
  text = decodeEntities(text);
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t\r\f\v\u00a0]+/g, ' ').replace(/\s*\|\s*$/, '').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/** Lower case without accents, so "Crème brûlée" finds "CREME BRULEE". */
function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u2018\u2019\u02bc`´]/g, "'")
    .toLowerCase();
}

/**
 * The same normalization, but every character keeps its position in the
 * original text: a name found in the normalized string still points at the
 * printed text, so the price window can be cut from the original.
 */
function normalizeWithMap(value) {
  const source = String(value || '');
  const characters = [];
  const map = [];
  for (let index = 0; index < source.length; index += 1) {
    const character = source.charAt(index);
    const normalized = character === '\u00a0' ? ' ' : character.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    for (const piece of normalized) {
      characters.push(piece);
      map.push(index);
    }
  }
  return { text: characters.join(''), map };
}

// Every price form these cards print. Order is priority: an earlier form wins
// when two matches overlap ("2 stuks 13.95" is one price, not two numbers).
const PRICE_PATTERNS = [
  // € 12,50 · €12 · € 12 · € 12,- · € 12.50
  { form: 'euro', pattern: /€\s?(\d{1,4})(?:[.,](\d{1,2})|[.,]\s?-{1,2}(?!\d))?/g },
  // 2 stuks 13.95 · 2 personen € 48,50
  { form: 'quantity', pattern: /(\d{1,2})\s?(?:stuks?|personen|pers\.?)\s?(?:€\s?)?(\d{1,3})[.,](\d{2})(?!\d)/g },
  // 1.85st · 1,85 st
  { form: 'per-piece', pattern: /(\d{1,3})[.,](\d{2})\s?(?:st\.?|stuks?|p\.p\.?|p\.\s?p\.?)(?![a-zA-Z0-9])/g },
  // vanaf 9 · vanaf 9,50
  { form: 'from', pattern: /\bvanaf\s+(\d{1,4})(?:[.,](\d{1,2}))?(?!\d)/g },
  // 12,-
  { form: 'dash', pattern: /(\d{1,3})\s?,-{1,2}(?!\d)/g },
  // 12,50 · 12,5
  { form: 'comma', pattern: /(\d{1,3}),(\d{1,2})(?!\d)/g },
  // 12.50
  { form: 'dot', pattern: /(\d{1,3})\.(\d{2})(?!\d)/g },
];

function amountOf(form, match) {
  const parts =
    form === 'euro'
      ? [match[1], match[2]]
      : form === 'quantity'
        ? [match[2], match[3]]
        : form === 'per-piece'
          ? [match[1], match[2]]
          : form === 'dash'
            ? [match[1], '0']
            : [match[1], match[2]];
  const value = Number(`${parts[0]}.${parts[1] || '0'}`);
  return Number.isFinite(value) ? value : null;
}

/**
 * Every price in one text, left to right and without double counting: a price
 * that is already part of an earlier match is not reported again.
 * Resolves `[{ value, raw, index, form }]`.
 */
/**
 * A bare whole euro at the end of a printed line or cell: "ROGVLEUGEL 32",
 * "Zes-gangen 150 |". This is the whole-euro family the card's own printed-price
 * reader already uses (src/lib/htmlMenuStructure.js, `findWholeEuroPrices`): the
 * amount sits at a printed boundary, at least two letters print before it, and a
 * numbering, version, time or phone word, a unit or a year never counts. A false
 * price is worse than a missed one, so anything doubtful stays a plain number.
 */
const WHOLE_EURO_AT_EDGE = /(?<![\d.,€/\-\p{L}])(\d{1,3})(?=[ \t]*[|\n]|[ \t]*$)/gmu;
const NUMBERING_WORD_BEFORE = /\b(?:nummer|nr|nrs|punt|stap|etage|verdieping|keuze|optie|plek|plaats|tafel|kamer|pagina|tel|telefoon|mobiel|gsm|fax|versie|version|editie|edition)\s*[.:]?\s*$/i;

function findWholeEuroPrices(text) {
  const source = String(text || '');
  const prices = [];
  WHOLE_EURO_AT_EDGE.lastIndex = 0;
  let match = WHOLE_EURO_AT_EDGE.exec(source);
  while (match !== null) {
    const value = Number(match[1]);
    const index = match.index;
    const lineStart = source.lastIndexOf('\n', index) + 1;
    const before = source.slice(Math.max(lineStart, index - 60), index);
    const named = (before.match(/\p{L}/gu) || []).length >= 3;
    if (value >= 1 && named && !/^0/.test(match[1]) && !NUMBERING_WORD_BEFORE.test(before)) {
      prices.push({ value, raw: match[0].trim(), index, end: index + match[0].length, form: 'whole-euro', priority: PRICE_PATTERNS.length });
    }
    match = WHOLE_EURO_AT_EDGE.exec(source);
  }
  return prices;
}

/**
 * A price printed with a decimal point and one decimal, at the end of its own
 * printed row: Blossem prints `Gemarineerde olijven 4.5`. The rule is not new
 * here — `src/lib/htmlMenuStructure.js` already reads exactly this family for
 * the review card (`findDecimalPointPrices`: 1–3 digits at a printed boundary, a
 * name before it, and a version, time, unit, range, date or phone refused).
 * Reading it per printed row keeps that rule intact, and an amount the money
 * parser already read is never counted twice.
 */
function findRowDecimalPrices(source) {
  const prices = [];
  const lines = String(source || '').split('\n');
  let offset = 0;
  for (const line of lines) {
    for (const price of findDecimalPointPrices(line)) {
      prices.push({
        value: price.amountMinorUnits / 100,
        raw: price.raw,
        index: offset + price.index,
        end: offset + price.index + price.length,
        form: 'decimal-point',
        priority: PRICE_PATTERNS.length + 1,
      });
    }
    offset += line.length + 1;
  }
  return prices;
}

function findPrices(text) {
  const source = String(text || '');
  const candidates = [];
  PRICE_PATTERNS.forEach((entry, priority) => {
    entry.pattern.lastIndex = 0;
    let match = entry.pattern.exec(source);
    while (match !== null) {
      const value = amountOf(entry.form, match);
      if (value !== null && value > 0) {
        candidates.push({ value, raw: match[0].trim(), index: match.index, end: match.index + match[0].length, form: entry.form, priority });
      }
      match = entry.pattern.exec(source);
    }
  });
  for (const candidate of findWholeEuroPrices(source)) candidates.push(candidate);
  for (const candidate of findRowDecimalPrices(source)) {
    if (candidate.value > 0 && !/€\s*$/.test(source.slice(0, candidate.index))) candidates.push(candidate);
  }
  candidates.sort((left, right) => left.index - right.index || left.priority - right.priority || right.end - left.end);
  const prices = [];
  let lastEnd = -1;
  for (const candidate of candidates) {
    if (candidate.index < lastEnd) continue;
    prices.push({ value: candidate.value, raw: candidate.raw, index: candidate.index, form: candidate.form });
    lastEnd = candidate.end;
  }
  return prices;
}

// ─── Reading one source once: words, printed rows and prices ────────────────
//
// Words a card and its source rarely print the same way (an article, a joining
// word, a preposition) carry no identity: they never decide whether two names
// are the same dish.
const NAME_FILLER = new Set([
  'de', 'het', 'een', 'n', 'ons', 'onze', 't', 'the', 'a', 'an',
  'en', 'and', 'und', 'e', 'y', 'met', 'with', 'mit', 'con',
  'van', 'of', 'from', 'von', 'di', 'del', 'della', 'dei', 'der', 'den',
  'la', 'le', 'les', 'il', 'lo', 'gli', 'i', 'al', 'alla', 'au', 'aux', 'des',
  'op', 'in', 'bij', 'per', 'for', 'fur', 'zum', 'zur', 'am', 'an', 'auf',
]);

const TOKEN_PATTERN = /[a-z0-9]+/g;

/** Every printed word of the source with its position in the original text. */
function tokenizeSource(normalized, map) {
  const tokens = [];
  TOKEN_PATTERN.lastIndex = 0;
  let match = TOKEN_PATTERN.exec(normalized);
  while (match !== null) {
    tokens.push({
      token: match[0],
      index: match.index,
      start: map[match.index],
      end: map[match.index + match[0].length - 1] + 1,
    });
    match = TOKEN_PATTERN.exec(normalized);
  }
  return tokens;
}

/**
 * One read of a source: its printed rows, its words and its prices, all in
 * original-text positions. `matchItem` accepts it through `options.index`, so a
 * whole card is read once instead of once per dish.
 */
function buildSourceIndex(text) {
  const source = typeof text === 'string' ? text : '';
  const { text: normalized, map } = normalizeWithMap(source);
  const starts = [];
  let offset = 0;
  for (const line of source.split('\n')) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const index = {
    source,
    text: source,
    normalized,
    map,
    tokens: tokenizeSource(normalized, map),
    lineStarts: starts,
    prices: findPrices(source),
  };
  index.lineOfPrice = index.prices.map((price) => lineOf(index, price.index));
  return index;
}

/** Which printed row holds this position. */
function lineOf(index, position) {
  const starts = index.lineStarts;
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (starts[middle] <= position) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** The prices printed on one row, left to right. */
function pricesOnLine(index, lineNumber) {
  if (lineNumber < 0 || lineNumber >= index.lineStarts.length) return [];
  return index.prices.filter((price, position) => index.lineOfPrice[position] === lineNumber);
}

/** The words of a dish name that carry its identity. */
function nameTokens(name) {
  const words = normalizeText(name)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const content = words.filter((word) => !NAME_FILLER.has(word) && word.length > 1);
  return content.length > 0 ? content : words;
}

/**
 * One alignment of the name's words from a source word: walks forward and takes
 * the name's words in order, allowing the source to print other words in
 * between. The name is only the same dish when its LAST word is printed — that
 * is what keeps "Broodje kip" away from the "Broodje kip speciaal" row.
 * `allowMissing` lets one word of the name drop out (a card that adds a word its
 * source does not print); it scores lower.
 */
function alignWords(tokens, content, from, allowMissing) {
  const limit = from + content.length * 2 + 8;
  let wanted = 0;
  let position = from;
  let matched = 0;
  let last = -1;
  let missing = 0;
  while (wanted < content.length && position < tokens.length && position <= limit) {
    if (tokens[position].token === content[wanted]) {
      matched += 1;
      last = position;
      wanted += 1;
    } else if (allowMissing && wanted < content.length - 1 && missing < 1) {
      missing += 1;
      wanted += 1;
      continue;
    }
    position += 1;
  }
  if (matched === 0 || last < 0 || wanted < content.length) return null;
  return { matched, missing, last };
}

/**
 * Every place where the source prints this dish name, the best match first.
 * A name is compared by its words, not its characters: case, accents,
 * punctuation, apostrophes, an article and a different word order in the source
 * do not matter, and a shortened source name ("BONBON" for "Bonbon van
 * ganzenlever, …") is still the same dish.
 */
function findNameOccurrences(sourceOrIndex, name) {
  const index = typeof sourceOrIndex === 'string' ? buildSourceIndex(sourceOrIndex) : sourceOrIndex;
  if (!index || !Array.isArray(index.tokens) || index.tokens.length === 0) return [];
  const content = nameTokens(name);
  if (content.length === 0) return [];
  const found = [];
  const seen = new Set();
  const collect = (allowMissing) => {
    for (let position = 0; position < index.tokens.length; position += 1) {
      // Anchor on any word of the name: a source that prints fewer words
      // ("Hollands" for "Kaasfondue Hollands") still counts, as long as the
      // printed tail of the name matches.
      for (let wanted = 0; wanted < content.length; wanted += 1) {
        if (index.tokens[position].token !== content[wanted]) continue;
        const tail = content.slice(wanted);
        if (tail.length * 2 < content.length) continue;
        const aligned = alignWords(index.tokens, tail, position, allowMissing);
        if (!aligned) continue;
        const start = index.tokens[position].start;
        const end = index.tokens[aligned.last].end;
        const key = `${start}:${end}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({
          start,
          end,
          score: (tail.length - aligned.missing) / content.length,
          words: tail.length,
          missing: aligned.missing,
        });
      }
    }
  };
  collect(false);
  if (found.length === 0) collect(true);
  return found.sort((left, right) => right.score - left.score || left.start - right.start);
}

/**
 * Where in the original text the dish name is printed: the best occurrence.
 * Resolves `{ start, end }` in original-text indexes, or null.
 */
function findName(text, name) {
  const occurrences = findNameOccurrences(String(text || ''), name);
  if (occurrences.length === 0) return null;
  return { start: occurrences[0].start, end: occurrences[0].end };
}

/**
 * The prices our own card promises for one dish: the price itself and every
 * price printed in its description (glass/bottle, small/main, 3 or 5 pieces).
 */
function expectedPrices(item) {
  const values = [];
  const push = (value) => {
    if (!Number.isFinite(value) || value <= 0) return;
    if (values.some((known) => Math.abs(known - value) < PRICE_TOLERANCE)) return;
    values.push(value);
  };
  push(typeof item.priceValue === 'number' ? item.priceValue : Number.NaN);
  for (const price of findPrices(String(item.price || ''))) push(price.value);
  for (const price of findPrices(String(item.desc || ''))) push(price.value);
  return values;
}

/**
 * The printed prices that belong to one occurrence of a name, nearest first.
 * The dish's own printed row always wins: a card prints its amount on the same
 * row, or on the row just below it (name, amount, description), or in the cell
 * to its left. The row ABOVE is only read when the rows below print no price at
 * all, so the amount of the previous dish is never borrowed. A row that prints
 * nothing but one bare number ("LUNCHMENU" / "50") counts as that row's price.
 */
function occurrencePrices(index, occurrence) {
  const lineNumber = lineOf(index, occurrence.start);
  const own = pricesOnLine(index, lineNumber);
  if (own.length > 0) return { prices: own, scope: 'row' };
  for (let step = 1; step <= 2; step += 1) {
    const next = pricesOnLine(index, lineNumber + step);
    if (next.length > 0) return { prices: next, scope: step === 1 ? 'next-row' : 'near-row' };
  }
  // A menu row whose amount is printed on a row of its own ("50").
  for (let step = 1; step <= 2; step += 1) {
    const bare = bareNumberOnLine(index, lineNumber + step);
    if (bare) return { prices: [bare], scope: 'next-row' };
  }
  for (let step = 1; step <= 2; step += 1) {
    const previous = pricesOnLine(index, lineNumber - step);
    if (previous.length > 0) return { prices: previous, scope: 'prev-row' };
  }
  return { prices: [], scope: 'none' };
}

/** A row that prints one bare number and nothing else: a menu amount on its own row. */
function bareNumberOnLine(index, lineNumber) {
  if (lineNumber < 0 || lineNumber >= index.lineStarts.length) return null;
  const start = index.lineStarts[lineNumber];
  const end = lineNumber + 1 < index.lineStarts.length ? index.lineStarts[lineNumber + 1] - 1 : index.source.length;
  const text = index.source.slice(start, end).trim();
  if (!/^\d{1,3}$/.test(text)) return null;
  return { value: Number(text), raw: text, index: start, form: 'bare-row' };
}

/**
 * Does the source print the price of this dish next to its name?
 * Status: `ok`, `price-deviates` (with the price that was found), `name-not-found`
 * or `skipped` (a dish with `priceOnRequest`, or one without any price).
 *
 * A dish that a card prints more than once (lunch and dinner, a broodje and a
 * salade) is `ok` as soon as ONE of those occurrences carries the right price.
 * `nameFound` says whether the name itself was printed.
 */
function matchItem(text, item = {}, options = {}) {
  const index = options.index && options.index.tokens ? options.index : buildSourceIndex(typeof text === 'string' ? text : '');
  const base = { name: item && item.name ? String(item.name) : null, nameFound: false };
  if (!item || item.priceOnRequest === true) {
    return { ...base, status: 'skipped', reason: 'price-on-request', expected: [], found: null, foundPrices: [] };
  }
  const expected = expectedPrices(item);
  if (expected.length === 0) {
    return { ...base, status: 'skipped', reason: 'geen-prijs-op-de-kaart', expected, found: null, foundPrices: [] };
  }
  const occurrences = findNameOccurrences(index, base.name);
  if (occurrences.length === 0) {
    return { ...base, status: 'name-not-found', reason: 'naam-niet-gevonden', expected, found: null, foundPrices: [] };
  }
  let best = null;
  for (const occurrence of occurrences) {
    const { prices, scope } = occurrencePrices(index, occurrence);
    if (prices.length === 0) continue;
    const missing = expected.filter((value) => !prices.some((found) => Math.abs(found.value - value) < PRICE_TOLERANCE));
    const candidate = { occurrence, prices, scope, missing };
    if (missing.length === 0) return { ...base, nameFound: true, status: 'ok', expected, found: prices[0].value, foundPrices: prices };
    if (!best || candidate.missing.length < best.missing.length) best = candidate;
  }
  if (!best) {
    return { ...base, nameFound: true, status: 'name-not-found', reason: 'naam-gevonden-zonder-prijs', expected, found: null, foundPrices: [] };
  }
  // The printed price that belongs to this name: the one after the name, else the
  // one in its own row (a column layout prints the amount on the left).
  const afterName = best.prices.find((price) => price.index >= best.occurrence.end);
  const found = (afterName || best.prices[0]).value;
  return {
    ...base,
    nameFound: true,
    status: 'price-deviates',
    reason: 'prijs-wijkt-af',
    expected,
    missing: best.missing,
    found,
    foundPrices: best.prices,
    scope: best.scope,
  };
}

function flattenItems(card) {
  const items = [];
  for (const category of Array.isArray(card && card.categories) ? card.categories : []) {
    for (const item of Array.isArray(category.items) ? category.items : []) {
      if (!item || typeof item.name !== 'string' || !item.name.trim()) continue;
      items.push({ category: category.name || null, item });
    }
  }
  return items;
}

/**
 * The printed name in front of a price, for a dish we do not have yet: the first
 * run of the printed line ("|" and "·" separate a run from the next part), or,
 * on a flattened pdf text layer without line breaks, the run just before the
 * amount.
 */
function labelBefore(text, index) {
  const source = String(text || '');
  const lineStart = source.lastIndexOf('\n', index) + 1;
  const line = source.slice(Math.max(lineStart, index - 160), index).replace(/\s+/g, ' ').trim();
  if (/[|·]/.test(line)) {
    const first = line.split(/\s*[|·]\s*/).map((part) => part.trim()).filter(Boolean)[0] || '';
    return first.length > 70 ? first.slice(0, 70).trim() : first;
  }
  return line.length > 70 ? line.slice(-70).trim() : line;
}

/**
 * What changed in one source since we read the card: a changed price, a dish
 * that is no longer printed, and a printed price that belongs to no dish on our
 * card. Pure; `./refresh-diff.js` only formats it and never touches data/.
 */
function diffCard(text, card = {}) {
  const source = typeof text === 'string' ? text : '';
  const rows = flattenItems(card);
  const claimed = new Set();
  const changed = [];
  const gone = [];
  let checked = 0;
  let ok = 0;
  for (const { category, item } of rows) {
    const result = matchItem(source, item);
    for (const price of result.foundPrices) claimed.add(price.index);
    if (result.status === 'price-deviates') {
      checked += 1;
      changed.push({ category, name: result.name, expected: result.expected, missing: result.missing, found: result.found });
      continue;
    }
    if (result.nameFound) {
      if (result.status === 'ok') {
        checked += 1;
        ok += 1;
      } else gone.push({ category, name: result.name, reason: result.reason || 'geen prijs bij de naam' });
      continue;
    }
    // A dish with a price on request has no price to compare; whether its name is
    // still printed is still worth reporting.
    const stillPrinted = item.priceOnRequest === true ? findName(source, item.name) : null;
    if (result.reason !== 'price-on-request' || stillPrinted === null) {
      gone.push({
        category,
        name: result.name,
        reason: result.status === 'skipped' ? 'naam niet meer gevonden (prijs op aanvraag)' : result.reason,
      });
    }
  }
  const seenLabels = new Set();
  const possibleNew = [];
  for (const price of findPrices(source)) {
    if (claimed.has(price.index)) continue;
    const label = labelBefore(source, price.index);
    const key = `${label}|${price.value}`;
    if (seenLabels.has(key)) continue;
    seenLabels.add(key);
    possibleNew.push({ label, value: price.value, raw: price.raw });
  }
  return { checked, ok, changed, gone, possibleNew };
}

/**
 * The readable text of one source: html without scripts and styles, or the text
 * layer of a pdf. Fetched through the existing BE-71 rules (robots.txt, rest
 * between requests, cache in .local/); `fetcher` is injectable so tests never
 * touch the network.
 */
async function fetchSourceText(url, options = {}) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    return { ok: false, url, reason: 'invalid_url', detail: null };
  }
  const fetcher =
    options.fetcher ||
    createSourceFetcher({
      ...(options.cacheDir === undefined ? {} : { cacheDir: options.cacheDir }),
      ...(options.sleep ? { sleep: options.sleep } : {}),
      ...(options.now ? { now: options.now } : {}),
    });
  let page;
  try {
    page = await fetcher.getPage(url);
  } catch (error) {
    return { ok: false, url, reason: 'fetch_failed', detail: String((error && error.message) || error).slice(0, 200) };
  }
  if (!page || page.ok !== true) {
    return {
      ok: false,
      url,
      reason: (page && page.reason) || 'fetch_failed',
      detail: (page && page.detail) || null,
      robotsStatus: (page && page.robotsStatus) || null,
    };
  }
  if (page.kind === 'html') {
    const html = page.text !== null && page.text !== undefined ? page.text : page.bytes ? page.bytes.toString('utf8') : '';
    return {
      ok: true,
      url,
      finalUrl: page.finalUrl || url,
      kind: 'html',
      text: htmlToReadableText(html),
      fromCache: page.fromCache === true,
    };
  }
  if (page.kind === 'pdf') {
    let extracted;
    try {
      // Line-aware: a pdf prints a dish name and its amount on one visual row,
      // and reading the raw content-stream order would separate them.
      extracted = await extractDigitalPdfLines(page.bytes);
    } catch (error) {
      return {
        ok: false,
        url,
        kind: 'pdf',
        reason: (error && error.reason) || 'pdf_unreadable',
        detail: String((error && error.message) || error).slice(0, 200),
      };
    }
    const lines = [];
    for (const pdfPage of Array.isArray(extracted && extracted.pages) ? extracted.pages : []) {
      for (const line of Array.isArray(pdfPage.lines) ? pdfPage.lines : []) {
        const text = (Array.isArray(line.items) ? line.items : [])
          .map((item) => (item && typeof item.str === 'string' ? item.str : ''))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (text) lines.push(text);
      }
    }
    const text = lines.join('\n');
    if (!text) {
      return { ok: false, url, kind: 'pdf', reason: 'no_text_layer', detail: 'geen tekstlaag' };
    }
    return {
      ok: true,
      url,
      finalUrl: page.finalUrl || url,
      kind: 'pdf',
      text,
      pageCount: (extracted && extracted.pageCount) || null,
      fromCache: page.fromCache === true,
    };
  }
  return { ok: false, url, kind: page.kind || 'other', reason: 'unsupported_content_type', detail: page.contentType || null };
}

module.exports = {
  PRICE_TOLERANCE,
  DEFAULT_WINDOW,
  decodeEntities,
  htmlToReadableText,
  normalizeText,
  findPrices,
  findName,
  buildSourceIndex,
  findNameOccurrences,
  expectedPrices,
  matchItem,
  diffCard,
  flattenItems,
  fetchSourceText,
};
