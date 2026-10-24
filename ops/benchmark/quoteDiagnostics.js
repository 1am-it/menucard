'use strict';

// Q2 of the Delivery Lead order for #59 / BE-21 (review 6375125413): explain
// every rejected citation, offline, from a saved answer.
//
// Why: live Zuyd answers were rejected with
// `evidence.quote is not present in the cited source`, and the raw answers were
// not kept, so the exact cases could not be inspected. A raw answer now exists
// (Q1); this module says, per failed quote: the quote, the item, the nearest
// source fragments and a classification.
//
// The classifications are diagnostic labels, not verdicts:
//   - `added_separator`   every part of the quote is in the source, and so is the
//                         same text joined by a space; only the separator the
//                         model chose (` - `, ` | `, `: `) is invented;
//   - `merged_lines`      every part is in the source, but not as one run: the
//                         model joined lines that the source keeps apart;
//   - `changed_characters` the source has the same words with other characters
//                         (comma/point, punctuation, a suffix);
//   - `whitespace_only`   the quote differs only by invisible or non-collapsed
//                         whitespace (zero-width space, soft hyphen, NBSP);
//   - `invented_text`     no source passage supports the quote;
//   - `unknown_source`    the evidence cites a source that was not in the input,
//                         so no text can be compared (reported separately, never
//                         counted as one of the five text classes).
//
// The validator in src/lib/menuExtractionSchema.js stays authoritative and
// unchanged: this module reuses its exact normalization and never accepts a
// quote that the validator rejects.

const { normalizeEvidenceText } = require('../../src/lib/menuExtractionSchema');

const DIAGNOSIS_SCHEMA_VERSION = 'menu-quote-diagnosis/v1';
const TEXT_CLASSIFICATIONS = Object.freeze(['added_separator', 'merged_lines', 'changed_characters', 'whitespace_only', 'invented_text']);
const CLASSIFICATIONS = Object.freeze([...TEXT_CLASSIFICATIONS, 'unknown_source']);

const CLASS_LABELS_NL = Object.freeze({
  added_separator: 'toegevoegd scheidingsteken',
  merged_lines: 'samengevoegde regels',
  changed_characters: 'gewijzigde tekens',
  whitespace_only: 'gewijzigde witruimte',
  invented_text: 'verzonnen tekst',
  unknown_source: 'onbekende bron',
});

// How a model tends to join source lines that the source keeps apart.
const SEPARATOR_SPLIT = /\s+(?:[-–—|·•+:;]|&|\/)\s+|\r\n|\r|\n|\t|[ ]{2,}/;
const MIN_FRAGMENT_CHARS = 2;
const MAX_NEAREST = 3;
const MAX_NEAREST_CHARS = 240;
const MAX_NEAREST_WINDOWS = 400;
const MAX_REPORTED_QUOTES = 100;
const INVISIBLE_CHARS = /[\u200b\u200c\u200d\u00ad\ufeff]/g;

function stripWhitespace(value) {
  return String(value).replace(/\s+/g, '').replace(INVISIBLE_CHARS, '');
}

