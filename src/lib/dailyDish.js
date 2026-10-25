// BE-29 (#70) — de daghap, eerlijk en zonder gokken.
//
// Een gerecht is pas een daghap als de bron het zelf zegt: "Daghap",
// "Dagschotel", "Dagspecial", "Vandaag" of het bestaande `dagspecial`-label.
// Nooit op basis van een los woord in de gerechtnaam of een aanname over
// "vandaag". Het label komt altijd met de brondatum van de menukaart
// ("volgens de kaart van 25 maart 2026"), en een verlopen daghap blijft op de
// menukaart zichtbaar met die datum. Er is geen dagelijkse automatische
// controle van bronnen.
//
// Bewust CommonJS, zoals src/lib/openingStatus.js.

'use strict';

const { zonedParts, DEFAULT_TIME_ZONE } = require('./localTime');

const DAILY_PATTERNS = [
  /\bdaghap\b/i,
  /\bdagschotel\b/i,
  /\bdagspecial\b/i,
  /\bvandaag\b/i,
];

const MONTHS_NL = [
  'januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december',
];

function parseIsoDate(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day, iso: `${match[1]}-${match[2]}-${match[3]}` };
}

/** "2026-03-25" → "25 maart 2026". */
function dutchDateLabel(value) {
  const parsed = parseIsoDate(value);
  if (!parsed) return null;
  return `${parsed.day} ${MONTHS_NL[parsed.month - 1]} ${parsed.year}`;
}

/**
 * Noemt de bron dit gerecht zelf een daghap?
 * @param {{name?:string,desc?:string,sup?:string,tags?:string[]}} item
 * @param {{category?:string,menuTitle?:string,menuSubtitle?:string}} [context]
 */
function isDailyDish(item, context = {}) {
  if (!item || typeof item !== 'object') return false;
  if (Array.isArray(item.tags) && item.tags.includes('dagspecial')) return true;
  const text = [
    item.name,
    item.desc,
    item.sup,
    context.category,
    context.menuTitle,
    context.menuSubtitle,
  ]
    .filter((value) => typeof value === 'string' && value.trim())
    .join('\n');
  return DAILY_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Het volledige, eerlijke daghap-label. Zonder leesbare brondatum geen label:
 * "altijd met de brondatum" is een harde eis, dus een kale gok valt weg.
 * @returns {{label:string,emoji:string,sourceDate:string,dateLabel:string,dateLine:string}|null}
 */
function dailyDishInfo(item, context = {}) {
  if (!isDailyDish(item, context)) return null;
  const parsed = parseIsoDate(context.sourceDate);
  if (!parsed) return null;
  const dateLabel = dutchDateLabel(parsed.iso);
  return {
    label: 'Daghap',
    emoji: '📅',
    sourceDate: parsed.iso,
    dateLabel,
    dateLine: `volgens de kaart van ${dateLabel}`,
  };
}

/**
 * Is de bron van vandaag? Alleen dan mag de daghap in "Vanavond op de kaart".
 * @param {{sourceDate?:string}|null} info
 * @param {Date|number|string} now
 * @param {string} [timeZone]
 */
function isDailyFromToday(info, now, timeZone = DEFAULT_TIME_ZONE) {
  const parsed = parseIsoDate(info && info.sourceDate);
  if (!parsed) return false;
  return parsed.iso === zonedParts(now, timeZone).dateKey;
}

/**
 * 'today' | 'expired' | null — de menukaart toont een verlopen daghap gewoon
 * met zijn brondatum; alleen de home laat hem weg.
 */
function dailyDishStatus(info, now, timeZone = DEFAULT_TIME_ZONE) {
  const parsed = parseIsoDate(info && info.sourceDate);
  if (!parsed) return null;
  return parsed.iso === zonedParts(now, timeZone).dateKey ? 'today' : 'expired';
}

module.exports = {
  DAILY_PATTERNS,
  parseIsoDate,
  dutchDateLabel,
  isDailyDish,
  dailyDishInfo,
  isDailyFromToday,
  dailyDishStatus,
};
