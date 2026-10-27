'use strict';

// #59 Lead review 6319894232 (R4/R5) — the human follow-up of a menu that
// exists only as an image or scan. The reason must reach the DETAIL of the
// restaurant the batch link names, with a next step that fits it, and the
// proposal must offer a fitting "unusable" reason without a schema change.
// Pure logic plus the page's own wiring; no network, no database, no writes.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  FOLLOW_UPS,
  UNUSABLE_REASONS,
  readFollowUp,
  followUpForEntry,
  validateProposalForm,
} = require('./sourceTriage');

const ROOT = path.resolve(__dirname, '..', '..');
const PAGE = [
  fs.readFileSync(path.join(ROOT, 'app', 'internal', 'bronnen', 'page.js'), 'utf8'),
  fs.readFileSync(path.join(ROOT, 'app', 'internal', 'bronnen', 'BronnenView.js'), 'utf8'),
  fs.readFileSync(path.join(ROOT, 'app', 'internal', 'bronnen', 'ProposalDetail.js'), 'utf8'),
].join('\n');

const SEARCH = '?restaurant=9001&reason=image_only';
const ENTRY = { restaurant_id: '9001', name: 'Fictief Brasserie Noord' };

test('the batch link of an image/scan menu is read as page context, never as a status', () => {
  const context = readFollowUp(SEARCH);
  assert.equal(context.id, 'image_only');
  assert.equal(context.restaurantId, '9001');
  assert.equal(context.followUp.reason, 'Menu alleen als afbeelding of scan: lees het met AI of met de hand');
  assert.match(context.followUp.detail, /Lees de afbeelding of scan met AI/);
  assert.match(context.followUp.nextStep, /tekst- of pdf-bron/);
  // Nothing here claims a menu verdict, a confirmation or a publication.
  assert.doesNotMatch(JSON.stringify(context.followUp), /bevestigd|gepubliceerd|geslaagd/i);
});

test('an unknown or malformed follow-up is ignored instead of becoming a reason', () => {
  assert.equal(readFollowUp(''), null);
  assert.equal(readFollowUp('?reason=imported'), null);
  assert.equal(readFollowUp('?reason=IMAGE_ONLY'), null);
  assert.equal(readFollowUp(`?reason=${encodeURIComponent('image_only ')}`), null);
  assert.equal(readFollowUp(`?restaurant=${encodeURIComponent('9001;drop')}&reason=image_only`).restaurantId, null);
});

test('the follow-up attaches only to the restaurant the batch link named', () => {
  const context = readFollowUp(SEARCH);
  assert.ok(followUpForEntry(context, ENTRY));
  assert.equal(followUpForEntry(context, { restaurant_id: '9002' }), null, 'never at another restaurant');
  assert.equal(followUpForEntry(context, null), null);
  assert.equal(followUpForEntry(readFollowUp('?reason=image_only'), ENTRY), null, 'without a restaurant it is only a page note');
});

test('the suggested reason is an existing stored value whose fixed note passes both checks', () => {
  const suggestion = FOLLOW_UPS.image_only.suggestion;
  assert.ok(UNUSABLE_REASONS.includes(suggestion.unusableReason), 'no new stored reason value');
  assert.equal(suggestion.unusableReason, 'other');
  assert.match(suggestion.note, /alleen als afbeelding of scan/);
  assert.ok(suggestion.note.length <= 280);
  assert.deepEqual(
    validateProposalForm({ kind: 'mark_unusable', reason: suggestion.unusableReason, note: suggestion.note, knownUrl: null }),
    { ok: true },
  );
  // The note stays required: the explanation is visible content, not a bypass.
  assert.equal(
    validateProposalForm({ kind: 'mark_unusable', reason: suggestion.unusableReason, note: '', knownUrl: null }).ok,
    false,
  );
});

test('the detail shows the real reason and the fitting next step, not only a banner', () => {
  assert.match(PAGE, /followUp=\{detailFollowUp\}/);
  assert.match(PAGE, /id="stg-followup-title"/);
  assert.match(PAGE, /\{followUp\.title\}/);
  assert.match(PAGE, /\{followUp\.reason\}/);
  assert.match(PAGE, /\{followUp\.detail\}/);
  assert.match(PAGE, /\{followUp\.nextStep\}/);
  // The server's generic step stays visible, but as secondary context.
  assert.match(PAGE, /Algemene route: \{NEXT_STEP_LABELS\[entry\.next_step\]\}/);
  // The banner is the fallback only.
  assert.match(PAGE, /const bannerFollowUp = followUpContext && !detailFollowUp \? followUpContext\.followUp : null/);
});

test('the proposal form offers the fitting reason once and never overwrites typed text', () => {
  assert.match(PAGE, /suggestion=\{followUp \? followUp\.suggestion : null\}/);
  assert.match(PAGE, /setReason\(suggestion\.unusableReason\)/);
  assert.match(PAGE, /setNote\(\(current\) => \(current\.trim\(\) \? current : suggestion\.note\)\)/);
  assert.match(PAGE, /suggestion\.explain/);
  assert.match(PAGE, /suggestionApplied\.current/);
  // No new stored reason value is sent to the API.
  assert.doesNotMatch(PAGE, /unusable_reason: 'image_only/);
  assert.doesNotMatch(PAGE, /PROPOSAL_KINDS\s*=\s*\[[^\]]*image/);
});
