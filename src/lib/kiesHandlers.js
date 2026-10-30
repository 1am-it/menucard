// BE-46 (#106, criterium 2 en 3) — de serverkant van "samen kiezen".
//
// Eén plek voor de vier verzoeken uit het contract, met de afhankelijkheden als
// parameters zodat ze met een nep-client te testen zijn:
//   POST   /api/v1/kies               maakt een stemming uit `dish_keys` en
//                                     geeft de code terug; elke sleutel moet via
//                                     de bestaande deeplinkresolutie bestaan;
//   GET    /api/v1/kies/<code>        de gerechten, de sluitingstijd en de uitslag;
//   POST   /api/v1/kies/<code>/stem   `{ stemmer, roepnaam, dishKey, lekker }`,
//                                     geweigerd na de sluitingstijd, boven 50
//                                     stemmers en bij een gerecht dat niet in de
//                                     stemming zit;
//   DELETE /api/v1/kies/<code>/stem   de laatste stem van die stemmer ongedaan.
//
// Plus het opruimen (criterium 3): de functie verwijder_oude_kies_stemmingen uit
// supabase/migrations/0022_be46_samen_kiezen.sql, één keer per dag aangeroepen
// door /api/cron/kies-opruimen.
//
// Niets hier leest een IP-adres, een user agent, een account of een cookie. De
// enige identiteit is `stemmer`: het willekeurige kenmerk uit de browser van de
// stemmer zelf (localStorage), met dezelfde vorm als de code.
//
// Ontbreekt de migratie (tabellen of functie bestaan niet), dan antwoordt elke
// route met 503 en de ene melding uit het contract; de UI toont "Samen kiezen is
// nog niet beschikbaar". De app blijft dus werken zonder 0022.
//
// Bewust CommonJS, zoals dishCounterHandlers.js: de tests bouwen de handlers met
// een nep-client en draaien met `node --test`, zonder Supabase.

'use strict';

const { MISSING_STORAGE_CODES, withTimeout } = require('./dishCounters');
const {
  KIES_CLOSED_MESSAGE,
  KIES_FULL_MESSAGE,
  KIES_MAX_STEMMERS,
  KIES_NOT_AVAILABLE_MESSAGE,
  KIES_RETENTION_DAYS,
  KIES_ROEPNAAM_LABEL,
  KIES_VOTE_FAILED_MESSAGE,
  generateKiesCode,
  isMissingKiesStorage,
  isStemmingClosed,
  kiesHref,
  lastVoteOf,
  normalizeDishKeys,
  normalizeKiesCode,
  normalizeLekker,
  normalizeRoepnaam,
  normalizeStemmer,
  normalizeStemming,
  normalizeVotes,
  parseSluitOm,
  resolveKiesDishes,
  stemmerCount,
  stemmingResult,
  voteOf,
} = require('./kiesStemming');

// De tabellen en de functie uit supabase/migrations/0022.
const KIES_TABLE_STEMMINGEN = 'kies_stemmingen';
const KIES_TABLE_STEMMEN = 'kies_stemmen';
const KIES_CLEANUP_FUNCTION = 'verwijder_oude_kies_stemmingen';
// Een stemverzoek is klein; alles groter is geen stemverzoek.
const KIES_MAX_BODY_BYTES = 2048;
// De database is één insert of één upsert. Duurt hij langer, dan antwoordt de
// route met een nette fout in plaats van te blijven hangen.
const KIES_TIMEOUT_MS = 4000;
// Een code is willekeurig; een botsing is theoretisch. Drie pogingen is genoeg
// en houdt een kapotte generator zichtbaar als fout.
const KIES_CODE_ATTEMPTS = 3;

