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
const { findPrices, findPrintedPrices } = require('./htmlMenuStructure');

const COMPARISON_VERSION = 'menu-source-coverage/v1';
const MAX_LINES = 100;
const MAX_LINE_CHARS = 300;
const MAX_NAME_CHARS = 200;
const MAX_SECTION_CHARS = 120;
// Z1 (Lead order 6382953597): a line that prints only a price may belong to the
// nearest preceding printed line, but never further back than this.
const PAIR_LOOKBACK_LINES = 2;
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

/**
 * AA1: the printed cell right before a whole-euro price, used as the name.
 * `cellsOfFlattenedLine` is the same cell rule the long rows already use, so
 * there is no second way to read a printed column. Returns null when the cell
 * holds no usable name, and the caller falls back to the line rule.
 */
function nameFromPrintedCell(line, price) {
  const from = Math.max(0, price.index - MAX_NAME_CHARS - 40);
  const cells = cellsOfFlattenedLine(String(line || '').slice(from, price.index));
  const cell = cells.length > 0 ? cells[cells.length - 1] : '';
  if (lettersOf(cell) < 2) return null;
  return cell.slice(0, MAX_NAME_CHARS);
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
 * The printed lines of one source with their page and their global line number.
 * Deterministic and free: the same text always gives the same numbers, so a
 * decision on line 7 stays line 7 on the next step.
 *
 * PDF text may keep a form feed between pages; that character ends the current
 * line and starts the next page. Without a form feed the whole captured text is
 * one page, exactly as the importer read that one URL.
 */
function sourceTextLines(source) {
  const text = source && typeof source.text === 'string' ? source.text : '';
  if (!source || source.hasText === false || text.trim() === '') return { lines: [], pageCount: 0 };
  const lines = [];
  let page = 1;
  let lineNumber = 0;
  let buffer = '';
  // True right after a line break or at the start of the text, so a page break
  // that sits on that boundary never adds an empty line number.
  let atLineStart = true;
  const flush = () => {
    lineNumber += 1;
    const raw = buffer.trim();
    if (raw !== '') {
      lines.push({
        number: lineNumber,
        page,
        raw,
        // A short line is normalized like every other evidence text; a long,
        // flattened line keeps its printed cell gaps for the segmentation below.
        text: raw.length <= MAX_LINE_CHARS ? raw.replace(/\s+/g, ' ') : raw,
      });
    }
    buffer = '';
    atLineStart = true;
  };
  for (const segment of text.split(/(\r\n|\r|\n|\f)/)) {
    if (segment === '\r\n' || segment === '\r' || segment === '\n') {
      flush();
      continue;
    }
    if (segment === '\f') {
      // A page break: the line before it belongs to this page, the next one to
      // the following page.
      if (atLineStart) page += 1;
      else {
        flush();
        page += 1;
      }
      continue;
    }
    buffer += segment;
    // An empty segment is the empty line between two separators; it never
    // starts a page on its own.
    if (segment !== '') atLineStart = false;
  }
  flush();
  return { lines, pageCount: page };
}

/** A printed line that holds nothing but a price: "24,50", "€ 12,50", "8,-". */
function isPriceOnlyLine(text, prices) {
  if (!Array.isArray(prices) || prices.length === 0) return false;
  let rest = '';
  let cursor = 0;
  for (const price of prices) {
    rest += text.slice(cursor, price.index);
    cursor = price.index + price.length;
  }
  rest += text.slice(cursor);
  if (lettersOf(rest) >= 2) return false;
  // A quantity or a multiplier ("2 x 6,50") is not a price on its own line.
  return !/\d/.test(rest.replace(/[.,]/g, ''));
}

/**
 * The line a price-only line belongs to, from the printed lines right above it.
 *
 * Only the nearest preceding line is a candidate, and only when it prints text
 * without a price. A heading or another priced line in between ends the search:
 * a guessed coupling is never allowed, the price line then stays loose and is
 * shown as such. A decorative line ("—") is skipped; an already used name line
 * is not reused.
 */
function partnerForPriceLine(recent) {
  const candidates = (Array.isArray(recent) ? recent : []).slice(-PAIR_LOOKBACK_LINES).reverse();
  for (const entry of candidates) {
    if (!entry) continue;
    if (entry.kind === 'heading' || entry.kind === 'priced') return null;
    if (entry.kind !== 'text' || !entry.line) continue;
    if (entry.used) return null;
    if (findPrintedPrices(entry.line.raw).length > 0) return null;
    if (lettersOf(entry.line.text) < 2) continue;
    return entry;
  }
  return null;
}

/** A priced record: the shape both the nalopen block and the map read. */
function pricedRecord(base, record) {
  return {
    ...base,
    nameLineNumber: record.nameLineNumber === undefined ? null : record.nameLineNumber,
    segment: record.segment || 0,
    page: record.page || base.page || 1,
    paired: record.paired === true,
    loose: record.loose === true,
    // AA1 (Lead review 6383853638): the price was a printed whole euro, so the
    // record still has to be confirmed by a second such line in its section.
    wholeEuro: record.wholeEuro === true,
    text: record.text,
    name: record.name === undefined ? null : record.name,
    priceText: record.priceText,
    amountMinorUnits: record.amountMinorUnits,
    amountsMinorUnits: record.amountsMinorUnits,
    section: record.section || null,
  };
}

/** The group a whole euro has to repeat in: its section on its own page. */
function wholeEuroGroupKey(record) {
  return `${record.section || ''}#${record.page || 1}`;
}

/**
 * Where this price is printed. A normal line is one printed row; a flattened
 * capture line holds several printed rows of the card (one dish cell plus its
 * price cell each), and those rows are already separate records with their own
 * `segment`. Counting them as one row would hide a whole price column that the
 * capture collapsed into a single line.
 */
function printedRowOf(record) {
  const segment = Number.isInteger(record.segment) ? record.segment : 0;
  const line = Number.isInteger(record.nameLineNumber) ? record.nameLineNumber : record.lineNumber;
  return segment > 0 ? `${line}:${segment}` : `${line}`;
}

/**
 * AA1 (Lead review 6383853638): a whole euro counts only when the same section
 * prints it on at least two printed rows. A single bare integer is also a house
 * number, a weight or a guess, so it stays a plain number and disappears from
 * the comparison.
 */
function confirmWholeEuros(records) {
  const rows = new Map();
  for (const record of records) {
    if (!record.wholeEuro) continue;
    const key = wholeEuroGroupKey(record);
    if (!rows.has(key)) rows.set(key, new Set());
    rows.get(key).add(printedRowOf(record));
  }
  return records.filter((record) => {
    if (!record.wholeEuro) return true;
    return (rows.get(wholeEuroGroupKey(record)) || new Set()).size >= 2;
  });
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
 *
 * Z1: when a line prints nothing but a price, the nearest preceding text line
 * within the same section names it, and the two lines count as one priced line.
 * A price line without such a partner (or with more than one price) stays a
 * loose price line: it is reported, never silently dropped and never coupled to
 * a name the source does not place there.
 */
function pricedLinesOfSource(source, { requireSectionConfirmation = true } = {}) {
  const text = source && typeof source.text === 'string' ? source.text : '';
  if (!source || source.hasText === false || text.trim() === '') return [];
  const sourceId = bounded(source.id, 80) || 'bron';
  const base = {
    sourceId,
    sourceUrl: bounded(source.url, 500) || null,
    sourceKind: typeof source.kind === 'string' ? source.kind : null,
  };
  const records = [];
  // The last two printed lines, so a price on its own line can see the name
  // that precedes it without looking any further.
  let recent = [];
  let section = null;
  const lines = sourceTextLines(source).lines;
  const priceInfo = lines.map((line) => {
    // AA1: the same money parser, extended with a confirmed whole euro. The
    // PRICES are read from the printed line, never from the whitespace-collapsed
    // copy: the runs of spaces between the columns are exactly what proves a
    // whole euro ("Zeebaars 34    geschroeid").
    const prices = findPrintedPrices(line.raw);
    return { prices, priceOnly: isPriceOnlyLine(line.raw, prices) };
  });
  lines.forEach((line, index) => {
    const lineBase = { ...base, lineNumber: line.number, page: line.page };
    if (line.text.length > MAX_LINE_CHARS) {
      for (const fragment of fragmentsOfFlattenedLine(line.raw, { section })) {
        if (fragment.section) section = fragment.section;
        records.push(
          pricedRecord(lineBase, {
            segment: fragment.segment,
            text: fragment.text,
            name: fragment.name,
            priceText: fragment.priceText,
            amountMinorUnits: fragment.amountMinorUnits,
            amountsMinorUnits: [fragment.amountMinorUnits],
            section: fragment.section || section || null,
            wholeEuro: fragment.wholeEuro === true,
          }),
        );
      }
      recent = [{ kind: 'priced' }];
      return;
    }
    const prices = priceInfo[index].prices;
    // A heading introduces a list, so it is a heading only when the next
    // printed line is not the price that belongs to it. "Fictieve carpaccio"
    // directly above "11,00" is that dish's name, not a section.
    const nextLine = index + 1 < lines.length ? priceInfo[index + 1] : null;
    const followedByPrice = Boolean(nextLine && nextLine.priceOnly && nextLine.prices.length === 1);
    if (looksLikeSectionHeading(line.text) && !followedByPrice) {
      section = line.text.slice(0, MAX_SECTION_CHARS);
      recent = [{ kind: 'heading' }];
      return;
    }
    if (prices.length === 0) {
      recent = [...recent, { kind: 'text', line }].slice(-PAIR_LOOKBACK_LINES);
      return;
    }
    const priceOnly = priceInfo[index].priceOnly;
    const partner = priceOnly ? partnerForPriceLine(recent) : null;
    if (partner && prices.length === 1) {
      partner.used = true;
      records.push(
        pricedRecord(lineBase, {
          nameLineNumber: partner.line.number,
          paired: true,
          // Both printed lines stay the citation: the name and its price as the
          // card prints them, nothing invented in between.
          text: `${partner.line.text} ${prices[0].raw}`.replace(/\s+/g, ' ').trim(),
          name: partner.line.text.slice(0, MAX_NAME_CHARS),
          priceText: prices[0].raw,
          amountMinorUnits: prices[0].amountMinorUnits,
          amountsMinorUnits: prices.map((price) => price.amountMinorUnits),
          section,
          wholeEuro: prices.every((price) => price.wholeEuro === true),
        }),
      );
    } else {
      // AA1: a whole euro proves where the printed cell ends, so the cell right
      // before it is the name — the description that follows the price is not
      // part of it. A normal money token keeps the existing name rule.
      const cellName = prices.length === 1 && prices[0].wholeEuro === true ? nameFromPrintedCell(line.raw, prices[0]) : null;
      const name = priceOnly ? null : cellName || nameFromLine(line.raw, prices);
      records.push(
        pricedRecord(lineBase, {
          // A line that prints a price but no name stays visible as a loose
          // price line instead of disappearing.
          loose: !name,
          text: line.text,
          name,
          priceText: prices.map((price) => price.raw).join(' / '),
          amountMinorUnits: prices[0].amountMinorUnits,
          amountsMinorUnits: prices.map((price) => price.amountMinorUnits),
          section,
          wholeEuro: prices.every((price) => price.wholeEuro === true),
        }),
      );
    }
    recent = [...recent, { kind: 'priced' }].slice(-PAIR_LOOKBACK_LINES);
  });
  // AA1: a whole euro still needs a second printed line in its own section.
  return requireSectionConfirmation === false ? records : confirmWholeEuros(records);
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
 *
 * AA1 (Lead review 6383853638): the same money parser, extended with a whole
 * euro. A flattened card prints its columns as runs of spaces, so the cell
 * right before "34" in "Zeebaars 34    geschroeid" is the name and the run
 * behind it is the printed boundary the whole-euro rule asks for.
 */
function fragmentsOfFlattenedLine(line, { section = null } = {}) {
  const fragments = [];
  const prices = findPrintedPrices(line);
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
      wholeEuro: price.wholeEuro === true,
    });
  });
  return fragments;
}

