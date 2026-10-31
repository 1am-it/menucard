'use strict';

// BE-55 stap B (#135) — het houderformulier en het blok "Vandaag" als één
// geteste beslissing.
//
// De API blijft de baas (src/lib/daghapHandlers.js): dit bestand rekent niets
// goed of af, het vertaalt alleen. Wat hier staat:
//   formulierVanAanbod   een bestaand aanbod → de waarden van het formulier;
//   aanbodVerzoek        de waarden van het formulier → de body van POST/PATCH;
//   veldenVoorFout       een foutcode van de API → het veld (of de velden) waar
//                        de melding onder hoort, zodat er niets in één
//                        verzamelblok verdwijnt;
//   foutmeldingen        het antwoord van de API → per veld de Nederlandse zin;
//   statusLabel          de stand van het aanbod in woorden, met `in_controle`
//                        als "Wordt kort gecontroleerd";
//   verloopTekst         "Online vandaag tot 21:00" of "Online tot en met
//                        31 december", uit het echte verloopmoment;
//   beschrijvingTeller   "42/140" onder het tekstveld.
//
// Geen React, geen netwerk, geen systeemklok: de tijdzone komt uit dezelfde
// helper als de server. Bewust CommonJS, zodat `node --test` dit zonder
// omzetting laadt en de client hetzelfde bestand gebruikt als de tests.

const {
  DAGHAP_BESCHRIJVING_MAX,
  DAGHAP_FOUTEN,
  DAGHAP_IN_CONTROLE_MESSAGE,
  DAGHAP_PUBLIEK,
  DAGHAP_STATUS_CONTROLE,
  DAGHAP_STATUS_OFFLINE,
  DAGHAP_STATUS_ONLINE,
  DAGHAP_STATUS_VERLOPEN,
  DAGHAP_TIJDZONE,
  berichtBij,
  normaliseerLabels,
} = require('./daghapBerichten');

const SOORT_LABELS = Object.freeze({
  daghap: 'Daghap',
  dagmenu: 'Dagmenu',
  seizoensgerecht: 'Seizoensgerecht',
});

// BE-67: de drie gangen van een dagmenu, in leesvolgorde.
const GANG_LABELS = Object.freeze({
  voor: 'Voorgerecht',
  hoofd: 'Hoofdgerecht',
  na: 'Nagerecht',
});

// BE-67, uitkomst 5: de korte namen in het blok "Vandaag" — "Voor / Hoofd / Na",
// zoals het contract ze noemt naast het formulier met de volledige namen.
const GANG_KORT = Object.freeze({
  voor: 'Voor',
  hoofd: 'Hoofd',
  na: 'Na',
});

// De weekdagknoppen van "Elke week op", in ISO-volgorde (1 = maandag).
const WEEKDAG_KORT = Object.freeze({
  1: 'ma', 2: 'di', 3: 'wo', 4: 'do', 5: 'vr', 6: 'za', 7: 'zo',
});
const WEEKDAG_LABELS = Object.freeze({
  1: 'maandag', 2: 'dinsdag', 3: 'woensdag', 4: 'donderdag',
  5: 'vrijdag', 6: 'zaterdag', 7: 'zondag',
});

const LABEL_LABELS = Object.freeze({
  vegetarisch: 'Vegetarisch',
  veganistisch: 'Veganistisch',
  glutenvrij: 'Glutenvrij',
});

const STATUS_LABELS = Object.freeze({
  [DAGHAP_STATUS_ONLINE]: 'Online',
  [DAGHAP_STATUS_CONTROLE]: 'Wordt kort gecontroleerd',
  [DAGHAP_STATUS_OFFLINE]: 'Offline',
  [DAGHAP_STATUS_VERLOPEN]: 'Verlopen',
});

