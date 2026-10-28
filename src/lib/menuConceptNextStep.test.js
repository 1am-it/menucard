'use strict';

// BE-41 — the next step of a list card, one test per row of the contract's
// table. The step is derived from the same publication rule as BE-39, so this
// file also proves there is no second interpretation: every expectation is
// built by calling derivePublicationReadiness first, never by hand-writing a
// state or a label. Fictional values only; nothing is fetched or written.

const test = require('node:test');
const assert = require('node:assert/strict');
const { derivePublicationReadiness, deriveNextStep, NEXT_STEP_LABELS } = require('./menuConceptPublication');

const CONFIRMED_SOURCE = { confirmed: true, blocked: null };
const PR_URL = 'https://github.invalid/fictief/menucard/pull/91';

/** Every gate green for an approved card: the base of the readiness rule. */
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

/** The list card as the server sends it: status + the derived publication. */
const card = ({ status = 'approved', overrides = {}, blockerCount = 0, prUrl = null } = {}) =>
  deriveNextStep({
    status,
    publication: status === 'approved' ? derivePublicationReadiness(readyInput(overrides)) : null,
    blockerCount,
    prUrl,
  });

test('row 1 — waiting for review: "Beoordelen →" to the review screen', () => {
  const step = card({ status: 'waiting' });
  assert.equal(step.id, 'review');
  assert.equal(step.label, 'Beoordelen →');
  assert.equal(step.target, 'detail');
  assert.equal(step.variant, 'primary');
  assert.equal(step.externalUrl, null);
});

test('row 2 — approved with blockers: "N blokkades oplossen →" to the Wijzigingen tab', () => {
  const two = card({ overrides: { blockerCount: 2 }, blockerCount: 2 });
  assert.equal(two.id, 'blockers');
  assert.equal(two.label, '2 blokkades oplossen →');
  assert.equal(two.target, 'changes');
  assert.equal(two.variant, 'primary');

  const one = card({ overrides: { blockerCount: 1 }, blockerCount: 1 });
  assert.equal(one.label, '1 blokkade oplossen →');

  const twelve = card({ overrides: { blockerCount: 12 }, blockerCount: 12 });
  assert.equal(twelve.label, '12 blokkades oplossen →');
});

test('row 3 — approved with an unconfirmed or blocked source: "Bron controleren →" to the Bron tab', () => {
  const unconfirmed = card({ overrides: { source: { confirmed: false, blocked: null } } });
  assert.equal(unconfirmed.id, 'source');
  assert.equal(unconfirmed.label, 'Bron controleren →');
  assert.equal(unconfirmed.target, 'source');

  const blocked = card({ overrides: { source: { confirmed: true, blocked: { reason: 'robots_disallowed', label: 'Robots geblokkeerd' } } } });
  assert.equal(blocked.id, 'source');
  assert.equal(blocked.label, 'Bron controleren →');
  assert.equal(blocked.target, 'source');
});

test('row 4 — approved without a GitHub link: no button, only the existing label', () => {
  const step = card({ overrides: { githubConfigured: false } });
  assert.equal(step.id, 'none');
  assert.equal(step.label, null);
  assert.equal(step.target, null);
  assert.equal(step.variant, null);
});

test('row 5 — ready for publication: "Maak review-PR →" to the Publicatie block, never an export', () => {
  const step = card();
  assert.equal(step.id, 'export');
  assert.equal(step.label, 'Maak review-PR →');
  assert.equal(step.target, 'publication');
  assert.equal(step.variant, 'primary');
  // The step only names the destination: no action, no export instruction.
  assert.equal(step.externalUrl, null);
  assert.equal(Object.keys(step).includes('onExport'), false);
});

test('row 6 — an open, pending or merged review-PR: "PR bekijken ↗" to the stored link', () => {
  for (const exportStatus of ['opened', 'merged', 'pending']) {
    const step = card({ overrides: { exportStatus }, prUrl: PR_URL });
    assert.equal(step.id, 'pr', exportStatus);
    assert.equal(step.label, 'PR bekijken ↗', exportStatus);
    assert.equal(step.target, 'pr', exportStatus);
    assert.equal(step.externalUrl, PR_URL, exportStatus);
  }
});

test('row 7 — a failed export or a closed PR: "Opnieuw proberen →" to the Publicatie block', () => {
  for (const exportStatus of ['failed', 'closed']) {
    const step = card({ overrides: { exportStatus } });
    assert.equal(step.id, 'retry', exportStatus);
    assert.equal(step.label, 'Opnieuw proberen →', exportStatus);
    assert.equal(step.target, 'publication', exportStatus);
    assert.equal(step.variant, 'primary', exportStatus);
  }
});

