'use strict';

// BE-25 (review 6307703713) — de menselijke controle van een onzekere
// rubriekindeling, gedeeld door de batchpagina en de server.
//
// Een resultaat met `structure: 'uncertain'` blijft "Controle nodig": de
// bestaande zekerheidsregel (src/lib/batchAnalysis.js, certaintyOf) wordt
// nooit versoepeld. Deze module beschrijft de aparte, expliciet menselijke
// route: per onzekere rubriek "handhaven" of "corrigeren", met het
// oorspronkelijke bronpad en de vindplaats. De server hercontroleert altijd
// tegen de opgeslagen receipt (receiptbinding, alle onzekere paden, geen
// onbekende of extra paden); een clientclaim alleen is nooit genoeg.
//
// Dezelfde beslissingen worden daarna de edits waarmee het bestaande concept
// (src/lib/menuConcept.js buildMenuConcept) wordt opgebouwd: handhaven =
// rubriek expliciet accepteren, corrigeren = het pad van die regels vervangen.
// Bestaande blokkades (prijs, duplicaat, verdwenen gerecht) blijven gelden.
//
// Puur en zonder fetch/database, net als menuConcept.js.

const { menuSections, recognisedLines } = require('./menuConcept');
const { pathKey, formatPath } = require('./menuHierarchy');

const MAX_SECTIONS = 200;
const MAX_PATH_LABELS = 6;
const MAX_LABEL = 120;
const MAX_PATH_TEXT = 1024;
// Same display bound the concept uses for a section's locator (menuConcept).
const MAX_LOCATOR = 160;
// BE-30: a section's dish list stays bounded, exactly like the menu control.
const MAX_SECTION_ITEMS = 60;
const MAX_PRICE_TEXT = 60;

/** A section locator as the review shows and 0020 stores it: trimmed, bounded. */
function boundedLocator(value) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text === '' ? null : text.slice(0, MAX_LOCATOR);
}

/** Path labels as the review stores them: bounded, trimmed, non-empty. */
function normalizePath(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PATH_LABELS) return null;
  const labels = [];
  for (const label of value) {
    if (typeof label !== 'string') return null;
    const text = label.replace(/\s+/g, ' ').trim();
    if (text === '' || text.length > MAX_LABEL) return null;
    labels.push(text);
  }
  return labels;
}

/** The stable key of one section path (same helper as the concept uses). */
function reviewKey(path) {
  return pathKey(Array.isArray(path) ? path : []);
}

/** "Diner › Voor" typed by a reviewer → ["Diner", "Voor"]; null when invalid. */
function parsePathText(value) {
  if (typeof value !== 'string' || value.length > MAX_PATH_TEXT) return null;
  return normalizePath(value.split(/[›>|]/));
}

/** Stored JSON text → path labels; null when the row is unreadable. */
function storedPath(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    return normalizePath(JSON.parse(value));
  } catch {
    return null;
  }
}

/** The menu and category a `menuSections` id ("1.0") points at. */
function sectionSource(menus, id) {
  const [m, c] = String(id === undefined || id === null ? '' : id)
    .split('.')
    .map((part) => Number(part));
  const menu = Array.isArray(menus) && Number.isInteger(m) ? menus[m] : null;
  const category = menu && Array.isArray(menu.categories) && Number.isInteger(c) ? menu.categories[c] : null;
  return { menu: menu && typeof menu === 'object' ? menu : null, category: category && typeof category === 'object' ? category : null };
}

/**
 * BE-30 (criterium 1): the dishes of one uncertain section with their price,
 * bounded exactly like the review shows them. Free: this is what the analysis
 * already read, no AI and no extra request.
 */
function sectionItems(category, id) {
  const list = Array.isArray(category && category.items) ? category.items : [];
  const out = [];
  for (const item of list) {
    if (!item || typeof item.name !== 'string' || item.name.trim() === '') continue;
    const price = typeof item.price === 'string' && item.price.trim() !== '' ? item.price.trim().slice(0, MAX_PRICE_TEXT) : null;
    const priceText = typeof item.priceText === 'string' && item.priceText.trim() !== '' ? item.priceText.trim().slice(0, MAX_PRICE_TEXT) : null;
    out.push({ id: `${id}.${out.length}`, name: item.name.trim().slice(0, MAX_LABEL), price, priceText });
    if (out.length >= MAX_SECTION_ITEMS) break;
  }
  return out;
}

