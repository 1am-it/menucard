'use strict';

// BE-64 (#156) — de pagina /voor-restaurants, als één geteste bron van tekst,
// paden en het voorbeeld van het weekoverzicht.
//
// Uitkomst 1 tot en met 5 van het contract staan hier als tekst, zodat de pagina
// en de tests dezelfde woorden gebruiken. De pagina zelf is een Server Component
// (app/voor-restaurants/page.js) en leest alleen dit object.
//
// Twee dingen zijn met opzet zo:
//
//   - Het weekoverzicht toont "—" in plaats van cijfers. Er staan geen echte en
//     geen verzonnen getallen in dit voorbeeld; het is voorbeeldwerk uit "Mijn
//     restaurant".
//   - Het allergenenblok zegt niet dat de site de wet naleeft, keurt of
//     certificeert. Dat volgt het bestaande taalbeleid van
//     src/lib/nvwaComplianceCopy.test.js: het overzicht is een momentopname van
//     wat de houder zelf invult en de houder blijft verantwoordelijk.
//
// De knop "Bekijk een voorbeeld" leidt naar /nvwa/[id] van één restaurant uit de
// statische gegevens met ingevulde allergenen (BE-08). Die pagina heeft al een
// printknop (window.print, ook "opslaan als pdf") en dezelfde momentopname-tekst.
// Het id staat hieronder vast en wordt in app/voor-restaurants/page.test.js
// gecontroleerd tegen data/restaurants.json en data/menus.json.

const { LOGIN_PAGE_HREF } = require('./loginEntry');
const { CLAIM_SEARCH_HREF } = require('./ownerAccess');

// Restaurant Wolfslaar: 14 van zijn 25 gerechten hebben een allergenenwaarde in
// data/menus.json, dus het voorbeeld is geen lege matrix.
const NVWA_PREVIEW_RESTAURANT_ID = '1';

const FOR_RESTAURANTS_HREF = '/voor-restaurants';

const FOR_RESTAURANTS = Object.freeze({
  metadata: Object.freeze({
    title: 'Voor restaurants · onze menukaarten',
    description:
      'Gasten zoeken bij ons op gerecht, met prijs erbij. Beheer zelf je kaart, je prijzen en je daghap, en zie wat gasten interessant vinden.',
  }),
  title: 'Gasten zoeken op gerecht. Zorg dat ze jóuw kaart vinden.',
  intro:
    'Op onze menukaarten zoekt Breda op wat ze willen eten, met prijs erbij. Beheer zelf je kaart, je prijzen en je daghap, en zie wat gasten interessant vinden.',
  primary: Object.freeze({
    label: 'Claim je restaurant',
    href: CLAIM_SEARCH_HREF,
  }),
  secondary: Object.freeze({
    label: 'Ik heb al een account',
    href: LOGIN_PAGE_HREF,
  }),
  micro: 'Claimen kost niets · inloggen met een e-mailcode, zonder wachtwoord',
  preview: Object.freeze({
    eyebrow: 'Deze week · jouw restaurant',
    // Geen cijfers: dit is een voorbeeld, geen echte week van een restaurant.
    empty: '—',
    stats: Object.freeze([
      Object.freeze({ label: 'keer in de top' }),
      Object.freeze({ label: 'keer bekeken' }),
      Object.freeze({ label: 'keer bewaard' }),
      Object.freeze({ label: 'keer gedeeld' }),
    ]),
    caption: 'Voorbeeld van je eigen overzicht in Mijn restaurant',
  }),
  featuresTitle: 'Wat je krijgt',
  soonLabel: 'Binnenkort',
  features: Object.freeze([
    Object.freeze({
      key: 'dish',
      title: 'Gevonden op gerecht',
      body: 'Wie "mosselen" of "pasta onder €15" zoekt, ziet jouw gerechten met prijs. Niet alleen je naam.',
    }),
    Object.freeze({
      key: 'price',
      title: 'Zelf prijzen aanpassen',
      body: 'Nieuwe prijs of even op? Pas het aan en zet een gerecht op "tijdelijk niet beschikbaar".',
    }),
    Object.freeze({
      key: 'today',
      title: 'Daghap en seizoen',
      body: 'Plaats je daghap of seizoensgerecht. Het staat direct bij "Vandaag" en in de zoekresultaten.',
    }),
    Object.freeze({
      key: 'stats',
      title: 'Zien wat werkt',
      body: 'Per week: hoe vaak je gerechten in de top staan, bekeken, bewaard en gedeeld worden.',
    }),
    Object.freeze({
      key: 'share',
      title: 'Gasten delen je gerechten',
      body: 'Elke gedeelde link brengt nieuwe gasten naar jouw kaart.',
    }),
    Object.freeze({
      key: 'qr',
      title: 'QR-kaartje op tafel',
      body: 'Een kaartje dat naar je actuele menukaart leidt, altijd met de goede prijzen.',
      soon: true,
    }),
  ]),
  allergens: Object.freeze({
    title: 'Allergenenoverzicht om te downloaden',
    body:
      'Leg per gerecht de 14 allergenen uit EU-verordening 1169/2011 vast en download of print het overzicht voor je team en je gasten. Het overzicht is een momentopname van wat je zelf hebt ingevuld. Jij blijft verantwoordelijk voor de juistheid, je recepten, je leveranciers en het risico op kruisbesmetting.',
    actionLabel: 'Bekijk een voorbeeld',
    previewHref: `/nvwa/${NVWA_PREVIEW_RESTAURANT_ID}`,
  }),
});

module.exports = {
  FOR_RESTAURANTS,
  FOR_RESTAURANTS_HREF,
  NVWA_PREVIEW_RESTAURANT_ID,
};
