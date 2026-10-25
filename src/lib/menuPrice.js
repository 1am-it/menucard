// BE-29 (#70) — de eerlijke prijs, gedeeld door de home en de menukaart.
//
// Een prijs voor twee personen of per kilo staat in de bron vaak in de
// beschrijving in plaats van in het prijsveld. Alleen expliciete eenheden
// worden overgenomen; de rest van de beschrijving blijft beschrijving. Zonder
// echte prijs is er geen label: "op aanvraag" telt niet.
//
// Bewust CommonJS, zoals src/lib/dailyDish.js.

'use strict';

const PRICE_QUALIFIER_PATTERN = /(?:per\s+(?:kilo|kilogram|kg|persoon|stuk)|p\/kilo|\bp\.\s?p\.|\bpp\b|(?:voor\s+)?(?:2|twee)\s+personen)/i;

function sourcePriceNotes(item) {
  const notes = [item.priceNote, item.priceUnit, item.priceQualifier];
  const description = typeof item.desc === 'string' ? item.desc : '';
  const match = description.match(PRICE_QUALIFIER_PATTERN);
  if (match) notes.push(match[0]);
  return notes.filter((note) => typeof note === 'string' && note.trim());
}

/**
 * De prijs zoals de bron hem noemt, met een bron-qualifier ("voor 2
 * personen", "per kilo", "per stuk", …) erbij als die in een eigen veld of in
 * de beschrijving staat. Staat de qualifier al in de prijsstring, dan blijft
 * die ongewijzigd.
 * @param {{price?:string,priceValue?:number|null,priceOnRequest?:boolean,
 *   priceNote?:string,priceUnit?:string,priceQualifier?:string,priceIsFrom?:boolean,desc?:string}} item
 * @returns {string|null}
 */
function honestPriceLabel(item) {
  if (!item || typeof item !== 'object') return null;
  if (!item.price || item.priceOnRequest || item.priceValue == null) return null;
  let label = String(item.price).trim();
  if (!label) return null;
  const seen = new Set();
  for (const note of sourcePriceNotes(item)) {
    const clean = note.trim();
    const key = clean.toLowerCase();
    if (seen.has(key) || label.toLowerCase().includes(key)) continue;
    seen.add(key);
    label += ` · ${clean}`;
  }
  if (item.priceIsFrom && !/^vanaf\b/i.test(label)) label = `vanaf ${label}`;
  return label;
}

module.exports = {
  PRICE_QUALIFIER_PATTERN,
  sourcePriceNotes,
  honestPriceLabel,
};
