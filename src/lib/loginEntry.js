'use strict';

// BE-59 (#146, punt 4) — de keuzes op /inloggen, als één geteste bron.
//
// Er is vanaf 30 oktober één ingang. Die pagina herkent NIET zelf aan het
// e-mailadres of iemand houder of teamlid is: dat zou verraden welke adressen
// bij het team horen (besluit van de Lead). De bezoeker kiest zelf, en elke
// bestemming is de bestaande inlogpagina met de bestaande, ongewijzigde
// beveiliging. Daarom komen de paden hier uit src/lib/ownerAccess.js in plaats
// van uit een tweede, losse string die uit elkaar kan lopen.

const { CLAIM_SEARCH_HREF, INTERNAL_LOGIN_HREF, OWNER_LOGIN_HREF } = require('./ownerAccess');

const LOGIN_CHOICES = [
  {
    id: 'owner',
    label: 'Ik heb een restaurant',
    href: OWNER_LOGIN_HREF,
    detail: 'Je ontvangt een code per e-mail en logt daarmee in.',
    hint: 'E-mailcode',
  },
  {
    id: 'team',
    label: 'Ik werk bij onze menukaarten',
    href: INTERNAL_LOGIN_HREF,
    detail: 'Je logt in met je wachtwoord en je authenticator.',
    hint: 'Wachtwoord en authenticator',
  },
];

const CLAIM_LINK = {
  label: 'Nog geen account? Claim je restaurant',
  href: CLAIM_SEARCH_HREF,
};

// De ene ingang zelf, voor de footerlink op de publieke pagina's (punt 3).
const LOGIN_PAGE_HREF = '/inloggen';

const LOGIN_INTRO =
  'Kies hieronder hoe je inlogt. We raden niet aan je e-mailadres welke rol je hebt; elke route heeft zijn eigen beveiliging.';

module.exports = {
  LOGIN_CHOICES,
  LOGIN_INTRO,
  LOGIN_PAGE_HREF,
  CLAIM_LINK,
};
