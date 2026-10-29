// BE-44 (#105) — de kleuren van de voorvertoningsafbeelding (criterium 3).
//
// De eigenaar wil "zoveel mogelijk de kleuren van de app", en dat die
// meeveranderen als het thema verandert. De app zelf leest zijn kleuren uit
// app/globals.css (CSS-variabelen); `ImageResponse` (next/og) rendert buiten de
// browser en kan die variabelen niet lezen. Daarom staat de vertaling hier één
// keer als constante, met per waarde de token uit globals.css erbij — en
// src/lib/shareTheme.test.js vergelijkt elke waarde met het echte themablok in
// app/globals.css, zodat een themawijziging zonder deze lijst meteen opvalt.
//
// Toewijzing (contract, criterium 3):
//   licht : omlijsting --accent-fill, kaart --card-surface, tekst
//           --text-primary/--text-secondary, prijsvlak --surface-soft (met
//           --text-primary), lijnen --border;
//   donker : omlijsting --bg, kaart --bg-card, tekst #F2F3F4/#B6BCC3,
//           prijsvlak --surface-soft met --text-primary, lijnen --border.

'use strict';

const { normalizeShareTheme } = require('./dishShare');

const SHARE_THEME_TOKENS = {
  licht: {
    frame: '--accent-fill',
    card: '--card-surface',
    textPrimary: '--text-primary',
    textSecondary: '--text-secondary',
    priceBg: '--surface-soft',
    priceText: '--text-primary',
    border: '--border',
    // Het "om"-blokje rechtsonder: de eigen accenttegel, net als het
    // woordmerk en het app-icoon.
    logo: '--accent-fill',
    logoText: '--on-accent-fill',
  },
  donker: {
    frame: '--bg',
    card: '--bg-card',
    textPrimary: '--text-primary',
    textSecondary: '--text-secondary',
    priceBg: '--surface-soft',
    priceText: '--text-primary',
    border: '--border',
    logo: '--accent-fill',
    logoText: '--on-accent-fill',
  },
};

const SHARE_THEME = {
  licht: {
    frame: '#F6C057',
    card: '#FFFFFF',
    textPrimary: '#1A1410',
    textSecondary: '#5C5650',
    priceBg: '#F3F1EC',
    priceText: '#1A1410',
    border: '#EEEAE2',
    logo: '#F6C057',
    logoText: '#1F1600',
  },
  donker: {
    frame: '#1F2328',
    card: '#2A2F35',
    textPrimary: '#F2F3F4',
    textSecondary: '#B6BCC3',
    priceBg: '#353A41',
    priceText: '#F2F3F4',
    border: '#3A4048',
    logo: '#F2C35B',
    logoText: '#1F1600',
  },
};

/** De kleurenset van een stand; een onbekende stand is licht. */
function shareThemeFor(theme) {
  return SHARE_THEME[normalizeShareTheme(theme)];
}

// Het "om"-beeldmerk, precies zoals app/icon.svg het tekent. De afbeelding van
// het app-icoon (app/apple-icon.js) gebruikt deze ene bron; een test vergelijkt
// hem met het bestand zelf.
const APP_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#F6C057"/><g fill="none" stroke="#1F1600" stroke-width="2.8" stroke-linecap="round"><circle cx="10.6" cy="16.8" r="4.1"/><path d="M16.5 20.9v-5.6a2.4 2.4 0 014.8 0v5.6M21.3 15.3a2.4 2.4 0 014.8 0v5.6"/></g></svg>';

module.exports = {
  APP_ICON_SVG,
  SHARE_THEME,
  SHARE_THEME_TOKENS,
  shareThemeFor,
};
