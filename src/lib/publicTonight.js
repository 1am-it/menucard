'use strict';

// BE-29 (#70) — de ene, pure selectie voor "Vanavond op de kaart".
//
// Deze module bevat géén data en géén React: de server bouwt met
// src/lib/publicTonightData.js een compacte, eerlijke kandidatenlijst uit
// data/menus.json / data/restaurants.json en geeft die als props mee. De
// selectie hieronder is deterministisch per kalenderdag in
// `Europe/Amsterdam`, zodat de home voor iedereen dezelfde keuze toont en de
// ISR-cache niet per request wisselt. Geen AI, populariteit, betaling of
// persoonsgegevens; `Math.random` komt hier niet voor.
//
// De server rendert de sectie niet: het moment van de dag, open of dicht, het
// verlopen van de daghap en de seizoenstegels bepaalt de browser ná het
// laden met de browserklok. Zo staat er nooit een "Nu open" of een daghap in
// de server-HTML.
//
// Bewust CommonJS, zoals src/lib/openingStatus.js en src/lib/dishDeepLink.js.

const { zonedParts, DEFAULT_TIME_ZONE } = require('./localTime');
const { cuisineFamily } = require('./cuisineStyle');

const MAX_DISHES = 3;

// Eigenaarsbesluit 2026-10-25 (issue #70): lunch vóór 15:00, borrel van
// 16:00 tot 18:00, daarna diner. Het kwartier tussen 15:00 en 16:00 valt
// daarmee onder diner: er is geen vierde menutype en "lunch vóór 15:00" is
// letterlijk zo afgesproken.
const MEAL_TITLES = {
  lunch: 'Nu op de lunchkaart',
  borrel: 'Borrel',
  diner: 'Vanavond op de kaart',
};

// Het deel van de dag waarin het restaurant open moet zijn. Bewust een
// venster en niet "nu open": de keuze moet per dag vast en cachebaar zijn.
const MEAL_OPEN_WINDOWS = {
  lunch: { from: 11 * 60, to: 15 * 60 },
  borrel: { from: 16 * 60, to: 18 * 60 },
  diner: { from: 17 * 60, to: 23 * 60 },
};

const PRICE_BUCKETS = [
  { id: 'low', label: 'onder € 15', test: (value) => value < 15 },
  { id: 'mid', label: '€ 15 tot € 25', test: (value) => value >= 15 && value <= 25 },
  { id: 'high', label: 'boven € 25', test: (value) => value > 25 },
];

// "Nieuw op de kaart" is een lichte voorrang, geen hoofdregel: een kaart die
// in de laatste 30 dagen is bijgewerkt krijgt het label en een kleine
// voorsprong in de dagvolgorde.
const NEW_ON_MENU_DAYS = 30;
const NEW_ON_MENU_BOOST = 0.25;

// Decoratief teken bij het gerecht. Alleen op basis van woorden die echt in
// naam of categorie staan; onbekend blijft het neutrale bord. Het emoji
// draagt geen betekenis (aria-hidden in de opmaak).
const EMOJI_RULES = [
  [/soep|bouillon|bisque/i, '🍲'],
  [/pasta|spaghetti|penne|lasagne|tagliatelle|risotto/i, '🍝'],
  [/pizza/i, '🍕'],
  [/burger|biefstuk|steak|entrecote|tartaar|spare ?ribs|lams|kalf|varken|kip|eend/i, '🍖'],
  [/vis|zalm|tonijn|garnalen|kabeljauw|mossel|homard|kreeft|sushi/i, '🐟'],
  [/salade|groente|vega/i, '🥗'],
  [/taart|gebak|dessert|ijs|chocolade|tiramisu|panna/i, '🍰'],
  [/brood|sandwich|toast|bagel/i, '🥪'],
  [/kaas/i, '🧀'],
];

function dishEmoji(name, category) {
  const text = `${name || ''} ${category || ''}`;
  for (const [pattern, glyph] of EMOJI_RULES) {
    if (pattern.test(text)) return glyph;
  }
  return '🍽️';
}

// ─── Moment van de dag ──────────────────────────────────────────────────────

