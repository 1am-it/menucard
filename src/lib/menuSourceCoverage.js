'use strict';

// Variant 1 of the owner decision 2026-10-24 ("1 en 5 !", Lead order
// 6382189724): compare one captured source text with the dishes of a concept
// and report the source lines that print a price but belong to no dish.
//
// Deterministic and free: no model, no network, no database, no new storage.
// It reuses exactly two existing rules and never adds a second family:
//   - `findPrices` from src/lib/htmlMenuStructure.js is the extraction's own
//     money parser (quantity units such as "0,75 L" included);
//   - `normalizeEvidenceText` / `quoteIsPresentInSource` from
//     src/lib/menuExtractionSchema.js are the validator's one normalization,
//     so "covered" here can never disagree with the validator about what
//     "present in the source" means.
//
// A line is covered when a dish quote overlaps it, in either direction: the
// quote can be the whole line, a part of it, or a longer passage that contains
// the line. A line that a human already handled — a rejected passage, an
// arrangement or a line marked "Geen gerecht" — is accounted and never asked
// again. This module only reports; it never approves, never rejects and never
// invents a price or a name.

const { normalizeEvidenceText } = require('./menuExtractionSchema');
const { findPrices } = require('./htmlMenuStructure');

const COMPARISON_VERSION = 'menu-source-coverage/v1';
const MAX_LINES = 100;
const MAX_LINE_CHARS = 300;
const MAX_NAME_CHARS = 200;
const MAX_SECTION_CHARS = 120;
const UNAVAILABLE_MESSAGE = 'Vergelijking niet beschikbaar voor dit concept';

function bounded(value, max) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\s+/g, ' ').trim();
  return text === '' ? '' : text.slice(0, max);
}

function lettersOf(value) {
  return (String(value || '').match(/\p{L}/gu) || []).length;
}

/**
 * A short line without a price that reads as a printed section heading:
 * "LUNCH", "Bites", "Small bites". Only used as the label "onder <rubriek>";
 * it never becomes concept structure and a wrong guess is shown as a guess.
 */
function looksLikeSectionHeading(line) {
  const text = bounded(line, MAX_SECTION_CHARS + 40);
  if (text.length < 2 || text.length > 80) return false;
  if (lettersOf(text) < 2) return false;
  if (findPrices(text).length > 0) return false;
  if (/[.,;:!?]$/.test(text)) return false;
  // A line that starts with a lower-case letter is prose, not a heading.
  if (/^\p{Ll}/u.test(text)) return false;
  if (/\d{2,}/.test(text)) return false;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 8) return false;
  // A price list, an e-mail address or a URL is never a heading.
  if (/[@/\\]/.test(text)) return false;
  return true;
}

