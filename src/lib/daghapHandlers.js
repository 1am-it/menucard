// BE-55 stap A (#135) — de serverkant van daghap en seizoensgerecht.
//
// Eén plek voor de vijf verzoeken van stap A, met de afhankelijkheden als
// parameters zodat ze met een nep-client te testen zijn:
//   GET    /api/v1/daghap?restaurant_id=<id>   wat er nu van dat restaurant
//                                               online staat (en in controle);
//   POST   /api/v1/daghap                      plaatsen;
//   PATCH  /api/v1/daghap/<id>                 wijzigen;
//   DELETE /api/v1/daghap/<id>                 offline halen;
//   RPC    ruim_verlopen_daghap_op()           verlopen aanbod op 'verlopen'.
//
// Elke schrijfactie begint met dezelfde twee controles uit het contract: is de
// aanvrager ingelogd (401) en is hij houder van dít restaurant (403)? Het
// houderschap komt uit de bestaande `staff_roles`-rij met rol `owner` die een
// goedgekeurde claim automatisch geeft (0003); deze module leest die rij, hij
// kent geen tweede vorm van eigenaarschap.
//
// Daarna gelden de regels uit src/lib/daghapAanbod.js: validatie, verloop,
// filter, en de limieten (1 daghap, 3 seizoensgerechten, 10 plaatsingen of
// wijzigingen per account per dag). Elke plaatsing en wijziging schrijft een
// regel in daghap_gebeurtenissen.
//
// Ontbreekt de migratie (tabellen of functie bestaan niet), dan antwoordt elke
// route met 503 en één nette melding; de app blijft dus werken zonder 0023.
//
// Bewust CommonJS, zoals kiesHandlers.js: de tests bouwen de handlers met een
// nep-client en draaien met `node --test`, zonder Supabase.

'use strict';

const { MISSING_STORAGE_CODES, withTimeout } = require('./dishCounters');
const {
  DAGHAP_FOUTEN,
  DAGHAP_IN_CONTROLE_MESSAGE,
  DAGHAP_MESSAGES,
  DAGHAP_STATUS_CONTROLE,
  DAGHAP_STATUS_OFFLINE,
  DAGHAP_STATUS_ONLINE,
  DAGHAP_STATUS_VERLOPEN,
  aanbodVoorScherm,
  begindagVan,
  beoordeelAanbod,
  berichtBij,
  isVerlopen,
  magSoortToevoegen,
  magVandaagWijzigen,
  normaliseerAanbod,
  publiekAanbodVoorScherm,
} = require('./daghapAanbod');

// De tabellen en de functie uit supabase/migrations/0023.
const DAGHAP_TABLE_AANBOD = 'daghap_aanbod';
const DAGHAP_TABLE_MELDINGEN = 'daghap_meldingen';
const DAGHAP_TABLE_GEBEURTENISSEN = 'daghap_gebeurtenissen';
// De vierde tabel uit 0023: een rij betekent dat de interne werkvoorraad deze
// houder voor dit restaurant het plaatsrecht ontnam (stap B).
const DAGHAP_TABLE_PLAATSRECHT = 'daghap_plaatsrecht';
const DAGHAP_CLEANUP_FUNCTION = 'ruim_verlopen_daghap_op';
// Na zoveel meldingen van verschillende apparaten gaat het aanbod op
// `in_controle` (contract). Eén melding per apparaat telt.
const DAGHAP_MELDINGEN_TOT_CONTROLE = 3;
// Het apparaatkenmerk is een willekeurige waarde uit de browser van de gast,
// nooit het IP-adres; dezelfde vorm als constraint in 0023.
const DAGHAP_APPARAAT_PATROON = /^[A-Za-z0-9_-]{16,64}$/;
// Een aanbod is klein; alles groter is geen aanbod.
const DAGHAP_MAX_BODY_BYTES = 4096;
// De database is één insert of één update. Duurt hij langer, dan antwoordt de
// route met een nette fout in plaats van te blijven hangen.
const DAGHAP_TIMEOUT_MS = 4000;

const AANBOD_KOLOMMEN = 'id, restaurant_id, soort, naam, prijs_cent, beschrijving, labels, status, filter_reden, verloopt_op, created_at, updated_at';
// De publieke kant krijgt alleen deze kolommen: geen account, geen status, geen
// filterreden. Zo gaat er nooit een interne kolom naar de browser van een gast.
const PUBLIEK_KOLOMMEN = 'id, soort, naam, prijs_cent, beschrijving, labels, verloopt_op';
// Voor de home is ook het restaurant nodig, anders is er geen link bij het
// gerecht. Dat is het enige extra veld.
const HOME_KOLOMMEN = `${PUBLIEK_KOLOMMEN}, restaurant_id`;

