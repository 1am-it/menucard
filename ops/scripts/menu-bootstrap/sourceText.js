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

/** Half a cent: two printed prices that differ less than that are the same. */
const PRICE_TOLERANCE = 0.005;

/** How far around a dish name a printed price still belongs to that dish. */
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isWordCharacter(character) {
  return typeof character === 'string' && character !== '' && /[a-z0-9]/.test(character);
}

/**
 * Where in the original text the dish name is printed. Case and accents do not
 * matter; a name whose words are separated by other punctuation in the source
 * ("Zeetong à la meunière" vs "Zeetong - à la meunière") is still found.
 * Resolves `{ start, end }` in original-text indexes, or null.
 */
function findName(text, name) {
  const source = String(text || '');
  const wanted = normalizeText(name).replace(/\s+/g, ' ').trim();
  if (!wanted || !source) return null;
  const { text: normalized, map } = normalizeWithMap(source);
  const bounded = (start, length) => {
    const before = start > 0 ? normalized.charAt(start - 1) : '';
    const after = start + length < normalized.length ? normalized.charAt(start + length) : '';
    const startsWithWord = isWordCharacter(normalized.charAt(start));
    const endsWithWord = isWordCharacter(normalized.charAt(start + length - 1));
    return (!startsWithWord || !isWordCharacter(before)) && (!endsWithWord || !isWordCharacter(after));
  };
  let from = normalized.indexOf(wanted);
  while (from !== -1) {
    if (bounded(from, wanted.length)) {
      return { start: map[from], end: map[from + wanted.length - 1] + 1 };
    }
    from = normalized.indexOf(wanted, from + 1);
  }
  const words = wanted
    .split(' ')
    .map((word) => word.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean);
  if (words.length < 2) return null;
  const pattern = new RegExp(words.map(escapeRegExp).join('[^a-z0-9]{1,3}'), 'g');
  let found = pattern.exec(normalized);
  while (found !== null) {
    if (bounded(found.index, found[0].length)) {
      return { start: map[found.index], end: map[found.index + found[0].length - 1] + 1 };
    }
    found = pattern.exec(normalized);
  }
  return null;
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
 * Does the source print the price of this dish right next to its name?
 * Status: `ok`, `price-deviates` (with the price that was found), `name-not-found`
 * or `skipped` (a dish with `priceOnRequest`, or one without any price).
 * `nameFound` says whether the name itself was printed.
 */
function matchItem(text, item = {}, options = {}) {
  const source = typeof text === 'string' ? text : '';
  const before = Number.isInteger(options.before) ? options.before : DEFAULT_WINDOW.before;
  const after = Number.isInteger(options.after) ? options.after : DEFAULT_WINDOW.after;
  const base = { name: item && item.name ? String(item.name) : null, nameFound: false };
  if (!item || item.priceOnRequest === true) {
    return { ...base, status: 'skipped', reason: 'price-on-request', expected: [], found: null, foundPrices: [] };
  }
  const expected = expectedPrices(item);
  if (expected.length === 0) {
    return { ...base, status: 'skipped', reason: 'geen-prijs-op-de-kaart', expected, found: null, foundPrices: [] };
  }
  const located = findName(source, base.name);
  if (!located) {
    return { ...base, status: 'name-not-found', reason: 'naam-niet-gevonden', expected, found: null, foundPrices: [] };
  }
  const windowStart = Math.max(0, located.start - before);
  // A printed price belongs to the dish on its own printed line. Only when that
  // line carries no price at all is the wider window used (a card that prints
  // the amount in the next block); a flattened pdf text layer has no line
  // breaks, so it keeps the wider window.
  const lineEnd = source.indexOf('\n', located.end);
  const sameLine = lineEnd !== -1 && lineEnd <= located.end + after;
  const collect = (end) => {
    const start = windowStart;
    return findPrices(source.slice(start, end)).map((price) => ({ ...price, absoluteIndex: start + price.index }));
  };
  let foundPrices = collect(sameLine ? lineEnd : located.end + after);
  if (foundPrices.length === 0 && sameLine) foundPrices = collect(located.end + after);
  if (foundPrices.length === 0) {
    return { ...base, nameFound: true, status: 'name-not-found', reason: 'naam-gevonden-zonder-prijs', expected, found: null, foundPrices: [] };
  }
  const missing = expected.filter((value) => !foundPrices.some((found) => Math.abs(found.value - value) < PRICE_TOLERANCE));
  // The printed price that belongs to this name: the first one after it, else
  // the nearest one before it (a column layout prints the amount on the left).
  const afterName = foundPrices.find((price) => price.absoluteIndex >= located.end);
  const found = (afterName || foundPrices[foundPrices.length - 1]).value;
  if (missing.length === 0) {
    return { ...base, nameFound: true, status: 'ok', expected, found, foundPrices };
  }
  return { ...base, nameFound: true, status: 'price-deviates', reason: 'prijs-wijkt-af', expected, missing, found, foundPrices };
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
  for (const { category, item } of rows) {
    const result = matchItem(source, item);
    for (const price of result.foundPrices) claimed.add(price.absoluteIndex);
    if (result.status === 'price-deviates') {
      checked += 1;
      changed.push({ category, name: result.name, expected: result.expected, missing: result.missing, found: result.found });
      continue;
    }
    if (result.nameFound) {
      if (result.status === 'ok') checked += 1;
      else gone.push({ category, name: result.name, reason: result.reason || 'geen prijs bij de naam' });
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
  return { checked, changed, gone, possibleNew };
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
  expectedPrices,
  matchItem,
  diffCard,
  flattenItems,
  fetchSourceText,
};
