'use strict';

// BE-39 "Klaar voor publicatie" — the pure rule, one test per state: ready,
// every "nog niet klaar" reason (including a blocked source), every stored
// export status, and the promise that a stored export never counts as proof
// that a card is ready. No database, no GitHub, fictional values only.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  derivePublicationReadiness,
  EXPORT_STATUS_LABELS,
  MERGED_LIVE_NOTE,
} = require('./menuConceptPublication');

const CONFIRMED_SOURCE = { confirmed: true, blocked: null };

/** Every gate green: the fictional base case. */
const readyInput = (overrides = {}) => ({
  isLatest: true,
  status: 'approved',
  blockers: [],
  source: CONFIRMED_SOURCE,
  rejectedBefore: false,
  githubConfigured: true,
  exportStatus: null,
  ...overrides,
});

test('ready: every real gate green derives exactly one "Klaar voor publicatie"', () => {
  const publication = derivePublicationReadiness(readyInput());
  assert.equal(publication.state, 'ready');
  assert.equal(publication.label, 'Klaar voor publicatie');
  assert.equal(publication.ready, true);
  assert.equal(publication.eligible, true);
  assert.equal(publication.canExport, true);
  assert.equal(publication.exportStatus, null);
  assert.equal(publication.liveNote, null);
  assert.deepEqual(publication.reasons, []);
  assert.deepEqual(publication.checks.map((c) => [c.id, c.ok]), [
    ['latest', true],
    ['approved', true],
    ['blockers', true],
    ['source_confirmed', true],
    ['source_unblocked', true],
    ['not_rejected_before', true],
    ['github', true],
    ['saved', true],
  ]);
});

test('not ready: each gate alone is enough to block, with its own plain reason', () => {
  const cases = [
    [{ isLatest: false }, 'Er is een nieuwere versie.'],
    [{ status: 'waiting' }, 'Nog niet intern goedgekeurd.'],
    [{ status: 'rejected' }, 'Nog niet intern goedgekeurd.'],
    [{ blockerCount: 1 }, 'Los eerst 1 blokkade op.'],
    [{ blockers: ['a', 'b', 'c'] }, 'Los eerst 3 blokkades op.'],
    [{ source: { confirmed: false, blocked: null } }, 'Bron nog niet bevestigd.'],
    [{ source: null }, 'Bron nog niet bevestigd.'],
    [{ rejectedBefore: true }, 'Deze menukaart is eerder afgewezen.'],
    [{ githubConfigured: false }, 'GitHub-koppeling ontbreekt.'],
    [{ dirty: true }, 'Sla eerst je correcties op.'],
  ];
  for (const [overrides, reason] of cases) {
    const publication = derivePublicationReadiness(readyInput(overrides));
    assert.equal(publication.state, 'not_ready', JSON.stringify(overrides));
    assert.equal(publication.label, `Nog niet klaar: ${reason}`, JSON.stringify(overrides));
    assert.equal(publication.ready, false);
    assert.equal(publication.eligible, false);
    assert.equal(publication.canExport, false);
    assert.equal(publication.reasons[0], reason);
  }
});

test('a blocked source is a "nog niet klaar" reason with the real block label, never a ready card', () => {
  const publication = derivePublicationReadiness(readyInput({ source: { confirmed: true, blocked: { reason: 'robots_disallowed', label: 'Robots geblokkeerd' } } }));
  assert.equal(publication.state, 'not_ready');
  assert.equal(publication.label, 'Nog niet klaar: De bron is geblokkeerd: Robots geblokkeerd.');
  const failed = publication.checks.filter((check) => !check.ok);
  assert.deepEqual(failed.map((check) => check.id), ['source_unblocked']);
  assert.match(failed[0].hint, /bevestigd en niet geblokkeerd/);
  // Not confirmed and blocked at once: the first reason wins, both stay listed.
  const both = derivePublicationReadiness(readyInput({ source: { confirmed: false, blocked: { label: 'Niet bereikbaar' } } }));
  assert.equal(both.label, 'Nog niet klaar: Bron nog niet bevestigd.');
  assert.deepEqual(both.reasons, ['Bron nog niet bevestigd.', 'De bron is geblokkeerd: Niet bereikbaar.']);
});

