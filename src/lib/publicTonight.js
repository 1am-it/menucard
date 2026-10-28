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
// BE-38 (#90) — de sectie blijft staan als het huidige moment te weinig
// gerechten heeft: eerst het eerstvolgende moment van vandaag waarop er wél
// genoeg is ("Straks op de kaart · vanaf HH:MM"), daarna de lunch van morgen
// ("Morgen op de kaart"). Pas als ook dat niets oplevert, verdwijnt de sectie.
// Nog steeds één selectiepad: dezelfde regels (echte prijs, bestelbaar
// gerecht, één per restaurant, prijsspreiding, vaste dagselectie) gelden voor
// het huidige moment én voor de terugval.
//
// Bewust CommonJS, zoals src/lib/openingStatus.js en src/lib/dishDeepLink.js.

const { zonedParts, DEFAULT_TIME_ZONE, DAY_KEYS } = require('./localTime');
const { cuisineFamily } = require('./cuisineStyle');
const { dutchDateLabel } = require('./dailyDish');
const { isOpenDuring, parseOpeningRange } = require('./openingStatus');
const { honestPriceLabel } = require('./menuPrice');

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

// BE-38 (#90) — de titels van de terugval. "Straks" krijgt het vroegste
// moment waarop de getoonde gerechten er echt zijn; "Morgen" noemt bewust
// geen tijd, want dat is de lunch van de volgende dag.
const LATER_ON_THE_MENU = 'Straks op de kaart';
const TOMORROW_ON_THE_MENU = 'Morgen op de kaart';

// De volgorde van de momenten binnen één dag. `mealMoment` noemt het kwartier
// tussen 15:00 en 16:00 al diner (eigenaarsbesluit BE-29); de terugval loopt
// daarom alleen verder in deze volgorde en nooit terug.
const MOMENT_SEQUENCE = ['lunch', 'borrel', 'diner'];

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

// ─── Openingstijden ─────────────────────────────────────────────────────────

/**
 * BE-38 (#90) — vanaf welk moment op deze weekdag zijn de gerechten van dit
 * menutype er echt? Dat is het latere van de openingstijd van het restaurant
 * en de start van het menumoment: een zaak die om 12:00 opengaat en tot 23:00
 * open blijft is om 16:30 al open, maar de dinerkeuze begint om 17:00. Zo
 * blijft "vanaf HH:MM" een tijd die nog moet komen in plaats van een
 * openingstijd van vanochtend.
 *
 * Een restaurant telt mee als zijn openingstijd het venster van het menutype
 * overlapt; de leesregel komt uit src/lib/openingStatus.js (dezelfde als
 * "Nu open"), niet uit een tweede interpretatie hier.
 *
 * `closes` is de sluitingstijd van die weekdag. Daarmee kan de selectie een
 * restaurant overslaan waarvan de dag er echt op zit (criterium 2 van BE-38:
 * na sluitingstijd toont de home morgen, geen "Vanavond op de kaart" meer).
 *
 * @returns {{opens:number, closes:number}|null} `opens` is het moment waarop de
 *   gerechten van dit menutype er echt zijn, `closes` het moment waarop het
 *   restaurant die dag sluit; null als het restaurant niet meedoet.
 */
function momentAvailability(openingHours, dayKey, mealType) {
  const window = MEAL_OPEN_WINDOWS[mealType];
  if (!window) return null;
  if (!isOpenDuring(openingHours, dayKey, window.from, window.to)) return null;
  const range = parseOpeningRange(openingHours && openingHours[dayKey]);
  if (!range) return null;
  return { opens: Math.max(range.open, window.from), closes: range.close };
}

/**
 * BE-38 (#90) — alleen het "vanaf"-moment van {@link momentAvailability}.
 * @returns {number|null} minuten na middernacht, of null als het niet meedoet
 */
function availableFrom(openingHours, dayKey, mealType) {
  const availability = momentAvailability(openingHours, dayKey, mealType);
  return availability ? availability.opens : null;
}

/**
 * Is het restaurant op deze weekdag open in het deel van de dag van dit
 * menutype? Een overlap is genoeg: een dinerkaart bij een zaak die om 17:00
 * opent telt mee, ook al is het nu 12:00.
 */
