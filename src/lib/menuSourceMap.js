'use strict';

// Z2/Z3 of the Delivery Lead order 6382953597 (variant 5): the original card
// with markings.
//
// Pure and free: no model, no network, no database and no new storage. It reuses
// the one comparison engine (`analyseCapture` in menuSourceCoverage.js), the
// extraction's own price parser and the validator's normalization, so the card
// can never disagree with the nalopen block about what is covered.
//
// Two shapes:
//   - `buildSourceMap`  — the compact index that travels with the review: per
//     source and page how many lines carry which mark, and the marks themselves
//     without the captured text;
//   - `buildSourceCard` — one printed page of one source, requested lazily,
//     with the captured lines and where their marks sit.
//
// `chooseCardView` decides how a source is shown. A PDF page image needs the
// PDF bytes; the import keeps only the text it read (no byte store, no
// re-fetch), so the honest answer is the text view with that limit spelled out.
// A source without text is an image: it cannot be compared yet.

const { analyseCapture, sourceTextLines } = require('./menuSourceCoverage');
const { imageProvenance } = require('./menuImageRead');

const SOURCE_MAP_VERSION = 'menu-source-map/v1';
const MAX_MARKS = 300;
const MAX_CARD_LINES = 400;
const MAX_CARD_LINE_CHARS = 300;
const MAX_NAME_CHARS = 200;
const MAX_CARD_CHARS = 60_000;
const UNAVAILABLE_MESSAGE = 'Vergelijking niet beschikbaar voor dit concept';

// The colour language of the card: every mark carries its own text, so colour is
// never the only carrier (screen readers get the same words).
const LEGEND = Object.freeze([
  Object.freeze({
    tone: 'covered',
    label: 'Overgenomen',
    detail: 'Groen met een doorgetrokken rand: dit gerecht staat in het concept met dezelfde prijs.',
  }),
  Object.freeze({
    tone: 'uncovered',
    label: 'Niet overgenomen',
    detail: 'Oranje met een gestippelde rand: deze regel met een prijs staat niet in het concept.',
  }),
  Object.freeze({
    tone: 'price_mismatch',
    label: 'Prijs wijkt af',
    detail: 'Rood met een dubbele rand: de prijs in het concept verschilt van de prijs op de kaart.',
  }),
  Object.freeze({
    tone: 'not_dish',
    label: 'Geen gerecht',
    detail: 'Grijs: deze regel is afgewezen of eerder als geen gerecht beoordeeld.',
  }),
]);

const IMAGE_NOTICE = 'Deze kaart is een afbeelding; vergelijken kan nog niet.';
const WEBSITE_NOTICE = 'Opgehaalde tekst van de website';
// BE-33 (#79, criterion 3): a menu that was read from images is shown as those
// images beside the dishes that came from them. Nothing here is comparable with
// text, and every dish keeps "Controle nodig".
const IMAGE_MENU_NOTICE =
  'Deze menukaart bestaat uit afbeeldingen. De tekst is niet automatisch te vergelijken; elk gerecht is met AI gelezen van een afbeelding en heeft daarom "Controle nodig".';
const PDF_SCAN_NOTICE =
  'Deze PDF heeft geen tekstlaag; de pagina zelf wordt niet bewaard. Elk gerecht is met AI gelezen van een pagina en heeft daarom "Controle nodig".';
const PDF_TEXT_NOTICE =
  'De echte PDF-pagina kan niet worden getoond: de import bewaart de PDF-bytes niet en haalt de bron niet opnieuw op. Je ziet de opgehaalde tekst met dezelfde regelnummers.';

function bounded(value, max) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\s+/g, ' ').trim();
  return text === '' ? '' : text.slice(0, max);
}

function euroText(amountMinorUnits) {
  if (!Number.isInteger(amountMinorUnits)) return null;
  return `€ ${(amountMinorUnits / 100).toFixed(2).replace('.', ',')}`;
}

/**
 * How this source is shown (Z3). No new dependency and no new storage are added:
 * a PDF page image would need the PDF bytes, and the import keeps only the text.
 * BE-33 (#79): a source whose menu was read from images shows those images and
 * the dishes that came from them; a scan PDF keeps the honest text-only card.
 */
