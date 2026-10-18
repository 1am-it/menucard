// BE-25 — Menukaartcontrole → concept v1: pure logic shared by the
// Batchanalyse page and its server handler. No fetch, no database.
//
// Input: the dishes a batch analysis recognised (the receipt's bounded
// candidate_summary.menus — durable, never re-fetched), the restaurant's
// current published menu lines (data/menus.json, read only) and the staff
// member's edits. Output: one line per dish with a status, the attention
// points and blockers, and the internal concept content that may be saved
// as a BE-17 menu snapshot proposal (internal, needs review, never public).
//
// Nothing slips through unmarked: a missing price, an unclear category, a
// duplicate dish and a dish that would disappear from the current menu are
// blockers until a human fixes, excludes or explicitly accepts them.

'use strict';

const { categoryPath, pathKey, formatPath } = require('./menuHierarchy');
const { menuScopeOf } = require('./menuGroups');

const UNCLEAR_CATEGORY_NAMES = new Set(['', 'menu', 'menukaart', 'kaart', 'categorie', 'overig', 'overige', 'diversen']);
const MAX_CATEGORY_NAME = 60;
const MAX_NAME = 120;

const STATUS = {
  unchanged: { label: 'Ongewijzigd', blocker: false, attention: false },
  new: { label: 'Nieuw', blocker: false, attention: false },
  price_changed: { label: 'Prijs gewijzigd', blocker: false, attention: true },
  multiple_prices: { label: 'Meerdere prijzen', blocker: true, attention: true },
  missing_price: { label: 'Prijs ontbreekt', blocker: true, attention: true },
  unclear_category: { label: 'Rubriek onduidelijk', blocker: true, attention: true },
  duplicate: { label: 'Dubbel gerecht', blocker: true, attention: true },
  excluded: { label: 'Uitgesloten', blocker: false, attention: false },
};

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** "14,50", "14.5", "€ 9", "12,-" → "14.50"; anything else → null. */
function normalizePrice(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 0 && value <= 500 ? value.toFixed(2) : null;
  if (typeof value !== 'string') return null;
  const match = /^\s*(?:€\s*)?(\d{1,3})(?:[.,](\d{1,2}))?(?:\s*,[-–])?\s*(?:€)?\s*$/.exec(value);
  if (!match) return null;
  const cents = match[2] === undefined ? 0 : Number(match[2].length === 1 ? `${match[2]}0` : match[2]);
  const amount = Number(match[1]) + cents / 100;
  return amount > 0 && amount <= 500 ? amount.toFixed(2) : null;
}

function displayPrice(price) {
  return price ? `€ ${price.replace('.', ',')}` : null;
}

function isUnclearCategory(name) {
  const text = String(name || '').trim();
  return UNCLEAR_CATEGORY_NAMES.has(text.toLowerCase()) || text.length > MAX_CATEGORY_NAME;
}

function menuTitleOf(menu) {
  return menu && typeof menu.title === 'string' && menu.title.trim() ? menu.title.trim() : null;
}

function labelsOf(value) {
  return Array.isArray(value) ? value.filter((label) => typeof label === 'string' && label.trim()).map((label) => label.trim()) : null;
}

/**
 * The shared menu title of a concept: the title of its only menu. With
 * several menus (e.g. one per page: lunch, diner) each title becomes the
 * outermost group of its own sections instead, so nothing merges.
 */
function conceptTitle(menus) {
  const withItems = (Array.isArray(menus) ? menus : []).filter((m) => m && Array.isArray(m.categories) && m.categories.length > 0);
  return withItems.length === 1 ? menuTitleOf(withItems[0]) : null;
}

/**
 * The recognised dishes, flattened with a stable id per line. `from` is the
 * line's id in the original analysis result: the id itself for a receipt's
 * menus, the stored reference for a saved concept (null for a dish kept from
 * the current menu or a version saved before references were stored).
 * Every line keeps its section path (src/lib/menuHierarchy.js) — `category`
 * is the path's last label — and its original source route.
 */
