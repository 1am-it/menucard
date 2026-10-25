// BE-29 (#70) — één kleine, pure klokhulp voor de publieke pagina's.
//
// "Vanavond op de kaart", de seizoenstegels en de daghap hangen van de
// kalenderdag in Breda af, niet van de tijdzone van de server of de bezoeker.
// Deze module rekent daarom expliciet in `Europe/Amsterdam` en geeft alleen
// de onderdelen terug die de rest van de code nodig heeft. Geen dependency:
// `Intl.DateTimeFormat` zit in Node en in de browser.
//
// Bewust CommonJS, zoals src/lib/openingStatus.js en src/lib/dishDeepLink.js:
// direct testbaar met `node --test`, importeerbaar vanuit de
// 'use client'-weergaven zonder de data/menus.json in de clientbundel te
// trekken.

'use strict';

const DEFAULT_TIME_ZONE = 'Europe/Amsterdam';
const DAY_KEYS = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];

// en-GB levert de Engelse weekdagnaam (Sun..Sat); de rest van de code gebruikt
// dezelfde tweeletterige sleutels als data/restaurants.json.
const WEEKDAY_TO_DAY_KEY = {
  Sun: 'zo',
  Mon: 'ma',
  Tue: 'di',
  Wed: 'wo',
  Thu: 'do',
  Fri: 'vr',
  Sat: 'za',
};

const formatterCache = new Map();

function formatterFor(timeZone) {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hour12: false,
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function fail(message) {
  throw new TypeError(`localTime: ${message}`);
}

/**
 * Kalenderonderdelen van één moment in de opgegeven tijdzone.
 * @param {Date|number|string} now
 * @param {string} [timeZone]
 * @returns {{year:number,month:number,day:number,hour:number,minute:number,
 *   minutes:number,dayKey:string,dateKey:string,timeZone:string}}
 */
function zonedParts(now, timeZone = DEFAULT_TIME_ZONE) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) fail('ongeldig moment');
  const parts = {};
  for (const part of formatterFor(timeZone).formatToParts(date)) {
    parts[part.type] = part.value;
  }
  // Intl kan middernacht als "24" teruggeven; reken dat terug naar 0.
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) fail('onleesbaar moment');
  const dayKey = WEEKDAY_TO_DAY_KEY[parts.weekday];
  if (!dayKey) fail(`onbekende weekdag ${parts.weekday}`);
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  return {
    year,
    month,
    day,
    hour,
    minute,
    minutes: hour * 60 + minute,
    dayKey,
    dateKey: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    timeZone,
  };
}

module.exports = {
  DEFAULT_TIME_ZONE,
  DAY_KEYS,
  zonedParts,
};