// De vaste teksten van het scherm. Eén plek, zodat het formulier en "wat staat
// er online" nooit twee verschillende zinnen voor hetzelfde tonen.
const FORM_MESSAGES = Object.freeze({
  title: 'Wat staat er vandaag op?',
  intro:
    'Zet vandaag een daghap, een dagmenu of een seizoensgerecht online. Gasten zien het op je restaurantpagina, je menukaart en in de zoekresultaten.',
  soortLegend: 'Wat wil je plaatsen?',
  soortDaghapHint: 'Alleen vandaag, tot sluitingstijd.',
  soortDagmenuHint: 'Twee of drie gangen, met een eigen prijs.',
  soortSeizoenHint: 'Tot een einddatum, maximaal 90 dagen vooruit.',
  gangenLegend: 'Gangen (2 of 3)',
  gangenHint: 'Minstens twee gangen; het hoofdgerecht is verplicht.',
  gangNaHint: 'mag leeg',
  prijs2Label: 'Prijs 2 gangen',
  prijs3Label: 'Prijs 3 gangen',
  prijs3Hint: 'Alleen nodig als je drie gangen invult.',
  wanneerLegend: 'Wanneer?',
  alleenVandaag: 'Alleen vandaag',
  elkeWeek: 'Elke week op',
  weekdagLegend: 'Op welke dagen?',
  herhaalTotLabel: 'Tot en met',
  herhaalTotWijzig: 'wijzig',
  opIsOp: 'Op = op: ik kan dit zelf op "uitverkocht" zetten',
  // BE-67, uitkomst 3: de knop in het overzicht van de houder en de meldingen
  // die erbij horen. Het vinkje hierboven blijft staan als uitleg bij het
  // formulier; de stand zelf is een datum per aanbod, geen instelling.
  opIsOpKnop: 'Op = op',
  opIsOpWeer: 'Toch weer beschikbaar',
  opIsOpDone: 'Dit aanbod staat vandaag op uitverkocht.',
  opIsOpWeerDone: 'Dit aanbod is weer beschikbaar.',
  uitverkochtLabel: 'Uitverkocht',
  uitverkochtBadge: DAGHAP_PUBLIEK.uitverkocht,
  // BE-67, uitkomst 4: de drie tegels in het overzicht van de houder.
  cijfersTitel: 'Vandaag',
  cijferBekeken: 'bekeken',
  cijferBewaard: 'bewaard',
  cijferGedeeld: 'gedeeld',
  // BE-67, uitkomst 5: de twee prijschips bij een dagmenu.
  prijs2Chip: DAGHAP_PUBLIEK.prijs2,
  prijs3Chip: DAGHAP_PUBLIEK.prijs3,
  directlyVisible: "Direct zichtbaar bij 'Vandaag' en in de zoekresultaten.",
  naamLabel: 'Naam',
  naamHint: '3 tot 80 tekens.',
  prijsLabel: 'Prijs',
  prijsHint: 'Tussen € 0,50 en € 150.',
  beschrijvingLabel: 'Beschrijving',
  beschrijvingHint: `Maximaal ${DAGHAP_BESCHRIJVING_MAX} tekens. Geen links, e-mailadressen of telefoonnummers.`,
  labelsLegend: 'Labels',
  einddatumLabel: 'Tot en met',
  einddatumHint: 'Maximaal 90 dagen vooruit.',
  submit: 'Zet online',
  submitWijziging: 'Wijziging opslaan',
  cancel: 'Annuleren',
  wordtGecontroleerd: DAGHAP_IN_CONTROLE_MESSAGE,
  onlineTitel: 'Wat staat er online',
  onlineEmpty: 'Er staat nog geen daghap of seizoensgerecht online.',
  onlineLimit:
    'Maximaal 1 daghap en 3 seizoensgerechten per restaurant. Per dag kun je 10 keer plaatsen of wijzigen.',
  adjust: 'Aanpassen',
  takeOffline: 'Offline halen',
  busy: 'Bezig…',
  saved: 'Je aanbod staat online.',
  savedControle: `Je aanbod staat nog niet online. ${DAGHAP_IN_CONTROLE_MESSAGE}`,
  offlineDone: 'Je aanbod staat niet meer online.',
  loading: 'Bezig met laden…',
  genericError: 'Er ging iets mis. Probeer het opnieuw.',
  loginNeeded: 'Log opnieuw in om je aanbod te beheren.',
  noRestaurant: 'Je account is nog niet aan een goedgekeurd restaurant gekoppeld.',
  noRestaurantHelp: 'Claim je restaurant; zodra de claim is goedgekeurd kun je aanbod plaatsen.',
  restaurantLabel: 'Restaurant',
  vandaagTitle: 'Vandaag',
  vandaagSeason: 'Seizoensgerecht',
  report: 'Klopt dit aanbod niet? Meld het',
  reportConfirm: 'Bedankt, we kijken ernaar.',
  reportAlready: 'Je had dit al gemeld. We kijken ernaar.',
  reportFailed: 'Melden lukte niet. Probeer het later opnieuw.',
});