/** "pdf:12:item:2" or "pdf:12" → 12; anything else → null. */
function pdfPageOf(locator) {
  if (typeof locator !== 'string') return null;
  const match = /^\s*pdf:(\d{1,4})(?::|\s*$)/i.exec(locator);
  if (!match) return null;
  const page = Number(match[1]);
  return Number.isInteger(page) && page > 0 ? page : null;
}

/** Only a real http(s) address may ever become a link. */
function safeSourceUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * BE-30 (criterium 2): "Bekijk pagina N" for a pdf source (`#page=N`, only when
 * the locator names a page) and the plain source URL for a website. A source
 * without a usable address gets no link at all.
 */
function sourceLinkOf({ sourceUrl, locator } = {}) {
  const url = safeSourceUrl(sourceUrl);
  if (!url) return null;
  const page = pdfPageOf(locator);
  if (!page) return { url, page: null, text: 'Bekijk bron' };
  return { url: `${url}#page=${page}`, page, text: `Bekijk pagina ${page}` };
}

/**
 * BE-30 (criterium 2): why this section is uncertain, in plain Dutch, from what
 * the analysis itself knows — never an invented cause.
 */
function uncertaintyReason({ sourcePath, path, locator } = {}) {
  const source = Array.isArray(sourcePath) ? sourcePath.filter((label) => typeof label === 'string' && label.trim() !== '') : [];
  const parts = [];
  if (source.length === 0) parts.push('kopje niet herkend in de bron');
  else if (reviewKey(source) !== reviewKey(Array.isArray(path) ? path : [])) parts.push(`kopje anders gelezen dan in de bron ("${formatPath(source)}")`);
  else parts.push('de indeling van dit kopje is niet zeker');
  if (!boundedLocator(locator)) parts.push('vindplaats niet vastgelegd');
  return `${parts.join('; ')}.`.replace(/^./, (first) => first.toUpperCase());
}

/**
 * The sections a human must handle before an uncertain result may be
 * confirmed, exactly as the review page shows them (same path, source route,
 * locator and dishes).
 */
function uncertainSections(menus) {
  return menuSections(menus)
    .filter((section) => section.uncertain)
    .map((section) => {
      const { menu, category } = sectionSource(menus, section.id);
      const locator = boundedLocator(section.locator);
      return {
        id: section.id,
        key: reviewKey(section.path),
        path: section.path,
        label: formatPath(section.path),
        sourcePath: Array.isArray(section.sourcePath) ? section.sourcePath : null,
        sourceRoute: Array.isArray(section.sourcePath) ? formatPath(section.sourcePath) : null,
        locator,
        itemCount: section.itemCount,
        reason: uncertaintyReason({ sourcePath: section.sourcePath, path: section.path, locator }),
        items: sectionItems(category, section.id),
        sourceLink: sourceLinkOf({ sourceUrl: menu && menu.sourceUrl, locator }),
      };
    });
}

/**
 * BE-30 (criterium 4): "Alles klopt zo" as the same per-section choices a
 * reviewer makes by hand — one keep decision per uncertain section, nothing
 * more. The server still re-checks every path and the human still confirms.
 */
function keepAllChoices(sections) {
  const out = {};
  for (const section of Array.isArray(sections) ? sections : []) {
    if (!section || typeof section.key !== 'string' || !Array.isArray(section.path)) continue;
    out[section.key] = { action: 'keep', text: formatPath(section.path) };
  }
  return out;
}

/** True when any menu of this receipt is structurally uncertain. */
function structureUncertain(menus) {
  return (Array.isArray(menus) ? menus : []).some((menu) => menu && menu.structure === 'uncertain');
}

/**
 * Re-checks one submitted structure review against the stored receipt.
 *   menus:       the receipt's recognised menus (candidate_summary.menus)
 *   receiptHash: the receipt's stored analysis_result_hash
 *   submitted:   { receipt_hash, sections: [{ path, action, corrected_path? }] }
 * Returns { ok: true, sections } with the handled sections in receipt order,
 * or { ok: false, code, missing?, unknown? }. Codes:
 *   receipt_unavailable | receipt_mismatch | structure_required |
 *   structure_invalid | structure_unknown_section | structure_unreviewed |
 *   structure_sections_unknown
 */
