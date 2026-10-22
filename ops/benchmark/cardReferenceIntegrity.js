'use strict';

// Integrity helpers for the criterion-5 existing-card reference (#59 Delivery
// Lead order 6347355753, K1). The pinned Bardot card is a two-column PDF in
// which the dish name and its amount share one baseline but are separate text
// items, so a reference row cannot prove its price with one contiguous quote.
// Instead every reference row records a price proof (page, column, baseline)
// and this module resolves that baseline back to the pinned bytes: the amount
// must really occur on the stated row, and the row text is reported so the
// Lead can verify the name-price relation against the pinned source.
//
// Pure: the caller supplies the extracted lines of the pinned PDF. No fetch,
// parser, provider, database or publication here.

const CARD_COLUMN_SPLIT_X = 330;
// The pinned card prints rows two units apart (e.g. y=744 and y=742 in one
// column), so a proof must name the exact printed baseline, never a range.
const ROW_TOLERANCE = 0.1;

function normalizeAmount(value) {
  return String(value == null ? '' : value).replace(/,/g, '.').trim();
}

function normalizeText(value) {
  return String(value == null ? '' : value)
    .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
    .replace(/[\u201c\u201d\u201e]/g, '"')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function columnOf(x) {
  return Number(x) < CARD_COLUMN_SPLIT_X ? 'left' : 'right';
}

/**
 * Groups the extracted lines of one page into rows per column: the pinned card
 * prints the left and right column on the same baselines, so a row must never
 * mix them.
 */
function cardRows(pages) {
  const rows = [];
  for (const page of Array.isArray(pages) ? pages : []) {
    for (const line of Array.isArray(page && page.lines) ? page.lines : []) {
      const cells = { left: [], right: [] };
      for (const item of Array.isArray(line.items) ? line.items : []) {
        const text = normalizeText(item && item.str);
        if (!text) continue;
        cells[columnOf(item.x)].push({ x: Number(item.x), text });
      }
      for (const column of ['left', 'right']) {
        if (cells[column].length === 0) continue;
        rows.push({
          page: page.pageNumber,
          y: Number(line.y),
          column,
          cells: cells[column],
          text: cells[column].map((cell) => `${cell.x.toFixed(1)}:${cell.text}`).join(' | '),
        });
      }
    }
  }
  return rows;
}

/** The pinned row a price proof points at, or null. */
function findPriceRow(rows, proof) {
  if (!proof || !Number.isFinite(proof.y) || !Number.isInteger(proof.page)) return null;
  const candidates = rows.filter((row) => row.page === proof.page
    && row.column === proof.column
    && Math.abs(row.y - proof.y) <= ROW_TOLERANCE);
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * Every reference row that states a price must carry a proof that resolves to
 * the amount on the pinned row. Returns `{ ok, errors, proofs }`.
 */
function verifyCardPriceProofs(reference, pages) {
  const rows = cardRows(pages);
  const errors = [];
  const proofs = [];
  for (const menu of Array.isArray(reference && reference.menus) ? reference.menus : []) {
    for (const category of Array.isArray(menu.categories) ? menu.categories : []) {
      for (const item of Array.isArray(category.items) ? category.items : []) {
        const amounts = [];
        if (typeof item.price === 'string') amounts.push(item.price);
        for (const variant of Array.isArray(item.priceVariants) ? item.priceVariants : []) {
          if (variant && typeof variant.price === 'string') amounts.push(variant.price);
        }
        const labelled = Array.isArray(item.priceVariants) && item.priceVariants.length > 0;
        const declared = Array.isArray(item.priceProofs) ? item.priceProofs : (item.priceProof ? [item.priceProof] : []);
        const label = `item ${item.name || '(naamloos)'}`;
        if (declared.length === 0) {
          if (amounts.length > 0) errors.push(`${label}: a price needs a price proof on the pinned row`);
          continue;
        }
        if (declared.length !== amounts.length) {
          errors.push(`${label}: ${declared.length} price proof(s) for ${amounts.length} price(s)`);
        }
        declared.forEach((proof, index) => {
          const amount = amounts[index];
          if (!amount) return;
          const row = findPriceRow(rows, proof);
          if (!row) {
            errors.push(`${label}: no single pinned row at page ${proof.page}, ${proof.column}, y=${proof.y}`);
            return;
          }
          const present = row.cells.some((cell) => normalizeAmount(cell.text).includes(normalizeAmount(amount)));
          if (!present) {
            errors.push(`${label}: ${amount} does not occur on the pinned row p${proof.page} ${proof.column} y=${row.y} (${row.text})`);
          }
          proofs.push({
            item: item.name,
            path: Array.isArray(category.path) ? category.path.join(' > ') : null,
            ...(labelled && item.priceVariants[index] && item.priceVariants[index].label
              ? { variant: item.priceVariants[index].label }
              : {}),
            amount,
            page: row.page,
            column: row.column,
            y: row.y,
            row: row.text,
          });
        });
      }
    }
  }
  return { ok: errors.length === 0, errors, proofs };
}

module.exports = {
  CARD_COLUMN_SPLIT_X,
  ROW_TOLERANCE,
  cardRows,
  columnOf,
  findPriceRow,
  normalizeAmount,
  normalizeText,
  verifyCardPriceProofs,
};
