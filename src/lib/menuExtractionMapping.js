'use strict';

// Maps a validated `menu-extraction-output/v1` object into the product's
// existing menu-context shape. It never decides trust or approval. Anything the
// current concept cannot store losslessly is rejected by the caller before this
// function is used (see unsupportedProductFields); a price that has no known
// amount stays null and becomes an explicit review blocker downstream.

function bounded(value, max) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

function mapItem(item, sourceUrl, index) {
  const out = {
    name: bounded(item && item.name, 200),
    desc: bounded(item && item.description, 1000),
    price: item && item.priceStatus === 'known' && Number.isInteger(item.amountMinorUnits) ? (item.amountMinorUnits / 100).toFixed(2) : null,
    priceStatus: item && item.priceStatus,
    evidence: {
      locator: bounded(item && item.evidence && item.evidence.locator, 200),
      quote: bounded(item && item.evidence && item.evidence.quote, 500),
    },
  };
  if (sourceUrl) out.evidence.sourceUrl = sourceUrl;
  if (item && typeof item.priceText === 'string') out.priceText = bounded(item.priceText, 160);
  return out;
}

function mapStructuredOutputToMenuContexts(output, sources) {
  const sourceById = new Map((Array.isArray(sources) ? sources : []).map((source) => [source.id, source]));
  return (Array.isArray(output && output.menus) ? output.menus : []).map((menu, index) => {
    const source = sourceById.get(menu.sourceId) || null;
    const title = bounded(menu.title, 160);
    return {
      name: title || 'Menukaart',
      contextSlug: `ai-${index + 1}`,
      title,
      structure: 'normalized',
      sourceId: menu.sourceId,
      ...(source && source.url ? { sourceUrl: source.url } : {}),
      extractionMethod: 'ai_structured',
      categories: (menu.categories || []).map((category) => ({
        name: bounded(category.name, 160) || 'Overig',
        ...(Array.isArray(category.path) ? { path: category.path.map((p) => bounded(p, 160)).filter(Boolean) } : {}),
        ...(category.uncertain === true ? { uncertain: true } : {}),
        items: (category.items || []).map((item, i) => mapItem(item, source && source.url, i)),
      })),
    };
  });
}

module.exports = { mapStructuredOutputToMenuContexts };