/** The name a printed line prints, with every money token taken out. */
function nameFromLine(line, prices) {
  let rest = '';
  let cursor = 0;
  for (const price of prices) {
    rest += `${line.slice(cursor, price.index)} `;
    cursor = price.index + price.length;
  }
  rest += line.slice(cursor);
  const name = rest
    .replace(/^[\s|·•*–—-]+/, '')
    .replace(/[\s.·•*–—-]{2,}$/, '')
    .replace(/[\s|·•*–—-]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (lettersOf(name) < 2) return null;
  return name.slice(0, MAX_NAME_CHARS);
}

/**
 * The priced lines of one source, in printing order, each with its nearest
 * preceding heading and its own line number. A source without text yields
 * nothing; that is never the same as "no uncovered lines".
 *
 * A capture whose block structure was flattened into one very long line (the
 * benchmark's visible-text reader, or a page without line breaks) is split on
 * the printed cells: the text right before a price is that price's name. That
 * is the same "name before its price" rule the extraction already uses, not a
 * second price parser, and every citation stays a literal part of the source.
 */
function pricedLinesOfSource(source) {
  const text = source && typeof source.text === 'string' ? source.text : '';
  if (!source || source.hasText === false || text.trim() === '') return [];
  const records = [];
  const sourceId = bounded(source.id, 80) || 'bron';
  let section = null;
  const rawLines = text.split(/\r\n|\r|\n/);
  rawLines.forEach((raw, index) => {
    const lineNumber = index + 1;
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    if (trimmed === '') return;
    // A short line is normalized like every other evidence text; a long,
    // flattened line keeps its printed cell gaps for the segmentation below.
    const line = trimmed.length <= MAX_LINE_CHARS ? trimmed.replace(/\s+/g, ' ') : trimmed;
    if (line.length <= MAX_LINE_CHARS) {
      if (looksLikeSectionHeading(line)) {
        section = line.slice(0, MAX_SECTION_CHARS);
        return;
      }
      const prices = findPrices(line);
      if (prices.length === 0) return;
      const name = nameFromLine(line, prices);
      if (!name) return;
      records.push({
        sourceId,
        sourceUrl: bounded(source.url, 500) || null,
        sourceKind: typeof source.kind === 'string' ? source.kind : null,
        lineNumber,
        segment: 0,
        // The line itself stays the citation, exactly as the source prints it.
        text: line,
        name,
        priceText: prices.map((price) => price.raw).join(' / '),
        amountMinorUnits: prices[0].amountMinorUnits,
        amountsMinorUnits: prices.map((price) => price.amountMinorUnits),
        section: section ? section : null,
      });
      return;
    }
    for (const fragment of fragmentsOfFlattenedLine(raw, { section })) {
      if (fragment.section) section = fragment.section;
      records.push({
        sourceId,
        sourceUrl: bounded(source.url, 500) || null,
        sourceKind: typeof source.kind === 'string' ? source.kind : null,
        lineNumber,
        segment: fragment.segment,
        text: fragment.text,
        name: fragment.name,
        priceText: fragment.priceText,
        amountMinorUnits: fragment.amountMinorUnits,
        amountsMinorUnits: [fragment.amountMinorUnits],
        section: fragment.section || section || null,
      });
    }
  });
  return records;
}

/** The printed cells of a flattened line, split on runs of two or more spaces. */
function cellsOfFlattenedLine(text) {
  return String(text || '')
    .split(/\s{2,}/)
    .map((cell) => cell.replace(/\s+/g, ' ').trim())
    .filter((cell) => cell !== '');
}

/**
 * One record per printed price of a flattened line: the cell right before the
 * price is its name, an earlier heading-like cell is the section. The text is
 * the name plus the printed price, so the citation stays in the source.
 */
function fragmentsOfFlattenedLine(line, { section = null } = {}) {
  const fragments = [];
  const prices = findPrices(line);
  let previousEnd = 0;
  let currentSection = section;
  prices.forEach((price, index) => {
    const cells = cellsOfFlattenedLine(line.slice(previousEnd, price.index));
    previousEnd = price.index + price.length;
    if (cells.length === 0) return;
    const name = cells[cells.length - 1];
    const headings = cells.slice(0, -1).filter((cell) => looksLikeSectionHeading(cell));
    if (headings.length > 0) currentSection = headings[headings.length - 1].slice(0, MAX_SECTION_CHARS);
    if (lettersOf(name) < 2) return;
    const boundedName = name.slice(0, MAX_NAME_CHARS);
    fragments.push({
      segment: index + 1,
      name: boundedName,
      text: `${boundedName} ${price.raw}`.replace(/\s+/g, ' ').trim().slice(0, MAX_LINE_CHARS),
      priceText: price.raw,
      amountMinorUnits: price.amountMinorUnits,
      section: currentSection,
    });
  });
  return fragments;
}

/** Every quote and rejected passage the concept already carries, normalized. */
function conceptEvidence(menus, rejected) {
  const quotes = [];
  for (const menu of Array.isArray(menus) ? menus : []) {
    for (const category of Array.isArray(menu && menu.categories) ? menu.categories : []) {
      for (const item of Array.isArray(category && category.items) ? category.items : []) {
        const quote = item && item.evidence && typeof item.evidence.quote === 'string' ? item.evidence.quote : '';
        const normalized = normalizeEvidenceText(quote);
        if (normalized !== '') quotes.push({ sourceId: (item.evidence.sourceId || null), normalized });
      }
    }
  }
  for (const entry of Array.isArray(rejected) ? rejected : []) {
    const normalized = normalizeEvidenceText(entry && typeof entry.text === 'string' ? entry.text : '');
    if (normalized !== '') quotes.push({ sourceId: entry && entry.sourceId ? entry.sourceId : null, normalized });
  }
  return quotes;
}

/** "Geen gerecht" decisions this human already made, as normalized passages. */
function accountedPassages(accounted) {
  return (Array.isArray(accounted) ? accounted : [])
    .map((entry) => ({
      sourceId: entry && entry.sourceId ? entry.sourceId : null,
      lineNumber: entry && Number.isInteger(entry.lineNumber) ? entry.lineNumber : null,
      normalized: normalizeEvidenceText(entry && typeof entry.text === 'string' ? entry.text : ''),
    }))
    .filter((entry) => entry.normalized !== '');
}

function overlaps(normalized, passages) {
  return passages.some((passage) => {
    if (!passage.normalized) return false;
    return normalized.includes(passage.normalized) || passage.normalized.includes(normalized);
  });
}

function unavailable(reason) {
  return {
    available: false,
    version: COMPARISON_VERSION,
    reason: reason || 'capture_unavailable',
    message: UNAVAILABLE_MESSAGE,
    lines: [],
    total: 0,
    shown: 0,
    omitted: 0,
    omittedLabel: null,
  };
}

/**
 * The comparison itself.
 *
 *   sources   — the capture text per source ({ id, url, kind, text, hasText });
 *   menus     — the dishes of the concept, each with its own citation;
 *   rejected  — the concept's rejected passages;
 *   accounted — lines a human already marked "Geen gerecht";
 *   limit     — at most this many lines, with an honest "en nog N".
 *
 * A missing or empty capture is reported as unavailable, never as zero
 * uncovered lines.
 */
function compareCaptureWithConcept({ sources, menus, rejected, accounted, limit } = {}) {
  const usable = (Array.isArray(sources) ? sources : []).filter(
    (source) => source && typeof source.text === 'string' && source.text.trim() !== '' && source.hasText !== false,
  );
  if (usable.length === 0) return unavailable('capture_unavailable');

  const evidence = conceptEvidence(menus, rejected);
  const humanAccounted = accountedPassages(accounted);
  const cap = Number.isInteger(limit) && limit > 0 ? Math.min(limit, MAX_LINES) : MAX_LINES;

  const lines = [];
  let total = 0;
  for (const source of usable) {
    const sourceId = bounded(source.id, 80) || 'bron';
    for (const record of pricedLinesOfSource(source)) {
      const normalized = normalizeEvidenceText(record.text);
      if (normalized === '') continue;
      // A quote without a sourceId still counts for every source: the
      // validator only accepts a quote that is present in the cited source.
      const coveredByDish = evidence.some(
        (entry) => (entry.sourceId === null || entry.sourceId === record.sourceId) && overlaps(normalized, [entry]),
      );
      if (coveredByDish) continue;
      // A human decision never comes back: same source and line number, or
      // the same printed line when the store only kept the text.
      const accountedByHuman = humanAccounted.some(
        (entry) =>
          (entry.sourceId === null || entry.sourceId === record.sourceId) &&
          (entry.lineNumber === null || entry.lineNumber === record.lineNumber) &&
          overlaps(normalized, [entry]),
      );
      if (accountedByHuman) continue;
      total += 1;
      if (lines.length < cap) {
        const segment = Number.isInteger(record.segment) ? record.segment : 0;
        lines.push({
          ...record,
          id: segment > 0 ? `${record.sourceId}:${record.lineNumber}:${segment}` : `${record.sourceId}:${record.lineNumber}`,
          sourceLabel: `${record.sourceId} · ${record.sourceKind === 'pdf' ? 'PDF' : record.sourceKind === 'html' ? 'website' : 'bron'}`,
          locator: segment > 0 ? `regel ${record.lineNumber}, deel ${segment}` : `regel ${record.lineNumber}`,
        });
      }
    }
  }

  const omitted = total - lines.length;
  return {
    available: true,
    version: COMPARISON_VERSION,
    reason: null,
    message: null,
    lines,
    total,
    shown: lines.length,
    omitted,
    omittedLabel: omitted > 0 ? `en nog ${omitted}` : null,
  };
}

/** The item a "Toevoegen" click creates, from the server's own line only. */
function itemFromPricedLine(line) {
  if (!line || typeof line.text !== 'string' || typeof line.sourceId !== 'string') {
    return { ok: false, code: 'unknown_line', message: 'Deze regel staat niet meer open. Laad de review opnieuw.' };
  }
  const prices = findPrices(line.text);
  if (prices.length === 0) {
    return { ok: false, code: 'line_without_price', message: 'Deze regel heeft geen herkenbare prijs.' };
  }
  const name = nameFromLine(line.text, prices);
  if (!name) {
    return { ok: false, code: 'line_without_name', message: 'Deze regel bevat geen herkenbare gerechtnaam.' };
  }
  const evidence = {
    sourceId: line.sourceId,
    locator: Number.isInteger(line.segment) && line.segment > 0 ? `regel ${line.lineNumber}, deel ${line.segment}` : `regel ${line.lineNumber}`,
    quote: line.text,
  };
  if (prices.length === 1) {
    return {
      ok: true,
      name,
      item: { name, priceStatus: 'known', amountMinorUnits: prices[0].amountMinorUnits, currency: 'EUR', evidence },
    };
  }
  // Two printed prices stay two printed prices: the human chooses one in the
  // existing "twee prijzen" step instead of the app collapsing them.
  return {
    ok: true,
    name,
    item: {
      name,
      priceStatus: 'multiple_undecomposed',
      priceVariants: prices.map((price) => ({ label: null, amountMinorUnits: price.amountMinorUnits, currency: 'EUR' })),
      evidence,
    },
  };
}

module.exports = {
  COMPARISON_VERSION,
  MAX_LINES,
  UNAVAILABLE_MESSAGE,
  looksLikeSectionHeading,
  nameFromLine,
  pricedLinesOfSource,
  compareCaptureWithConcept,
  itemFromPricedLine,
};

