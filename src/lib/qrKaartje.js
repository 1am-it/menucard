'use strict';

// BE-68 (#168) — het QR-kaartje voor op tafel, als één geteste beslissing.
//
// Wat hier staat (en wat de pagina dus niet zelf hoeft te bedenken):
//   qrUrl              de absolute URL achter de QR-code: het doel (/menu/[id] of
//                      /restaurant/[id]), de basis uit NEXT_PUBLIC_SITE_URL met
//                      de huidige oorsprong als terugval, en `?bron=qr` voor de
//                      bestaande tellers;
//   controleerQrTekst  de tekst op het kaartje: maximaal 40 tekens en dezelfde
//                      filters als de daghap (geen link, e-mail, telefoonnummer,
//                      geen hele tekst in hoofdletters, geen "!!!", max. 3 emoji);
//   QR_MATEN           de maten per formaat: A6, 4×A6 op een A4 en de PNG;
//   kiesRestaurant     toegang: alleen een `owner`-rij met restaurant_id telt,
//                      net als op /mijn-restaurant/aanbod;
//   toonNietLive       de melding zolang NEXT_PUBLIC_SITE_INDEXABLE niet 'true' is.
//
// Geen React, geen netwerk, geen klok: `node --test` laadt dit direct en de
// client gebruikt hetzelfde bestand als de tests. De QR-code zelf komt uit
// `qrcode-generator` (MIT) en wordt alleen op deze pagina dynamisch geladen.

const { berichtBij, controleerTekst } = require('./daghapAanbod');
const { isIndexable } = require('./seo');
const { eigenRestaurants } = require('./ownerAanbod');

// De tekst op het kaartje: kort genoeg om op A6 in twee regels te passen.
const QR_TEKST_MAX = 40;
const QR_STANDAARD_TEKST = 'Bekijk onze menukaart';

// De teller op de publieke pagina's kent al `?bron=`; dit is de waarde van dit
// kaartje, zodat de opbrengst per bron te zien blijft.
const QR_BRON = 'qr';

// Minstens M (contract) en een rustzone van 4 modules, zodat scanners het kaartje
// ook vanaf een tafelrand lezen.
const QR_FOUTCORRECTIE = 'M';
const QR_RUSTZONE = 4;

/** De twee doelen als keuzekaarten; de volgorde is die van het ontwerp. */
const QR_DOELEN = Object.freeze([
  Object.freeze({
    value: 'menu',
    label: 'De menukaart',
    hint: 'Gasten zien je actuele menukaart met de prijzen van vandaag.',
  }),
  Object.freeze({
    value: 'restaurant',
    label: 'De restaurantpagina',
    hint: 'Gasten zien je menukaart, je daghap en je adres bij elkaar.',
  }),
]);

/** De drie formaten als schakelaar; de maten staan in QR_MATEN. */
const QR_FORMATEN = Object.freeze([
  Object.freeze({ value: 'a6', label: 'Tafelkaartje A6' }),
  Object.freeze({ value: 'a4', label: '4 op een A4' }),
  Object.freeze({ value: 'png', label: 'Alleen de QR (PNG)' }),
]);

// A6 is 105 × 148 mm; vier daarvan passen precies op een A4 (2 × 2). De PNG is
// de QR met rustzone, zonder kaartje eromheen.
const QR_MATEN = Object.freeze({
  a6: Object.freeze({
    pagina: 'A6',
    kaartBreedteMm: 105,
    kaartHoogteMm: 148,
    perPagina: 1,
    qrMm: 62,
    px: 1240,
  }),
  a4: Object.freeze({
    pagina: 'A4',
    kaartBreedteMm: 105,
    kaartHoogteMm: 148,
    perPagina: 4,
    qrMm: 62,
    px: 1240,
  }),
  png: Object.freeze({
    pagina: null,
    kaartBreedteMm: 0,
    kaartHoogteMm: 0,
    perPagina: 0,
    qrMm: 0,
    px: 1024,
  }),
});