function mealMoment(minutesOfDay) {
  const value = Number(minutesOfDay);
  if (!Number.isFinite(value)) return 'diner';
  const minutes = ((value % 1440) + 1440) % 1440;
  if (minutes < 15 * 60) return 'lunch';
  if (minutes >= 16 * 60 && minutes < 18 * 60) return 'borrel';
  return 'diner';
}

function mealTitle(mealType) {
  return MEAL_TITLES[mealType] || MEAL_TITLES.diner;
}

// ─── Wat is een bestelbaar gerecht? ─────────────────────────────────────────

// Kleine, geteste lijst op de rubrieknaam. Dranken, sauzen, bijgerechten,
// zoetigheid en arrangementen vallen af. Bij twijfel weglaten: een lege
// selectie is eerlijker dan een wijnglas bij "Vanavond op de kaart".
const DRINKS_PATTERN = /drank|wijn|bier|cocktail|spritz|koffie|thee|frisdrank|lemonade|gedistilleerd|likeur|\bwater\b|\bsap\b/i;
const SIDES_SAUCES_PATTERN = /saus|sauz|dip|dressing|bijgerecht|\bside\b|stokbrood|desem|\bfriet\b|\bextra\b/i;
const SWEETS_PATTERN = /dessert|\bsweets?\b|gebak|taart|\bijs\b|zoet/i;
const ARRANGEMENT_PATTERN = /menu|proeverij|surprise|arrangement|kids|kindermenu/i;

function isMainDishCategory(categoryName) {
  if (typeof categoryName !== 'string') return false;
  const name = categoryName.trim();
  if (!name) return false;
  if (DRINKS_PATTERN.test(name)) return false;
  if (SIDES_SAUCES_PATTERN.test(name)) return false;
  if (SWEETS_PATTERN.test(name)) return false;
  if (ARRANGEMENT_PATTERN.test(name)) return false;
  return true;
}

// ─── Eerlijke prijs ─────────────────────────────────────────────────────────

/**
 * De prijs zoals de bron hem noemt, met een bron-qualifier ("voor 2
 * personen", "per kilo", …) erbij als die in een eigen veld staat. Staat de
 * qualifier al in de prijsstring, dan blijft die ongewijzigd. Zonder echte
 * prijs is er geen label: "op aanvraag" telt niet.
 */
function honestPriceLabel(item) {
  if (!item || typeof item !== 'object') return null;
  if (!item.price || item.priceOnRequest || item.priceValue == null) return null;
  let label = String(item.price).trim();
  if (!label) return null;
  for (const note of [item.priceNote, item.priceUnit, item.priceQualifier]) {
    if (typeof note !== 'string' || !note.trim()) continue;
    const clean = note.trim();
    if (!label.toLowerCase().includes(clean.toLowerCase())) label += ` · ${clean}`;
  }
  if (item.priceIsFrom && !/^vanaf\b/i.test(label)) label = `vanaf ${label}`;
  return label;
}

// ─── Openingstijden ─────────────────────────────────────────────────────────

function toMinutes(value) {
  const [hours, minutes] = String(value).split(':').map(Number);
  return hours * 60 + (minutes || 0);
}

function parseOpeningRange(hours) {
  if (typeof hours !== 'string') return null;
  const [open, close] = hours.split('-').map((part) => part.trim());
  if (!/^\d{1,2}:\d{2}$/.test(open || '') || !/^\d{1,2}:\d{2}$/.test(close || '')) return null;
  const range = { open: toMinutes(open), close: toMinutes(close) };
  // Zelfde conventie als src/lib/openingStatus.js: geen overnight-vensters.
  if (range.close <= range.open) return null;
  return range;
}

/**
 * Is het restaurant op deze weekdag open in het deel van de dag van dit
 * menutype? Een overlap is genoeg: een dinerkaart bij een zaak die om 17:00
 * opent telt mee, ook al is het nu 12:00.
 */
function isOpenForMoment(openingHours, dayKey, mealType) {
  if (!openingHours || typeof openingHours !== 'object') return false;
  const window = MEAL_OPEN_WINDOWS[mealType];
  if (!window) return false;
  const range = parseOpeningRange(openingHours[dayKey]);
  if (!range) return false;
  return range.open < window.to && range.close > window.from;
}

