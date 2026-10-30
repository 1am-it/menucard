'use strict';

// BE-58 deel 1 (#143) — de serverkant van "snel aanpassen" en "menukaart
// bevestigen".
//
// Deze module kent geen Supabase en geen omgeving: de client, de twee
// auth-functies, de menukaarten en de klok komen van buiten, zodat de tests met
// een nep-client precies kunnen zien wat er gevraagd en geschreven wordt.
//
// Routes die hierop aansluiten:
//   POST /api/v1/menukaart/wijzigingen                 wijziging indienen (houder)
//   GET  /api/v1/menukaart/wijzigingen                 eigen lijst (houder)
//   POST /api/v1/menukaart/bevestigen                  menukaart bevestigen (houder)
//   GET  /api/v1/menukaart/overlay?restaurant=<id>     publieke overlay + label
//   GET  /api/internal/v1/menukaart-wijzigingen        controlelijst (intern)
//   POST /api/internal/v1/menukaart-wijzigingen/<id>/goedkeuren
//   POST /api/internal/v1/menukaart-wijzigingen/<id>/afwijzen
//
// Volgorde is de veiligheidsvolgorde: eerst de migratie (anders 503), dan de
// sessie (401), dan eigenaarschap en plaatsrecht (403), dan pas de invoer (400)
// en de schrijfactie. De interne routes gaan door `authenticateInternalRequest`
// en eisen de rol `internal`; een `owner` of `editor` krijgt 403.
//
// De houder is `staff_roles` met rol `owner` voor precies dit restaurant (die rij
// krijg je van een goedgekeurde claim, 0003). Het plaatsrecht komt uit
// `daghap_plaatsrecht` (BE-55, migratie 0023). Die tabel staat niet op deze
// branch: ontbreekt hij, dan geldt het recht als niet ingetrokken en blijft de
// route werken zodra 0023 en 0025 beide zijn toegepast.
//
// Ontbreekt 0025, dan antwoordt elke route 503 met één nette melding; de app
// blijft dus werken zonder de migratie. Bewust CommonJS, zoals
// dishCounterReportHandlers.js: direct testbaar met `node --test`.

const {
  BEVESTIGING_GELDIG_DAGEN,
  BERICHTEN,
  FOUTEN,
  IN_CONTROLE_MESSAGE,
  MAX_WIJZIGINGEN_PER_DAG,
  STATUS_AFGEWEZEN,
  STATUS_GOEDGEKEURD,
  STATUS_IN_CONTROLE,
  ACTIE_AFGEWEZEN,
  ACTIE_BEVESTIGD,
  ACTIE_GOEDGEKEURD,
  ACTIE_INGEDIEND,
  bevestigingVoorScherm,
  beginVanDagAmsterdam,
  formatPrijsCent,
  magWijzigenVandaag,
  menuGerechtenVoorScherm,
  overlayVoorScherm,
  parsePrijsCent,
  resterendVandaag,
  valideerWijziging,
} = require('./snelAanpassen');

const TABLE_WIJZIGINGEN = 'menukaart_wijzigingen';
const TABLE_BEVESTIGINGEN = 'menukaart_bevestigingen';
const TABLE_GEBEURTENISSEN = 'menukaart_gebeurtenissen';
// BE-55 (0023): een rij betekent dat de interne werkvoorraad deze houder het
// plaatsrecht ontnam. De tabel bestaat nog niet op deze branch; dat vangt
// `controleerPlaatsrecht` op.
const TABLE_PLAATSRECHT = 'daghap_plaatsrecht';
const BEHEER_ROL = 'internal';

const MAX_BODY_BYTES = 4096;
const TIMEOUT_MS = 4000;
const EIGEN_LIMIT = 50;
const BEHEER_LIMIT = 100;
const OVERLAY_LIMIT = 200;
const REDEN_MAX = 280;

// Nooit `*`: de houder ziet zijn eigen rij, de publieke route alleen wat de
// weergave nodig heeft.
const WIJZIGING_KOLOMMEN = 'wijziging_id, restaurant_id, menu_id, categorie_index, gerecht_index, '
  + 'gerecht_naam, user_id, soort, oude_prijs_cent, prijs_cent, beschikbaar, status, '
  + 'grote_wijziging, afwijs_reden, beoordeeld_door, beoordeeld_op, created_at';