function textOf(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

const UNAVAILABLE = {
  status: 503,
  body: { error: 'kies_unavailable', message: KIES_NOT_AVAILABLE_MESSAGE },
};
const NOT_FOUND = {
  status: 404,
  body: { error: 'kies_not_found', message: 'Deze stemlink bestaat niet (meer).' },
};

function invalid(error, extra = {}) {
  return { status: 400, body: { error, ...extra } };
}

function failed() {
  return { status: 500, body: { error: 'kies_failed', message: KIES_VOTE_FAILED_MESSAGE } };
}

/** De JSON van een verzoek, of null. Te groot, kapot of geen object: null. */
async function readBody(request) {
  if (!request || typeof request.json !== 'function') return null;
  const headers = request.headers;
  if (headers && typeof headers.get === 'function') {
    const length = Number(headers.get('content-length'));
    if (Number.isFinite(length) && length > KIES_MAX_BODY_BYTES) return null;
  }
  try {
    const value = await request.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (error) {
    return null;
  }
}

/** De stemmer uit een DELETE: in de JSON, anders als queryparameter. */
function stemmerFromRequest(request, body) {
  const direct = body && (body.stemmer || body.stemmerId);
  if (direct) return direct;
  const url = request && typeof request.url === 'string' ? request.url : '';
  if (!url) return null;
  try {
    return new URL(url, 'http://kies.invalid').searchParams.get('stemmer');
  } catch (error) {
    return null;
  }
}

/** Zegt deze fout dat de tabel of functie nog niet bestaat? */
function missingStorage(error) {
  return isMissingKiesStorage(error) || MISSING_STORAGE_CODES.has(textOf(error && error.code).toUpperCase());
}

/**
 * De handlers, met hun afhankelijkheden als parameters:
 *   getSupabase     de bestaande server-admin-client (service role); mag gooien
 *                   als er geen sleutel is — dat is hier "niet beschikbaar";
 *   menus           de echte menukaarten (data/menus.json);
 *   restaurants     de echte restaurants (data/restaurants.json);
 *   reservationFor  de bestaande reserveerroutering (BE-07);
 *   now             de klok (sluitingstijd, tests);
 *   timeoutMs       bovengrens per database-aanroep.
 */
function createKiesHandlers({
  getSupabase,
  menus,
  restaurants,
  reservationFor,
  now = Date.now,
  timeoutMs = KIES_TIMEOUT_MS,
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
      return { data: null, error: { message: textOf(error && error.message) || 'kies_timeout' } };
    }
  }

  /** De stemming en haar stemmen, of een kant-en-klaar antwoord bij een fout. */
  async function loadStemming(code) {
    const supabase = client();
    if (!supabase) return { response: UNAVAILABLE };
    const readStemming = await ask(
      supabase
        .from(KIES_TABLE_STEMMINGEN)
        .select('code, dish_keys, sluit_om, created_at')
        .eq('code', code)
        .maybeSingle(),
    );
    if (readStemming.error) return { response: missingStorage(readStemming.error) ? UNAVAILABLE : failed() };
    const stemming = normalizeStemming(readStemming.data);
    if (!stemming) return { response: NOT_FOUND };

    const readVotes = await ask(
      supabase
        .from(KIES_TABLE_STEMMEN)
        .select('stemmer, roepnaam, dish_key, lekker, gestemd_op')
        .eq('stemming_code', code),
    );
    if (readVotes.error) return { response: missingStorage(readVotes.error) ? UNAVAILABLE : failed() };
    const votes = normalizeVotes(readVotes.data);
    const resolved = resolveKiesDishes({
      dishKeys: stemming.dishKeys,
      menus,
      restaurants,
      reservationFor,
    });
    if (resolved.dishes.length === 0) return { response: NOT_FOUND };
    return { stemming, votes, dishes: resolved.dishes, skipped: resolved.skipped };
  }

  /** De uitslag zoals elk antwoord hem teruggeeft. */
  function resultBody({ code, stemming, dishes, votes }) {
    const result = stemmingResult({ dishes, votes });
    return {
      code,
      sluitOm: stemming.sluitOm,
      gesloten: isStemmingClosed(stemming, now()),
      uitslag: result.uitslag,
      stemmers: result.stemmers,
      stemmen: result.stemmen,
    };
  }

  /**
   * POST /api/v1/kies — maakt een stemming. De code komt uit 16 willekeurige
   * bytes en wordt nooit van de gerechten of de maker afgeleid.
   */
  async function createStemming(request) {
    const body = await readBody(request);
    if (!body) return invalid('invalid_body');
    const { dishKeys } = normalizeDishKeys(body.dish_keys !== undefined ? body.dish_keys : body.dishKeys);
    if (dishKeys.length === 0) return invalid('no_dishes');

    // Elke sleutel moet via de bestaande deeplinkresolutie bestaan; één
    // onbekende sleutel is een fout van de maker, geen stille korting.
    const resolved = resolveKiesDishes({ dishKeys, menus, restaurants, reservationFor });
    if (resolved.skipped > 0) return invalid('unknown_dish_key', { skipped: resolved.skipped });
    if (resolved.dishes.length === 0) return invalid('no_dishes');

    const sluitOm = parseSluitOm(body.sluit_om !== undefined ? body.sluit_om : body.sluitOm);
    if (!sluitOm.ok) return invalid('invalid_sluit_om');
    if (sluitOm.value && Date.parse(sluitOm.value) <= Number(now())) return invalid('sluit_om_in_past');

    const supabase = client();
    if (!supabase) return UNAVAILABLE;

    for (let attempt = 0; attempt < KIES_CODE_ATTEMPTS; attempt += 1) {
      const code = generateKiesCode();
      if (!code) return failed();
      const inserted = await ask(
        supabase
          .from(KIES_TABLE_STEMMINGEN)
          .insert({ code, dish_keys: dishKeys, sluit_om: sluitOm.value })
          .select('code')
          .single(),
      );
      if (!inserted.error) {
        return {
          status: 201,
          body: {
            code,
            href: kiesHref(code),
            dishKeys,
            dishes: resolved.dishes.length,
            sluitOm: sluitOm.value,
          },
        };
      }
      if (missingStorage(inserted.error)) return UNAVAILABLE;
      // Alleen een botsing op de primaire sleutel is een reden voor een nieuwe
      // code; elke andere fout is een echte fout.
      if (textOf(inserted.error.code) !== '23505') return failed();
    }
    return failed();
  }

  /** GET /api/v1/kies/<code> — de gerechten, de sluitingstijd en de uitslag. */
  async function readStemmingRequest(request, context = {}) {
    const code = normalizeKiesCode(context.code);
    if (!code) return NOT_FOUND;
    const loaded = await loadStemming(code);
    if (loaded.response) return loaded.response;
    return {
      status: 200,
      body: {
        ...resultBody({ code, ...loaded }),
        dishes: loaded.dishes,
        skipped: loaded.skipped,
      },
    };
  }


  /**
   * POST /api/v1/kies/<code>/stem — één stem. Een nieuwe stem op hetzelfde
   * gerecht vervangt de vorige (uniek op stemming, stemmer, gerecht).
   */
  async function vote(request, context = {}) {
    const code = normalizeKiesCode(context.code);
    if (!code) return NOT_FOUND;
    const body = await readBody(request);
    if (!body) return invalid('invalid_body');

    const stemmer = normalizeStemmer(body.stemmer !== undefined ? body.stemmer : body.stemmerId);
    const roepnaam = normalizeRoepnaam(body.roepnaam);
    const dishKey = textOf(body.dishKey !== undefined ? body.dishKey : body.dish_key);
    const lekker = normalizeLekker(body.lekker);
    if (!stemmer) return invalid('invalid_stemmer');
    if (!roepnaam) return invalid('invalid_roepnaam', { message: `${KIES_ROEPNAAM_LABEL} klopt niet.` });
    if (!dishKey) return invalid('invalid_dish_key');
    if (lekker === null) return invalid('invalid_lekker');

    const loaded = await loadStemming(code);
    if (loaded.response) return loaded.response;
    const { stemming, dishes, votes } = loaded;
    if (!stemming.dishKeys.includes(dishKey)) {
      return invalid('dish_not_in_stemming', { message: 'Dit gerecht hoort niet bij deze stemming.' });
    }
    // Na de sluitingstijd verandert er niets meer.
    if (isStemmingClosed(stemming, now())) {
      return { status: 409, body: { error: 'closed', message: KIES_CLOSED_MESSAGE, ...resultBody({ code, stemming, dishes, votes }) } };
    }
    // Het maximum geldt voor nieuwe stemmers, niet voor iemand die al meedoet.
    const known = votes.some((vote) => vote.stemmer === stemmer);
    if (!known && stemmerCount(votes) >= KIES_MAX_STEMMERS) {
      return { status: 409, body: { error: 'full', message: KIES_FULL_MESSAGE, ...resultBody({ code, stemming, dishes, votes }) } };
    }

    const supabase = client();
    if (!supabase) return UNAVAILABLE;
    const previous = voteOf(votes, stemmer, dishKey);
    const written = await ask(
      supabase
        .from(KIES_TABLE_STEMMEN)
        .upsert(
          {
            stemming_code: code,
            stemmer,
            roepnaam,
            dish_key: dishKey,
            lekker,
            gestemd_op: new Date(Number(now())).toISOString(),
          },
          { onConflict: 'stemming_code,stemmer,dish_key' },
        )
        .select('stem_id'),
    );
    if (written.error) return missingStorage(written.error) ? UNAVAILABLE : failed();

    const nextVotes = previous
      ? votes.map((vote) => (vote.stemmer === stemmer && vote.dishKey === dishKey
        ? { ...vote, roepnaam, lekker }
        : vote))
      : votes.concat([{ stemmer, roepnaam, dishKey, lekker, gestemdOp: new Date(Number(now())).toISOString() }]);
    return {
      status: 200,
      body: {
        ok: true,
        vervangen: Boolean(previous),
        ...resultBody({ code, stemming, dishes, votes: nextVotes }),
      },
    };
  }

  /**
   * DELETE /api/v1/kies/<code>/stem — de laatste stem van deze stemmer ongedaan.
   * Zonder stem is dat geen fout: er valt alleen niets ongedaan te maken.
   */
  async function undoVote(request, context = {}) {
    const code = normalizeKiesCode(context.code);
    if (!code) return NOT_FOUND;
    const body = await readBody(request);
    const stemmer = normalizeStemmer(stemmerFromRequest(request, body));
    if (!stemmer) return invalid('invalid_stemmer');

    const loaded = await loadStemming(code);
    if (loaded.response) return loaded.response;
    const { stemming, dishes, votes } = loaded;
    if (isStemmingClosed(stemming, now())) {
      return { status: 409, body: { error: 'closed', message: KIES_CLOSED_MESSAGE, ...resultBody({ code, stemming, dishes, votes }) } };
    }
    const last = lastVoteOf(votes, stemmer);
    if (!last) {
      return { status: 200, body: { ok: true, undone: false, ...resultBody({ code, stemming, dishes, votes }) } };
    }

    const supabase = client();
    if (!supabase) return UNAVAILABLE;
    const removed = await ask(
      supabase
        .from(KIES_TABLE_STEMMEN)
        .delete()
        .eq('stemming_code', code)
        .eq('stemmer', stemmer)
        .eq('dish_key', last.dishKey),
    );
    if (removed.error) return missingStorage(removed.error) ? UNAVAILABLE : failed();

    const nextVotes = votes.filter((vote) => !(vote.stemmer === stemmer && vote.dishKey === last.dishKey));
    return {
      status: 200,
      body: {
        ok: true,
        undone: true,
        dishKey: last.dishKey,
        ...resultBody({ code, stemming, dishes, votes: nextVotes }),
      },
    };
  }

  /**
   * Het opruimen (criterium 3): alles ouder dan zeven dagen, inclusief de
   * stemmen (on delete cascade). De route controleert CRON_SECRET, net als de
   * bestaande cronroutes.
   */
  async function cleanupStemmingen() {
    const supabase = client();
    if (!supabase) return { status: 503, body: { ok: false } };
    if (typeof supabase.rpc !== 'function') return { status: 503, body: { ok: false } };
    const result = await ask(supabase.rpc(KIES_CLEANUP_FUNCTION, { p_dagen: KIES_RETENTION_DAYS }));
    if (result.error) {
      if (missingStorage(result.error)) return { status: 503, body: { ok: false } };
      return { status: 500, body: { ok: false } };
    }
    const verwijderd = Number(result.data);
    return { status: 200, body: { ok: true, verwijderd: Number.isFinite(verwijderd) ? verwijderd : 0 } };
  }

  return {
    cleanupStemmingen,
    createStemming,
    readStemmingRequest,
    undoVote,
    vote,
    /** Alleen voor tests en diagnostics: is de client geconfigureerd? */
    hasClient() {
      return client() !== null;
    },
  };
}

module.exports = {
  KIES_CLEANUP_FUNCTION,
  KIES_CODE_ATTEMPTS,
  KIES_MAX_BODY_BYTES,
  KIES_TABLE_STEMMEN,
  KIES_TABLE_STEMMINGEN,
  KIES_TIMEOUT_MS,
  createKiesHandlers,
  readBody,
  stemmerFromRequest,
};