function recognisedLines(menus) {
  const lines = [];
  const list = Array.isArray(menus) ? menus : [];
  const several = list.filter((m) => m && Array.isArray(m.categories) && m.categories.length > 0).length > 1;
  list.forEach((menu, m) => {
    const title = several ? menuTitleOf(menu) : null;
    ((menu && Array.isArray(menu.categories) && menu.categories) || []).forEach((category, c) => {
      const path = title ? [title, ...categoryPath(category)] : categoryPath(category);
      ((category && Array.isArray(category.items) && category.items) || []).forEach((item, i) => {
        if (!item || typeof item.name !== 'string' || !item.name.trim()) return;
        const id = `${m}.${c}.${i}`;
        lines.push({
          id,
          from: Object.prototype.hasOwnProperty.call(item, 'from') ? (typeof item.from === 'string' ? item.from : null) : id,
          kept: item.kept === true,
          name: item.name.trim().slice(0, MAX_NAME),
          desc: typeof item.desc === 'string' && item.desc.trim() ? item.desc.trim() : null,
          price: normalizePrice(item.price),
          priceStatus: ['multiple_undecomposed', 'on_request', 'unknown'].includes(item.priceStatus)
            ? item.priceStatus
            : item.price ? 'known' : 'unknown',
          ...(typeof item.priceText === 'string' && item.priceText.trim() ? { priceText: item.priceText.trim().slice(0, 160) } : {}),
          ...(Array.isArray(item.priceVariants)
            ? {
                priceVariants: item.priceVariants
                  .filter((variant) => variant && typeof variant.price === 'string')
                  .slice(0, 10)
                  .map((variant) => ({ label: typeof variant.label === 'string' ? variant.label : null, price: variant.price })),
              }
            : {}),
          ...(item.evidence && typeof item.evidence === 'object' ? { evidence: item.evidence } : {}),
          category: path[path.length - 1],
          categoryPath: path,
          menuScope: menuScopeOf(path),
          sourcePath: labelsOf(category && category.sourcePath),
          categoryUncertain: Boolean(category && category.uncertain === true),
        });
      });
    });
  });
  return lines;
}

/** Summary for the control view: sections (with their path and source route) with dishes and prices. */
function summarizeRecognisedMenu(menus) {
  const lines = recognisedLines(menus);
  const categories = [];
  const byPath = new Map();
  for (const line of lines) {
    const key = pathKey(line.categoryPath);
    let category = byPath.get(key);
    if (!category) {
      category = {
        name: line.category || 'Zonder rubriek',
        path: line.categoryPath,
        label: formatPath(line.categoryPath),
        sourceRoute: line.sourcePath ? formatPath(line.sourcePath) : null,
        uncertain: line.categoryUncertain,
        items: [],
      };
      byPath.set(key, category);
      categories.push(category);
    }
    category.items.push({
      id: line.id,
      name: line.name,
      price: displayPrice(line.price),
      ...(line.priceText ? { priceText: line.priceText } : {}),
      ...(line.priceStatus === 'multiple_undecomposed' ? { priceStatus: 'multiple_undecomposed' } : {}),
    });
  }
  const names = new Map();
  for (const line of lines) names.set(dishKey(line), (names.get(dishKey(line)) || 0) + 1);
  const attention = [];
  for (const line of lines) {
    if (!line.price && line.priceStatus === 'multiple_undecomposed') attention.push({ id: line.id, name: line.name, reason: 'Meerdere prijzen' });
    else if (!line.price) attention.push({ id: line.id, name: line.name, reason: 'Prijs ontbreekt' });
    else if (names.get(dishKey(line)) > 1) attention.push({ id: line.id, name: line.name, reason: 'Komt meer dan eens voor' });
    else if (isUnclearCategory(line.category)) attention.push({ id: line.id, name: line.name, reason: 'Rubriek onduidelijk' });
    else if (line.categoryUncertain) attention.push({ id: line.id, name: line.name, reason: 'Rubriekindeling onzeker' });
  }
  return { itemCount: lines.length, categoryCount: categories.length, title: conceptTitle(menus), categories, attention };
}