const PUBLIEK_KOLOMMEN = 'menu_id, categorie_index, gerecht_index, gerecht_naam, soort, '
  + 'prijs_cent, beschikbaar, beoordeeld_op';

const UNAVAILABLE = {
  status: 503,
  body: { error: 'menukaart_unavailable', message: 'Snel aanpassen is nog niet beschikbaar.' },
};
const UNAUTHORIZED = {
  status: 401,
  body: { error: 'unauthorized', message: 'Log in om je menukaart aan te passen.' },
};
const GEEN_EIGENAAR = {
  status: 403,
  body: { error: 'forbidden', message: 'Alleen de houder van dit restaurant kan de menukaart aanpassen.' },
};
const GEEN_PLAATSRECHT = {
  status: 403,
  body: { error: 'geen_plaatsrecht', message: 'Je mag de menukaart van dit restaurant niet aanpassen.' },
};
const GEEN_BEHEER = {
  status: 403,
  body: { error: 'forbidden', message: 'Alleen intern beheer kan wijzigingen beoordelen.' },
};
const NIET_GEVONDEN = {
  status: 404,
  body: { error: 'wijziging_niet_gevonden', message: 'Deze wijziging bestaat niet (meer).' },
};

function tekst(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function invalid(error, message, extra = {}) {
  return { status: 400, body: { error, message, ...extra } };
}

function failed() {
  return { status: 500, body: { error: 'menukaart_failed', message: 'Er ging iets mis. Probeer het opnieuw.' } };
}

/** JSON van een verzoek, of null. Te groot, kapot of geen object: null. */
async function readBody(request) {
  if (!request || typeof request.json !== 'function') return null;
  const headers = request.headers;
  if (headers && typeof headers.get === 'function') {
    const length = Number(headers.get('content-length'));
    if (Number.isFinite(length) && length > MAX_BODY_BYTES) return null;
  }
  try {
    const value = await request.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (error) {
    return null;
  }
}

function queryVan(request) {
  try {
    return new URL(request && request.url).searchParams;
  } catch (error) {
    return null;
  }
}

/** Ontbreekt de migratie of de tabel? Dan is het geen crash maar een 503. */
function missingStorage(error) {
  if (!error) return false;
  const code = tekst(error.code).toUpperCase();
  if (['42P01', 'PGRST205', 'PGRST204'].includes(code)) return true;
  const bericht = tekst(error.message || error.details || error.hint);
  return /does not exist|could not find the table|schema cache|undefined table/i.test(bericht);
}

/**
 * De handler. Afhankelijkheden:
 *   getSupabase          de bestaande server-admin-client (mag gooien zonder sleutel);
 *   authenticate         de bestaande houder-sessiecontrole (authenticateAnyUser);
 *   authenticateInternal de bestaande interne controle (authenticateInternalRequest);
 *   menus                data/menus.json, voor de statische kaart en de huidige prijs;
 *   now                  de klok (tests);
 *   timeoutMs            bovengrens per databasebelofte.
 */
function createSnelAanpassenHandlers({
  getSupabase,
  authenticate,
  authenticateInternal,
  menus = {},
  now = Date.now,
  timeoutMs = TIMEOUT_MS,
} = {}) {
  function client() {
    if (typeof getSupabase !== 'function') return null;
    try {
      const supabase = getSupabase();
      return supabase && typeof supabase.from === 'function' ? supabase : null;
    } catch (error) {
      return null;
    }
  }

  /** Een databasebelofte met een bovengrens; een fout is altijd `{ error }`. */
  async function ask(promise) {
    let timer;
    try {
      const result = await Promise.race([
        Promise.resolve(promise),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve({ data: null, error: { message: 'menukaart_timeout' } }), timeoutMs);
        }),
      ]);
      if (result && typeof result === 'object') return result;
      return { data: result === undefined ? null : result, error: null };
    } catch (error) {
      return { data: null, error: { message: tekst(error && error.message) || 'menukaart_failed' } };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function opslagFout(error) {
    return missingStorage(error) ? UNAVAILABLE : failed();
  }

  /** De sessie van de aanvrager, of een kant-en-klaar antwoord. */
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
      if (status === 403) {
        return {
          response: {
            status: 403,
            body: { error: 'forbidden', message: tekst(auth.error) || GEEN_EIGENAAR.body.message },
          },
        };
      }
      return { response: UNAUTHORIZED };
    }
    return { userId: auth.userId };
  }

  /** `staff_roles` owner voor precies dit restaurant? */
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
    if (gevonden.error) return { response: opslagFout(gevonden.error) };
    if (!gevonden.data) return { response: GEEN_EIGENAAR };
    return { ok: true };
  }

  /**
   * Heeft deze houder nog plaatsrecht (BE-55)? Een rij in daghap_plaatsrecht
   * betekent nee. Ontbreekt die tabel (0023 nog niet toegepast), dan geldt het
   * recht als niet ingetrokken: deze PR mag niet stukgaan op een andere, nog
   * niet gemergede migratie.
   */
  async function controleerPlaatsrecht(supabase, userId, restaurantId) {
    const gevonden = await ask(
      supabase
        .from(TABLE_PLAATSRECHT)
        .select('user_id')
        .eq('restaurant_id', restaurantId)
        .eq('user_id', userId)
        .maybeSingle(),
    );
    if (gevonden.error) {
      if (missingStorage(gevonden.error)) return { ok: true };
      return { response: failed() };
    }
    if (gevonden.data) return { response: GEEN_PLAATSRECHT };
    return { ok: true };
  }

  /** Eigenaar én plaatsrecht in één keer, met dezelfde volgorde als de routes. */
  async function houder(request, restaurantId) {
    const auth = await aanvrager(request);
    if (auth.response) return auth;
    const supabase = client();
    if (!supabase) return { response: UNAVAILABLE };
    const eigenaar = await controleerEigenaar(supabase, auth.userId, restaurantId);
    if (eigenaar.response) return eigenaar;
    const recht = await controleerPlaatsrecht(supabase, auth.userId, restaurantId);
    if (recht.response) return recht;
    return { userId: auth.userId, supabase };
  }

  /** De interne beheerder (rol `internal`), of 401/403. */
  async function beheerder(request) {
    if (typeof authenticateInternal !== 'function') return { response: UNAUTHORIZED };
    let auth;
    try {
      auth = await authenticateInternal(request);
    } catch (error) {
      auth = null;
    }
    if (!auth || !auth.ok || !auth.userId) {
      const status = auth && Number(auth.status);
      if (status === 403) {
        return {
          response: {
            status: 403,
            body: { error: 'forbidden', message: tekst(auth.error) || GEEN_BEHEER.body.message },
          },
        };
      }
      return { response: UNAUTHORIZED };
    }
    const rollen = Array.isArray(auth.roles) ? auth.roles : [];
    if (!rollen.some((rij) => rij && rij.role === BEHEER_ROL)) return { response: GEEN_BEHEER };
    return { userId: auth.userId };
  }

  /** De statische kaart en het gerecht op die positie, of null. */
  function vindGerecht(menuId, categorieIndex, gerechtIndex) {
    const menu = menus && menus[menuId];
    if (!menu || !Array.isArray(menu.categories)) return null;
    const categorie = menu.categories[categorieIndex];
    if (!categorie || !Array.isArray(categorie.items)) return null;
    const item = categorie.items[gerechtIndex];
    if (!item) return null;
    return { menu, item };
  }

  function restaurantVan(menuId) {
    const delen = tekst(menuId).split('-');
    return delen.length > 1 ? tekst(delen[0]) : '';
  }

  function indexVan(value) {
    const nummer = Number(value);
    return Number.isInteger(nummer) && nummer >= 0 ? nummer : null;
  }

  function huidigePrijsCent(item) {
    const waarde = Number(item && item.priceValue);
    if (Number.isFinite(waarde) && waarde > 0) return Math.round(waarde * 100);
    return parsePrijsCent(item && item.price);
  }

  /** Hoeveel wijzigingen dit account vandaag al indiende (Amsterdam)? */
  async function telVandaag(supabase, userId) {
    const begin = beginVanDagAmsterdam(now());
    const gevonden = await ask(
      supabase
        .from(TABLE_WIJZIGINGEN)
        .select('wijziging_id')
        .eq('user_id', userId)
        .gte('created_at', begin),
    );
    if (gevonden.error) return { response: opslagFout(gevonden.error) };
    return { aantal: Array.isArray(gevonden.data) ? gevonden.data.length : 0 };
  }

  /** Eén geschiedenisregel per wijziging, beoordeling of bevestiging. */
  async function schrijfGeschiedenis(supabase, { wijzigingId = null, restaurantId, actie, door = null, gegevens = {} }) {
    const geschreven = await ask(
      supabase.from(TABLE_GEBEURTENISSEN).insert({
        wijziging_id: wijzigingId,
        restaurant_id: restaurantId,
        actie,
        door,
        gegevens,
        moment: new Date(Number(now())).toISOString(),
      }),
    );
    if (geschreven.error) return { response: opslagFout(geschreven.error) };
    return { ok: true };
  }

  /** De bevestiging van een restaurant, of null. Ontbrekende tabel is 503. */
  async function laadBevestiging(supabase, restaurantId) {
    const gevonden = await ask(
      supabase
        .from(TABLE_BEVESTIGINGEN)
        .select('restaurant_id, bevestigd_op')
        .eq('restaurant_id', restaurantId)
        .maybeSingle(),
    );
    if (gevonden.error) return { response: opslagFout(gevonden.error) };
    return { rij: gevonden.data || null };
  }

  /** Een goedgekeurde wijziging telt ook als bevestiging (contract). */
  async function bevestig(supabase, { restaurantId, userId }) {
    const nuIso = new Date(Number(now())).toISOString();
    const geschreven = await ask(
      supabase
        .from(TABLE_BEVESTIGINGEN)
        .upsert(
          { restaurant_id: restaurantId, user_id: userId, bevestigd_op: nuIso, updated_at: nuIso },
          { onConflict: 'restaurant_id' },
        )
        .select('restaurant_id, bevestigd_op')
        .maybeSingle(),
    );
    if (geschreven.error) return { response: opslagFout(geschreven.error) };
    return { rij: geschreven.data || { restaurant_id: restaurantId, bevestigd_op: nuIso } };
  }

  /** Eén rij voor de houder: status, oude en nieuwe prijs, reden. */
  function eigenRij(rij) {
    const cent = Number(rij && rij.prijs_cent);
    return {
      wijzigingId: rij.wijziging_id,
      restaurantId: rij.restaurant_id,
      menuId: rij.menu_id,
      categorieIndex: rij.categorie_index,
      gerechtIndex: rij.gerecht_index,
      gerechtNaam: rij.gerecht_naam,
      soort: rij.soort,
      oudePrijsCent: rij.oude_prijs_cent === null || rij.oude_prijs_cent === undefined ? null : Number(rij.oude_prijs_cent),
      prijsCent: Number.isFinite(cent) ? cent : null,
      prijs: Number.isFinite(cent) ? formatPrijsCent(cent) : '',
      beschikbaar: rij.beschikbaar === null || rij.beschikbaar === undefined ? null : Boolean(rij.beschikbaar),
      status: rij.status,
      groteWijziging: Boolean(rij.grote_wijziging),
      afwijsReden: rij.afwijs_reden || null,
      ingediendOp: rij.created_at || null,
      beoordeeldOp: rij.beoordeeld_op || null,
    };
  }

  /** Eén rij voor de interne controlelijst: ook wie en welke houder. */
  function beheerRij(rij) {
    return {
      ...eigenRij(rij),
      houderId: rij.user_id || null,
      beoordeeldDoor: rij.beoordeeld_door || null,
    };
  }

  /**
   * POST /api/v1/menukaart/wijzigingen — een houder dient een prijs- of
   * beschikbaarheidswijziging in. De statische kaart wordt nooit beschreven;
   * de wijziging staat op `in_controle` tot de interne controle beslist.
   */
  async function diendeWijzigingIn(request) {
    const supabase = client();
    if (!supabase) return UNAVAILABLE;
    const body = await readBody(request);
    if (!body) return invalid('invalid_body', 'Het verzoek is ongeldig.');

    const menuId = tekst(body.menuId);
    const restaurantId = restaurantVan(menuId);
    if (!restaurantId) return invalid('menu_required', 'Kies eerst een gerecht.');
    const categorieIndex = indexVan(body.categorieIndex);
    const gerechtIndex = indexVan(body.gerechtIndex);
    if (categorieIndex === null || gerechtIndex === null) {
      return invalid('gerecht_ongeldig', 'Kies eerst een gerecht.');
    }
    const gevonden = vindGerecht(menuId, categorieIndex, gerechtIndex);
    if (!gevonden) return invalid('gerecht_onbekend', 'Dit gerecht staat niet op de kaart.');

    const houderResult = await houder(request, restaurantId);
    if (houderResult.response) return houderResult.response;
    const { userId } = houderResult;

    const oudePrijsCent = huidigePrijsCent(gevonden.item);
    const validatie = valideerWijziging({
      soort: body.soort,
      prijs: body.prijs,
      prijsCent: body.prijsCent,
      beschikbaar: body.beschikbaar,
      huidigePrijsCent: oudePrijsCent,
    });
    if (!validatie.ok) {
      return invalid('invalid_wijziging', 'De wijziging is niet geldig.', {
        fouten: validatie.fouten,
        messages: validatie.fouten.map((fout) => BERICHTEN[fout] || ''),
      });
    }
    const wijziging = validatie.wijziging;

    const telling = await telVandaag(supabase, userId);
    if (telling.response) return telling.response;
    if (!magWijzigenVandaag(telling.aantal)) {
      return {
        status: 429,
        body: {
          error: FOUTEN.limiet,
          message: BERICHTEN[FOUTEN.limiet],
          maximum: MAX_WIJZIGINGEN_PER_DAG,
        },
      };
    }

    const nuIso = new Date(Number(now())).toISOString();
    const geschreven = await ask(
      supabase
        .from(TABLE_WIJZIGINGEN)
        .insert({
          restaurant_id: restaurantId,
          menu_id: menuId,
          categorie_index: categorieIndex,
          gerecht_index: gerechtIndex,
          gerecht_naam: tekst(gevonden.item.name).slice(0, 160),
          user_id: userId,
          soort: wijziging.soort,
          oude_prijs_cent: oudePrijsCent,
          prijs_cent: wijziging.prijsCent,
          beschikbaar: wijziging.beschikbaar,
          status: STATUS_IN_CONTROLE,
          grote_wijziging: wijziging.groteWijziging,
          created_at: nuIso,
          updated_at: nuIso,
        })
        .select(WIJZIGING_KOLOMMEN)
        .maybeSingle(),
    );
    if (tekst(geschreven.error && geschreven.error.code) === '23505') {
      return {
        status: 409,
        body: { error: 'wijziging_open', message: 'Er staat al een wijziging open voor dit gerecht.' },
      };
    }
    if (geschreven.error) return opslagFout(geschreven.error);
    const rij = geschreven.data;
    if (!rij) return failed();

    const geschiedenis = await schrijfGeschiedenis(supabase, {
      wijzigingId: rij.wijziging_id,
      restaurantId,
      actie: ACTIE_INGEDIEND,
      door: userId,
      gegevens: { soort: wijziging.soort, prijs_cent: wijziging.prijsCent, beschikbaar: wijziging.beschikbaar },
    });
    if (geschiedenis.response) {
      // Geen geschiedenis betekent geen wijziging: elke inzending moet
      // herleidbaar blijven, dus halen we de zojuist geschreven rij weer weg.
      await ask(supabase.from(TABLE_WIJZIGINGEN).delete().eq('wijziging_id', rij.wijziging_id));
      return geschiedenis.response;
    }

    return {
      status: 201,
      body: { ok: true, wijziging: eigenRij(rij), message: IN_CONTROLE_MESSAGE },
    };
  }

  /** GET /api/v1/menukaart/wijzigingen — de eigen wijzigingen van de houder. */
  async function eigenWijzigingen(request) {
    const supabase = client();
    if (!supabase) return UNAVAILABLE;
    const auth = await aanvrager(request);
    if (auth.response) return auth.response;

    const query = queryVan(request);
    const restaurant = tekst(query && query.get('restaurant'));
    let selectie = supabase
      .from(TABLE_WIJZIGINGEN)
      .select(WIJZIGING_KOLOMMEN)
      .eq('user_id', auth.userId);
    if (restaurant) selectie = selectie.eq('restaurant_id', restaurant);

    const gevonden = await ask(selectie.order('created_at', { ascending: false }).limit(EIGEN_LIMIT));
    if (gevonden.error) return opslagFout(gevonden.error);

    const telling = await telVandaag(supabase, auth.userId);
    if (telling.response) return telling.response;
    return {
      status: 200,
      body: {
        ok: true,
        wijzigingen: (Array.isArray(gevonden.data) ? gevonden.data : []).map(eigenRij),
        daglimiet: {
          maximum: MAX_WIJZIGINGEN_PER_DAG,
          resterend: resterendVandaag(telling.aantal),
        },
      },
    };
  }

  /**
   * GET /api/v1/menukaart/gerechten?menuId=<id> — de gerechten van de eigen
   * kaart voor de houderpagina, plus de laatste bevestiging. Alleen positie,
   * naam en huidige prijs: nooit de volledige dataset en nooit een schrijfactie.
   */
  async function menuGerechten(request) {
    const supabase = client();
    if (!supabase) return UNAVAILABLE;
    const query = queryVan(request);
    const menuId = tekst(query && (query.get('menuId') || query.get('menu')));
    const restaurantId = restaurantVan(menuId);
    if (!restaurantId) return invalid('menu_required', 'Kies eerst een menukaart.');
    const menu = menus && menus[menuId];
    if (!menu || !Array.isArray(menu.categories)) {
      return {
        status: 404,
        body: { error: 'menu_niet_gevonden', message: 'Deze menukaart bestaat niet (meer).' },
      };
    }

    const houderResult = await houder(request, restaurantId);
    if (houderResult.response) return houderResult.response;

    const bevestiging = await laadBevestiging(supabase, restaurantId);
    if (bevestiging.response) return bevestiging.response;

    return {
      status: 200,
      body: {
        ok: true,
        restaurantId,
        menuId,
        menuNaam: tekst(menu.name),
        gerechten: menuGerechtenVoorScherm(menu),
        bevestiging: bevestigingVoorScherm({
          bevestigdOp: bevestiging.rij && bevestiging.rij.bevestigd_op,
          now: now(),
        }),
      },
    };
  }

  /** POST /api/v1/menukaart/bevestigen — de houder bevestigt zijn kaart. */
  async function bevestigMenukaart(request) {
    const supabase = client();
    if (!supabase) return UNAVAILABLE;
    const body = await readBody(request);
    if (!body) return invalid('invalid_body', 'Het verzoek is ongeldig.');

    const menuId = tekst(body.menuId);
    const restaurantId = restaurantVan(menuId) || tekst(body.restaurantId);
    if (!restaurantId) return invalid('restaurant_required', 'Kies eerst een restaurant.');

    const houderResult = await houder(request, restaurantId);
    if (houderResult.response) return houderResult.response;

    const bevestiging = await bevestig(supabase, { restaurantId, userId: houderResult.userId });
    if (bevestiging.response) return bevestiging.response;

    const geschiedenis = await schrijfGeschiedenis(supabase, {
      restaurantId,
      actie: ACTIE_BEVESTIGD,
      door: houderResult.userId,
    });
    if (geschiedenis.response) return geschiedenis.response;

    return {
      status: 200,
      body: {
        ok: true,
        bevestiging: bevestigingVoorScherm({ bevestigdOp: bevestiging.rij.bevestigd_op, now: now() }),
        geldigDagen: BEVESTIGING_GELDIG_DAGEN,
      },
    };
  }

  /**
   * GET /api/v1/menukaart/overlay?restaurant=<id> — de goedgekeurde wijzigingen
   * van precies dat restaurant plus het bevestigingslabel. De statische
   * menudata blijft ongewijzigd; de pagina past deze overlay toe. Nooit de hele
   * tabel: filter op restaurant en status, met een vaste bovengrens.
   */
  async function publiekeOverlay(request) {
    const supabase = client();
    if (!supabase) return UNAVAILABLE;
    const query = queryVan(request);
    const restaurantId = tekst(query && (query.get('restaurant') || query.get('restaurantId')));
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(restaurantId)) {
      return invalid('restaurant_required', 'Kies eerst een restaurant.');
    }

    const gevonden = await ask(
      supabase
        .from(TABLE_WIJZIGINGEN)
        .select(PUBLIEK_KOLOMMEN)
        .eq('restaurant_id', restaurantId)
        .eq('status', STATUS_GOEDGEKEURD)
        .order('beoordeeld_op', { ascending: true })
        .limit(OVERLAY_LIMIT),
    );
    if (gevonden.error) return opslagFout(gevonden.error);

    const bevestiging = await laadBevestiging(supabase, restaurantId);
    if (bevestiging.response) return bevestiging.response;
    const bevestigdOp = bevestiging.rij && bevestiging.rij.bevestigd_op;

    return {
      status: 200,
      body: {
        ok: true,
        restaurantId,
        wijzigingen: overlayVoorScherm(Array.isArray(gevonden.data) ? gevonden.data : []),
        bevestiging: bevestigingVoorScherm({ bevestigdOp, now: now() }),
      },
    };
  }

  async function laadWijziging(supabase, id) {
    const gevonden = await ask(
      supabase
        .from(TABLE_WIJZIGINGEN)
        .select(WIJZIGING_KOLOMMEN)
        .eq('wijziging_id', id)
        .maybeSingle(),
    );
    if (gevonden.error) return { response: opslagFout(gevonden.error) };
    if (!gevonden.data) return { response: NIET_GEVONDEN };
    return { rij: gevonden.data };
  }

  /** GET /api/internal/v1/menukaart-wijzigingen — de controlelijst. */
  async function interneLijst(request) {
    const supabase = client();
    if (!supabase) return UNAVAILABLE;
    const auth = await beheerder(request);
    if (auth.response) return auth.response;

    const query = queryVan(request);
    const gevraagd = tekst(query && query.get('status'));
    const status = gevraagd || STATUS_IN_CONTROLE;
    if (![STATUS_IN_CONTROLE, STATUS_GOEDGEKEURD, STATUS_AFGEWEZEN].includes(status)) {
      return invalid('status_ongeldig', 'Kies een geldige status.');
    }

    const gevonden = await ask(
      supabase
        .from(TABLE_WIJZIGINGEN)
        .select(WIJZIGING_KOLOMMEN)
        .eq('status', status)
        .order('created_at', { ascending: true })
        .limit(BEHEER_LIMIT),
    );
    if (gevonden.error) return opslagFout(gevonden.error);

    const rijen = (Array.isArray(gevonden.data) ? gevonden.data : []).map(beheerRij);
    return {
      status: 200,
      body: {
        ok: true,
        status,
        wijzigingen: rijen,
        groteWijzigingen: rijen.filter((rij) => rij.groteWijziging).length,
      },
    };
  }

  /**
   * POST /api/internal/v1/menukaart-wijzigingen/<id>/goedkeuren.
   * Een goedgekeurde wijziging telt ook als bevestiging van de kaart.
   */
  async function keurGoed(request, context = {}) {
    const supabase = client();
    if (!supabase) return UNAVAILABLE;
    const auth = await beheerder(request);
    if (auth.response) return auth.response;

    const id = Number(context.id);
    if (!Number.isInteger(id) || id <= 0) return NIET_GEVONDEN;
    const geladen = await laadWijziging(supabase, id);
    if (geladen.response) return geladen.response;
    if (geladen.rij.status !== STATUS_IN_CONTROLE) {
      return {
        status: 409,
        body: { error: FOUTEN.status, message: BERICHTEN[FOUTEN.status] },
      };
    }

    const nuIso = new Date(Number(now())).toISOString();
    const bijgewerkt = await ask(
      supabase
        .from(TABLE_WIJZIGINGEN)
        .update({ status: STATUS_GOEDGEKEURD, beoordeeld_door: auth.userId, beoordeeld_op: nuIso, updated_at: nuIso })
        .eq('wijziging_id', id)
        .eq('status', STATUS_IN_CONTROLE)
        .select(WIJZIGING_KOLOMMEN)
        .maybeSingle(),
    );
    if (bijgewerkt.error) return opslagFout(bijgewerkt.error);
    const rij = bijgewerkt.data || geladen.rij;

    const geschiedenis = await schrijfGeschiedenis(supabase, {
      wijzigingId: id,
      restaurantId: rij.restaurant_id,
      actie: ACTIE_GOEDGEKEURD,
      door: auth.userId,
    });
    if (geschiedenis.response) {
      // Elke controle hoort in de geschiedenis: lukt dat niet, dan gaat de
      // wijziging terug naar in_controle in plaats van stil goedgekeurd te zijn.
      await ask(
        supabase
          .from(TABLE_WIJZIGINGEN)
          .update({ status: STATUS_IN_CONTROLE, beoordeeld_door: null, beoordeeld_op: null })
          .eq('wijziging_id', id),
      );
      return geschiedenis.response;
    }

    const bevestiging = await bevestig(supabase, { restaurantId: rij.restaurant_id, userId: rij.user_id });
    if (bevestiging.response) return bevestiging.response;

    return {
      status: 200,
      body: {
        ok: true,
        wijziging: beheerRij(rij),
        bevestiging: bevestigingVoorScherm({ bevestigdOp: bevestiging.rij.bevestigd_op, now: now() }),
      },
    };
  }

  /** POST /api/internal/v1/menukaart-wijzigingen/<id>/afwijzen — met reden. */
  async function wijsAf(request, context = {}) {
    const supabase = client();
    if (!supabase) return UNAVAILABLE;
    const auth = await beheerder(request);
    if (auth.response) return auth.response;

    const id = Number(context.id);
    if (!Number.isInteger(id) || id <= 0) return NIET_GEVONDEN;
    const body = await readBody(request);
    if (!body) return invalid('invalid_body', 'Het verzoek is ongeldig.');
    const reden = tekst(body.reden || body.reason);
    if (!reden || reden.length > REDEN_MAX) {
      return invalid(FOUTEN.reden, BERICHTEN[FOUTEN.reden]);
    }

    const geladen = await laadWijziging(supabase, id);
    if (geladen.response) return geladen.response;
    if (geladen.rij.status !== STATUS_IN_CONTROLE) {
      return {
        status: 409,
        body: { error: FOUTEN.status, message: BERICHTEN[FOUTEN.status] },
      };
    }

    const nuIso = new Date(Number(now())).toISOString();
    const bijgewerkt = await ask(
      supabase
        .from(TABLE_WIJZIGINGEN)
        .update({
          status: STATUS_AFGEWEZEN,
          afwijs_reden: reden,
          beoordeeld_door: auth.userId,
          beoordeeld_op: nuIso,
          updated_at: nuIso,
        })
        .eq('wijziging_id', id)
        .eq('status', STATUS_IN_CONTROLE)
        .select(WIJZIGING_KOLOMMEN)
        .maybeSingle(),
    );
    if (bijgewerkt.error) return opslagFout(bijgewerkt.error);
    const rij = bijgewerkt.data || { ...geladen.rij, status: STATUS_AFGEWEZEN, afwijs_reden: reden };

    const geschiedenis = await schrijfGeschiedenis(supabase, {
      wijzigingId: id,
      restaurantId: rij.restaurant_id,
      actie: ACTIE_AFGEWEZEN,
      door: auth.userId,
      gegevens: { reden },
    });
    if (geschiedenis.response) {
      await ask(
        supabase
          .from(TABLE_WIJZIGINGEN)
          .update({ status: STATUS_IN_CONTROLE, afwijs_reden: null, beoordeeld_door: null, beoordeeld_op: null })
          .eq('wijziging_id', id),
      );
      return geschiedenis.response;
    }

    return { status: 200, body: { ok: true, wijziging: beheerRij(rij) } };
  }

  return {
    diendeWijzigingIn,
    eigenWijzigingen,
    menuGerechten,
    bevestigMenukaart,
    publiekeOverlay,
    interneLijst,
    keurGoed,
    wijsAf,
  };
}

module.exports = {
  BEHEER_LIMIT,
  BEHEER_ROL,
  EIGEN_LIMIT,
  OVERLAY_LIMIT,
  PUBLIEK_KOLOMMEN,
  TABLE_BEVESTIGINGEN,
  TABLE_GEBEURTENISSEN,
  TABLE_PLAATSRECHT,
  TABLE_WIJZIGINGEN,
  WIJZIGING_KOLOMMEN,
  createSnelAanpassenHandlers,
  missingStorage,
};
