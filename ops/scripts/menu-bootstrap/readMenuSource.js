'use strict';

// BE-71 (#176, besluit 021) — "Lezen": the existing deterministic readers
// only. No AI, no Anthropic SDK, no paid service, no new parser.
//   - html: src/lib/htmlMenuStructure.js's extractHtmlMenuStructure
//   - pdf : src/lib/pdfTextExtraction.js + src/lib/pdfMenuStructuring.js,
//           exactly the pair the url-intake reads a PDF with
//           (src/lib/restaurantSourceAnalysis.js's readPdfMenuSource).
// The result is one neutral `{ kind, title, categories, attention }` menu; the
// completeness requirement (./completeMenu.js) and the output shape
// (./menuEntry.js) are separate.

const { extractHtmlMenuStructure, isSentenceHeading } = require('../../../src/lib/htmlMenuStructure');
const { structurePdfLinesIntoMenu } = require('../../../src/lib/pdfMenuStructuring');
const { extractDigitalPdfLines, extractDigitalPdfTextWithFallback } = require('../../../src/lib/pdfTextExtraction');

// R5 (correctielog BE-71, eigenaar 1 nov 2026 5b) — a card that prints its
// extras under a heading of their own ("Extra vlees", "Toeslagen",
// "Supplement", "Bijbestellen") prices them as an addition to a dish, never as
// a dish of their own. Only that printed heading decides it; a dish whose
// description happens to mention a supplement stays an ordinary dish.
const SUPPLEMENT_HEADING_PATTERN = /\b(extra|extras|toeslag|toeslagen|supplement(?:en)?|bijbestellen|bijbestelling(?:en)?)\b/i;

function isSupplementHeading(label) {
  return typeof label === 'string' && SUPPLEMENT_HEADING_PATTERN.test(label);
}

