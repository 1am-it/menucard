'use strict';

// BE-39 "Klaar voor publicatie" — the one publication-readiness rule.
// Deliberately CommonJS and side-effect free (same reasoning as the other
// src/lib modules): the list route, the detail route and the detail screen all
// derive the same judgment from this function, so no second interpretation can
// appear in the browser.
//
// "Klaar voor publicatie" is only ever a derived display state. It requires
// every real gate the existing review/export code already enforces:
//   - this is the latest version of the lineage;
//   - it is internally approved;
//   - it has no current blockers;
//   - its source is confirmed and not blocked;
//   - the same content was never rejected before (`wasRejectedBefore`);
//   - the GitHub integration is configured.
// A browser-only extra gate stays `saved`: unsaved corrections.
//
// A stored export is never proof of readiness. An existing export is shown
// with its real status instead: pending/opened/merged win over the readiness
// state (they are facts about an export that already exists), failed/closed
// keep their real label once every gate is green, and a failing gate always
// keeps its plain-language reason. A merged PR is explicitly not a live
// production menu: only the next deploy can confirm that (`liveNote`).

const VALID_EXPORT_STATUSES = ['pending', 'opened', 'merged', 'failed', 'closed'];

const { isHttpUrl } = require('./menuConceptUrls');

/** The existing EXPORT_VIEW texts, in one place for server and screen. */
const EXPORT_STATUS_LABELS = {
  pending: 'Review-PR wordt gemaakt',
  opened: 'Review-PR open',
  merged: 'Review-PR gemerged',
  failed: 'Vorige poging mislukt',
  closed: 'Review-PR gesloten zonder merge',
};

const READY_LABEL = 'Klaar voor publicatie';
const NOT_READY_LABEL = 'Nog niet klaar';
/** A merged review-PR is not live until the normal production deploy. */
const MERGED_LIVE_NOTE = 'live na de volgende deploy';

const ACTIVE_EXPORT_STATUSES = ['pending', 'opened', 'merged'];

function blockerTotal({ blockers, blockerCount }) {
  if (blockerCount !== null && blockerCount !== undefined) return Number(blockerCount) || 0;
  return Array.isArray(blockers) ? blockers.length : 0;
}

function blockerReason(total) {
  return total === 1 ? 'Los eerst 1 blokkade op.' : `Los eerst ${total} blokkades op.`;
}

function sourceBlockReason(blocked) {
  const label = blocked && typeof blocked.label === 'string' ? blocked.label : '';
  return label ? `De bron is geblokkeerd: ${label}.` : 'De bron is geblokkeerd.';
}

/**
 * Every gate with its list reason (short, plain Dutch) and its detail hint
 * (the sentence the review screen already showed). One rule, two views.
 */
function publicationChecks({
  isLatest = true,
  status = null,
  blockers = [],
  blockerCount = null,
  source = null,
  rejectedBefore = false,
  githubConfigured = true,
  dirty = false,
} = {}) {
  const total = blockerTotal({ blockers, blockerCount });
  const confirmed = Boolean(source && source.confirmed === true);
  const blocked = (source && source.blocked) || null;
  const sourceHint = 'De bron moet bevestigd en niet geblokkeerd zijn.';
  return [
    {
      id: 'latest',
      ok: isLatest === true,
      reason: 'Er is een nieuwere versie.',
      hint: 'Alleen de nieuwste versie kan een review-PR krijgen.',
    },
    {
      id: 'approved',
      ok: status === 'approved',
      reason: 'Nog niet intern goedgekeurd.',
      hint: 'Keur het concept eerst intern goed.',
    },
    {
      id: 'blockers',
      ok: total === 0,
      reason: blockerReason(total),
      hint: 'Een menukaart met blokkades wordt nooit geëxporteerd.',
    },
    {
      id: 'source_confirmed',
      ok: confirmed,
      reason: 'Bron nog niet bevestigd.',
      hint: sourceHint,
    },
    {
      id: 'source_unblocked',
      ok: !blocked,
      reason: blocked ? sourceBlockReason(blocked) : 'Bron niet geblokkeerd.',
      hint: sourceHint,
    },
    {
      id: 'not_rejected_before',
      ok: rejectedBefore !== true,
      reason: 'Deze menukaart is eerder afgewezen.',
      hint: 'Deze menukaart is eerder afgewezen en komt niet terug als nieuwe versie.',
    },
    {
      id: 'github',
      ok: githubConfigured === true,
      reason: 'GitHub-koppeling ontbreekt.',
      hint: 'De GitHub-koppeling ontbreekt op de server. Er kan nog geen review-PR worden gemaakt; er is niets gewijzigd.',
    },
    {
      id: 'saved',
      ok: dirty !== true,
      reason: 'Sla eerst je correcties op.',
      hint: 'Sla eerst je correcties op of maak ze ongedaan.',
    },
  ];
}

/**
 * The one publication state for a card.
 * Returns { state, label, ready, eligible, exportStatus, liveNote, reasons,
 * hints, checks, canExport }. `label` is the exact text the list shows;
 * `state` is the presentation hook:
 *   ready | not_ready | export_pending | export_opened | export_merged |
 *   export_failed | export_closed
 */