/** De vaste teksten van de pagina; één plek, zodat niets twee versies krijgt. */
const QR_MESSAGES = Object.freeze({
  title: 'QR-kaartje voor op tafel',
  intro:
    'Gasten scannen het kaartje en zien direct je actuele menukaart, met de goede prijzen. Prijs aangepast? Het kaartje toont direct de nieuwe prijs, opnieuw afdrukken is niet nodig.',
  doelLegend: 'Waar gaat de QR-code naartoe?',
  tekstLabel: 'Tekst op het kaartje',
  tekstHint: `Maximaal ${QR_TEKST_MAX} tekens.`,
  formaatLegend: 'Formaat',
  download: 'Download pdf',
  print: 'Afdrukken',
  share: 'Deel de QR-afbeelding',
  shareFallback: 'De QR-afbeelding is gedownload.',
  adjust: 'Tekst of formaat aanpassen',
  preview: 'Voorbeeld',
  previewFooter: 'Scan met je camera · altijd met prijzen',
  previewLogoMark: 'om',
  previewLogo: 'onze menukaarten',
  notLive: 'Je kunt het kaartje al bekijken. Druk het af zodra Onze Menukaarten live is.',
  printHint: 'Kies in het printvenster "Opslaan als pdf" voor een pdf-bestand.',
  tekstLeeg: 'Vul een tekst op het kaartje in.',
  tekstTeLang: `Gebruik maximaal ${QR_TEKST_MAX} tekens op het kaartje.`,
  loading: 'Bezig met laden…',
  genericError: 'Er ging iets mis. Probeer het opnieuw.',
  noRestaurant: 'Je account is nog niet aan een goedgekeurd restaurant gekoppeld.',
  restaurantLabel: 'Restaurant',
  qrError: 'De QR-code kon niet gemaakt worden. Probeer het opnieuw.',
});

/** De twee foutcodes van dit formulier; de tekstfilters houden hun eigen codes. */
const QR_FOUTEN = Object.freeze({
  leeg: 'kaarttekst_leeg',
  teLang: 'kaarttekst_te_lang',
});

function tekst(value) {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return String(value);
}

/** Witruimte aan de randen weg en dubbele witruimte tot één spatie. */
function opschonen(value) {
  return tekst(value).replace(/\s+/g, ' ').trim();
}