/** R9 — a sentence above the real categories is context, not a category. */
function normalizeLabel(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** The page's own title, split into its parts ("Home - Restaurant Zenza"). */
function titleLabels(title) {
  if (typeof title !== 'string' || !title.trim()) return new Set();
  const parts = title.split(/\s+[|–—·]\s+|\s+-\s+/).map(normalizeLabel).filter(Boolean);
  return new Set([normalizeLabel(title), ...parts]);
}

function withoutContextLabels(path, title) {
  const labels = [...path];
  const titles = titleLabels(title);
  // R9 — a sentence above the real categories is context for the card. The
  // shared reader only refuses a closing mark or a form of "zijn"/"is"; the
  // startvulling adds the six-word rule of R9 itself. The page's own title
  // (the h1 "Home" above a card printed on a homepage) is context too, but is
  // only dropped while a real category label remains.
  const sentence = (value) => isSentenceHeading(value) || String(value || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length > 6;
  let changed = true;
  while (changed && labels.length > 0) {
    changed = false;
    if (sentence(labels[0])) {
      labels.shift();
      changed = true;
      continue;
    }
    if (labels.length > 1 && titles.has(normalizeLabel(labels[0]))) {
      labels.shift();
      changed = true;
    }
  }
  return labels;
}

/** A printed amount ("12,50", "12.50", "€ 12,50", "12,-") as a number. */
function parsePrintedPrice(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const match = value.replace(/\s/g, '').match(/(\d{1,3})(?:[.,](\d{1,2}))?/);
  if (!match) return null;
  const amount = Number(`${match[1]}.${match[2] || '0'}`);
  return Number.isFinite(amount) ? amount : null;
}

/**
 * The document title of one html page, for the soort of the card (a page can
 * live on `/menu/` while its own title says "Lunchkaart"). Read from the
 * `<title>` element only: no guessing from the body.
 */
function pageTitle(html) {
  const match = String(html || '').match(/<title\b[^>]*>([\s\S]{1,300}?)<\/title>/i);
  if (!match) return null;
  const text = match[1]
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

/**
 * Reads one HTML page with the deterministic HTML menu reader. Returns
 * `{ kind: 'html', title, categories, attention, refusal }`; `refusal` names
 * the reader's own reason (`too_few_items`, `content_not_menu_suspected`, …)
 * so a read page never looks like an empty one.
 */
function readHtmlMenu(html) {
  const title = pageTitle(html);
  let result = null;
  try {
    result = extractHtmlMenuStructure(String(html || ''));
  } catch {
    return { kind: 'html', title, categories: [], attention: [], refusal: { status: 'unparsed', reason: 'reader_error' } };
  }
  if (!result || result.status !== 'parsed') {
    return { kind: 'html', title, categories: [], attention: [], refusal: { status: (result && result.status) || 'unparsed', reason: (result && result.reason) || null } };
  }
  const categories = [];
  for (const section of Array.isArray(result.sections) ? result.sections : []) {
    const rawPath = (Array.isArray(section.path) ? section.path : []).map((label) => String(label || '').trim()).filter(Boolean);
    // R9 — a sentence above the real categories ("Al onze gerechten zijn 100%
    // halal") is context for the card, not the section its dishes belong to.
    const path = withoutContextLabels(rawPath, title);
    // R5 — the printed heading decides whether these lines are extras.
    const supplementSection = path.some(isSupplementHeading);
    const items = [];
    for (const item of Array.isArray(section.items) ? section.items : []) {
      const name = typeof item.name === 'string' ? item.name.trim() : '';
      if (!name) continue;
      const priced = item.priceStatus === 'known' && Number.isInteger(item.amountMinorUnits);
      const supplement = item.evidence && typeof item.evidence.supplementText === 'string' ? item.evidence.supplementText.trim() : '';
      items.push({
        name,
        desc: typeof item.description === 'string' ? item.description : '',
        price: priced ? Number((item.amountMinorUnits / 100).toFixed(2)) : null,
        // A supplement is an addition to a dish, never a dish of its own: the
        // output keeps it and prints "+ € 4" (R5).
        ...(supplementSection ? { priceIsSupplement: true, supplementText: supplement.slice(0, 120) } : {}),
        ...(priced ? {} : { priceStatus: item.priceStatus || 'unknown', priceText: item.priceText || null }),
      });
    }
    if (items.length === 0) continue;
    categories.push({
      name: path.length > 0 ? path[path.length - 1] : null,
      path,
      // After the context label is gone only a real sentence label in the
      // remaining route still makes the section uncertain.
      uncertain: path.some(isSentenceHeading),
      ...(supplementSection ? { supplementSection: true } : {}),
      items,
    });
  }
  const stats = (result && result.stats) || {};
  const attention = [];
  const excluded = Array.isArray(result.excludedSections) ? result.excludedSections : [];
  if (excluded.length > 0) attention.push({ code: 'excluded_sections', detail: `${excluded.length} sectie(s)` });
  const variants = (Number.isInteger(stats.priceVariantLines) ? stats.priceVariantLines : 0) + (Number.isInteger(stats.priceVariantItems) ? stats.priceVariantItems : 0);
  if (variants > 0) attention.push({ code: 'price_variants', detail: `${variants} gerecht(en)` });
  return { kind: 'html', title, categories, attention, refusal: null };
}


/**
 * Reads one digital PDF with the deterministic PDF readers. Bytes that carry
 * no text layer (a scanned card) are refused with `no_text_layer`, never sent
 * to OCR or a model.
 */
async function readPdfMenu(bytes) {
  let fallback;
  try {
    fallback = await extractDigitalPdfTextWithFallback(bytes);
  } catch (error) {
    return { kind: 'pdf', title: null, categories: [], attention: [], refusal: { status: 'unreadable', reason: (error && error.reason) || 'pdf_extraction_failed' } };
  }
  if (!fallback || fallback.usedFallback || !String(fallback.text || '').trim()) {
    return {
      kind: 'pdf',
      title: null,
      categories: [],
      attention: [],
      refusal: { status: 'unparsed', reason: 'no_text_layer' },
      pageCount: (fallback && fallback.pageCount) || null,
    };
  }
  let pages = [];
  try {
    ({ pages } = await extractDigitalPdfLines(bytes));
  } catch (error) {
    return {
      kind: 'pdf',
      title: null,
      categories: [],
      attention: [],
      refusal: { status: 'unreadable', reason: (error && error.reason) || 'pdf_extraction_failed' },
      pageCount: fallback.pageCount || null,
    };
  }
  const structured = structurePdfLinesIntoMenu(pages);
  const categories = [];
  for (const category of Array.isArray(structured.categories) ? structured.categories : []) {
    const path = (Array.isArray(category.path) ? category.path : []).map((label) => String(label || '').trim()).filter(Boolean);
    const items = [];
    for (const item of Array.isArray(category.items) ? category.items : []) {
      const name = typeof item.name === 'string' ? item.name.trim() : '';
      if (!name) continue;
      const price = parsePrintedPrice(item.price);
      items.push({
        name,
        desc: typeof item.desc === 'string' ? item.desc : '',
        price,
        ...(price === null ? { priceStatus: item.priceStatus || 'unknown', priceText: item.priceText || null } : {}),
      });
    }
    if (items.length === 0) continue;
    categories.push({ name: path.length > 0 ? path[path.length - 1] : null, path, uncertain: category.uncertain === true, items });
  }
  const layout = (structured && structured.layout) || {};
  const unread =
    (Number.isInteger(layout.ambiguousPriceLines) ? layout.ambiguousPriceLines : 0) +
    (Number.isInteger(layout.unlinkedPriceLines) ? layout.unlinkedPriceLines : 0) +
    (Number.isInteger(layout.arrangementLines) ? layout.arrangementLines : 0) +
    (Number.isInteger(layout.unrecognizedHeadingLines) ? layout.unrecognizedHeadingLines : 0) +
    (Number.isInteger(layout.supplementLines) ? layout.supplementLines : 0);
  const attention = unread > 0 ? [{ code: 'unread_pdf_lines', detail: `${unread} regel(s)` }] : [];
  return {
    kind: 'pdf',
    title: typeof layout.documentTitle === 'string' ? layout.documentTitle : null,
    categories,
    attention,
    refusal: null,
    pageCount: fallback.pageCount || null,
    wordCount: String(fallback.text || '').trim().split(/\s+/).length,
  };
}

module.exports = { parsePrintedPrice, pageTitle, readHtmlMenu, readPdfMenu };