/** The restaurant's current published menu lines (data/menus.json entries
 * whose key starts with "<restaurantId>-"). */
function liveMenuLines(liveMenus, restaurantId) {
  const lines = [];
  if (!liveMenus || typeof liveMenus !== 'object' || !restaurantId) return lines;
  const entries = Object.entries(liveMenus).filter(([key, menu]) => key.startsWith(`${restaurantId}-`) && menu && Array.isArray(menu.categories));
  for (const [key, menu] of entries) {
    // Several published menus (lunch, diner, …) are separate menu variants.
    const entryScope = entries.length > 1 ? liveEntryLabel(key, menu) : '';
    menu.categories.forEach((category, c) => {
      ((category && Array.isArray(category.items) && category.items) || []).forEach((item, i) => {
        if (!item || typeof item.name !== 'string' || !item.name.trim()) return;
        lines.push({
          id: `live:${key}.${c}.${i}`,
          name: item.name.trim(),
          desc: typeof item.desc === 'string' && item.desc.trim() ? item.desc.trim() : null,
          price: normalizePrice(typeof item.priceValue === 'number' ? item.priceValue : item.price),
          category: category && typeof category.name === 'string' ? category.name.trim() : '',
          categoryPath: categoryPath(category),
          menuScope: menuScopeOf(categoryPath(category)) || entryScope,
        });
      });
    });
  }
  return lines;
}

/** The variant label of a published menu entry: its own title, or its
 * daypart from the key ("6-diner" → "Diner"). */
function liveEntryLabel(key, menu) {
  if (menu && typeof menu.title === 'string' && menu.title.trim()) return menu.title.trim();
  const meal = String(key).split('-').slice(1).join('-');
  return meal ? meal.charAt(0).toUpperCase() + meal.slice(1) : '';
}

/** Same dish = same normalised name within the same menu variant. */
function scopeKey(scope) {
  return normalizeName(scope || '');
}
function dishKey(line) {
  return `${scopeKey(line.menuScope)}|${normalizeName(line.name)}`;
}
/** The key of a keep/remove decision on a disappeared dish: per variant when
 * the concept has menu variants (`decisionScope`), otherwise by name alone —
 * the earlier, unchanged key of a flat menu. */
function removalKey(line) {
  const scope = line && (line.decisionScope !== undefined ? line.decisionScope : line.menuScope);
  return scope ? `${scopeKey(scope)}|${normalizeName(line.name)}` : normalizeName(line && line.name);
}

/** The fixed BE-17 rejection reasons (menu_snapshot_reviews.reason), with their visible label. */
const REJECT_REASONS = {
  source_unreliable: 'Bron onbetrouwbaar',
  content_mismatch: 'Inhoud klopt niet met de bron',
  duplicate_snapshot: 'Dubbel concept',
  insufficient_content: 'Onvoldoende inhoud',
  other: 'Andere reden',
};

const MAX_EDITED_LINES = 500;
const MAX_EDIT_TEXT = 200;

/**
 * Edits as sent by a browser, reduced to what the concept understands. Never
 * trusted beyond that: the concept and its blockers are always recomputed.
 *   lines:   { [lineId]: { exclude?, acceptCategory?, acceptDuplicate?, name?,
 *              price?, category? } }
 *            (all booleans may be false to undo a stored choice). `accept` is
 *            accepted only as a legacy alias for `acceptCategory`; it can
 *            never settle a duplicate.
 *   removed: 'keep' | 'remove' (every disappeared dish) or
 *            { [normalizeName(dish)]: 'keep' | 'remove' }
 */
