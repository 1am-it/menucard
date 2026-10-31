'use strict';

// BE-67 (#164) — de kleine, gedeelde kant van daghap, dagmenu en seizoensgerecht:
// de soorten, de grenzen, de meldingen, de foutcodes en de labels.
//
// Waarom dit een eigen bestand is: dit zijn de enige delen die een scherm nodig
// heeft (src/lib/daghapFormulier.js). De regels zelf — normaliseren, het filter,
// het verloop, de herhaling, "staat dit vandaag online" — staan in
// daghapAanbod.js en horen bij de server. Zo komt het regelbestand niet in het
// eerste JS-pakket van een publieke pagina, ook niet als één component een
// melding van dit scherm toont (contractcriterium: de eerste lading groeit
// hooguit 1 KB).
//
// Bewust CommonJS, zoals kiesStemming.js: `node --test` laadt het zonder
// omzetting en de client gebruikt hetzelfde bestand als de tests.

const DAGHAP_SOORTEN = Object.freeze(['daghap', 'dagmenu', 'seizoensgerecht']);
// De gangen van een dagmenu, in de volgorde waarin de gast ze leest.
const DAGHAP_GANGEN = Object.freeze(['voor', 'hoofd', 'na']);
const DAGHAP_MIN_GANGEN = 2;
const DAGHAP_MAX_GANGEN = 3;
const DAGHAP_GANG_NAAM_MAX = 80;
// De ISO-weekdagen: 1 = maandag, 7 = zondag.
const DAGHAP_WEEKDAGEN = Object.freeze([1, 2, 3, 4, 5, 6, 7]);
const DAGHAP_LABELS = Object.freeze(['vegetarisch', 'veganistisch', 'glutenvrij']);
const DAGHAP_ACTIEVE_STATUSSEN = Object.freeze(['online', 'in_controle']);
const DAGHAP_STATUS_ONLINE = 'online';
const DAGHAP_STATUS_CONTROLE = 'in_controle';
const DAGHAP_STATUS_OFFLINE = 'offline';
const DAGHAP_STATUS_VERLOPEN = 'verlopen';

const DAGHAP_BESCHRIJVING_MAX = 140;
const DAGHAP_MAX_EMOJI = 3;
const DAGHAP_MAX_SEIZOEN = 3;
const DAGHAP_MAX_WIJZIGINGEN_PER_DAG = 10;
const DAGHAP_MAX_DAGEN_VOORUIT = 90;
const DAGHAP_TIJDZONE = 'Europe/Amsterdam';

/** De zin die de houder ziet als het filter het aanbod tegenhoudt. */
const DAGHAP_IN_CONTROLE_MESSAGE = 'Wordt kort gecontroleerd.';

/** De meldingen van de API: één zin per weigering, nooit een technische fout. */
// BE-67: de korte labels die een bezoeker ziet (het blok "Vandaag" en de home).
// Ze staan hier en niet in daghapFormulier, zodat de eerste lading van de
// publieke routes niet met het formulier groeit (zie commit 6818fba).
const DAGHAP_PUBLIEK = Object.freeze({
  uitverkocht: 'Op = op · uitverkocht',
  prijs2: '2 gangen',
  prijs3: '3 gangen',
});

