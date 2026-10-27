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
const { adviceCostRow, ADVICE_KIND } = require('./menuStructureAdvice');
const { parseProposalNote } = require('./sourceDiscovery');

const CONCEPT_TABLE = 'menu_snapshot_proposals';
const CONCEPT_COLUMNS = 'id, created_at, captured_content';
const PROVENANCE_KIND_PATH = 'captured_content->importProvenance->>kind';
// BE-30 (#72): een AI-advies woont in de bestaande jobrij; dezelfde teller leest
// hem daar, zodat het maandbudget één geheel blijft.
const JOB_TABLE = 'restaurant_source_analysis_jobs';
const ADVICE_COLUMNS = 'id, structure_advice:field_evidence->structureAdvice';
const ADVICE_KIND_PATH = 'field_evidence->structureAdvice->>kind';
// BE-32 (#75): het bestaande BE-24-voorstel waar de vindmotor de gemeten
// AI-kosten in schrijft (`Herkomst: … · kosten: N cent`). Alleen lezen.
const PROPOSAL_TABLE = 'source_triage_proposals';
const PROPOSAL_COLUMNS = 'id, proposed_at, note';
const DISCOVERY_NOTE_PREFIX = 'Herkomst:';
const DISCOVERY_KIND = 'source_discovery';

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

/**
 * BE-30 (#72): de duurzame advieskosten, als dezelfde vorm als een AI-leesrij,
 * zodat `monthlySpendFromRows` ze zonder uitzondering meetelt in het ene
 * maandbudget. Alleen `select`: geen insert, update of delete.
 */
async function readDurableStructureAdviceRows(supabase, { limit = MAX_SOURCE_ROWS } = {}) {
  if (!supabase || typeof supabase.from !== 'function') return { ok: false, code: 'no_client' };
  const effectiveLimit = Number.isInteger(limit) && limit > 0 ? limit : MAX_SOURCE_ROWS;
  const { data, error } = await supabase
    .from(JOB_TABLE)
    .select(ADVICE_COLUMNS)
    .eq(ADVICE_KIND_PATH, ADVICE_KIND)
    .order('id', { ascending: true })
    .limit(effectiveLimit);
  if (error) return { ok: false, code: 'read_failed' };
  const rows = [];
  for (const row of Array.isArray(data) ? data : []) {
    const costRow = adviceCostRow(row && row.structure_advice);
    if (costRow) rows.push(costRow);
  }
  return { ok: true, rows, limit: effectiveLimit, bounded: Array.isArray(data) && data.length >= effectiveLimit };
}

/**
 * BE-32 (#75): de duurzame AI-kosten van "Vind bronnen" en "Zoek de bron voor
 * mij". De motor schrijft de gemeten kosten in het `note`-veld van het bestaande
 * BE-24-voorstel (`Herkomst: … · kosten: N cent`); deze leesfunctie zet ze om
 * naar dezelfde kostenrijvorm als een AI-lezing, zodat het ene maandbudget van
 * 1000 cent ze zonder uitzondering meetelt. Alleen `select`: geen insert, geen
 * update, geen migratie en geen nieuwe tabel.
 */
async function readDurableSourceDiscoveryRows(supabase, { limit = MAX_SOURCE_ROWS } = {}) {
  if (!supabase || typeof supabase.from !== 'function') return { ok: false, code: 'no_client' };
  const effectiveLimit = Number.isInteger(limit) && limit > 0 ? limit : MAX_SOURCE_ROWS;
  const { data, error } = await supabase
    .from(PROPOSAL_TABLE)
    .select(PROPOSAL_COLUMNS)
    .like('note', `${DISCOVERY_NOTE_PREFIX}%`)
    .order('proposed_at', { ascending: true })
    .limit(effectiveLimit);
  if (error) return { ok: false, code: 'read_failed' };
  const rows = [];
  for (const row of Array.isArray(data) ? data : []) {
    const parsed = parseProposalNote(row && row.note);
    if (!Number.isInteger(parsed.costEurCents) || parsed.costEurCents < 0) continue;
    rows.push({
      id: row.id,
      created_at: row.proposed_at,
      captured_content: {
        importProvenance: {
          kind: DISCOVERY_KIND,
          // One proposal is one paid run: the ledger counts its cost once.
          readId: `source-discovery:${row.id}`,
          cost: { eurCents: parsed.costEurCents, known: true },
        },
      },
    });
  }
  return { ok: true, rows, limit: effectiveLimit, bounded: Array.isArray(data) && data.length >= effectiveLimit };
}

/**
 * Beide duurzame AI-kostenbronnen in één lijst: de AI-lezingen (conceptrijen) en
 * de AI-adviezen (jobrijen). Eén teller, één plafond van 1000 cent per maand.
 */
async function readAllAiUsageRows(supabase, options = {}) {
  const concept = await readDurableAiReadRows(supabase, options);
  if (!concept.ok) return concept;
  const advice = await readDurableStructureAdviceRows(supabase, options);
  if (!advice.ok) return advice;
  const discovery = await readDurableSourceDiscoveryRows(supabase, options);
  if (!discovery.ok) return discovery;
  return {
    ok: true,
    rows: [...concept.rows, ...advice.rows, ...discovery.rows],
    limit: concept.limit,
    bounded: Boolean(concept.bounded || advice.bounded || discovery.bounded),
  };
}

module.exports = {
  CONCEPT_TABLE,
  CONCEPT_COLUMNS,
  PROVENANCE_KIND_PATH,
  PROPOSAL_TABLE,
  DISCOVERY_KIND,
  DISCOVERY_NOTE_PREFIX,
  readDurableUsageRows,
  readDurableAiReadRows,
  readDurableStructureAdviceRows,
  readDurableSourceDiscoveryRows,
  readAllAiUsageRows,
};
