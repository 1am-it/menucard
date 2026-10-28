'use strict';

// BE-40 (#95) — drift guard for the expectations of the menu review browser
// check, without starting a browser.
//
// run-menu-review-browser-check.js asserts visible texts literally. Those texts
// are product copy: the image/scan status comes from src/lib/batchAnalysis.js
// and the follow-up of /internal/bronnen from src/lib/sourceTriage.js. A product
// rename would otherwise turn a browser check into a failure nobody can read,
// and a stale expectation is exactly what stopped the BE-39 run. This test
// compares the literals in the check with the product's own source, so drift
// shows up at `npm test` time instead.
//
// Every expected text carries a middle dot (U+00B7) or is compared verbatim; a
// damaged encoding shows up as U+FFFD and is refused here before a browser run
// can hide it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { STATUSES } = require('../../src/lib/batchAnalysis');
const { FOLLOW_UPS } = require('../../src/lib/sourceTriage');
const { PDF_SCAN_NOTICE } = require('../../src/lib/menuSourceMap');
// BE-41: the next step is checked against the product's own rule.
const { deriveNextStep, NEXT_STEP_LABELS } = require('../../src/lib/menuConceptPublication');
const fixtures = require('./fixtures/menuReviewFixtures');

const SCRIPT = fs.readFileSync(path.join(__dirname, 'run-menu-review-browser-check.js'), 'utf8').replace(/\r\n/g, '\n');
// Component and screen source, read as text: the expected copy of the map, the
// AI card and the price rendering lives there, not in a second copy here.
const READ_TEXT = (relative) => fs.readFileSync(path.join(__dirname, '..', '..', relative), 'utf8').replace(/\r\n/g, '\n');
const MENU_REVIEW = READ_TEXT('app/internal/bronnen/batch/MenuReview.js');
const AI_BLOCK = READ_TEXT('src/components/AiMenuReadBlock.js');
const IMAGE_ONLY_LABEL = STATUSES.image_only.label;
const FOLLOW_UP = FOLLOW_UPS.image_only;

function imageOnlyItems() {
  const scenario = fixtures.scenarios.image_only;
  const detail = scenario && scenario.batch && scenario.batch.detail;
  return ((detail && detail.items) || []).filter((item) => item.key === 'image_only');
}

function followUpEntry() {
  const scenario = fixtures.scenarios.triage;
  const entries = (scenario && scenario.triage && scenario.triage.restaurants) || [];
  return entries.find((entry) => entry.restaurant_id === '9001') || null;
}

test('encoding: the check contains no replacement character (U+FFFD)', () => {
  assert.equal(SCRIPT.includes('\uFFFD'), false, 'U+FFFD found in run-menu-review-browser-check.js');
  assert.equal(IMAGE_ONLY_LABEL.includes('\u00B7'), true);
  assert.equal(FOLLOW_UP ? true : false, true);
});

test('image-only: the check expects the product\'s own status label', () => {
  assert.equal(IMAGE_ONLY_LABEL, 'Menu alleen als afbeelding \u00B7 lees met AI of met de hand');
  assert.equal(SCRIPT.includes(IMAGE_ONLY_LABEL), true, `missing literal: ${IMAGE_ONLY_LABEL}`);
});

test('image-only: the fixture row shows exactly that label', () => {
  const items = imageOnlyItems();
  assert.equal(items.length, 1);
  assert.equal(items[0].label, IMAGE_ONLY_LABEL);
});

test('image-only follow-up: the check expects the product\'s own reason and next step', () => {
  // The check compares with the product constants instead of restating the copy.
  assert.equal(SCRIPT.includes('followUpText.includes(FOLLOW_UP.reason)'), true, 'the check no longer reads the product reason');
  assert.equal(SCRIPT.includes('followUpText.includes(FOLLOW_UP.nextStep)'), true, 'the check no longer reads the product next step');
  assert.equal(FOLLOW_UP.reason.length > 0, true);
  assert.equal(FOLLOW_UP.nextStep.length > 0, true);
});