const DAGHAP_MESSAGES = Object.freeze({
  naam: 'Gebruik een naam van 3 tot 80 tekens.',
  prijs: 'Vul een prijs tussen € 0,50 en € 150 in.',
  beschrijving: `Gebruik maximaal ${DAGHAP_BESCHRIJVING_MAX} tekens in de beschrijving.`,
  labels: 'Kies alleen vegetarisch, veganistisch of glutenvrij.',
  geenUrl: 'Een link mag niet in de tekst staan.',
  geenEmail: 'Een e-mailadres mag niet in de tekst staan.',
  geenTelefoon: 'Een telefoonnummer mag niet in de tekst staan.',
  hoofdletters: 'Schrijf de tekst niet helemaal in hoofdletters.',
  leestekens: 'Gebruik geen herhaalde leestekens zoals "!!!".',
  emoji: `Gebruik maximaal ${DAGHAP_MAX_EMOJI} emoji.`,
  soort: 'Kies een daghap, een dagmenu of een seizoensgerecht.',
  einddatum: 'Vul een einddatum binnen 90 dagen in.',
  gangen: 'Vul minstens een voorgerecht en een hoofdgerecht in, of alle drie de gangen.',
  gangNaam: `Gebruik per gang een naam van 1 tot ${DAGHAP_GANG_NAAM_MAX} tekens.`,
  prijs3: 'Vul een prijs voor drie gangen in, tussen € 0,50 en € 150.',
  geenDerdePrijs: 'Een prijs voor drie gangen hoort alleen bij een dagmenu met drie gangen.',
  herhaaldag: 'Kies minstens één weekdag voor de herhaling.',
  herhaaltot: 'Kies een einddatum voor de herhaling, binnen 90 dagen.',
  dagmenuVol: 'Er staat al een dagmenu online.',
  daghapVol: 'Er staat al een daghap online voor vandaag.',
  seizoenVol: `Er staan al ${DAGHAP_MAX_SEIZOEN} seizoensgerechten online.`,
  daglimiet: `Je kunt per dag maximaal ${DAGHAP_MAX_WIJZIGINGEN_PER_DAG} keer iets plaatsen of wijzigen.`,
  verlopen: 'Dit aanbod is verlopen en kan niet meer gewijzigd worden.',
  geenEigenaar: 'Je bent geen houder van dit restaurant.',
  geenPlaatsrecht: 'Je mag voor dit restaurant geen aanbod meer plaatsen. Neem contact op met BredaEats.',
  inloggen: 'Log in om je aanbod te beheren.',
  // BE-67: de twee standen van de Op = op-knop (uitkomst 3).
  uitverkocht: 'Dit aanbod staat vandaag op uitverkocht.',
  weerBeschikbaar: 'Dit aanbod is weer beschikbaar.',
});


/** Eén foutcode per afgewezen regel; de API geeft ze terug als `errors`. */
const DAGHAP_FOUTEN = Object.freeze({
  soort: 'soort_ongeldig',
  naamKort: 'naam_te_kort',
  naamLang: 'naam_te_lang',
  prijs: 'prijs_ongeldig',
  beschrijving: 'beschrijving_te_lang',
  labels: 'label_onbekend',
  url: 'bevat_url',
  email: 'bevat_email',
  telefoon: 'bevat_telefoon',
  hoofdletters: 'alles_in_hoofdletters',
  leestekens: 'herhaalde_leestekens',
  emoji: 'te_veel_emoji',
  einddatum: 'einddatum_ongeldig',
  gangen: 'gangen_ongeldig',
  gangNaam: 'gangnaam_ongeldig',
  prijs3: 'prijs_3_ongeldig',
  geenDerdePrijs: 'prijs_3_niet_toegestaan',
  herhaaldag: 'herhaaldag_ongeldig',
  herhaaltot: 'herhaaltot_ongeldig',
  dagmenuVol: 'dagmenu_limiet',
  daghapVol: 'daghap_limiet',
  seizoenVol: 'seizoenslimiet',
  daglimiet: 'daglimiet',
  verlopen: 'verlopen',
  geenPlaatsrecht: 'geen_plaatsrecht',
});

function tekst(value) {
  return String(value === undefined || value === null ? '' : value);
}

