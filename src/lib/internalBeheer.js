// Issue #53 — pure view models behind Beheer (/internal). Deliberately
// CommonJS, same reasoning as internalWorkqueue.js: directly testable with
// the project's existing `node --test` tooling, no new dependency.
//
// Beheer is four views over existing capabilities, not a new backend:
//   Overzicht              existing coverage data
//   Restaurants en bronnen existing source-triage restaurant/source records
//   Importhistorie         existing URL batches + existing dataset import runs
//   Concepten en besluiten existing concept versions, source decisions and
//                          profile-draft history
//
// These functions only reshape already-fetched read-only payloads. They
// never write, never invent a record, never derive publication readiness
// from an approval alone, and never become a second daily workqueue.

'use strict';

const { sortByMenuDataGap } = require('./coveragePriority');
const { SOURCE_LABELS, MENU_LABELS, NOT_IN_QUEUE_LABELS } = require('./sourceWorkqueue');
const { KIND_LABELS, STATUS_LABELS, NEXT_STEP_LABELS } = require('./sourceTriage');

const BEHEER_SECTIONS = [
  { id: 'overview', label: 'Overzicht', href: '/internal' },
  { id: 'restaurants', label: 'Restaurants en bronnen', href: '/internal?section=restaurants' },
  { id: 'imports', label: 'Importhistorie', href: '/internal?section=imports' },
  { id: 'decisions', label: 'Concepten en besluiten', href: '/internal?section=decisions' },
];