// ─── Dagkeuze ───────────────────────────────────────────────────────────────

function fnv1a(value) {
  let hash = 0x811c9dc5;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function dayRank(dateKey, candidate, salt = '') {
  const key = [dateKey, candidate.restaurantId, candidate.dishId, candidate.name, salt].join('|');
  return fnv1a(key) / 0x100000000;
}

function isoDayNumber(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!match) return null;
  return Math.round(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000);
}

/** Is de menukaart in de laatste `maxDays` dagen bijgewerkt? */
function isNewlyUpdated(sourceDate, dateKey, maxDays = NEW_ON_MENU_DAYS) {
  const source = isoDayNumber(sourceDate);
  const today = isoDayNumber(dateKey);
  if (source === null || today === null) return false;
  const difference = today - source;
  return difference >= 0 && difference <= maxDays;
}

/** Bouwt de bestaande BE-12/BE-16 dish-deeplink plus het korte anker. */
function buildDishHref(candidate) {
  const params = new URLSearchParams();
  params.set('dish', candidate.dishId);
  params.set('name', candidate.name);
  params.set('cat', candidate.category);
  return `${candidate.menuLink}?${params.toString()}#gerecht-${candidate.dishId}`;
}


// ─── De selectie ────────────────────────────────────────────────────────────

function inSamePriceBucket(a, b) {
  const bucket = PRICE_BUCKETS.find((entry) => entry.test(a));
  return Boolean(bucket && bucket.test(b));
}

/**
 * Zorgt dat één voorkeur (vegetarisch of seizoen) meedoet als die er is,
 * zonder de prijsspreiding te breken: alleen een gerecht in dezelfde
 * prijsklasse wordt vervangen.
 */
function preferInSameBucket(selected, ranked, predicate) {
  if (selected.some(predicate)) return selected;
  // Een swap mag nooit een tweede gerecht van dezelfde zaak opleveren: een
  // ander gerecht van dezelfde kaart vervangen mag, een extra restaurant niet.
  const choices = ranked.filter((entry) => predicate(entry) && !selected.includes(entry));
  for (const candidate of choices) {
    for (let index = 0; index < selected.length; index += 1) {
      const current = selected[index];
      if (predicate(current)) continue;
      if (!inSamePriceBucket(current.priceValue, candidate.priceValue)) continue;
      const usedElsewhere = selected.some(
        (picked, position) => position !== index && picked.restaurantId === candidate.restaurantId
      );
      if (usedElsewhere) continue;
      const next = [...selected];
      next[index] = candidate;
      return next;
    }
  }
  return selected;
}

/**
 * De ene, pure selectiefunctie.
 *
 * @param {object} options
 * @param {Array<object>} options.candidates  compacte kandidaten uit
 *   src/lib/publicTonightData.js (geen volledig menu-archief)
 * @param {Date|number|string} [options.now]
 * @param {string} [options.timeZone]  standaard `Europe/Amsterdam`
 * @param {number} [options.maxDishes] standaard 3
 * @returns {{mealType:string,title:string,dateKey:string,dishes:Array<object>,hidden:boolean}}
 */
