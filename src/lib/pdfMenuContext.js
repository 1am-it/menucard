'use strict';

// A discovered digital PDF is one source. Its deterministic menu recognition
// (src/lib/pdfMenuStructuring.js) returns `recognizedSections`; this module is
// the one place those sections become the SAME menu-context shape the HTML
// extractor already produces. That keeps receipt, review summary, batch status
// and concept storage on one result instead of a PDF-only parallel path.
//
// Pure and browser-safe: no fetch, no filesystem, no PDF parser. The caller
// supplies already-extracted section data. Confidence is deliberately NOT
// carried over; only source locators and the extractor's content hash are
// evidence. A missing section heading is marked uncertain, never guessed.

const { normalizeMenuHierarchy } = require('./menuHierarchy');

const MAX_TEXT = 160;

function boundedText(value) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, MAX_TEXT) : null;
}

function boundedNonEmpty(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function uniqueContextSlug(usedSlugs) {
  const used = usedSlugs instanceof Set ? usedSlugs : new Set();
  let slug = 'menukaart';
  for (let i = 1; used.has(slug); i += 1) {
    slug = `menukaart${String.fromCharCode(97 + ((i - 1) % 26))}${i > 26 ? Math.floor((i - 1) / 26) : ''}`;
  }
  return slug;
}

/**
 * Turns one unknown menu context with recognized PDF sections into
 * `{ menu, itemCount }`, or `null` when there is no reviewable item.
 *
 * `context` is the additive shape produced by
 * src/lib/restaurantSourceAnalysis.js buildUnknownMenuContext:
 *   { sourceUrl, sourceId?, extractionMethod, pageCount, wordCount,
 *     contentHash, usedFallback, recognizedSections: [
 *       { name: string|null, items: [{ name, desc, price, contentHash }] }
 *     ] }
 * Every section keeps its source position. A null heading becomes a real,
 * uncertain fallback section ("Overig" via menuHierarchy), never an invented
 * category name.
 */
function pdfContextToMenuContext(context, usedSlugs, options = {}) {
  if (!context || !Array.isArray(context.recognizedSections)) return null;

  const sections = context.recognizedSections
    .map((section, position) => {
      const name = boundedText(section && section.name);
      const items = ((section && Array.isArray(section.items) && section.items) || [])
        .map((item, itemIndex) => {
          const itemName = boundedText(item && item.name);
          if (!itemName) return null;
          const evidence = { locator: `pdf:${position + 1}:item:${itemIndex + 1}` };
          const contentHash = boundedNonEmpty(item && item.contentHash);
          if (contentHash) evidence.contentHash = contentHash;
          return {
            name: itemName,
            desc: boundedText(item && item.desc),
            price: boundedText(item && item.price),
            evidence,
          };
        })
        .filter(Boolean);
      return { name, position, items };
    })
    .filter((section) => section.items.length > 0);

  if (sections.length === 0) return null;

  const hierarchy = normalizeMenuHierarchy(
    sections.map((section) => (section.name ? [section.name] : [])),
    sections.map((section) => !section.name)
  );

  const categories = sections.map((section, index) => {
    const shape = hierarchy.categories[index];
    const category = {
      name: shape.name,
      path: shape.path,
      sourcePath: shape.sourcePath,
      position: section.position,
      locator: `pdf:${section.position + 1}`,
      items: section.items,
    };
    // A section without its own heading is structurally uncertain even when
    // it is the only section; it must be reviewed, never accepted by default.
    if (shape.uncertain || !section.name) category.uncertain = true;
    return category;
  });

  const sourceSlug = uniqueContextSlug(usedSlugs);
  const menu = {
    name: 'Menukaart',
    contextSlug: sourceSlug,
    title: hierarchy.title,
    structure: hierarchy.structure,
    categories,
    extractionMethod: 'pdf_text',
    sourceUrl: boundedNonEmpty(context.sourceUrl),
  };
  const sourceId = boundedNonEmpty(options.sourceId || context.sourceId);
  if (sourceId) menu.sourceId = sourceId;

  return {
    menu,
    itemCount: sections.reduce((count, section) => count + section.items.length, 0),
  };
}

/** All recognized PDF contexts of one job, with unique menu context slugs. */
function menusFromUnknownContexts(unknownMenuContexts) {
  const used = new Set();
  const menus = [];
  for (const context of Array.isArray(unknownMenuContexts) ? unknownMenuContexts : []) {
    const converted = pdfContextToMenuContext(context, used);
    if (!converted) continue;
    menus.push(converted.menu);
    used.add(converted.menu.contextSlug);
  }
  return menus;
}

module.exports = {
  pdfContextToMenuContext,
  menusFromUnknownContexts,
  uniqueContextSlug,
};
