'use strict';

// The two helpers the public menu renderer needs for nested menus, kept
// apart from src/lib/menuHierarchy.js so the public page bundle stays small.

const MAX_LABELS = 8;
const FALLBACK_NAME = 'Menukaart';

function cleanLabels(path) {
  return (Array.isArray(path) ? path : [])
    .filter((label) => typeof label === 'string' && label.trim() !== '')
    .map((label) => label.replace(/\s+/g, ' ').trim().slice(0, 160))
    .slice(0, MAX_LABELS);
}

/** A category's path: its stored path, or its plain name for flat (older) menus. */
function categoryPath(category) {
  const path = cleanLabels(category && category.path);
  if (path.length > 0) return path;
  const name = category && typeof category.name === 'string' && category.name.trim() ? category.name.trim() : FALLBACK_NAME;
  return [name];
}

/**
 * The group headings to show before category `index`: the group labels
 * (every label but the last) that differ from the previous category's. Each
 * as { label, depth } (depth 0 = outermost group). Flat menus have none.
 */
function groupHeadingsBefore(categories, index) {
  const groups = (i) => categoryPath(categories[i]).slice(0, -1);
  const current = groups(index);
  const previous = index > 0 ? groups(index - 1) : [];
  let same = 0;
  while (same < current.length && same < previous.length && current[same] === previous[same]) same += 1;
  return current.slice(same).map((label, k) => ({ label, depth: same + k }));
}

module.exports = { FALLBACK_NAME, cleanLabels, categoryPath, groupHeadingsBefore };
