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

const { extractHtmlMenuStructure } = require('../../../src/lib/htmlMenuStructure');
const { structurePdfLinesIntoMenu } = require('../../../src/lib/pdfMenuStructuring');
const { extractDigitalPdfLines, extractDigitalPdfTextWithFallback } = require('../../../src/lib/pdfTextExtraction');

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
 * Reads one HTML page with the deterministic HTML menu reader. Returns
 * `{ kind: 'html', title, categories, attention, refusal }`; `refusal` names
 * the reader's own reason (`too_few_items`, `content_not_menu_suspected`, …)
 * so a read page never looks like an empty one.
 */
function readHtmlMenu(html) {
  let result = null;
  try {
    result = extractHtmlMenuStructure(String(html || ''));
  } catch {
    return { kind: 'html', title: null, categories: [], attention: [], refusal: { status: 'unparsed', reason: 'reader_error' } };
  }
  if (!result || result.status !== 'parsed') {
    return { kind: 'html', title: null, categories: [], attention: [], refusal: { status: (result && result.status) || 'unparsed', reason: (result && result.reason) || null } };
  }
  const categories = [];
  for (const section of Array.isArray(result.sections) ? result.sections : []) {
    const path = (Array.isArray(section.path) ? section.path : []).map((label) => String(label || '').trim()).filter(Boolean);
    const items = [];
    for (const item of Array.isArray(section.items) ? section.items : []) {
      const name = typeof item.name === 'string' ? item.name.trim() : '';
      if (!name) continue;
      const priced = item.priceStatus === 'known' && Number.isInteger(item.amountMinorUnits);
      items.push({
        name,
        desc: typeof item.description === 'string' ? item.description : '',
        price: priced ? Number((item.amountMinorUnits / 100).toFixed(2)) : null,
        ...(priced ? {} : { priceStatus: item.priceStatus || 'unknown', priceText: item.priceText || null }),
      });
    }
    if (items.length === 0) continue;
    categories.push({ name: path.length > 0 ? path[path.length - 1] : null, path, uncertain: section.uncertain === true, items });
  }
  const stats = (result && result.stats) || {};
  const attention = [];
  const excluded = Array.isArray(result.excludedSections) ? result.excludedSections : [];
  if (excluded.length > 0) attention.push({ code: 'excluded_sections', detail: `${excluded.length} sectie(s)` });
  const variants = (Number.isInteger(stats.priceVariantLines) ? stats.priceVariantLines : 0) + (Number.isInteger(stats.priceVariantItems) ? stats.priceVariantItems : 0);
  if (variants > 0) attention.push({ code: 'price_variants', detail: `${variants} gerecht(en)` });
  return { kind: 'html', title: null, categories, attention, refusal: null };
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

module.exports = { parsePrintedPrice, readHtmlMenu, readPdfMenu };