// Welke fout hoort bij welk veld? De tekstregels uit het contract gelden voor
// naam én beschrijving; die staan dus bij beide velden, niet in een los blok.
const VELDEN_VOOR_FOUT = Object.freeze({
  [DAGHAP_FOUTEN.naamKort]: ['naam'],
  [DAGHAP_FOUTEN.naamLang]: ['naam'],
  [DAGHAP_FOUTEN.prijs]: ['prijs'],
  [DAGHAP_FOUTEN.beschrijving]: ['beschrijving'],
  [DAGHAP_FOUTEN.labels]: ['labels'],
  [DAGHAP_FOUTEN.soort]: ['soort'],
  [DAGHAP_FOUTEN.einddatum]: ['einddatum'],
  [DAGHAP_FOUTEN.url]: ['naam', 'beschrijving'],
  [DAGHAP_FOUTEN.email]: ['naam', 'beschrijving'],
  [DAGHAP_FOUTEN.telefoon]: ['naam', 'beschrijving'],
  [DAGHAP_FOUTEN.hoofdletters]: ['naam', 'beschrijving'],
  [DAGHAP_FOUTEN.leestekens]: ['naam', 'beschrijving'],
  [DAGHAP_FOUTEN.emoji]: ['naam', 'beschrijving'],
  [DAGHAP_FOUTEN.daghapVol]: ['soort'],
  [DAGHAP_FOUTEN.seizoenVol]: ['soort'],
  [DAGHAP_FOUTEN.dagmenuVol]: ['soort'],
  [DAGHAP_FOUTEN.gangen]: ['gangen'],
  [DAGHAP_FOUTEN.gangNaam]: ['gangen'],
  [DAGHAP_FOUTEN.prijs3]: ['prijs3'],
  [DAGHAP_FOUTEN.geenDerdePrijs]: ['prijs3'],
  [DAGHAP_FOUTEN.herhaaldag]: ['weekdagen'],
  [DAGHAP_FOUTEN.herhaaltot]: ['herhaalTot'],
  [DAGHAP_FOUTEN.daglimiet]: [],
  [DAGHAP_FOUTEN.verlopen]: [],
});

const FORMULIER_VELDEN = Object.freeze([
  'soort', 'naam', 'prijs', 'beschrijving', 'labels', 'einddatum',
  // BE-67: het dagmenu, de herhaling en Op = op.
  'gangen', 'prijs3', 'weekdagen', 'herhaalTot', 'opIsOp',
]);

function tekst(value) {
  return String(value === undefined || value === null ? '' : value);
}

/** De velden waar een foutcode bij hoort; onbekend is `[]` (algemene melding). */
function veldenVoorFout(code) {
  const velden = VELDEN_VOOR_FOUT[tekst(code)];
  return Array.isArray(velden) ? velden.slice() : [];
}

/** Een prijs als invoer voor het formulier: `650` wordt `"6,50"`. */
function prijsInvoer(prijsCent) {
  const waarde = Number(prijsCent);
  if (!Number.isFinite(waarde)) return '';
  return (waarde / 100).toFixed(2).replace('.', ',');
}

