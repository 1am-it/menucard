// Issue #53 — pure task model behind the unified Werkvoorraad
// (/internal/workqueue). Deliberately CommonJS, same reasoning as
// internalNav.js/sourceWorkqueue.js/importInbox.js: directly testable via
// this project's existing `node --test` tooling, no new dependency.
//
// This module never touches Supabase, the network, the DOM or React. It
// turns the read-only payloads of the existing internal APIs into one list
// of concrete human tasks. Every task points at the exact existing record
// (or, where a legacy screen has no deep link yet, at an adapter query
// parameter that screen now understands). It grants no access: every
// provider keeps its own unchanged server-side authorization, and an actor
// without the provider's role gets none of its tasks.
//
// Duplicate handling follows the approved contract (revision 3,
// planning/specs/tickets/internal-task-flow-53.md):
//  - identical records (same stable id) are shown once;
//  - a ready source row and a menu concept for the same restaurant are the
//    same review step — the concrete concept record wins;
//  - an open source proposal replaces the generic source-check row for the
//    same restaurant, because deciding that proposal is the next step;
//  - distinct independent tasks (different records, restaurants or steps)
//    are never silently merged.

'use strict';

const { isInternalOnly } = require('./importInbox');
const { isEditorRole } = require('./internalNav');
const { ACTION_LABELS, SOURCE_LABELS, MENU_LABELS } = require('./sourceWorkqueue');
const { KIND_LABELS } = require('./sourceTriage');
const { formatFieldName } = require('./moderationFormatting');

// `role` is who may see the provider at all. `internal` and `editor` are
// separate staff roles; an account can have both. An owner has neither.
const WORKQUEUE_PROVIDERS = [
  { id: 'source-workqueue', label: 'Bronwerkvoorraad', role: 'internal' },
  { id: 'source-triage', label: 'Brontriage', role: 'internal' },
  { id: 'menu-concepts', label: 'Menuconcepten', role: 'internal' },
  { id: 'profile-drafts', label: 'Profielconcepten', role: 'internal' },
  { id: 'import-candidates', label: 'Importkandidaten', role: 'internal' },
  { id: 'moderation', label: 'Moderatie', role: 'editor' },
  { id: 'claims', label: 'Eigenaarsclaims', role: 'editor' },
];

// Lower shows first. A broken/unknown source or identity comes before
// reviewing extracted content; recorded decisions come before publication;
// editor-only trust decisions come last so they never hide daily work.
const PRIORITY = {
  source_identity: 0,
  source_check: 1,
  source_proposal: 2,
  menu_review: 3,
  candidate_review: 4,
  candidate_enrichment: 4,
  profile_draft: 5,
  candidate_draft: 6,
  menu_publication: 7,
  moderation_change: 8,
  owner_claim: 9,
};

const TASK_KINDS = Object.keys(PRIORITY);