function chooseCardView({ kind, hasText = true, pageCount = 1, images } = {}) {
  const imageList = Array.isArray(images) ? images : [];
  if (imageList.length > 0) {
    return {
      mode: 'images',
      label: imageList.length === 1 ? 'Menukaart · 1 afbeelding' : `Menukaart · ${imageList.length} afbeeldingen`,
      notice: IMAGE_MENU_NOTICE,
      pageRenderable: true,
      reason: 'image_menu',
    };
  }
  if (hasText === false) {
    if (kind === 'pdf') {
      return {
        mode: 'pdf_scan',
        label: pageCount > 1 ? `PDF zonder tekstlaag · ${pageCount} pagina's` : 'PDF zonder tekstlaag',
        notice: PDF_SCAN_NOTICE,
        pageRenderable: false,
        reason: 'no_text_layer',
      };
    }
    return {
      mode: 'image',
      label: 'Afbeelding zonder tekst',
      notice: IMAGE_NOTICE,
      pageRenderable: false,
      reason: 'no_text_layer',
    };
  }
  if (kind === 'pdf') {
    return {
      mode: 'pdf_text',
      label: pageCount > 1 ? `PDF · ${pageCount} pagina's` : 'PDF · 1 pagina',
      notice: PDF_TEXT_NOTICE,
      pageRenderable: false,
      reason: 'pdf_bytes_not_kept',
    };
  }
  if (kind === 'html') {
    return { mode: 'website_text', label: 'Website', notice: WEBSITE_NOTICE, pageRenderable: false, reason: 'html_text' };
  }
  return { mode: 'source_text', label: 'Bron', notice: 'Opgehaalde tekst van de bron', pageRenderable: false, reason: 'source_text' };
}

/** The word a mark uses for screen readers; colour alone never carries it. */
function describeMark({ tone, name, priceText, conceptPriceText, rowId } = {}) {
  const label = name || 'regel zonder gerechtnaam';
  if (tone === 'covered') return `${label}: overgenomen${conceptPriceText ? `, concept ${conceptPriceText}` : ''}`;
  if (tone === 'uncovered') return `${label}: niet overgenomen${priceText ? `, kaart ${priceText}` : ''}`;
  if (tone === 'price_mismatch') {
    return `${label}: prijs wijkt af, kaart ${priceText || 'onbekend'} en concept ${conceptPriceText || 'onbekend'}`;
  }
  if (tone === 'not_dish') return `${label}: geen gerecht${rowId ? '' : ', eerder beoordeeld'}`;
  return label;
}

function lineId(record) {
  const segment = Number.isInteger(record.segment) ? record.segment : 0;
  return segment > 0 ? `${record.sourceId}:${record.lineNumber}:${segment}` : `${record.sourceId}:${record.lineNumber}`;
}

function locatorFor(record) {
  const segment = Number.isInteger(record.segment) ? record.segment : 0;
  if (Number.isInteger(record.nameLineNumber) && record.nameLineNumber !== record.lineNumber) {
    return `regels ${record.nameLineNumber}–${record.lineNumber}`;
  }
  return segment > 0 ? `regel ${record.lineNumber}, deel ${segment}` : `regel ${record.lineNumber}`;
}