test('not ready: the first failing gate names the reason, later ones stay available as hints', () => {
  const publication = derivePublicationReadiness(readyInput({ status: 'waiting', blockerCount: 2, githubConfigured: false }));
  assert.equal(publication.label, 'Nog niet klaar: Nog niet intern goedgekeurd.');
  assert.deepEqual(publication.reasons, ['Nog niet intern goedgekeurd.', 'Los eerst 2 blokkades op.', 'GitHub-koppeling ontbreekt.']);
  assert.deepEqual(publication.hints, [
    'Keur het concept eerst intern goed.',
    'Een menukaart met blokkades wordt nooit geëxporteerd.',
    'De GitHub-koppeling ontbreekt op de server. Er kan nog geen review-PR worden gemaakt; er is niets gewijzigd.',
  ]);
});

test('every stored export status shows its real EXPORT_VIEW text, never "Klaar voor publicatie"', () => {
  assert.deepEqual(EXPORT_STATUS_LABELS, {
    pending: 'Review-PR wordt gemaakt',
    opened: 'Review-PR open',
    merged: 'Review-PR gemerged',
    failed: 'Vorige poging mislukt',
    closed: 'Review-PR gesloten zonder merge',
  });
  const expected = {
    pending: { state: 'export_pending', canExport: false },
    opened: { state: 'export_opened', canExport: false },
    merged: { state: 'export_merged', canExport: false },
    failed: { state: 'export_failed', canExport: true },
    closed: { state: 'export_closed', canExport: true },
  };
  for (const [status, want] of Object.entries(expected)) {
    const publication = derivePublicationReadiness(readyInput({ exportStatus: status }));
    assert.equal(publication.state, want.state, status);
    assert.equal(publication.label, EXPORT_STATUS_LABELS[status], status);
    assert.equal(publication.exportStatus, status, status);
    assert.equal(publication.canExport, want.canExport, status);
    assert.equal(publication.ready, false, `${status} is never a readiness proof`);
  }
});

test('merged is not live: the short "live na de volgende deploy" line accompanies only a merged review-PR', () => {
  const merged = derivePublicationReadiness(readyInput({ exportStatus: 'merged' }));
  assert.equal(merged.liveNote, MERGED_LIVE_NOTE);
  assert.equal(merged.liveNote, 'live na de volgende deploy');
  for (const exportStatus of [null, 'pending', 'opened', 'failed', 'closed']) {
    assert.equal(derivePublicationReadiness(readyInput({ exportStatus })).liveNote, null, String(exportStatus));
  }
});

test('a stored export never hides a failing gate: the concrete reason stays visible', () => {
  for (const exportStatus of ['failed', 'closed']) {
    const publication = derivePublicationReadiness(readyInput({ exportStatus, source: { confirmed: false, blocked: null } }));
    assert.equal(publication.state, 'not_ready', exportStatus);
    assert.equal(publication.label, 'Nog niet klaar: Bron nog niet bevestigd.', exportStatus);
  }
  // Even an active export does not turn a blocked card into a ready card.
  const opened = derivePublicationReadiness(readyInput({ exportStatus: 'opened', blockerCount: 1 }));
  assert.equal(opened.state, 'export_opened');
  assert.equal(opened.ready, false);
  assert.equal(opened.eligible, false);
  assert.equal(opened.reasons[0], 'Los eerst 1 blokkade op.');
});

test('an unknown or absent export status is ignored instead of guessed', () => {
  for (const exportStatus of [undefined, null, '', 'deployed', 'MERGGED', 42]) {
    const publication = derivePublicationReadiness(readyInput({ exportStatus }));
    assert.equal(publication.exportStatus, null, String(exportStatus));
    assert.equal(publication.state, 'ready', String(exportStatus));
    assert.equal(publication.canExport, true, String(exportStatus));
  }
});