const DAGHAP_NOT_AVAILABLE_MESSAGE = 'Daghappen zijn nog niet beschikbaar.';
// De home toont er maximaal drie, in willekeurige volgorde (contract). De query
// haalt een kleine kandidatenlijst op en nooit de hele tabel.
const DAGHAP_HOME_LIMIT = 3;
const DAGHAP_HOME_KANDIDATEN = 24;

function tekst(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

const UNAVAILABLE = {
  status: 503,
  body: { error: 'daghap_unavailable', message: DAGHAP_NOT_AVAILABLE_MESSAGE },
};
const NOT_FOUND = {
  status: 404,
  body: { error: 'daghap_not_found', message: 'Dit aanbod bestaat niet (meer).' },
};
const FORBIDDEN = {
  status: 403,
  body: { error: 'forbidden', message: DAGHAP_MESSAGES.geenEigenaar },
};
const UNAUTHORIZED = {
  status: 401,
  body: { error: 'unauthorized', message: DAGHAP_MESSAGES.inloggen },
};

function invalid(error, extra = {}) {
  return { status: 400, body: { error, ...extra } };
}

function geweigerd(fout, bericht = berichtBij(fout), status = 409) {
  return { status, body: { error: fout, message: bericht } };
}

function failed() {
  return { status: 500, body: { error: 'daghap_failed', message: 'Er ging iets mis. Probeer het opnieuw.' } };
}

/** De JSON van een verzoek, of null. Te groot, kapot of geen object: null. */
async function readBody(request) {
  if (!request || typeof request.json !== 'function') return null;
  const headers = request.headers;
  if (headers && typeof headers.get === 'function') {
    const length = Number(headers.get('content-length'));
    if (Number.isFinite(length) && length > DAGHAP_MAX_BODY_BYTES) return null;
  }
  try {
    const value = await request.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (error) {
    return null;
  }
}

/** Zegt deze fout dat de tabel of functie nog niet bestaat? */
function missingStorage(error) {
  if (!error) return false;
  if (MISSING_STORAGE_CODES.has(tekst(error.code).toUpperCase())) return true;
  return /does not exist|schema cache/i.test(tekst(error.message || error.details || error.hint));
}

/**
 * De handlers, met hun afhankelijkheden als parameters:
 *   getSupabase        de bestaande server-admin-client (service role); mag
 *                      gooien als er geen sleutel is — dat is "niet beschikbaar";
 *   authenticate       de bestaande sessiecontrole (Bearer-token → gebruiker);
 *   duursteKaartPrijs  de duurste prijs op de kaarten van een restaurant, in
 *                      centen (uit data/menus.json), voor de 3×-prijsgrens;
 *   now                de klok (verloop, daglimiet, tests);
 *   timeoutMs          bovengrens per database-aanroep.
 */
function createDaghapHandlers({
  getSupabase,
  authenticate,
  duursteKaartPrijs,
  now = Date.now,
  // Willekeurige volgorde op de home; in tests vervangbaar door een vaste reeks.
  random = Math.random,
  timeoutMs = DAGHAP_TIMEOUT_MS,
} = {}) {
  /** De admin-client, of null als hij niet geconfigureerd is. */
  function client() {
    if (typeof getSupabase !== 'function') return null;
    try {
      const supabase = getSupabase();
      return supabase && typeof supabase.from === 'function' ? supabase : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Een databasebelofte met een bovengrens. Een time-out of een netwerkfout is
   * een `{ error }` net als een fout van PostgREST, zodat elke aanroeper maar
   * één vorm hoeft te kennen.
   */
  async function ask(promise) {
    try {
      const result = await withTimeout(Promise.resolve(promise), timeoutMs);
      if (result && typeof result === 'object') return result;
      return { data: result === undefined ? null : result, error: null };
    } catch (error) {
      return { data: null, error: { message: tekst(error && error.message) || 'daghap_timeout' } };
    }
  }

  /** De aanvrager, of een kant-en-klaar 401-antwoord. */
  async function aanvrager(request) {
    if (typeof authenticate !== 'function') return { response: UNAUTHORIZED };
    let auth;
    try {
      auth = await authenticate(request);
    } catch (error) {
      return { response: UNAUTHORIZED };
    }
    if (!auth || !auth.ok || !auth.userId) {
      const status = auth && Number(auth.status);
      return { response: status && status !== 401 ? { status, body: UNAUTHORIZED.body } : UNAUTHORIZED };
    }
    return { userId: auth.userId };
  }

  /**
   * Is deze gebruiker houder van dit restaurant? Alleen de bestaande
   * `staff_roles`-rij met rol `owner` telt: die krijg je van een goedgekeurde
   * claim (0003). Geen rij betekent 403; een databasefout betekent 503 of 500.
   */
  async function controleerEigenaar(supabase, userId, restaurantId) {
    const gevonden = await ask(
      supabase
        .from('staff_roles')
        .select('id')
        .eq('user_id', userId)
        .eq('role', 'owner')
        .eq('restaurant_id', restaurantId)
        .maybeSingle(),
    );
    if (gevonden.error) return { response: missingStorage(gevonden.error) ? UNAVAILABLE : failed() };
    if (!gevonden.data) return { response: FORBIDDEN };
    return { ok: true };
  }

  /**
   * Mag deze houder nog plaatsen? De interne werkvoorraad kan hem dat recht
   * ontnemen (tabel daghap_plaatsrecht). Een rij betekent 403; geen rij, geen
   * sessie of een oudere database zonder de tabel betekent: welkom.
   */
  async function controleerPlaatsrecht(supabase, userId, restaurantId) {
    const gevonden = await ask(
      supabase
        .from(DAGHAP_TABLE_PLAATSRECHT)
        .select('user_id')
        .eq('restaurant_id', restaurantId)
        .eq('user_id', userId)
        .maybeSingle(),
    );
    if (gevonden.error) {
      if (missingStorage(gevonden.error)) return { ok: true };
      return { response: failed() };
    }
    if (gevonden.data) {
      return {
        response: {
          status: 403,
          body: {
            error: DAGHAP_FOUTEN.geenPlaatsrecht,
            message: DAGHAP_MESSAGES.geenPlaatsrecht,
          },
        },
      };
    }
    return { ok: true };
  }

  /** Het aanbod van één restaurant, zonder verlopen aanbod. */
  async function laadAanbod(supabase, restaurantId) {
    const gevonden = await ask(
      supabase
        .from(DAGHAP_TABLE_AANBOD)
        .select(AANBOD_KOLOMMEN)
        .eq('restaurant_id', restaurantId)
        .gt('verloopt_op', new Date(Number(now())).toISOString()),
    );
    if (gevonden.error) return { response: missingStorage(gevonden.error) ? UNAVAILABLE : failed() };
    return { rijen: Array.isArray(gevonden.data) ? gevonden.data : [] };
  }

  /** Hoeveel plaatste of wijzigde dit account vandaag al (Europe/Amsterdam)? */
  async function telVandaag(supabase, userId) {
    const gevonden = await ask(
      supabase
        .from(DAGHAP_TABLE_GEBEURTENISSEN)
        .select('gebeurtenis_id')
        .eq('door', userId)
        .in('actie', ['geplaatst', 'gewijzigd'])
        .gte('moment', begindagVan(now())),
    );
    if (gevonden.error) return { response: missingStorage(gevonden.error) ? UNAVAILABLE : failed() };
    return { aantal: Array.isArray(gevonden.data) ? gevonden.data.length : 0 };
  }

  /** Eén geschiedenisregel; de momentopname gaat mee, nooit overschreven. */
  async function schrijfGeschiedenis(supabase, { rij, actie, door = null, apparaat = null }) {
    const geschreven = await ask(
      supabase
        .from(DAGHAP_TABLE_GEBEURTENISSEN)
        .insert({
          aanbod_id: rij.id,
          restaurant_id: rij.restaurant_id,
          actie,
          door,
          apparaat,
          gegevens: {
            naam: rij.naam,
            prijs_cent: rij.prijs_cent,
            status: rij.status,
            verloopt_op: rij.verloopt_op,
          },
          moment: new Date(Number(now())).toISOString(),
        }),
    );
    if (geschreven.error) return { response: missingStorage(geschreven.error) ? UNAVAILABLE : failed() };
    return { ok: true };
  }

  /** De grenzen van het contract (1 daghap, 3 seizoens, 10 per dag). */
  async function controleerLimieten(supabase, { restaurantId, soort, behalveId = null, userId }) {
    const bestaand = await laadAanbod(supabase, restaurantId);
    if (bestaand.response) return bestaand;
    const limiet = magSoortToevoegen({ bestaand: bestaand.rijen, soort, behalveId, nu: now() });
    if (!limiet.ok) return { response: geweigerd(limiet.fout) };
    const vandaag = await telVandaag(supabase, userId);
    if (vandaag.response) return vandaag;
    const perDag = magVandaagWijzigen({ aantalVandaag: vandaag.aantal });
    if (!perDag.ok) return { response: geweigerd(perDag.fout, berichtBij(perDag.fout), 429) };
    return { ok: true };
  }

  /** Het filter van het contract voor dit restaurant: online of in_controle. */
  function beoordeel(aanbod) {
    const duurste = typeof duursteKaartPrijs === 'function'
      ? Number(duursteKaartPrijs(aanbod.restaurantId)) || 0
      : 0;
    return beoordeelAanbod({
      naam: aanbod.naam,
      beschrijving: aanbod.beschrijving,
      prijsCent: aanbod.prijsCent,
      duursteKaartPrijsCent: duurste,
    });
  }

  /** Het antwoord na een geslaagde schrijfactie. */
  function bewaard(rij, { status = 200, bericht = '' } = {}) {
    const aanbod = aanbodVoorScherm(rij);
    return {
      status,
      body: {
        ok: true,
        bericht,
        aanbod,
        inControle: Boolean(aanbod && aanbod.inControle),
      },
    };
  }

  /** De id uit het pad; alles wat geen positief geheel getal is bestaat niet. */
  function normaliseerId(value) {
    const id = tekst(value);
    return /^\d{1,18}$/.test(id) ? id : null;
  }

  /** De restaurant_id uit de query, anders uit de JSON. */
  function restaurantIdUit(request, body) {
    if (body) {
      const direct = tekst(body.restaurant_id !== undefined ? body.restaurant_id : body.restaurantId);
      if (direct) return direct;
    }
    const url = request && typeof request.url === 'string' ? request.url : '';
    if (!url) return '';
    try {
      return tekst(new URL(url, 'http://daghap.invalid').searchParams.get('restaurant_id'));
    } catch (error) {
      return '';
    }
  }

  /** De rij zoals hij in de database staat, uit een geschreven antwoord. */
  function rijUit(resultaat) {
    const rij = resultaat && resultaat.data;
    return rij && typeof rij === 'object' && !Array.isArray(rij) ? rij : null;
  }

  function opslaanMislukt(error) {
    if (missingStorage(error)) return UNAVAILABLE;
    // 23505 is de unieke index "één actieve daghap per restaurant" uit 0023.
    if (tekst(error && error.code) === '23505') return geweigerd(DAGHAP_FOUTEN.daghapVol);
    return failed();
  }

  /** Eén insert van een nieuw aanbod, met dezelfde foutvorm als elke aanroep. */
  function vraag(supabase, rij) {
    return ask(supabase.from(DAGHAP_TABLE_AANBOD).insert(rij).select(AANBOD_KOLOMMEN).single());
  }

  /**
   * POST /api/v1/daghap — plaatsen. Alleen een houder van dat restaurant, en
   * alleen binnen de grenzen van het contract; een filtertreffer zet het
   * aanbod op `in_controle` in plaats van online.
   */
  async function plaatsAanbod(request) {
    const supabase = client();
    if (!supabase) return UNAVAILABLE;
    const body = await readBody(request);
    if (!body) return invalid('invalid_body');

    const auth = await aanvrager(request);
    if (auth.response) return auth.response;

    const restaurantId = restaurantIdUit(request, body);
    if (!restaurantId) return invalid('restaurant_required', { message: 'Kies eerst een restaurant.' });

    const eigenaar = await controleerEigenaar(supabase, auth.userId, restaurantId);
    if (eigenaar.response) return eigenaar.response;

    const recht = await controleerPlaatsrecht(supabase, auth.userId, restaurantId);
    if (recht.response) return recht.response;

    const validatie = normaliseerAanbod({ ...body, nu: now() });
    if (!validatie.ok) {
      return invalid('invalid_aanbod', {
        errors: validatie.fouten,
        messages: validatie.fouten.map(berichtBij),
      });
    }
    const aanbod = validatie.aanbod;
    if (isVerlopen(aanbod.verlooptOp, now())) return geweigerd(DAGHAP_FOUTEN.verlopen);

    const limieten = await controleerLimieten(supabase, {
      restaurantId,
      soort: aanbod.soort,
      userId: auth.userId,
    });
    if (limieten.response) return limieten.response;

    const filter = beoordeel({ ...aanbod, restaurantId });
    const nuIso = new Date(Number(now())).toISOString();
    const nieuweRij = {
      restaurant_id: restaurantId,
      user_id: auth.userId,
      soort: aanbod.soort,
      naam: aanbod.naam,
      prijs_cent: aanbod.prijsCent,
      beschrijving: aanbod.beschrijving,
      labels: aanbod.labels,
      status: filter.status,
      filter_reden: filter.redenen.join(' ').slice(0, 80) || null,
      verloopt_op: aanbod.verlooptOp,
      updated_at: nuIso,
    };

    let geschreven = await vraag(supabase, nieuweRij);
    // 23505 is de unieke index "één actieve daghap per restaurant". Een daghap
    // van gisteren die de opruiming nog niet gezien heeft, blokkeert de nieuwe
    // dus ten onrechte: eerst opruimen, dan één keer opnieuw proberen.
    if (tekst(geschreven.error && geschreven.error.code) === '23505') {
      await ruimVerlopenOp();
      geschreven = await vraag(supabase, nieuweRij);
    }
    if (geschreven.error) return opslaanMislukt(geschreven.error);

    const rij = rijUit(geschreven);
    if (!rij) return failed();
    const geschiedenis = await schrijfGeschiedenis(supabase, { rij, actie: 'geplaatst', door: auth.userId });
    if (geschiedenis.response) {
      // Geen geschiedenis betekent geen plaatsing: elke plaatsing moet bewaard
      // blijven, dus halen we de zojuist geschreven rij weer weg. Anders staat
      // er aanbod online dat niemand kan herleiden.
      await ask(supabase.from(DAGHAP_TABLE_AANBOD).delete().eq('id', rij.id));
      return geschiedenis.response;
    }

    return bewaard(rij, {
      status: 201,
      bericht: filter.status === DAGHAP_STATUS_CONTROLE ? DAGHAP_IN_CONTROLE_MESSAGE : '',
    });
  }

  /**
   * PATCH /api/v1/daghap/<id> — wijzigen. Dezelfde controles als bij plaatsen,
   * plus: het aanbod moet bestaan (404) en nog niet verlopen zijn (409). Een
   * aanbod dat offline stond blijft offline: wijzigen publiceert niet.
   */
  async function wijzigAanbod(request, context = {}) {
    const supabase = client();
    if (!supabase) return UNAVAILABLE;
    const id = normaliseerId(context && context.id);
    if (!id) return NOT_FOUND;
    const body = await readBody(request);
    if (!body) return invalid('invalid_body');

    const auth = await aanvrager(request);
    if (auth.response) return auth.response;

    const gevonden = await ask(
      supabase.from(DAGHAP_TABLE_AANBOD).select(AANBOD_KOLOMMEN).eq('id', id).maybeSingle(),
    );
    if (gevonden.error) return missingStorage(gevonden.error) ? UNAVAILABLE : failed();
    const huidig = gevonden.data;
    if (!huidig) return NOT_FOUND;

    const eigenaar = await controleerEigenaar(supabase, auth.userId, huidig.restaurant_id);
    if (eigenaar.response) return eigenaar.response;

    const recht = await controleerPlaatsrecht(supabase, auth.userId, huidig.restaurant_id);
    if (recht.response) return recht.response;

    if (huidig.status === DAGHAP_STATUS_VERLOPEN || isVerlopen(huidig.verloopt_op, now())) {
      return geweigerd(DAGHAP_FOUTEN.verlopen);
    }

    // Het soort ligt vast: een daghap wordt geen seizoensgerecht.
    const validatie = normaliseerAanbod({ ...body, soort: huidig.soort, nu: now() });
    if (!validatie.ok) {
      return invalid('invalid_aanbod', {
        errors: validatie.fouten,
        messages: validatie.fouten.map(berichtBij),
      });
    }
    const aanbod = validatie.aanbod;

    const limieten = await controleerLimieten(supabase, {
      restaurantId: huidig.restaurant_id,
      soort: huidig.soort,
      behalveId: id,
      userId: auth.userId,
    });
    if (limieten.response) return limieten.response;

    const filter = beoordeel({ ...aanbod, restaurantId: huidig.restaurant_id });
    const blijftOffline = huidig.status === DAGHAP_STATUS_OFFLINE;
    const geschreven = await ask(
      supabase
        .from(DAGHAP_TABLE_AANBOD)
        .update({
          naam: aanbod.naam,
          prijs_cent: aanbod.prijsCent,
          beschrijving: aanbod.beschrijving,
          labels: aanbod.labels,
          status: blijftOffline ? DAGHAP_STATUS_OFFLINE : filter.status,
          filter_reden: filter.redenen.join(' ').slice(0, 80) || null,
          verloopt_op: aanbod.verlooptOp,
          updated_at: new Date(Number(now())).toISOString(),
        })
        .eq('id', id)
        .select(AANBOD_KOLOMMEN)
        .single(),
    );
    if (geschreven.error) return opslaanMislukt(geschreven.error);

    const rij = rijUit(geschreven);
    if (!rij) return failed();
    const geschiedenis = await schrijfGeschiedenis(supabase, { rij, actie: 'gewijzigd', door: auth.userId });
    if (geschiedenis.response) return geschiedenis.response;

    return bewaard(rij, {
      bericht: rij.status === DAGHAP_STATUS_CONTROLE ? DAGHAP_IN_CONTROLE_MESSAGE : '',
    });
  }

  /**
   * DELETE /api/v1/daghap/<id> — offline halen. Nog een keer offline halen is
   * geen fout: er valt dan alleen niets te wijzigen.
   */
  async function offlineAanbod(request, context = {}) {
    const supabase = client();
    if (!supabase) return UNAVAILABLE;
    const id = normaliseerId(context && context.id);
    if (!id) return NOT_FOUND;

    const auth = await aanvrager(request);
    if (auth.response) return auth.response;

    const gevonden = await ask(
      supabase.from(DAGHAP_TABLE_AANBOD).select(AANBOD_KOLOMMEN).eq('id', id).maybeSingle(),
    );
    if (gevonden.error) return missingStorage(gevonden.error) ? UNAVAILABLE : failed();
    const huidig = gevonden.data;
    if (!huidig) return NOT_FOUND;

    const eigenaar = await controleerEigenaar(supabase, auth.userId, huidig.restaurant_id);
    if (eigenaar.response) return eigenaar.response;

    if (huidig.status === DAGHAP_STATUS_OFFLINE) {
      return {
        status: 200,
        body: { ok: true, gewijzigd: false, aanbod: aanbodVoorScherm(huidig) },
      };
    }
    if (huidig.status === DAGHAP_STATUS_VERLOPEN || isVerlopen(huidig.verloopt_op, now())) {
      return geweigerd(DAGHAP_FOUTEN.verlopen);
    }

    const geschreven = await ask(
      supabase
        .from(DAGHAP_TABLE_AANBOD)
        .update({ status: DAGHAP_STATUS_OFFLINE, updated_at: new Date(Number(now())).toISOString() })
        .eq('id', id)
        .select(AANBOD_KOLOMMEN)
        .single(),
    );
    if (geschreven.error) return opslaanMislukt(geschreven.error);

    const rij = rijUit(geschreven);
    if (!rij) return failed();
    const geschiedenis = await schrijfGeschiedenis(supabase, { rij, actie: 'offline', door: auth.userId });
    if (geschiedenis.response) return geschiedenis.response;

    const antwoord = bewaard(rij, { bericht: 'Je aanbod staat niet meer online.' });
    return { status: antwoord.status, body: { ...antwoord.body, gewijzigd: true } };
  }

  /**
   * GET /api/v1/daghap?restaurant_id=<id> — wat er nu van dit restaurant
   * online staat. Verlopen aanbod komt hier nooit meer in voor, ook niet als de
   * opruimfunctie nog niet gelopen heeft.
   */
  async function lijstAanbod(request) {
    const supabase = client();
    if (!supabase) return UNAVAILABLE;

    const auth = await aanvrager(request);
    if (auth.response) return auth.response;

    const restaurantId = restaurantIdUit(request, null);
    if (!restaurantId) return invalid('restaurant_required', { message: 'Kies eerst een restaurant.' });

    const eigenaar = await controleerEigenaar(supabase, auth.userId, restaurantId);
    if (eigenaar.response) return eigenaar.response;

    const gevonden = await ask(
      supabase
        .from(DAGHAP_TABLE_AANBOD)
        .select(AANBOD_KOLOMMEN)
        .eq('restaurant_id', restaurantId)
        .in('status', [DAGHAP_STATUS_ONLINE, DAGHAP_STATUS_CONTROLE, DAGHAP_STATUS_OFFLINE])
        .gt('verloopt_op', new Date(Number(now())).toISOString())
        .order('verloopt_op', { ascending: true }),
    );
    if (gevonden.error) return missingStorage(gevonden.error) ? UNAVAILABLE : failed();

    const rijen = Array.isArray(gevonden.data) ? gevonden.data : [];
    return {
      status: 200,
      body: {
        ok: true,
        aanbod: rijen.map((rij) => aanbodVoorScherm(rij)).filter(Boolean),
        daghap: rijen.filter((rij) => rij.soort === 'daghap').length,
        seizoensgerechten: rijen.filter((rij) => rij.soort === 'seizoensgerecht').length,
      },
    };
  }

  /**
   * Het opruimen: verlopen aanbod op 'verlopen', met één geschiedenisregel per
   * aanbod (functie ruim_verlopen_daghap_op uit 0023). De cronroute roept dit
   * aan met het service-role-token, net als bij de kies-opruiming.
   */
  async function ruimVerlopenOp() {
    const supabase = client();
    if (!supabase) return { status: 503, body: { ok: false } };
    if (typeof supabase.rpc !== 'function') return { status: 503, body: { ok: false } };
    const resultaat = await ask(supabase.rpc(DAGHAP_CLEANUP_FUNCTION));
    if (resultaat.error) {
      return missingStorage(resultaat.error)
        ? { status: 503, body: { ok: false } }
        : { status: 500, body: { ok: false } };
    }
    const aantal = Number(resultaat.data);
    return { status: 200, body: { ok: true, verlopen: Number.isFinite(aantal) ? aantal : 0 } };
  }

  /**
   * GET /api/v1/daghap/publiek?restaurant_id=<id> — wat een gast van dít ene
   * restaurant nu mag zien: alleen `online` aanbod dat nog niet verlopen is, en
   * alleen de velden voor de weergave. Geen sessie nodig, geen lijst van meer
   * dan één restaurant, niets cachebaar lang.
   */
  async function publiekAanbod(request) {
    const supabase = client();
    if (!supabase) return UNAVAILABLE;

    const restaurantId = restaurantIdUit(request, null);
    if (!restaurantId) return invalid('restaurant_required', { message: 'Kies eerst een restaurant.' });

    const gevonden = await ask(
      supabase
        .from(DAGHAP_TABLE_AANBOD)
        .select(PUBLIEK_KOLOMMEN)
        .eq('restaurant_id', restaurantId)
        .eq('status', DAGHAP_STATUS_ONLINE)
        .gt('verloopt_op', new Date(Number(now())).toISOString())
        .order('verloopt_op', { ascending: true }),
    );
    if (gevonden.error) return missingStorage(gevonden.error) ? UNAVAILABLE : failed();

    const rijen = Array.isArray(gevonden.data) ? gevonden.data : [];
    // De query filtert al op verloop; deze regel houdt de belofte ook als de
    // databank en de klok van de server even uit elkaar lopen.
    const aanbod = rijen
      .filter((rij) => !isVerlopen(rij.verloopt_op, now()))
      .map((rij) => publiekAanbodVoorScherm(rij))
      .filter(Boolean);

    return { status: 200, body: { ok: true, aanbod } };
  }

  /**
   * GET /api/v1/daghap/vandaag — "Daghappen vandaag" op de home: maximaal drie
   * aanbiedingen in willekeurige volgorde, elk met alleen de weergavevelden en
   * het restaurant voor de link. Geen sessie nodig, geen volledige lijst: de
   * query haalt een kleine kandidatenlijst op en de server kiest daaruit.
   */
  async function publiekVandaag(request) {
    const supabase = client();
    if (!supabase) return UNAVAILABLE;

    let gevraagd = DAGHAP_HOME_LIMIT;
    try {
      const url = request && typeof request.url === 'string' ? new URL(request.url, 'http://daghap.invalid') : null;
      const waarde = url ? Number(url.searchParams.get('limit')) : NaN;
      if (Number.isInteger(waarde) && waarde > 0) gevraagd = Math.min(waarde, DAGHAP_HOME_LIMIT);
    } catch (error) {
      gevraagd = DAGHAP_HOME_LIMIT;
    }

    const gevonden = await ask(
      supabase
        .from(DAGHAP_TABLE_AANBOD)
        .select(HOME_KOLOMMEN)
        .eq('status', DAGHAP_STATUS_ONLINE)
        .gt('verloopt_op', new Date(Number(now())).toISOString())
        .order('verloopt_op', { ascending: true })
        .limit(DAGHAP_HOME_KANDIDATEN),
    );
    if (gevonden.error) return missingStorage(gevonden.error) ? UNAVAILABLE : failed();

    const rijen = (Array.isArray(gevonden.data) ? gevonden.data : [])
      .filter((rij) => !isVerlopen(rij.verloopt_op, now()));
    // Willekeurige volgorde (contract): elke kandidaat even vaak, zonder
    // voorrang voor een restaurant of een soort.
    const geschud = rijen
      .map((rij) => ({ rij, sorteersleutel: Number(random()) || 0 }))
      .sort((a, b) => a.sorteersleutel - b.sorteersleutel)
      .map(({ rij }) => rij);

    const aanbod = geschud
      .slice(0, gevraagd)
      .map((rij) => {
        const scherm = publiekAanbodVoorScherm(rij);
        if (!scherm) return null;
        return { ...scherm, restaurantId: rij.restaurant_id || null };
      })
      .filter(Boolean);

    return { status: 200, body: { ok: true, aanbod } };
  }

  /** Hoeveel meldingen dit aanbod heeft (elk apparaat telt één keer). */
  async function telMeldingen(supabase, aanbodId) {
    const gevonden = await ask(
      supabase.from(DAGHAP_TABLE_MELDINGEN).select('melding_id').eq('aanbod_id', aanbodId),
    );
    if (gevonden.error) return { response: missingStorage(gevonden.error) ? UNAVAILABLE : failed() };
    return { aantal: Array.isArray(gevonden.data) ? gevonden.data.length : 0 };
  }

  /**
   * POST /api/v1/daghap/<id>/meld — een gast meldt een aanbod, zonder account.
   * Opgeslagen wordt alleen het aanbod en een willekeurig browserkenmerk; geen
   * IP-adres, geen user agent, geen account. Per apparaat telt de melding één
   * keer (de unieke constraint in 0023), en na drie meldingen gaat het aanbod
   * automatisch op `in_controle`.
   */
  async function meldAanbod(request, context = {}) {
    const supabase = client();
    if (!supabase) return UNAVAILABLE;
    const id = normaliseerId(context && context.id);
    if (!id) return NOT_FOUND;

    const body = await readBody(request);
    const apparaat = tekst(body && body.apparaat);
    if (!body || !DAGHAP_APPARAAT_PATROON.test(apparaat)) {
      return invalid('invalid_apparaat', { message: 'Meld het aanbod opnieuw vanaf deze pagina.' });
    }

    const gevonden = await ask(
      supabase.from(DAGHAP_TABLE_AANBOD).select(AANBOD_KOLOMMEN).eq('id', id).maybeSingle(),
    );
    if (gevonden.error) return missingStorage(gevonden.error) ? UNAVAILABLE : failed();
    const aanbod = gevonden.data;
    if (!aanbod) return NOT_FOUND;

    if (aanbod.status === DAGHAP_STATUS_OFFLINE
        || aanbod.status === DAGHAP_STATUS_VERLOPEN
        || isVerlopen(aanbod.verloopt_op, now())) {
      return {
        status: 409,
        body: { error: 'daghap_not_online', message: 'Dit aanbod staat niet meer online.' },
      };
    }

    // Al in controle: de melding telt niet meer mee, maar de gast krijgt geen
    // fout — zijn melding is ontvangen en er wordt al gekeken.
    if (aanbod.status === DAGHAP_STATUS_CONTROLE) {
      const telling = await telMeldingen(supabase, id);
      if (telling.response) return telling.response;
      return {
        status: 200,
        body: {
          ok: true,
          gemeld: true,
          alGemeld: false,
          aantal: telling.aantal,
          inControle: true,
          message: 'Dit aanbod wordt al gecontroleerd. Bedankt voor je melding.',
        },
      };
    }

    const geschreven = await ask(
      supabase.from(DAGHAP_TABLE_MELDINGEN).insert({ aanbod_id: id, apparaat }).select('melding_id'),
    );
    let alGemeld = false;
    if (geschreven.error) {
      if (missingStorage(geschreven.error)) return UNAVAILABLE;
      // 23505 is de unieke constraint per (aanbod, apparaat): dit apparaat
      // meldde dit aanbod al. Dat is geen fout, en het telt niet opnieuw.
      if (tekst(geschreven.error.code) !== '23505') return failed();
      alGemeld = true;
    }

    const telling = await telMeldingen(supabase, id);
    if (telling.response) return telling.response;
    const aantal = telling.aantal;

    if (!alGemeld) {
      const geschiedenis = await schrijfGeschiedenis(supabase, {
        rij: aanbod,
        actie: 'gemeld',
        apparaat,
      });
      if (geschiedenis.response) return geschiedenis.response;
    }

    let inControle = false;
    if (aantal >= DAGHAP_MELDINGEN_TOT_CONTROLE) {
      const bijgewerkt = await ask(
        supabase
          .from(DAGHAP_TABLE_AANBOD)
          .update({
            status: DAGHAP_STATUS_CONTROLE,
            filter_reden: 'meldingen',
            updated_at: new Date(Number(now())).toISOString(),
          })
          .eq('id', id)
          .select(AANBOD_KOLOMMEN)
          .single(),
      );
      if (bijgewerkt.error) return missingStorage(bijgewerkt.error) ? UNAVAILABLE : failed();
      const rij = rijUit(bijgewerkt);
      if (!rij) return failed();
      inControle = true;
      const geschiedenis = await schrijfGeschiedenis(supabase, { rij, actie: 'in_controle' });
      if (geschiedenis.response) return geschiedenis.response;
    }

    return {
      status: 200,
      body: {
        ok: true,
        gemeld: !alGemeld,
        alGemeld,
        aantal,
        inControle,
        message: alGemeld ? 'Je had dit al gemeld. We kijken ernaar.' : 'Bedankt, we kijken ernaar.',
      },
    };
  }

  return {
    lijstAanbod,
    meldAanbod,
    offlineAanbod,
    plaatsAanbod,
    publiekAanbod,
    publiekVandaag,
    ruimVerlopenOp,
    wijzigAanbod,
  };
}

module.exports = {
  DAGHAP_APPARAAT_PATROON,
  DAGHAP_CLEANUP_FUNCTION,
  DAGHAP_MAX_BODY_BYTES,
  DAGHAP_MELDINGEN_TOT_CONTROLE,
  DAGHAP_NOT_AVAILABLE_MESSAGE,
  DAGHAP_TABLE_AANBOD,
  DAGHAP_TABLE_GEBEURTENISSEN,
  DAGHAP_TABLE_MELDINGEN,
  DAGHAP_TABLE_PLAATSRECHT,
  PUBLIEK_KOLOMMEN,
  createDaghapHandlers,
};