const DATUM_DELEN = new Intl.DateTimeFormat('en-US', {
  timeZone: DAGHAP_TIJDZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** De Amsterdamse kalenderdatum van een ISO-moment als `"2026-12-31"`. */
function datumInAmsterdam(iso) {
  const moment = Date.parse(tekst(iso));
  if (!Number.isFinite(moment)) return '';
  const delen = {};
  for (const deel of DATUM_DELEN.formatToParts(new Date(moment))) {
    if (deel.type !== 'literal') delen[deel.type] = deel.value;
  }
  return `${delen.year}-${delen.month}-${delen.day}`;
}

/** Een bestaand aanbod als waarden van het formulier. */
function formulierVanAanbod(aanbod) {
  const rij = aanbod && typeof aanbod === 'object' ? aanbod : {};
  const gangen = { voor: '', hoofd: '', na: '' };
  for (const gang of Array.isArray(rij.gangen) ? rij.gangen : []) {
    if (gang && gang.gang && Object.prototype.hasOwnProperty.call(gangen, gang.gang)) {
      gangen[gang.gang] = tekst(gang.naam);
    }
  }
  const weekdagen = Array.isArray(rij.herhaalWeekdagen)
    ? rij.herhaalWeekdagen.map(Number).filter((dag) => WEEKDAG_LABELS[dag])
    : [];
  return {
    soort: tekst(rij.soort) || 'daghap',
    naam: tekst(rij.naam),
    prijs: prijsInvoer(rij.prijsCent),
    beschrijving: tekst(rij.beschrijving),
    labels: normaliseerLabels(rij.labels),
    einddatum: rij.soort === 'seizoensgerecht' ? datumInAmsterdam(rij.verlooptOp) : '',
    gangen,
    prijs3: rij.prijs3Cent === undefined || rij.prijs3Cent === null ? '' : prijsInvoer(rij.prijs3Cent),
    wanneer: weekdagen.length > 0 ? 'elke_week' : 'vandaag',
    weekdagen,
    herhaalTot: tekst(rij.herhaalTot).slice(0, 10),
    opIsOp: true,
  };
}

/** Een leeg formulier; het soort staat standaard op daghap. */
function leegFormulier({ soort = 'daghap' } = {}) {
  return {
    soort,
    naam: '',
    prijs: '',
    beschrijving: '',
    labels: [],
    einddatum: '',
    // BE-67: de gangen van een dagmenu, de herhaling en Op = op (standaard aan).
    gangen: { voor: '', hoofd: '', na: '' },
    prijs3: '',
    wanneer: 'vandaag',
    weekdagen: [],
    herhaalTot: '',
    opIsOp: true,
  };
}

/**
 * De body van een POST of PATCH uit de waarden van het formulier. De server
 * controleert alles opnieuw; dit is alleen de vorm die hij verwacht.
 *
 * Een dagmenu gaat als `gangen: [{ gang, naam }]` met alleen de ingevulde gangen;
 * de derde prijs gaat mee zodra er drie gangen zijn. Herhalen gaat als
 * `weekdagen` en `herhaalTot` bij "Elke week op", en blijft weg bij "Alleen
 * vandaag" — dan geldt het aanbod vandaag.
 */
function aanbodVerzoek(values) {
  const waarden = values && typeof values === 'object' ? values : {};
  const soort = tekst(waarden.soort).trim() || 'daghap';
  const verzoek = {
    soort,
    naam: tekst(waarden.naam).trim(),
    prijs: tekst(waarden.prijs).trim(),
    beschrijving: tekst(waarden.beschrijving).trim(),
    labels: normaliseerLabels(waarden.labels),
  };
  if (soort === 'seizoensgerecht') verzoek.einddatum = tekst(waarden.einddatum).trim();

  if (soort === 'dagmenu') {
    const velden = waarden.gangen && typeof waarden.gangen === 'object' ? waarden.gangen : {};
    const gangen = Object.keys(GANG_LABELS)
      .map((gang) => ({ gang, naam: tekst(velden[gang]).trim() }))
      .filter((gang) => gang.naam !== '');
    verzoek.gangen = gangen;
    if (gangen.length >= 3) verzoek.prijs3 = tekst(waarden.prijs3).trim();
  }

  if (tekst(waarden.wanneer).trim() === 'elke_week') {
    verzoek.weekdagen = (Array.isArray(waarden.weekdagen) ? waarden.weekdagen : [])
      .map(Number)
      .filter((dag) => WEEKDAG_LABELS[dag]);
    verzoek.herhaalTot = tekst(waarden.herhaalTot).trim();
  }
  return verzoek;
}

/**
 * Het antwoord van de API als meldingen per veld: `{ velden, algemeen }`.
 * `velden` heeft altijd de formuliervelden als sleutel (lege lijsten als er
 * niets is), zodat het formulier zonder controle kan uitpakken.
 */
function foutmeldingen(body) {
  const antwoord = body && typeof body === 'object' ? body : {};
  const velden = {};
  for (const veld of FORMULIER_VELDEN) velden[veld] = [];

  const codes = Array.isArray(antwoord.errors) ? antwoord.errors : [];
  for (const code of codes) {
    const zin = berichtBij(code);
    if (!zin) continue;
    for (const veld of veldenVoorFout(code)) {
      if (!velden[veld].includes(zin)) velden[veld].push(zin);
    }
  }

  // Eén losse melding (403, 404, 409, 429, 503) hoort bij het geheel; bij
  // validatiefouten staan de zinnen al onder de velden.
  const los = tekst(antwoord.message).trim();
  return { velden, algemeen: los && codes.length === 0 ? los : '' };
}

/** De stand van het aanbod in woorden; onbekend blijft eerlijk onbekend. */
function statusLabel(status) {
  return STATUS_LABELS[tekst(status)] || 'Onbekende status';
}

const TIJD_DELEN = new Intl.DateTimeFormat('nl-NL', {
  timeZone: DAGHAP_TIJDZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const DAG_DELEN = new Intl.DateTimeFormat('nl-NL', {
  timeZone: DAGHAP_TIJDZONE,
  day: 'numeric',
  month: 'long',
});

/**
 * "Online vandaag tot 21:00" voor een daghap en "Online tot en met 31 december"
 * voor een seizoensgerecht. Zonder bruikbaar moment is er geen belofte.
 */
function verloopTekst({ soort, verlooptOp, herhaalWeekdagen, herhaalTot } = {}) {
  const moment = Date.parse(tekst(verlooptOp));
  if (!Number.isFinite(moment)) return '';
  // BE-67: een herhaling leest als "Online elke week op ma en vr tot en met
  // 31 december", uit het echte verloopmoment (het einde van de einddatum).
  const dagen = (Array.isArray(herhaalWeekdagen) ? herhaalWeekdagen : [])
    .map(Number)
    .filter((dag) => WEEKDAG_LABELS[dag]);
  if (dagen.length > 0) {
    const namen = [...new Set(dagen)].sort((a, b) => a - b).map((dag) => WEEKDAG_KORT[dag]);
    const op = namen.length > 1
      ? `${namen.slice(0, -1).join(', ')} en ${namen[namen.length - 1]}`
      : namen[0];
    const laatsteDag = tekst(herhaalTot).slice(0, 10) ? tekst(herhaalTot).slice(0, 10) : verlooptOp;
    const eind = Date.parse(`${laatsteDag.slice(0, 10)}T12:00:00.000Z`);
    const tot = Number.isFinite(eind) ? ` tot en met ${DAG_DELEN.format(new Date(eind))}` : '';
    return `Online elke week op ${op}${tot}`;
  }
  if (soort === 'daghap' || soort === 'dagmenu') {
    return `Online vandaag tot ${TIJD_DELEN.format(new Date(moment))}`;
  }
  return `Online tot en met ${DAG_DELEN.format(new Date(moment))}`;
}

/**
 * BE-67, uitkomst 5: het korte herhaallabel bij de bezoeker, bijvoorbeeld
 * "elke di en do". Zonder weekdagen is er geen herhaling en dus geen label.
 */
function herhaalKort({ herhaalWeekdagen } = {}) {
  const dagen = (Array.isArray(herhaalWeekdagen) ? herhaalWeekdagen : [])
    .map(Number)
    .filter((dag) => WEEKDAG_LABELS[dag]);
  if (dagen.length === 0) return '';
  const namen = [...new Set(dagen)].sort((a, b) => a - b).map((dag) => WEEKDAG_KORT[dag]);
  const op = namen.length > 1
    ? `${namen.slice(0, -1).join(', ')} en ${namen[namen.length - 1]}`
    : namen[0];
  return `elke ${op}`;
}

/** De tekenteller onder het beschrijvingsveld: `"42/140"`. */
function beschrijvingTeller(value) {
  return `${[...tekst(value)].length}/${DAGHAP_BESCHRIJVING_MAX}`;
}

module.exports = {
  FORMULIER_VELDEN,
  FORM_MESSAGES,
  GANG_KORT,
  GANG_LABELS,
  LABEL_LABELS,
  SOORT_LABELS,
  STATUS_LABELS,
  WEEKDAG_KORT,
  WEEKDAG_LABELS,
  aanbodVerzoek,
  beschrijvingTeller,
  datumInAmsterdam,
  foutmeldingen,
  formulierVanAanbod,
  herhaalKort,
  leegFormulier,
  prijsInvoer,
  statusLabel,
  veldenVoorFout,
  verloopTekst,
};
