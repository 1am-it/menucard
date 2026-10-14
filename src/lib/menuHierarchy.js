'use strict';

// A lossless, generic menu hierarchy between the HTML structure adapter
// (src/lib/htmlMenuStructure.js: one heading path per section) and every
// later step (receipt summary, concept, review, Publicatievoorbeeld, export).
//
// A section's heading path is never flattened into one name. It becomes:
//   - `title`      the one shared top heading of the whole menu, when every
//                  section sits below it (e.g. "Proef het beste van het
//                  seizoen"); null otherwise;
//   - `path`       the remaining labels, any depth: groups … → section
//                  (e.g. ["Diner", "Voor"]); the last label is the section
//                  name shown on the menu;
//   - `sourcePath` the full, unchanged heading route from the source, for
//                  internal review;
//   - `uncertain`  true where the headings cannot be normalised reliably —
//                  items without any heading next to headed sections, items
//                  directly at a group level that also has sub-sections, or
//                  an unusually deep route. Never guessed: such a section is
//                  shown as "Controle nodig".
// Pure and browser-safe. The public renderer only needs the small helpers in
// src/lib/menuGroups.js (re-exported here), so its bundle stays small.

const { FALLBACK_NAME, cleanLabels, categoryPath, groupHeadingsBefore } = require('./menuGroups');

const MAX_RELIABLE_DEPTH = 4;

function samePath(a, b) {
  return a.length === b.length && a.every((label, i) => label === b[i]);
}

function isStrictPrefix(prefix, of) {
  return prefix.length < of.length && prefix.every((label, i) => label === of[i]);
}

/**
 * Normalises the heading paths of a menu's sections (in source order).
 * Returns { title, structure: 'normalized' | 'uncertain', categories: [{
 * name, path, sourcePath, uncertain }] } — one entry per input path, in the
 * same order.
 */
function normalizeMenuHierarchy(sourcePaths) {
  const sources = (Array.isArray(sourcePaths) ? sourcePaths : []).map(cleanLabels);
  const labelled = sources.filter((p) => p.length > 0);
  const anyUnlabelled = sources.some((p) => p.length === 0);

  // A shared title only when EVERY section has it as its first label and
  // still has at least one label of its own below it.
  let title = null;
  if (sources.length > 0 && !anyUnlabelled && sources.every((p) => p.length >= 2 && p[0] === sources[0][0])) title = sources[0][0];

  const paths = sources.map((p) => (title ? p.slice(1) : p.length > 0 ? p : [FALLBACK_NAME]));
  const uncertain = sources.map((p, i) => {
    if (p.length === 0 && labelled.length > 0) return true; // items before any heading, next to headed sections
    if (p.length > MAX_RELIABLE_DEPTH) return true;
    return paths.some((other, j) => j !== i && isStrictPrefix(paths[i], other)); // items at a group level with sub-sections
  });

  return {
    title,
    structure: uncertain.some(Boolean) ? 'uncertain' : 'normalized',
    categories: paths.map((path, i) => ({ name: path[path.length - 1], path, sourcePath: sources[i], uncertain: uncertain[i] })),
  };
}

function pathKey(path) {
  return JSON.stringify(path);
}

/** "Diner › Voor" — how a path is written in internal review text. */
function formatPath(path) {
  return cleanLabels(path).join(' › ');
}

module.exports = {
  FALLBACK_NAME,
  normalizeMenuHierarchy,
  categoryPath,
  pathKey,
  formatPath,
  groupHeadingsBefore,
  samePath,
};