function validateStructureReviews({ menus, receiptHash, submitted }) {
  const required = uncertainSections(menus);
  if (required.length === 0) return { ok: false, code: 'structure_sections_unknown' };
  if (typeof receiptHash !== 'string' || !/^[0-9a-f]{64}$/.test(receiptHash)) return { ok: false, code: 'receipt_unavailable' };
  if (!submitted || typeof submitted !== 'object' || Array.isArray(submitted)) return { ok: false, code: 'structure_required' };
  if (typeof submitted.receipt_hash !== 'string' || submitted.receipt_hash !== receiptHash) return { ok: false, code: 'receipt_mismatch' };
  const sections = submitted.sections;
  if (!Array.isArray(sections) || sections.length < 1 || sections.length > MAX_SECTIONS) return { ok: false, code: 'structure_required' };

  const byKey = new Map(required.map((section) => [section.key, section]));
  const seen = new Set();
  const decisions = new Map();
  for (const entry of sections) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return { ok: false, code: 'structure_invalid' };
    const path = normalizePath(entry.path);
    if (!path) return { ok: false, code: 'structure_invalid' };
    const key = reviewKey(path);
    const section = byKey.get(key);
    // A path the receipt does not mark uncertain can never be "handled" here.
    if (!section) return { ok: false, code: 'structure_unknown_section', unknown: [formatPath(path)] };
    if (seen.has(key)) return { ok: false, code: 'structure_invalid' };
    seen.add(key);
    if (entry.action !== 'keep' && entry.action !== 'correct') return { ok: false, code: 'structure_invalid' };
    let correctedPath = null;
    if (entry.action === 'correct') {
      correctedPath = normalizePath(entry.corrected_path);
      // "Corrigeren" to the same path is not a correction a human made.
      if (!correctedPath || reviewKey(correctedPath) === key) return { ok: false, code: 'structure_invalid' };
    }
    decisions.set(key, { ...section, action: entry.action, correctedPath });
  }
  const missing = required.filter((section) => !seen.has(section.key));
  if (missing.length > 0) {
    return { ok: false, code: 'structure_unreviewed', missing: missing.map((section) => section.label) };
  }
  return { ok: true, sections: required.map((section) => decisions.get(section.key)) };
}

/**
 * The human decisions as concept edits for the existing buildMenuConcept:
 * keeping a section accepts that section explicitly, correcting one replaces
 * the path of exactly the lines that came from it. Line ids are the receipt's
 * own `${menu}.${category}.${item}`, so no second interpretation is needed.
 */
function structureEdits(menus, sections) {
  const byKey = new Map((Array.isArray(sections) ? sections : []).map((section) => [section.key, section]));
  const edits = { lines: {}, removed: null };
  if (byKey.size === 0) return edits;
  for (const line of recognisedLines(menus)) {
    const section = byKey.get(reviewKey(line.categoryPath));
    if (!section) continue;
    edits.lines[line.id] = section.action === 'correct' ? { path: section.correctedPath } : { acceptCategory: true };
  }
  return edits;
}

/**
 * Stored review rows (menu_structure_reviews) as review sections, in the same
 * shape as validateStructureReviews returns. Unreadable rows are skipped, so a
 * corrupt trail never silently becomes an acceptance.
 */
function recordedSections(rows) {
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const path = storedPath(row && row.original_path);
    const correctedPath = row && row.corrected_path ? storedPath(row.corrected_path) : null;
    if (!path || (row.decision !== 'keep' && row.decision !== 'correct')) continue;
    if (row.decision === 'correct' && !correctedPath) continue;
    out.push({
      key: reviewKey(path),
      path,
      sourcePath: storedPath(row.source_path),
      locator: row.locator || null,
      action: row.decision,
      correctedPath,
      reviewedAt: row.created_at || null,
    });
  }
  return out;
}

module.exports = {
  MAX_SECTIONS,
  MAX_PATH_LABELS,
  MAX_LABEL,
  MAX_LOCATOR,
  MAX_SECTION_ITEMS,
  MAX_PRICE_TEXT,
  normalizePath,
  parsePathText,
  reviewKey,
  storedPath,
  boundedLocator,
  pdfPageOf,
  safeSourceUrl,
  sourceLinkOf,
  uncertaintyReason,
  sectionItems,
  uncertainSections,
  structureUncertain,
  validateStructureReviews,
  structureEdits,
  recordedSections,
  keepAllChoices,
};
