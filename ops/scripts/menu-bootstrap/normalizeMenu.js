'use strict';

// BE-71 (#176) — het correctielog (./corrections.md). Two owner decisions that
// shape a name before it reaches data/menus.json:
//
//   R1  A dish name printed in capitals only gets ordinary capitals: first
//       letter upper, the rest lower. Two exceptions stay as printed: a word of
//       at most three letters (an abbreviation such as BBQ or XL), and a word
//       that also appears in the restaurant's own name ("SANDWICH CHOCOLAT" at
//       Restaurant Chocolat becomes "Sandwich Chocolat"). A name with mixed
//       upper and lower case is never touched, and neither is a price.
//   R3  A colon at the end of a category heading is dropped
//       ("Visgerechten indien voorradig:" -> "Visgerechten indien voorradig").
//
// Pure: no network, no filesystem, and no knowledge of fetching or writing.
// The engine applies it to every page it reads, before the completeness
// requirement looks at the dishes (a normalised name is what gets compared).

const MAX_ABBREVIATION_LENGTH = 3;

// Words run per letter, so punctuation ("KIP/GARNALEN", "'T ZOETJE") and
// digits stay exactly where they were printed. The `g` variant is used with
// replace, which resets its own lastIndex; the plain variants are used with
// test, so no state is shared between calls.
const LETTER_RUN = /[A-Za-zÀ-ÖØ-öø-ÿ]+/g;
const HAS_LETTER = /[A-Za-zÀ-ÖØ-öø-ÿ]/;
const HAS_LOWERCASE_LETTER = /[a-zà-öø-ÿ]/;
// An abbreviation (BBQ, XL, GR) is a short word without a vowel; a short word
// with a vowel is an ordinary word (VAN, MET, DE) and follows the normal rule.
const HAS_VOWEL = /[aeiouy]/i;

function text(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/** The comparable form of one word: no accents, no case. */
function wordKey(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Every word of the restaurant's own name, comparable form -> the way the
 * restaurant prints it ("Restaurant Chocolat", "IJssalon De Zwaan"). R1's
 * second exception reads this map, so a dish keeps the restaurant's own
 * spelling instead of a lowercased first letter.
 */
function restaurantWords(restaurantName) {
  const words = new Map();
  for (const word of text(restaurantName).split(/[^A-Za-zÀ-ÖØ-öø-ÿ]+/)) {
    const key = wordKey(word);
    if (key && word && !words.has(key)) words.set(key, word);
  }
  return words;
}

/** A name is "in capitals only" when it has a letter and no lowercase letter. */
function isAllCapitals(value) {
  const name = String(value || '');
  return HAS_LETTER.test(name) && !HAS_LOWERCASE_LETTER.test(name);
}

function capitalise(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * R1 for one dish name: first letter upper, the rest lower. Two exceptions keep
 * their capitals: a word from the restaurant's own name ("Sandwich Chocolat")
 * and an abbreviation of at most three letters ("BBQ", "XL", "200 GR"). An
 * abbreviation is read as a word without a vowel; a three-letter word with a
 * vowel is an ordinary word ("Soep van de dag", not "Soep VAN DE dag"). A name
 * with mixed upper and lower case is returned unchanged.
 */
function normaliseDishName(name, nameWords) {
  const value = text(name);
  if (!value || !isAllCapitals(value)) return name;
  const printed = nameWords instanceof Map ? nameWords : new Map();
  let seenFirstRun = false;
  return value.replace(LETTER_RUN, (run) => {
    const isFirst = !seenFirstRun;
    seenFirstRun = true;
    // R1 exception 2: a word from the restaurant's own name keeps the
    // restaurant's spelling ("Chocolat", "IJssalon").
    const own = printed.get(wordKey(run));
    if (own) return own;
    // R1 exception 1: an abbreviation of at most three letters keeps its
    // capitals (BBQ, XL, GR).
    if (run.length <= MAX_ABBREVIATION_LENGTH && !HAS_VOWEL.test(run)) return run;
    const lower = run.toLowerCase();
    return isFirst ? capitalise(lower) : lower;
  });
}

/** R1 for every dish of a menu; a heading is not a dish name. */
function normaliseDishNames(categories, nameWords) {
  return (Array.isArray(categories) ? categories : []).map((category) => ({
    ...category,
    items: ((category && category.items) || []).map((item) => ({
      ...item,
      name: normaliseDishName(item && item.name, nameWords),
    })),
  }));
}

/** R3 for one category heading, and for each label of its path. */
function normaliseHeading(label) {
  const value = typeof label === 'string' ? label : '';
  const stripped = value.replace(/\s*:+$/, '').trim();
  return stripped || value.trim();
}

function normaliseCategories(categories, nameWords) {
  return normaliseDishNames(categories, nameWords).map((category) => ({
    ...category,
    name: normaliseHeading(category && category.name),
    ...(Array.isArray(category && category.path) ? { path: category.path.map((label) => normaliseHeading(label)) } : {}),
  }));
}

/**
 * Applies R1 and R3 to one read menu: `{ title, categories, attention, … }`.
 * Everything else (prices, descriptions, attention points, refusal) is copied
 * unchanged; the menu keeps its own kind and metadata.
 */
function normaliseMenu(menu, { restaurantName } = {}) {
  if (!menu || !Array.isArray(menu.categories)) return menu;
  return { ...menu, categories: normaliseCategories(menu.categories, restaurantWords(restaurantName)) };
}

module.exports = {
  MAX_ABBREVIATION_LENGTH,
  isAllCapitals,
  normaliseDishName,
  normaliseHeading,
  normaliseMenu,
  restaurantWords,
};