test('image-only follow-up: the check declares FOLLOW_UP before a browser run can crash', () => {
  // Regression for the BE-41 round whose full run stopped with
  // "ReferenceError: FOLLOW_UP is not defined" in imageOnlyScenario: the two
  // assertions above matched the literal text, so the drift guard stayed green
  // while the check itself could not run. The identifier, not only the text, is
  // part of the expectation: it must be required from the product module and
  // declared before its first use.
  const requirement = "const { FOLLOW_UPS } = require('../../src/lib/sourceTriage');";
  const declaration = 'const FOLLOW_UP = FOLLOW_UPS.image_only;';
  assert.equal(SCRIPT.includes(requirement), true, 'FOLLOW_UPS is not required from src/lib/sourceTriage');
  assert.equal(SCRIPT.includes(declaration), true, 'FOLLOW_UP is not declared in run-menu-review-browser-check.js');
  const declaredAt = SCRIPT.indexOf(declaration);
  const firstUse = SCRIPT.indexOf('FOLLOW_UP.');
  assert.ok(firstUse > declaredAt, 'FOLLOW_UP is used before the line that declares it');
});

test('image-only follow-up: the batch banner the check reads is the screen\'s own wording', () => {
  // Since BE-31 the same reason and next step also reach the screen as the
  // batch banner (app/internal/bronnen/BronnenView.js), which is what the
  // check reads on the current screen. Once a task is selected the screen moves
  // that copy into the task's own follow-up block, so the check accepts either
  // state and reads both from the same product copy.
  const BRONNEN_VIEW = READ_TEXT('app/internal/bronnen/BronnenView.js');
  const PROPOSAL_DETAIL = READ_TEXT('app/internal/bronnen/ProposalDetail.js');
  assert.equal(BRONNEN_VIEW.includes('Vervolg van de batchanalyse:'), true);
  assert.equal(SCRIPT.includes('Vervolg van de batchanalyse:'), true);
  assert.equal(PROPOSAL_DETAIL.includes('stg-followup'), true);
  assert.equal(SCRIPT.includes("querySelector('.stg-followup')"), true);
});

test('image-only: the row\'s own next step is the one the check reads', () => {
  // BE-33 (#79) / BE-35 (#84): the row itself offers the AI reading when the AI
  // may read an image, and otherwise the honest reason plus the manual import.
  // Both literals live in the batch screen, not in this test.
  const BATCH_VIEW = READ_TEXT('app/internal/bronnen/batch/BatchAnalysisView.js');
  const offReason = 'AI is nu niet beschikbaar, dus een afbeelding kan nu niet gelezen worden.';
  assert.equal(BATCH_VIEW.includes(offReason), true);
  assert.equal(SCRIPT.includes(offReason), true);
  assert.equal(BATCH_VIEW.includes('Voeg de gerechten handmatig toe'), true);
  assert.equal(SCRIPT.includes('Voeg de gerechten handmatig toe'), true);
  assert.equal(BATCH_VIEW.includes('📷 Lees met AI (afbeelding)'), true);
  assert.equal(SCRIPT.includes('📷 Lees met AI (afbeelding)'), true);
  assert.equal(BATCH_VIEW.includes('Kost ongeveer 1 cent per afbeelding of pagina \u00B7 duurt \u00B1 1 minuut'), true);
  assert.equal(SCRIPT.includes('Kost ongeveer 1 cent per afbeelding of pagina \u00B7 duurt \u00B1 1 minuut'), true);
});

test('image-only: both AI states of the same row are covered by the fixture', () => {
  // The fixture answers the existing AI status route, so the row can really be
  // seen with the AI off (manual route) and on ("Lees met AI (afbeelding)").
  const scenario = fixtures.scenarios.image_only;
  assert.equal(scenario.ai.status.enabled, true);
  assert.equal(scenario.ai.status.budget.allowed, true);
  assert.equal(scenario.ai.statusOff.enabled, false);
  assert.equal(Boolean(imageOnlyItems()[0].jobId), true, 'the AI reading needs the existing job');
  // The check names both states in the address bar, so each screenshot belongs
  // to exactly one of them.
  assert.equal(SCRIPT.includes('&aiState=off`'), true);
  assert.equal(SCRIPT.includes('&aiState=ready`'), true);
});

