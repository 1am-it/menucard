// BE-55 stap A (#135) — de regels van daghap en seizoensgerecht als pure
// helpers.
//
// Eén plek voor alles wat het contract vraagt en wat zonder database te
// controleren is, zodat de API (src/lib/daghapHandlers.js) en straks de
// schermen dezelfde regel gebruiken en niet elk een eigen kopie:
//
//   normaliseerAanbod   soort, naam (3-80), prijs (€ 0,50 - € 150, in centen),
//                       beschrijving (max. 140), de drie labels, geen URL,
//                       e-mail of telefoonnummer, niet geheel in hoofdletters,
//                       geen herhaalde leestekens ("!!!"), maximaal 3 emoji;
//   vervalmoment        het absolute verloopmoment in Europe/Amsterdam: einde
//                       van de dag op sluitingstijd als die bekend is, anders
//                       23:59; voor een seizoensgerecht het einde van de
//                       einddatum, maximaal 90 dagen vooruit;
//   beoordeelAanbod     het filter: woordenlijst plus een prijs boven 3× de
//                       duurste prijs op de kaart geeft `in_controle`, anders
//                       `online`;
//   magSoortToevoegen   maximaal 1 actieve daghap en 3 seizoensgerechten;
//   magVandaagWijzigen  maximaal 10 plaatsingen of wijzigingen per account per
//                       dag;
//   duursteKaartPrijsCent  de duurste prijs op de kaarten van dat restaurant,
//                       uit de bestaande projectdata.
//
// Deze module kent geen Supabase, geen React, geen netwerk en geen systeemklok:
// de klok komt altijd van de aanroeper. Bewust CommonJS, zoals
// kiesStemming.js, zodat `node --test` hem zonder omzetting laadt.

'use strict';

const DAGHAP_SOORTEN = Object.freeze(['daghap', 'seizoensgerecht']);
const DAGHAP_LABELS = Object.freeze(['vegetarisch', 'veganistisch', 'glutenvrij']);
const DAGHAP_ACTIEVE_STATUSSEN = Object.freeze(['online', 'in_controle']);
const DAGHAP_STATUS_ONLINE = 'online';
const DAGHAP_STATUS_CONTROLE = 'in_controle';
const DAGHAP_STATUS_OFFLINE = 'offline';
const DAGHAP_STATUS_VERLOPEN = 'verlopen';

const DAGHAP_NAAM_MIN = 3;
const DAGHAP_NAAM_MAX = 80;
const DAGHAP_PRIJS_MIN_CENT = 50;
const DAGHAP_PRIJS_MAX_CENT = 15000;
const DAGHAP_BESCHRIJVING_MAX = 140;
const DAGHAP_MAX_EMOJI = 3;
const DAGHAP_MAX_DAGHAP = 1;
const DAGHAP_MAX_SEIZOEN = 3;
const DAGHAP_MAX_WIJZIGINGEN_PER_DAG = 10;
const DAGHAP_MAX_DAGEN_VOORUIT = 90;
// Een prijs boven 3× de duurste prijs op de kaart is verdacht (contract).
const DAGHAP_PRIJS_FACTOR = 3;
const DAGHAP_TIJDZONE = 'Europe/Amsterdam';

/** De zin die de houder ziet als het filter het aanbod tegenhoudt. */
const DAGHAP_IN_CONTROLE_MESSAGE = 'Wordt kort gecontroleerd.';

/** De meldingen van de API: één zin per weigering, nooit een technische fout. */
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
  soort: 'Kies een daghap of een seizoensgerecht.',
  einddatum: 'Vul een einddatum binnen 90 dagen in.',
  daghapVol: 'Er staat al een daghap online voor vandaag.',
  seizoenVol: `Er staan al ${DAGHAP_MAX_SEIZOEN} seizoensgerechten online.`,
  daglimiet: `Je kunt per dag maximaal ${DAGHAP_MAX_WIJZIGINGEN_PER_DAG} keer iets plaatsen of wijzigen.`,
  verlopen: 'Dit aanbod is verlopen en kan niet meer gewijzigd worden.',
  geenEigenaar: 'Je bent geen houder van dit restaurant.',
  inloggen: 'Log in om je aanbod te beheren.',
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
  daghapVol: 'daghap_limiet',
  seizoenVol: 'seizoenslimiet',
  daglimiet: 'daglimiet',
  verlopen: 'verlopen',
});