function sanitizeEdits(raw) {
  const out = { lines: {}, removed: null };
  if (!raw || typeof raw !== 'object') return out;
  if (raw.removed === 'keep' || raw.removed === 'remove') out.removed = raw.removed;
  else if (raw.removed && typeof raw.removed === 'object' && !Array.isArray(raw.removed)) {
    out.removed = {};
    for (const [key, decision] of Object.entries(raw.removed).slice(0, MAX_EDITED_LINES)) {
      if (key.length <= MAX_EDIT_TEXT && (decision === 'keep' || decision === 'remove')) out.removed[key] = decision;
    }
  }
  const lines = raw.lines && typeof raw.lines === 'object' ? raw.lines : {};
  for (const [id, e] of Object.entries(lines).slice(0, MAX_EDITED_LINES)) {
    if (!/^\d+\.\d+\.\d+$/.test(id) || !e || typeof e !== 'object') continue;
    const clean = {};
    for (const key of ['exclude', 'acceptCategory', 'acceptDuplicate']) if (typeof e[key] === 'boolean') clean[key] = e[key];
    // Legacy browser payload: an old `accept` may only settle the category
    // uncertainty. It is never interpreted as duplicate acceptance.
    if (typeof e.accept === 'boolean' && clean.acceptCategory === undefined) clean.acceptCategory = e.accept;
    for (const key of ['name', 'price', 'category']) if (typeof e[key] === 'string' && e[key].length <= MAX_EDIT_TEXT) clean[key] = e[key];
    out.lines[id] = clean;
  }
  return out;
}

/** A reviewer's edits on top of a stored version's own choices. */
function mergeEdits(base, delta) {
  const lines = { ...((base && base.lines) || {}) };
  for (const [id, e] of Object.entries((delta && delta.lines) || {})) {
    if (!e || typeof e !== 'object') continue;
    if (Object.prototype.hasOwnProperty.call(e, 'accept')) {
      // A legacy undo (`accept:false`) must override a stored category
      // acceptance, and can never touch a duplicate acceptance.
      const { accept, ...rest } = e;
      lines[id] = { ...(lines[id] || {}), ...rest, acceptCategory: accept };
    } else {
      lines[id] = { ...(lines[id] || {}), ...e };
    }
  }
  const baseRemoved = base && base.removed;
  const deltaRemoved = delta && delta.removed;
  let removed = baseRemoved || null;
  if (typeof deltaRemoved === 'string') removed = deltaRemoved;
  else if (deltaRemoved && typeof deltaRemoved === 'object') {
    removed = { ...(baseRemoved && typeof baseRemoved === 'object' ? baseRemoved : {}), ...deltaRemoved };
  }
  return { lines, removed };
}

/**
 * A saved concept version (captured_content) as concept input: its dishes
 * (with their reference to the original analysis) and the choices stored
 * with it — dishes accepted as they are and decisions on disappeared dishes.
 */
function storedConceptInput(captured) {
  const source = captured && Array.isArray(captured.categories) ? captured.categories : [];
  const lines = {};
  const categories = source.map((category, c) => ({
    name: category && typeof category.name === 'string' ? category.name : '',
    ...(category && Array.isArray(category.path) ? { path: category.path } : {}),
    ...(category && Array.isArray(category.sourcePath) ? { sourcePath: category.sourcePath } : {}),
    ...(category && category.uncertain === true ? { uncertain: true } : {}),
    items: ((category && Array.isArray(category.items) && category.items) || []).map((item, i) => {
      const lineId = `0.${c}.${i}`;
      if (item && item.categoryAccepted === true) lines[lineId] = { ...(lines[lineId] || {}), acceptCategory: true };
      if (item && item.duplicateAccepted === true) lines[lineId] = { ...(lines[lineId] || {}), acceptDuplicate: true };
      // A saved version before the split stored one ambiguous `accepted`.
      // Reinterpret it conservatively as category-only; a duplicate must be
      // reviewed again rather than silently inheriting approval.
      if (item && item.accepted === true && item.categoryAccepted === undefined && item.duplicateAccepted === undefined) {
        lines[lineId] = { ...(lines[lineId] || {}), acceptCategory: true };
      }
      return {
        name: item && item.name,
        desc: item && item.desc,
        price: item && item.price,
        ...(item && item.evidence && typeof item.evidence === 'object' ? { evidence: item.evidence } : {}),
        from: item && typeof item.from === 'string' ? item.from : null,
        kept: Boolean(item && item.kept === true),
      };
    }),
  }));
  const removed = {};
  for (const r of (captured && Array.isArray(captured.removed) && captured.removed) || []) {
    if (r && typeof r.name === 'string' && (r.decision === 'keep' || r.decision === 'remove')) removed[removalKey({ name: r.name, menuScope: typeof r.scope === 'string' ? r.scope : '' })] = r.decision;
  }
  return { menus: [{ title: captured && typeof captured.title === 'string' ? captured.title : null, categories }], edits: { lines, removed } };
}