function markOf(record, priceChoices) {
  const name = bounded(record.name, MAX_NAME_CHARS) || null;
  const priceText = bounded(record.priceText, 40) || null;
  const conceptPriceText = record.dish && Array.isArray(record.dish.amounts) && record.dish.amounts.length > 0
    ? record.dish.amounts.map((amount) => euroText(amount)).filter(Boolean).join(' / ')
    : null;
  const rowId = record.dish ? record.dish.rowId : null;
  const markerLine = record.paired && Number.isInteger(record.nameLineNumber) ? record.nameLineNumber : record.lineNumber;
  // Z4: a human already took the printed price for this dish. The mark stays
  // red until the concept is saved with that price, and says what was taken.
  const taken = rowId && priceChoices && typeof priceChoices === 'object' ? priceChoices[rowId] : null;
  const takenAmount = taken && Number.isInteger(taken.amountMinorUnits) ? taken.amountMinorUnits : null;
  const takenPriceText = takenAmount === null ? null : euroText(takenAmount);
  return {
    id: lineId(record),
    tone: record.tone,
    label: (LEGEND.find((entry) => entry.tone === record.tone) || {}).label || 'Onbekend',
    ariaLabel: `${describeMark({ tone: record.tone, name, priceText, conceptPriceText, rowId })}${
      takenPriceText ? `, prijs overgenomen: ${takenPriceText}` : ''
    }`,
    name,
    priceText,
    conceptPriceText,
    priceTaken: takenPriceText !== null,
    takenPriceText,
    rowId,
    section: bounded(record.section, 120) || null,
    sourceId: record.sourceId,
    page: record.page || 1,
    lineNumber: record.lineNumber,
    markerLine,
    endLine: record.lineNumber,
    locator: locatorFor(record),
    paired: record.paired === true,
    loose: record.loose === true,
    // A line without a printed name can be dismissed but not added: a name is
    // never invented for it.
    canAdd: typeof record.name === 'string' && record.name.trim() !== '',
  };
}

/** How many marks of each kind one source has, for the head of the card. */
function countsOf(records) {
  const counts = { covered: 0, uncovered: 0, priceMismatch: 0, notDish: 0, total: records.length };
  for (const record of records) {
    if (record.tone === 'covered') counts.covered += 1;
    else if (record.tone === 'price_mismatch') counts.priceMismatch += 1;
    else if (record.tone === 'not_dish') counts.notDish += 1;
    else counts.uncovered += 1;
  }
  return counts;
}

/** The dishes the AI read from one image/page, for the card beside the image. */
function imageDishesOf({ menus, sourceId, number, kind }) {
  const dishes = [];
  for (const [m, menu] of (Array.isArray(menus) ? menus : []).entries()) {
    const categories = Array.isArray(menu && menu.categories) ? menu.categories : [];
    for (const [c, category] of categories.entries()) {
      const items = Array.isArray(category && category.items) ? category.items : [];
      for (const [i, item] of items.entries()) {
        const evidence = item && item.evidence && typeof item.evidence === 'object' ? item.evidence : null;
        if (!evidence || evidence.sourceId !== sourceId) continue;
        const provenance = imageProvenance(evidence.locator);
        if (!provenance || provenance.number !== number || (kind && provenance.kind !== kind)) continue;
        dishes.push({
          rowId: `${m}.${c}.${i}`,
          name: typeof item.name === 'string' ? item.name.slice(0, MAX_NAME_CHARS) : '',
          priceText: bounded(item.priceText, 40) || euroText(item.amountMinorUnits) || 'Prijs onbekend',
          provenance: provenance.label,
          // Criterion 3: nothing read from an image is approved by itself.
          needsCheck: true,
          label: 'Controle nodig',
        });
      }
    }
  }
  return dishes;
}

function imageViewOf(source, menus) {
  const images = Array.isArray(source && source.images) ? source.images : [];
  const view = chooseCardView({ kind: source && source.kind, hasText: source && source.hasText !== false, images });
  const numbers = images.map((image) => (Number.isInteger(image.number) ? image.number : null)).filter((number) => number !== null);
  const kind = source && source.kind === 'image' ? 'image' : 'page';
  const perImage = numbers.map((number) => ({
    number,
    kind,
    dishes: imageDishesOf({ menus, sourceId: source.id, number, kind }),
  }));
  return { view, images, perImage };
}

