// Issue #53 round 3 — pure publication-readiness rule. Deliberately
// CommonJS and side-effect free, same reasoning as the other lib modules.
//
// `Klaar voor publicatie` is only ever a derived display state. It requires
// every real gate the existing review/export code already enforces:
//   - this is the latest version;
//   - it is internally approved;
//   - no current blockers;
//   - the source is confirmed and not blocked;
//   - the same content was never rejected before;
//   - no unsaved corrections;
//   - the GitHub integration is configured.
//
// A stored export is never used as proof of readiness. An active or merged
// export is shown with its real status instead; a failed/closed export keeps
// its actual state and may be retried through the existing explicit
// `Maak review-PR` action. A merged PR is explicitly not the same as a live
// production menu: only a successful deployment can confirm that.

'use strict';

const VALID_EXPORT_STATUSES = ['pending', 'opened', 'merged', 'failed', 'closed'];

function derivePublicationReadiness({
  isLatest = true,
  status = null,
  blockers = [],
  blockerCount = null,
  source = null,
  rejectedBefore = false,
  dirty = false,
  githubConfigured = true,
  exportStatus = null,
} = {}) {
  const blockerTotal =
    blockerCount !== null && blockerCount !== undefined
      ? Number(blockerCount) || 0
      : Array.isArray(blockers)
        ? blockers.length
        : 0;
  const approved = status === 'approved' || status === 'approved_internal';
  const confirmed = Boolean(source && source.confirmed === true);
  const blocked = Boolean(source && source.blocked);
  const normalizedExport = VALID_EXPORT_STATUSES.includes(exportStatus) ? exportStatus : null;

  const checks = [
    { id: 'latest', ok: isLatest === true, label: 'Nieuwste conceptversie' },
    { id: 'approved', ok: approved, label: 'Intern goedgekeurd' },
    { id: 'blockers', ok: blockerTotal === 0, label: 'Geen blokkades' },
    { id: 'source_confirmed', ok: confirmed, label: 'Bron bevestigd' },
    { id: 'source_unblocked', ok: !blocked, label: 'Bron niet geblokkeerd' },
    { id: 'not_rejected_before', ok: rejectedBefore !== true, label: 'Niet eerder afgewezen' },
    { id: 'saved', ok: dirty !== true, label: 'Geen niet-opgeslagen correcties' },
    { id: 'github', ok: githubConfigured === true, label: 'GitHub-koppeling beschikbaar' },
  ];
  const failed = checks.filter((check) => !check.ok);
  const eligible = failed.length === 0;

  let state = 'ready';
  let label = 'Klaar voor publicatie';
  let actionLabel = 'Publiceren';

  if (normalizedExport === 'merged') {
    state = 'export_merged';
    label = 'Review-PR gemerged · productie nog niet bevestigd';
    actionLabel = 'Bekijk publicatie';
  } else if (normalizedExport === 'pending' || normalizedExport === 'opened') {
    state = 'export_active';
    label = normalizedExport === 'pending' ? 'Review-PR wordt aangemaakt' : 'Review-PR open · nog niet gemerged';
    actionLabel = 'Bekijk publicatie';
  } else if (!eligible) {
    state = 'blocked';
    label = 'Nog niet klaar voor publicatie';
    actionLabel = 'Controleer concept';
  } else if (normalizedExport === 'failed' || normalizedExport === 'closed') {
    state = 'export_attention';
    label = normalizedExport === 'failed' ? 'Publicatie mislukt · controleer de oorzaak' : 'Review-PR gesloten · controleer de publicatie';
    actionLabel = 'Controleer publicatie';
  }

  return {
    ready: state === 'ready',
    eligible,
    state,
    label,
    actionLabel,
    checks,
    reasons: failed.map((check) => check.label),
    canCreateReviewPr: eligible && normalizedExport !== 'pending' && normalizedExport !== 'opened' && normalizedExport !== 'merged',
    exportStatus: normalizedExport,
  };
}

module.exports = {
  derivePublicationReadiness,
  VALID_EXPORT_STATUSES,
};