function tekst(value) {
  return String(value === undefined || value === null ? '' : value);
}

/** Witruimte aan de randen weg en dubbele witruimte tot één spatie. */
function opschonen(value) {
  return tekst(value).replace(/\s+/g, ' ').trim();
}

const URL_PATROON = /(?:https?:\/\/|www\.)|\b[a-z0-9][a-z0-9-]*\.(?:nl|com|be|de|org|net|eu|io|co|info|fr|uk)\b/i;
const EMAIL_PATROON = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
// Een Nederlands telefoonnummer: begint met 0 of + en heeft daarna minstens
// acht cijfers, met optionele spaties of streepjes. Een prijs als "€ 12,50"
// haalt dat niet.
const TELEFOON_PATROON = /(?:\+\d{1,3}[\s-]?|0)(?:\d[\s-]?){8,}\d?/;
// Drie of meer dezelfde leestekens achter elkaar: "!!!", "???", "...".
const LEESTEKENS_PATROON = /([!?.,;:])\1\1+/;
// Een emoji met zijn varianteselector en eventuele ZWJ-vervolg: telt als één.
const EMOJI_PATROON = /\p{Extended_Pictographic}\uFE0F?(?:\u200D\p{Extended_Pictographic}\uFE0F?)*/gu;

/** Zegt de tekst iets dat op een link lijkt? */
function heeftUrl(value) {
  return URL_PATROON.test(tekst(value));
}

function heeftEmail(value) {
  return EMAIL_PATROON.test(tekst(value));
}

function heeftTelefoon(value) {
  return TELEFOON_PATROON.test(tekst(value));
}

/**
 * Staat de tekst geheel in hoofdletters? Alleen letters tellen: cijfers, emoji
 * en leestekens laten we weg, en er moeten minstens twee letters zijn, zodat
 * "12,50" of "🍕" geen hoofdlettertekst is.
 */
function staatInHoofdletters(value) {
  const letters = tekst(value).replace(/[^\p{L}]/gu, '');
  if (letters.length < 2) return false;
  return letters === letters.toUpperCase();
}

function heeftHerhaaldeLeestekens(value) {
  return LEESTEKENS_PATROON.test(tekst(value));
}

/** Het aantal emoji in de tekst (één per teken, ook bij een ZWJ-reeks). */
function aantalEmoji(value) {
  const gevonden = tekst(value).match(EMOJI_PATROON);
  return gevonden ? gevonden.length : 0;
}

/**
 * De drie tekstregels uit het contract, in één aanroep: `{ ok, fouten }`. De
 * aanroeper beslist zelf wat hij met de uitkomst doet (de API weigert, het
 * formulier toont dezelfde regel onder het veld).
 */
function controleerTekst(value) {
  const fouten = [];
  if (heeftUrl(value)) fouten.push(DAGHAP_FOUTEN.url);
  if (heeftEmail(value)) fouten.push(DAGHAP_FOUTEN.email);
  if (heeftTelefoon(value)) fouten.push(DAGHAP_FOUTEN.telefoon);
  if (staatInHoofdletters(value)) fouten.push(DAGHAP_FOUTEN.hoofdletters);
  if (heeftHerhaaldeLeestekens(value)) fouten.push(DAGHAP_FOUTEN.leestekens);
  if (aantalEmoji(value) > DAGHAP_MAX_EMOJI) fouten.push(DAGHAP_FOUTEN.emoji);
  return { ok: fouten.length === 0, fouten };
}

/**
 * Een prijs als centen, of `null`. Accepteert een getal in euro's (`12.5`) en
 * een tekst met een komma of punt (`"12,50"`, `"€ 12,50"`). Meer dan twee
 * decimalen is geen prijs die iemand intypt: die wordt geweigerd, niet
 * stilzwijgend afgerond.
 */
