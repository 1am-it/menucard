'use strict';

// The versioned, product-side envelope around one analysis result. It does not
// replace the existing receipt/concept contract; it records the facts those
// contracts cannot express yet: which sources were found/read/failed, how many
// menu items were extracted, what remains unread or unsupported, and which
// sections share a reviewable uncertainty.
//
// Pure and browser-safe. No fetch, no PDF parser, no Supabase. The receipt
// remains the durable menu payload; this envelope is stored with the job so the
// summary, detail and concept path can all point at the same coverage facts.

const MENU_EXTRACTION_RESULT_VERSION = 1;
const EXTRACTION_OUTCOMES = ['items_extracted', 'candidate_without_items', 'no_content_found'];

const MAX_TEXT = 200;
const MAX_SOURCES = 40;
const MAX_GROUPS = 100;

function bounded(value, max = MAX_TEXT) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

function countMenuItems(menus) {
  let count = 0;
  for (const menu of Array.isArray(menus) ? menus : []) {
    for (const category of (menu && Array.isArray(menu.categories) && menu.categories) || []) {
      count += category && Array.isArray(category.items) ? category.items.length : 0;
    }
  }
  return count;
}

function sanitizeSource(source, index) {
  if (!source || typeof source !== 'object') return null;
  const url = bounded(source.url);
  if (!url) return null;
  const out = {
    id: bounded(source.id) || `source-${index + 1}`,
    url,
    kind: ['html', 'pdf', 'other'].includes(source.kind) ? source.kind : 'other',
    status: ['read', 'blocked', 'failed', 'not_read'].includes(source.status) ? source.status : 'not_read',
  };
  for (const key of ['pageCount', 'wordCount', 'itemCount']) {
    if (Number.isInteger(source[key]) && source[key] >= 0) out[key] = source[key];
  }
  if (bounded(source.contentHash, 128)) out.contentHash = bounded(source.contentHash, 128);
  const limitation = bounded(source.limitation);
  if (limitation) out.limitation = limitation;
  return out;
}

/** Shared uncertainty: one group per menu variant + category path. */
function attentionGroupsForMenus(menus) {
  const groups = [];
  const seen = new Set();
  for (const menu of Array.isArray(menus) ? menus : []) {
    for (const category of (menu && Array.isArray(menu.categories) && menu.categories) || []) {
      if (!category || category.uncertain !== true) continue;
      const path = Array.isArray(category.path) ? category.path.filter((p) => typeof p === 'string') : [];
      const key = `${bounded(menu.contextSlug) || ''}|${JSON.stringify(path)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      groups.push({
        id: `group-${groups.length + 1}`,
        menuContext: bounded(menu.contextSlug) || null,
        sourceId: bounded(menu.sourceId) || null,
        sourceUrl: bounded(menu.sourceUrl) || null,
        path,
        label: path.length > 0 ? path.join(' › ') : 'Zonder menukopje',
        itemCount: Array.isArray(category.items) ? category.items.length : 0,
        reason: 'uncertain_structure',
      });
      if (groups.length >= MAX_GROUPS) return groups;
    }
  }
  return groups;
}

/**
 * Builds the versioned coverage envelope. `sourceInventory` is additive data
 * produced by the analysis pipeline; `menus` is the same canonical menu-context
 * array that becomes the receipt. Never claims completeness: a successful
 * parser is not proof that every page, variant or source was covered.
 */
function buildExtractionResult({ sourceInventory, menus, unknownMenuContexts, limitations, notes } = {}) {
  const sources = (Array.isArray(sourceInventory) ? sourceInventory : [])
    .map(sanitizeSource)
    .filter(Boolean)
    .slice(0, MAX_SOURCES);
  const itemCount = countMenuItems(menus);
  const candidateCount =
    (Array.isArray(menus) ? menus.length : 0) + (Array.isArray(unknownMenuContexts) ? unknownMenuContexts.length : 0);
  const status = itemCount > 0 ? 'items_extracted' : candidateCount > 0 ? 'candidate_without_items' : 'no_content_found';
  const sourceLimitations = sources.map((s) => s.limitation).filter(Boolean);
  const extraLimitations = (Array.isArray(limitations) ? limitations : [])
    .map((value) => bounded(value))
    .filter(Boolean);
  const uniqueLimitations = [...new Set([...sourceLimitations, ...extraLimitations])];

  return {
    schemaVersion: MENU_EXTRACTION_RESULT_VERSION,
    status,
    sources,
    coverage: {
      status,
      sourceCount: sources.length,
      readCount: sources.filter((s) => s.status === 'read').length,
      blockedCount: sources.filter((s) => s.status === 'blocked').length,
      failedCount: sources.filter((s) => s.status === 'failed').length,
      candidateCount,
      menuCount: Array.isArray(menus) ? menus.length : 0,
      itemCount,
      // Deliberately never true: extraction is reviewable, not proven complete.
      complete: false,
      reviewRequired: true,
    },
    attentionGroups: attentionGroupsForMenus(menus),
    limitations: uniqueLimitations,
    notes: (Array.isArray(notes) ? notes : []).map((n) => bounded(n)).filter(Boolean).slice(0, 20),
  };
}

function validateExtractionResult(result) {
  const problems = [];
  if (!result || typeof result !== 'object') return ['result must be an object'];
  if (result.schemaVersion !== MENU_EXTRACTION_RESULT_VERSION) problems.push('schemaVersion is not supported');
  if (!EXTRACTION_OUTCOMES.includes(result.status)) problems.push('status is not recognised');
  if (!Array.isArray(result.sources)) problems.push('sources must be an array');
  if (!result.coverage || typeof result.coverage !== 'object') problems.push('coverage must be an object');
  if (result.coverage && result.coverage.complete !== false) problems.push('coverage.complete must be false');
  if (result.coverage && result.coverage.reviewRequired !== true) problems.push('coverage.reviewRequired must be true');
  if (!Array.isArray(result.attentionGroups)) problems.push('attentionGroups must be an array');
  if (!Array.isArray(result.limitations)) problems.push('limitations must be an array');
  return problems;
}

module.exports = {
  MENU_EXTRACTION_RESULT_VERSION,
  EXTRACTION_OUTCOMES,
  countMenuItems,
  attentionGroupsForMenus,
  buildExtractionResult,
  validateExtractionResult,
};