/** Provider definitions the given roles may use. Pure; never grants access. */
function resolveWorkqueueProviders(roles) {
  const list = Array.isArray(roles) ? roles : [];
  const hasInternal = isInternalOnly(list);
  const hasEditor = isEditorRole(list);
  return WORKQUEUE_PROVIDERS.filter((p) => {
    if (p.role === 'internal') return hasInternal;
    if (p.role === 'editor') return hasEditor;
    return false;
  });
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asString(value) {
  return value === undefined || value === null ? '' : String(value);
}

function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function timeValue(value) {
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

function normalizeProviderResult(result) {
  if (!result || typeof result !== 'object') {
    return { ok: false, partial: false, data: null, error: 'Niet geladen.' };
  }
  return {
    ok: result.ok !== false,
    partial: Boolean(result.partial),
    data: result.data === undefined ? null : result.data,
    error: result.error || null,
  };
}

function menuConceptReason(item) {
  const blockers = Number(item.blockerCount) || 0;
  const attention = Number(item.attentionCount) || 0;
  if (blockers > 0) return `${plural(blockers, 'blokkade', 'blokkades')} voor goedkeuring`;
  if (attention > 0) return plural(attention, 'aandachtspunt', 'aandachtspunten');
  return `Versie ${item.version || '?'} wacht op interne beoordeling`;
}

function conceptSecondary(item) {
  const parts = [];
  if (Number.isFinite(Number(item.dishCount))) parts.push(plural(Number(item.dishCount), 'gerecht', 'gerechten'));
  if (item.menuContext) parts.push(String(item.menuContext));
  return parts.join(' · ') || null;
}

// An approved concept is only "Klaar voor publicatie" when its stored export
// says so. A merged export is live and is not a task; an opened/pending PR
// still needs the reviewer's attention; a failed/closed one needs inspection.
function publicationReason(exportRow) {
  const status = exportRow && exportRow.status;
  if (status === 'opened') return 'Review-PR open · merge in GitHub';
  if (status === 'pending') return 'Review-PR wordt aangemaakt';
  if (status === 'closed') return 'Review-PR gesloten · controleer de publicatie';
  if (status === 'failed') return 'Publicatie mislukt · controleer de oorzaak';
  // No stored export means readiness is simply unknown: never claim that an
  // approved concept is already "Klaar voor publicatie".
  return 'Intern goedgekeurd · publicatiestatus niet vastgesteld';
}

function publicationAction(exportRow) {
  const status = exportRow && exportRow.status;
  if (status === 'opened' || status === 'pending') return 'Bekijk publicatie';
  return 'Controleer publicatie';
}

function sourceTaskReason(row) {
  const source = SOURCE_LABELS[row.source] || null;
  const menu = MENU_LABELS[row.menu] || null;
  if (row.action === 'review' || row.action === 'review_manually') {
    return menu || source || 'Handmatige controle nodig';
  }
  return source || menu || 'Bron vraagt aandacht';
}

function candidateHref(candidate) {
  const run = candidate.import_run_id ? `run=${encodeURIComponent(candidate.import_run_id)}&` : '';
  const id = encodeURIComponent(asString(candidate.id));
  return `/internal/import-inbox?${run}candidate=${id}#candidate-${id}`;
}

function candidateSecondary(candidate) {
  const fields = candidate.extracted_fields || {};
  const missing = asArray(candidate.missing_fields).filter(Boolean);
  if (candidate.quality_status === 'incomplete' && missing.length > 0) {
    return `Ontbrekend: ${missing.join(', ')}`;
  }
  const parts = [];
  if (fields.category) parts.push(String(fields.category));
  if (fields.address) parts.push(String(fields.address));
  return parts.join(' · ') || null;
}

function candidateTask(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  const id = asString(candidate.id);
  if (!id) return null;
  const name = (candidate.extracted_fields && candidate.extracted_fields.name) || 'Naam onbekend';
  const status = candidate.review_status;

  if (status === 'new') {
    return {
      id: `candidate:${id}`,
      kind: 'candidate_review',
      provider: 'import-candidates',
      restaurantId: null,
      restaurantName: name,
      title: 'Importkandidaat beoordelen',
      reason: candidate.possible_duplicate ? 'Mogelijk duplicaat · nog niet beoordeeld' : 'Nog niet beoordeeld',
      secondary: candidateSecondary(candidate),
      actionLabel: 'Open kandidaat',
      href: candidateHref(candidate),
      priority: PRIORITY.candidate_review,
      recordedAt: candidate.created_at || null,
      requiredRole: 'internal',
    };
  }

  if (status === 'needs_enrichment') {
    const missing = asArray(candidate.missing_fields).filter(Boolean);
    return {
      id: `candidate:${id}`,
      kind: 'candidate_enrichment',
      provider: 'import-candidates',
      restaurantId: null,
      restaurantName: name,
      title: 'Importkandidaat aanvullen',
      reason: missing.length > 0 ? `Ontbrekende gegevens: ${missing.join(', ')}` : 'Aanvulling nodig',
      secondary: candidateSecondary(candidate),
      actionLabel: 'Open kandidaat',
      href: candidateHref(candidate),
      priority: PRIORITY.candidate_enrichment,
      recordedAt: candidate.created_at || null,
      requiredRole: 'internal',
    };
  }

  // An approved internal candidate still needs an explicit profile draft.
  // A candidate that already has an active draft is covered by that draft's
  // own task instead — never two tasks for one next step.
  if (status === 'approved_internal' && !candidate.profile_draft) {
    return {
      id: `candidate:${id}`,
      kind: 'candidate_draft',
      provider: 'import-candidates',
      restaurantId: null,
      restaurantName: name,
      title: 'Profielconcept aanmaken',
      reason: 'Intern goedgekeurd · nog geen profielconcept',
      secondary: candidateSecondary(candidate),
      actionLabel: 'Open kandidaat',
      href: candidateHref(candidate),
      priority: PRIORITY.candidate_draft,
      recordedAt: candidate.created_at || null,
      requiredRole: 'internal',
    };
  }

  return null;
}

/**
 * Builds the unified task list and an honest provider status report.
 *
 * `roles` is the same `{ role, restaurant_id }[]` shape the internal APIs
 * resolve. `providers` maps provider id -> `{ ok, data, error, partial }`:
 * a failed provider contributes no tasks and is reported, never treated as
 * "no work"; `partial: true` means the provider answered but part of its
 * data was unavailable (e.g. proposal storage), so the list is incomplete.
 */
function buildWorkqueue({ roles, providers } = {}) {
  const roleList = Array.isArray(roles) ? roles : [];
  const providerMap = providers && typeof providers === 'object' ? providers : {};
  const hasInternal = isInternalOnly(roleList);
  const hasEditor = isEditorRole(roleList);
  const applicable = resolveWorkqueueProviders(roleList);
  const summaries = applicable.map((definition) => {
    const result = normalizeProviderResult(providerMap[definition.id]);
    return {
      id: definition.id,
      label: definition.label,
      role: definition.role,
      ok: result.ok,
      partial: result.partial,
      error: result.error,
      count: 0,
    };
  });
  const summaryById = new Map(summaries.map((s) => [s.id, s]));

  const tasksById = new Map();
  let duplicateCount = 0;

  function add(task) {
    if (!task || !task.id) return;
    if (tasksById.has(task.id)) {
      duplicateCount += 1;
      return;
    }
    tasksById.set(task.id, task);
  }

  const conceptRestaurantIds = new Set();
  const proposalRestaurantIds = new Set();

  // Menu concepts — the latest version per restaurant/menu_context.
  const conceptData = normalizeProviderResult(providerMap['menu-concepts']);
  for (const item of asArray(conceptData.data && conceptData.data.items)) {
    if (!item || !item.id) continue;
    if (item.status !== 'waiting' && item.status !== 'approved') continue;
    const restaurantId = asString(item.restaurantId);
    if (restaurantId) conceptRestaurantIds.add(restaurantId);
    const approved = item.status === 'approved';
    const exportRow = item.export && typeof item.export === 'object' ? item.export : null;
    const publication = item.publication && typeof item.publication === 'object' ? item.publication : null;
    // A merged export is the live menu: not open work. Its concept still
    // suppresses a stale generic review row for the same restaurant.
    if (approved && ((publication && publication.state === 'export_merged') || (exportRow && exportRow.status === 'merged'))) continue;

    let title = approved ? 'Goedgekeurd menuconcept' : 'Nieuwe menukaart';
    let reason = approved ? publicationReason(exportRow) : menuConceptReason(item);
    let actionLabel = approved ? publicationAction(exportRow) : 'Controleer menukaart';
    // `Klaar voor publicatie`/`Publiceren` only when the server-derived
    // readiness rule proved every existing gate. A missing publication object
    // stays an explicit "Controleer publicatie", never an optimistic claim.
    if (approved && publication) {
      if (publication.state === 'ready') {
        title = 'Klaar voor publicatie';
        reason = 'Alle bestaande controles zijn geslaagd';
        actionLabel = 'Publiceren';
      } else if (publication.state === 'blocked') {
        title = 'Nog niet klaar voor publicatie';
        reason = asArray(publication.reasons).filter(Boolean).join(' · ') || publication.label || 'Controleer het concept';
        actionLabel = 'Controleer concept';
      } else if (publication.state === 'export_active') {
        title = 'Review-PR open';
        reason = publication.label || publicationReason(exportRow);
        actionLabel = 'Bekijk publicatie';
      } else if (publication.state === 'export_attention') {
        title = 'Publicatie controleren';
        reason = publication.label || publicationReason(exportRow);
        actionLabel = 'Controleer publicatie';
      }
    }

    add({
      id: `menu-concept:${asString(item.id)}`,
      kind: approved ? 'menu_publication' : 'menu_review',
      provider: 'menu-concepts',
      restaurantId: restaurantId || null,
      restaurantName: item.restaurantName || `Restaurant ${restaurantId}`,
      title,
      reason,
      secondary: conceptSecondary(item),
      actionLabel,
      // Open the exact concept's existing publication controls.
      href: `/internal/menu-concepts/${encodeURIComponent(asString(item.id))}#mcr-publication`,
      priority: approved ? PRIORITY.menu_publication : PRIORITY.menu_review,
      recordedAt: (exportRow && exportRow.createdAt) || item.createdAt || null,
      requiredRole: 'internal',
    });
  }

  // Open source proposals are concrete pending decisions. Only an `open`
  // proposal is human work; decided proposals are history.
  const triageData = normalizeProviderResult(providerMap['source-triage']);
  for (const entry of asArray(triageData.data && triageData.data.restaurants)) {
    if (!entry) continue;
    const open = asArray(entry.proposals).find((p) => p && p.status === 'open') || null;
    const proposalId = open ? open.id : entry.open_proposal_id;
    if (!proposalId) continue;
    const restaurantId = asString(entry.restaurant_id);
    if (restaurantId) proposalRestaurantIds.add(restaurantId);
    const kindLabel = open && KIND_LABELS[open.kind] ? KIND_LABELS[open.kind] : 'Bronvoorstel';
    add({
      id: `source-proposal:${asString(proposalId)}`,
      kind: 'source_proposal',
      provider: 'source-triage',
      restaurantId: restaurantId || null,
      restaurantName: entry.name || `Restaurant ${restaurantId}`,
      title: 'Bronvoorstel',
      reason: `Voorstel: ${kindLabel}`,
      secondary: entry.domain || null,
      actionLabel: 'Beoordeel voorstel',
      href: `/internal/source-triage?restaurant=${encodeURIComponent(restaurantId)}`,
      priority: PRIORITY.source_proposal,
      recordedAt: (open && open.proposed_at) || entry.checked_at || null,
      requiredRole: 'internal',
    });
  }

  // Source workqueue rows. Generic review rows for a restaurant that already
  // has a concrete menu concept are suppressed (same next step); generic
  // source rows are suppressed while an open proposal is the pending
  // decision. A source problem next to a menu review stays independent.
  const workqueueData = normalizeProviderResult(providerMap['source-workqueue']);
  for (const row of asArray(workqueueData.data && workqueueData.data.rows)) {
    if (!row || !row.restaurant_id) continue;
    const restaurantId = asString(row.restaurant_id);
    const isReviewRow = row.action === 'review' || row.action === 'review_manually';
    if (isReviewRow && conceptRestaurantIds.has(restaurantId)) continue;
    // An open proposal replaces the generic source-check step, but never an
    // identity question: deciding a source URL does not establish which
    // restaurant an ambiguous source belongs to. That is independent work.
    if (!isReviewRow && row.queue !== 'identity' && proposalRestaurantIds.has(restaurantId)) continue;
    if (!ACTION_LABELS[row.action]) continue;
    const identity = row.queue === 'identity';
    add({
      id: `source-workqueue:${restaurantId}`,
      kind: identity ? 'source_identity' : isReviewRow ? 'menu_review' : 'source_check',
      provider: 'source-workqueue',
      restaurantId,
      restaurantName: row.name || `Restaurant ${restaurantId}`,
      title: identity ? 'Identiteit controleren' : isReviewRow ? 'Menukaart controleren' : 'Broncontrole',
      reason: sourceTaskReason(row),
      secondary: row.domain || null,
      actionLabel: ACTION_LABELS[row.action],
      href: `/internal/source-workqueue?restaurant=${encodeURIComponent(restaurantId)}`,
      priority: identity ? PRIORITY.source_identity : isReviewRow ? PRIORITY.menu_review : PRIORITY.source_check,
      recordedAt: row.checked_at || null,
      requiredRole: 'internal',
    });
  }

  // Import candidates awaiting a human decision or a profile draft.
  const candidateData = normalizeProviderResult(providerMap['import-candidates']);
  for (const candidate of asArray(candidateData.data && candidateData.data.candidates)) {
    add(candidateTask(candidate));
  }

  // Prepared profile drafts are genuine open internal work; history stays
  // out of the daily list.
  const draftData = normalizeProviderResult(providerMap['profile-drafts']);
  for (const draft of asArray(draftData.data && draftData.data.drafts)) {
    if (!draft || !draft.id || draft.status !== 'draft') continue;
    add({
      id: `profile-draft:${asString(draft.id)}`,
      kind: 'profile_draft',
      provider: 'profile-drafts',
      restaurantId: null,
      restaurantName: draft.candidate_name || 'Naam onbekend',
      title: 'Profielconcept controleren',
      reason: 'Klaargezet · nog niet gepubliceerd',
      secondary: draft.possible_duplicate_of ? 'Mogelijk duplicaat · apart beoordelen' : null,
      actionLabel: 'Bekijk profielconcept',
      href: `/internal/profile-drafts#draft-${encodeURIComponent(asString(draft.id))}`,
      priority: PRIORITY.profile_draft,
      recordedAt: draft.promoted_at || null,
      requiredRole: 'internal',
    });
  }

  // Editor-only item-level trust decisions.
  const moderationData = normalizeProviderResult(providerMap.moderation);
  for (const item of asArray(moderationData.data && moderationData.data.items)) {
    const pending = item && item.pending;
    if (!pending || !pending.id) continue;
    const restaurantId = asString(pending.restaurant_id);
    add({
      id: `moderation:${asString(pending.id)}`,
      kind: 'moderation_change',
      provider: 'moderation',
      restaurantId: restaurantId || null,
      restaurantName: item.restaurantName || `Restaurant ${restaurantId}`,
      title: 'Voorgestelde wijziging',
      reason: formatFieldName(pending.field_name) || 'Wijziging beoordelen',
      secondary: pending.field_ref ? String(pending.field_ref) : null,
      actionLabel: 'Beoordeel wijziging',
      href: `/internal/moderation#pending-${encodeURIComponent(asString(pending.id))}`,
      priority: PRIORITY.moderation_change,
      recordedAt: pending.created_at || null,
      requiredRole: 'editor',
    });
  }

  const claimsData = normalizeProviderResult(providerMap.claims);
  for (const item of asArray(claimsData.data && claimsData.data.items)) {
    const claim = item && item.claim;
    if (!claim || !claim.id) continue;
    const restaurantId = asString(claim.restaurant_id);
    add({
      id: `claim:${asString(claim.id)}`,
      kind: 'owner_claim',
      provider: 'claims',
      restaurantId: restaurantId || null,
      restaurantName: item.restaurantName || `Restaurant ${restaurantId}`,
      title: 'Eigenaarsclaim',
      reason: item.hasExistingOwner ? 'Nieuwe claim · er is al een eigenaar gekoppeld' : 'Nieuwe eigenaarsclaim beoordelen',
      secondary: item.restaurantWebsite || null,
      actionLabel: 'Beoordeel claim',
      href: `/internal/moderation#claim-${encodeURIComponent(asString(claim.id))}`,
      priority: PRIORITY.owner_claim,
      recordedAt: claim.created_at || null,
      requiredRole: 'editor',
    });
  }

  const tasks = [...tasksById.values()]
    .filter((task) => (task.requiredRole === 'internal' ? hasInternal : task.requiredRole === 'editor' ? hasEditor : false))
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        timeValue(a.recordedAt) - timeValue(b.recordedAt) ||
        String(a.restaurantName).localeCompare(String(b.restaurantName), 'nl', { sensitivity: 'base' }) ||
        a.id.localeCompare(b.id)
    );

  const byProvider = {};
  const byKind = {};
  for (const summary of summaries) byProvider[summary.id] = 0;
  for (const task of tasks) {
    byProvider[task.provider] = (byProvider[task.provider] || 0) + 1;
    byKind[task.kind] = (byKind[task.kind] || 0) + 1;
    const summary = summaryById.get(task.provider);
    if (summary) summary.count += 1;
  }

  const loaded = summaries.filter((s) => s.ok && !s.partial);
  const incomplete = summaries.filter((s) => !s.ok || s.partial);
  const allFailed = incomplete.length > 0 && loaded.length === 0;
  let status = 'empty';
  if (tasks.length > 0) status = incomplete.length > 0 ? 'partial' : 'ready';
  else if (incomplete.length > 0) status = allFailed ? 'error' : 'partial';

  return {
    tasks,
    providers: summaries,
    counts: { total: tasks.length, byProvider, byKind },
    duplicateCount,
    status,
    incompleteProviders: incomplete.map((s) => ({ id: s.id, label: s.label, error: s.error, partial: s.partial })),
  };
}

module.exports = {
  WORKQUEUE_PROVIDERS,
  TASK_KINDS,
  PRIORITY,
  resolveWorkqueueProviders,
  buildWorkqueue,
};
