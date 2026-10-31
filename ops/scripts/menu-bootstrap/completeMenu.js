'use strict';

// BE-71 (#176, besluit 021) — the completeness requirement for the one-off
// startvulling of the Breda menu cards. Pure: no network, no filesystem.
//
// A card only reaches data/menus.json when it passes every check below:
//   - every recognised dish has a price AND a category (besluit 016 §4);
//   - there are no open attention points: no section whose structure the
//     reader is unsure about, no recognised section whose lines were read but
//     not stored as dishes, no dish with several amounts;
//   - at least MIN_DISHES dishes;
//   - every price between € 1 and € 150;
//   - no dish twice within one category.
// A card that fails is skipped with the reasons, never "almost" stored.

const MIN_DISHES = 8;
const MIN_PRICE_EUR = 1;
const MAX_PRICE_EUR = 150;

// One closed vocabulary, so the report and the checkpoint can group the
// reasons without free text.
const REASON_TEXT = {
  no_menu: 'geen menukaart gevonden',
  no_dishes: 'geen gerechten herkend',
  too_few_dishes: `minder dan ${MIN_DISHES} gerechten`,
  uncategorised_dishes: 'gerechten zonder categorie',
  uncertain_sections: 'menukopje met onzekere structuur',
  unpriced_dishes: 'gerechten zonder prijs',
  price_out_of_bounds: `prijs buiten € ${MIN_PRICE_EUR}–€ ${MAX_PRICE_EUR}`,
  duplicate_dishes: 'dubbel gerecht binnen een categorie',
  excluded_sections: 'herkende sectie niet als gerechten opgeslagen',
  price_variants: 'gerecht met meerdere prijzen',
  unread_pdf_lines: 'pdf-regels gelezen maar niet als gerecht opgeslagen',
};

function text(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/** The comparison key for "the same dish within a category". */
function dishKey(name) {
  return text(name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Assesses one read menu: `{ categories: [{ name, uncertain, items: [{ name,
 * price, priceText }] }], attention: [{ code, detail }] }`. Returns
 * `{ ok, reasons: [{ code, text, detail }], dishCount, pricedCount,
 * categoryCount }`. `price` is a number or null.
 */
function assessCompleteMenu(menu) {
  const reasons = [];
  const add = (code, detail) => reasons.push({ code, text: REASON_TEXT[code], ...(detail ? { detail } : {}) });
  const categories = menu && Array.isArray(menu.categories) ? menu.categories : [];
  const dishes = [];
  for (const category of categories) {
    for (const item of (category && Array.isArray(category.items) && category.items) || []) {
      if (item && text(item.name)) dishes.push({ category, item });
    }
  }
  const dishCount = dishes.length;
  const pricedCount = dishes.filter(({ item }) => Number.isFinite(item.price)).length;

  if (!menu) add('no_menu');
  else if (dishCount === 0) add('no_dishes');

  const uncategorised = categories.filter((category) => category && Array.isArray(category.items) && category.items.length > 0 && !text(category.name)).length;
  if (uncategorised > 0) add('uncategorised_dishes', `${uncategorised} sectie(s)`);

  const uncertain = categories.filter((category) => category && category.uncertain === true).length;
  if (uncertain > 0) add('uncertain_sections', `${uncertain} sectie(s)`);

  const unpriced = dishes.filter(({ item }) => !Number.isFinite(item.price));
  if (unpriced.length > 0) add('unpriced_dishes', `${unpriced.length} gerecht(en)`);

  const outOfBounds = dishes.filter(({ item }) => Number.isFinite(item.price) && (item.price < MIN_PRICE_EUR || item.price > MAX_PRICE_EUR));
  if (outOfBounds.length > 0) add('price_out_of_bounds', `${outOfBounds.length} gerecht(en)`);

  const seen = new Map();
  let duplicates = 0;
  for (const { category, item } of dishes) {
    const key = `${text(category.name).toLowerCase()}|${dishKey(item.name)}`;
    if (!key.endsWith('|')) {
      if (seen.has(key)) duplicates += 1;
      else seen.set(key, true);
    }
  }
  if (duplicates > 0) add('duplicate_dishes', `${duplicates} gerecht(en)`);

  if (dishCount > 0 && dishCount < MIN_DISHES) add('too_few_dishes', `${dishCount} gerechten`);

  const attention = menu && Array.isArray(menu.attention) ? menu.attention : [];
  for (const code of ['excluded_sections', 'price_variants', 'unread_pdf_lines']) {
    const count = attention.filter((entry) => entry && entry.code === code).length;
    if (count > 0) add(code, `${count} aandachtspunt(en)`);
  }

  return { ok: reasons.length === 0, reasons, dishCount, pricedCount, categoryCount: categories.length };
}

module.exports = { MIN_DISHES, MIN_PRICE_EUR, MAX_PRICE_EUR, REASON_TEXT, dishKey, assessCompleteMenu };
