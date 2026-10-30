// BE-45 (#114) — de serverkant van de tellertabel.
//
// GET /api/internal/v1/tellers achter `authenticateInternalRequest`, met de
// server-admin-client die `select` op `dish_counters` heeft (migratie 0021).
// Deze handler kent geen Supabase en geen omgeving: de client, de auth, de
// menukaarten en de klok komen van buiten, zodat de tests met een nep-client
// precies kunnen zien wat er gevraagd wordt.
//
// Volgorde is de veiligheidsvolgorde, net als in workqueueCountsHandlers:
//   1. authenticeren — zonder sessie 401;
//   2. alleen de rol `internal` — een `editor` of `owner` krijgt 403 en er wordt
//      dan niets uit de database gelezen;
//   3. pas daarna de periode bepalen (ongeldig → 7, criterium 1) en lezen.
//
// Lezen gebeurt in pagina's van 1000 (de standaardlimiet van PostgREST), zodat
// een periode met veel dagen geen stille afkapping kent. Een ontbrekende tabel
// (migratie nog niet toegepast) en een onbereikbare database geven dezelfde
// nette 503 met "Tellers zijn nu niet beschikbaar." — nooit een crash.
//
// Bewust CommonJS, zoals dishCounterHandlers.js: direct testbaar met
// `node --test`, zonder Supabase.

'use strict';

const {
  DEFAULT_PERIOD,
  FORBIDDEN_MESSAGE,
  UNAVAILABLE_MESSAGE,
  buildTellersReport,
  normalizePeriod,
  periodRange,
} = require('./dishCounterReport');
const { isInternalOnly } = require('./importInbox');

const TABLE = 'dish_counters';
// Alleen deze kolommen: geen identiteit, geen tijdstip per gebeurtenis.
const COLUMNS = 'dish_key, day, shared, saved, reservation_clicks';
// PostgREST geeft standaard hooguit 1000 rijen per verzoek.
const PAGE_SIZE = 1000;
// Een harde bovengrens voor de leesronde: 20.000 dag-rijen is bij 30 dagen
// ruim 600 gerechten per dag. Alles daarboven is geen echte telling meer.
const MAX_SOURCE_ROWS = 20000;

function textOf(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

/** De periode uit de query string, of null. Een kapotte URL is geen fout. */
function periodFromRequest(request) {
  try {
    const url = new URL(request && request.url);
    return url.searchParams.get('periode');
  } catch (error) {
    return null;
  }
}

/**
 * De handler. Afhankelijkheden:
 *   authenticate  de bestaande authenticateInternalRequest;
 *   getSupabase   de bestaande server-admin-client (mag gooien zonder sleutel);
 *   menus         data/menus.json, voor de resolutie van de deeplink;
 *   restaurants   data/restaurants.json, voor de restaurantnaam;
 *   now           de klok van de periode (tests);
 *   pageSize/maxSourceRows  de grenzen van de leesronde.
 */
function createDishCounterReportHandlers({
  authenticate,
  getSupabase,
  menus,
  restaurants,
  now = () => new Date(),
  pageSize = PAGE_SIZE,
  maxSourceRows = MAX_SOURCE_ROWS,
} = {}) {
  const page = Number.isInteger(pageSize) && pageSize > 0 ? pageSize : PAGE_SIZE;
  const cap = Number.isInteger(maxSourceRows) && maxSourceRows > 0 ? maxSourceRows : MAX_SOURCE_ROWS;

  function unavailable() {
    return { status: 503, body: { error: UNAVAILABLE_MESSAGE } };
  }

  /** Alle dag-rijen van de periode, in pagina's, of een fout. */
  async function readCounterRows(supabase, range) {
    const rows = [];
    for (let offset = 0; offset < cap; offset += page) {
      const { data, error } = await supabase
        .from(TABLE)
        .select(COLUMNS)
        .gte('day', range.van)
        .lte('day', range.tot)
        .order('day', { ascending: true })
        .order('dish_key', { ascending: true })
        .range(offset, offset + page - 1);
      if (error) return { error };
      const chunk = Array.isArray(data) ? data : [];
      rows.push(...chunk);
      if (chunk.length < page) break;
    }
    return { rows };
  }

  /** GET — de totalen en de tabel van precies deze periode. */
  async function getTellers(request) {
    const auth = await authenticate(request);
    if (!auth || !auth.ok) {
      return { status: (auth && auth.status) || 401, body: { error: (auth && auth.error) || 'Niet ingelogd.' } };
    }
    // Alleen de rol `internal` (contract criterium 1). Een editor of owner is
    // hier geen interne medewerker en krijgt geen enkele teller te zien.
    if (!isInternalOnly(auth.roles)) {
      return { status: 403, body: { error: FORBIDDEN_MESSAGE } };
    }

    const periode = normalizePeriod(periodFromRequest(request));
    const range = periodRange(periode, typeof now === 'function' ? now() : new Date());
    // Zonder bruikbare klok is er geen periode: dat is dezelfde foutstaat, geen crash.
    if (!range.van || !range.tot) return unavailable();

    let supabase;
    try {
      supabase = typeof getSupabase === 'function' ? getSupabase() : null;
    } catch (error) {
      // Geen sleutel of een kapotte configuratie: dezelfde nette foutstaat.
      return unavailable();
    }
    if (!supabase || typeof supabase.from !== 'function') return unavailable();

    let result;
    try {
      result = await readCounterRows(supabase, { van: range.van, tot: range.tot });
    } catch (error) {
      // Een netwerk- of clientfout is dezelfde nette foutstaat als een storing.
      return unavailable();
    }
    if (result.error) return unavailable();

    return {
      status: 200,
      body: buildTellersReport({ periode, rows: result.rows, menus, restaurants }),
    };
  }

  return { getTellers };
}

module.exports = {
  COLUMNS,
  MAX_SOURCE_ROWS,
  PAGE_SIZE,
  TABLE,
  createDishCounterReportHandlers,
  periodFromRequest,
  textOf,
};