/**
 * Every quote and rejected passage the concept already carries, normalized,
 * with the dish it belongs to. The row id is the same `${menu}.${category}.${item}`
 * the review already uses, so a mark on the card can hand the human straight to
 * the existing row actions.
 */
function conceptEvidence(menus, rejected) {
  const quotes = [];
  (Array.isArray(menus) ? menus : []).forEach((menu, m) => {
    const categories = Array.isArray(menu && menu.categories) ? menu.categories : [];
    categories.forEach((category, c) => {
      const items = Array.isArray(category && category.items) ? category.items : [];
      items.forEach((item, i) => {
        const evidence = item && item.evidence && typeof item.evidence === 'object' ? item.evidence : null;
        const quote = evidence && typeof evidence.quote === 'string' ? evidence.quote : '';
        const normalized = normalizeEvidenceText(quote);
        if (normalized === '') return;
        const variants = Array.isArray(item.priceVariants)
          ? item.priceVariants.map((variant) => (variant && Number.isInteger(variant.amountMinorUnits) ? variant.amountMinorUnits : null)).filter((amount) => amount !== null)
          : [];
        quotes.push({
          kind: 'dish',
          sourceId: evidence.sourceId || null,
          normalized,
          rowId: `${m}.${c}.${i}`,
          name: typeof item.name === 'string' ? item.name : null,
          // A dish without a price is not a different price; the review already
          // asks for it separately.
          amounts: variants.length > 0 ? variants : Number.isInteger(item.amountMinorUnits) ? [item.amountMinorUnits] : [],
          priced: variants.length > 0 || Number.isInteger(item.amountMinorUnits),
        });
      });
    });
  });
  for (const entry of Array.isArray(rejected) ? rejected : []) {
    const normalized = normalizeEvidenceText(entry && typeof entry.text === 'string' ? entry.text : '');
    if (normalized !== '') quotes.push({ kind: 'rejected', sourceId: entry && entry.sourceId ? entry.sourceId : null, normalized });
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
 * Every priced line of every usable source with its meaning for this concept:
 *
 *   covered        a dish quote overlaps the line and its price is the same;
 *   price_mismatch a dish quote overlaps the line but the concept prints another
 *                  price for that dish (the red mark, Z2);
 *   uncovered      no dish covers this line (the orange mark);
 *   not_dish       a rejected passage or an earlier human "Geen gerecht".
 *
 * Pure and deterministic. It never approves, never rejects and never invents a
 * price, a name or a coupling.
 */
function analyseCapture({ sources, menus, rejected, accounted } = {}) {
  const usable = (Array.isArray(sources) ? sources : []).filter(
    (source) => source && typeof source.text === 'string' && source.text.trim() !== '' && source.hasText !== false,
  );
  if (usable.length === 0) return { available: false, version: COMPARISON_VERSION, reason: 'capture_unavailable', sources: [] };
  const evidence = conceptEvidence(menus, rejected);
  const humanAccounted = accountedPassages(accounted);
  const analysed = usable.map((source) => {
    const sourceId = bounded(source.id, 80) || 'bron';
    const records = pricedLinesOfSource(source).map((record) => {
      const normalized = normalizeEvidenceText(record.text);
      // A quote without a sourceId still counts for every source: the validator
      // only accepts a quote that is present in the cited source.
      const covering = normalized === ''
        ? []
        : evidence.filter((entry) => (entry.sourceId === null || entry.sourceId === sourceId) && overlaps(normalized, [entry]));
      const dish = covering.find((entry) => entry.kind === 'dish') || null;
      // A human decision never comes back: same source and line number, or the
      // same printed line when the store only kept the text.
      const accountedByHuman = !dish && normalized !== '' && humanAccounted.some(
        (entry) =>
          (entry.sourceId === null || entry.sourceId === sourceId) &&
          (entry.lineNumber === null || entry.lineNumber === record.lineNumber) &&
          overlaps(normalized, [entry]),
      );
      let tone = 'uncovered';
      if (dish) {
        const samePrice = !dish.priced || record.amountsMinorUnits.some((amount) => dish.amounts.includes(amount));
        tone = samePrice ? 'covered' : 'price_mismatch';
      } else if (covering.length > 0 || accountedByHuman) {
        tone = 'not_dish';
      }
      return {
        ...record,
        tone,
        dish: dish
          ? { rowId: dish.rowId, name: dish.name, amounts: dish.amounts, priced: dish.priced }
          : null,
        accounted: Boolean(accountedByHuman),
      };
    });
    return {
      id: sourceId,
      url: bounded(source.url, 500) || null,
      kind: typeof source.kind === 'string' ? source.kind : null,
      label: bounded(source.label || source.title, 120) || null,
      pageCount: sourceTextLines(source).pageCount,
      records,
    };
  });
  return { available: true, version: COMPARISON_VERSION, reason: null, sources: analysed };
}

/** The uncovered line as the review and the map show it, with a stable id. */
function publicLine(record) {
  const segment = Number.isInteger(record.segment) ? record.segment : 0;
  const id = segment > 0 ? `${record.sourceId}:${record.lineNumber}:${segment}` : `${record.sourceId}:${record.lineNumber}`;
  return {
    ...record,
    id,
    sourceLabel: `${record.sourceId} · ${record.sourceKind === 'pdf' ? 'PDF' : record.sourceKind === 'html' ? 'website' : 'bron'}`,
    locator: locatorOf(record),
  };
}

/** "regel 7", "regel 7, deel 2" or, for a pair, "regels 6–7". */
function locatorOf(record) {
  const segment = Number.isInteger(record.segment) ? record.segment : 0;
  if (Number.isInteger(record.nameLineNumber) && record.nameLineNumber !== record.lineNumber) {
    return `regels ${record.nameLineNumber}–${record.lineNumber}`;
  }
  return segment > 0 ? `regel ${record.lineNumber}, deel ${segment}` : `regel ${record.lineNumber}`;
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
  const analysis = analyseCapture({ sources, menus, rejected, accounted });
  if (!analysis.available) return unavailable(analysis.reason);
  const cap = Number.isInteger(limit) && limit > 0 ? Math.min(limit, MAX_LINES) : MAX_LINES;
  const lines = [];
  let total = 0;
  for (const source of analysis.sources) {
    for (const record of source.records) {
      if (record.tone !== 'uncovered') continue;
      total += 1;
      if (lines.length < cap) lines.push(publicLine(record));
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
  // The server's own reading of this line wins: a whole euro can never be
  // recovered from the whitespace-collapsed display text, and re-parsing what
  // the screen shows would silently refuse a price the server already proved.
  const parsed = findPrintedPrices(line.text);
  const recorded = Array.isArray(line.amountsMinorUnits) && line.amountsMinorUnits.length > 0 && line.amountsMinorUnits.every(Number.isInteger)
    ? line.amountsMinorUnits
    : parsed.map((price) => price.amountMinorUnits);
  if (recorded.length === 0) {
    return { ok: false, code: 'line_without_price', message: 'Deze regel heeft geen herkenbare prijs.' };
  }
  // A pair carries the printed name of its own line; a loose price line has
  // none, and no name is ever invented for it.
  const name = typeof line.name === 'string' && line.name.trim() !== '' ? line.name.trim().slice(0, MAX_NAME_CHARS) : nameFromLine(line.text, parsed);
  if (!name) {
    return { ok: false, code: 'line_without_name', message: 'Deze regel bevat geen herkenbare gerechtnaam.' };
  }
  const evidence = {
    sourceId: line.sourceId,
    locator: locatorOf(line),
    quote: line.text,
  };
  if (recorded.length === 1) {
    return {
      ok: true,
      name,
      locator: evidence.locator,
      item: { name, priceStatus: 'known', amountMinorUnits: recorded[0], currency: 'EUR', evidence },
    };
  }
  // Two printed prices stay two printed prices: the human chooses one in the
  // existing "twee prijzen" step instead of the app collapsing them.
  return {
    ok: true,
    name,
    locator: evidence.locator,
    item: {
      name,
      priceStatus: 'multiple_undecomposed',
      priceVariants: recorded.map((amount) => ({ label: null, amountMinorUnits: amount, currency: 'EUR' })),
      evidence,
    },
  };
}

module.exports = {
  COMPARISON_VERSION,
  MAX_LINES,
  PAIR_LOOKBACK_LINES,
  UNAVAILABLE_MESSAGE,
  analyseCapture,
  isPriceOnlyLine,
  locatorOf,
  looksLikeSectionHeading,
  nameFromLine,
  partnerForPriceLine,
  pricedLinesOfSource,
  publicLine,
  sourceTextLines,
  compareCaptureWithConcept,
  itemFromPricedLine,
};