function sectionFromSearch(search) {
  const requested = new URLSearchParams(typeof search === 'string' ? search : '').get('section');
  return BEHEER_SECTIONS.some((section) => section.id === requested) ? requested : 'overview';
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function timeValue(value) {
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function textOrNull(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function idString(value) {
  return value === undefined || value === null ? '' : String(value);
}

function buildOverviewModel(data) {
  if (!data || typeof data !== 'object' || !data.metrics || typeof data.metrics !== 'object') return null;
  const metrics = data.metrics;
  const menu = metrics.menuData || {};
  const metricRows = [
    { id: 'basicInfo', label: 'Restaurantgegevens' },
    { id: 'menuData', label: 'Menukaartgegevens' },
    { id: 'priceCoverage', label: 'Gerechten met prijs' },
    { id: 'reservationConfirmed', label: 'Reserveringskanaal bevestigd' },
  ].map((row) => {
    const value = metrics[row.id] || {};
    return {
      ...row,
      count: numberOrNull(value.count) || 0,
      total: numberOrNull(value.total) || 0,
      pct: numberOrNull(value.pct),
    };
  });
  return {
    city: textOrNull(data.city) || 'Breda',
    menu: metricRows.find((row) => row.id === 'menuData'),
    metrics: metricRows,
    priorityRows: sortByMenuDataGap(asArray(data.byBuurt)),
    totalRestaurants: numberOrNull(menu.total) || 0,
  };
}

function shapeProposal(proposal) {
  if (!proposal || typeof proposal !== 'object' || !proposal.id) return null;
  return {
    id: idString(proposal.id),
    status: proposal.status || null,
    statusLabel: STATUS_LABELS[proposal.status] || proposal.status || 'Onbekend',
    kind: proposal.kind || null,
    kindLabel: KIND_LABELS[proposal.kind] || proposal.kind || 'Bronvoorstel',
    proposedAt: proposal.proposed_at || null,
    decidedAt: proposal.decided_at || null,
    decisionNote: textOrNull(proposal.decision_note),
    note: textOrNull(proposal.note),
  };
}

function buildRestaurantView(data) {
  const entries = asArray(data && data.restaurants);
  const proposalsAvailable = Boolean(data && data.proposals_available);
  const rows = entries
    .map((entry) => {
      if (!entry) return null;
      const id = idString(entry.restaurant_id);
      if (!id) return null;
      const proposals = asArray(entry.proposals)
        .map(shapeProposal)
        .filter(Boolean)
        .sort((a, b) => timeValue(b.proposedAt) - timeValue(a.proposedAt));
      return {
        id,
        name: textOrNull(entry.name) || `Restaurant ${id}`,
        wijk: textOrNull(entry.wijk),
        domain: textOrNull(entry.domain),
        knownUrl: textOrNull(entry.known_url),
        source: entry.source || null,
        sourceLabel: SOURCE_LABELS[entry.source] || null,
        menu: entry.menu || null,
        menuLabel: MENU_LABELS[entry.menu] || null,
        attention: textOrNull(entry.attention),
        checkedAt: entry.checked_at || null,
        notInQueueReason: entry.not_in_queue_reason || null,
        notInQueueLabel: NOT_IN_QUEUE_LABELS[entry.not_in_queue_reason] || null,
        nextStep: entry.next_step || null,
        nextStepLabel: NEXT_STEP_LABELS[entry.next_step] || null,
        openProposal: proposals.find((proposal) => proposal.status === 'open') || null,
        proposals,
        triageHref: `/internal/source-triage?restaurant=${encodeURIComponent(id)}`,
        workqueueHref: `/internal/source-workqueue?restaurant=${encodeURIComponent(id)}`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, 'nl', { sensitivity: 'base' }));
  return {
    rows,
    proposalsAvailable,
    total: rows.length,
    openProposalCount: rows.filter((row) => row.openProposal).length,
  };
}

const RUN_STATUS_LABELS = {
  succeeded: 'Verwerkt',
  failed: 'Mislukt',
  partial: 'Gedeeltelijk verwerkt',
  running: 'Loopt nog',
};

function batchStatus(batch) {
  if (!batch || typeof batch !== 'object') return { id: 'unknown', label: 'Onbekend' };
  if (!batch.closed_at) return { id: 'open', label: 'Open' };
  if (batch.close_reason === 'expired') return { id: 'expired', label: 'Verlopen' };
  return { id: 'closed', label: 'Afgesloten' };
}

function buildImportHistoryView({ batchData, runsData, batchOk = false, runsOk = false } = {}) {
  const urlBatches = asArray(batchData && batchData.recent_batches)
    .map((batch) => {
      if (!batch || !batch.id) return null;
      const status = batchStatus(batch);
      return {
        id: idString(batch.id),
        createdAt: batch.created_at || null,
        closedAt: batch.closed_at || null,
        closeReason: batch.close_reason || null,
        itemCount: numberOrNull(batch.item_count) || 0,
        status: status.id,
        statusLabel: status.label,
        isOwn: Boolean(batch.is_own),
        href: `/internal/nieuwe-import?batch=${encodeURIComponent(idString(batch.id))}`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt));

  const datasetRuns = asArray(runsData && runsData.runs)
    .map((run) => {
      if (!run || !run.id) return null;
      return {
        id: idString(run.id),
        status: run.status || null,
        statusLabel: RUN_STATUS_LABELS[run.status] || run.status || 'Onbekend',
        startedAt: run.started_at || null,
        completedAt: run.completed_at || null,
        durationSeconds: numberOrNull(run.duration_seconds),
        recordCounts: run.record_counts && typeof run.record_counts === 'object' ? run.record_counts : null,
        errorLog: asArray(run.error_log),
        sourceName: textOrNull(run.data_origin_source_name),
        sourceLocator: textOrNull(run.source_locator),
        accessProviderName: textOrNull(run.access_provider_source_name),
        href: `/internal/import-inbox?run=${encodeURIComponent(idString(run.id))}`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => timeValue(b.startedAt) - timeValue(a.startedAt));

  const failed = [batchOk, runsOk].filter((ok) => !ok).length;
  const total = urlBatches.length + datasetRuns.length;
  let status = 'ready';
  if (failed === 2) status = 'error';
  else if (failed === 1) status = 'partial';
  else if (total === 0) status = 'empty';

  return {
    urlBatches,
    datasetRuns,
    counts: { urlBatches: urlBatches.length, datasetRuns: datasetRuns.length, total },
    status,
    providers: {
      batches: { ok: batchOk },
      runs: { ok: runsOk },
    },
  };
}

const CONCEPT_STATUS_LABELS = {
  waiting: 'Wacht op beoordeling',
  approved: 'Intern goedgekeurd',
  rejected: 'Afgewezen',
};

// Never a readiness claim: an approval alone does not prove that the
// source/blocker/version/integration checks passed, and this view does not
// re-run them. Only the stored export row is shown, with its real status.
const EXPORT_LABELS = {
  merged: 'PR gemerged · live na productiedeployment',
  opened: 'Review-PR open · nog niet gemerged',
  pending: 'Review-PR wordt aangemaakt',
  failed: 'Publicatie mislukt',
  closed: 'Review-PR gesloten',
};

const DRAFT_STATUS_LABELS = {
  draft: 'Actief profielconcept',
  discarded: 'Verworpen profielconcept',
};

function buildDecisionView({
  conceptsData,
  triageData,
  draftsData,
  conceptsOk = false,
  triageOk = false,
  draftsOk = false,
} = {}) {
  const menuConcepts = asArray(conceptsData && conceptsData.items)
    .map((item) => {
      if (!item || !item.id) return null;
      const exportStatus = item.export && item.export.status ? item.export.status : null;
      return {
        id: idString(item.id),
        restaurantId: idString(item.restaurantId) || null,
        restaurantName: textOrNull(item.restaurantName) || 'Naam onbekend',
        version: numberOrNull(item.version),
        menuContext: textOrNull(item.menuContext),
        status: item.status || null,
        statusLabel: CONCEPT_STATUS_LABELS[item.status] || item.status || 'Onbekend',
        createdAt: item.createdAt || null,
        exportStatus,
        exportLabel: exportStatus ? EXPORT_LABELS[exportStatus] || exportStatus : 'Geen publicatie gestart',
        href: `/internal/menu-concepts/${encodeURIComponent(idString(item.id))}`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt));

  const sourceDecisions = asArray(triageData && triageData.restaurants)
    .flatMap((entry) => {
      if (!entry) return [];
      const restaurantId = idString(entry.restaurant_id);
      const restaurantName = textOrNull(entry.name) || `Restaurant ${restaurantId}`;
      return asArray(entry.proposals)
        .filter((proposal) => proposal && (proposal.status === 'accepted' || proposal.status === 'rejected'))
        .map((proposal) => ({
          id: idString(proposal.id),
          restaurantId,
          restaurantName,
          kindLabel: KIND_LABELS[proposal.kind] || proposal.kind || 'Bronvoorstel',
          status: proposal.status,
          statusLabel: STATUS_LABELS[proposal.status] || proposal.status,
          proposedAt: proposal.proposed_at || null,
          decidedAt: proposal.decided_at || null,
          decisionNote: textOrNull(proposal.decision_note),
          href: `/internal/source-triage?restaurant=${encodeURIComponent(restaurantId)}`,
        }));
    })
    .filter((decision) => decision.id)
    .sort((a, b) => timeValue(b.decidedAt) - timeValue(a.decidedAt) || timeValue(b.proposedAt) - timeValue(a.proposedAt));

  const profileDrafts = asArray(draftsData && draftsData.drafts)
    .map((draft) => {
      if (!draft || !draft.id) return null;
      return {
        id: idString(draft.id),
        status: draft.status || null,
        statusLabel: DRAFT_STATUS_LABELS[draft.status] || draft.status || 'Onbekend',
        candidateName: textOrNull(draft.candidate_name) || 'Naam onbekend',
        promotedAt: draft.promoted_at || null,
        discardedAt: draft.discarded_at || null,
        discardNote: textOrNull(draft.discard_note),
        href: `/internal/profile-drafts#draft-${encodeURIComponent(idString(draft.id))}`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => timeValue(b.promotedAt) - timeValue(a.promotedAt));

  const failed = [conceptsOk, triageOk, draftsOk].filter((ok) => !ok).length;
  const total = menuConcepts.length + sourceDecisions.length + profileDrafts.length;
  let status = 'ready';
  if (failed === 3) status = 'error';
  else if (failed > 0) status = 'partial';
  else if (total === 0) status = 'empty';

  return {
    menuConcepts,
    sourceDecisions,
    profileDrafts,
    counts: {
      menuConcepts: menuConcepts.length,
      sourceDecisions: sourceDecisions.length,
      profileDrafts: profileDrafts.length,
      total,
    },
    status,
    providers: {
      concepts: { ok: conceptsOk },
      triage: { ok: triageOk },
      drafts: { ok: draftsOk },
    },
  };
}

module.exports = {
  BEHEER_SECTIONS,
  sectionFromSearch,
  buildOverviewModel,
  buildRestaurantView,
  buildImportHistoryView,
  buildDecisionView,
  EXPORT_LABELS,
};