function prijsNaarCenten(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    const centen = Math.round(value * 100);
    return Math.abs(value * 100 - centen) < 0.000001 ? centen : null;
  }
  const schoon = tekst(value).replace(/[€\s]/g, '').replace(',', '.');
  if (!/^\d{1,5}(?:\.\d{1,2})?$/.test(schoon)) return null;
  const [euro, cent = ''] = schoon.split('.');
  const centen = Number(euro) * 100 + Number(cent.padEnd(2, '0'));
  return Number.isFinite(centen) ? centen : null;
}

/** De prijs als tekst voor de houder: `1250` wordt `"€ 12,50"`. */
function centenNaarPrijs(centen) {
  const waarde = Number(centen);
  if (!Number.isFinite(waarde)) return '';
  return `€ ${(waarde / 100).toFixed(2).replace('.', ',')}`;
}

const DELEN_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: DAGHAP_TIJDZONE,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Datum en tijd zoals ze in Europe/Amsterdam gelden voor dit moment. */
function delenInTijdzone(instant) {
  const moment = instant instanceof Date ? instant : new Date(Number(instant));
  const delen = {};
  for (const deel of DELEN_FORMAT.formatToParts(moment)) {
    if (deel.type !== 'literal') delen[deel.type] = deel.value;
  }
  return {
    jaar: Number(delen.year),
    maand: Number(delen.month),
    dag: Number(delen.day),
    uur: Number(delen.hour) % 24,
    minuut: Number(delen.minute),
    seconde: Number(delen.second),
  };
}

/** Het verschil in minuten tussen de zone en UTC op dit moment (zomer +120). */
function zoneOffsetMinuten(instant) {
  const { jaar, maand, dag, uur, minuut, seconde } = delenInTijdzone(instant);
  const alsUtc = Date.UTC(jaar, maand - 1, dag, uur, minuut, seconde);
  return Math.round((alsUtc - instant.getTime()) / 60000);
}

/**
 * Het absolute moment voor een wandkloktijd in Europe/Amsterdam. Twee
 * benaderingen, zodat de zomertijdovergang geen uur verschuift.
 */
function tijdzoneNaarInstant({ jaar, maand, dag, uur = 0, minuut = 0 }) {
  const gok = Date.UTC(jaar, maand - 1, dag, uur, minuut);
  const eerste = zoneOffsetMinuten(new Date(gok));
  let instant = gok - eerste * 60000;
  const tweede = zoneOffsetMinuten(new Date(instant));
  if (tweede !== eerste) instant = gok - tweede * 60000;
  return new Date(instant);
}

/** "23:59" → { uur: 23, minuut: 59 }; alles anders is null. */
function leesSluitingstijd(value) {
  const gevonden = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(tekst(value).trim());
  if (!gevonden) return null;
  return { uur: Number(gevonden[1]), minuut: Number(gevonden[2]) };
}

/** "2026-12-31" → { jaar, maand, dag }; alles anders is null. */
function leesEinddatum(value) {
  const gevonden = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tekst(value).trim());
  if (!gevonden) return null;
  const jaar = Number(gevonden[1]);
  const maand = Number(gevonden[2]);
  const dag = Number(gevonden[3]);
  const controle = new Date(Date.UTC(jaar, maand - 1, dag));
  if (controle.getUTCFullYear() !== jaar || controle.getUTCMonth() !== maand - 1 || controle.getUTCDate() !== dag) {
    return null;
  }
  return { jaar, maand, dag };
}

/** Het aantal hele dagen tussen de Amsterdamse datum van `nu` en `einddatum`. */
function dagenTotEinddatum(nu, einddatum) {
  const vandaag = delenInTijdzone(nu);
  const start = Date.UTC(vandaag.jaar, vandaag.maand - 1, vandaag.dag);
  const eind = Date.UTC(einddatum.jaar, einddatum.maand - 1, einddatum.dag);
  return Math.round((eind - start) / 86400000);
}

/**
 * Het verloopmoment van dit aanbod, als ISO-tekst:
 *   daghap           vandaag op de sluitingstijd als die bekend is, anders
 *                    23:59 Europe/Amsterdam;
 *   seizoensgerecht  het einde (23:59) van de einddatum, maximaal 90 dagen
 *                    vooruit.
 * `{ ok: true, verlooptOp }` of `{ ok: false, fout }`.
 */