/** De Nederlandse zin bij een foutcode, voor het formulier en de API. */
function berichtBij(code) {
  switch (code) {
    case DAGHAP_FOUTEN.naamKort:
    case DAGHAP_FOUTEN.naamLang:
      return DAGHAP_MESSAGES.naam;
    case DAGHAP_FOUTEN.prijs:
      return DAGHAP_MESSAGES.prijs;
    case DAGHAP_FOUTEN.beschrijving:
      return DAGHAP_MESSAGES.beschrijving;
    case DAGHAP_FOUTEN.labels:
      return DAGHAP_MESSAGES.labels;
    case DAGHAP_FOUTEN.url:
      return DAGHAP_MESSAGES.geenUrl;
    case DAGHAP_FOUTEN.email:
      return DAGHAP_MESSAGES.geenEmail;
    case DAGHAP_FOUTEN.telefoon:
      return DAGHAP_MESSAGES.geenTelefoon;
    case DAGHAP_FOUTEN.hoofdletters:
      return DAGHAP_MESSAGES.hoofdletters;
    case DAGHAP_FOUTEN.leestekens:
      return DAGHAP_MESSAGES.leestekens;
    case DAGHAP_FOUTEN.emoji:
      return DAGHAP_MESSAGES.emoji;
    case DAGHAP_FOUTEN.soort:
      return DAGHAP_MESSAGES.soort;
    case DAGHAP_FOUTEN.einddatum:
      return DAGHAP_MESSAGES.einddatum;
    case DAGHAP_FOUTEN.gangen:
      return DAGHAP_MESSAGES.gangen;
    case DAGHAP_FOUTEN.gangNaam:
      return DAGHAP_MESSAGES.gangNaam;
    case DAGHAP_FOUTEN.prijs3:
      return DAGHAP_MESSAGES.prijs3;
    case DAGHAP_FOUTEN.geenDerdePrijs:
      return DAGHAP_MESSAGES.geenDerdePrijs;
    case DAGHAP_FOUTEN.herhaaldag:
      return DAGHAP_MESSAGES.herhaaldag;
    case DAGHAP_FOUTEN.herhaaltot:
      return DAGHAP_MESSAGES.herhaaltot;
    case DAGHAP_FOUTEN.dagmenuVol:
      return DAGHAP_MESSAGES.dagmenuVol;
    case DAGHAP_FOUTEN.daghapVol:
      return DAGHAP_MESSAGES.daghapVol;
    case DAGHAP_FOUTEN.seizoenVol:
      return DAGHAP_MESSAGES.seizoenVol;
    case DAGHAP_FOUTEN.daglimiet:
      return DAGHAP_MESSAGES.daglimiet;
    case DAGHAP_FOUTEN.verlopen:
      return DAGHAP_MESSAGES.verlopen;
    default:
      return '';
  }
}

/** De labels uit het contract, ontdubbeld en in de vaste volgorde. */
function normaliseerLabels(value) {
  const gekozen = Array.isArray(value) ? value : [];
  const gevraagd = new Set(gekozen.map((label) => tekst(label).trim().toLowerCase()));
  return DAGHAP_LABELS.filter((label) => gevraagd.has(label));
}

/** Staan er labels in de invoer die niet bestaan? */
function heeftOnbekendLabel(value) {
  const gekozen = Array.isArray(value) ? value : [];
  return gekozen.some((label) => !DAGHAP_LABELS.includes(tekst(label).trim().toLowerCase()));
}

module.exports = {
  DAGHAP_ACTIEVE_STATUSSEN,
  DAGHAP_PUBLIEK,
  DAGHAP_BESCHRIJVING_MAX,
  DAGHAP_FOUTEN,
  DAGHAP_GANGEN,
  DAGHAP_GANG_NAAM_MAX,
  DAGHAP_IN_CONTROLE_MESSAGE,
  DAGHAP_LABELS,
  DAGHAP_MAX_DAGEN_VOORUIT,
  DAGHAP_MAX_EMOJI,
  DAGHAP_MAX_GANGEN,
  DAGHAP_MAX_SEIZOEN,
  DAGHAP_MAX_WIJZIGINGEN_PER_DAG,
  DAGHAP_MESSAGES,
  DAGHAP_MIN_GANGEN,
  DAGHAP_SOORTEN,
  DAGHAP_STATUS_CONTROLE,
  DAGHAP_STATUS_OFFLINE,
  DAGHAP_STATUS_ONLINE,
  DAGHAP_STATUS_VERLOPEN,
  DAGHAP_TIJDZONE,
  DAGHAP_WEEKDAGEN,
  berichtBij,
  heeftOnbekendLabel,
  normaliseerLabels,
};