test('image-only follow-up: the fixture keeps the known URL and the next step the check names', () => {
  const entry = followUpEntry();
  assert.ok(entry, 'fixture restaurant 9001 is missing');
  // `mark_unusable` and `replace_source` are only offered with a known source
  // URL (ProposalForm and validateProposalInput both require it).
  assert.equal(Boolean(entry.known_url && entry.known_url.startsWith('https://')), true);
  assert.equal(entry.next_step, 'check_via_onboarding');
  assert.equal(entry.source, 'reachable');
});

test('be30: the price the check expects is the Dutch rendering MenuReview.js produces', () => {
  const section = fixtures.structure8Sections[0];
  assert.equal(section.items[0].name, 'Fictieve burrata');
  // The fixture keeps the source shape ("13.00"); the screen prints a Dutch
  // decimal comma through its own `dutchPrice`.
  assert.equal(section.items[0].price, '13.00');
  assert.equal(MENU_REVIEW.includes("text.replace('.', ',')"), true);
  assert.equal(SCRIPT.includes('13,00'), true);
});

test('ai read: the per-page estimate the check expects is the AI card\'s own copy', () => {
  const line = 'Kost ongeveer 1 cent per pagina \u00B7 duurt \u00B1 1 minuut';
  assert.equal(AI_BLOCK.includes(line), true, `missing in AiMenuReadBlock.js: ${line}`);
  assert.equal(SCRIPT.includes(line), true, `missing in the browser check: ${line}`);
});

test('kaart: the scan notice the check waits for is the product\'s own PDF notice', () => {
  // The map fixture's third source is a PDF without a text layer, so the check
  // may not keep waiting for the image-only notice.
  const map = fixtures.scenarios['manual-map'];
  const bundle = map && map.manual && map.manual.bundle;
  assert.ok(bundle, 'the manual-map fixture bundle is missing');
  const scan = (bundle.sources || []).find((source) => source.id === 'source-3');
  assert.ok(scan, 'fixture source-3 is missing');
  assert.equal(scan.kind, 'pdf');
  assert.equal(scan.hasText, false);
  assert.equal(SCRIPT.includes('PDF zonder tekstlaag'), true);
  assert.equal(SCRIPT.includes(PDF_SCAN_NOTICE.slice(0, 40)), true, 'the check no longer names the PDF notice');
  assert.equal(SCRIPT.includes('Deze kaart is een afbeelding; vergelijken kan nog niet.'), false, 'the image notice does not apply to a PDF');
});

test('be41: the check reads the next step from the product rule and covers every row', () => {
  // The label of a card is not restated in the check: it comes from
  // src/lib/menuConceptPublication.js, exactly as the screen receives it.
  assert.equal(SCRIPT.includes("const { deriveNextStep } = require('../../src/lib/menuConceptPublication')"), true);
  for (const [id, label] of Object.entries(NEXT_STEP_LABELS)) {
    assert.equal(SCRIPT.includes(`${label} →`), false, `the check hardcodes the ${id} label`);
    assert.equal(SCRIPT.includes(`${label} ↗`), false, `the check hardcodes the ${id} label`);
  }
  // One fictional card per row of the contract's table, and no more rows.
  const ids = fixtures.publicationList.items.map((item) => deriveNextStep({
    status: item.status,
    publication: item.publication,
    blockerCount: item.blockerCount,
    prUrl: item.exportPrUrl,
  }).id);
  assert.deepEqual([...new Set(ids)].sort(), ['blockers', 'export', 'none', 'pr', 'rejected', 'retry', 'review', 'source']);
});

test('be41: every card with a next step has its own detail, so a click really lands', () => {
  const details = fixtures.scenarios['concepts-publication'].detail;
  for (const item of fixtures.publicationList.items) {
    assert.equal(Boolean(details[item.id]), true, `no detail fixture for ${item.id}`);
  }
  // The two sources the URL rule must refuse, and the pdf it must name.
  assert.equal(details[fixtures.PUBLICATION_IDS.unsafeSource].concept.sourceUrl, 'javascript:alert(1)');
  assert.equal(details[fixtures.PUBLICATION_IDS.emptySource].concept.sourceUrl, '');
  assert.equal(details[fixtures.PUBLICATION_IDS.pdfSource].concept.sourceUrl.endsWith('.pdf'), true);
});