function stripCharacters(value) {
  return stripWhitespace(value).replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Splits one source text into candidate fragments at the boundaries a menu page
 * has: lines, tabs, table cells and 2+ spaces. Offsets and line numbers stay
 * exact, so a reported fragment can be found back in the capture.
 */
function segmentsOfText(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const segments = [];
  const boundary = /\r\n|\r|\n|\t|[ ]{2,}/g;
  let line = 1;
  let start = 0;
  const flush = (end) => {
    if (end <= start) return;
    const raw = text.slice(start, end);
    if (raw.trim().length > 0) segments.push({ offset: start, line, text: raw.trim() });
  };
  let match;
  while ((match = boundary.exec(text)) !== null) {
    flush(match.index);
    for (const char of match[0]) if (char === '\n') line += 1;
    start = match.index + match[0].length;
  }
  flush(text.length);
  return segments;
}

/** Long runs are cut into overlapping word windows so a fragment stays readable. */
function windowsOfSegment(segment, captureId, url) {
  const normalized = normalizeEvidenceText(segment.text);
  if (normalized.length <= MAX_NEAREST_CHARS) {
    return [{ captureId, url, line: segment.line, offset: segment.offset, text: segment.text, normalized }];
  }
  const words = segment.text.split(/\s+/).filter((word) => word.length > 0);
  const windows = [];
  let current = [];
  let currentLength = 0;
  let offset = segment.offset;
  const push = () => {
    if (current.length === 0) return;
    const text = current.join(' ');
    windows.push({ captureId, url, line: segment.line, offset, text, normalized: normalizeEvidenceText(text) });
    // An overlap of about one third keeps a fragment that crosses a cut visible.
    const keep = Math.max(1, Math.floor(current.length / 3));
    current = current.slice(current.length - keep);
    currentLength = current.join(' ').length;
    offset += text.length - currentLength;
  };
  for (const word of words) {
    if (currentLength + word.length + 1 > MAX_NEAREST_CHARS && current.length > 0) push();
    current.push(word);
    currentLength += word.length + 1;
  }
  push();
  return windows;
}

function candidateWindows(sources) {
  const windows = [];
  for (const source of Array.isArray(sources) ? sources : []) {
    if (!source || typeof source.text !== 'string') continue;
    for (const segment of segmentsOfText(source.text)) {
      for (const window of windowsOfSegment(segment, source.id, source.url || null)) {
        if (window.normalized.length > 0) windows.push(window);
      }
    }
  }
  return windows;
}

function bigrams(value) {
  const counts = new Map();
  for (let i = 0; i < value.length - 1; i += 1) {
    const gram = value.slice(i, i + 2);
    counts.set(gram, (counts.get(gram) || 0) + 1);
  }
  return counts;
}

/** Sørensen–Dice on character bigrams: deterministic and cheap. */
function similarity(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const first = bigrams(a);
  const second = bigrams(b);
  let overlap = 0;
  for (const [gram, count] of first) {
    const other = second.get(gram);
    if (other) overlap += Math.min(count, other);
  }
  return (2 * overlap) / (a.length - 1 + (b.length - 1));
}


function nearestFragments(quote, windows, maxNearest = MAX_NEAREST) {
  const normalizedQuote = normalizeEvidenceText(quote);
  if (normalizedQuote.length === 0) return [];
  const scored = [];
  for (const window of windows.slice(0, MAX_NEAREST_WINDOWS)) {
    const score = similarity(normalizedQuote, window.normalized);
    if (score <= 0) continue;
    scored.push({ ...window, score });
  }
  scored.sort((a, b) => b.score - a.score || a.offset - b.offset);
  const picked = [];
  const seen = new Set();
  for (const window of scored) {
    if (seen.has(window.normalized)) continue;
    seen.add(window.normalized);
    picked.push({
      captureId: window.captureId,
      url: window.url,
      line: window.line,
      offset: window.offset,
      score: Math.round(window.score * 1000) / 1000,
      text: window.text.length > MAX_NEAREST_CHARS ? `${window.text.slice(0, MAX_NEAREST_CHARS)}…` : window.text,
    });
    if (picked.length >= maxNearest) break;
  }
  return picked;
}

function fragmentsOf(quote) {
  // Split the quote as written (a newline is a boundary the model's own
  // separator can replace), then normalize each part for the source comparison.
  return String(quote)
    .split(SEPARATOR_SPLIT)
    .map((fragment) => normalizeEvidenceText(fragment))
    .filter((fragment) => fragment.length > 0);
}

function anySourceContains(sources, needle, compact) {
  if (!needle) return false;
  const target = compact ? compact(needle) : needle;
  return sources.some((source) => {
    if (!source || typeof source.text !== 'string') return false;
    const haystack = compact ? compact(source.text) : normalizeEvidenceText(source.text);
    return haystack.includes(target);
  });
}

/**
 * The classification of one failed quote. `sources` are the exact inputs the
 * model was given ({ id, text }), so the comparison is against the same text
 * the validator used.
 */
function classifyQuote({ quote, sources, fragments }) {
  const parts = Array.isArray(fragments) ? fragments : fragmentsOf(quote);
  const usable = parts.filter((part) => part.length >= MIN_FRAGMENT_CHARS);
  const found = usable.map((part) => ({ text: part, found: anySourceContains(sources, part) }));
  if (usable.length >= 2 && found.every((part) => part.found)) {
    const joined = usable.join(' ');
    return { classification: anySourceContains(sources, joined) ? 'added_separator' : 'merged_lines', fragments: found };
  }
  if (anySourceContains(sources, quote, stripWhitespace)) return { classification: 'whitespace_only', fragments: found };
  if (anySourceContains(sources, quote, stripCharacters)) return { classification: 'changed_characters', fragments: found };
  return { classification: 'invented_text', fragments: found };
}

function itemsOf(output) {
  const items = [];
  const menus = output && Array.isArray(output.menus) ? output.menus : [];
  menus.forEach((menu, menuIndex) => {
    const categories = menu && Array.isArray(menu.categories) ? menu.categories : [];
    categories.forEach((category, categoryIndex) => {
      const categoryItems = category && Array.isArray(category.items) ? category.items : [];
      categoryItems.forEach((item, itemIndex) => {
        items.push({ at: `menus[${menuIndex}].categories[${categoryIndex}].items[${itemIndex}]`, menu, category, item });
      });
    });
  });
  return items;
}

/**
 * Diagnoses one parsed answer. Nothing is written and nothing is accepted: the
 * counts exist so a rejected answer can be measured without counting it as an
 * extraction.
 *
 * `itemsWithInvalidQuote` counts every item without a usable citation: a
 * missing quote, a quote whose source was not in the input, and a quote that is
 * not present in its source. `itemsWithQuoteNotFound` is the last group alone,
 * the one the live Zuyd rejections fell into.
 */
function diagnoseAnswer({ output, sources, maxNearest = MAX_NEAREST } = {}) {
  const sourceList = Array.isArray(sources) ? sources : [];
  const windows = candidateWindows(sourceList);
  const items = itemsOf(output);
  const result = {
    schemaVersion: DIAGNOSIS_SCHEMA_VERSION,
    items: items.length,
    itemsWithQuote: 0,
    itemsWithoutQuote: 0,
    itemsWithQuoteNotFound: 0,
    itemsWithInvalidQuote: 0,
    itemsWithUnknownSource: 0,
    classes: Object.fromEntries(CLASSIFICATIONS.map((code) => [code, 0])),
    quotes: [],
    quotesNotReported: 0,
  };
  const report = (entry, quote, classification, fragments, nearest) => {
    if (result.quotes.length < MAX_REPORTED_QUOTES) {
      result.quotes.push({
        at: entry.at,
        menuTitle: entry.menu && typeof entry.menu.title === 'string' ? entry.menu.title : null,
        categoryName: entry.category && typeof entry.category.name === 'string' ? entry.category.name : null,
        itemName: entry.item && typeof entry.item.name === 'string' ? entry.item.name : null,
        sourceId: entry.evidence && typeof entry.evidence.sourceId === 'string' ? entry.evidence.sourceId : null,
        locator: entry.evidence && typeof entry.evidence.locator === 'string' ? entry.evidence.locator : null,
        quote,
        classification,
        label: CLASS_LABELS_NL[classification],
        fragments,
        nearest,
      });
    } else {
      result.quotesNotReported += 1;
    }
  };
  for (const item of items) {
    const entry = { ...item, evidence: item.item && item.item.evidence };
    const quote = entry.evidence && typeof entry.evidence.quote === 'string' ? entry.evidence.quote.trim() : '';
    if (quote.length === 0) {
      result.itemsWithoutQuote += 1;
      result.itemsWithInvalidQuote += 1;
      continue;
    }
    result.itemsWithQuote += 1;
    const sourceId = entry.evidence && typeof entry.evidence.sourceId === 'string' ? entry.evidence.sourceId : null;
    const source = sourceList.find((candidate) => candidate && candidate.id === sourceId) || null;
    if (!source || typeof source.text !== 'string') {
      result.itemsWithInvalidQuote += 1;
      result.itemsWithUnknownSource += 1;
      result.classes.unknown_source += 1;
      report(entry, quote, 'unknown_source', [], []);
      continue;
    }
    if (normalizeEvidenceText(source.text).includes(normalizeEvidenceText(quote))) continue;
    result.itemsWithQuoteNotFound += 1;
    result.itemsWithInvalidQuote += 1;
    const classified = classifyQuote({ quote, sources: sourceList });
    result.classes[classified.classification] += 1;
    report(
      entry,
      quote,
      classified.classification,
      classified.fragments,
      nearestFragments(quote, windows.filter((window) => window.captureId === sourceId), maxNearest),
    );
  }
  return result;
}

/**
 * The same diagnosis for saved answer text. Text that is not JSON is reported
 * as such: it has no items to count, which is itself the finding.
 */
function diagnoseRawText({ text, sources, maxNearest = MAX_NEAREST } = {}) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { schemaVersion: DIAGNOSIS_SCHEMA_VERSION, outputParsed: false, parseError: 'empty_answer', items: null };
  }
  let output;
  try {
    output = JSON.parse(text);
  } catch (err) {
    return {
      schemaVersion: DIAGNOSIS_SCHEMA_VERSION,
      outputParsed: false,
      parseError: err && err.message ? err.message : 'not JSON',
      items: null,
    };
  }
  return { outputParsed: true, ...diagnoseAnswer({ output, sources, maxNearest }) };
}

module.exports = {
  CLASSIFICATIONS,
  CLASS_LABELS_NL,
  DIAGNOSIS_SCHEMA_VERSION,
  MAX_REPORTED_QUOTES,
  TEXT_CLASSIFICATIONS,
  candidateWindows,
  classifyQuote,
  diagnoseAnswer,
  diagnoseRawText,
  fragmentsOf,
  itemsOf,
  nearestFragments,
  segmentsOfText,
  similarity,
};
