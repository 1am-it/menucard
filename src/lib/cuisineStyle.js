// BE-28b (#68) — één kleine keukenmapping voor de publieke pagina's.
//
// De keuken van een restaurant staat in data/restaurants.json als vrije,
// samengestelde tekst ("Modern Frans · Fine Dining", "Biercafé · Amerikaans ·
// Burgers"). Deze module leidt daaruit één familienaam en één decoratief
// emoji af. Geen nieuwe data, geen API en geen dependency: alleen een korte,
// geteste tabel.
//
// Werkwijze: splitst het label op " · " en kijkt segment voor segment of het
// bij een bekende familie hoort. Zo wint het eerste, meest specifieke deel
// ("Biercafé · Amerikaans" is een Biercafé) en blijft "Baskisch · Grill" een
// Grill. Een onbekende keuken houdt zijn eigen eerste segment als chipnaam en
// krijgt het neutrale 🍽️ als emoji (acceptatiecriterium 3).
//
// Deliberately CommonJS, zoals src/lib/openingStatus.js en
// src/lib/dishDeepLink.js: direct testbaar met `node --test`, importeerbaar
// vanuit de ESM-clientcomponenten.

'use strict';

const FALLBACK_EMOJI = '🍽️';

// Volgorde is niet belangrijker dan de segmentvolgorde hierboven; binnen één
// segment wint de eerste treffer. "grand café" staat vóór "café" zodat een
// grand café als Nederlands telt en niet als los café.
const FAMILIES = [
  { family: 'Biercafé', emoji: '🍺', keywords: ['biercafé', 'biercafe', 'bierbar', 'bier'] },
  { family: 'Italiaans', emoji: '🍝', keywords: ['italiaans', 'italian', 'pizza', 'pasta'] },
  { family: 'Grill', emoji: '🥩', keywords: ['grill', 'steak', 'steakhouse'] },
  { family: 'Mediterraans', emoji: '🥘', keywords: ['mediterraans', 'mediterraan', 'mediterranean'] },
  { family: 'Indonesisch', emoji: '🍜', keywords: ['indonesisch', 'indonesian', 'moluks'] },
  { family: 'Chinees', emoji: '🥡', keywords: ['chinees', 'chinese', 'kantonees'] },
  { family: 'Frans', emoji: '🥂', keywords: ['frans', 'franse', 'french', 'brasserie'] },
  { family: 'Indiaas', emoji: '🍛', keywords: ['indiaas', 'indian', 'curry'] },
  { family: 'Midden-Oosters', emoji: '🧆', keywords: ['midden-oosters', 'midden-oosten', 'middle-eastern', 'noord-afrikaans', 'halal'] },
  { family: 'Nederlands', emoji: '🥨', keywords: ['nederlands', 'hollands', 'grand café', 'grand cafe'] },
  { family: 'Modern Europees', emoji: '🍴', keywords: ['modern europees', 'scandinavisch', 'seizoensgebonden'] },
  { family: 'Fusion', emoji: '🥢', keywords: ['fusion', 'oosterse'] },
];

function normalize(value) {
  return String(value || '').toLowerCase().trim();
}

function segmentsOf(cuisine) {
  return String(cuisine || '')
    .split('·')
    .map((part) => part.trim())
    .filter(Boolean);
}

// Geeft de familie van een keukenlabel. Onbekend? Dan het eerste segment,
// zodat een nieuwe keuken een eigen, eerlijke chip krijgt in plaats van bij
// een verkeerde bestaande familie te worden ingedeeld.
function cuisineFamily(cuisine) {
  const segments = segmentsOf(cuisine);
  for (const segment of segments) {
    const needle = normalize(segment);
    for (const entry of FAMILIES) {
      if (entry.keywords.some((keyword) => needle.includes(keyword))) return entry.family;
    }
  }
  return segments.length > 0 ? segments[0] : 'Onbekend';
}

// Geeft het emoji van een keukenlabel of familienaam. Een onbekende keuken
// krijgt altijd de neutrale terugval; nooit een gok of een willekeurig teken.
function cuisineEmoji(cuisine) {
  const family = cuisineFamily(cuisine);
  const entry = FAMILIES.find((candidate) => candidate.family === family);
  return entry ? entry.emoji : FALLBACK_EMOJI;
}

module.exports = { cuisineFamily, cuisineEmoji, FALLBACK_EMOJI, FAMILIES };
