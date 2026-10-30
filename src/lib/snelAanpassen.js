'use strict';

// BE-58 deel 1 (#143) — de rekenregels van "snel aanpassen" en "menukaart
// bevestigen", zonder Supabase, zonder klok en zonder request.
//
// Alles wat het contract als regel noemt en puur te berekenen is, staat hier:
//   - de prijsgrens (€ 0,50 - € 150) en het formatteren daarvan;
//   - de markering "grote wijziging" bij meer dan 50% verschil;
//   - maximaal 30 wijzigingen per kalenderdag in Europe/Amsterdam;
//   - het label "Bevestigd door het restaurant", dat na 90 dagen vervalt;
//   - de overlay op de statische menudata: alleen prijs en beschikbaarheid van
//     het juiste gerecht veranderen, de rest blijft exact gelijk.
//
// De handlertests (src/lib/snelAanpassenHandlers.test.js) bewijzen dat de API
// deze regels ook echt toepast; deze module is de enige plek waar ze staan.
// Bewust CommonJS, net als localTime.js en daghapAanbod.js: direct testbaar met
// `node --test` en importeerbaar vanuit een 'use client'-weergave.

const PRIJS_MIN_CENT = 50;
const PRIJS_MAX_CENT = 15000;
// Meer dan de helft afwijkend van de huidige prijs: de controlelijst markeert
// het als "grote wijziging". Precies de helft telt niet als groot.
const GROTE_WIJZIGING_DREMPEL = 0.5;
const MAX_WIJZIGINGEN_PER_DAG = 30;
const BEVESTIGING_GELDIG_DAGEN = 90;
const DAG_MS = 24 * 60 * 60 * 1000;

const SOORT_PRIJS = 'prijs';
const SOORT_BESCHIKBAARHEID = 'beschikbaarheid';
const SOORTEN = [SOORT_PRIJS, SOORT_BESCHIKBAARHEID];

const STATUS_IN_CONTROLE = 'in_controle';
const STATUS_GOEDGEKEURD = 'goedgekeurd';
const STATUS_AFGEWEZEN = 'afgewezen';
const STATUSSEN = [STATUS_IN_CONTROLE, STATUS_GOEDGEKEURD, STATUS_AFGEWEZEN];

const ACTIE_INGEDIEND = 'ingediend';
const ACTIE_GOEDGEKEURD = 'goedgekeurd';
const ACTIE_AFGEWEZEN = 'afgewezen';
const ACTIE_BEVESTIGD = 'bevestigd';
const ACTIES = [ACTIE_INGEDIEND, ACTIE_GOEDGEKEURD, ACTIE_AFGEWEZEN, ACTIE_BEVESTIGD];

const TIJDELIJK_NIET_BESCHIKBAAR_LABEL = 'Tijdelijk niet beschikbaar';
const BEVESTIGING_LABEL = 'Bevestigd door het restaurant';
// De houder ziet deze regel na het indienen (contract, uitkomst 1).
const IN_CONTROLE_MESSAGE = 'We controleren een wijziging kort voordat gasten hem zien.';

const FOUTEN = {
  soort: 'soort_ongeldig',
  prijs: 'prijs_ongeldig',
  prijsGrens: 'prijs_buiten_grens',
  beschikbaarheid: 'beschikbaarheid_ongeldig',
  limiet: 'daglimiet_bereikt',
  status: 'status_ongeldig',
  reden: 'afwijs_reden_verplicht',
  bevestiging: 'bevestiging_ongeldig',
};

const BERICHTEN = {
  [FOUTEN.soort]: 'Kies een prijs of de beschikbaarheid.',
  [FOUTEN.prijs]: 'Vul een geldige prijs in.',
  [FOUTEN.prijsGrens]: 'De prijs moet tussen € 0,50 en € 150 liggen.',
  [FOUTEN.beschikbaarheid]: 'Geef aan of het gerecht beschikbaar is.',
  [FOUTEN.limiet]: `Je kunt per dag maximaal ${MAX_WIJZIGINGEN_PER_DAG} wijzigingen doorgeven.`,
  [FOUTEN.status]: 'Deze wijziging is al beoordeeld.',
  [FOUTEN.reden]: 'Geef een reden op voor het afwijzen.',
  [FOUTEN.bevestiging]: 'Deze bevestiging is niet geldig.',
};

