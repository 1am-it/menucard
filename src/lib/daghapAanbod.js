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

const {
  DAGHAP_ACTIEVE_STATUSSEN,
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
} = require('./daghapBerichten');

const DAGHAP_NAAM_MIN = 3;
const DAGHAP_NAAM_MAX = 80;
const DAGHAP_PRIJS_MIN_CENT = 50;
const DAGHAP_PRIJS_MAX_CENT = 15000;
const DAGHAP_MAX_DAGHAP = 1;
// Het dagmenu volgt dezelfde grens als de daghap (contract: "dezelfde controle
// als de daghap"): één actief dagmenu per restaurant.
// Het aantal vanaf welke een cijfer als getal getoond wordt; daaronder is het
// "< 5" (uitkomst 4, dezelfde regel als BE-57).
const DAGHAP_CIJFERS_MIN = 5;
const DAGHAP_MAX_DAGMENU = 1;
// Een prijs boven 3× de duurste prijs op de kaart is verdacht (contract).
const DAGHAP_PRIJS_FACTOR = 3;

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
function vervalmoment({ soort, nu, sluitingstijd, einddatum, herhaalTot } = {}) {
  const moment = nu instanceof Date ? nu : new Date(Number(nu === undefined ? Date.now() : nu));
  if (Number.isNaN(moment.getTime())) return { ok: false, fout: DAGHAP_FOUTEN.einddatum };
  const vandaag = delenInTijdzone(moment);

  // Een herhaling loopt tot en met de einddatum, voor alle drie de soorten: op
  // die laatste dag geldt de sluitingstijd van het restaurant als die bekend is,
  // anders 23:59 Europe/Amsterdam. Daarna is het aanbod verlopen.
  const herhaalEind = leesEinddatum(herhaalTot);
  if (herhaalEind) {
    const dagen = dagenTotEinddatum(moment, herhaalEind);
    if (dagen < 0 || dagen > DAGHAP_MAX_DAGEN_VOORUIT) {
      return { ok: false, fout: DAGHAP_FOUTEN.herhaaltot };
    }
    const sluiting = leesSluitingstijd(sluitingstijd);
    const verlooptOp = tijdzoneNaarInstant({
      ...herhaalEind,
      uur: sluiting ? sluiting.uur : 23,
      minuut: sluiting ? sluiting.minuut : 59,
    });
    return { ok: true, verlooptOp: verlooptOp.toISOString() };
  }

  if (soort === 'daghap' || soort === 'dagmenu') {
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

// --- BE-67 (#164): het dagmenu, de herhaling en Op = op -----------------------
//
// Dezelfde opzet als de rest van dit bestand: een pure regel, geen database,
// geen React en geen systeemklok. De klok komt altijd van de aanroeper, zodat de
// grens rond middernacht in Europe/Amsterdam te testen is.

/** Eén gang als `{ gang, naam }`; een onbekende gang of een lege naam valt weg. */
function normaliseerGang(value) {
  if (!value || typeof value !== 'object') return null;
  const gang = tekst(value.gang).trim().toLowerCase();
  if (!DAGHAP_GANGEN.includes(gang)) return null;
  const naam = opschonen(value.naam);
  if (!naam) return null;
  return { gang, naam };
}

/**
 * De gangen uit een verzoek: één per gang, in de vaste volgorde voor/hoofd/na en
 * zonder lege gangen. Het voorgerecht of het nagerecht mag ontbreken; het
 * hoofdgerecht niet — dat controleert `normaliseerAanbod`.
 */
function normaliseerGangen(value) {
  const lijst = Array.isArray(value) ? value : [];
  const perGang = new Map();
  for (const item of lijst) {
    const gang = normaliseerGang(item);
    if (gang) perGang.set(gang.gang, gang.naam);
  }
  return DAGHAP_GANGEN.filter((gang) => perGang.has(gang))
    .map((gang) => ({ gang, naam: perGang.get(gang) }));
}

/**
 * De teksten van dit aanbod waar het filter én het zoeken naar kijken: de naam,
 * de beschrijving en de namen van de gangen. Een gast zoekt op een gang, dus een
 * gangnaam met reclametaal moet hetzelfde filter halen als de naam.
 */
function aanbodFilterTekst({ naam, beschrijving, gangen } = {}) {
  const gangnamen = (Array.isArray(gangen) ? gangen : [])
    .map((item) => tekst(item && item.naam));
  return [tekst(naam), ...gangnamen, tekst(beschrijving)].filter(Boolean).join(' ');
}

/**
 * De herhaaldagen als ISO-getallen, ontdubbeld en gesorteerd; alles buiten 1-7
 * valt weg. Zo schrijft de API nooit een dubbele of ongesorteerde lijst weg.
 */
function normaliseerWeekdagen(value) {
  const gekozen = Array.isArray(value) ? value : [];
  const geldig = new Set();
  for (const dag of gekozen) {
    const nummer = Number(dag);
    if (Number.isInteger(nummer) && DAGHAP_WEEKDAGEN.includes(nummer)) geldig.add(nummer);
  }
  return DAGHAP_WEEKDAGEN.filter((dag) => geldig.has(dag));
}

/**
 * De herhaling uit een verzoek: `{ ok, fouten, herhaling }` met
 * `herhaling = { weekdagen: [1, 3], tot: '2026-12-31' }` of `null` als het
 * aanbod alleen vandaag geldt. De einddatum ligt binnen 90 dagen, dezelfde grens
 * als bij een seizoensgerecht.
 */
function normaliseerHerhaling({ weekdagen, tot, nu } = {}) {
  const gevraagd = Array.isArray(weekdagen) ? weekdagen : [];
  const dagen = normaliseerWeekdagen(gevraagd);
  const ruweTot = tekst(tot).trim();
  if (dagen.length === 0 && !ruweTot) return { ok: true, fouten: [], herhaling: null };

  const fouten = [];
  if (dagen.length === 0) fouten.push(DAGHAP_FOUTEN.herhaaldag);
  const eind = leesEinddatum(ruweTot);
  const moment = nu instanceof Date ? nu : new Date(Number(nu === undefined ? Date.now() : nu));
  if (!eind || Number.isNaN(moment.getTime())) {
    fouten.push(DAGHAP_FOUTEN.herhaaltot);
  } else {
    const dagenTot = dagenTotEinddatum(moment, eind);
    if (dagenTot < 0 || dagenTot > DAGHAP_MAX_DAGEN_VOORUIT) fouten.push(DAGHAP_FOUTEN.herhaaltot);
  }
  const uniek = [...new Set(fouten)];
  if (uniek.length > 0) return { ok: false, fouten: uniek, herhaling: null };
  const twee = (waarde) => String(waarde).padStart(2, '0');
  return {
    ok: true,
    fouten: [],
    herhaling: { weekdagen: dagen, tot: `${eind.jaar}-${twee(eind.maand)}-${twee(eind.dag)}` },
  };
}

/** De Amsterdamse kalenderdatum van dit moment als `"2026-10-31"`. */
function vandaagInAmsterdam(nu) {
  const moment = nu instanceof Date ? nu : new Date(Number(nu === undefined ? Date.now() : nu));
  if (Number.isNaN(moment.getTime())) return '';
  const { jaar, maand, dag } = delenInTijdzone(moment);
  const twee = (waarde) => String(waarde).padStart(2, '0');
  return `${jaar}-${twee(maand)}-${twee(dag)}`;
}

/** De ISO-weekdag van dit moment in Europe/Amsterdam: 1 = maandag, 7 = zondag. */
function weekdagInAmsterdam(nu) {
  const datum = vandaagInAmsterdam(nu);
  if (!datum) return 0;
  const [jaar, maand, dag] = datum.split('-').map(Number);
  const weekdag = new Date(Date.UTC(jaar, maand - 1, dag)).getUTCDay();
  return ((weekdag + 6) % 7) + 1;
}

/**
 * Is dit aanbod vandaag uitverkocht? Alleen de datum van vandaag telt: de stand
 * van gisteren is vervallen, ook bij een herhaling. Er hoeft dus niets om
 * middernacht te worden opgeruimd.
 */
function isUitverkochtVandaag(uitverkochtOp, nu) {
  const datum = tekst(uitverkochtOp).trim().slice(0, 10);
  if (!datum) return false;
  return datum === vandaagInAmsterdam(nu);
}

/**
 * Staat dit aanbod vandaag online? De ene regel die "alleen vandaag" en
 * "elke week op" afhandelt, in Europe/Amsterdam:
 *   - een verlopen moment betekent nooit online;
 *   - een herhaling geldt alleen op de gekozen weekdagen en tot en met de
 *     einddatum;
 *   - zonder herhaling geldt het aanbod vandaag (het verloopmoment is het einde
 *     van vandaag).
 * `{ online, uitverkocht, reden }`, met `reden` een korte code voor de tests en
 * voor de houder: 'verlopen', 'voorbij', 'andere_dag' of 'uitverkocht'.
 */
function staatOnlineVandaag({ verlooptOp, herhaalWeekdagen, herhaalTot, uitverkochtOp, nu } = {}) {
  if (isVerlopen(verlooptOp, nu)) return { online: false, uitverkocht: false, reden: 'verlopen' };
  const dagen = normaliseerWeekdagen(herhaalWeekdagen);
  if (dagen.length > 0) {
    const vandaag = vandaagInAmsterdam(nu);
    const tot = tekst(herhaalTot).trim().slice(0, 10);
    if (tot && vandaag && vandaag > tot) return { online: false, uitverkocht: false, reden: 'voorbij' };
    if (vandaag && !dagen.includes(weekdagInAmsterdam(nu))) {
      return { online: false, uitverkocht: false, reden: 'andere_dag' };
    }
  }
  const uitverkocht = isUitverkochtVandaag(uitverkochtOp, nu);
  return { online: true, uitverkocht, reden: uitverkocht ? 'uitverkocht' : '' };
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
  prijs3,
  prijs_3: prijs3Alias,
  prijs_3_cent: prijs3CentInvoer,
  beschrijving,
  labels,
  gangen,
  einddatum,
  sluitingstijd,
  weekdagen,
  herhaal_weekdagen: herhaalWeekdagenInvoer,
  herhaalTot,
  herhaal_tot: herhaalTotInvoer,
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

  // BE-67: het dagmenu heeft 2 of 3 gangen met een verplicht hoofdgerecht, en een
  // tweede prijs zodra er drie gangen zijn. De tekstregels gelden net zo goed
  // voor de naam van een gang: daar komt de gast immers op uit bij het zoeken.
  const gekozenGangen = normaliseerGangen(gangen);
  let prijs3Cent = null;
  if (gekozenSoort === 'dagmenu') {
    if (gekozenGangen.length < DAGHAP_MIN_GANGEN
        || gekozenGangen.length > DAGHAP_MAX_GANGEN
        || !gekozenGangen.some((gang) => gang.gang === 'hoofd')) {
      fouten.push(DAGHAP_FOUTEN.gangen);
    }
    for (const gang of gekozenGangen) {
      if ([...gang.naam].length > DAGHAP_GANG_NAAM_MAX) fouten.push(DAGHAP_FOUTEN.gangNaam);
      fouten.push(...controleerTekst(gang.naam).fouten);
    }
    const derdeInvoer = prijs3CentInvoer !== undefined && prijs3CentInvoer !== null
      ? prijs3CentInvoer
      : (prijs3 !== undefined && prijs3 !== null ? prijs3 : prijs3Alias);
    if (gekozenGangen.length === DAGHAP_MAX_GANGEN) {
      prijs3Cent = typeof derdeInvoer === 'number' && Number.isFinite(derdeInvoer)
        ? derdeInvoer
        : prijsNaarCenten(derdeInvoer);
      if (!Number.isInteger(prijs3Cent)
          || prijs3Cent < DAGHAP_PRIJS_MIN_CENT
          || prijs3Cent > DAGHAP_PRIJS_MAX_CENT) {
        fouten.push(DAGHAP_FOUTEN.prijs3);
      }
    } else if (tekst(derdeInvoer).trim() !== '') {
      // Een derde prijs zonder drie gangen is geen stille korting: het formulier
      // zegt dan wat er mis is.
      fouten.push(DAGHAP_FOUTEN.geenDerdePrijs);
    }
  } else if (gekozenGangen.length > 0) {
    // Alleen een dagmenu heeft gangen.
    fouten.push(DAGHAP_FOUTEN.gangen);
  }

  // BE-67: herhalen mag bij alle drie de soorten; zonder weekdagen en zonder
  // einddatum geldt het aanbod alleen vandaag.
  const herhaal = normaliseerHerhaling({
    weekdagen: weekdagen !== undefined ? weekdagen : herhaalWeekdagenInvoer,
    tot: herhaalTot !== undefined ? herhaalTot : herhaalTotInvoer,
    nu,
  });
  fouten.push(...herhaal.fouten);


  // De tekstregels gelden voor naam en beschrijving samen: wat in het ene veld
  // niet mag, mag in het andere ook niet.
  fouten.push(...controleerTekst(schoneNaam).fouten);
  fouten.push(...controleerTekst(schoneBeschrijving).fouten);

  const verloop = vervalmoment({
    soort: gekozenSoort,
    nu,
    sluitingstijd,
    einddatum,
    herhaalTot: herhaal.herhaling ? herhaal.herhaling.tot : '',
  });
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
      // Alleen een dagmenu draagt gangen en een tweede prijs; de andere soorten
      // houden precies de vorm van BE-55.
      ...(gekozenSoort === 'dagmenu' ? { gangen: gekozenGangen, prijs3Cent } : {}),
      ...(herhaal.herhaling ? { herhaling: herhaal.herhaling } : {}),
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
    dagmenu: actief.filter((rij) => rij.soort === 'dagmenu').length,
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
  if (soort === 'dagmenu' && telling.dagmenu >= DAGHAP_MAX_DAGMENU) {
    return { ok: false, fout: DAGHAP_FOUTEN.dagmenuVol, telling };
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
    // BE-67: deze velden bestaan pas na migratie 0026. Ontbreken ze (een oude rij
    // of een database zonder 0026), dan staat er niets extra in het antwoord en
    // blijft de vorm van BE-55 precies zoals hij was.
    ...(rij.gangen === undefined || rij.gangen === null
      ? {}
      : { gangen: normaliseerGangen(rij.gangen) }),
    ...(rij.prijs_3_cent === undefined || rij.prijs_3_cent === null
      ? {}
      : {
        prijs3Cent: Number(rij.prijs_3_cent),
        prijs3: centenNaarPrijs(rij.prijs_3_cent),
      }),
    ...(Array.isArray(rij.herhaal_weekdagen)
      ? { herhaalWeekdagen: normaliseerWeekdagen(rij.herhaal_weekdagen) }
      : {}),
    ...(rij.herhaal_tot === undefined || rij.herhaal_tot === null
      ? {}
      : { herhaalTot: rij.herhaal_tot }),
    ...(rij.uitverkocht_op === undefined || rij.uitverkocht_op === null
      ? {}
      : { uitverkochtOp: rij.uitverkocht_op }),
  };
}

/**
 * BE-67, uitkomst 4: een getal onder de 5 leest als "< 5" (dezelfde regel als
 * BE-57). Zo verraadt het overzicht niet of iets één, twee of vier keer bekeken
 * is. Negatief of onleesbaar telt als nul.
 */
function cijferTekst(value) {
  const aantal = Number(value);
  if (!Number.isFinite(aantal) || aantal < DAGHAP_CIJFERS_MIN) return '< 5';
  return String(Math.round(aantal));
}

/**
 * Het aanbod zoals een gast het ziet (stap B): alleen wat de weergave nodig
 * heeft, nooit het account, de status of de filterreden. Een gast krijgt dus
 * geen enkele interne kolom en ook geen volledige lijst van alle restaurants.
 *
 * `nu` is de klok van de aanroeper (standaard `Date.now()`), zodat de stand
 * "uitverkocht" in Europe/Amsterdam te testen is zonder de systeemklok.
 */
function publiekAanbodVoorScherm(rij, nu) {
  if (!rij || typeof rij !== 'object') return null;
  const prijsCent = Number(rij.prijs_cent);
  return {
    id: rij.id === undefined ? null : rij.id,
    soort: rij.soort || null,
    naam: rij.naam || '',
    prijsCent: Number.isFinite(prijsCent) ? prijsCent : null,
    prijs: centenNaarPrijs(prijsCent),
    beschrijving: rij.beschrijving || '',
    labels: normaliseerLabels(rij.labels),
    verlooptOp: rij.verloopt_op || null,
    // BE-67: een gast ziet het dagmenu per gang, met beide prijzen, en ziet dat
    // iets uitverkocht is. Alleen die drie velden komen erbij; niets intern.
    ...(rij.gangen === undefined || rij.gangen === null
      ? {}
      : { gangen: normaliseerGangen(rij.gangen) }),
    ...(rij.prijs_3_cent === undefined || rij.prijs_3_cent === null
      ? {}
      : { prijs3Cent: Number(rij.prijs_3_cent), prijs3: centenNaarPrijs(rij.prijs_3_cent) }),
    // BE-67: een herhaling leest bij de bezoeker als "elke di en do".
    ...(Array.isArray(rij.herhaal_weekdagen)
      ? { herhaalWeekdagen: normaliseerWeekdagen(rij.herhaal_weekdagen) }
      : {}),
    ...(isUitverkochtVandaag(rij.uitverkocht_op, nu) ? { uitverkocht: true } : {}),
  };
}

module.exports = {
  DAGHAP_ACTIEVE_STATUSSEN,
  DAGHAP_CIJFERS_MIN,
  DAGHAP_BESCHRIJVING_MAX,
  DAGHAP_FOUTEN,
  DAGHAP_GANGEN,
  DAGHAP_GANG_NAAM_MAX,
  DAGHAP_IN_CONTROLE_MESSAGE,
  DAGHAP_LABELS,
  DAGHAP_MAX_DAGEN_VOORUIT,
  DAGHAP_MAX_DAGHAP,
  DAGHAP_MAX_DAGMENU,
  DAGHAP_MAX_EMOJI,
  DAGHAP_MAX_GANGEN,
  DAGHAP_MAX_SEIZOEN,
  DAGHAP_MAX_WIJZIGINGEN_PER_DAG,
  DAGHAP_MESSAGES,
  DAGHAP_MIN_GANGEN,
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
  DAGHAP_WEEKDAGEN,
  aanbodFilterTekst,
  aanbodVoorScherm,
  aantalEmoji,
  begindagVan,
  beoordeelAanbod,
  berichtBij,
  centenNaarPrijs,
  cijferTekst,
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
  isUitverkochtVandaag,
  isVerlopen,
  leesEinddatum,
  leesSluitingstijd,
  magSoortToevoegen,
  magVandaagWijzigen,
  normaliseerAanbod,
  normaliseerGangen,
  normaliseerHerhaling,
  normaliseerLabels,
  normaliseerVoorFilter,
  normaliseerWeekdagen,
  opschonen,
  prijsNaarCenten,
  publiekAanbodVoorScherm,
  staatInHoofdletters,
  staatOnlineVandaag,
  telActief,
  tijdzoneNaarInstant,
  vandaagInAmsterdam,
  vervalmoment,
  weekdagInAmsterdam,
};