/** What a menu shows the public — the projection compared for "previously rejected". */
function publicMenu(content) {
  const categories = (content && Array.isArray(content.categories) ? content.categories : []).map((c) => {
    const out = { name: c && typeof c.name === 'string' ? c.name : '' };
    if (c && Array.isArray(c.path) && c.path.length > 1) out.path = c.path;
    out.items = ((c && Array.isArray(c.items) && c.items) || []).map((i) => ({ name: i && i.name, desc: (i && i.desc) || null, price: (i && i.price) || null }));
    return out;
  });
  return content && typeof content.title === 'string' ? { title: content.title, categories } : { categories };
}

function removedDecisionFor(decisions, line) {
  if (decisions === 'keep' || decisions === 'remove') return decisions;
  if (decisions && typeof decisions === 'object') {
    // A decision stored by name alone (an earlier, flat version) still applies.
    const d = decisions[removalKey(line)] || decisions[normalizeName(line.name)];
    if (d === 'keep' || d === 'remove') return d;
  }
  return null;
}

/**
 * The published dishes a concept line corresponds to — the ONE rule for the
 * comparison (unchanged, price change) and for which published dishes are
 * still present (everything else is a disappeared dish needing a choice).
 *   - A flat concept line (no scope) matches by name, as before.
 *   - A line in a menu variant matches only a published dish of the SAME
 *     variant. Never across two explicit variants, not even for a unique
 *     name: a Diner dish never silently moves to Lunch.
 *   - Compatibility only for an old, unscoped published dish (a restaurant
 *     with a single flat published menu): that one may match by name.
 */
function liveMatches(line, liveByName) {
  const candidates = liveByName.get(normalizeName(line.name)) || [];
  if (!line.menuScope) return candidates;
  const same = candidates.filter((c) => c.menuScope && scopeKey(c.menuScope) === scopeKey(line.menuScope));
  if (same.length > 0) return same;
  return candidates.filter((c) => !c.menuScope);
}