function tekst(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

/** Een prijs uit invoer naar hele centen, of null. */
function parsePrijsCent(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    return Math.round(value * 100);
  }
  if (typeof value !== 'string') return null;
  const schoon = value.replace(/€/g, '').replace(/\s|\u00a0/g, '').replace(/,/g, '.');
  if (!/^\d+(\.\d{1,2})?$/.test(schoon)) return null;
  return Math.round(Number(schoon) * 100);
}

/** Centen naar dezelfde notatie als data/menus.json: € 72,50 en € 85. */
function formatPrijsCent(cent) {
  const bedrag = Number(cent);
  if (!Number.isFinite(bedrag) || bedrag < 0) return '';
  const euro = Math.floor(bedrag / 100);
  const rest = Math.round(bedrag % 100);
  return rest === 0 ? `€${euro}` : `€${euro},${String(rest).padStart(2, '0')}`;
}

/** Wijkt de nieuwe prijs meer dan 50% af van de huidige? */
function isGroteWijziging(huidigePrijsCent, nieuwePrijsCent) {
  const huidig = Number(huidigePrijsCent);
  const nieuw = Number(nieuwePrijsCent);
  if (!Number.isFinite(huidig) || !Number.isFinite(nieuw) || huidig <= 0) return false;
  return Math.abs(nieuw - huidig) / huidig > GROTE_WIJZIGING_DREMPEL;
}

/**
 * Controleert en normaliseert één ingediende wijziging.
 * @returns {{ok: boolean, fouten: string[], wijziging?: {soort: string,
 *   prijsCent: number|null, beschikbaar: boolean|null, groteWijziging: boolean}}}
 */
function valideerWijziging({ soort, prijs, prijsCent, beschikbaar, huidigePrijsCent } = {}) {
  const gekozen = tekst(soort);
  if (!SOORTEN.includes(gekozen)) return { ok: false, fouten: [FOUTEN.soort] };

  if (gekozen === SOORT_PRIJS) {
    const cent = prijsCent === undefined || prijsCent === null
      ? parsePrijsCent(prijs)
      : (Number.isFinite(Number(prijsCent)) ? Math.round(Number(prijsCent)) : null);
    if (cent === null) return { ok: false, fouten: [FOUTEN.prijs] };
    if (cent < PRIJS_MIN_CENT || cent > PRIJS_MAX_CENT) return { ok: false, fouten: [FOUTEN.prijsGrens] };
    return {
      ok: true,
      fouten: [],
      wijziging: {
        soort: SOORT_PRIJS,
        prijsCent: cent,
        beschikbaar: null,
        groteWijziging: isGroteWijziging(huidigePrijsCent, cent),
      },
    };
  }

  if (typeof beschikbaar !== 'boolean') return { ok: false, fouten: [FOUTEN.beschikbaarheid] };
  return {
    ok: true,
    fouten: [],
    wijziging: {
      soort: SOORT_BESCHIKBAARHEID,
      prijsCent: null,
      beschikbaar,
      groteWijziging: false,
    },
  };
}

/** Mag dit account vandaag nog een wijziging doorgeven? */
function magWijzigenVandaag(aantal, maximum = MAX_WIJZIGINGEN_PER_DAG) {
  const gedaan = Number(aantal);
  if (!Number.isFinite(gedaan) || gedaan < 0) return true;
  return gedaan < maximum;
}

/** Hoeveel wijzigingen mogen er vandaag nog bij? */
function resterendVandaag(aantal, maximum = MAX_WIJZIGINGEN_PER_DAG) {
  const gedaan = Number(aantal);
  if (!Number.isFinite(gedaan) || gedaan < 0) return maximum;
  return Math.max(0, maximum - Math.floor(gedaan));
}