/** Een basis-URL zonder slashes aan het eind, en altijd met een schema. */
function absoluteBasis(value) {
  const schoon = tekst(value).trim().replace(/\/+$/, '');
  if (!schoon) return '';
  if (/^https?:\/\//i.test(schoon)) return schoon;
  return `https://${schoon}`;
}

/**
 * De basis voor de QR-code: NEXT_PUBLIC_SITE_URL, en pas als die leeg is de
 * oorsprong waarop de pagina draait. Leeg blijft leeg — dan is er geen kaartje.
 */
function basisUrl({ siteUrl, origin } = {}) {
  return absoluteBasis(siteUrl) || absoluteBasis(origin);
}

/** Het pad achter de QR-code: de menukaart (standaard) of de restaurantpagina. */
function doelPad({ doel, restaurantId } = {}) {
  const id = tekst(restaurantId).trim();
  if (!id) return '';
  const soort = tekst(doel).trim() === 'restaurant' ? 'restaurant' : 'menu';
  return `/${soort}/${encodeURIComponent(id)}`;
}

/**
 * De absolute URL die in de QR-code staat, inclusief `?bron=qr`. Zonder id of
 * zonder basis is er geen URL: dan levert deze functie een lege string, nooit
 * een half adres.
 */
function qrUrl({ doel = 'menu', restaurantId, siteUrl, origin } = {}) {
  const basis = basisUrl({ siteUrl, origin });
  const pad = doelPad({ doel, restaurantId });
  if (!basis || !pad) return '';
  return `${basis}${pad}?bron=${QR_BRON}`;
}

/**
 * De tekst op het kaartje controleren: lengte in tekens (niet in bytes, zodat
 * een emoji één teken is) plus dezelfde filters als de daghap. `effectief` is
 * wat er op het kaartje komt; bij een leeg veld blijft dat de standaardtekst.
 */
function controleerQrTekst(value) {
  const schoon = opschonen(value);
  const lengte = [...schoon].length;
  const codes = [];
  if (!lengte) codes.push(QR_FOUTEN.leeg);
  else if (lengte > QR_TEKST_MAX) codes.push(QR_FOUTEN.teLang);
  for (const code of controleerTekst(schoon).fouten) {
    if (!codes.includes(code)) codes.push(code);
  }
  return {
    ok: codes.length === 0,
    invoer: schoon,
    effectief: schoon || QR_STANDAARD_TEKST,
    lengte,
    codes,
  };
}

/** De Nederlandse zin bij een foutcode van dit formulier. */
function meldingBij(code) {
  if (code === QR_FOUTEN.leeg) return QR_MESSAGES.tekstLeeg;
  if (code === QR_FOUTEN.teLang) return QR_MESSAGES.tekstTeLang;
  return berichtBij(code) || '';
}

/** Alle zinnen bij een lijst codes, zonder dubbelingen. */
function meldingenBij(codes) {
  const zinnen = [];
  for (const code of Array.isArray(codes) ? codes : []) {
    const zin = meldingBij(code);
    if (zin && !zinnen.includes(zin)) zinnen.push(zin);
  }
  return zinnen;
}

/** De teller onder het tekstveld: `"24/40"`. */
function tekstTeller(value) {
  return `${[...opschonen(value)].length}/${QR_TEKST_MAX}`;
}

/** De maten van een formaat; een onbekende waarde valt terug op het A6-kaartje. */
function formaatMaat(value) {
  const sleutel = tekst(value).trim();
  return QR_MATEN[sleutel] || QR_MATEN.a6;
}

/** Is dit een van de drie formaten uit het contract? */
function isQrFormaat(value) {
  return Object.prototype.hasOwnProperty.call(QR_MATEN, tekst(value).trim());
}

/**
 * Welk restaurant deze houder op deze pagina mag gebruiken. Alleen een eigen
 * `owner`-rij telt: vraagt iemand om een restaurant dat niet van hem is, dan
 * krijgt hij zijn eigen eerste restaurant (of niets), nooit andermans kaartje.
 */
function kiesRestaurant({ roles, restaurantIndex, gevraagdId } = {}) {
  const eigen = eigenRestaurants({ roles, restaurantIndex });
  if (eigen.length === 0) return null;
  const id = tekst(gevraagdId).trim();
  return eigen.find((restaurant) => restaurant.id === id) || eigen[0];
}

/**
 * De melding zolang de site niet publiek is: NEXT_PUBLIC_SITE_INDEXABLE is pas
 * 'true' als de site live mag. Dezelfde vlag als de noindex-kop.
 */
function toonNietLive(siteIndexable) {
  return !isIndexable(siteIndexable);
}

/** De zin die bij die vlag hoort (leeg als de site wel publiek is). */
function nietLiveMelding(siteIndexable) {
  return toonNietLive(siteIndexable) ? QR_MESSAGES.notLive : '';
}

module.exports = {
  QR_BRON,
  QR_DOELEN,
  QR_FORMATEN,
  QR_FOUTCORRECTIE,
  QR_FOUTEN,
  QR_MATEN,
  QR_MESSAGES,
  QR_RUSTZONE,
  QR_STANDAARD_TEKST,
  QR_TEKST_MAX,
  absoluteBasis,
  basisUrl,
  controleerQrTekst,
  doelPad,
  formaatMaat,
  isQrFormaat,
  kiesRestaurant,
  meldingBij,
  meldingenBij,
  nietLiveMelding,
  qrUrl,
  tekstTeller,
  toonNietLive,
};
