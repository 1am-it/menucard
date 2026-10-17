'use strict';

// Issue #53 round 3 — the one derived publication-readiness rule.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { derivePublicationReadiness } = require('./menuConceptPublication');

const readyInput = {
  isLatest: true,
  status: 'approved',
  blockers: [],
  source: { confirmed: true, blocked: null },
  rejectedBefore: false,
  dirty: false,
  githubConfigured: true,
  exportStatus: null,
};

test('ready: only when version, approval, blockers, source, rejection, save state and integration all pass', () => {
  const publication = derivePublicationReadiness(readyInput);
  assert.equal(publication.ready, true);
  assert.equal(publication.state, 'ready');
  assert.equal(publication.label, 'Klaar voor publicatie');
  assert.equal(publication.actionLabel, 'Publiceren');
  assert.equal(publication.canCreateReviewPr, true);
  assert.equal(publication.reasons.length, 0);
  assert.deepEqual(publication.checks.map((c) => [c.id, c.ok]), [
    ['latest', true],
    ['approved', true],
    ['blockers', true],
    ['source_confirmed', true],
    ['source_unblocked', true],
    ['not_rejected_before', true],
    ['saved', true],
    ['github', true],
  ]);
});

test('blocked: every failed real check is named; readiness is never claimed', () => {
  const publication = derivePublicationReadiness({
    ...readyInput,
    isLatest: false,
    status: 'waiting',
    blockerCount: 2,
    source: { confirmed: false, blocked: { label: 'Robots geblokkeerd' } },
    rejectedBefore: true,
    dirty: true,
    githubConfigured: false,
  });
  assert.equal(publication.ready, false);
  assert.equal(publication.state, 'blocked');
  assert.equal(publication.label, 'Nog niet klaar voor publicatie');
  assert.equal(publication.canCreateReviewPr, false);
  assert.deepEqual(publication.reasons, [
    'Nieuwste conceptversie',
    'Intern goedgekeurd',
    'Geen blokkades',
    'Bron bevestigd',
    'Bron niet geblokkeerd',
    'Niet eerder afgewezen',
    'Geen niet-opgeslagen correcties',
    'GitHub-koppeling beschikbaar',
  ]);
  assert.doesNotMatch(publication.label, /Klaar voor publicatie/);
});

test('an open or pending export is shown with its real status and is not offered as a new publication task', () => {
  const opened = derivePublicationReadiness({ ...readyInput, exportStatus: 'opened' });
  assert.equal(opened.ready, false);
  assert.equal(opened.state, 'export_active');
  assert.equal(opened.actionLabel, 'Bekijk publicatie');
  assert.equal(opened.canCreateReviewPr, false);
  assert.match(opened.label, /Review-PR open/);

  const pending = derivePublicationReadiness({ ...readyInput, exportStatus: 'pending' });
  assert.equal(pending.state, 'export_active');
  assert.match(pending.label, /wordt aangemaakt/);
  assert.equal(pending.canCreateReviewPr, false);
});

test('merged is not live: it stays a real export status, never production confirmation', () => {
  const merged = derivePublicationReadiness({ ...readyInput, exportStatus: 'merged' });
  assert.equal(merged.ready, false);
  assert.equal(merged.state, 'export_merged');
  assert.equal(merged.canCreateReviewPr, false);
  assert.match(merged.label, /gemerged/);
  assert.match(merged.label, /productie nog niet bevestigd/);
  assert.doesNotMatch(merged.label, /Klaar voor publicatie/);
});

test('failed and closed exports keep their reason and may be retried through the explicit action only when all gates pass', () => {
  const failed = derivePublicationReadiness({ ...readyInput, exportStatus: 'failed' });
  assert.equal(failed.state, 'export_attention');
  assert.match(failed.label, /mislukt/);
  assert.equal(failed.canCreateReviewPr, true);

  const closed = derivePublicationReadiness({ ...readyInput, exportStatus: 'closed' });
  assert.match(closed.label, /gesloten/);
  assert.equal(closed.canCreateReviewPr, true);

  const failedBlocked = derivePublicationReadiness({
    ...readyInput,
    exportStatus: 'failed',
    source: { confirmed: false, blocked: null },
  });
  assert.equal(failedBlocked.state, 'blocked');
  assert.equal(failedBlocked.canCreateReviewPr, false);
  assert.ok(failedBlocked.reasons.includes('Bron bevestigd'));
});

test('a stored export alone is never used as readiness proof', () => {
  const mergedButBlocked = derivePublicationReadiness({
    ...readyInput,
    status: 'waiting',
    source: { confirmed: false, blocked: null },
    exportStatus: 'merged',
  });
  assert.equal(mergedButBlocked.ready, false);
  assert.equal(mergedButBlocked.state, 'export_merged');
  assert.equal(mergedButBlocked.eligible, false);
  assert.equal(mergedButBlocked.canCreateReviewPr, false);
});