/** Het begin van de kalenderdag in Europe/Amsterdam, als ISO-moment (UTC). */
function beginVanDagAmsterdam(now = Date.now()) {
  const date = new Date(now);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  const jaar = Number(parts.year);
  const maand = Number(parts.month) - 1;
  const dag = Number(parts.day);
  // Zoek de UTC-kloktijd waarbij het in Amsterdam precies middernacht is: 1 uur
  // voor (zomertijd), 2 uur voor (wintertijd) of 0 bij een afwijkende zone.
  for (const offsetHours of [1, 2, 0]) {
    const kandidaat = new Date(Date.UTC(jaar, maand, dag) - offsetHours * 3600000);
    const lokaal = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', day: '2-digit',
    }).format(kandidaat);
    if (lokaal.startsWith(String(dag).padStart(2, '0')) && lokaal.endsWith('00:00')) return kandidaat.toISOString();
  }
  return new Date(Date.UTC(jaar, maand, dag)).toISOString();
}

function parseMoment(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  const date = new Date(value === undefined || value === null ? '' : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Geldigheid van een bevestiging: 90 dagen na het moment van bevestigen.
 * @returns {{actief: boolean, bevestigdOp: string|null, verlooptOp: string|null,
 *   dagenOver: number}}
 */
function bevestigingStatus(bevestigdOp, now = Date.now()) {
  const op = parseMoment(bevestigdOp);
  const nu = parseMoment(now);
  if (!op || !nu) return { actief: false, bevestigdOp: null, verlooptOp: null, dagenOver: 0 };
  const verlooptOp = new Date(op.getTime() + BEVESTIGING_GELDIG_DAGEN * DAG_MS);
  const rest = verlooptOp.getTime() - nu.getTime();
  return {
    actief: rest > 0,
    bevestigdOp: op.toISOString(),
    verlooptOp: verlooptOp.toISOString(),
    dagenOver: rest > 0 ? Math.ceil(rest / DAG_MS) : 0,
  };
}

function isBevestigingGeldig(bevestigdOp, now = Date.now()) {
  return bevestigingStatus(bevestigdOp, now).actief;
}

/** De Nederlandse datum van een bevestiging (dd-mm-jjjj), of ''. */
function bevestigingDatum(bevestigdOp) {
  const op = parseMoment(bevestigdOp);
  if (!op) return '';
  return new Intl.DateTimeFormat('nl-NL', {
    timeZone: 'Europe/Amsterdam', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(op);
}

/** Wat de publieke pagina en Mijn restaurant van een bevestiging tonen. */
function bevestigingVoorScherm({ bevestigdOp, now = Date.now() } = {}) {
  const status = bevestigingStatus(bevestigdOp, now);
  if (!status.actief) return { actief: false, label: '', datum: '', verlooptOp: null };
  return {
    actief: true,
    label: BEVESTIGING_LABEL,
    datum: bevestigingDatum(status.bevestigdOp),
    verlooptOp: status.verlooptOp,
  };
}

/** De positie van een wijziging in de statische kaart. */
function gerechtSleutel(wijziging) {
  const categorie = Number(wijziging && wijziging.categorie_index);
  const gerecht = Number(wijziging && wijziging.gerecht_index);
  if (!Number.isInteger(categorie) || !Number.isInteger(gerecht) || categorie < 0 || gerecht < 0) return null;
  return `${categorie}:${gerecht}`;
}

/**
 * Eén goedgekeurde wijziging op één gerecht. Alleen prijs en beschikbaarheid
 * veranderen; elk ander veld blijft exact hetzelfde object.
 */
function pasWijzigingToeOpGerecht(item, wijziging) {
  if (!item || typeof item !== 'object' || !wijziging) return item;
  if (wijziging.soort === SOORT_PRIJS) {
    const cent = Number(wijziging.prijs_cent !== undefined ? wijziging.prijs_cent : wijziging.prijsCent);
    if (!Number.isFinite(cent) || cent <= 0) return item;
    return {
      ...item,
      price: formatPrijsCent(cent),
      priceValue: cent / 100,
    };
  }
  if (wijziging.soort === SOORT_BESCHIKBAARHEID) {
    const beschikbaar = wijziging.beschikbaar;
    if (beschikbaar === false) return { ...item, tijdelijkNietBeschikbaar: true };
    if (beschikbaar === true) {
      if (!item.tijdelijkNietBeschikbaar) return item;
      const kopie = { ...item };
      delete kopie.tijdelijkNietBeschikbaar;
      return kopie;
    }
  }
  return item;
}

/**
 * De goedgekeurde wijzigingen als overlay op precies deze ene kaart.
 * Laatste wijziging per gerecht wint; een wijziging buiten deze kaart of met een
 * onbekende positie wordt genegeerd. Zonder raakvlak komt hetzelfde object
 * terug, zodat een pagina niets onnodigs opnieuw rendert.
 */
function pasOverlayToe(menu, wijzigingen) {
  if (!menu || typeof menu !== 'object' || !Array.isArray(menu.categories)) return menu;
  const perGerecht = new Map();
  for (const wijziging of Array.isArray(wijzigingen) ? wijzigingen : []) {
    const key = gerechtSleutel(wijziging);
    if (key) perGerecht.set(key, wijziging);
  }
  if (perGerecht.size === 0) return menu;

  let gewijzigd = false;
  const categories = menu.categories.map((categorie, categorieIndex) => {
    if (!categorie || !Array.isArray(categorie.items)) return categorie;
    let categorieGewijzigd = false;
    const items = categorie.items.map((item, gerechtIndex) => {
      const wijziging = perGerecht.get(`${categorieIndex}:${gerechtIndex}`);
      if (!wijziging) return item;
      const nieuw = pasWijzigingToeOpGerecht(item, wijziging);
      if (nieuw !== item) categorieGewijzigd = true;
      return nieuw;
    });
    if (!categorieGewijzigd) return categorie;
    gewijzigd = true;
    return { ...categorie, items };
  });
  return gewijzigd ? { ...menu, categories } : menu;
}

/**
 * Alleen de velden die de publieke pagina nodig heeft. Geen account, geen
 * status, geen beoordelaar: de overlay is openbaar.
 */
function overlayVoorScherm(wijzigingen) {
  return (Array.isArray(wijzigingen) ? wijzigingen : [])
    .filter((wijziging) => wijziging && gerechtSleutel(wijziging))
    .map((wijziging) => {
      const cent = Number(wijziging.prijs_cent);
      return {
        menuId: tekst(wijziging.menu_id),
        categorieIndex: Number(wijziging.categorie_index),
        gerechtIndex: Number(wijziging.gerecht_index),
        gerechtNaam: tekst(wijziging.gerecht_naam),
        soort: wijziging.soort === SOORT_PRIJS ? SOORT_PRIJS : SOORT_BESCHIKBAARHEID,
        prijsCent: Number.isFinite(cent) ? cent : null,
        prijs: Number.isFinite(cent) ? formatPrijsCent(cent) : '',
        tijdelijkNietBeschikbaar: wijziging.soort === SOORT_BESCHIKBAARHEID && wijziging.beschikbaar === false,
      };
    });
}

module.exports = {
  PRIJS_MIN_CENT,
  PRIJS_MAX_CENT,
  GROTE_WIJZIGING_DREMPEL,
  MAX_WIJZIGINGEN_PER_DAG,
  BEVESTIGING_GELDIG_DAGEN,
  SOORT_PRIJS,
  SOORT_BESCHIKBAARHEID,
  SOORTEN,
  STATUS_IN_CONTROLE,
  STATUS_GOEDGEKEURD,
  STATUS_AFGEWEZEN,
  STATUSSEN,
  ACTIE_INGEDIEND,
  ACTIE_GOEDGEKEURD,
  ACTIE_AFGEWEZEN,
  ACTIE_BEVESTIGD,
  ACTIES,
  TIJDELIJK_NIET_BESCHIKBAAR_LABEL,
  BEVESTIGING_LABEL,
  IN_CONTROLE_MESSAGE,
  FOUTEN,
  BERICHTEN,
  parsePrijsCent,
  formatPrijsCent,
  isGroteWijziging,
  valideerWijziging,
  magWijzigenVandaag,
  resterendVandaag,
  beginVanDagAmsterdam,
  bevestigingStatus,
  isBevestigingGeldig,
  bevestigingDatum,
  bevestigingVoorScherm,
  gerechtSleutel,
  pasWijzigingToeOpGerecht,
  pasOverlayToe,
  overlayVoorScherm,
};
