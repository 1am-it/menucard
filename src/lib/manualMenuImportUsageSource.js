'use strict';

// #59 K1/K2/K3 (Lead-bevinding F6) — de enige leesroute naar duurzame
// gebruiksgegevens: opgeslagen conceptversies met een handmatige AI-herkomst.
//
// Dit module doet **alleen** `select`: geen insert, geen update, geen delete en
// geen migratie. De filter gebeurt in de database op het JSON-pad, zodat een
// grote concepttabel niet eerst volledig naar de app wordt gehaald. Dezelfde
// functie bedient de interne GET (app) en het ops-exportscript, zodat beide
// gegarandeerd hetzelfde document uit dezelfde bron opleveren.
//
// De rijlimiet is een vaste bovengrens en wordt doorgegeven aan het
// exportdocument: raakt de leesactie de grens, dan staat er `bounded: true` en
// nooit een stilzwijgend afgekapt totaal.

const { MAX_SOURCE_ROWS, PROVENANCE_KIND } = require('./manualMenuImportUsage');
const { AI_READ_PROVENANCE_KIND } = require('./menuAiImport');

const CONCEPT_TABLE = 'menu_snapshot_proposals';
const CONCEPT_COLUMNS = 'id, created_at, captured_content';
const PROVENANCE_KIND_PATH = 'captured_content->importProvenance->>kind';

/**
 * Leest de conceptrijen met een handmatige AI-importherkomst, oud naar nieuw.
 * `supabase` is een bestaande client; dit module maakt er zelf geen en kent geen
 * netwerk buiten die client.
 */
async function readRowsOfKind(supabase, kind, limit) {
  const { data, error } = await supabase
    .from(CONCEPT_TABLE)
    .select(CONCEPT_COLUMNS)
    .eq(PROVENANCE_KIND_PATH, kind)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) return { ok: false, code: 'read_failed' };
  const rows = Array.isArray(data) ? data : [];
  return { ok: true, rows, bounded: rows.length >= limit };
}

/**
 * W7: beide soorten AI-herkomst in één document — de handmatige import en de
 * lezing door de app zelf ("Gelezen door AI"). Twee gewone select-query's op
 * dezelfde kolom (geen `in` op een JSON-pad), daarna samengevoegd op tijd.
 * Elke rij wordt bij het bouwen van het document nog eens op zijn `kind`
 * gecontroleerd, zodat een andere herkomst nooit meetelt.
 */
async function readDurableUsageRows(supabase, { limit = MAX_SOURCE_ROWS } = {}) {
  if (!supabase || typeof supabase.from !== 'function') return { ok: false, code: 'no_client' };
  const effectiveLimit = Number.isInteger(limit) && limit > 0 ? limit : MAX_SOURCE_ROWS;
  const manual = await readRowsOfKind(supabase, PROVENANCE_KIND, effectiveLimit);
  if (!manual.ok) return manual;
  const remaining = Math.max(0, effectiveLimit - manual.rows.length);
  const aiRead = remaining > 0 ? await readRowsOfKind(supabase, AI_READ_PROVENANCE_KIND, remaining) : { ok: true, rows: [], bounded: false };
  if (!aiRead.ok) return aiRead;
  const rows = [...manual.rows, ...aiRead.rows].sort((a, b) => String(a && a.created_at).localeCompare(String(b && b.created_at)));
  return { ok: true, rows, limit: effectiveLimit, bounded: manual.bounded || aiRead.bounded };
}

/**
 * Leest de conceptrijen van een AI-lezing ("Gelezen door AI"), oud naar nieuw.
 * Alleen `select`: geen insert, update, delete of migratie. Dezelfde bron als
 * het gebruiksdocument, zodat het maandbudget uit duurzame concepten volgt.
 */
async function readDurableAiReadRows(supabase, { since = null, limit = MAX_SOURCE_ROWS } = {}) {
  if (!supabase || typeof supabase.from !== 'function') return { ok: false, code: 'no_client' };
  const effectiveLimit = Number.isInteger(limit) && limit > 0 ? limit : MAX_SOURCE_ROWS;
  let query = supabase
    .from(CONCEPT_TABLE)
    .select(CONCEPT_COLUMNS)
    .eq(PROVENANCE_KIND_PATH, AI_READ_PROVENANCE_KIND);
  if (typeof since === 'string' && since !== '') query = query.gte('created_at', since);
  const { data, error } = await query.order('created_at', { ascending: true }).limit(effectiveLimit);
  if (error) return { ok: false, code: 'read_failed' };
  const rows = Array.isArray(data) ? data : [];
  return { ok: true, rows, limit: effectiveLimit, bounded: rows.length >= effectiveLimit };
}

module.exports = { CONCEPT_TABLE, CONCEPT_COLUMNS, PROVENANCE_KIND_PATH, readDurableUsageRows, readDurableAiReadRows };