function isOpenForMoment(openingHours, dayKey, mealType) {
  return availableFrom(openingHours, dayKey, mealType) !== null;
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

/**
 * BE-38 (#90) — minuten na middernacht als "HH:MM", de notatie van de
 * openingstijden in data/restaurants.json.
 */
function clockLabel(minutes) {
  const value = ((Math.round(Number(minutes)) % 1440) + 1440) % 1440;
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

/**
 * BE-38 (#90) — de kalenderdag ná `dateKey`, met dezelfde tweeletterige
 * weekdagsleutel als data/restaurants.json. Berekend in UTC, dus onafhankelijk
 * van de tijdzone van de server of de machine.
 * @returns {{dateKey:string, dayKey:string}|null}
 */
function dayAfter(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1));
  return {
    dateKey: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`,
    dayKey: DAY_KEYS[date.getUTCDay()],
  };
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
    const sameBucket = [];
    for (let index = 0; index < selected.length; index += 1) {
      const current = selected[index];
      if (predicate(current)) continue;
      if (!inSamePriceBucket(current.priceValue, candidate.priceValue)) continue;
      const usedElsewhere = selected.some(
        (picked, position) => position !== index && picked.restaurantId === candidate.restaurantId
      );
      if (usedElsewhere) continue;
      sameBucket.push(index);
    }
    // Behoud een al gekozen seizoensgerecht als de vegetarische voorkeur ook
    // in een andere plek van dezelfde prijsklasse kan landen.
    const safeIndex = sameBucket.find((index) => !selected[index].seasonal);
    const index = safeIndex !== undefined ? safeIndex : sameBucket[0];
    if (index === undefined) continue;
    const next = [...selected];
    next[index] = candidate;
    return next;
  }
  return selected;
}

/**
 * BE-29 (#70) / BE-38 (#90) — de ene, pure keuze voor één moment op één
 * kalenderdag. De terugval gebruikt exact deze functie, zodat er geen tweede
 * selectiepad ontstaat.
 *
 * @param {Array<object>} candidates
 * @param {object} options
 * @param {string} options.dayKey   weekdag van die dag (zo..za)
 * @param {string} options.dateKey  kalenderdag (YYYY-MM-DD) voor de dagkeuze
 * @param {string} options.mealType 'lunch' | 'borrel' | 'diner'
 * @param {number} options.limit    hoeveel gerechten er hoogstens gekozen worden
 * @param {boolean} [options.withOpenTime]  geef elk gerecht zijn "vanaf"-tijd
 * @param {number|null} [options.afterMinutes]  sla restaurants over die op
 *   deze dag al gesloten zijn (minuten na middernacht); alleen het huidige
 *   moment gebruikt dit, zodat "na sluitingstijd" morgen toont
 * @returns {{dishes:Array<object>, opener:number|null}|null}
 *   `opener` is het vroegste moment (minuten na middernacht) waarop de
 *   gekozen gerechten er echt zijn.
 */
function selectMomentDishes(candidates, { dayKey, dateKey, mealType, limit, withOpenTime = false, afterMinutes = null }) {
  const pool = [];
  const opensAt = new Map();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (!candidate || candidate.mealType !== mealType) continue;
    if (!candidate.priceDisplay || candidate.priceValue == null || !(candidate.priceValue > 0)) continue;
    const availability = momentAvailability(candidate.openingHours, dayKey, mealType);
    if (!availability) continue;
    // Criterium 2: een restaurant waarvan de deur vandaag al dicht is, hoort
    // niet meer bij "dit moment"; de terugval zoekt dan verder (morgen).
    if (afterMinutes != null && availability.closes <= afterMinutes) continue;
    // Een verlopen daghap blijft op de menukaart staan, maar hoort niet meer
    // in deze sectie.
    if (candidate.daily && candidate.daily.sourceDate !== dateKey) continue;
    opensAt.set(candidate, availability.opens);
    pool.push(candidate);
  }

  if (pool.length === 0) return null;

  // Eén rangorde voor alle kandidaten. Seizoenskaart en hoofdgerecht krijgen
  // een kleine voorkeur, "nieuw op de kaart" een lichte voorrang; de rest is
  // de stabiele dagvolgorde (hash van de datum). De prijsklassen hieronder
  // kiezen vervolgens per restaurant hooguit één gerecht.
  const ranked = pool
    .map((candidate) => {
      const newOnMenu = isNewlyUpdated(candidate.sourceDate, dateKey);
      return {
        ...candidate,
        newOnMenu,
        cuisineFamily: cuisineFamily(candidate.cuisine),
        // De "vanaf"-tijd van dit gerecht, ook na de sortering nog bij het
        // juiste gerecht.
        opensMinutes: opensAt.get(candidate),
        rank:
          dayRank(dateKey, candidate) -
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
    .map((candidate) => {
      const dailyDate = candidate.daily && candidate.daily.sourceDate;
      const dateLabel = dailyDate ? dutchDateLabel(dailyDate) : null;
      return {
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
        daily: dailyDate
          ? { label: 'Daghap', emoji: '📅', sourceDate: dailyDate, dateLabel, dateLine: `volgens de kaart van ${dateLabel}` }
          : null,
        openingHours: candidate.openingHours || null,
        // Alleen bij de terugval: vanaf wanneer dit gerecht er echt is, zodat
        // de browser "🕒 Opent om HH:MM" kan tonen in plaats van "Nu open".
        opensAt: withOpenTime ? clockLabel(candidate.opensMinutes) : null,
      };
    });

  return {
    dishes,
    opener: Math.min(...finalSelection.map((candidate) => candidate.opensMinutes)),
  };
}

/**
 * De ene, pure selectiefunctie voor de moment-sectie op de home.
 *
 * @param {object} options
 * @param {Array<object>} options.candidates  compacte kandidaten uit
 *   src/lib/publicTonightData.js (geen volledig menu-archief)
 * @param {Date|number|string} [options.now]
 * @param {string} [options.timeZone]  standaard `Europe/Amsterdam`
 * @param {number} [options.maxDishes] standaard 3
 * @returns {{mealType:string,title:string,dateKey:string,mode:'now'|'later'|'tomorrow',
 *   opensFrom:string|null,dishes:Array<object>,hidden:boolean}}
 */
function selectTonight({ candidates = [], now = new Date(), timeZone = DEFAULT_TIME_ZONE, maxDishes = MAX_DISHES } = {}) {
  const limit = Number.isInteger(maxDishes) && maxDishes > 0 ? maxDishes : MAX_DISHES;
  const parts = zonedParts(now, timeZone);
  const list = Array.isArray(candidates) ? candidates : [];
  const mealType = mealMoment(parts.minutes);
  const nothing = {
    mealType,
    title: mealTitle(mealType),
    dateKey: parts.dateKey,
    mode: 'now',
    opensFrom: null,
    dishes: [],
    hidden: true,
  };

  // 1. Het huidige moment van vandaag. `afterMinutes` slaat restaurants over
  //    waarvan de deur vandaag al dicht is: na sluitingstijd is er vandaag
  //    niets meer (criterium 2), in plaats van een dinerkaart van een zaak die
  //    om 22:00 sloot.
  const current = selectMomentDishes(list, {
    dayKey: parts.dayKey,
    dateKey: parts.dateKey,
    mealType,
    limit,
    afterMinutes: parts.minutes,
  });
  if (current && current.dishes.length >= limit) {
    return { ...nothing, dishes: current.dishes, hidden: false };
  }

  // 2. BE-38 — het eerstvolgende moment van vandaag waarop er wél genoeg is.
  //    Elk gerecht draagt zijn eigen "vanaf"-tijd; de titel noemt het vroegste
  //    daarvan. Zo blijft "Nu open" voor wat nu echt open is.
  for (const laterType of MOMENT_SEQUENCE.slice(MOMENT_SEQUENCE.indexOf(mealType) + 1)) {
    const later = selectMomentDishes(list, {
      dayKey: parts.dayKey,
      dateKey: parts.dateKey,
      mealType: laterType,
      limit,
      withOpenTime: true,
    });
    if (!later || later.dishes.length < limit) continue;
    const opensFrom = clockLabel(later.opener);
    return {
      mealType: laterType,
      title: `${LATER_ON_THE_MENU} · vanaf ${opensFrom}`,
      dateKey: parts.dateKey,
      mode: 'later',
      opensFrom,
      dishes: later.dishes,
      hidden: false,
    };
  }

  // 3. BE-38 — niets meer vandaag: de lunch van morgen. Pas als ook die er
  //    niet is, verdwijnt de sectie.
  const tomorrow = dayAfter(parts.dateKey);
  if (tomorrow) {
    const nextDay = selectMomentDishes(list, {
      dayKey: tomorrow.dayKey,
      dateKey: tomorrow.dateKey,
      mealType: 'lunch',
      limit,
      withOpenTime: true,
    });
    if (nextDay && nextDay.dishes.length >= limit) {
      return {
        mealType: 'lunch',
        title: TOMORROW_ON_THE_MENU,
        dateKey: tomorrow.dateKey,
        mode: 'tomorrow',
        opensFrom: null,
        dishes: nextDay.dishes,
        hidden: false,
      };
    }
  }

  return nothing;
}

module.exports = {
  MAX_DISHES,
  NEW_ON_MENU_DAYS,
  MEAL_TITLES,
  MEAL_OPEN_WINDOWS,
  LATER_ON_THE_MENU,
  TOMORROW_ON_THE_MENU,
  MOMENT_SEQUENCE,
  PRICE_BUCKETS,
  EMOJI_RULES,
  dishEmoji,
  mealMoment,
  mealTitle,
  isMainDishCategory,
  honestPriceLabel,
  availableFrom,
  momentAvailability,
  isOpenForMoment,
  isNewlyUpdated,
  buildDishHref,
  dayRank,
  dayAfter,
  clockLabel,
  selectMomentDishes,
  selectTonight,
};


