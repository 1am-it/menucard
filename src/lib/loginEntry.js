'use strict';

// BE-59 (#146, punt 4) — /inloggen, als één geteste bron van tekst en paden.
//
// Er is vanaf 30 oktober één ingang. Die pagina herkent NIET zelf aan het
// e-mailadres of iemand houder of teamlid is: dat zou verraden welke adressen
// bij het team horen (besluit van de Lead). Elke bestemming is de bestaande
// inlogpagina met de bestaande, ongewijzigde beveiliging. Daarom komen de paden
// hier uit src/lib/ownerAccess.js in plaats van uit een tweede, losse string die
// uit elkaar kan lopen.

const { CLAIM_SEARCH_HREF, INTERNAL_LOGIN_HREF } = require('./ownerAccess');

// BE-63 (#155, ronde 4) — de tekst van /inloggen, als één geteste bron.
//
// Uitkomst 4 van het contract: het e-mailformulier staat direct op de pagina,
// het claimblok staat ernaast en de team-inlog is een kleine link onderaan. De
// vormgeving (accentlabel, titel, claimblok in --bg-elevated) volgt het op 31
// oktober goedgekeurde ontwerp. De koppen, teksten en stappen staan hier, zodat
// de pagina en de tests dezelfde woorden gebruiken en er geen tweede, net iets
// andere kopie ontstaat.
//
// Er is nog steeds geen rolherkenning aan het e-mailadres: /inloggen stuurt
// iedereen door dezelfde houder-inlog met e-mailcode (src/components/
// OwnerLoginCodeForm.js). De team-inlog is een eigen, kleine link naar de
// bestaande interne inlog.
const LOGIN_PAGE = Object.freeze({
  eyebrow: 'Voor restaurants',
  title: 'Inloggen bij je restaurant',
  intro:
    'Werk je menukaart, prijzen en daghap bij. Je krijgt een inlogcode per e-mail, een wachtwoord is niet nodig.',
  submitLabel: 'Stuur mij een inlogcode',
  emailHelp: 'Gebruik het adres waarmee je je restaurant hebt geclaimd.',
  claim: Object.freeze({
    title: 'Nog geen account?',
    body: 'Staat jouw restaurant al op onze menukaarten? Claim het gratis en beheer je eigen kaart.',
    steps: Object.freeze(['Zoek je restaurant', 'Bevestig dat het van jou is', 'Log in met je e-mailcode']),
    actionLabel: 'Claim je restaurant',
    actionHref: CLAIM_SEARCH_HREF,
  }),
  visitor: 'Bezoeker? Je hebt geen account nodig om te zoeken, te bewaren of samen te kiezen.',
  teamLabel: 'Werk je bij onze menukaarten? Team-inlog',
  teamHref: INTERNAL_LOGIN_HREF,
});

const CLAIM_LINK = {
  label: 'Nog geen account? Claim je restaurant',
  href: CLAIM_SEARCH_HREF,
};

// De ene ingang zelf, voor de footerlink op de publieke pagina's (punt 3).
const LOGIN_PAGE_HREF = '/inloggen';

module.exports = {
  LOGIN_PAGE,
  LOGIN_PAGE_HREF,
  CLAIM_LINK,
};