function selectTonight({ candidates = [], now = new Date(), timeZone = DEFAULT_TIME_ZONE, maxDishes = MAX_DISHES } = {}) {
  const limit = Number.isInteger(maxDishes) && maxDishes > 0 ? maxDishes : MAX_DISHES;
  const parts = zonedParts(now, timeZone);
  const mealType = mealMoment(parts.minutes);
  const title = mealTitle(mealType);

  const pool = [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (!candidate || candidate.mealType !== mealType) continue;
    if (!candidate.priceDisplay || candidate.priceValue == null || !(candidate.priceValue > 0)) continue;
    if (!isOpenForMoment(candidate.openingHours, parts.dayKey, mealType)) continue;
    // Een verlopen daghap blijft op de menukaart staan, maar hoort niet meer
    // in "Vanavond op de kaart".
    if (candidate.daily && candidate.daily.sourceDate !== parts.dateKey) continue;
    pool.push(candidate);
  }

  if (pool.length === 0) {
    return { mealType, title, dateKey: parts.dateKey, dishes: [], hidden: true };
  }

  // Eén rangorde voor alle kandidaten. Seizoenskaart en hoofdgerecht krijgen
  // een kleine voorkeur, "nieuw op de kaart" een lichte voorrang; de rest is
  // de stabiele dagvolgorde (hash van de datum). De prijsklassen hieronder
  // kiezen vervolgens per restaurant hooguit één gerecht.
  const ranked = pool
    .map((candidate) => {
      const newOnMenu = isNewlyUpdated(candidate.sourceDate, parts.dateKey);
      return {
        ...candidate,
        newOnMenu,
        cuisineFamily: cuisineFamily(candidate.cuisine),
        rank:
          dayRank(parts.dateKey, candidate) -
          (newOnMenu ? NEW_ON_MENU_BOOST : 0) -
          (candidate.seasonal ? 0.3 : 0) -
          (candidate.isMainCourse ? 0.1 : 0),
      };
    })
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.restaurantName.localeCompare(b.restaurantName, 'nl') ||
        a.name.localeCompare(b.name, 'nl')
    );

  // Prijsspreiding: één onder € 15, één van € 15 tot 25, één daarboven.
  // Binnen een klasse eerst een nog niet gebruikte keuken (zo veel mogelijk
  // verschillende keukens), daarna de dagvolgorde.
  const selected = [];
  const usedRestaurants = new Set();
  const usedCuisines = new Set();
  for (const bucket of PRICE_BUCKETS) {
    if (selected.length >= limit) break;
    const choices = ranked.filter(
      (candidate) => !usedRestaurants.has(candidate.restaurantId) && bucket.test(candidate.priceValue)
    );
    if (choices.length === 0) continue;
    const pick = choices.find((candidate) => !usedCuisines.has(candidate.cuisineFamily)) || choices[0];
    selected.push(pick);
    usedRestaurants.add(pick.restaurantId);
    usedCuisines.add(pick.cuisineFamily);
  }

  // Ontbreekt een prijsklasse, vul dan eerlijk aan uit de rest.
  for (const candidate of ranked) {
    if (selected.length >= limit) break;
    if (usedRestaurants.has(candidate.restaurantId)) continue;
    selected.push(candidate);
    usedRestaurants.add(candidate.restaurantId);
    usedCuisines.add(candidate.cuisineFamily);
  }

  // Eén seizoensgerecht als de kaart dat zelf zegt, en iets vegetarisch als
  // dat label er is. Beide alleen binnen dezelfde prijsklasse.
  const withSeason = preferInSameBucket(selected, ranked, (candidate) => !!candidate.seasonal);
  const finalSelection = preferInSameBucket(withSeason, ranked, (candidate) => !!candidate.vegetarian);

  const dishes = [...finalSelection]
    .sort((a, b) => a.priceValue - b.priceValue || a.name.localeCompare(b.name, 'nl'))
    .map((candidate) => ({
      dishId: candidate.dishId,
      name: candidate.name,
      restaurantId: candidate.restaurantId,
      restaurantName: candidate.restaurantName,
      cuisine: candidate.cuisine,
      category: candidate.category,
      mealType: candidate.mealType,
      priceDisplay: candidate.priceDisplay,
      priceValue: candidate.priceValue,
      emoji: candidate.emoji || dishEmoji(candidate.name, candidate.category),
      menuLink: candidate.menuLink,
      href: buildDishHref(candidate),
      vegetarian: !!candidate.vegetarian,
      seasonal: !!candidate.seasonal,
      newOnMenu: !!candidate.newOnMenu,
      daily: candidate.daily || null,
      openingHours: candidate.openingHours || null,
    }));

  return {
    mealType,
    title,
    dateKey: parts.dateKey,
    dishes,
    hidden: dishes.length < limit,
  };
}

module.exports = {
  MAX_DISHES,
  NEW_ON_MENU_DAYS,
  MEAL_TITLES,
  MEAL_OPEN_WINDOWS,
  PRICE_BUCKETS,
  EMOJI_RULES,
  dishEmoji,
  mealMoment,
  mealTitle,
  isMainDishCategory,
  honestPriceLabel,
  parseOpeningRange,
  isOpenForMoment,
  isNewlyUpdated,
  buildDishHref,
  dayRank,
  selectTonight,
};


