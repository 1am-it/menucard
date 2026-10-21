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

/**
 * The sections a human must handle before an uncertain result may be
 * confirmed, exactly as the review page shows them (same path, source route
 * and locator).
 */
function uncertainSections(menus) {
  return menuSections(menus)
    .filter((section) => section.uncertain)
    .map((section) => ({
      id: section.id,
      key: reviewKey(section.path),
      path: section.path,
      label: formatPath(section.path),
      sourcePath: Array.isArray(section.sourcePath) ? section.sourcePath : null,
      sourceRoute: Array.isArray(section.sourcePath) ? formatPath(section.sourcePath) : null,
      locator: section.locator || null,
      itemCount: section.itemCount,
    }));
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
  normalizePath,
  parsePathText,
  reviewKey,
  storedPath,
  uncertainSections,
  structureUncertain,
  validateStructureReviews,
  structureEdits,
  recordedSections,
};