function derivePublicationReadiness(input = {}) {
  const checks = publicationChecks(input);
  const failed = checks.filter((check) => !check.ok);
  const eligible = failed.length === 0;
  const exportStatus = VALID_EXPORT_STATUSES.includes(input.exportStatus) ? input.exportStatus : null;
  const activeExport = exportStatus !== null && ACTIVE_EXPORT_STATUSES.includes(exportStatus);

  let state = 'ready';
  if (activeExport) state = `export_${exportStatus}`;
  else if (!eligible) state = 'not_ready';
  else if (exportStatus === 'failed' || exportStatus === 'closed') state = `export_${exportStatus}`;

  const label =
    state === 'ready'
      ? READY_LABEL
      : state === 'not_ready'
        ? `${NOT_READY_LABEL}: ${failed[0].reason}`
        : EXPORT_STATUS_LABELS[exportStatus];

  return {
    state,
    label,
    ready: state === 'ready',
    eligible,
    exportStatus,
    liveNote: state === 'export_merged' ? MERGED_LIVE_NOTE : null,
    reasons: failed.map((check) => check.reason),
    hints: failed.map((check) => check.hint),
    checks,
    // A new review-PR is possible only with every gate green and no export
    // that is still pending, open or merged. A failed/closed export may be
    // retried through the existing explicit "Maak review-PR" action.
    canExport: eligible && !activeExport,
  };
}

// ─── BE-41 "wat is de volgende stap" ────────────────────────────────────────
// One button per card, derived from the same rule above. This is deliberately
// not a second interpretation: the readiness state and its failing gates decide
// the step, so the list label ("Nog niet klaar: …") and the button can never
// point in different directions.
//
//   state                        next step            goes to
//   waiting (status)             Beoordelen →         the review screen
//   rejected (status)            Bekijken →           the review screen (outlined)
//   not_ready + blockers         N blokkades … →      the Wijzigingen tab
//   not_ready + source           Bron controleren →   the Bron tab
//   not_ready + github missing   no button, label only
//   ready                        Maak review-PR →     the Publicatie block
//   export_failed / _closed      Opnieuw proberen →   the Publicatie block
//   export_pending/_opened/
//   export_merged                PR bekijken ↗        the stored PR link (new tab)
//
// The list never starts an export itself: "Maak review-PR →" is a link to the
// block where the real action lives (criterion 2). An active export without a
// usable stored PR link shows no button instead of a dead one.
const NEXT_STEP_LABELS = {
  review: 'Beoordelen',
  blockers: 'blokkades oplossen',
  source: 'Bron controleren',
  export: 'Maak review-PR',
  retry: 'Opnieuw proberen',
  pr: 'PR bekijken',
  rejected: 'Bekijken',
};

const NEXT_STEP_TARGETS = {
  review: 'detail',
  blockers: 'changes',
  source: 'source',
  export: 'publication',
  retry: 'publication',
  pr: 'pr',
  rejected: 'detail',
};

/** "N blokkades oplossen", with the real count; 1 stays singular. */
function blockerStepLabel(count) {
  const total = Number(count) || 0;
  if (total === 0) return 'Blokkades oplossen';
  return total === 1 ? '1 blokkade oplossen' : `${total} blokkades oplossen`;
}

const NEXT_STEP_ARROWS = { pr: '↗' };

function nextStep(id, { label = NEXT_STEP_LABELS[id], externalUrl = null } = {}) {
  const arrow = NEXT_STEP_ARROWS[id] || '→';
  const fullLabel = label ? `${label} ${arrow}` : null;
  return {
    // 'none' means: only the existing label, no button (criterion 2).
    id,
    label: fullLabel,
    // A screen reader hears the same step as the visible label, without the
    // decorative arrow character ("Beoordelen", not "Beoordelen →").
    plainLabel: label || null,
    target: NEXT_STEP_TARGETS[id] || null,
    // 'outlined' is the one outlined button in the table: a rejected card.
    variant: id === 'rejected' ? 'outlined' : id === 'none' ? null : 'primary',
    externalUrl,
  };
}

/**
 * The next step of one list card. `publication` is the object
 * derivePublicationReadiness returned for that same card, `blockerCount` is the
 * card's own count (already displayed as a chip) and `prUrl` is the stored
 * review-PR link. Nothing here fetches, writes or exports.
 */
function deriveNextStep({ status = null, publication = null, blockerCount = null, prUrl = null } = {}) {
  if (status === 'waiting') return nextStep('review');
  if (status === 'rejected') return nextStep('rejected');
  // An unknown or missing status never gets an invented action.
  if (status !== 'approved') return nextStep('none');

  const state = publication && typeof publication.state === 'string' ? publication.state : null;
  // An export that already exists is a fact: BE-39 lets it win over the
  // readiness state, so the button follows that badge instead of contradicting
  // it. Without a stored, safe PR link there is nothing to open.
  if (state === 'export_pending' || state === 'export_opened' || state === 'export_merged') {
    return isHttpUrl(prUrl) ? nextStep('pr', { externalUrl: prUrl.trim() }) : nextStep('none');
  }
  if (state === 'export_failed' || state === 'export_closed') return nextStep('retry');
  if (state === 'ready') return nextStep('export');

  const failed = new Set(
    (publication && Array.isArray(publication.checks) ? publication.checks : []).filter((check) => !check.ok).map((check) => check.id),
  );
  if (failed.has('blockers')) return nextStep('blockers', { label: blockerStepLabel(blockerCount) });
  if (failed.has('source_confirmed') || failed.has('source_unblocked')) return nextStep('source');
  // The GitHub link, an earlier rejection or any other gate has no destination
  // of its own on the review screen: label only, no button.
  return nextStep('none');
}

module.exports = {
  derivePublicationReadiness,
  deriveNextStep,
  publicationChecks,
  VALID_EXPORT_STATUSES,
  EXPORT_STATUS_LABELS,
  ACTIVE_EXPORT_STATUSES,
  READY_LABEL,
  NOT_READY_LABEL,
  MERGED_LIVE_NOTE,
  NEXT_STEP_LABELS,
};
