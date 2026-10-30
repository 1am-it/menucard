// BE-55 stap B, deel 4 (#135) — de interne werkvoorraad voor daghap en
// seizoensgerecht.
//
// Eén plek voor de vier beheeracties, met de afhankelijkheden als parameters
// zodat ze met een nep-client te testen zijn (dezelfde opzet als
// src/lib/daghapHandlers.js):
//   GET  /api/internal/v1/daghap/werkvoorraad        wat tegengehouden of gemeld is;
//   POST /api/internal/v1/daghap/<id>/goedgekeuren   weer online;
//   POST /api/internal/v1/daghap/<id>/verwijderen    offline halen;
//   POST /api/internal/v1/daghap/plaatsrecht         recht afnemen of teruggeven.
//
// De poort is de bestaande interne auth (`authenticateInternalRequest`, met
// hetzelfde TOTP-niveau als elke andere /internal-pagina) plus de rol
// `internal`, precies zoals /internal/menu-concepts en /internal/tellers. Een
// gast of houder krijgt hier dus 401 of 403; deze module is nooit publiek.
//
// Elke actie schrijft één geschiedenisregel in daghap_gebeurtenissen
// (goedgekeurd, verwijderd, recht_afgenomen, recht_teruggegeven). Verwijderen
// zet het aanbod op `offline` in plaats van de rij te wissen: de geschiedenis
// hangt met on delete cascade aan het aanbod, dus echt wissen zou het bewijs
// van de plaatsing weggooien. Het aanbod is daarna voor gasten weg en komt
// nooit terug.
//
// Ontbreekt de migratie, dan antwoordt elke actie met 503 en één nette
// melding; de interne pagina blijft dus werken zonder 0023.

'use strict';

const { MISSING_STORAGE_CODES, withTimeout } = require('./dishCounters');
const {
  DAGHAP_FOUTEN,
  DAGHAP_MESSAGES,
  DAGHAP_STATUS_CONTROLE,
  DAGHAP_STATUS_OFFLINE,
  DAGHAP_STATUS_ONLINE,
  DAGHAP_STATUS_VERLOPEN,
  aanbodVoorScherm,
  isVerlopen,
} = require('./daghapAanbod');
const {
  DAGHAP_TABLE_AANBOD,
  DAGHAP_TABLE_GEBEURTENISSEN,
  DAGHAP_TABLE_MELDINGEN,
  DAGHAP_TABLE_PLAATSRECHT,
} = require('./daghapHandlers');

const BEHEER_LIMIT = 50;
const BEHEER_TIMEOUT_MS = 4000;
// Dezelfde rol als de andere /internal-leespagina's (menu-concepts, tellers).
const BEHEER_ROL = 'internal';
const AANBOD_KOLOMMEN = 'id, restaurant_id, user_id, soort, naam, prijs_cent, beschrijving, labels, status, filter_reden, verloopt_op, created_at, updated_at';
const UUID_PATROON = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NIET_BESCHIKBAAR = {
  status: 503,
  body: { error: 'daghap_unavailable', message: 'De werkvoorraad is nog niet beschikbaar.' },
};
const NIET_GEVONDEN = {
  status: 404,
  body: { error: 'daghap_not_found', message: 'Dit aanbod bestaat niet (meer).' },
};
const GEEN_BEHEER = {
  status: 403,
  body: { error: 'forbidden', message: 'Alleen intern beheer kan dit.' },
};