test('row 8 — a rejected card: the outlined "Bekijken →" to the review screen', () => {
  const step = card({ status: 'rejected' });
  assert.equal(step.id, 'rejected');
  assert.equal(step.label, 'Bekijken →');
  assert.equal(step.target, 'detail');
  assert.equal(step.variant, 'outlined');
});

test('the label and the button can never disagree: every row follows the readiness state', () => {
  const rows = [
    { overrides: {}, want: 'export' },
    { overrides: { blockerCount: 3 }, blockerCount: 3, want: 'blockers' },
    { overrides: { source: { confirmed: false, blocked: null } }, want: 'source' },
    { overrides: { githubConfigured: false }, want: 'none' },
    { overrides: { exportStatus: 'failed' }, want: 'retry' },
    { overrides: { exportStatus: 'closed' }, want: 'retry' },
    { overrides: { exportStatus: 'opened' }, prUrl: PR_URL, want: 'pr' },
  ];
  for (const row of rows) {
    const publication = derivePublicationReadiness(readyInput(row.overrides));
    const step = deriveNextStep({ status: 'approved', publication, blockerCount: row.blockerCount || 0, prUrl: row.prUrl || null });
    assert.equal(step.id, row.want, JSON.stringify(row.overrides));
    if (step.label) assert.match(step.label, /[→↗]$/, `an arrow ends every button label (${step.label})`);
  }
});

test('an existing export wins over a failing gate, exactly like the BE-39 badge does', () => {
  // The badge says "Review-PR gemerged"; the button may not then say
  // "3 blokkades oplossen". Same rule, same precedence, no second opinion.
  const publication = derivePublicationReadiness(readyInput({ blockerCount: 3, exportStatus: 'merged' }));
  assert.equal(publication.label, 'Review-PR gemerged');
  assert.equal(deriveNextStep({ status: 'approved', publication, blockerCount: 3, prUrl: PR_URL }).id, 'pr');
  // Without that export the same card does fall back to its blockers.
  const withoutExport = derivePublicationReadiness(readyInput({ blockerCount: 3 }));
  assert.equal(deriveNextStep({ status: 'approved', publication: withoutExport, blockerCount: 3 }).id, 'blockers');
});

test('a failed export with a failing gate keeps the gate first: the fix comes before the retry', () => {
  // derivePublicationReadiness keeps `not_ready` here, so the card first sends
  // the reviewer to the real blocker instead of to a retry that cannot work.
  const publication = derivePublicationReadiness(readyInput({ exportStatus: 'failed', blockerCount: 1 }));
  assert.equal(publication.state, 'not_ready');
  const step = deriveNextStep({ status: 'approved', publication, blockerCount: 1 });
  assert.equal(step.id, 'blockers');
  assert.equal(step.label, '1 blokkade oplossen →');
});

test('no PR link means no dead button, and never a javascript: link', () => {
  for (const prUrl of [null, '', '   ', 'javascript:alert(1)', '/relatief/pad', 'ftp://github.invalid/9']) {
    const step = card({ overrides: { exportStatus: 'opened' }, prUrl });
    assert.equal(step.id, 'none', String(prUrl));
    assert.equal(step.label, null, String(prUrl));
  }
});

test('an unknown status or a missing publication never invents an action', () => {
  assert.equal(deriveNextStep().id, 'none');
  assert.equal(deriveNextStep({ status: 'approved' }).id, 'none');
  assert.equal(deriveNextStep({ status: 'onbekend' }).id, 'none');
  assert.equal(deriveNextStep({ status: null }).id, 'none');
  // A 'not_ready' card whose only failing gates have no destination of their
  // own (an earlier rejection, an unsaved correction) stays label-only.
  const rejectedBefore = derivePublicationReadiness(readyInput({ rejectedBefore: true }));
  assert.equal(rejectedBefore.state, 'not_ready');
  assert.equal(deriveNextStep({ status: 'approved', publication: rejectedBefore }).id, 'none');
  assert.equal(deriveNextStep({ status: 'approved', publication: derivePublicationReadiness(readyInput({ dirty: true })) }).id, 'none');
});

test('the visible labels are the contract wording, in Dutch, with one arrow', () => {
  assert.deepEqual(NEXT_STEP_LABELS, {
    review: 'Beoordelen',
    blockers: 'blokkades oplossen',
    source: 'Bron controleren',
    export: 'Maak review-PR',
    retry: 'Opnieuw proberen',
    pr: 'PR bekijken',
    rejected: 'Bekijken',
  });
  assert.equal(NEXT_STEP_LABELS.export.includes('export'), false, 'the label says review-PR, not export');
  // The plain label is what a screen reader hears with the card link.
  assert.equal(card().plainLabel, 'Maak review-PR');
  assert.equal(card({ status: 'waiting' }).plainLabel, 'Beoordelen');
  assert.equal(card().label.replace(/\s*→$/, ''), card().plainLabel);
});