function vervalmoment({ soort, nu, sluitingstijd, einddatum } = {}) {
  const moment = nu instanceof Date ? nu : new Date(Number(nu === undefined ? Date.now() : nu));
  if (Number.isNaN(moment.getTime())) return { ok: false, fout: DAGHAP_FOUTEN.einddatum };
  const vandaag = delenInTijdzone(moment);

  if (soort === 'daghap') {
    const sluiting = leesSluitingstijd(sluitingstijd);
    const verlooptOp = tijdzoneNaarInstant({
      jaar: vandaag.jaar,
      maand: vandaag.maand,
      dag: vandaag.dag,
      uur: sluiting ? sluiting.uur : 23,
      minuut: sluiting ? sluiting.minuut : 59,
    });
    return { ok: true, verlooptOp: verlooptOp.toISOString() };
  }

  if (soort !== 'seizoensgerecht') return { ok: false, fout: DAGHAP_FOUTEN.soort };

  const eind = leesEinddatum(einddatum);
  if (!eind) return { ok: false, fout: DAGHAP_FOUTEN.einddatum };
  const dagen = dagenTotEinddatum(moment, eind);
  if (dagen < 0 || dagen > DAGHAP_MAX_DAGEN_VOORUIT) {
    return { ok: false, fout: DAGHAP_FOUTEN.einddatum };
  }
  const verlooptOp = tijdzoneNaarInstant({ ...eind, uur: 23, minuut: 59 });
  return { ok: true, verlooptOp: verlooptOp.toISOString() };
}

/** Is dit aanbod op dit moment verlopen? Een aanbod zonder moment is verlopen. */
function isVerlopen(verlooptOp, nu) {
  const moment = Date.parse(tekst(verlooptOp));
  if (!Number.isFinite(moment)) return true;
  const nuMs = nu instanceof Date ? nu.getTime() : Number(nu === undefined ? Date.now() : nu);
  return !(moment > nuMs);
}

// De woordenlijst van het filter, in drie groepen zoals het contract ze noemt.
// Kleine letters, zonder accenten; `normaliseerVoorFilter` doet hetzelfde met
// de ingestuurde tekst, zodat "KóRTING" en "korting" dezelfde treffer zijn.
// Uitbreiden mag zonder de rest te raken; elke treffer houdt het aanbod tegen
// en zet het op `in_controle`, nooit stilzwijgend online.
const FILTER_SCHELDWOORDEN = Object.freeze([
  'klote', 'kut', 'lul', 'eikel', 'klootzak', 'kloothommel', 'tering', 'tyfus',
  'kolere', 'godverdomme', 'godver', 'hoer', 'slet', 'kanker', 'pleuris',
  'mongool', 'debiel', 'achterlijk', 'idioot', 'imbeciel', 'sukkel',
]);
const FILTER_DISCRIMINATIE = Object.freeze([
  'neger', 'nikker', 'roetmop', 'racist', 'nazi', 'fascist', 'discriminatie',
]);
const FILTER_RECLAME = Object.freeze([
  'korting', 'kortingen', 'gratis', 'actie', 'acties', 'aanbieding',
  'aanbiedingen', 'deal', 'deals', 'happy hour', 'voordeel', 'voordeeltje',
  'bespaar', 'besparing', 'uitverkoop', 'promotie', 'promotieprijs',
  '1+1', 'twee voor een', 'twee voor één', 'procent',
]);