function tekst(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function mislukt() {
  return { status: 500, body: { error: 'daghap_failed', message: 'Er ging iets mis. Probeer het opnieuw.' } };
}

function ongeldig(error, message) {
  return { status: 400, body: { error, message } };
}

/** De id uit het pad; alles wat geen positief geheel getal is bestaat niet. */
function normaliseerId(value) {
  const id = tekst(value);
  return /^\d{1,18}$/.test(id) ? id : null;
}

function createDaghapBeheerHandlers({ getSupabase, authenticate, now = Date.now, timeoutMs = BEHEER_TIMEOUT_MS } = {}) {
  function client() {
    if (typeof getSupabase !== 'function') return null;
    try {
      const supabase = getSupabase();
      return supabase && typeof supabase.from === 'function' ? supabase : null;
    } catch (error) {
      return null;
    }
  }

  async function ask(promise) {
    try {
      const resultaat = await withTimeout(Promise.resolve(promise), timeoutMs);
      if (resultaat && typeof resultaat === 'object') return resultaat;
      return { data: resultaat === undefined ? null : resultaat, error: null };
    } catch (error) {
      return { data: null, error: { message: tekst(error && error.message) || 'daghap_timeout' } };
    }
  }

  function missingStorage(error) {
    if (!error) return false;
    if (MISSING_STORAGE_CODES.has(tekst(error.code).toUpperCase())) return true;
    return /does not exist|schema cache/i.test(tekst(error.message || error.details || error.hint));
  }

  function opslagFout(error) {
    return missingStorage(error) ? NIET_BESCHIKBAAR : mislukt();
  }

  /** De beheerder, of een kant-en-klaar 401/403-antwoord. */
  async function beheerder(request) {
    if (typeof authenticate !== 'function') {
      return { response: { status: 401, body: { error: 'unauthorized', message: 'Log in om dit te beheren.' } } };
    }
    let auth;
    try {
      auth = await authenticate(request);
    } catch (error) {
      auth = null;
    }
    if (!auth || !auth.ok || !auth.userId) {
      const status = auth && Number(auth.status);
      const echteStatus = status === 401 || status === 403 ? status : 401;
      return {
        response: {
          status: echteStatus,
          body: {
            error: echteStatus === 403 ? 'forbidden' : 'unauthorized',
            message: (auth && auth.error) || 'Log in om dit te beheren.',
          },
        },
      };
    }
    const rollen = Array.isArray(auth.roles) ? auth.roles : [];
    if (!rollen.some((rij) => rij && rij.role === BEHEER_ROL)) return { response: GEEN_BEHEER };
    return { userId: auth.userId };
  }

  /** Eén geschiedenisregel; de momentopname gaat mee, nooit overschreven. */
  async function schrijfGeschiedenis(supabase, { rij = null, restaurantId, actie, door, gegevens = {} }) {
    const geschreven = await ask(
      supabase.from(DAGHAP_TABLE_GEBEURTENISSEN).insert({
        aanbod_id: rij && rij.id !== undefined ? rij.id : null,
        restaurant_id: restaurantId,
        actie,
        door,
        apparaat: null,
        gegevens: {
          ...(rij ? { naam: rij.naam, prijs_cent: rij.prijs_cent, status: rij.status } : {}),
          ...gegevens,
        },
        moment: new Date(Number(now())).toISOString(),
      }),
    );
    if (geschreven.error) return { response: opslagFout(geschreven.error) };
    return { ok: true };
  }

  /** Hoeveel meldingen dit aanbod heeft, per aanbod-id. */
  async function telMeldingen(supabase, ids) {
    if (ids.length === 0) return { perAanbod: new Map() };
    const gevonden = await ask(
      supabase.from(DAGHAP_TABLE_MELDINGEN).select('aanbod_id').in('aanbod_id', ids),
    );
    if (gevonden.error) return { response: opslagFout(gevonden.error) };
    const perAanbod = new Map();
    for (const rij of Array.isArray(gevonden.data) ? gevonden.data : []) {
      const sleutel = String(rij.aanbod_id);
      perAanbod.set(sleutel, (perAanbod.get(sleutel) || 0) + 1);
    }
    return { perAanbod };
  }

  /** De houders die nu geen plaatsrecht meer hebben (per restaurant en account). */
  async function laadPlaatsrecht(supabase) {
    const gevonden = await ask(
      supabase.from(DAGHAP_TABLE_PLAATSRECHT).select('restaurant_id, user_id, ingetrokken_op'),
    );
    if (gevonden.error) return { response: opslagFout(gevonden.error) };
    return { rijen: Array.isArray(gevonden.data) ? gevonden.data : [] };
  }


  /**
   * GET /api/internal/v1/daghap/werkvoorraad — het aanbod dat tegengehouden is
   * (in_controle) of gemeld is, met per rij het aantal meldingen en de houder.
   * Verlopen aanbod hoort er niet meer bij.
   */
  async function getWerkvoorraad(request) {
    const supabase = client();
    if (!supabase) return NIET_BESCHIKBAAR;
    const auth = await beheerder(request);
    if (auth.response) return auth.response;

    const gevonden = await ask(
      supabase
        .from(DAGHAP_TABLE_AANBOD)
        .select(AANBOD_KOLOMMEN)
        .in('status', [DAGHAP_STATUS_ONLINE, DAGHAP_STATUS_CONTROLE])
        .gt('verloopt_op', new Date(Number(now())).toISOString())
        .order('updated_at', { ascending: false })
        .limit(BEHEER_LIMIT),
    );
    if (gevonden.error) return opslagFout(gevonden.error);

    const rijen = (Array.isArray(gevonden.data) ? gevonden.data : [])
      .filter((rij) => !isVerlopen(rij.verloopt_op, now()));
    const telling = await telMeldingen(supabase, rijen.map((rij) => rij.id));
    if (telling.response) return telling.response;
    const recht = await laadPlaatsrecht(supabase);
    if (recht.response) return recht.response;

    const aanbod = rijen
      .map((rij) => {
        const meldingen = telling.perAanbod.get(String(rij.id)) || 0;
        const scherm = aanbodVoorScherm(rij);
        if (!scherm) return null;
        return {
          ...scherm,
          houderId: rij.user_id || null,
          reden: rij.filter_reden || null,
          meldingen,
          tegengehouden: rij.status === DAGHAP_STATUS_CONTROLE,
        };
      })
      .filter(Boolean)
      // Alleen wat aandacht vraagt: tegengehouden of gemeld.
      .filter((rij) => rij.tegengehouden || rij.meldingen > 0);

    return {
      status: 200,
      body: {
        ok: true,
        aanbod,
        tegengehouden: aanbod.filter((rij) => rij.tegengehouden).length,
        gemeld: aanbod.filter((rij) => rij.meldingen > 0).length,
        plaatsrecht: recht.rijen.map((rij) => ({
          restaurantId: rij.restaurant_id || null,
          houderId: rij.user_id || null,
          ingetrokkenOp: rij.ingetrokken_op || null,
        })),
      },
    };
  }

  /** Het aanbod van één id, of een 404/500-antwoord. */
  async function laadEen(supabase, id) {
    const gevonden = await ask(
      supabase.from(DAGHAP_TABLE_AANBOD).select(AANBOD_KOLOMMEN).eq('id', id).maybeSingle(),
    );
    if (gevonden.error) return { response: opslagFout(gevonden.error) };
    if (!gevonden.data) return { response: NIET_GEVONDEN };
    return { rij: gevonden.data };
  }

  /** De één-actieve-daghap-index van 0023 als nette 409. */
  function opslaanMislukt(error) {
    if (missingStorage(error)) return NIET_BESCHIKBAAR;
    if (tekst(error && error.code) === '23505') {
      return { status: 409, body: { error: DAGHAP_FOUTEN.daghapVol, message: DAGHAP_MESSAGES.daghapVol } };
    }
    return mislukt();
  }


  /** POST /api/internal/v1/daghap/<id>/goedkeuren — het aanbod gaat weer online. */
  async function keurGoed(request, context = {}) {
    const supabase = client();
    if (!supabase) return NIET_BESCHIKBAAR;
    const auth = await beheerder(request);
    if (auth.response) return auth.response;

    const id = normaliseerId(context && context.id);
    if (!id) return NIET_GEVONDEN;
    const gevonden = await laadEen(supabase, id);
    if (gevonden.response) return gevonden.response;
    const huidig = gevonden.rij;

    if (huidig.status === DAGHAP_STATUS_VERLOPEN || isVerlopen(huidig.verloopt_op, now())) {
      return {
        status: 409,
        body: { error: DAGHAP_FOUTEN.verlopen, message: 'Dit aanbod is verlopen en komt niet meer terug.' },
      };
    }

    const geschreven = await ask(
      supabase
        .from(DAGHAP_TABLE_AANBOD)
        .update({
          status: DAGHAP_STATUS_ONLINE,
          filter_reden: null,
          updated_at: new Date(Number(now())).toISOString(),
        })
        .eq('id', id)
        .select(AANBOD_KOLOMMEN)
        .single(),
    );
    if (geschreven.error) return opslaanMislukt(geschreven.error);

    const rij = geschreven.data;
    if (!rij) return mislukt();
    const geschiedenis = await schrijfGeschiedenis(supabase, {
      rij,
      restaurantId: rij.restaurant_id,
      actie: 'goedgekeurd',
      door: auth.userId,
    });
    if (geschiedenis.response) return geschiedenis.response;

    return {
      status: 200,
      body: { ok: true, bericht: 'Het aanbod staat weer online.', aanbod: aanbodVoorScherm(rij) },
    };
  }

  /**
   * POST /api/internal/v1/daghap/<id>/verwijderen — het aanbod gaat offline en
   * komt niet terug. De rij en zijn geschiedenis blijven bewaard.
   */
  async function verwijderAanbod(request, context = {}) {
    const supabase = client();
    if (!supabase) return NIET_BESCHIKBAAR;
    const auth = await beheerder(request);
    if (auth.response) return auth.response;

    const id = normaliseerId(context && context.id);
    if (!id) return NIET_GEVONDEN;
    const gevonden = await laadEen(supabase, id);
    if (gevonden.response) return gevonden.response;

    const geschreven = await ask(
      supabase
        .from(DAGHAP_TABLE_AANBOD)
        .update({
          status: DAGHAP_STATUS_OFFLINE,
          filter_reden: null,
          updated_at: new Date(Number(now())).toISOString(),
        })
        .eq('id', id)
        .select(AANBOD_KOLOMMEN)
        .single(),
    );
    if (geschreven.error) return opslagFout(geschreven.error);

    const rij = geschreven.data;
    if (!rij) return mislukt();
    const geschiedenis = await schrijfGeschiedenis(supabase, {
      rij,
      restaurantId: rij.restaurant_id,
      actie: 'verwijderd',
      door: auth.userId,
    });
    if (geschiedenis.response) return geschiedenis.response;

    return {
      status: 200,
      body: { ok: true, bericht: 'Het aanbod staat niet meer online.', aanbod: aanbodVoorScherm(rij) },
    };
  }

  /**
   * POST /api/internal/v1/daghap/plaatsrecht — `{ restaurant_id, user_id,
   * actie }` met actie `afnemen` of `teruggeven`. Afnemen zet één rij in
   * daghap_plaatsrecht; teruggeven haalt hem weg. Beide schrijven een
   * geschiedenisregel, ook als er niets veranderde.
   */
  async function wijzigPlaatsrecht(request) {
    const supabase = client();
    if (!supabase) return NIET_BESCHIKBAAR;
    const auth = await beheerder(request);
    if (auth.response) return auth.response;

    let body = null;
    try {
      body = await request.json();
    } catch (error) {
      body = null;
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return ongeldig('invalid_body', 'Kies een houder en een actie.');
    }

    const restaurantId = tekst(body.restaurant_id || body.restaurantId);
    if (!restaurantId || restaurantId.length > 64) {
      return ongeldig('restaurant_required', 'Kies eerst een restaurant.');
    }
    const houderId = tekst(body.user_id || body.userId);
    if (!UUID_PATROON.test(houderId)) {
      return ongeldig('user_required', 'Kies eerst een houder.');
    }
    const actie = tekst(body.actie);
    if (actie !== 'afnemen' && actie !== 'teruggeven') {
      return ongeldig('actie_ongeldig', 'Kies afnemen of teruggeven.');
    }

    if (actie === 'afnemen') {
      const geschreven = await ask(
        supabase.from(DAGHAP_TABLE_PLAATSRECHT).insert({
          restaurant_id: restaurantId,
          user_id: houderId,
          door: auth.userId,
          ingetrokken_op: new Date(Number(now())).toISOString(),
        }),
      );
      // 23505: het recht was al afgenomen. Dat is geen fout; de geschiedenis
      // krijgt wel een regel, zodat de actie herleidbaar blijft.
      if (geschreven.error && tekst(geschreven.error.code) !== '23505') {
        return opslagFout(geschreven.error);
      }
    } else {
      const verwijderd = await ask(
        supabase
          .from(DAGHAP_TABLE_PLAATSRECHT)
          .delete()
          .eq('restaurant_id', restaurantId)
          .eq('user_id', houderId),
      );
      if (verwijderd.error) return opslagFout(verwijderd.error);
    }

    const geschiedenis = await schrijfGeschiedenis(supabase, {
      restaurantId,
      actie: actie === 'afnemen' ? 'recht_afgenomen' : 'recht_teruggegeven',
      door: auth.userId,
      gegevens: { houder_id: houderId },
    });
    if (geschiedenis.response) return geschiedenis.response;

    return {
      status: 200,
      body: {
        ok: true,
        bericht: actie === 'afnemen'
          ? 'Deze houder mag geen aanbod meer plaatsen.'
          : 'Deze houder mag weer aanbod plaatsen.',
        restaurantId,
        houderId,
        plaatsrecht: actie === 'teruggeven',
      },
    };
  }

  return {
    getWerkvoorraad,
    keurGoed,
    verwijderAanbod,
    wijzigPlaatsrecht,
  };
}

module.exports = {
  BEHEER_LIMIT,
  BEHEER_ROL,
  createDaghapBeheerHandlers,
};