/** The published dish shown next to a concept line: the first of its matches. */
function matchLive(line, liveByName) {
  return liveMatches(line, liveByName)[0] || null;
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The concept.
 *   menus:     recognised menus (candidate_summary.menus), or a stored
 *              version via storedConceptInput(...)
 *   liveLines: liveMenuLines(...) for the restaurant
 *   edits:     see sanitizeEdits
 * A missing price, an unclear category, a duplicate and a disappeared dish
 * without a decision are blockers. "Klopt zo" (accept) only settles an
 * unclear category or a duplicate, never a missing price.
 */
function buildMenuConcept({ menus, liveLines, edits }) {
  const lineEdits = (edits && edits.lines && typeof edits.lines === 'object' && edits.lines) || {};
  const decisions = edits ? edits.removed : null;
  const live = Array.isArray(liveLines) ? liveLines : [];
  const liveByName = new Map();
  for (const l of live) {
    const key = normalizeName(l.name);
    if (!liveByName.has(key)) liveByName.set(key, []);
    liveByName.get(key).push(l);
  }

  const lines = recognisedLines(menus).map((line) => {
    const e = Object.prototype.hasOwnProperty.call(lineEdits, line.id) ? lineEdits[line.id] || {} : {};
    const name = typeof e.name === 'string' && e.name.trim() ? e.name.trim().slice(0, MAX_NAME) : line.name;
    const editedPrice = e.price !== undefined && e.price !== null && e.price !== '' ? normalizePrice(String(e.price)) : undefined;
    const price = editedPrice !== undefined ? editedPrice : line.price;
    // An explicit correction chooses a price on purpose; an untouched
    // multiple-price extraction stays a blocker.
    const priceStatus = editedPrice !== undefined ? (editedPrice ? 'known' : 'unknown') : line.priceStatus;
    const categoryEdited = typeof e.category === 'string' && e.category.trim() !== '';
    const category = categoryEdited ? e.category.trim().slice(0, MAX_CATEGORY_NAME) : line.category;
    const linePath = line.categoryPath || [line.category];
    return {
      ...line,
      original: { name: line.name, price: line.price, category: line.category },
      name,
      price,
      priceStatus,
      category,
      categoryEdited,
      categoryPath: categoryEdited ? [...linePath.slice(0, -1), category] : linePath,
      menuScope: menuScopeOf(categoryEdited ? [...linePath.slice(0, -1), category] : linePath),
      excluded: e.exclude === true,
      // Direct callers (and older stored versions) may still carry the
      // ambiguous `accept`; it means category-only. Duplicate acceptance can
      // only arrive through `acceptDuplicate`.
      categoryAccepted: e.acceptCategory === true ? true : e.acceptCategory === false ? false : e.accept === true,
      duplicateAccepted: e.acceptDuplicate === true,
      edited: Boolean(e.name || e.price || e.category),
    };
  });

  const included = lines.filter((l) => !l.excluded);
  // Duplicates only within one menu variant: the same dish on the lunch and
  // the diner menu is two legitimate dishes.
  const nameCount = new Map();
  for (const l of included) nameCount.set(dishKey(l), (nameCount.get(dishKey(l)) || 0) + 1);

  for (const l of lines) {
    const liveMatch = matchLive(l, liveByName);
    // An uncertain source structure counts as an unclear section until a
    // human names the section or accepts the category. This is a different
    // decision from accepting a duplicate dish.
    const unclear = isUnclearCategory(l.category) || (l.categoryUncertain && !l.categoryEdited);
    const duplicate = nameCount.get(dishKey(l)) > 1;
    const hasPrice = Boolean(l.price);
    // Keep the flags on the line so the UI and the stored version can show
    // exactly which decision was made, even after the blocker is cleared.
    l.categoryNeedsAcceptance = unclear && hasPrice && !l.excluded;
    l.duplicateNeedsAcceptance = duplicate && hasPrice && !l.excluded;
    l.categoryAccepted = l.categoryAccepted && l.categoryNeedsAcceptance;
    l.duplicateAccepted = l.duplicateAccepted && l.duplicateNeedsAcceptance;
    if (l.excluded) l.status = 'excluded';
    else if (!hasPrice && l.priceStatus === 'multiple_undecomposed') l.status = 'multiple_prices';
    else if (!hasPrice) l.status = 'missing_price';
    else if (unclear && !l.categoryAccepted) l.status = 'unclear_category';
    else if (duplicate && !l.duplicateAccepted) l.status = 'duplicate';
    else if (liveMatch && liveMatch.price && liveMatch.price !== l.price) l.status = 'price_changed';
    else if (liveMatch) l.status = 'unchanged';
    else l.status = 'new';
    l.livePrice = liveMatch ? liveMatch.price : null;
    l.live = liveMatch ? { name: liveMatch.name, desc: liveMatch.desc || null, price: liveMatch.price, category: liveMatch.category } : null;
  }

  // A published dish is still present when an included concept line matches
  // it (per variant); a flat line keeps the earlier by-name rule.
  const present = new Set();
  for (const l of included) for (const match of liveMatches(l, liveByName)) present.add(match);
  const scoped = included.some((l) => l.menuScope);
  const removed = live
    .filter((l) => !present.has(l))
    .map((l) => {
      const withScope = { ...l, decisionScope: scoped ? l.menuScope || '' : '' };
      return { ...withScope, decision: removedDecisionFor(decisions, withScope) };
    });
  const undecided = removed.filter((l) => !l.decision);

  const blockers = lines
    .filter((l) => STATUS[l.status].blocker)
    .map((l) => ({ id: l.id, name: l.name, status: l.status, label: STATUS[l.status].label }));
  if (undecided.length > 0) {
    blockers.push({
      id: 'removed',
      name: null,
      status: 'removed',
      label: `${plural(undecided.length, 'gerecht', 'gerechten')} van de huidige kaart zonder keuze behouden of verwijderen`,
    });
  }

  const counts = {};
  for (const l of lines) counts[l.status] = (counts[l.status] || 0) + 1;

  // Sections are grouped by their whole path, never by their last label
  // only: "Lunch › Voor" and "Diner › Voor" stay two sections. A flat path
  // stores no `path` key, so older flat concepts keep their exact content.
  const conceptCategories = [];
  const byPath = new Map();
  const add = (pathLabels, item, origin) => {
    const key = pathKey(pathLabels);
    let c = byPath.get(key);
    if (!c) {
      c = { name: pathLabels[pathLabels.length - 1] };
      if (pathLabels.length > 1) c.path = pathLabels;
      if (origin && origin.sourcePath) c.sourcePath = origin.sourcePath;
      c.items = [];
      byPath.set(key, c);
      conceptCategories.push(c);
    }
    if (origin && origin.uncertain) c.uncertain = true;
    c.items.push(item);
  };
  for (const l of included) {
    const item = { name: l.name, desc: l.desc, price: l.price };
    if (l.from) item.from = l.from;
    if (l.kept) item.kept = true;
    if (l.categoryAccepted) item.categoryAccepted = true;
    if (l.duplicateAccepted) item.duplicateAccepted = true;
    if (l.evidence && typeof l.evidence === 'object') item.evidence = l.evidence;
    add(l.categoryPath, item, { sourcePath: l.categoryEdited ? null : l.sourcePath, uncertain: l.categoryUncertain && !l.categoryEdited });
  }
  // A kept dish returns to its own variant when the concept has variants.
  for (const l of removed) {
    if (l.decision !== 'keep') continue;
    const own = l.categoryPath && l.categoryPath.length ? l.categoryPath : [l.category || 'Huidige kaart'];
    const keptPath = scoped && l.menuScope && own.length === 1 ? [l.menuScope, ...own] : own;
    add(keptPath, { name: l.name, desc: l.desc, price: l.price, kept: true }, null);
  }
  // Keys in a stable order (name, path, sourcePath, uncertain, items).
  for (const c of conceptCategories) {
    const items = c.items;
    delete c.items;
    if (c.uncertain) {
      delete c.uncertain;
      c.uncertain = true;
    }
    c.items = items;
  }
  const title = conceptTitle(menus);
  const content = title ? { title, categories: conceptCategories } : { categories: conceptCategories };
  const removedForContent = removed.filter((l) => l.decision === 'remove').map((l) => (l.decisionScope ? { name: l.name, scope: l.decisionScope, decision: 'remove' } : { name: l.name, decision: 'remove' }));
  if (removedForContent.length > 0) content.removed = removedForContent;

  const uniform = removed.length > 0 && removed.every((l) => l.decision === removed[0].decision) ? removed[0].decision : null;
  return {
    lines,
    removed,
    removedDecision: uniform,
    blockers,
    canSave: blockers.length === 0 && conceptCategories.some((c) => c.items.length > 0),
    counts,
    safeCount: lines.filter((l) => l.status === 'unchanged' || l.status === 'new').length,
    attentionLines: lines.filter((l) => STATUS[l.status].attention),
    content,
  };
}

module.exports = {
  STATUS,
  normalizeName,
  normalizePrice,
  displayPrice,
  isUnclearCategory,
  recognisedLines,
  summarizeRecognisedMenu,
  liveMenuLines,
  buildMenuConcept,
  removalKey,
  liveEntryLabel,
  sanitizeEdits,
  mergeEdits,
  storedConceptInput,
  publicMenu,
  REJECT_REASONS,
};
