// BE-63 (#155) — de weergavekeuze van de publieke kop.
//
// Dezelfde opslagsleutel als src/components/ThemeToggle.js en de blokkerende
// startscript in app/layout.js (`bredaeats_theme`), met één verschil: naast
// 'light' en 'dark' kent de kop uit het goedgekeurde ontwerp ook 'auto'
// ("Automatisch"). Die stand volgt het systeem en wordt pas bij het tekenen
// omgezet in 'light' of 'dark'; de opgeslagen keuze blijft 'auto'.
//
// Geen nieuwe dependency en geen eigen kleur: dit bestand bepaalt alleen welke
// stand geldt. Kleuren staan in de tokens van app/globals.css.
//
// Bewust CommonJS, zoals dishList.js en sharePreference.js: direct testbaar met
// `node --test`, zonder browser of React.

'use strict';

const THEME_KEY = 'bredaeats_theme';

// De drie standen uit het ontwerp, in deze volgorde.
const THEME_OPTIONS = [
  { value: 'light', label: 'Licht' },
  { value: 'dark', label: 'Donker' },
  { value: 'auto', label: 'Automatisch' },
];
const THEME_VALUES = THEME_OPTIONS.map((option) => option.value);
const AUTO_THEME = 'auto';
// Zonder opgeslagen keuze is de pagina donker, precies zoals app/layout.js het
// al sinds THEME doet.
const DEFAULT_THEME = 'dark';

/** Alleen de drie echte standen; al het andere is geen keuze. */
function normalizeTheme(value) {
  const text = String(value === undefined || value === null ? '' : value).trim().toLowerCase();
  return THEME_VALUES.includes(text) ? text : null;
}

/** Het thema dat het systeem nu vraagt (`prefersLight` komt van matchMedia). */
function systemTheme(prefersLight) {
  return prefersLight ? 'light' : 'dark';
}

/**
 * De stand die de pagina echt moet hebben. 'auto' volgt het systeem; zonder
 * geldige keuze blijft het donker (bestaand gedrag).
 */
function resolveTheme(value, prefersLight) {
  const theme = normalizeTheme(value);
  if (theme === AUTO_THEME) return systemTheme(prefersLight);
  return theme || DEFAULT_THEME;
}

/** Lezen uit de opslag; zonder opslag of met een fout: geen keuze. */
function readThemePreference(storage) {
  if (!storage || typeof storage.getItem !== 'function') return null;
  try {
    return normalizeTheme(storage.getItem(THEME_KEY));
  } catch (error) {
    return null;
  }
}

/** Schrijven; lukt het niet, dan werkt de knop nog steeds voor deze sessie. */
function writeThemePreference(storage, value) {
  const theme = normalizeTheme(value);
  if (!theme) return false;
  if (!storage || typeof storage.setItem !== 'function') return false;
  try {
    storage.setItem(THEME_KEY, theme);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * De keuze toepassen op het document. Alleen dit attribuut verandert; de
 * themawaarden zelf staan in app/globals.css.
 */
function applyThemeChoice(value, prefersLight, root) {
  const target = root || (typeof document === 'undefined' ? null : document.documentElement);
  if (!target || typeof target.setAttribute !== 'function') return false;
  target.setAttribute('data-theme', resolveTheme(value, prefersLight));
  return true;
}

module.exports = {
  AUTO_THEME,
  DEFAULT_THEME,
  THEME_KEY,
  THEME_OPTIONS,
  THEME_VALUES,
  applyThemeChoice,
  normalizeTheme,
  readThemePreference,
  resolveTheme,
  systemTheme,
  writeThemePreference,
};