/** Kleine letters, zonder accenten en met enkele spaties; alleen voor het filter. */
function normaliseerVoorFilter(value) {
  return tekst(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Staat één woord uit de lijst als los woord in de tekst? */
function bevatWoord(tekstFilter, woord) {
  const ontsnapt = woord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${ontsnapt}(?:[^\\p{L}\\p{N}]|$)`, 'u').test(tekstFilter);
}

/**
 * Waarom het filter deze tekst tegenhoudt: `['reclame:korting', ...]`. Een lege
 * lijst betekent: niets verdachts gevonden.
 */
function filterRedenen(value) {
  const filterTekst = normaliseerVoorFilter(value);
  if (!filterTekst) return [];
  const redenen = [];
  const groepen = [
    ['scheldwoord', FILTER_SCHELDWOORDEN],
    ['discriminatie', FILTER_DISCRIMINATIE],
    ['reclame', FILTER_RECLAME],
  ];
  for (const [soort, woorden] of groepen) {
    for (const woord of woorden) {
      if (bevatWoord(filterTekst, woord)) redenen.push(`${soort}:${woord}`);
    }
  }
  // "%" is geen woord: het contract noemt het los, als reclametaal.
  if (filterTekst.includes('%')) redenen.push('reclame:%');
  return redenen;
}

/**
 * Het filter van het contract: woordenlijst plus een prijs boven 3× de duurste
 * prijs op de kaart. `{ status, redenen }` met status `online` of
 * `in_controle`. Zonder kaartprijs (0 of onbekend) is er niets om aan te
 * toetsen; de prijsgrens vervalt dan en alleen de woordenlijst telt.
 */
function beoordeelAanbod({ naam, beschrijving, prijsCent, duursteKaartPrijsCent = 0 } = {}) {
  const redenen = filterRedenen([naam, beschrijving].filter(Boolean).join(' '));
  const duurste = Number(duursteKaartPrijsCent);
  const prijs = Number(prijsCent);
  if (Number.isFinite(duurste) && duurste > 0 && Number.isFinite(prijs)
      && prijs > duurste * DAGHAP_PRIJS_FACTOR) {
    redenen.push('prijs:boven_kaart');
  }
  return {
    status: redenen.length === 0 ? DAGHAP_STATUS_ONLINE : DAGHAP_STATUS_CONTROLE,
    redenen,
  };
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

/**
 * Het volledige aanbod uit één verzoek, genormaliseerd en gecontroleerd:
 * `{ ok, fouten, aanbod }`. `aanbod` is alleen gevuld als `ok` waar is:
 * `{ soort, naam, prijsCent, beschrijving, labels, verlooptOp }`.
 *
 * Platte tekst, altijd: geen HTML, geen opmaak. Wat hier door de controle komt,
 * wordt als tekst opgeslagen en als tekst weergegeven; er is geen pad waarin
 * ingevoerde tekst als HTML wordt geïnterpreteerd.
 */
function normaliseerAanbod({
  soort,
  naam,
  prijs,
  prijs_cent: prijsCentInvoer,
  beschrijving,
  labels,
  einddatum,
  sluitingstijd,
  nu,
} = {}) {
  const fouten = [];
  const gekozenSoort = tekst(soort).trim().toLowerCase();
  if (!DAGHAP_SOORTEN.includes(gekozenSoort)) fouten.push(DAGHAP_FOUTEN.soort);

  const schoneNaam = opschonen(naam);
  const naamLengte = [...schoneNaam].length;
  if (naamLengte < DAGHAP_NAAM_MIN) fouten.push(DAGHAP_FOUTEN.naamKort);
  if (naamLengte > DAGHAP_NAAM_MAX) fouten.push(DAGHAP_FOUTEN.naamLang);

  const prijsCent = prijsCentInvoer !== undefined && prijsCentInvoer !== null
    ? Number(prijsCentInvoer)
    : prijsNaarCenten(prijs);
  if (!Number.isInteger(prijsCent)
      || prijsCent < DAGHAP_PRIJS_MIN_CENT
      || prijsCent > DAGHAP_PRIJS_MAX_CENT) {
    fouten.push(DAGHAP_FOUTEN.prijs);
  }

  const schoneBeschrijving = opschonen(beschrijving);
  if ([...schoneBeschrijving].length > DAGHAP_BESCHRIJVING_MAX) {
    fouten.push(DAGHAP_FOUTEN.beschrijving);
  }

  if (heeftOnbekendLabel(labels)) fouten.push(DAGHAP_FOUTEN.labels);

  // De tekstregels gelden voor naam en beschrijving samen: wat in het ene veld
  // niet mag, mag in het andere ook niet.
  fouten.push(...controleerTekst(schoneNaam).fouten);
  fouten.push(...controleerTekst(schoneBeschrijving).fouten);

  const verloop = vervalmoment({ soort: gekozenSoort, nu, sluitingstijd, einddatum });
  if (!verloop.ok) {
    fouten.push(verloop.fout === DAGHAP_FOUTEN.soort ? DAGHAP_FOUTEN.einddatum : verloop.fout);
  }

  const uniekeFouten = [...new Set(fouten)];
  if (uniekeFouten.length > 0) return { ok: false, fouten: uniekeFouten, aanbod: null };
  return {
    ok: true,
    fouten: [],
    aanbod: {
      soort: gekozenSoort,
      naam: schoneNaam,
      prijsCent,
      beschrijving: schoneBeschrijving || null,
      labels: normaliseerLabels(labels),
      verlooptOp: verloop.verlooptOp,
    },
  };
}

/** Telt dit aanbod mee voor de limiet: actief (online of in controle) en niet verlopen. */
function isActiefAanbod(rij, nu) {
  if (!rij || typeof rij !== 'object') return false;
  if (!DAGHAP_ACTIEVE_STATUSSEN.includes(rij.status)) return false;
  return !isVerlopen(rij.verloopt_op !== undefined ? rij.verloopt_op : rij.verlooptOp, nu);
}

/** Hoeveel actieve daghappen en seizoensgerechten staan er nu? */
function telActief(bestaand, nu) {
  const rijen = Array.isArray(bestaand) ? bestaand : [];
  const actief = rijen.filter((rij) => isActiefAanbod(rij, nu));
  return {
    daghap: actief.filter((rij) => rij.soort === 'daghap').length,
    seizoensgerecht: actief.filter((rij) => rij.soort === 'seizoensgerecht').length,
    totaal: actief.length,
  };
}

/**
 * Mag dit aanbod erbij? Maximaal 1 actieve daghap en 3 seizoensgerechten per
 * restaurant. `behalveId` slaat het aanbod over dat zelf gewijzigd wordt, zodat
 * een wijziging nooit tegen zijn eigen plaats telt.
 */
function magSoortToevoegen({ bestaand, soort, behalveId, nu } = {}) {
  const rijen = (Array.isArray(bestaand) ? bestaand : [])
    .filter((rij) => !behalveId || String(rij && rij.id) !== String(behalveId));
  const telling = telActief(rijen, nu);
  if (soort === 'daghap' && telling.daghap >= DAGHAP_MAX_DAGHAP) {
    return { ok: false, fout: DAGHAP_FOUTEN.daghapVol, telling };
  }
  if (soort === 'seizoensgerecht' && telling.seizoensgerecht >= DAGHAP_MAX_SEIZOEN) {
    return { ok: false, fout: DAGHAP_FOUTEN.seizoenVol, telling };
  }
  return { ok: true, fout: null, telling };
}

/**
 * De daglimiet: maximaal 10 plaatsingen of wijzigingen per account per dag. De
 * aanroeper telt de geschiedenisregels van vandaag (Europe/Amsterdam) en geeft
 * dat aantal mee; deze regel kent geen klok en geen database.
 */
function magVandaagWijzigen({ aantalVandaag } = {}) {
  const aantal = Number(aantalVandaag);
  const gebruikt = Number.isFinite(aantal) && aantal > 0 ? aantal : 0;
  if (gebruikt >= DAGHAP_MAX_WIJZIGINGEN_PER_DAG) {
    return { ok: false, fout: DAGHAP_FOUTEN.daglimiet, aantal: gebruikt };
  }
  return { ok: true, fout: null, aantal: gebruikt };
}

/** Het begin van de Amsterdamse dag van `nu`, als ISO-tekst (voor de daglimiet). */
function begindagVan(nu) {
  const moment = nu instanceof Date ? nu : new Date(Number(nu === undefined ? Date.now() : nu));
  const vandaag = delenInTijdzone(moment);
  return tijdzoneNaarInstant({ jaar: vandaag.jaar, maand: vandaag.maand, dag: vandaag.dag }).toISOString();
}

/**
 * De duurste prijs op de kaarten van dit restaurant, in centen. Gebruikt de
 * bestaande projectdata: de kaarten die het restaurant zelf linkt, en anders de
 * kaarten die met het restaurantnummer beginnen. Zonder kaartdata is de
 * uitkomst 0 en vervalt alleen de prijsgrens van het filter.
 */
function duursteKaartPrijsCent({ restaurantId, restaurant, menus } = {}) {
  const alle = menus && typeof menus === 'object' ? menus : {};
  const id = tekst(restaurantId).trim();
  const gezien = new Set();

  const koppelingen = restaurant && Array.isArray(restaurant.menuLinks) ? restaurant.menuLinks : [];
  for (const koppeling of koppelingen) {
    const menuId = koppeling && typeof koppeling.id === 'string' ? koppeling.id : '';
    if (menuId) gezien.add(menuId);
  }
  if (id) {
    for (const menuId of Object.keys(alle)) {
      if (menuId === id || menuId.startsWith(`${id}-`)) gezien.add(menuId);
    }
  }

  let duurste = 0;
  for (const menuId of gezien) {
    const menu = alle[menuId];
    const categorieen = menu && Array.isArray(menu.categories) ? menu.categories : [];
    for (const categorie of categorieen) {
      const items = categorie && Array.isArray(categorie.items) ? categorie.items : [];
      for (const item of items) {
        const waarde = Number(item && item.priceValue);
        if (Number.isFinite(waarde) && waarde > duurste) duurste = waarde;
      }
    }
  }
  return Math.round(duurste * 100);
}

/** Het aanbod zoals de routes het teruggeven; nooit meer dan het scherm nodig heeft. */
function aanbodVoorScherm(rij) {
  if (!rij || typeof rij !== 'object') return null;
  const prijsCent = Number(rij.prijs_cent);
  return {
    id: rij.id === undefined ? null : rij.id,
    restaurantId: rij.restaurant_id || null,
    soort: rij.soort || null,
    naam: rij.naam || '',
    prijsCent: Number.isFinite(prijsCent) ? prijsCent : null,
    prijs: centenNaarPrijs(prijsCent),
    beschrijving: rij.beschrijving || '',
    labels: normaliseerLabels(rij.labels),
    status: rij.status || null,
    verlooptOp: rij.verloopt_op || null,
    inControle: rij.status === DAGHAP_STATUS_CONTROLE,
    melding: rij.status === DAGHAP_STATUS_CONTROLE ? DAGHAP_IN_CONTROLE_MESSAGE : '',
  };
}

module.exports = {
  DAGHAP_ACTIEVE_STATUSSEN,
  DAGHAP_BESCHRIJVING_MAX,
  DAGHAP_FOUTEN,
  DAGHAP_IN_CONTROLE_MESSAGE,
  DAGHAP_LABELS,
  DAGHAP_MAX_DAGEN_VOORUIT,
  DAGHAP_MAX_DAGHAP,
  DAGHAP_MAX_EMOJI,
  DAGHAP_MAX_SEIZOEN,
  DAGHAP_MAX_WIJZIGINGEN_PER_DAG,
  DAGHAP_MESSAGES,
  DAGHAP_NAAM_MAX,
  DAGHAP_NAAM_MIN,
  DAGHAP_PRIJS_FACTOR,
  DAGHAP_PRIJS_MAX_CENT,
  DAGHAP_PRIJS_MIN_CENT,
  DAGHAP_SOORTEN,
  DAGHAP_STATUS_CONTROLE,
  DAGHAP_STATUS_OFFLINE,
  DAGHAP_STATUS_ONLINE,
  DAGHAP_STATUS_VERLOPEN,
  DAGHAP_TIJDZONE,
  aanbodVoorScherm,
  aantalEmoji,
  begindagVan,
  beoordeelAanbod,
  berichtBij,
  centenNaarPrijs,
  controleerTekst,
  dagenTotEinddatum,
  delenInTijdzone,
  duursteKaartPrijsCent,
  filterRedenen,
  heeftEmail,
  heeftHerhaaldeLeestekens,
  heeftTelefoon,
  heeftUrl,
  isActiefAanbod,
  isVerlopen,
  leesEinddatum,
  leesSluitingstijd,
  magSoortToevoegen,
  magVandaagWijzigen,
  normaliseerAanbod,
  normaliseerLabels,
  normaliseerVoorFilter,
  opschonen,
  prijsNaarCenten,
  staatInHoofdletters,
  telActief,
  tijdzoneNaarInstant,
  vervalmoment,
};