/** The compact index of the card: sources, counts and marks, never the text. */
function buildSourceMap({ sources, menus, rejected, accounted, limit, priceChoices } = {}) {
  const analysis = analyseCapture({ sources, menus, rejected, accounted });
  const cap = Number.isInteger(limit) && limit > 0 ? Math.min(limit, MAX_MARKS) : MAX_MARKS;
  const listed = Array.isArray(sources) && sources.length > 0 ? sources : analysis.sources;
  const imageSourceList = (Array.isArray(listed) ? listed : []).filter(
    (source) => source && ((Array.isArray(source.images) && source.images.length > 0) || (source.imageRead === true && source.kind === 'pdf')),
  );
  if (!analysis.available && imageSourceList.length === 0) {
    return {
      available: false,
      version: SOURCE_MAP_VERSION,
      reason: analysis.reason,
      message: UNAVAILABLE_MESSAGE,
      legend: LEGEND,
      sources: [],
      marks: [],
      total: 0,
      shown: 0,
      omitted: 0,
      omittedLabel: null,
    };
  }
  const analysedById = new Map((analysis.available ? analysis.sources : []).map((source) => [source.id, source]));
  const marks = [];
  let total = 0;
  const sourcesOut = [];
  // Every source of the import is listed, also one without any text: an image or
  // a scan is an honest card of its own, never silently missing.
  for (const raw of listed) {
    const source = analysedById.get(raw && raw.id) || null;
    if (!source) {
      const image = imageViewOf(raw || {}, menus);
      const scanPages = raw && Number.isInteger(raw.pageCount) && raw.pageCount > 0 ? raw.pageCount : 0;
      sourcesOut.push({
        id: raw && raw.id ? raw.id : 'bron',
        label: null,
        url: (raw && typeof raw.url === 'string' ? raw.url : null) || null,
        kind: raw && typeof raw.kind === 'string' ? raw.kind : null,
        pageCount: image.images.length > 0 ? image.images.length : scanPages,
        imageCount: image.images.length,
        view: image.view,
        counts: countsOf([]),
      });
      continue;
    }
    sourcesOut.push({
      id: source.id,
      label: source.label,
      url: source.url,
      kind: source.kind,
      pageCount: source.pageCount,
      view: chooseCardView({ kind: source.kind, hasText: true, pageCount: source.pageCount }),
      counts: countsOf(source.records),
    });
    for (const record of source.records) {
      total += 1;
      if (marks.length < cap) marks.push(markOf(record, priceChoices));
    }
  }
  const omitted = total - marks.length;
  return {
    available: true,
    version: SOURCE_MAP_VERSION,
    reason: null,
    message: null,
    legend: LEGEND,
    sources: sourcesOut,
    marks,
    total,
    shown: marks.length,
    omitted,
    omittedLabel: omitted > 0 ? `en nog ${omitted} regels` : null,
  };
}

/**
 * One printed page of one source with its marks (Z3, lazy). Bounded per page:
 * the caller asks for exactly one page, and the card names what it leaves out.
 */
function buildSourceCard({ sources, menus, rejected, accounted, sourceId, page = 1, priceChoices } = {}) {
  const source = (Array.isArray(sources) ? sources : []).find((entry) => entry && entry.id === sourceId) || null;
  if (!source) {
    return { available: false, version: SOURCE_MAP_VERSION, reason: 'unknown_source', message: 'Deze bron hoort niet bij deze import.', legend: LEGEND };
  }
  const text = typeof source.text === 'string' ? source.text : '';
  const { lines: allLines, pageCount } = sourceTextLines(source);
  const imageSource = Array.isArray(source.images) ? source.images : [];
  const knownPages = Number.isInteger(source.pageCount) && source.pageCount > 0 ? source.pageCount : Math.max(1, pageCount);
  const view = chooseCardView({ kind: source.kind, hasText: source.hasText !== false && text.trim() !== '', pageCount: knownPages, images: imageSource });
  const analysis = analyseCapture({ sources: [source], menus, rejected, accounted });
  const records = analysis.available ? analysis.sources[0].records : [];
  const head = {
    available: true,
    version: SOURCE_MAP_VERSION,
    legend: LEGEND,
    source: { id: source.id, label: null, url: source.url || null, kind: source.kind || null, pageCount: imageSource.length > 0 ? imageSource.length : pageCount, view },
    counts: countsOf(records),
  };
  if (view.mode === 'images') {
    // BE-33 (#79, criterion 3): the image itself beside the dishes the AI read
    // from it. One image per page; nothing is approved here.
    const total = imageSource.length;
    if (!Number.isInteger(page) || page < 1 || page > total) {
      return { ...head, available: false, reason: 'page_out_of_range', message: 'Deze afbeelding bestaat niet bij deze bron.' };
    }
    const image = imageSource[page - 1] || {};
    const number = Number.isInteger(image.number) ? image.number : page;
    const kind = source.kind === 'image' ? 'image' : 'page';
    return {
      ...head,
      page: { number: page, total, lines: [] },
      images: [{ number, url: typeof image.url === 'string' ? image.url : null, alt: typeof image.alt === 'string' ? image.alt : null }],
      dishes: imageDishesOf({ menus, sourceId: source.id, number, kind }),
      marks: [],
      omittedLines: 0,
      omittedLabel: null,
    };
  }
  if (view.mode === 'pdf_scan') {
    // BE-33 (#79): a scan has no bytes to render here (the existing limitation),
    // but the page number of every dish stays visible next to it.
    const total = knownPages;
    if (!Number.isInteger(page) || page < 1 || page > total) {
      return { ...head, available: false, reason: 'page_out_of_range', message: 'Deze pagina bestaat niet op deze kaart.' };
    }
    return {
      ...head,
      page: { number: page, total, lines: [] },
      images: [],
      dishes: imageDishesOf({ menus, sourceId: source.id, number: page, kind: 'page' }),
      marks: [],
      omittedLines: 0,
      omittedLabel: null,
    };
  }
  if (view.mode === 'image') {
    // Nothing to show and nothing to compare: the card says so instead of
    // drawing an empty page.
    return { ...head, page: { number: 1, total: 1, lines: [] }, marks: [], omittedLines: 0, omittedLabel: null };
  }
  if (!Number.isInteger(page) || page < 1 || page > pageCount) {
    return { ...head, available: false, reason: 'page_out_of_range', message: 'Deze pagina bestaat niet op deze kaart.' };
  }
  const byLine = new Map();
  for (const record of records) {
    const mark = markOf(record, priceChoices);
    for (const number of [mark.markerLine, mark.endLine]) {
      if (!byLine.has(number)) byLine.set(number, mark);
    }
  }
  const lines = [];
  let chars = 0;
  let omittedLines = 0;
  for (const line of allLines.filter((entry) => entry.page === page)) {
    if (lines.length >= MAX_CARD_LINES || chars >= MAX_CARD_CHARS) {
      omittedLines += 1;
      continue;
    }
    const textOfLine = line.text.slice(0, MAX_CARD_LINE_CHARS);
    const mark = byLine.get(line.number) || null;
    lines.push({
      number: line.number,
      text: textOfLine,
      markId: mark ? mark.id : null,
      tone: mark ? mark.tone : null,
      // The button sits on the first line of the mark; a pair's price line is
      // visibly part of the same mark without a second button.
      marker: Boolean(mark && mark.markerLine === line.number),
      ariaLabel: mark && mark.markerLine === line.number ? mark.ariaLabel : null,
    });
    chars += textOfLine.length;
  }
  const marks = [];
  const seen = new Set();
  for (const record of records) {
    if ((record.page || 1) !== page) continue;
    const mark = markOf(record, priceChoices);
    if (seen.has(mark.id)) continue;
    seen.add(mark.id);
    marks.push(mark);
  }
  return {
    ...head,
    page: { number: page, total: pageCount, lines },
    marks,
    omittedLines,
    omittedLabel: omittedLines > 0 ? `en nog ${omittedLines} regels op deze pagina` : null,
  };
}

module.exports = {
  SOURCE_MAP_VERSION,
  MAX_MARKS,
  MAX_CARD_LINES,
  MAX_CARD_LINE_CHARS,
  UNAVAILABLE_MESSAGE,
  IMAGE_NOTICE,
  IMAGE_MENU_NOTICE,
  PDF_SCAN_NOTICE,
  WEBSITE_NOTICE,
  PDF_TEXT_NOTICE,
  LEGEND,
  buildSourceCard,
  buildSourceMap,
  chooseCardView,
  describeMark,
  euroText,
  imageDishesOf,
};
