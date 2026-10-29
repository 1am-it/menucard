'use strict';

// Isolated browser evidence for #59's EXISTING batch import/review UI.
//
// This drives the real app route and the real BatchAnalysisView/MenuReview
// components in a local `next dev` process with a fictional in-page session and
// fictional API responses. It is FIXTURE evidence, not live integration,
// staging or production acceptance. No production credential, identity, data
// or write is involved.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const fixtures = require('./fixtures/menuReviewFixtures');
// BE-41: the browser check compares the rendered cards with the product's own
// rule instead of a second copy of the table, and with the URL rule behind
// "Originele menukaart openen".
const { deriveNextStep } = require('../../src/lib/menuConceptPublication');
const { menuSourceLink } = require('../../src/lib/menuConceptUrls');
// BE-40/BE-33: the follow-up reason and next step on /internal/bronnen are
// product copy (src/lib/sourceTriage.js). The check compares with those
// constants instead of restating them; `FOLLOW_UP` must be declared here too,
// otherwise the scenario crashes with a ReferenceError half way through the run.
const { FOLLOW_UPS } = require('../../src/lib/sourceTriage');
const FOLLOW_UP = FOLLOW_UPS.image_only;
const { fixtureBootstrap } = require('./lib/fixture-page');
const { createNetworkGuard, enableFetchGuard, defaultAppOrigins } = require('./lib/network-policy');
const {
  findBrowser,
  killTree,
  startServer,
  startBrowser,
  evalJs,
  waitFor,
  navigate,
  screenshot,
  pressKey,
  tabUntil,
} = require('./lib/runtime');
const { CdpClient } = require('./lib/cdp');
const {
  parseScenarioArgs,
  scenarioSelectionOutcome,
  filteredEvidencePath,
  runScenarioSelection,
} = require('./lib/scenario-filter');

const SCRIPT_NAME = 'run-menu-review-browser-check.js';
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(__dirname, 'output');
const EVIDENCE_DIR = path.join(__dirname, 'evidence');
const BASE_EVIDENCE_PATH = path.join(EVIDENCE_DIR, 'menu-review-browser-evidence.json');
const PORT = Number(process.env.BROWSER_FIXTURE_PORT || 3137);
const APP_ORIGINS = defaultAppOrigins(PORT);
const BATCH_URL = `http://localhost:${PORT}/internal/bronnen/batch`;
const MANUAL_URL = `http://localhost:${PORT}/internal/menu-import`;
const BATCH_QUERY = `batch=${encodeURIComponent(fixtures.BATCH_ID)}`;
const CONCEPTS_URL = `http://localhost:${PORT}/internal/menu-concepts`;
const CONCEPT_DETAIL = (id) => `${CONCEPTS_URL}/${encodeURIComponent(id)}`;

const checks = [];
const screenshotFiles = [];
const clickpaths = [];
let networkGuard = null;
let networkEvidence = null;
let forcedWriteEvidence = null;
let scenarioRuns = null;

function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail: detail === undefined ? null : String(detail) });
}

/** #RGB/#RRGGBB with a light luminance: the light theme is active. */
function isLightBackground(value) {
  const hex = String(value || '').trim().replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.8;
}

function recordClickpath(name, steps, passed, detail) {
  clickpaths.push({ name, steps, passed: Boolean(passed), detail: detail === undefined ? null : String(detail) });
}

async function setViewport(cdp, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 600,
  });
}

function reviewUrl({ theme, item }) {
  const params = new URLSearchParams({ fixture: 'review', batch: fixtures.BATCH_ID, theme });
  if (item) params.set('item', '1');
  return `${BATCH_URL}?${params.toString()}`;
}

async function openRoute(cdp, url, readyExpression) {
  await navigate(cdp, url, readyExpression);
  const bootError = await evalJs(cdp, 'window.__FIXTURE_BOOT_ERROR__ || null');
  check(`fixture bootstrap without error (${url})`, !bootError, bootError || 'ok');
  const violations = await evalJs(cdp, `(window.__FIXTURE_NETWORK_VIOLATIONS__ || []).filter((entry) => entry.phase === 'app')`);
  check(`fixture network: no blocked app traffic (${url})`, violations.length === 0, JSON.stringify(violations.slice(0, 3)));
}

async function bodyText(cdp) {
  return evalJs(cdp, 'document.body ? document.body.innerText : ""');
}

async function clickButton(cdp, text) {
  return evalJs(cdp, `(() => {
    const button = [...document.querySelectorAll('button')].find((el) => el.innerText.trim().includes(${JSON.stringify(text)}));
    if (!button) return false;
    button.click();
    return true;
  })()`);
}

async function clickLink(cdp, label) {
  return evalJs(cdp, `(() => {
    const link = [...document.querySelectorAll('a')].find((el) => (el.innerText || '').trim() === ${JSON.stringify(label)});
    if (!link) return null;
    const href = link.getAttribute('href');
    link.click();
    return href;
  })()`);
}

async function openAllDetails(cdp) {
  return evalJs(cdp, `(() => {
    for (let pass = 0; pass < 4; pass += 1) {
      for (const summary of document.querySelectorAll('details:not([open]) > summary')) summary.click();
    }
    return true;
  })()`);
}

async function waitForPath(cdp, pathname, contains = '', timeoutMs = 30000) {
  return waitFor(
    cdp,
    `location.pathname === ${JSON.stringify(pathname)} && Boolean(document.body) && document.body.innerText.includes(${JSON.stringify(contains || '')})`,
    timeoutMs,
  );
}

function conceptUrl({ fixture, theme, id }) {
  const base = id ? CONCEPT_DETAIL(id) : CONCEPTS_URL;
  const params = new URLSearchParams();
  if (fixture) params.set('fixture', fixture);
  if (theme) params.set('theme', theme);
  return params.size > 0 ? `${base}?${params.toString()}` : base;
}

async function reviewScenario(cdp) {
  await setViewport(cdp, 1024, 900);
  await openRoute(cdp, reviewUrl({ theme: 'light' }), `document.body.innerText.includes('Fictief Brasserie Noord')`);

  const before = await bodyText(cdp);
  check('review: result card and exact source URL are visible', before.includes('https://fictief-restaurant.invalid/') && before.includes('https://fictief-bron.invalid/menu'));
  check('review: control is collapsed before the click path', !before.includes('8 gerechten in 4 menukopjes'));

  const clicked = await clickButton(cdp, 'Menukaart controleren');
  check('review: "Menukaart controleren" is a real button', clicked);
  const expanded = await waitFor(cdp, `document.body.innerText.includes('8 gerechten in 4 menukopjes')`, 15000);
  check('review: click opens the recognised menu', expanded);

  // Open every section through its own summary, so the assertions below see
  // what a reviewer actually sees after the real click path (a closed
  // <details> is not visible text).
  await evalJs(cdp, `(() => {
    for (const summary of document.querySelectorAll('details.bta-category > summary')) {
      if (!summary.parentElement.open) summary.click();
    }
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 300));

  const snapshot = await evalJs(cdp, `(() => {
    const text = document.body.innerText;
    const links = [...document.querySelectorAll('a')].map((a) => ({
      href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel'), text: (a.innerText || '').trim(),
    }));
    const buttons = [...document.querySelectorAll('button')].map((b) => ({
      text: (b.innerText || '').trim(), expanded: b.getAttribute('aria-expanded'), ariaDisabled: b.getAttribute('aria-disabled'),
    }));
    return {
      text, links, buttons,
      save: buttons.find((b) => b.text.includes('Concept opslaan')) || null,
      theme: document.documentElement.getAttribute('data-theme'),
      bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim().toLowerCase(),
      url: location.href,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      groupButtons: buttons.filter((b) => b.text === 'Menukopje klopt zo').length,
    };
  })()`);

  const text = snapshot.text;
  check('review: item and section counts come from the fixture', text.includes('8 gerechten in 4 menukopjes'));
  check('review: original section paths are shown', text.includes('Fictief Lunch › Koud') && text.includes('Fictief Diner › Hoofd'));
  check('review: prices are shown per dish', ['€ 12,50', '€ 8,00', '€ 14,50', '€ 24,00'].every((price) => text.includes(price)));
  check('review: multiple undecomposed prices stay explicit', text.includes('9.50 / 18.00 · meerdere prijzen'));
  check('review: a missing price is not zero', text.includes('geen prijs') && !text.includes('€ 0,00'));
  check('review: duplicate, price and missing-price attention are visible', ['Komt meer dan eens voor', 'Meerdere prijzen', 'Prijs ontbreekt'].every((reason) => text.includes(reason)));
  check('review: shared uncertainty is grouped per section', text.includes('Fictief Lunch › Warm') && text.includes('Fictief Diner › Voor') && text.includes('2 gedeelde onzekerheden'));
  check('review: concept is internal and blocked, not savable', text.includes('Menuconcept · intern') && text.includes('6 blokkades') && text.includes('Kan pas zonder blokkades.'));
  check('review: save is disabled while blockers remain', snapshot.save && snapshot.save.ariaDisabled === 'true', snapshot.save && snapshot.save.ariaDisabled);
  check('review: group action is per section and not accept-all', snapshot.groupButtons === 2 && !/alles accepteren|accepteer alles|alles goedkeuren/i.test(text), `groupButtons=${snapshot.groupButtons}`);
  check('review: coverage and limitations are visible', text.includes('8 gerechten uit 1 bron gelezen; controle nodig.') && text.includes('arrangementen en supplementen worden niet als gerecht opgeslagen'));

  const breadcrumb = snapshot.links.find((link) => link.href === '/internal/bronnen');
  const original = snapshot.links.find((link) => link.href === fixtures.FOUND_URL);
  const review = snapshot.links.find((link) => link.href === `/internal/bronnen/batch?${BATCH_QUERY}&item=1`);
  check('review: breadcrumb link is exact', Boolean(breadcrumb), breadcrumb && breadcrumb.text);
  check('review: original menu link is exact and safe', original && original.target === '_blank' && original.rel.includes('noopener') && original.rel.includes('noreferrer'));
  check('review: "handmatig beoordelen" opens the same batch item', Boolean(review), review && review.href);
  // The light `--bg` token is #FFFFFF since BE-28 ("frisse publieke stijl");
  // this check only needs to prove the light theme is active, not one exact hex.
  check('review: light theme is active', snapshot.theme === 'light' && isLightBackground(snapshot.bg), `${snapshot.theme}/${snapshot.bg}`);
  check('review: address bar keeps the batch context', snapshot.url.includes(`batch=${fixtures.BATCH_ID}`), snapshot.url);
  check('review: no horizontal overflow at 1024 px', snapshot.overflow <= 0, `overflow=${snapshot.overflow}`);

  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'menu-review-desktop-light.png'));

  const closed = await clickButton(cdp, 'Controle sluiten');
  const collapsed = closed && (await waitFor(cdp, `!document.body.innerText.includes('8 gerechten in 4 menukopjes')`, 10000));
  check('review: "Controle sluiten" closes the same panel', collapsed);
}


async function readOnlyScenario(cdp) {
  await setViewport(cdp, 1024, 900);
  await openRoute(cdp, `${BATCH_URL}?fixture=readonly&${BATCH_QUERY}&item=1&theme=dark`, `document.body.innerText.includes('8 gerechten in 4 menukopjes')`);
  const snapshot = await evalJs(cdp, `(() => {
    const text = document.body.innerText;
    const buttons = [...document.querySelectorAll('button')].map((b) => (b.innerText || '').trim());
    return { text, buttons, overflow: document.documentElement.scrollWidth - window.innerWidth };
  })()`);
  check('readonly: colleague view is explicitly read-only', snapshot.text.includes('alleen lezen') && !snapshot.text.includes('Gestart door jou'));
  check('readonly: no save or group-accept control is offered', !snapshot.buttons.some((text) => text.includes('Concept opslaan') || text === 'Menukopje klopt zo'));
  check('readonly: no source confirmation is offered', !snapshot.buttons.some((text) => text.includes('Bevestig')));
  check('readonly: the same concept and blockers are readable', snapshot.text.includes('Menuconcept · intern') && snapshot.text.includes('6 blokkades'));
  check('readonly: no horizontal overflow at 1024 px', snapshot.overflow <= 0, `overflow=${snapshot.overflow}`);
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'menu-review-readonly-1024-dark.png'));
}

async function emptyScenario(cdp) {
  await setViewport(cdp, 1024, 900);
  await openRoute(cdp, `${BATCH_URL}?fixture=empty&theme=dark`, `document.body.innerText.includes("URL's invoeren")`);
  const snapshot = await evalJs(cdp, `(() => ({
    text: document.body.innerText,
    textarea: Boolean(document.querySelector('textarea#bta-urls')),
    label: (document.querySelector('label[for="bta-urls"]') || {}).innerText || '',
    theme: document.documentElement.getAttribute('data-theme'),
  }))()`);
  check('empty: the real URL input is present and labelled', snapshot.textarea && snapshot.label.includes("Restaurant-URL's"), snapshot.label);
  check('empty: the empty recent-batches state is honest', snapshot.text.includes('Nog geen batches') && snapshot.text.includes("0 van 25 URL's gebruikt"));
  check('empty: no fabricated result is shown', !snapshot.text.includes('Fictief Brasserie Noord'));
  check('empty: dark theme is active', snapshot.theme === 'dark');
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'menu-review-empty-dark.png'));
}

async function partialScenario(cdp) {
  await setViewport(cdp, 390, 900);
  await openRoute(cdp, `${BATCH_URL}?fixture=partial&${BATCH_QUERY}&item=1&theme=dark`, `document.body.innerText.includes('Geen herkende gerechten')`);
  const snapshot = await evalJs(cdp, `(() => ({
    text: document.body.innerText,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  }))()`);
  check('partial: a found source with zero items is not a success', snapshot.text.includes('Bron gevonden, maar er zijn geen gerechten met een betrouwbare prijs herkend. Dit is geen geslaagde extractie.'));
  check('partial: the limitation is visible', snapshot.text.includes('arrangementen en supplementen worden niet als gerecht opgeslagen'));
  check('partial: no concept is offered for an empty result', !snapshot.text.includes('Menuconcept · intern'));
  check('partial: no horizontal overflow at 390 px', snapshot.overflow <= 0, `overflow=${snapshot.overflow}`);
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'menu-review-partial-390-dark.png'));
}

async function imageOnlyScenario(cdp) {
  await setViewport(cdp, 390, 900);
  await openRoute(
    cdp,
    `${BATCH_URL}?fixture=image_only&${BATCH_QUERY}&item=1&theme=light&aiState=off`,
    `document.body.innerText.includes('Menu alleen als afbeelding · lees met AI of met de hand')`,
  );
  const snapshot = await evalJs(cdp, `(() => {
    const text = document.body.innerText;
    const link = [...document.querySelectorAll('a')].find((a) => (a.innerText || '').trim() === 'Bronnen beoordelen');
    const confirm = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').includes('Bevestig bron'));
    return {
      text,
      link: link ? link.getAttribute('href') : null,
      hasConfirm: Boolean(confirm),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      theme: document.documentElement.getAttribute('data-theme'),
    };
  })()`);
  check('image-only: the honest image/scan status is shown', snapshot.text.includes('Menu alleen als afbeelding · lees met AI of met de hand'));
  check('image-only: no successful extraction is claimed', !snapshot.text.includes('Menukaart gevonden') && !snapshot.text.includes('Bron bevestigd'));
  check('image-only: the reason stays visible', snapshot.text.includes('beeldanalyse/OCR is niet geconfigureerd'));
  check('image-only: no confirm action is offered', !snapshot.hasConfirm);
  check(
    'image-only: the human route is linked with restaurant and reason',
    snapshot.link === '/internal/bronnen?restaurant=9001&reason=image_only',
    snapshot.link,
  );
  check('image-only: no horizontal overflow at 390 px', snapshot.overflow <= 0, `overflow=${snapshot.overflow}`);
  check('image-only: light theme is active', snapshot.theme === 'light');
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'menu-review-image-only-390-light.png'));

  await setViewport(cdp, 320, 900);
  await openRoute(
    cdp,
    `${BATCH_URL}?fixture=image_only&${BATCH_QUERY}&item=1&theme=dark&aiState=off`,
    `document.body.innerText.includes('Menu alleen als afbeelding · lees met AI of met de hand')`,
  );
  const small = await evalJs(cdp, `(() => ({
    text: document.body.innerText,
    theme: document.documentElement.getAttribute('data-theme'),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  }))()`);
  check('image-only: the status and reason also hold at 320 px/dark', small.text.includes('Menu alleen als afbeelding · lees met AI of met de hand') && small.text.includes('beeldanalyse/OCR is niet geconfigureerd'));
  check('image-only: no horizontal overflow at 320 px', small.overflow <= 0, `overflow=${small.overflow}`);
  check('image-only: dark theme is active at 320 px', small.theme === 'dark');
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'menu-review-image-only-320-dark.png'));

  // BE-40 (#95): the current next step of an image-only row is the one on the
  // row itself (BE-33/BE-35): "Lees met AI (afbeelding)" when the AI may read an
  // image, otherwise the honest reason plus "Voeg de gerechten handmatig toe".
  // The old `mark_unusable` proposal is not reachable from this link: since
  // BE-31 an image-only result is a dead end and therefore not a task on
  // /internal/bronnen (src/lib/sourceReview.js DEAD_END_STATES). That missing
  // restaurant detail is reported as a finding, not papered over here.
  const aiOff = await evalJs(cdp, `(() => {
    const links = [...document.querySelectorAll('a')].map((a) => ({ text: (a.innerText || '').trim(), href: a.getAttribute('href') }));
    return {
      text: document.body.innerText,
      manual: links.find((link) => link.text === 'Voeg de gerechten handmatig toe') || null,
      aiRead: links.some((link) => link.text.includes('Lees met AI')),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  })()`);
  check(
    'image-only: without the AI the row names the real reason',
    aiOff.text.includes('AI is nu niet beschikbaar, dus een afbeelding kan nu niet gelezen worden.') &&
      aiOff.text.includes('of kies een andere bron.'),
    aiOff.text.slice(0, 200),
  );
  check(
    'image-only: the manual route opens the existing import screen with this restaurant',
    Boolean(aiOff.manual) && aiOff.manual.href === '/internal/menu-import?restaurant=9001&name=Fictief%20Brasserie%20Noord',
    aiOff.manual ? aiOff.manual.href : 'no manual link',
  );
  check('image-only: no AI reading is offered while the AI is off', aiOff.aiRead === false, String(aiOff.aiRead));
  check('image-only: the manual row still fits at 320 px', aiOff.overflow <= 0, `overflow=${aiOff.overflow}`);

  // The same row with the existing AI status route answering "on": the AI may
  // read an image page by page, so the row offers that reading.
  await setViewport(cdp, 390, 900);
  await openRoute(
    cdp,
    `${BATCH_URL}?fixture=image_only&${BATCH_QUERY}&item=1&theme=light&aiState=ready`,
    `document.body.innerText.includes('Lees met AI (afbeelding)')`,
  );
  const aiOn = await evalJs(cdp, `(() => {
    const link = [...document.querySelectorAll('a')].find((a) => (a.innerText || '').trim() === '📷 Lees met AI (afbeelding)');
    const links = [...document.querySelectorAll('a')].map((a) => (a.innerText || '').trim());
    return {
      text: document.body.innerText,
      href: link ? link.getAttribute('href') : null,
      hasManualAlternative: links.includes('Liever zelf invoeren of plakken'),
      hasOffReason: document.body.innerText.includes('AI is nu niet beschikbaar, dus een afbeelding kan nu niet gelezen worden.'),
    };
  })()`);
  check(
    'image-only: with the AI available the row offers "Lees met AI (afbeelding)"',
    Boolean(aiOn.href) && aiOn.href.startsWith('/internal/menu-import?job=job-fictief-1'),
    String(aiOn.href),
  );
  check(
    'image-only: the AI reading keeps the restaurant and asks for the image',
    Boolean(aiOn.href) && aiOn.href.includes('restaurant=9001') && aiOn.href.includes('image=1'),
    String(aiOn.href),
  );
  check(
    'image-only: the AI route states its per-page estimate',
    aiOn.text.includes('Kost ongeveer 1 cent per afbeelding of pagina · duurt ± 1 minuut'),
    aiOn.text.slice(0, 200),
  );
  check('image-only: the manual alternative stays one click away', aiOn.hasManualAlternative && aiOn.hasOffReason === false);

  // The follow-up link keeps its context and reaches the existing Bronnen
  // beoordelen screen, which names the same reason and next step in its batch
  // banner. No concept, proposal or publication is created by any of this.
  const steps = [{ action: 'open batch result', reached: true }];
  const clicked = await clickLink(cdp, 'Bronnen beoordelen');
  const arrived = await waitForPath(cdp, '/internal/bronnen', 'Bronnen beoordelen', 30000);
  steps.push({ action: 'click Bronnen beoordelen', href: clicked, reached: Boolean(clicked), arrived });
  // The screen shows the follow-up in the chosen task's own follow-up block
  // while that task is selected, and in the page banner once nothing is
  // selected. Both are the product's own copy, and between the two states there
  // is a short window in which neither element exists (the page even shows
  // "Laden…" and then "Niets te doen" for a moment). Two separate reads could
  // therefore both come back empty — that is the race this check kept hitting —
  // so the copy is polled and captured in one page evaluation instead.
  const followUpText = await evalJs(cdp, `(async () => {
    const read = () => {
      const banner = document.querySelector('.di-banner-neutral[role="note"]');
      const detail = document.querySelector('.stg-followup');
      return [banner, detail].filter(Boolean).map((el) => el.innerText || '').join('\\n').trim();
    };
    const reason = ${JSON.stringify(FOLLOW_UP.reason)};
    const nextStep = ${JSON.stringify(FOLLOW_UP.nextStep)};
    const deadline = Date.now() + 20000;
    let text = read();
    while (!(text.includes(reason) && text.includes(nextStep)) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      text = read();
    }
    return text;
  })()`);
  const followUpReady = followUpText.includes(FOLLOW_UP.reason) && followUpText.includes(FOLLOW_UP.nextStep);
  steps.push({ action: 'batch follow-up shown (banner or task block)', reached: followUpReady, detail: followUpText.slice(0, 120) });
  const triage = await evalJs(cdp, `(() => ({
    pathname: location.pathname,
    search: location.search,
    text: document.body.innerText,
    banner: (document.querySelector('.di-banner-neutral[role="note"]') || {}).innerText || '',
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  }))()`);
  check('image-only follow-up: the existing Bronnen beoordelen page opens', arrived && triage.pathname === '/internal/bronnen');
  check('image-only follow-up: the context is kept in the address bar', triage.search.includes('restaurant=9001') && triage.search.includes('reason=image_only'));
  check(
    'image-only follow-up: the page names the reason and the next step in its own words',
    followUpText.includes(FOLLOW_UP.reason) && followUpText.includes(FOLLOW_UP.nextStep),
    followUpText.slice(0, 160),
  );
  check(
    'image-only follow-up: the batch banner announces itself when the banner is what shows it',
    triage.banner === '' || triage.banner.includes('Vervolg van de batchanalyse:'),
    triage.banner.slice(0, 160),
  );
  check('image-only follow-up: no menu status or confirmation is claimed', !triage.text.includes('Bron bevestigd') && !triage.text.includes('Menukaart gevonden'));
  check('image-only follow-up: the follow-up screen fits at 390 px', triage.overflow <= 0, `overflow=${triage.overflow}`);
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'menu-review-image-only-follow-up-390-light.png'));

  recordClickpath('image-only result -> Bronnen beoordelen', steps, steps.every((step) => step.reached !== false && step.arrived !== false), JSON.stringify(steps));
}


async function tabUntilInput(cdp, matches, maxTabs = 80) {
  const seen = [];
  for (let i = 0; i < maxTabs; i += 1) {
    await pressKey(cdp, 'Tab', 'Tab', 9);
    const info = await evalJs(cdp, `(() => {
      const el = document.activeElement;
      if (!el) return null;
      return { tag: el.tagName, type: el.getAttribute('type'), id: el.id, text: (el.innerText || '').trim().slice(0, 80) };
    })()`);
    if (info) {
      seen.push(info);
      if (matches(info)) return { info, tabs: i + 1, seen };
    }
  }
  return { info: null, tabs: maxTabs, seen };
}

// #59 review 6307703713: an uncertain section structure must be reviewable per
// section and only then confirmable. The harness drives the real control; the
// final confirmation POST is deliberately not sent (the guard refuses writes
// and the server re-check is covered by the unit regressions).
async function structureScenario(cdp) {
  const url = (theme) => `${BATCH_URL}?fixture=structure&${BATCH_QUERY}&item=1&theme=${theme}`;
  await setViewport(cdp, 1024, 900);
  await openRoute(cdp, url('light'), `document.body.innerText.includes('Menukopjes controleren')`);

  const initial = await evalJs(cdp, `(() => {
    const text = document.body.innerText;
    const buttons = [...document.querySelectorAll('button')].map((b) => ({ text: (b.innerText || '').trim(), disabled: b.disabled }));
    const radios = [...document.querySelectorAll('.bta-structure-choices input[type="radio"]')].map((r) => ({ name: r.name, checked: r.checked, disabled: r.disabled }));
    const rows = [...document.querySelectorAll('.bta-structure-row')].map((row) => (row.innerText || '').trim());
    return {
      text, buttons, radios, rows,
      theme: document.documentElement.getAttribute('data-theme'),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  })()`);
  check('structure: the existing "Menukaart controleren" path shows the section control', initial.text.includes('Menukopjes controleren'));
  // BE-30 (#72): the route, locator, dishes and page link live in the opened
  // section; the collapsed summary keeps only the label and the count.
  const expandedRows = await evalJs(cdp, `(() => {
    for (const details of document.querySelectorAll('.bta-structure-section')) details.open = true;
    return [...document.querySelectorAll('.bta-structure-row')].map((row) => (row.innerText || '').trim());
  })()`);
  check(
    'structure: each uncertain section carries its path, source route and locator',
    expandedRows.length === 2 &&
      expandedRows[0].includes(fixtures.structureSections[0].label) &&
      expandedRows[0].includes(fixtures.structureSections[0].sourceRoute) &&
      expandedRows[0].includes(fixtures.structureSections[0].locator) &&
      expandedRows[1].includes(fixtures.structureSections[1].label) &&
      expandedRows[1].includes(fixtures.structureSections[1].locator),
    JSON.stringify(expandedRows),
  );
  check('structure: nothing is treated before the human acts', initial.radios.length === 4 && initial.radios.every((r) => !r.checked));
  check('structure: the progress counter starts at 0 van 2', initial.text.includes('0 van 2 behandeld'));
  check(
    'structure: no one-click confirmation is offered before handling',
    !initial.buttons.some((b) => b.text.includes('Bevestig bron')),
    JSON.stringify(initial.buttons.map((b) => b.text)),
  );
  check('structure: the bulk action only fills choices, it never approves', initial.text.includes('Alles klopt zo') && !/automatisch bevestigd|alles accepteren/i.test(initial.text));
  check('structure: light theme is active', initial.theme === 'light');
  check('structure: no horizontal overflow at 1024 px', initial.overflow <= 0, `overflow=${initial.overflow}`);

  const keptFirst = await evalJs(cdp, `(() => {
    const row = document.querySelectorAll('.bta-structure-row')[0];
    const radio = row && row.querySelector('input[type="radio"]');
    if (!radio) return false;
    radio.click();
    return true;
  })()`);
  await waitFor(cdp, `document.body.innerText.includes('1 van 2 behandeld')`, 10000);

  const correctSecond = await evalJs(cdp, `(() => {
    const row = document.querySelectorAll('.bta-structure-row')[1];
    const radios = row ? row.querySelectorAll('input[type="radio"]') : [];
    if (!radios[1]) return false;
    radios[1].click();
    return true;
  })()`);
  const inputReady = await waitFor(cdp, `Boolean(document.querySelector('input[id$="-structure-1-path"]'))`, 10000);
  const typed = await evalJs(cdp, `(() => {
    const input = document.querySelector('input[id$="-structure-1-path"]');
    if (!input) return false;
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Fictief Diner › Voorgerechten');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  const completed = await waitFor(cdp, `document.body.innerText.includes('2 van 2 behandeld')`, 10000);

  const handled = await evalJs(cdp, `(() => {
    const buttons = [...document.querySelectorAll('button')].map((b) => ({ text: (b.innerText || '').trim(), disabled: b.disabled }));
    const input = document.querySelector('input[id$="-structure-1-path"]');
    return { buttons, value: input ? input.value : null, invalid: input ? input.getAttribute('aria-invalid') : null };
  })()`);
  const confirmTrigger = handled.buttons.find((b) => b.text === 'Bevestig bron');
  check('structure: handling one section is not enough', keptFirst === true && correctSecond === true);
  check('structure: correcting a section opens a labelled path field', inputReady && typed === true);
  check('structure: all sections treated only after a real corrected path', completed && handled.value === 'Fictief Diner › Voorgerechten' && handled.invalid === null);
  check('structure: the confirm control appears only now and is enabled', Boolean(confirmTrigger) && confirmTrigger.disabled === false, JSON.stringify(confirmTrigger));

  const opened = await clickButton(cdp, 'Bevestig bron');
  const panel = opened && (await waitFor(cdp, `document.body.innerText.includes('2 onzekere menukopjes behandeld')`, 10000));
  const panelText = await bodyText(cdp);
  check(
    'structure: the confirmation shows the handled decisions before writing',
    panel && panelText.includes('1 gehandhaafd') && panelText.includes('1 gecorrigeerd'),
    panelText.slice(0, 300),
  );
  const violations = await evalJs(cdp, `(window.__FIXTURE_NETWORK_VIOLATIONS__ || []).filter((entry) => entry.phase === 'app')`);
  check('structure: no write request leaves the browser in the fixture', violations.length === 0, JSON.stringify(violations.slice(0, 3)));
  recordClickpath(
    'batch result -> Menukaart controleren -> keep/correct each uncertain section -> Bevestig bron (panel only)',
    [
      { step: 'uncertain result opens the section control', arrived: initial.text.includes('Menukopjes controleren') },
      { step: 'keep the first uncertain section', arrived: keptFirst === true },
      { step: 'correct the second uncertain section with a path', arrived: Boolean(inputReady && typed) },
      { step: 'all sections treated', arrived: completed === true },
      { step: 'confirmation panel shows the handled decisions', arrived: Boolean(panel) },
    ],
    Boolean(panel),
    JSON.stringify({ required: fixtures.structureSections.map((section) => section.label) }),
  );
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'menu-review-structure-1024-light.png'));

  // Keyboard: a fresh page at 390 px. A section body is collapsed by default, so
  // the keyboard route is: Tab to the section summary, Enter opens it, then Tab
  // to the decision radio and Space selects it.
  await setViewport(cdp, 390, 900);
  await openRoute(cdp, url('light'), `document.body.innerText.includes('Menukopjes controleren')`);
  const summaryReach = await tabUntilInput(cdp, (info) => info.tag === 'SUMMARY');
  let keyboardOk = false;
  let radioReach = null;
  if (summaryReach.info) {
    await pressKey(cdp, 'Enter', 'Enter', 13, '\r');
    const openedSummary = await waitFor(cdp, `Boolean(document.querySelector('.bta-structure-section[open]'))`, 5000);
    if (openedSummary) {
      radioReach = await tabUntilInput(cdp, (info) => info.tag === 'INPUT' && info.type === 'radio');
      if (radioReach.info) {
        await pressKey(cdp, ' ', 'Space', 32, ' ');
        const selected = await waitFor(cdp, `document.body.innerText.includes('1 van 2 behandeld')`, 10000);
        const checked = await evalJs(cdp, `Boolean(document.querySelector('.bta-structure-choices input[type="radio"]:checked'))`);
        keyboardOk = selected && checked;
      }
    }
  }
  check(
    'structure keyboard: Enter opens a section and Space selects its decision',
    keyboardOk,
    summaryReach.info ? `tabs=${summaryReach.tabs} radioTabs=${radioReach ? radioReach.tabs : 'none'}` : JSON.stringify(summaryReach.seen.slice(-6)),
  );
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'menu-review-structure-keyboard-390-light.png'));

  // Responsive: 390 px in both themes, with the correction field open.
  for (const theme of ['light', 'dark']) {
    await setViewport(cdp, 390, 900);
    await openRoute(cdp, url(theme), `document.body.innerText.includes('Menukopjes controleren')`);
    await evalJs(cdp, `(() => {
      for (const row of document.querySelectorAll('.bta-structure-row')) {
        const radios = row.querySelectorAll('input[type="radio"]');
        if (radios[1]) radios[1].click();
      }
      return true;
    })()`);
    await waitFor(cdp, `Boolean(document.querySelector('input[id$="-structure-1-path"]'))`, 10000);
    const snapshot = await evalJs(cdp, `(() => ({
      theme: document.documentElement.getAttribute('data-theme'),
      bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim().toLowerCase(),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      inputWidth: (document.querySelector('input[id$="-structure-1-path"]') || {}).clientWidth || 0,
    }))()`);
    check(`structure ${theme}: the requested theme is active`, snapshot.theme === theme, snapshot.theme);
    check(`structure ${theme}: no horizontal overflow at 390 px`, snapshot.overflow <= 0, `overflow=${snapshot.overflow}`);
    check(`structure ${theme}: the correction field stays inside the viewport`, snapshot.inputWidth > 0 && snapshot.inputWidth <= 390, `width=${snapshot.inputWidth}`);
    screenshotFiles.push(await screenshot(cdp, OUT_DIR, `menu-review-structure-390-${theme}.png`));
  }

  // A colleague sees the same result read-only and never gets a confirmation.
  await setViewport(cdp, 1024, 900);
  await openRoute(
    cdp,
    `${BATCH_URL}?fixture=structure-readonly&${BATCH_QUERY}&item=1&theme=dark`,
    `document.body.innerText.includes('Menukopjes controleren')`,
  );
  const readonly = await evalJs(cdp, `(() => ({
    text: document.body.innerText,
    buttons: [...document.querySelectorAll('button')].map((b) => (b.innerText || '').trim()),
    disabledRadios: [...document.querySelectorAll('.bta-structure-choices input[type="radio"]')].every((r) => r.disabled),
  }))()`);
  check('structure readonly: the same sections stay readable', readonly.text.includes(fixtures.structureSections[0].label));
  check('structure readonly: the decisions are disabled and no confirmation is offered', readonly.disabledRadios && !readonly.buttons.some((text) => text.includes('Bevestig')));
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'menu-review-structure-readonly-1024-dark.png'));
}
// BE-30 (#72): the same section control with its dishes, the reason, the page
// link, the stored AI advice and the bulk confirmation — 1280 and 390 px, light
// and dark. FIXTURE evidence only; no provider, credential or write is used.
async function be30Scenario(cdp) {
  const url = (fixture, theme) => `${BATCH_URL}?fixture=${fixture}&${BATCH_QUERY}&item=1&theme=${theme}`;
  const sections = fixtures.structure8Sections;
  for (const [width, theme] of [[1280, 'light'], [1280, 'dark'], [390, 'light'], [390, 'dark']]) {
    await setViewport(cdp, width, 900);

    // 1. Without AI advice: collapsed, then opened.
    await openRoute(cdp, url('structure8', theme), `document.body.innerText.includes('Menukopjes controleren')`);
    const collapsed = await evalJs(cdp, `(() => {
      const section = document.querySelector('.bta-structure-section');
      const body = section ? section.querySelector('.bta-structure-body') : null;
      const dishes = body ? body.querySelector('.bta-structure-dishes') : null;
      return {
        text: document.body.innerText,
        sections: document.querySelectorAll('.bta-structure-section').length,
        open: [...document.querySelectorAll('.bta-structure-section')].filter((d) => d.open).length,
        bodyRendered: body ? body.getClientRects().length > 0 : null,
        bodyPresent: Boolean(body),
        bodyText: body ? (body.innerText || '').trim() : null,
        dishRendered: dishes ? dishes.getClientRects().length > 0 : null,
        bulk: ([...document.querySelectorAll('.bta-structure-bulk button')][0] || {}).innerText || '',
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    })()`);
    check(`be30 ${width}-${theme}: eight uncertain sections, all collapsed`, collapsed.sections === 8 && collapsed.open === 0, `${collapsed.sections}/${collapsed.open}`);
    check(
      `be30 ${width}-${theme}: a section body only appears when the reviewer opens it`,
      collapsed.open === 0 && collapsed.bodyPresent === true,
      JSON.stringify({ open: collapsed.open, body: collapsed.bodyPresent }),
    );
    check(`be30 ${width}-${theme}: the bulk action is "Alles klopt zo" without advice`, collapsed.bulk.trim() === 'Alles klopt zo', collapsed.bulk);
    check(`be30 ${width}-${theme}: no horizontal overflow (collapsed)`, collapsed.overflow <= 0, `overflow=${collapsed.overflow}`);
    screenshotFiles.push(await screenshot(cdp, OUT_DIR, `be-30-structure-collapsed-${width}-${theme}.png`));

    await evalJs(cdp, `(() => { document.querySelectorAll('.bta-structure-section').forEach((d) => { d.open = true; }); return true; })()`);
    const expanded = await evalJs(cdp, `(() => {
      const row = document.querySelectorAll('.bta-structure-row')[0];
      const link = row ? row.querySelector('.bta-structure-link') : null;
      return {
        text: document.body.innerText,
        linkText: link ? link.innerText.trim() : null,
        linkHref: link ? link.getAttribute('href') : null,
        dishes: row ? row.querySelectorAll('.bta-structure-dishes li').length : 0,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    })()`);
    check(
      `be30 ${width}-${theme}: an opened section shows its dishes with prices`,
      // MenuReview.js prints a price through its own `dutchPrice`: a Dutch
      // decimal comma, so the fixture's "13.00" is visible as "13,00".
      expanded.dishes === 2 && expanded.text.includes('Fictieve burrata') && expanded.text.includes('13,00'),
      JSON.stringify({ dishes: expanded.dishes }),
    );
    check(`be30 ${width}-${theme}: the doubt is explained in plain language`, expanded.text.includes(sections[0].reason), expanded.text.slice(0, 200));
    check(
      `be30 ${width}-${theme}: the pdf page link opens that page of the source`,
      expanded.linkHref === sections[0].sourceLink.url && expanded.linkText === sections[0].sourceLink.text,
      JSON.stringify({ href: expanded.linkHref, text: expanded.linkText }),
    );
    check(`be30 ${width}-${theme}: no horizontal overflow (expanded)`, expanded.overflow <= 0, `overflow=${expanded.overflow}`);
    screenshotFiles.push(await screenshot(cdp, OUT_DIR, `be-30-structure-expanded-${width}-${theme}.png`));
    // 2. With the stored advice: preselected, each with confidence and quote.
    await openRoute(cdp, url('structure8-advice', theme), `document.body.innerText.includes('Menukopjes controleren')`);
    const advised = await evalJs(cdp, `(() => ({
      checked: document.querySelectorAll('.bta-structure-choices input[type="radio"]:checked').length,
      quotes: document.querySelectorAll('.bta-advice-quote').length,
      confidence: [...document.querySelectorAll('.bta-advice-confidence')].map((el) => (el.textContent || '').trim()),
      bulk: ([...document.querySelectorAll('.bta-structure-bulk button')][0] || {}).innerText || '',
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    }))()`);
    check(`be30 ${width}-${theme}: six advices are preselected, the other two are not`, advised.checked === 6, `checked=${advised.checked}`);
    check(`be30 ${width}-${theme}: every advice shows its own literal quote`, advised.quotes === 6, `quotes=${advised.quotes}`);
    check(
      `be30 ${width}-${theme}: every advice shows its confidence`,
      advised.confidence.length === 6 && advised.confidence.every((text) => /zekerheid (hoog|midden)/.test(text)),
      JSON.stringify(advised.confidence.slice(0, 2)),
    );
    check(`be30 ${width}-${theme}: the bulk action becomes "Neem alle adviezen over"`, advised.bulk.trim() === 'Neem alle adviezen over', advised.bulk);
    check(`be30 ${width}-${theme}: no horizontal overflow with advice`, advised.overflow <= 0, `overflow=${advised.overflow}`);
    screenshotFiles.push(await screenshot(cdp, OUT_DIR, `be-30-structure-advice-${width}-${theme}.png`));

    await evalJs(cdp, `(() => { document.querySelectorAll('.bta-structure-section').forEach((d) => { d.open = true; }); return true; })()`);
    screenshotFiles.push(await screenshot(cdp, OUT_DIR, `be-30-structure-advice-expanded-${width}-${theme}.png`));

    // 3. One bulk confirmation that names the number of sections.
    const clicked = await clickButton(cdp, 'Neem alle adviezen over');
    const confirmReady = await waitFor(cdp, `document.body.innerText.includes('8 menukopjes bevestigen?')`, 10000);
    const confirmState = await evalJs(cdp, `(() => ({
      text: document.body.innerText,
      buttons: [...document.querySelectorAll('.bta-confirm button')].map((b) => ({ text: (b.innerText || '').trim(), disabled: b.disabled })),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    }))()`);
    const confirmButton = confirmState.buttons.find((button) => button.text === 'Bevestig bron');
    check(`be30 ${width}-${theme}: the bulk action asks one confirmation with the count`, clicked === true && confirmReady === true);
    check(`be30 ${width}-${theme}: the confirmation is explicit and not automatic`, Boolean(confirmButton) && confirmButton.disabled === false, JSON.stringify(confirmState.buttons));
    check(`be30 ${width}-${theme}: no horizontal overflow in the confirmation`, confirmState.overflow <= 0, `overflow=${confirmState.overflow}`);
    screenshotFiles.push(await screenshot(cdp, OUT_DIR, `be-30-structure-confirm-${width}-${theme}.png`));

    const violations = await evalJs(cdp, `(window.__FIXTURE_NETWORK_VIOLATIONS__ || []).filter((entry) => entry.phase === 'app')`);
    check(`be30 ${width}-${theme}: nothing leaves the browser and no advice call is made`, violations.length === 0, JSON.stringify(violations.slice(0, 3)));
    recordClickpath(
      `BE-30 ${width}-${theme}: rubriek openen -> gerechten en bronpagina -> AI-advies voorgeselecteerd -> alles overnemen -> bevestigingsstap`,
      [
        { step: 'eight uncertain sections, collapsed', arrived: collapsed.sections === 8 },
        { step: 'dishes, reason and pdf page link in the opened section', arrived: expanded.dishes === 2 && expanded.linkHref === sections[0].sourceLink.url },
        { step: 'advices preselected with quote and confidence', arrived: advised.checked === 6 && advised.quotes === 6 },
        { step: 'one confirmation that names 8 menukopjes', arrived: Boolean(confirmReady) },
      ],
      Boolean(confirmReady),
      JSON.stringify({ sections: sections.map((section) => section.label) }),
    );
  }
}




async function v2Scenario(cdp) {
  for (const [width, theme] of [[1024, 'light'], [390, 'dark']]) {
    await setViewport(cdp, width, 900);
    await openRoute(cdp, `${BATCH_URL}?fixture=v2&${BATCH_QUERY}&theme=${theme}`, `document.body.innerText.includes('Fictief Brasserie Noord')`);
    const controlReady = await waitFor(cdp, `[...document.querySelectorAll('button')].some((b) => (b.innerText || '').includes('Menukaart controleren'))`, 15000);
    const alreadyOpen = await evalJs(cdp, `document.body.innerText.includes('Controle sluiten')`);
    check(`v2 ${width}px/${theme}: the real review control is present`, controlReady || alreadyOpen === true, `${controlReady}/${alreadyOpen}`);
    if (controlReady) {
      const clicked = await clickButton(cdp, 'Menukaart controleren');
      check(`v2 ${width}px/${theme}: "Menukaart controleren" is a real button`, clicked === true, clicked);
    }
    const expanded = await waitFor(cdp, `document.body.innerText.includes('Fictieve wijn')`, 15000);
    check(`v2 ${width}px/${theme}: the versioned menu becomes readable`, expanded);
    await evalJs(cdp, `(() => {
      for (const summary of document.querySelectorAll('details.bta-category > summary')) {
        if (!summary.parentElement.open) summary.click();
      }
      return true;
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const snapshot = await evalJs(cdp, `(() => {
      const text = document.body.innerText;
      return {
        text,
        buttons: [...document.querySelectorAll('button')].map((b) => (b.innerText || '').trim()),
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        theme: document.documentElement.getAttribute('data-theme'),
      };
    })()`);
    const text = snapshot.text;
    check(`v2 ${width}px/${theme}: glass and bottle prices stay separate`, text.includes('Glas: € 6,50') && text.includes('Fles: € 25,00'));
    check(`v2 ${width}px/${theme}: no invented primary price is shown`, !text.includes('Vanaf €') && !text.includes('€ 0,00'));
    check(`v2 ${width}px/${theme}: supplement relation and limitation stay visible`, text.includes('Supplement') && text.includes('doel niet vastgelegd') && text.includes('Geen expliciet doelitem'));
    check(`v2 ${width}px/${theme}: unknown allergens stay unknown`, text.includes('Allergenen onbekend') && !text.includes('allergeenvrij'));
    check(`v2 ${width}px/${theme}: structural validity is not source verification`, text.includes('niet bronbevestigd'));
    check(`v2 ${width}px/${theme}: coverage limitation is visible`, text.includes('Fictieve v2-beperking'));
    check(`v2 ${width}px/${theme}: v2 is read-only, without a save or approve action`, !snapshot.buttons.some((b) => b.includes('Concept opslaan') || b.includes('Concept goedkeuren')) && text.includes('Alleen-lezen'));
    check(`v2 ${width}px/${theme}: requested theme is active`, snapshot.theme === theme, snapshot.theme);
    check(`v2 ${width}px/${theme}: no horizontal overflow`, snapshot.overflow <= 0, `overflow=${snapshot.overflow}`);
    screenshotFiles.push(await screenshot(cdp, OUT_DIR, `menu-review-v2-${width}-${theme}.png`));
  }
}


// ── Concept list and detail: real clicks through the existing pages ─────────
//
// The list anchor is a real `<a href>` from ConceptItem; the detail page is the
// real Next route/component. Each click drops the fixture query string, so the
// bootstrap selects the concept dataset from the path instead.

async function conceptListClickPath(cdp) {
  const ids = fixtures.CONCEPT_IDS;
  const names = fixtures.CONCEPT_RESTAURANTS;
  const steps = [];
  await setViewport(cdp, 1024, 900);
  await openRoute(cdp, conceptUrl({ theme: 'light' }), `document.body.innerText.includes(${JSON.stringify(names.v1)}) && document.body.innerText.includes(${JSON.stringify(names.empty)})`);
  const list = await evalJs(cdp, `(() => ({
    text: document.body.innerText,
    hrefs: [...document.querySelectorAll('a')].map((a) => ({ text: (a.innerText || '').trim(), href: a.getAttribute('href') })),
    theme: document.documentElement.getAttribute('data-theme'),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  }))()`);
  const hrefFor = (name) => (list.hrefs.find((entry) => entry.text === name) || {}).href;
  check('concept list: all four fictional rows are shown', [names.v1, names.v2, names.invalid, names.empty].every((name) => list.text.includes(name)), list.text.slice(0, 300));
  check('concept list: a valid v1 row is usable next to blocked rows', list.text.includes('3 gerechten') && !list.text.includes('Geen blokkades'));
  check('concept list: the v2 row is marked v2 and read-only', list.text.includes('v2 · alleen-lezen'));
  check('concept list: the unknown version row is marked read-only', list.text.includes('onbekende versie · alleen-lezen'));
  check('concept list: every row links to its own exact concept id', hrefFor(names.v1) === `/internal/menu-concepts/${ids.v1}`
    && hrefFor(names.v2) === `/internal/menu-concepts/${ids.v2}`
    && hrefFor(names.invalid) === `/internal/menu-concepts/${ids.invalid}`
    && hrefFor(names.empty) === `/internal/menu-concepts/${ids.empty}`, JSON.stringify(list.hrefs.filter((entry) => entry.href && entry.href.includes('menu-concepts'))));
  check('concept list: light theme and no horizontal overflow', list.theme === 'light' && list.overflow <= 0, `${list.theme}/${list.overflow}`);
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'concept-list-1024-light.png'));

  const v1Href = await clickLink(cdp, names.v1);
  const v1Arrived = await waitForPath(cdp, `/internal/menu-concepts/${ids.v1}`, 'Concept goedkeuren');
  steps.push({ action: 'click list row', target: names.v1, href: v1Href, pathname: `/internal/menu-concepts/${ids.v1}`, arrived: v1Arrived });
  check('concept click: valid v1 row opens its own detail id', v1Arrived && v1Href === `/internal/menu-concepts/${ids.v1}`, `${v1Href}/${v1Arrived}`);
  const v1 = await evalJs(cdp, `(() => {
    const approve = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').includes('Concept goedkeuren'));
    return {
      text: document.body.innerText,
      pathname: location.pathname,
      approve: Boolean(approve),
      approveDisabled: approve ? approve.getAttribute('aria-disabled') : 'missing',
      reject: [...document.querySelectorAll('button')].some((b) => (b.innerText || '').includes('Concept afwijzen')),
      sourceUrl: (document.querySelector('.bta-url') || {}).innerText || '',
    };
  })()`);
  check('concept v1: still usable - approve and reject are present and enabled', v1.approve && v1.approveDisabled !== 'true' && v1.reject, `approve=${v1.approve}/${v1.approveDisabled} reject=${v1.reject}`);
  check('concept v1: no blockers and the exact source URL is kept', v1.text.includes('Geen blokkades') && v1.sourceUrl.trim() === fixtures.SOURCE_URL, v1.sourceUrl);
  check('concept v1: the selected id did not jump to another row', v1.pathname === `/internal/menu-concepts/${ids.v1}` && v1.text.includes(names.v1) && !v1.text.includes(names.v2), v1.pathname);
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'concept-detail-v1-1024-clickpath.png'));

  const sourceTab = await clickButton(cdp, 'Bron');
  const sourceVisible = await waitFor(cdp, `document.body.innerText.includes(${JSON.stringify(fixtures.SOURCE_URL)})`, 10000);
  check('concept v1: the Bron tab keeps the exact source reference', sourceTab && sourceVisible, `${sourceTab}/${sourceVisible}`);
  const previewTab = await clickButton(cdp, 'Publicatievoorbeeld');
  const previewVisible = await waitFor(cdp, `document.body.innerText.includes('Nieuw concept') && document.body.innerText.includes('Fictieve tomatensoep')`, 10000);
  check('concept v1: the public preview still renders the stored dishes', previewTab && previewVisible, `${previewTab}/${previewVisible}`);

  const backHref = await clickLink(cdp, 'Menuconcepten beoordelen');
  const back = await waitForPath(cdp, '/internal/menu-concepts', names.v1);
  steps.push({ action: 'click breadcrumb back', href: backHref, pathname: '/internal/menu-concepts', arrived: back });
  check('concept click: back returns to the real list', back && backHref === '/internal/menu-concepts', `${backHref}/${back}`);

  const v2Href = await clickLink(cdp, names.v2);
  const v2Arrived = await waitForPath(cdp, `/internal/menu-concepts/${ids.v2}`, 'Alleen-lezen');
  await openAllDetails(cdp);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const v2 = await evalJs(cdp, `(() => ({
    text: document.body.innerText,
    pathname: location.pathname,
    buttons: [...document.querySelectorAll('button')].map((b) => (b.innerText || '').trim()),
  }))()`);
  steps.push({ action: 'click list row', target: names.v2, href: v2Href, pathname: `/internal/menu-concepts/${ids.v2}`, arrived: v2Arrived });
  check('concept click: the v2 row opens the v2 detail id', v2Arrived && v2Href === `/internal/menu-concepts/${ids.v2}`, `${v2Href}/${v2Arrived}`);
  check('concept v2: the raw stored v2 envelope is never shown as v1', v2.pathname === `/internal/menu-concepts/${ids.v2}` && v2.text.includes(names.v2) && v2.text.includes('Fictieve wijn') && !v2.buttons.some((b) => b.includes('Concept goedkeuren') || b.includes('Concept afwijzen') || b.includes('Concept opslaan')), `${v2.pathname}/${v2.buttons.join('|')}`);
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'concept-detail-v2-1024-clickpath.png'));

  const v2BackHref = await clickLink(cdp, 'Terug naar Menuconcepten beoordelen');
  const v2Back = await waitForPath(cdp, '/internal/menu-concepts', names.v2);
  steps.push({ action: 'click bottom back link', href: v2BackHref, pathname: '/internal/menu-concepts', arrived: v2Back });
  check('concept click: v2 back returns to the real list', v2Back && v2BackHref === '/internal/menu-concepts', `${v2BackHref}/${v2Back}`);

  const invalidHref = await clickLink(cdp, names.invalid);
  const invalidArrived = await waitForPath(cdp, `/internal/menu-concepts/${ids.invalid}`, 'Alleen-lezen');
  const invalid = await evalJs(cdp, `(() => ({
    text: document.body.innerText,
    pathname: location.pathname,
    buttons: [...document.querySelectorAll('button')].map((b) => (b.innerText || '').trim()),
  }))()`);
  steps.push({ action: 'click list row', target: names.invalid, href: invalidHref, pathname: `/internal/menu-concepts/${ids.invalid}`, arrived: invalidArrived });
  check('concept click: the unknown row opens its own detail id', invalidArrived && invalidHref === `/internal/menu-concepts/${ids.invalid}`, `${invalidHref}/${invalidArrived}`);
  check('concept invalid: visibly blocked, never flattened to v1', invalid.pathname === `/internal/menu-concepts/${ids.invalid}` && invalid.text.includes('onbekende of niet-ondersteunde schemaversie') && invalid.text.includes('De inhoud kon niet als v2 worden gelezen.') && !invalid.buttons.some((b) => b.includes('Concept goedkeuren')), invalid.pathname);
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'concept-detail-invalid-1024-clickpath.png'));
  await clickLink(cdp, 'Terug naar Menuconcepten beoordelen');
  await waitForPath(cdp, '/internal/menu-concepts', names.invalid);

  const emptyHref = await clickLink(cdp, names.empty);
  const emptyArrived = await waitForPath(cdp, `/internal/menu-concepts/${ids.empty}`, 'Alleen-lezen');
  await openAllDetails(cdp);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const empty = await evalJs(cdp, `(() => ({
    text: document.body.innerText,
    pathname: location.pathname,
    buttons: [...document.querySelectorAll('button')].map((b) => (b.innerText || '').trim()),
  }))()`);
  steps.push({ action: 'click list row', target: names.empty, href: emptyHref, pathname: `/internal/menu-concepts/${ids.empty}`, arrived: emptyArrived });
  check('concept click: the exact menus:[] row opens its own detail id', emptyArrived && emptyHref === `/internal/menu-concepts/${ids.empty}`, `${emptyHref}/${emptyArrived}`);
  check('concept empty: an exact empty v2 menu stays visibly blocked', empty.pathname === `/internal/menu-concepts/${ids.empty}` && empty.text.includes('Een lege kaart wordt nooit als volledige of geslaagde import getoond.') && empty.text.includes('0 items') && !empty.buttons.some((b) => b.includes('Concept goedkeuren') || b.includes('Concept opslaan')), empty.pathname);
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'concept-detail-empty-1024-clickpath.png'));
  await clickLink(cdp, 'Terug naar Menuconcepten beoordelen');
  await waitForPath(cdp, '/internal/menu-concepts', names.empty);

  recordClickpath('concept list -> exact detail -> back', steps, steps.every((step) => step.arrived), JSON.stringify(steps));
}
async function conceptProductReadOnlyScenario(cdp) {
  const ids = fixtures.CONCEPT_IDS;
  const names = fixtures.CONCEPT_RESTAURANTS;
  await setViewport(cdp, 1024, 900);
  await openRoute(cdp, conceptUrl({ theme: 'light', id: ids.v2 }), `document.body.innerText.includes('Alleen-lezen')`);
  await openAllDetails(cdp);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const v2 = await evalJs(cdp, `(() => ({
    text: document.body.innerText,
    buttons: [...document.querySelectorAll('button')].map((b) => (b.innerText || '').trim()),
    sourceLinks: [...document.querySelectorAll('a')].map((a) => ({ text: (a.innerText || '').trim(), href: a.getAttribute('href') })),
    theme: document.documentElement.getAttribute('data-theme'),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  }))()`);
  check('concept v2 read-only: glass and bottle prices stay separate', v2.text.includes('Glas: € 6,50') && v2.text.includes('Fles: € 25,00'));
  check('concept v2 read-only: no invented primary price is shown', !v2.text.includes('Vanaf €') && !v2.text.includes('€ 0,00'));
  check('concept v2 read-only: supplement relation stays explicit', v2.text.includes('Supplement: Bij de maaltijd; doel niet vastgelegd'));
  check('concept v2 read-only: unknown allergens stay unknown', v2.text.includes('Allergenen onbekend (geen bronvermelding)') && !v2.text.includes('allergeenvrij'));
  check('concept v2 read-only: provenance and its quote are visible', v2.text.includes('Bronbewijs') && v2.text.includes('Fictieve wijn Glas 6,50 Fles 25,00'));
  check('concept v2 read-only: coverage and its limitation are visible', v2.text.includes('Dekking') && v2.text.includes('Fictieve v2-beperking: één pagina was onleesbaar.'));
  check('concept v2 read-only: counts keep both items, the variant and the supplement', v2.text.includes('2 items') && v2.text.includes('1 menukopje') && v2.text.includes('2 prijsvarianten') && v2.text.includes('1 supplement'));
  check('concept v2 read-only: save, approve, reject and export are absent', !v2.buttons.some((b) => /opslaan|goedkeuren|afwijzen|review-PR/i.test(b)), v2.buttons.join('|'));
  check('concept v2 read-only: the blocked actions are named, not hidden', v2.text.includes('save, confirm, export, publish'));
  check('concept v2 read-only: the exact source link is kept', v2.sourceLinks.some((link) => link.text.startsWith('Open originele menukaart') && link.href === fixtures.SOURCE_URL), JSON.stringify(v2.sourceLinks.filter((link) => link.href === fixtures.SOURCE_URL)));
  check('concept v2 read-only: light theme and no horizontal overflow', v2.theme === 'light' && v2.overflow <= 0, `${v2.theme}/${v2.overflow}`);
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'concept-detail-v2-readonly-1024-light.png'));

  await setViewport(cdp, 1024, 900);
  await openRoute(cdp, conceptUrl({ theme: 'light', id: ids.invalid }), `document.body.innerText.includes('Alleen-lezen')`);
  const invalid = await evalJs(cdp, `(() => ({
    text: document.body.innerText,
    buttons: [...document.querySelectorAll('button')].map((b) => (b.innerText || '').trim()),
    theme: document.documentElement.getAttribute('data-theme'),
  }))()`);
  check('concept invalid: the unknown version is named with its concrete problem', invalid.text.includes('onbekende of niet-ondersteunde schemaversie') && invalid.text.includes('unsupported_schema_version: a menu array without a schemaVersion is not legacy v1 concept content'));
  check('concept invalid: the raw row stays preserved and nothing is converted', invalid.text.includes('De inhoud kon niet als v2 worden gelezen. De onbewerkte rij blijft bewaard; er wordt niets omgezet.'));
  check('concept invalid: no save, approve, reject or export action exists', !invalid.buttons.some((b) => /opslaan|goedkeuren|afwijzen|review-PR/i.test(b)) && !invalid.text.includes('Geen blokkades'), invalid.buttons.join('|'));
  check('concept invalid: the selected id did not jump to another row', invalid.text.includes(names.invalid) && !invalid.text.includes(names.v2), names.invalid);
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'concept-detail-invalid-1024-light.png'));

  await openRoute(cdp, conceptUrl({ theme: 'dark', id: ids.empty }), `document.body.innerText.includes('Alleen-lezen')`);
  await openAllDetails(cdp);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const empty = await evalJs(cdp, `(() => ({
    text: document.body.innerText,
    buttons: [...document.querySelectorAll('button')].map((b) => (b.innerText || '').trim()),
    theme: document.documentElement.getAttribute('data-theme'),
  }))()`);
  check('concept empty: an exact empty v2 menu is not a success', empty.text.includes('0 items') && empty.text.includes('De bron bevat volgens deze uitvoer nul items. Dat is geen geslaagde extractie.') && empty.text.includes('Een lege kaart wordt nooit als volledige of geslaagde import getoond.'));
  check('concept empty: it never becomes a usable v1 concept', !empty.buttons.some((b) => /opslaan|goedkeuren|afwijzen|review-PR/i.test(b)) && !empty.text.includes('Geen blokkades'), empty.buttons.join('|'));
  check('concept empty: the selected id did not jump to another row', empty.text.includes(names.empty) && !empty.text.includes(names.v1), names.empty);
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'concept-detail-empty-1024-dark.png'));
}


async function conceptListStatesScenario(cdp) {
  const names = fixtures.CONCEPT_RESTAURANTS;
  await setViewport(cdp, 390, 900);
  await openRoute(cdp, conceptUrl({ fixture: 'concepts-empty', theme: 'light' }), `document.body.innerText.includes('Er wachten geen menuconcepten')`);
  const empty = await evalJs(cdp, `(() => ({
    text: document.body.innerText,
    theme: document.documentElement.getAttribute('data-theme'),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  }))()`);
  check('concept list empty: the honest empty state is shown', empty.text.includes('Er wachten geen menuconcepten') && !empty.text.includes(names.v1));
  check('concept list empty: light theme and no horizontal overflow', empty.theme === 'light' && empty.overflow <= 0, `${empty.theme}/${empty.overflow}`);
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'concept-list-empty-390-light.png'));

  await openRoute(cdp, conceptUrl({ fixture: 'concepts-error', theme: 'light' }), `document.body.innerText.includes('De menuconcepten konden niet worden geladen.')`);
  const error = await evalJs(cdp, `(() => ({
    text: document.body.innerText,
    alert: (document.querySelector('[role="alert"]') || {}).innerText || '',
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  }))()`);
  check('concept list error: the load error is in the alert region', error.alert.includes('De menuconcepten konden niet worden geladen.'), error.alert);
  check('concept list error: no stale or fabricated row is shown', !error.text.includes(names.v1) && !error.text.includes(names.v2));
  check('concept list error: no horizontal overflow at 390 px', error.overflow <= 0, `overflow=${error.overflow}`);
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'concept-list-error-390-light.png'));

  await openRoute(cdp, conceptUrl({ fixture: 'concepts-no-access', theme: 'light' }), `document.body.innerText.includes('Alleen interne medewerkers kunnen menuconcepten beoordelen.')`);
  const denied = await evalJs(cdp, `(() => ({
    text: document.body.innerText,
    alert: (document.querySelector('[role="alert"]') || {}).innerText || '',
  }))()`);
  check('concept list no-access: the server refusal is shown, not an empty success', denied.alert.includes('Alleen interne medewerkers kunnen menuconcepten beoordelen.') && !denied.text.includes(names.v1), denied.alert);
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'concept-list-no-access-390-light.png'));

  await openRoute(cdp, conceptUrl({ fixture: 'concepts-error', theme: 'light', id: fixtures.CONCEPT_IDS.v1 }), `document.body.innerText.includes('Het menuconcept kon niet worden geladen.')`);
  const detailError = await evalJs(cdp, `(() => ({
    text: document.body.innerText,
    alert: (document.querySelector('[role="alert"]') || {}).innerText || '',
    back: [...document.querySelectorAll('a')].some((a) => (a.innerText || '').includes('Terug naar Menuconcepten beoordelen')),
  }))()`);
  check('concept detail error: the load error is shown and no stale detail remains', detailError.alert.includes('Het menuconcept kon niet worden geladen.') && !detailError.text.includes(names.v1), detailError.alert);
  check('concept detail error: a real back link stays available', detailError.back);
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'concept-detail-error-390-light.png'));

  await openRoute(cdp, conceptUrl({ theme: 'light', id: 'concept-missing-9999' }), `document.body.innerText.includes('Menuconcept niet gevonden.')`);
  const missing = await evalJs(cdp, `(() => ({
    text: document.body.innerText,
    alert: (document.querySelector('[role="alert"]') || {}).innerText || '',
    back: [...document.querySelectorAll('a')].some((a) => (a.innerText || '').includes('Terug naar Menuconcepten beoordelen')),
  }))()`);
  check('concept detail missing id: a 404 is reported, not an empty concept', missing.alert.includes('Menuconcept niet gevonden.') && !missing.text.includes('Geen blokkades'), missing.alert);
  check('concept detail missing id: a real back link stays available', missing.back);
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'concept-detail-missing-390-light.png'));
}


// A real click on a v1 approve button and script-forced POSTs must never reach a
// handler. The guard is the only thing exercised here; the server-handler tests
// remain authoritative for server-side refusal (this is not proof of that).
async function conceptForcedWriteScenario(cdp) {
  const ids = fixtures.CONCEPT_IDS;
  await setViewport(cdp, 1024, 900);
  await openRoute(cdp, conceptUrl({ theme: 'light', id: ids.v1 }), `document.body.innerText.includes('Concept goedkeuren')`);
  const pageViolationsBefore = await evalJs(cdp, 'window.__FIXTURE_NETWORK_VIOLATIONS__.length');
  networkGuard.setPhase('negative-probe');
  await evalJs(cdp, `window.__FIXTURE_NETWORK_PHASE__ = 'negative-probe'`);
  const clicked = await clickButton(cdp, 'Concept goedkeuren');
  const failed = await waitFor(cdp, `document.body.innerText.includes('Het besluit kon niet worden vastgelegd.')`, 15000);
  const ui = await evalJs(cdp, `(() => ({
    text: document.body.innerText,
    pathname: location.pathname,
    status: (document.querySelector('[role="status"]') || {}).innerText || '',
    violations: (window.__FIXTURE_NETWORK_VIOLATIONS__ || []).map((entry) => ({ method: entry.method, url: entry.url, reason: entry.reason, phase: entry.phase })),
    approve: [...document.querySelectorAll('button')].some((b) => (b.innerText || '').includes('Concept goedkeuren')),
  }))()`);
  check('concept forced write: the real approve click shows the refusal and stays on the page', clicked === true && failed === true && ui.pathname === `/internal/menu-concepts/${ids.v1}`, `${clicked}/${failed}/${ui.pathname}`);
  check('concept forced write: no internal approval is claimed', !ui.text.includes('is intern goedgekeurd') && !ui.text.includes('was al intern goedgekeurd'), ui.status);
  check('concept forced write: the decision POST is blocked before a handler', ui.violations.some((entry) => entry.method === 'POST' && entry.url.includes(`/menu-concepts/${ids.v1}/decision`) && entry.reason === 'unknown_api_route'), JSON.stringify(ui.violations));
  const scripted = await evalJs(cdp, `(async () => {
    const out = {};
    const post = (url) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(() => 'unexpected', (error) => error.message);
    out.decision = await post('/api/internal/v1/menu-concepts/${ids.v2}/decision');
    out.versions = await post('/api/internal/v1/menu-concepts/${ids.v2}/versions');
    out.export = await post('/api/internal/v1/menu-concepts/${ids.v2}/export');
    out.listWrite = await post('/api/internal/v1/menu-concepts');
    out.detailWrite = await post('/api/internal/v1/menu-concepts/${ids.v2}');
    out.provider = await fetch('https://unapproved.invalid/provider').then(() => 'unexpected', (error) => error.message);
    out.violations = (window.__FIXTURE_NETWORK_VIOLATIONS__ || []).filter((entry) => entry.phase === 'negative-probe').length;
    return out;
  })()`);
  const blocked = (value) => /fixture_network_blocked: (unknown_api_route|method_not_allowed|external_origin)/.test(String(value));
  check('concept forced write: decision, versions and export POSTs are all refused', blocked(scripted.decision) && blocked(scripted.versions) && blocked(scripted.export), JSON.stringify(scripted));
  check('concept forced write: the concept list and detail POSTs are refused', blocked(scripted.listWrite) && blocked(scripted.detailWrite), `${scripted.listWrite} / ${scripted.detailWrite}`);
  check('concept forced write: an external provider POST is refused too', blocked(scripted.provider), scripted.provider);
  const pageViolationsAfter = await evalJs(cdp, 'window.__FIXTURE_NETWORK_VIOLATIONS__.length');
  check('concept forced write: every attempt is recorded as a deliberate violation', pageViolationsAfter > pageViolationsBefore && scripted.violations >= 6, `${pageViolationsBefore}->${pageViolationsAfter}, phase=${scripted.violations}`);
  forcedWriteEvidence = {
    uiClick: { clicked, failed, pathname: ui.pathname, approveStillPresent: ui.approve, violations: ui.violations },
    scripted,
    note: 'Only the in-page fixture guard is proven here. It received no handler and made no real network call; src/lib/menuConceptReviewHandlers.test.js remains the authority for server-side refusal.',
  };
  await evalJs(cdp, `window.__FIXTURE_NETWORK_PHASE__ = 'app'`);
  networkGuard.setPhase('app');
}


const conceptThemeBackgrounds = {};

async function conceptResponsiveScenario(cdp, width, theme) {
  await setViewport(cdp, width, 900);
  await openRoute(cdp, conceptUrl({ theme, id: fixtures.CONCEPT_IDS.v2 }), `document.body.innerText.includes('Alleen-lezen')`);
  await openAllDetails(cdp);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const snapshot = await evalJs(cdp, `(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim().toLowerCase(),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    text: document.body.innerText,
  }))()`);
  conceptThemeBackgrounds[theme] = snapshot.bg;
  check(`concept responsive ${width}px/${theme}: requested theme is active`, snapshot.theme === theme, snapshot.theme);
  check(`concept responsive ${width}px/${theme}: no horizontal overflow`, snapshot.overflow <= 0, `overflow=${snapshot.overflow}`);
  check(`concept responsive ${width}px/${theme}: the v2 content and read-only banner stay visible`, snapshot.text.includes('Alleen-lezen') && snapshot.text.includes('Fictieve wijn') && snapshot.text.includes('Glas: € 6,50'));
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, `concept-detail-v2-${width}-${theme}.png`));
}

async function conceptListResponsiveScenario(cdp, width, theme) {
  await setViewport(cdp, width, 900);
  await openRoute(cdp, conceptUrl({ theme }), `document.body.innerText.includes(${JSON.stringify(fixtures.CONCEPT_RESTAURANTS.v2)})`);
  const snapshot = await evalJs(cdp, `(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    text: document.body.innerText,
  }))()`);
  check(`concept list responsive ${width}px/${theme}: requested theme is active`, snapshot.theme === theme, snapshot.theme);
  check(`concept list responsive ${width}px/${theme}: no horizontal overflow`, snapshot.overflow <= 0, `overflow=${snapshot.overflow}`);
  check(`concept list responsive ${width}px/${theme}: all rows remain readable`, snapshot.text.includes(fixtures.CONCEPT_RESTAURANTS.v1) && snapshot.text.includes('v2 · alleen-lezen') && snapshot.text.includes('onbekende versie · alleen-lezen'));
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, `concept-list-${width}-${theme}.png`));
}

// ─── BE-39 "Klaar voor publicatie" in the concept list ──────────────────────
// The fixture's publication objects are built by the same pure rule the server
// uses. These checks assert the visible second badge, the header count, the
// merged note and the responsive/theme behaviour at 1280 and 390 px. Fixture
// evidence on a local machine, not real or independent acceptance.
const publicationThemes = {};

async function conceptPublicationScenario(cdp) {
  const names = fixtures.PUBLICATION_RESTAURANTS;
  const ids = fixtures.PUBLICATION_IDS;
  // BE-41: the expected card comes from the product's own rule and the same
  // fixture data the screen receives — never from a second copy of the table.
  const expected = fixtures.publicationList.items.map((item) => ({
    item,
    step: deriveNextStep({ status: item.status, publication: item.publication, blockerCount: item.blockerCount, prUrl: item.exportPrUrl }),
  }));
  /** The destination of the contract's "Gaat naar" column. */
  const destinationFor = (step, id) => {
    if (step.id === 'pr') return step.externalUrl;
    if (step.target === 'changes') return `/internal/menu-concepts/${id}?tab=changes`;
    if (step.target === 'source') return `/internal/menu-concepts/${id}?tab=source`;
    if (step.target === 'publication') return `/internal/menu-concepts/${id}#mcr-publication`;
    return `/internal/menu-concepts/${id}`;
  };
  /** The visible label of one card, from the rule (never restated here). */
  const labelOf = (name) => (expected.find((entry) => entry.item.restaurantName === name) || { step: null }).step.label;
  for (const [width, theme] of [[1280, 'light'], [1280, 'dark'], [390, 'light'], [390, 'dark'], [320, 'light'], [320, 'dark']]) {
    await setViewport(cdp, width, 900);
    await openRoute(cdp, conceptUrl({ fixture: 'concepts-publication', theme }), `document.body.innerText.includes(${JSON.stringify(names.ready)})`);
    const snapshot = await evalJs(cdp, `(() => {
      const parseColor = (value) => {
        const m = /rgba?\\(([^)]+)\\)/.exec(value || '');
        if (!m) return null;
        const p = m[1].split(',').map((x) => parseFloat(x.trim()));
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
      };
      const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
      const channel = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
      const luminance = (c) => 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
      const ratio = (a, b) => { const la = luminance(a); const lb = luminance(b); const hi = Math.max(la, lb); const lo = Math.min(la, lb); return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100; };
      const items = [...document.querySelectorAll('.mcr-item')].map((item) => {
        const next = item.querySelector('.mcr-next');
        const cardLink = item.querySelector('.mcr-item-link');
        const nextRect = next ? next.getBoundingClientRect() : null;
        // The whole card is measured in view: a card below the fold cannot be
        // hit-tested with elementFromPoint, so it is scrolled into view first.
        item.scrollIntoView({ block: 'center', behavior: 'instant' });
        const rect = item.getBoundingClientRect();
        const hitTarget = document.elementFromPoint(rect.left + 8, rect.top + 8);
        // A screen-reader-only suffix ("(opent in een nieuw tabblad)") is not
        // part of the visible label.
        const visibleText = (element) => {
          if (!element) return '';
          const clone = element.cloneNode(true);
          for (const hidden of clone.querySelectorAll('.bta-sr-only')) hidden.remove();
          return (clone.textContent || '').replace(/\\s+/g, ' ').trim();
        };
        const cardBackground = parseColor(getComputedStyle(item).backgroundColor);
        const badges = [...item.querySelectorAll('.status-badge')].map((badge) => {
          const style = getComputedStyle(badge);
          const text = parseColor(style.color);
          const background = parseColor(style.backgroundColor);
          return {
            text: (badge.innerText || '').trim(),
            role: [...badge.classList].filter((name) => name.indexOf('status-badge--') === 0)[0] || null,
            contrast: text && background ? ratio(text, over(background, cardBackground)) : null,
          };
        });
        return {
          text: item.innerText,
          badges,
          linkCount: item.querySelectorAll('a').length,
          cardHref: cardLink ? cardLink.getAttribute('href') : null,
          cardName: cardLink ? cardLink.getAttribute('aria-label') : null,
          cardWidth: Math.round(rect.width),
          wholeCardHitsLink: Boolean(cardLink) && Boolean(hitTarget) && (hitTarget === cardLink || cardLink.contains(hitTarget) || (hitTarget.closest && hitTarget.closest('.mcr-item-link') === cardLink)),
          next: next ? {
            tag: next.tagName,
            text: visibleText(next),
            href: next.getAttribute('href'),
            target: next.getAttribute('target'),
            rel: next.getAttribute('rel'),
            width: nextRect ? Math.round(nextRect.width) : 0,
            height: nextRect ? Math.round(nextRect.height) : 0,
          } : null,
        };
      });
      window.scrollTo(0, 0);
      return {
        items,
        readyCount: (document.querySelector('.mcr-ready-count') || {}).innerText || '',
        theme: document.documentElement.getAttribute('data-theme'),
        bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim().toLowerCase(),
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    })()`);
    publicationThemes[theme] = snapshot.bg;
    const card = (name) => snapshot.items.find((item) => item.text.includes(name)) || { badges: [], text: '', next: null, linkCount: 0 };
    const badgeText = (badges, index) => (badges[index] ? badges[index].text : null);
    const ready = card(names.ready);
    const missing = card(names.missingSource);
    const merged = card(names.merged);
    const failed = card(names.failed);
    const waiting = card(names.waiting);
    check(
      `be39 ${width}-${theme}: an approved card gets exactly one second badge, "Klaar voor publicatie"`,
      ready.badges.length === 2 && badgeText(ready.badges, 0) === 'Intern goedgekeurd' && badgeText(ready.badges, 1) === 'Klaar voor publicatie',
      JSON.stringify(ready.badges),
    );
    check(
      `be39 ${width}-${theme}: a missing source gives the first reason in plain language`,
      missing.badges.length === 2 && badgeText(missing.badges, 1) === 'Nog niet klaar: Bron nog niet bevestigd.',
      JSON.stringify(missing.badges),
    );
    check(
      `be39 ${width}-${theme}: an existing export shows its real status, never "Klaar voor publicatie"`,
      badgeText(merged.badges, 1) === 'Review-PR gemerged' && badgeText(failed.badges, 1) === 'Vorige poging mislukt' && !merged.text.includes('Klaar voor publicatie') && !failed.text.includes('Klaar voor publicatie'),
      JSON.stringify([merged.badges, failed.badges]),
    );
    check(`be39 ${width}-${theme}: merged is not live, the next deploy is`, merged.text.includes('live na de volgende deploy'), merged.text.slice(0, 220));
    check(
      `be39 ${width}-${theme}: a waiting card keeps its single status badge`,
      waiting.badges.length === 1 && badgeText(waiting.badges, 0) === 'Wacht op beoordeling',
      JSON.stringify(waiting.badges),
    );
    check(`be39 ${width}-${theme}: the header counts only the ready cards`, snapshot.readyCount === '1 klaar voor publicatie', snapshot.readyCount);
    check(`be39 ${width}-${theme}: requested theme is active`, snapshot.theme === theme, snapshot.theme);
    check(`be39 ${width}-${theme}: no horizontal overflow`, snapshot.overflow <= 0, `overflow=${snapshot.overflow}`);
    // BE-41 (criterion 3): the second label is yellow (attention) when the card
    // is not ready or its last attempt failed, green (positive) when it is ready,
    // and neutral otherwise — with AA contrast in both themes.
    const attention = [card(names.missingSource), card(names.failed)];
    check(
      `be41 ${width}-${theme}: "Nog niet klaar" and "Vorige poging mislukt" use the existing attention role`,
      attention.every((entry) => entry.badges.length === 2 && entry.badges[1].role === 'status-badge--old'),
      JSON.stringify(attention.map((entry) => entry.badges.map((badge) => badge.role))),
    );
    check(
      `be41 ${width}-${theme}: a ready card keeps the positive role and the neutral cards stay neutral`,
      ready.badges[1] && ready.badges[1].role === 'status-badge--positive'
        && card(names.merged).badges[1].role === 'status-badge--positive'
        && card(names.closed).badges[1].role === 'status-badge--neutral',
      JSON.stringify([ready.badges[1], card(names.merged).badges[1], card(names.closed).badges[1]]),
    );
    const badgeContrast = snapshot.items.flatMap((item) => item.badges).filter((badge) => badge.contrast !== null);
    check(
      `be41 ${width}-${theme}: every badge label keeps contrast ≥ 4.5:1`,
      badgeContrast.length > 0 && badgeContrast.every((badge) => badge.contrast >= 4.5),
      JSON.stringify(badgeContrast),
    );
    screenshotFiles.push(await screenshot(cdp, OUT_DIR, `be39-publicatie-${width}-${theme}.png`));
    screenshotFiles.push(await screenshot(cdp, OUT_DIR, `be41-vervolgstap-${width}-${theme}.png`));

    // BE-41 (criterion 1): one link per card, the whole card is that link, and
    // only the review-PR card carries the one allowed second link.
    const links = snapshot.items.map((item) => item.linkCount);
    check(
      `be41 ${width}-${theme}: every card is one link, except the review-PR link`,
      snapshot.items.every((item) => (item.text.includes(names.merged) ? item.linkCount === 2 : item.linkCount === 1)),
      JSON.stringify(links),
    );
    check(
      `be41 ${width}-${theme}: the whole card opens that link`,
      snapshot.items.every((item) => item.wholeCardHitsLink),
      JSON.stringify(snapshot.items.filter((item) => !item.wholeCardHitsLink).map((item) => item.text.slice(0, 40))),
    );

    // BE-41 (criterion 2): exactly the next step the contract names, at the
    // destination the contract names, and no button where the table says none.
    const wrongStep = [];
    for (const entry of expected) {
      const rendered = card(entry.item.restaurantName);
      const want = entry.step;
      if (!want.label) {
        if (rendered.next) wrongStep.push({ card: entry.item.restaurantName, want: 'geen knop', got: rendered.next.text });
        continue;
      }
      if (!rendered.next || rendered.next.text !== want.label) {
        wrongStep.push({ card: entry.item.restaurantName, want: want.label, got: rendered.next && rendered.next.text });
        continue;
      }
      if (want.id === 'pr') {
        if (rendered.next.tag !== 'A' || rendered.next.href !== want.externalUrl || rendered.next.target !== '_blank' || !String(rendered.next.rel).includes('noopener') || !String(rendered.next.rel).includes('noreferrer')) {
          wrongStep.push({ card: entry.item.restaurantName, want: `nieuw tabblad ${want.externalUrl}`, got: rendered.next });
        }
      } else if (rendered.next.tag !== 'SPAN' || rendered.cardHref !== destinationFor(want, entry.item.id)) {
        wrongStep.push({ card: entry.item.restaurantName, want: destinationFor(want, entry.item.id), got: { tag: rendered.next.tag, href: rendered.cardHref } });
      }
    }
    check(
      `be41 ${width}-${theme}: each card shows the next step of its own publication state`,
      wrongStep.length === 0,
      JSON.stringify(wrongStep),
    );

    // The accessible name of the card link names the same step.
    const wrongName = expected
      .filter((entry) => {
        const rendered = card(entry.item.restaurantName);
        const got = rendered.cardName === null || rendered.cardName === undefined ? entry.item.restaurantName : rendered.cardName;
        const wantName = entry.step.plainLabel ? `${entry.item.restaurantName} — ${entry.step.plainLabel}` : entry.item.restaurantName;
        return got !== wantName;
      })
      .map((entry) => entry.item.restaurantName);
    check(`be41 ${width}-${theme}: the card link names its next step for a screen reader`, wrongName.length === 0, JSON.stringify(wrongName));

    // BE-41 (criterion 5): on the phone the button is full width under the
    // labels and at least 44 px high; nothing scrolls sideways.
    if (width <= 720) {
      const sized = snapshot.items.filter((item) => item.next).map((item) => ({ card: item.text.split('\n')[0], ...item.next, cardWidth: item.cardWidth }));
      check(
        `be41 ${width}-${theme}: the next step is full width and at least 44 px high`,
        // Card width minus its own 14 px padding and 1 px border on both sides.
        sized.length > 0 && sized.every((entry) => entry.height >= 44 && entry.width >= entry.cardWidth - 32),
        JSON.stringify(sized),
      );
    }
    check(`be41 ${width}-${theme}: no horizontal overflow with the next step`, snapshot.overflow <= 0, `overflow=${snapshot.overflow}`);
  }
  check(
    'be39 light and dark resolve to different background tokens',
    publicationThemes.light !== publicationThemes.dark,
    `${publicationThemes.light} / ${publicationThemes.dark}`,
  );

  // The detail of the same cards comes to the same conclusion: the ready card
  // may start the review-PR, the merged card names the deploy instead of a live menu.
  await setViewport(cdp, 1280, 900);
  await openRoute(cdp, conceptUrl({ fixture: 'concepts-publication', theme: 'light', id: ids.ready }), `document.body.innerText.includes('Beoordeel menuconcept')`);
  const detail = await evalJs(cdp, `(() => {
    const button = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').includes('Maak review-PR'));
    return { text: document.body.innerText, button: button ? { ariaDisabled: button.getAttribute('aria-disabled') } : null };
  })()`);
  check(
    'be39 concept detail: the ready card can start the review-PR on the same rule',
    Boolean(detail.button) && detail.button.ariaDisabled !== 'true' && detail.text.includes('Klaar voor publicatie') === false,
    JSON.stringify(detail.button),
  );
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'be39-detail-1280-light.png'));

  await openRoute(cdp, conceptUrl({ fixture: 'concepts-publication', theme: 'light', id: ids.merged }), `document.body.innerText.includes('Beoordeel menuconcept')`);
  const mergedDetail = await bodyText(cdp);
  check(
    'be39 concept detail: a merged review-PR is not presented as live',
    mergedDetail.includes('Review-PR gemerged') && mergedDetail.includes('live na de volgende deploy'),
    mergedDetail.slice(0, 300),
  );

  // ─── BE-41: the card is one tab stop with a visible focus ring ────────────
  await setViewport(cdp, 390, 900);
  await openRoute(cdp, conceptUrl({ fixture: 'concepts-publication', theme: 'light' }), `document.body.innerText.includes(${JSON.stringify(names.ready)})`);
  const focused = await tabUntil(cdp, names.ready, 90);
  const ring = await evalJs(cdp, `(() => {
    const el = document.activeElement;
    if (!el || !el.classList.contains('mcr-item-link')) return null;
    const style = getComputedStyle(el);
    return { focusVisible: el.matches(':focus-visible'), style: style.outlineStyle, width: style.outlineWidth, color: style.outlineColor };
  })()`);
  check(
    'be41 keyboard: the card is one tab stop and shows a visible focus ring',
    Boolean(focused.info) && focused.info.tag === 'A' && focused.info.href === `/internal/menu-concepts/${ids.ready}#mcr-publication`
      && Boolean(ring) && ring.focusVisible && ring.style === 'solid' && parseFloat(ring.width) >= 2,
    JSON.stringify({ focused: focused.info, ring }),
  );
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'be41-focus-390-light.png'));

  // ─── BE-41: the next step opens the right tab or block, never an export ───
  const clickCard = async (name) => {
    const clicked = await evalJs(cdp, `(() => {
      const card = [...document.querySelectorAll('.mcr-item')].find((el) => el.innerText.includes(${JSON.stringify(name)}));
      const link = card && card.querySelector('.mcr-item-link');
      if (!link) return null;
      const href = link.getAttribute('href');
      link.click();
      return href;
    })()`);
    return clicked;
  };
  const tabState = `(() => {
    const tab = [...document.querySelectorAll('[role="tab"]')].find((el) => el.getAttribute('aria-selected') === 'true');
    const panel = document.querySelector('[role="tabpanel"]:not([hidden])');
    return { tab: tab ? tab.innerText.trim() : null, panel: panel ? panel.id : null, path: location.pathname, search: location.search, hash: location.hash };
  })()`;

  await clickCard(names.blockers);
  const blockersArrived = await waitFor(cdp, `location.pathname === ${JSON.stringify(`/internal/menu-concepts/${ids.blockers}`)} && Boolean([...document.querySelectorAll('[role="tab"][aria-selected="true"]')].find((el) => el.innerText.trim() === 'Wijzigingen'))`, 30000);
  const blockersTab = await evalJs(cdp, tabState);
  check(
    `be41 click: "${labelOf(names.blockers)}" opens the Wijzigingen tab of that concept`,
    blockersArrived && blockersTab.tab === 'Wijzigingen' && blockersTab.panel === `mcr-${ids.blockers}-panel-changes`,
    JSON.stringify(blockersTab),
  );
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'be41-detail-wijzigingen-390-light.png'));

  await openRoute(cdp, conceptUrl({ fixture: 'concepts-publication', theme: 'light' }), `document.body.innerText.includes(${JSON.stringify(names.missingSource)})`);
  await clickCard(names.missingSource);
  const sourceArrived = await waitFor(cdp, `location.pathname === ${JSON.stringify(`/internal/menu-concepts/${ids.missingSource}`)} && Boolean([...document.querySelectorAll('[role="tab"][aria-selected="true"]')].find((el) => el.innerText.trim() === 'Bron'))`, 30000);
  const sourceTab = await evalJs(cdp, tabState);
  check(
    `be41 click: "${labelOf(names.missingSource)}" opens the Bron tab of that concept`,
    sourceArrived && sourceTab.tab === 'Bron' && sourceTab.panel === `mcr-${ids.missingSource}-panel-source`,
    JSON.stringify(sourceTab),
  );

  await openRoute(cdp, conceptUrl({ fixture: 'concepts-publication', theme: 'light' }), `document.body.innerText.includes(${JSON.stringify(names.ready)})`);
  const violationsBefore = await evalJs(cdp, `(window.__FIXTURE_NETWORK_VIOLATIONS__ || []).filter((entry) => entry.phase === 'app').length`);
  await clickCard(names.ready);
  const readyArrived = await waitFor(cdp, `location.pathname === ${JSON.stringify(`/internal/menu-concepts/${ids.ready}`)} && location.hash === '#mcr-publication' && (() => { const block = document.getElementById('mcr-publication'); if (!block) return false; const rect = block.getBoundingClientRect(); return rect.top < window.innerHeight && rect.bottom > 0; })()`, 30000);
  const publicationView = await evalJs(cdp, `(() => {
    const block = document.getElementById('mcr-publication');
    if (!block) return null;
    const rect = block.getBoundingClientRect();
    const violations = (window.__FIXTURE_NETWORK_VIOLATIONS__ || []).filter((entry) => entry.phase === 'app');
    return { hash: location.hash, visible: rect.top < window.innerHeight && rect.bottom > 0, violations: violations.length, texts: violations.map((entry) => entry.url) };
  })()`);
  check(
    `be41 click: "${labelOf(names.ready)}" opens the Publicatie block and starts no export`,
    readyArrived && Boolean(publicationView) && publicationView.visible && publicationView.violations === violationsBefore && publicationView.violations === 0,
    JSON.stringify({ readyArrived, publicationView, violationsBefore }),
  );
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'be41-detail-publicatie-390-light.png'));

  // ─── BE-41 (criterion 4): "Originele menukaart openen ↗" next to the title ─
  const sourceLinkState = `(() => {
    const link = [...document.querySelectorAll('a')].find((el) => (el.innerText || '').includes('Originele menukaart openen'));
    const note = document.querySelector('.mcr-origin-note');
    const title = document.querySelector('h1');
    const rect = link ? link.getBoundingClientRect() : null;
    const titleRect = title ? title.getBoundingClientRect() : null;
    return link ? {
      text: (link.innerText || '').trim(),
      href: link.getAttribute('href'),
      target: link.getAttribute('target'),
      rel: link.getAttribute('rel'),
      note: note ? note.innerText.trim() : null,
      rightOfTitle: Boolean(rect && titleRect) && rect.left >= titleRect.right - 1,
      height: Math.round(rect.height),
      width: Math.round(rect.width),
    } : { text: null, note: note ? note.innerText.trim() : null };
  })()`;

  const readySource = menuSourceLink(fixtures.SOURCE_URL);
  await setViewport(cdp, 1280, 900);
  await openRoute(cdp, conceptUrl({ fixture: 'concepts-publication', theme: 'light', id: ids.ready }), `document.body.innerText.includes('Beoordeel menuconcept')`);
  const readyLink = await evalJs(cdp, sourceLinkState);
  check(
    'be41 detail: the original menu opens in a new tab, right of the title, with the small line',
    readyLink.href === readySource.href && readyLink.target === '_blank'
      && String(readyLink.rel).includes('noopener') && String(readyLink.rel).includes('noreferrer')
      && readyLink.note === readySource.note && readyLink.rightOfTitle && readyLink.height >= 44,
    JSON.stringify(readyLink),
  );
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'be41-detail-origineel-1280-light.png'));

  // On the phone the same button is full width under the title, still 44 px.
  await setViewport(cdp, 390, 900);
  await openRoute(cdp, conceptUrl({ fixture: 'concepts-publication', theme: 'light', id: ids.ready }), `document.body.innerText.includes('Beoordeel menuconcept')`);
  const mobileLink = await evalJs(cdp, sourceLinkState);
  const mobileOverflow = await evalJs(cdp, 'document.documentElement.scrollWidth - window.innerWidth');
  check(
    'be41 detail 390: the original-menu button is full width and at least 44 px',
    mobileLink.height >= 44 && mobileLink.width >= 300 && mobileOverflow <= 0,
    JSON.stringify({ mobileLink, mobileOverflow }),
  );
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'be41-detail-origineel-390-light.png'));

  // Criterion 6 asks for 1280, 390 and 320 px in light and dark. The list covers
  // all six; the review screen adds the remaining combinations of the same
  // button, so the set is complete for both changed screens.
  for (const [width, theme] of [[390, 'dark'], [320, 'light'], [320, 'dark']]) {
    await setViewport(cdp, width, 900);
    await openRoute(cdp, conceptUrl({ fixture: 'concepts-publication', theme, id: ids.ready }), `document.body.innerText.includes('Beoordeel menuconcept')`);
    const link = await evalJs(cdp, sourceLinkState);
    const overflow = await evalJs(cdp, 'document.documentElement.scrollWidth - window.innerWidth');
    check(
      `be41 detail ${width}px/${theme}: the original-menu button keeps 44 px, its note and no overflow`,
      link.href === readySource.href && link.height >= 44 && link.note === readySource.note && overflow <= 0,
      JSON.stringify({ href: link.href, height: link.height, note: link.note, overflow }),
    );
    screenshotFiles.push(await screenshot(cdp, OUT_DIR, `be41-detail-origineel-${width}-${theme}.png`));
  }

  await setViewport(cdp, 1280, 900);
  await openRoute(cdp, conceptUrl({ fixture: 'concepts-publication', theme: 'dark', id: ids.pdfSource }), `document.body.innerText.includes('Beoordeel menuconcept')`);
  const pdfLink = await evalJs(cdp, sourceLinkState);
  check(
    'be41 detail: a pdf source says so in the small line',
    pdfLink.href === menuSourceLink('https://fictief-brasserie.invalid/menu/menukaart.pdf').href && pdfLink.note === 'Opent in een nieuw tabblad · fictief-brasserie.invalid · pdf',
    JSON.stringify(pdfLink),
  );
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'be41-detail-origineel-1280-dark.png'));

  for (const [key, name] of [['unsafeSource', names.unsafeSource], ['emptySource', names.emptySource]]) {
    await openRoute(cdp, conceptUrl({ fixture: 'concepts-publication', theme: 'light', id: ids[key] }), `document.body.innerText.includes('Beoordeel menuconcept')`);
    const refused = await evalJs(cdp, sourceLinkState);
    // A javascript: or empty source gets no button at all — and no dead anchor.
    check(`be41 detail: ${key} gets no original-menu button`, refused.text === null, JSON.stringify(refused));
    check(
      `be41 detail: ${key} still shows the concept itself`,
      (await bodyText(cdp)).includes(name),
      name,
    );
  }
}

async function conceptKeyboardScenario(cdp) {
  const ids = fixtures.CONCEPT_IDS;
  const names = fixtures.CONCEPT_RESTAURANTS;
  const steps = [];
  await setViewport(cdp, 390, 900);
  await openRoute(cdp, conceptUrl({ theme: 'light' }), `document.body.innerText.includes(${JSON.stringify(names.v2)})`);
  const reach = await tabUntil(cdp, names.v2, 90);
  steps.push({ action: 'Tab to list row', target: names.v2, reached: Boolean(reach.info), tabs: reach.tabs });
  check('concept keyboard: the v2 row is reachable with Tab', Boolean(reach.info && reach.info.href === `/internal/menu-concepts/${ids.v2}`), JSON.stringify(reach.seen.slice(-4)));
  check('concept keyboard: Tab moves focus through the list', reach.tabs > 1, `tabs=${reach.tabs}`);
  if (reach.info) {
    await pressKey(cdp, 'Enter', 'Enter', 13, '\r');
    const opened = await waitForPath(cdp, `/internal/menu-concepts/${ids.v2}`, 'Alleen-lezen');
    steps.push({ action: 'Enter on list row', pathname: `/internal/menu-concepts/${ids.v2}`, arrived: opened });
    check('concept keyboard: Enter opens the correct detail page', opened, `/internal/menu-concepts/${ids.v2}`);
    const backReach = await tabUntil(cdp, 'Terug naar Menuconcepten beoordelen', 90);
    steps.push({ action: 'Tab to return link', target: 'Terug naar Menuconcepten beoordelen', reached: Boolean(backReach.info), tabs: backReach.tabs });
    check('concept keyboard: the return link is reachable with Tab', Boolean(backReach.info), JSON.stringify(backReach.seen.slice(-4)));
    if (backReach.info) {
      await pressKey(cdp, 'Enter', 'Enter', 13, '\r');
      const returned = await waitForPath(cdp, '/internal/menu-concepts', names.v1);
      steps.push({ action: 'Enter on return link', pathname: '/internal/menu-concepts', arrived: returned });
      check('concept keyboard: Enter returns to the list', returned, '/internal/menu-concepts');
    }
  }
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'concept-keyboard-390-clickpath.png'));
  recordClickpath('concept keyboard list -> detail -> list', steps, steps.every((step) => step.reached !== false && step.arrived !== false), JSON.stringify(steps));
}


async function errorScenario(cdp) {
  await setViewport(cdp, 390, 900);
  await openRoute(cdp, `${BATCH_URL}?fixture=error&theme=light`, `document.body.innerText.includes('De batchanalyse kon niet worden geladen.')`);
  const snapshot = await evalJs(cdp, `(() => {
    const alert = document.querySelector('[role="alert"]');
    return {
      text: document.body.innerText,
      alertText: alert ? alert.innerText : '',
      theme: document.documentElement.getAttribute('data-theme'),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  })()`);
  check('error: the load error is shown in the alert region', snapshot.alertText.includes('De batchanalyse kon niet worden geladen.'), snapshot.alertText);
  check('error: no stale result is shown', !snapshot.text.includes('Fictief Brasserie Noord'));
  check('error: light theme is active', snapshot.theme === 'light');
  check('error: no horizontal overflow at 390 px', snapshot.overflow <= 0, `overflow=${snapshot.overflow}`);
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'menu-review-error-390-light.png'));
}


const themeBackgrounds = {};

async function responsiveScenario(cdp, width, theme) {
  await setViewport(cdp, width, 900);
  await openRoute(cdp, reviewUrl({ theme, item: true }), `document.body.innerText.includes('8 gerechten in 4 menukopjes')`);
  const snapshot = await evalJs(cdp, `(() => {
    const breadcrumb = document.querySelector('a[href="/internal/bronnen"]');
    const save = [...document.querySelectorAll('button')].find((b) => b.innerText.includes('Concept opslaan'));
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim().toLowerCase(),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      innerWidth: window.innerWidth,
      breadcrumbVisible: Boolean(breadcrumb && breadcrumb.getBoundingClientRect().width > 0),
      saveVisible: Boolean(save && save.getBoundingClientRect().width > 0),
      text: document.body.innerText,
    };
  })()`);
  themeBackgrounds[theme] = snapshot.bg;
  check(`responsive ${width}px/${theme}: requested theme is active`, snapshot.theme === theme, snapshot.theme);
  check(`responsive ${width}px/${theme}: no horizontal overflow`, snapshot.overflow <= 0, `overflow=${snapshot.overflow}`);
  check(`responsive ${width}px/${theme}: navigation and save control stay visible`, snapshot.breadcrumbVisible && snapshot.saveVisible);
  check(`responsive ${width}px/${theme}: the menu content is unchanged`, snapshot.text.includes('Fictief Lunch › Koud') && snapshot.text.includes('8 gerechten in 4 menukopjes'));
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, `menu-review-${width}-${theme}.png`));
}

async function keyboardScenario(cdp) {
  await setViewport(cdp, 390, 900);
  await openRoute(cdp, reviewUrl({ theme: 'light' }), `document.body.innerText.includes('Fictief Brasserie Noord') && document.body.innerText.includes('Menukaart controleren')`);
  const reach = await tabUntil(cdp, 'Menukaart controleren', 60);
  check('keyboard: the review control is reachable with Tab', Boolean(reach.info), JSON.stringify(reach.seen.slice(-5)));
  check('keyboard: Tab moves focus through the page', reach.tabs > 1, `tabs=${reach.tabs}`);
  if (reach.info) {
    await pressKey(cdp, 'Enter', 'Enter', 13, '\r');
    const opened = await waitFor(cdp, `document.body.innerText.includes('8 gerechten in 4 menukopjes')`, 15000);
    const expanded = await evalJs(cdp, `(() => {
      const button = [...document.querySelectorAll('button')].find((b) => b.innerText.includes('Controle sluiten'));
      return Boolean(button && button.getAttribute('aria-expanded') === 'true');
    })()`);
    check('keyboard: Enter opens the review panel', opened && expanded, `opened=${opened} expanded=${expanded}`);

    const summaryOpened = await evalJs(cdp, `(() => {
      const summary = document.querySelector('details.bta-category summary');
      if (!summary) return false;
      summary.focus();
      return document.activeElement === summary;
    })()`);
    await pressKey(cdp, 'Enter', 'Enter', 13, '\r');
    await new Promise((resolve) => setTimeout(resolve, 250));
    const detailsOpen = await evalJs(cdp, `Boolean(document.querySelector('details.bta-category') && document.querySelector('details.bta-category').open)`);
    check('keyboard: a section summary opens with Enter', summaryOpened && detailsOpen, `focused=${summaryOpened} open=${detailsOpen}`);
  }
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'menu-review-keyboard-390-light.png'));
}


function environment(browser) {
  return {
    node: process.version,
    platform: process.platform,
    browser: browser && browser.version ? browser.version.Browser : 'unknown',
    viewportHeights: [900],
    fixtureOnly: true,
    loopback: {
      app: `http://localhost:${PORT}`,
      server: 'the local next-dev process started and stopped by this harness',
      browser: 'the local Edge/Chrome process started and stopped by this harness over CDP',
      scope: 'only these own processes are exercised; no remote host',
    },
    networkGuard: 'in-page fetch/XHR/WebSocket/EventSource/beacon + CDP Fetch + DNS lockdown',
  };
}

// Deliberate negative probes. Every attempt must fail closed without reaching
// the destination: the in-page guard covers fetch/XHR/WebSocket, and the CDP
// layer covers an image subresource and frame navigation that bypass it. The
// violations are expected in this phase only; any app-phase violation fails the
// run through `networkGuard.appViolations()`.
async function networkGuardScenario(cdp, guard) {
  await setViewport(cdp, 1024, 900);
  guard.setPhase('negative-probe');
  await evalJs(cdp, `window.__FIXTURE_NETWORK_PHASE__ = 'negative-probe'`);
  const result = await evalJs(cdp, `(async () => {
    const out = {};
    out.externalFetch = await fetch('https://unapproved.invalid/api/anything').then(() => 'unexpected', (error) => error.message);
    out.protocolRelative = await fetch('//unapproved.invalid/api/anything').then(() => 'unexpected', (error) => error.message);
    out.knownConceptWrite = await fetch('/api/internal/v1/menu-concepts', { method: 'POST' }).then(() => 'unexpected', (error) => error.message);
    out.unknownWrite = await fetch('/api/internal/v1/unrelated-write', { method: 'POST' }).then(() => 'unexpected', (error) => error.message);
    out.knownFixture = await fetch('/api/internal/v1/me').then((response) => response.status, (error) => 'error:' + error.message);
    out.xhr = await new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.onerror = () => resolve('xhr-error');
      xhr.open('POST', '/api/internal/v1/menu-concepts');
      xhr.send('{}');
      setTimeout(() => resolve('xhr-timeout'), 1000);
    });
    out.websocket = await new Promise((resolve) => {
      try { new WebSocket('ws://unapproved.invalid/socket'); resolve('unexpected'); }
      catch (error) { resolve(error.message); }
    });
    const image = document.createElement('img');
    image.src = 'https://unapproved.invalid/pixel.png';
    document.body.appendChild(image);
    const frame = document.createElement('iframe');
    frame.src = 'https://unapproved.invalid/frame';
    document.body.appendChild(frame);
    await new Promise((resolve) => setTimeout(resolve, 700));
    out.pageViolations = (window.__FIXTURE_NETWORK_VIOLATIONS__ || []).length;
    return out;
  })()`);
  check('network guard: external fetch is blocked before native fetch', /fixture_network_blocked: external_origin/.test(result.externalFetch), result.externalFetch);
  check('network guard: protocol-relative external URL is blocked', /fixture_network_blocked: external_origin/.test(result.protocolRelative), result.protocolRelative);
  check('network guard: unknown local API write is blocked', /fixture_network_blocked: unknown_api_route/.test(result.unknownWrite), result.unknownWrite);
  check('network guard: the explicit concept write is still refused', /fixture_network_blocked: method_not_allowed/.test(result.knownConceptWrite), result.knownConceptWrite);
  check('network guard: explicit fixture API still answers', result.knownFixture === 200, result.knownFixture);
  check('network guard: XHR to the concept write is blocked', result.xhr === 'xhr-error', result.xhr);
  check('network guard: external WebSocket is blocked', /fixture_network_blocked: external_origin/.test(result.websocket), result.websocket);
  check('network guard: page-level violations are recorded', result.pageViolations >= 5, `violations=${result.pageViolations}`);

  const cdpBlocked = guard.violations.filter((entry) => entry.phase === 'negative-probe' && entry.kind === 'cdp_fetch');
  check('network guard: CDP blocks external subresource and frame navigation', cdpBlocked.length >= 2, JSON.stringify(cdpBlocked.slice(0, 5)));

  await evalJs(cdp, `window.__FIXTURE_NETWORK_PHASE__ = 'app'`);
  guard.setPhase('app');
  const appViolations = guard.appViolations();
  check('network guard: no unexpected CDP traffic during app scenarios', appViolations.length === 0, JSON.stringify(appViolations.slice(0, 5)));
}


function writeEvidence({ passed, head, dirty, error, browser }) {
  const evidence = {
    fixtureOnly: true,
    passed,
    head: head || 'pending-commit',
    worktreeDirty: Boolean(dirty),
    generatedAt: new Date().toISOString(),
    command: SELECTION.filter
      ? `npm run test:browser:menu-review -- --alleen=${SELECTION.filter.join(',')}`
      : 'npm run test:browser:menu-review',
    // BE-43 (#101): a filtered run names its selection and is never the full
    // record; `passed` then covers only the chosen scenarios.
    filter: SELECTION.filter,
    scenarios: scenarioRuns,
    // BE-40 (#95): the number of successful checks of a full run, explicitly in
    // the record instead of only in the console line.
    summary: {
      total: checks.length,
      passed: checks.filter((entry) => entry.passed).length,
      failed: checks.filter((entry) => !entry.passed).length,
    },
    environment: environment(browser),
    fixtures: Object.keys(fixtures.scenarios),
    conceptFixtures: fixtures.CONCEPT_IDS,
    checks,
    clickpaths,
    screenshots: screenshotFiles,
    network: networkEvidence,
    forcedWrites: forcedWriteEvidence,
    error: error || null,
    limitations: [
      'Fixture evidence against the real UI components; it is not live integration, staging, production or authenticated acceptance.',
      'The session and API responses are fictional and same-origin; no production Supabase project, credential or data is used.',
      'Only two fictional concept reads are mocked: GET /api/internal/v1/menu-concepts and GET /api/internal/v1/menu-concepts/<id>. Every concept POST (versions, decision, export) and every unknown API route is refused at the network layer.',
      'Forced write probes prove the in-page guard, not the server. src/lib/menuConceptReviewHandlers.test.js remains the authority for server-side refusal.',
      'Unknown external URLs, protocol-relative external URLs and unknown API/write routes are fail-closed. The negative probe deliberately attempts them and proves they never reach the destination.',
      'The harness only exercises the local loopback next-dev process it starts and the local Edge/Chrome instance it starts over CDP; no remote host, real auth provider, database, GitHub or AI provider is contacted.',
      'No source confirmation, concept save, decision, export, provider call or workflow activation is performed.',
      // BE-40 (#95): two app findings found while repairing this check. They are
      // reported in the handoff; this record does not hide them.
      'BE-40 finding 1: the /internal/bronnen detail pane (app/internal/bronnen/ProposalDetail.js) throws ReferenceError: SOURCE_BADGES is not defined since BE-31 (the SOURCE_BADGES, MENU_BADGES, STATUS_LABELS and EVENT_LABELS imports are missing). No scenario here reaches that pane any more, so this record does not cover it.',
      'BE-40 finding 2: since BE-31 an image-only batch result is a dead end and not a task on /internal/bronnen, so the "Bronnen beoordelen" action on the batch row shows the follow-up reason only as a page banner, on a screen without that restaurant; the per-restaurant follow-up detail of BE-24 R4/R5 is unreachable. The check therefore verifies the row\'s own next step (BE-33/BE-35) and that banner.',
    ],
  };
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

// ── #59 fase 2: handmatige AI-import, drie stappen (fixture only) ──────────
// De fixture antwoordt alleen op de vijf vaste paden met een fictieve bundel,
// een fictief antwoord en twee fictieve beslissingen. De app doet zelf geen
// modeloproep; er is dus ook geen AI-verkeer om te blokkeren.

async function setFieldValue(cdp, selector, value) {
  return evalJs(cdp, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const proto = el.tagName === 'SELECT'
      ? window.HTMLSelectElement.prototype
      : el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
}

function manualUrl(theme) {
  // De bestaande handmatige stroom is de route zonder AI. Met aiState=off
  // antwoordt de fictieve status als "niet ingesteld", zodat deze scenario's
  // exact de ongewijzigde handmatige flow blijven bewijzen (Y2, review
  // 6381657192). De AI-route heeft eigen scenario's.
  const params = new URLSearchParams({
    fixture: 'manual',
    restaurant: fixtures.RESTAURANT.id,
    name: fixtures.RESTAURANT.name,
    url: 'https://fictief-brasserie.invalid/menu',
    aiState: 'off',
    theme,
  });
  return `${MANUAL_URL}?${params.toString()}`;
}

// K3: zonder vooraf gekozen restaurant, zodat zoeken op naam echt gedaan wordt.
function manualSearchUrl(theme) {
  const params = new URLSearchParams({
    fixture: 'manual',
    url: 'https://fictief-brasserie.invalid/menu',
    aiState: 'off',
    theme,
  });
  return `${MANUAL_URL}?${params.toString()}`;
}

// K5: de fixture antwoordt op stap 2 met een verlopen toestand.
function manualExpiredUrl(theme) {
  const params = new URLSearchParams({
    fixture: 'manual',
    restaurant: fixtures.RESTAURANT.id,
    name: fixtures.RESTAURANT.name,
    url: 'https://fictief-brasserie.invalid/menu',
    manualFail: 'expired',
    aiState: 'off',
    theme,
  });
  return `${MANUAL_URL}?${params.toString()}`;
}

// U1/U2 (review 6376543234): de fixture antwoordt op stap 2 met een afgekeurd
// antwoord (422) inclusief leesbare punten en de herstelvraag.
function manualRejectedUrl(theme) {
  const params = new URLSearchParams({
    fixture: 'manual',
    restaurant: fixtures.RESTAURANT.id,
    name: fixtures.RESTAURANT.name,
    url: 'https://fictief-brasserie.invalid/menu',
    manualFail: 'schema',
    aiState: 'off',
    theme,
  });
  return `${MANUAL_URL}?${params.toString()}`;
}

/** Maakt een prompt en controleert een fictief antwoord dat wordt afgekeurd. */
async function rejectManualAnswer(cdp, theme) {
  await openRoute(cdp, manualRejectedUrl(theme), `document.body.innerText.includes('Prompt maken')`);
  await clickButton(cdp, 'Prompt maken');
  await waitFor(cdp, `document.body.innerText.includes('gaat mee in de prompt')`, 15000);
  await setFieldValue(cdp, '#mai-answer', 'Korte samenvatting.\n```json\n{"menus":[],"coverage":{}}\n```');
  await waitFor(cdp, `document.body.innerText.includes('Antwoord geplakt')`, 15000);
  await clickButton(cdp, 'Controleren');
  return waitFor(cdp, `document.body.innerText.includes('Wat de AI moet herstellen')`, 15000);
}

/**
 * Leest het herstelblok uit de pagina. De hoofdtekst (de lijst) moet gewoon
 * Nederlands zijn; het technische detail staat ingeklapt in <details>.
 */
async function readProblemsPanel(cdp) {
  return evalJs(cdp, `(() => {
    const section = document.querySelector('.mai-problems');
    if (!section) return null;
    const items = [...section.querySelectorAll('.mai-problem-list li')].map((li) => li.innerText.trim());
    const field = document.querySelector('#mai-recovery');
    const details = section.querySelector('details');
    return {
      items,
      question: field ? field.value : null,
      readOnly: field ? field.readOnly : null,
      detailsSummary: details ? (details.querySelector('summary') || {}).innerText : null,
      detailsOpen: details ? details.open : null,
      detailsText: details ? details.textContent : null,
      pathsInMain: /menus\\[|coverage\\.|items\\[/.test(items.join(' ')),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  })()`);
}

async function manualRejectedScenario(cdp) {
  await setViewport(cdp, 390, 900);
  const shown = await rejectManualAnswer(cdp, 'dark');
  check('manual import rejection: the readable problems are shown', shown);
  const panel = await readProblemsPanel(cdp);
  check('manual import rejection: at most five concrete problems', Boolean(panel) && panel.items.length >= 1 && panel.items.length <= 5, panel ? JSON.stringify(panel.items) : 'no panel');
  check(
    'manual import rejection: every problem is a plain Dutch sentence',
    Boolean(panel) && panel.items.every((line) => /^(Bij \d+ |Op \d+ )/.test(line)),
    panel ? JSON.stringify(panel.items) : 'no panel',
  );
  check('manual import rejection: the problems name the dish or the section', Boolean(panel) && panel.items.some((line) => /Fictief glas wijn|Fictieve salade|Fictief Lunch/.test(line)), panel ? JSON.stringify(panel.items) : 'no panel');
  check('manual import rejection: no JSON path in the main text', Boolean(panel) && panel.pathsInMain === false);
  check(
    'manual import rejection: one copyable recovery question',
    Boolean(panel) && typeof panel.question === 'string' && panel.question.startsWith('Corrigeer alleen deze punten'),
    panel && panel.question ? panel.question.slice(0, 60) : 'none',
  );
  check('manual import rejection: the recovery question is selectable, not editable', Boolean(panel) && panel.readOnly === true);
  check('manual import rejection: technical detail is collapsed', Boolean(panel) && panel.detailsOpen === false && panel.detailsSummary === 'Technische details');
  check(
    'manual import rejection: the technical detail still names the validator lines',
    Boolean(panel) && typeof panel.detailsText === 'string' && panel.detailsText.includes('menus[0]'),
  );
  const banner = await evalJs(cdp, `(() => { const el = document.querySelector('.di-banner-danger'); return el ? el.innerText : null; })()`);
  check(
    'manual import rejection: the plain banner stays, without technical codes',
    typeof banner === 'string' && banner.includes('past niet bij de afspraken') && !banner.includes('menus['),
    banner,
  );
  // Het bewijs moet het herstelblok echt in beeld hebben, niet alleen bestaan.
  const visible = await evalJs(cdp, `(() => {
    const el = document.querySelector('.mai-problems');
    if (!el) return null;
    el.scrollIntoView({ block: 'start', behavior: 'instant' });
    const rect = el.getBoundingClientRect();
    return { top: Math.round(rect.top), height: window.innerHeight };
  })()`);
  check(
    'manual import rejection: the panel is in view for the screenshot',
    Boolean(visible) && visible.top >= 0 && visible.top < visible.height,
    visible ? JSON.stringify(visible) : 'none',
  );
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'manual-ai-import-problems-390-dark.png'));
  recordClickpath(
    'manual import rejection',
    ['Menukaart plakken', 'Controleren', 'Wat de AI moet herstellen', 'Vervolgvraag aan de AI', 'Technische details (ingeklapt)'],
    Boolean(panel) && panel.items.length <= 5,
  );

  await setViewport(cdp, 320, 900);
  const narrowShown = await rejectManualAnswer(cdp, 'light');
  const narrow = await readProblemsPanel(cdp);
  check('manual import rejection 320px/light: the problems are shown', narrowShown);
  check('manual import rejection 320px/light: no horizontal overflow', Boolean(narrow) && narrow.overflow <= 0, narrow ? `overflow=${narrow.overflow}` : 'no panel');
  check(
    'manual import rejection 320px/light: every problem stays visible',
    Boolean(narrow) && narrow.items.length === (panel ? panel.items.length : 0),
    narrow ? JSON.stringify(narrow.items.length) : 'no panel',
  );
  await evalJs(cdp, `(() => { const el = document.querySelector('.mai-problems'); if (el) el.scrollIntoView({ block: 'start', behavior: 'instant' }); return true; })()`);
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'manual-ai-import-problems-320-light.png'));
}

// V1/V2 (review 6377050602): de fixture antwoordt op stap 2 met een antwoord
// waarvan de telling en de status door het systeem zijn afgeleid. De melding
// moet zichtbaar zijn; niets wordt stil aangepast.
function manualNormalizedUrl(theme) {
  const params = new URLSearchParams({
    fixture: 'manual',
    restaurant: fixtures.RESTAURANT.id,
    name: fixtures.RESTAURANT.name,
    url: 'https://fictief-brasserie.invalid/menu',
    manualNormalize: '1',
    aiState: 'off',
    theme,
  });
  return `${MANUAL_URL}?${params.toString()}`;
}

/** Maakt een prompt en controleert een fictief antwoord met een afgeleide telling. */
async function normalizeManualAnswer(cdp, theme) {
  await openRoute(cdp, manualNormalizedUrl(theme), `document.body.innerText.includes('Prompt maken')`);
  await clickButton(cdp, 'Prompt maken');
  await waitFor(cdp, `document.body.innerText.includes('gaat mee in de prompt')`, 15000);
  await setFieldValue(cdp, '#mai-answer', 'Korte samenvatting.\n```json\n{"menus":[],"coverage":{}}\n```');
  await waitFor(cdp, `document.body.innerText.includes('Antwoord geplakt')`, 15000);
  await clickButton(cdp, 'Controleren');
  return waitFor(cdp, `document.body.innerText.includes('Antwoord ontvangen')`, 15000);
}

/** Leest de melding als de browser hem toont: tekst, zichtbaarheid en overflow. */
async function readNormalizationNotice(cdp) {
  return evalJs(
    cdp,
    `(() => {
      const panel = document.querySelector('.mai-notices');
      if (!panel) return null;
      panel.scrollIntoView({ block: 'start', behavior: 'instant' });
      const rect = panel.getBoundingClientRect();
      return {
        role: panel.getAttribute('role'),
        title: panel.querySelector('.mai-notices-title') ? panel.querySelector('.mai-notices-title').innerText : null,
        items: Array.from(panel.querySelectorAll('.mai-notice-list li')).map((el) => el.innerText),
        text: document.body.innerText,
        buttons: Array.from(document.querySelectorAll('button')).map((el) => el.innerText),
        top: Math.round(rect.top),
        height: window.innerHeight,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    })()`,
  );
}

/** De verse positie van de melding, nadat het scrollen klaar is. */
async function noticePosition(cdp) {
  return evalJs(
    cdp,
    `(() => {
      const panel = document.querySelector('.mai-notices');
      if (!panel) return null;
      const rect = panel.getBoundingClientRect();
      return { top: Math.round(rect.top), height: window.innerHeight };
    })()`,
  );
}

async function manualNormalizedScenario(cdp) {
  await setViewport(cdp, 390, 900);
  const shown = await normalizeManualAnswer(cdp, 'dark');
  check('manual import normalization: the answer is accepted after the derived count', shown);
  const notice = await readNormalizationNotice(cdp);
  check('manual import normalization: the notice is rendered in plain language', Boolean(notice) && notice.role === 'status', notice ? notice.role : 'no notice');
  check(
    'manual import normalization: the heading names what the system adjusted',
    Boolean(notice) && notice.title === 'Door het systeem bijgesteld',
    notice ? notice.title : 'no notice',
  );
  check(
    'manual import normalization: the derived item count is visible with the AI claim',
    Boolean(notice) && notice.items.includes('Aantal gerechten door het systeem geteld: 3 (de AI zei 9).'),
    notice ? JSON.stringify(notice.items) : 'no notice',
  );
  check(
    'manual import normalization: the adjusted status is visible',
    Boolean(notice) && notice.items.includes('Status bijgesteld naar gedeeltelijk, omdat de AI zelf een beperking noemde.'),
    notice ? JSON.stringify(notice.items) : 'no notice',
  );
  // De telling op stap 2 komt uit het antwoord zelf, niet uit de modelclaim.
  check(
    'manual import normalization: step 2 shows the derived count, not the claimed 9',
    Boolean(notice) && notice.text.includes('Antwoord ontvangen: 1 menukaart, 3 gerechten') && !notice.text.includes('9 gerechten'),
    notice ? (notice.text.match(/Antwoord ontvangen[^\r\n]*/) || ['missing'])[0] : 'no notice',
  );
  // Niets goedgekeurd: geen accepteer-alles-knop en geen JSON op het scherm.
  check(
    'manual import normalization: no JSON and no accept-all control is shown',
    Boolean(notice) &&
      !notice.text.includes('"menus"') &&
      !notice.buttons.some((label) => /alles accepteren|accepteer alles|alles goedkeuren/i.test(label)),
    notice ? JSON.stringify(notice.buttons.filter((label) => /accep/i.test(label))) : 'no notice',
  );
  check('manual import normalization: no horizontal overflow at 390 px', Boolean(notice) && notice.overflow <= 0, notice ? `overflow=${notice.overflow}` : 'no notice');
  // Y3: scroll direct (niet smooth) en meet meteen, zodat de screenshot
  // deterministisch de melding toont. Dezelfde eis als voorheen: de melding
  // staat met zijn bovenkant in het scherm.
  await evalJs(
    cdp,
    `(() => { const el = document.querySelector('.mai-notices'); if (el) el.scrollIntoView({ block: 'start', behavior: 'instant' }); return true; })()`,
  );
  const placed = await noticePosition(cdp);
  check(
    'manual import normalization: the notice is in view for the screenshot',
    Boolean(placed) && placed.top >= 0 && placed.top < placed.height,
    JSON.stringify({ placed }),
  );
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'manual-ai-import-normalized-390-dark.png'));
  recordClickpath(
    'manual import normalization',
    ['Menu importeren met AI', 'Prompt maken', 'Controleren', 'Door het systeem bijgesteld'],
    Boolean(notice) && notice.items.length === 2,
  );

  // 320 px/licht: dezelfde melding, zonder horizontale overflow.
  await setViewport(cdp, 320, 900);
  const narrowShown = await normalizeManualAnswer(cdp, 'light');
  const narrow = await readNormalizationNotice(cdp);
  check('manual import normalization 320px/light: the notice is shown', Boolean(narrowShown) && Boolean(narrow));
  check(
    'manual import normalization 320px/light: both lines stay visible',
    Boolean(narrow) && narrow.items.length === 2,
    narrow ? JSON.stringify(narrow.items) : 'no notice',
  );
  check('manual import normalization 320px/light: no horizontal overflow', Boolean(narrow) && narrow.overflow <= 0, narrow ? `overflow=${narrow.overflow}` : 'no notice');
}

async function manualImportScenario(cdp) {
  await setViewport(cdp, 390, 900);

  // K3 — restaurant kiezen op naam uit de bestaande lijst.
  await openRoute(cdp, manualSearchUrl('light'), `document.body.innerText.includes('Menu importeren met AI')`);
  await setFieldValue(cdp, '#mai-restaurant', 'wolf');
  const choiceShown = await waitFor(cdp, `document.body.innerText.includes('Restaurant Wolfslaar')`, 15000);
  check('manual import: restaurant search finds an existing restaurant by name', choiceShown);
  const chosen = await clickButton(cdp, 'Restaurant Wolfslaar');
  check('manual import: clicking a search result selects that restaurant', chosen);
  const chosenText = await bodyText(cdp);
  check(
    'manual import: the chosen restaurant replaces the free number field',
    chosenText.includes('Wijzig') && !chosenText.includes('Restaurantnummer'),
  );

  // Stap 1 — prompt maken.
  await clickButton(cdp, 'Prompt maken');
  const step1 = await waitFor(cdp, `document.body.innerText.includes('gaat mee in de prompt')`, 15000);
  check('manual import: step 1 shows the source line in plain language', step1);
  const step1Text = await bodyText(cdp);
  check('manual import: step 1 offers "Kopieer prompt"', step1Text.includes('Kopieer prompt'));
  check('manual import: step 1 explains which page to use', step1Text.includes('niet alleen de homepage'));
  check(
    'manual import: step 1 shows "Geldig tot" with a clock time',
    /Geldig tot \d{2}:\d{2}/.test(step1Text),
    (step1Text.match(/Geldig tot[^\r\n]*/) || ['missing'])[0],
  );
  const step1Details = await evalJs(cdp, `document.body.textContent.includes('MENU-EXTRACTION.md')`);
  check('manual import: technische details name the pinned instruction', step1Details === true);

  // Stap 2 — antwoord plakken; nooit JSON op het scherm.
  await setFieldValue(cdp, '#mai-answer', 'Korte samenvatting.\n```json\n{"menus":[],"coverage":{}}\n```');
  const pasted = await waitFor(cdp, `document.body.innerText.includes('Antwoord geplakt')`, 15000);
  check('manual import: pasting shows only a summary line and "Wissen"', pasted);
  const pasteSnapshot = await evalJs(cdp, `(() => {
    const field = document.querySelector('#mai-answer');
    return {
      fieldPresent: Boolean(field),
      fieldValue: field ? field.value : null,
      text: document.body.innerText,
    };
  })()`);
  check('manual import: the paste field no longer shows the pasted content', pasteSnapshot.fieldPresent === false, JSON.stringify(pasteSnapshot.fieldValue));
  check('manual import: the paste summary counts the characters', /Antwoord geplakt \(\d+ tekens\)/.test(pasteSnapshot.text));
  check('manual import: the pasted JSON is never rendered', !pasteSnapshot.text.includes('"menus"'));

  await clickButton(cdp, 'Controleren');
  const step2 = await waitFor(cdp, `document.body.innerText.includes('Antwoord ontvangen')`, 15000);
  check('manual import: step 2 confirms the received counts', step2);
  const step2Text = await bodyText(cdp);
  // Het plakveld wordt na het controleren leeggemaakt en er verschijnt geen
  // JSON: precies de eigenaarsbeslissing (b).
  check('manual import: no pasted JSON remains after checking', !step2Text.includes('"menus"'));
  check('manual import: the received line is the only result shown', step2Text.includes('Antwoord ontvangen') && !step2Text.includes('"validated"'));
  check('manual import: step 2 shows "1 menukaart, 3 gerechten"', step2Text.includes('1 menukaart, 3 gerechten'));
}

// ── #59 / BE-21 "Lees met AI" (Lead review 6380804419, W1/W5/W6/W8;
//    layout and screenshots of review 6381657192, Y2/Y3) ────────────────────
// Fictieve API-antwoorden: het blok als eerste kaart, de ingeklapte handmatige
// route, het resultaat, nalopen met label, de batchplek en de stand zonder
// sleutel/vlag. Geen provider, geen sleutel en geen echte kaart.

/** Leest het AI-blok en de zichtbare stappen zoals de browser ze toont. */
async function readAiLayout(cdp) {
  return evalJs(
    cdp,
    `(() => {
      const block = document.querySelector('.mai-ai');
      const stepOne = document.getElementById('mai-s1');
      const stepTwo = document.getElementById('mai-s2');
      const stepThree = document.getElementById('mai-s3');
      const sourceCard = document.getElementById('mai-bron');
      const sourceInput = document.getElementById('mai-urls');
      if (block) block.scrollIntoView({ block: 'start', behavior: 'instant' });
      const buttons = Array.from(block ? block.querySelectorAll('button') : []).map((el) => el.innerText.trim());
      const links = Array.from(block ? block.querySelectorAll('a') : []).map((el) => ({ text: el.innerText.trim(), href: el.getAttribute('href') }));
      const manual = block
        ? Array.from(block.querySelectorAll('button')).find((el) => el.innerText.trim() === 'Liever zelf invoeren of plakken')
        : null;
      return {
        present: Boolean(block),
        card: block ? block.className : null,
        title: block && block.querySelector('#mai-ai-title') ? block.querySelector('#mai-ai-title').innerText.trim() : null,
        text: block ? block.innerText : '',
        buttons,
        links,
        manualExpanded: manual ? manual.getAttribute('aria-expanded') : null,
        manualInBlock: Boolean(manual),
        insideStepOne: Boolean(block && stepOne && stepOne.contains(block)),
        sourceCardBeforeBlock: Boolean(
          sourceCard && block && (sourceCard.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING),
        ),
        sourceInputOutsideBlock: Boolean(sourceInput && block && !block.contains(sourceInput)),
        steps: { one: Boolean(stepOne), two: Boolean(stepTwo), three: Boolean(stepThree) },
        // BB3 (review 6384867373): de nummers van de zichtbare stappen, in de
        // volgorde waarin ze op het scherm staan.
        stepNumbers: Array.from(document.querySelectorAll('.step-num'))
          .filter((el) => el.getClientRects().length > 0)
          .map((el) => (el.innerText || '').trim()),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    })()`,
  );
}

/** Dezelfde pagina, maar met het fictieve AI-antwoord en een bron waarvan de
 *  prijslijst zelf is benoemd (W6: die regels staan meteen in orde).
 *  aiState=slow houdt de fictieve POST even vast, zodat "AI bezig" echt in
 *  beeld staat voordat het antwoord komt. */
function aiUrl(theme, extra = {}) {
  const params = new URLSearchParams({
    fixture: 'manual-ai',
    restaurant: fixtures.RESTAURANT.id,
    name: fixtures.RESTAURANT.name,
    url: 'https://fictief-brasserie.invalid/menu',
    theme,
    ...extra,
  });
  return `${MANUAL_URL}?${params.toString()}`;
}

async function aiReadScenario(cdp, theme) {
  await setViewport(cdp, 390, 900);
  await openRoute(cdp, aiUrl(theme, { aiState: 'slow' }), `document.body.innerText.includes('Laat AI de kaart lezen')`);
  const block = await readAiLayout(cdp);
  check(
    'ai read: the block is a standalone card after the source choice',
    Boolean(block) && block.insideStepOne === false && block.sourceCardBeforeBlock && block.sourceInputOutsideBlock,
    block ? JSON.stringify({ insideStepOne: block.insideStepOne, sourceCardBeforeBlock: block.sourceCardBeforeBlock }) : 'no block',
  );
  check(
    'ai read: title, button and cost line are the agreed text',
    Boolean(block) &&
      block.title === 'Laat AI de kaart lezen' &&
      block.buttons.includes('Lees met AI') &&
      // BE-35 (#84): the estimate is per page, because an image or PDF source
      // is read page by page (src/components/AiMenuReadBlock.js).
      block.text.includes('Kost ongeveer 1 cent per pagina · duurt ± 1 minuut'),
    block ? JSON.stringify({ title: block.title, buttons: block.buttons }) : 'no block',
  );
  check(
    "ai read: this month's spend is shown against the ceiling",
    Boolean(block) && block.text.includes('AI deze maand € 0,12 van € 10,00'),
    block ? (block.text.match(/AI deze maand[^\n]*/) || ['missing'])[0] : 'no block',
  );
  check(
    'ai read: the manual steps are collapsed behind one link',
    Boolean(block) &&
      block.manualInBlock &&
      block.manualExpanded === 'false' &&
      block.steps.one === false &&
      block.steps.two === false &&
      block.steps.three === false,
    block ? JSON.stringify({ steps: block.steps, expanded: block.manualExpanded }) : 'no block',
  );
  // BB3 (Lead review 6384867373): de zichtbare stappen zijn Bron kiezen (1) en
  // de AI-kaart (2), zonder gat en zonder sprong.
  check(
    'ai read: the visible steps are numbered in their own order',
    Boolean(block) && block.stepNumbers.join(',') === '1,2',
    block ? JSON.stringify(block.stepNumbers) : 'no block',
  );
  check('ai read: no horizontal overflow at 390 px', Boolean(block) && block.overflow <= 0, block ? `overflow=${block.overflow}` : 'no block');
  const firstCard = await evalJs(cdp, `(() => {
    window.scrollTo(0, 0);
    const block = document.querySelector('.mai-ai');
    const rect = block ? block.getBoundingClientRect() : null;
    return rect ? { top: Math.round(rect.top), visible: rect.top < window.innerHeight && rect.bottom > 0 } : null;
  })()`);
  check(
    'ai read: the AI card is visible as its own card in the first screen',
    Boolean(firstCard && firstCard.visible),
    JSON.stringify(firstCard),
  );
  await evalJs(cdp, `(() => { const el = document.querySelector('.mai-ai'); if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' }); return true; })()`);
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, `ai-read-block-390-${theme}.png`));

  // De handmatige route opent pas als de mens die kiest.
  await clickButton(cdp, 'Liever zelf invoeren of plakken');
  const manualOpen = await waitFor(
    cdp,
    `Boolean(document.getElementById('mai-manual') && document.getElementById('mai-s1') && document.getElementById('mai-s2'))`,
    10000,
  );
  const opened = await readAiLayout(cdp);
  const openedText = await bodyText(cdp);
  check(
    'ai read: the manual route expands when it is chosen',
    Boolean(manualOpen) && opened.manualExpanded === 'true' && opened.steps.one && opened.steps.two,
    opened ? JSON.stringify({ steps: opened.steps, expanded: opened.manualExpanded }) : 'no block',
  );
  check(
    'ai read: the expanded manual steps still keep the source outside step 1',
    opened.sourceInputOutsideBlock === true && openedText.includes('Prompt maken') && openedText.includes('Antwoord plakken'),
  );
  check(
    'ai read: with the manual route open the steps are numbered in their own order',
    opened.stepNumbers.join(',') === '1,2,3,4',
    JSON.stringify(opened.stepNumbers),
  );
  await evalJs(cdp, `(() => { const el = document.getElementById('mai-manual'); if (el) el.scrollIntoView({ block: 'start', behavior: 'instant' }); return true; })()`);
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, `ai-read-manual-390-${theme}.png`));

  await clickButton(cdp, 'Liever zelf invoeren of plakken');
  const collapsedAgain = await waitFor(cdp, `!document.getElementById('mai-s1')`, 10000);
  check('ai read: the manual route collapses again without losing the reading', Boolean(collapsedAgain));


  // Scherm 2a: de aanroep is bezig (de fictieve POST wordt even vastgehouden).
  await clickButton(cdp, 'Lees met AI');
  const busy = await waitFor(cdp, `document.body.innerText.includes('De AI leest de kaart')`, 10000);
  check('ai read: the reading shows its progress', Boolean(busy));
  await evalJs(cdp, `(() => { const el = document.querySelector('.mai-ai'); if (el) el.scrollIntoView({ block: 'start', behavior: 'instant' }); return true; })()`);
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, `ai-read-busy-390-${theme}.png`));

  // Scherm 2b: het resultaat, met de handmatige stappen nog steeds ingeklapt.
  const done = await waitFor(cdp, `document.body.innerText.includes('Concept klaar')`, 30000);
  const doneText = await bodyText(cdp);
  check('ai read: the reading reports its own result', Boolean(done) && /Concept klaar: 3 gerechten/.test(doneText), (doneText.match(/Concept klaar[^\n]*/) || ['missing'])[0]);
  check('ai read: the cost of this call is shown', /Kosten: € 0,04/.test(doneText), (doneText.match(/Kosten[^\n]*/) || ['missing'])[0]);
  const doneLayout = await readAiLayout(cdp);
  check(
    'ai read: after Concept klaar only the result with Nalopen remains and the manual steps stay collapsed',
    doneLayout.buttons.includes('Nalopen') &&
      !doneLayout.buttons.includes('Lees met AI') &&
      doneLayout.steps.one === false &&
      doneLayout.steps.two === false &&
      doneLayout.steps.three === false,
    JSON.stringify({ buttons: doneLayout.buttons, steps: doneLayout.steps }),
  );
  // BB3 (Lead review 6384867373): de maandregel volgt de echte uitgave meteen.
  // De fictieve lezing kost 4 cent; de statusroute telt hem daarna mee.
  const monthAfterRead = await bodyText(cdp);
  check(
    'ai read: this month\'s spend is refreshed right after the reading',
    /AI deze maand € 0,16 van € 10,00/.test(monthAfterRead),
    (monthAfterRead.match(/AI deze maand[^\n]*/) || ['missing'])[0],
  );
  check(
    'ai read: after the reading the visible steps stay 1 and 2',
    doneLayout.stepNumbers.join(',') === '1,2',
    JSON.stringify(doneLayout.stepNumbers),
  );
  await evalJs(cdp, `(() => { const el = document.querySelector('.mai-ai'); if (el) el.scrollIntoView({ block: 'start', behavior: 'instant' }); return true; })()`);
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, `ai-read-done-390-${theme}.png`));

  // Scherm 3: het bestaande nalopen-scherm met het label.
  await clickButton(cdp, 'Nalopen');
  const reviewed = await waitFor(cdp, `document.body.innerText.includes('Gelezen door AI')`, 10000);
  const reviewText = await bodyText(cdp);
  check('ai read: the review carries the label Gelezen door AI', Boolean(reviewed), (reviewText.match(/Gelezen door AI[^\n]*/) || ['missing'])[0]);
  check(
    'ai read: the review shows rows and the explicit save step',
    reviewText.includes('in orde') && reviewText.includes('Opslaan als concept') && reviewText.includes('Publiceren blijft een aparte stap'),
    (reviewText.match(/Opslaan als concept[^\n]*/) || ['missing'])[0],
  );
  check(
    'ai read: a named price list stays in orde instead of asking for a price',
    // A named price list belongs to the rows that are already fine, so the
    // check opens that collapsed list first. "Kies een prijs" must not appear.
    (await evalJs(
      cdp,
      `(() => {
        const summary = [...document.querySelectorAll('details.mai-details > summary')].find((el) => el.innerText.includes('in orde of afgehandeld'));
        if (!summary) return false;
        summary.click();
        return true;
      })()`,
    )) === true &&
      !reviewText.includes('Kies een prijs') &&
      (await bodyText(cdp)).includes('Fictief glas wijn') &&
      (await bodyText(cdp)).includes('Glas 4,50 / Fles 24,00'),
    (await bodyText(cdp)).match(/Fictief glas wijn[^\n]*/)?.[0] || 'missing',
  );
  await evalJs(cdp, `(() => { const el = document.getElementById('mai-s3'); if (el) el.scrollIntoView({ block: 'start', behavior: 'instant' }); return true; })()`);
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, `ai-read-review-390-${theme}.png`));
  // BB3: met de handmatige route open én de review zichtbaar lopen de nummers
  // door tot 4, in de volgorde van het scherm.
  const reviewLayout = await readAiLayout(cdp);
  check(
    'ai read: the review is step 3 while only the AI route is visible',
    reviewLayout.stepNumbers.join(',') === '1,2,3',
    JSON.stringify(reviewLayout.stepNumbers),
  );
  await clickButton(cdp, 'Liever zelf invoeren of plakken');
  await waitFor(cdp, `Boolean(document.getElementById('mai-s1') && document.getElementById('mai-s2'))`, 10000);
  const fourSteps = await readAiLayout(cdp);
  check(
    'ai read: with both routes open the steps run 1, 2, 3, 4 without a gap',
    fourSteps.stepNumbers.join(',') === '1,2,3,4',
    JSON.stringify(fourSteps.stepNumbers),
  );
  await clickButton(cdp, 'Liever zelf invoeren of plakken');
  await waitFor(cdp, `!document.getElementById('mai-s1')`, 10000);
  recordClickpath(
    `ai read (${theme})`,
    [
      'Laat AI de kaart lezen',
      'Liever zelf invoeren of plakken',
      'Prompt maken',
      'Antwoord plakken',
      'Liever zelf invoeren of plakken',
      'Lees met AI',
      'Concept klaar',
      'Nalopen',
      'Gelezen door AI',
    ],
    Boolean(manualOpen && done && reviewed),
  );


  // Zonder sleutel of vlag: rustige melding en de oude handmatige flow direct zichtbaar.
  await openRoute(cdp, aiUrl(theme, { aiState: 'off' }), `document.body.innerText.includes('AI is niet ingesteld')`);
  const offLayout = await readAiLayout(cdp);
  const offText = await bodyText(cdp);
  check('ai read: without a key or flag the block says AI is niet ingesteld', offText.includes('AI is niet ingesteld.'), (offText.match(/AI is niet ingesteld[^\n]*/) || ['missing'])[0]);
  check('ai read: without a key or flag there is no AI card or button', offLayout.present === false && !offText.includes('Lees met AI'));
  check(
    'ai read: without AI the manual flow stays unchanged and directly visible',
    offLayout.steps.one && offLayout.steps.two && offLayout.steps.three && offText.includes('Prompt maken') && offText.includes('Antwoord plakken'),
    JSON.stringify(offLayout.steps),
  );
  const offTop = await evalJs(cdp, `(() => {
    window.scrollTo(0, 0);
    const message = [...document.querySelectorAll('p')].find((el) => el.innerText.trim() === 'AI is niet ingesteld.');
    const rect = message ? message.getBoundingClientRect() : null;
    return rect ? { top: Math.round(rect.top), visible: rect.top >= 0 && rect.top < window.innerHeight } : null;
  })()`);
  check('ai read: the quiet message is visible without AI', Boolean(offTop && offTop.visible), JSON.stringify(offTop));
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, `ai-read-off-390-${theme}.png`));
}

/** De batchplek: hetzelfde blok als mockupscherm 1, in het mislukte resultaat. */
async function aiReadBatchScenario(cdp, theme) {
  await setViewport(cdp, 390, 900);
  await openRoute(
    cdp,
    `${BATCH_URL}?fixture=partial&${BATCH_QUERY}&item=1&theme=${theme}`,
    `document.body.innerText.includes('Geen herkende gerechten')`,
  );
  const snapshot = await evalJs(cdp, `(() => {
    const block = document.querySelector('.bta-ai-help');
    if (block) block.scrollIntoView({ block: 'start', behavior: 'instant' });
    const button = block ? [...block.querySelectorAll('a')].find((el) => el.innerText.trim() === 'Lees met AI') : null;
    const link = block ? [...block.querySelectorAll('a')].find((el) => el.innerText.trim() === 'Liever zelf invoeren of plakken') : null;
    return {
      present: Boolean(block),
      title: block && block.querySelector('.bta-ai-title') ? block.querySelector('.bta-ai-title').innerText.trim() : null,
      buttonHref: button ? button.getAttribute('href') : null,
      manualHref: link ? link.getAttribute('href') : null,
      text: block ? block.innerText : '',
      inFailedResult: Boolean(block && block.closest('.bta-result')),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  })()`);
  check(
    'ai read batch: the failed result offers the AI card of mockup screen 1',
    snapshot.present && snapshot.inFailedResult && snapshot.title === 'Laat AI de kaart lezen' && snapshot.text.includes('Kost ongeveer 1 cent'),
    JSON.stringify(snapshot).slice(0, 300),
  );
  check(
    'ai read batch: the card opens the existing job and keeps the manual route',
    (snapshot.buttonHref || '').includes('job=') && (snapshot.manualHref || '').startsWith('/internal/menu-import'),
    JSON.stringify({ buttonHref: snapshot.buttonHref, manualHref: snapshot.manualHref }),
  );
  check('ai read batch: no horizontal overflow at 390 px', snapshot.overflow <= 0, `overflow=${snapshot.overflow}`);
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, `ai-read-batch-390-${theme}.png`));
}

/** Toetsenbord: de AI-knop is met Tab en Enter te bedienen. */
async function aiReadKeyboardScenario(cdp) {
  await setViewport(cdp, 390, 900);
  await openRoute(cdp, aiUrl('light'), `document.body.innerText.includes('Laat AI de kaart lezen')`);
  const focused = await tabUntil(cdp, 'Lees met AI');
  await pressKey(cdp, 'Enter', 'Enter', 13, '\r');
  const keyboardDone = await waitFor(cdp, `document.body.innerText.includes('Concept klaar')`, 20000);
  check('ai read: the button works with the keyboard', Boolean(focused) && Boolean(keyboardDone), JSON.stringify({ focused, keyboardDone }));
}


// ── Variant 1 (Delivery Lead order 6382189724): niet-overgenomen regels ──────
// De fixture antwoordt met een fictieve dinerkaart waarin twee regels een prijs
// printen die geen gerecht dekt, en met de twee vervolgstanden (na Toevoegen en
// na Geen gerecht). Geen model, geen sleutel, geen netwerk.

function manualCoverageUrl(theme) {
  const params = new URLSearchParams({
    fixture: 'manual-coverage',
    restaurant: fixtures.RESTAURANT.id,
    name: fixtures.RESTAURANT.name,
    url: 'https://fictief-brasserie.invalid/diner',
    aiState: 'off',
    theme,
  });
  return `${MANUAL_URL}?${params.toString()}`;
}

/** Maakt de prompt, plakt het fictieve antwoord en opent de review. */
async function openCoverageReview(cdp, theme) {
  await openRoute(cdp, manualCoverageUrl(theme), `document.body.innerText.includes('Prompt maken')`);
  await clickButton(cdp, 'Prompt maken');
  await waitFor(cdp, `document.body.innerText.includes('gaat mee in de prompt')`, 15000);
  await setFieldValue(cdp, '#mai-answer', 'Korte samenvatting.\n```json\n{"menus":[],"coverage":{}}\n```');
  await waitFor(cdp, `document.body.innerText.includes('Antwoord geplakt')`, 15000);
  await clickButton(cdp, 'Controleren');
  return waitFor(
    cdp,
    `document.body.innerText.includes('staan niet in het concept') || document.body.innerText.includes('staat niet in het concept')`,
    15000,
  );
}

async function readUncovered(cdp) {
  return evalJs(
    cdp,
    `(() => {
      const block = document.querySelector('.mai-uncovered');
      const list = document.querySelector('.mai-review-list');
      if (block) block.scrollIntoView({ block: 'start', behavior: 'instant' });
      const rect = block ? block.getBoundingClientRect() : null;
      const styles = block ? getComputedStyle(block) : null;
      const root = getComputedStyle(document.documentElement);
      const probe = document.createElement('div');
      probe.style.color = 'var(--status-old)';
      probe.style.backgroundColor = 'var(--status-old-bg)';
      document.body.appendChild(probe);
      const probeStyle = getComputedStyle(probe);
      const attentionRgb = probeStyle.color;
      const attentionBackgroundRgb = probeStyle.backgroundColor;
      probe.remove();
      const rows = block ? Array.from(block.querySelectorAll('.mai-uncovered-row')) : [];
      return {
        present: Boolean(block),
        title: block && block.querySelector('.mai-uncovered-title') ? block.querySelector('.mai-uncovered-title').innerText.trim() : null,
        lines: rows.map((row) => ({
          quote: row.querySelector('.mai-quote') ? row.querySelector('.mai-quote').innerText.trim() : null,
          meta: Array.from(row.querySelectorAll('.mai-why')).map((el) => el.innerText.trim()).join(' | '),
          buttons: Array.from(row.querySelectorAll('button')).map((el) => el.innerText.trim()),
          accessible: Array.from(row.querySelectorAll('button')).map((el) => el.getAttribute('aria-label')),
          focusable: Array.from(row.querySelectorAll('button')).every((el) => el.tabIndex >= 0 && !el.disabled),
        })),
        free: block && block.querySelector('.mai-uncovered-free') ? block.querySelector('.mai-uncovered-free').innerText.trim() : null,
        aboveList: Boolean(block && list && (block.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0),
        background: styles ? styles.backgroundColor : null,
        borderLeft: styles ? styles.borderLeftColor : null,
        attentionRgb,
        attentionBackgroundRgb,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        top: rect ? Math.round(rect.top) : null,
        height: window.innerHeight,
        focused: document.activeElement ? document.activeElement.getAttribute('aria-label') : null,
        text: document.body.innerText,
      };
    })()`,
  );
}

async function manualUncoveredScenario(cdp) {
  // 390 px, donker: the block with two lines, above nalopen.
  await setViewport(cdp, 390, 900);
  const shown = await openCoverageReview(cdp, 'dark');
  check('uncovered lines: the review opens with the comparison', shown);
  const block = await readUncovered(cdp);
  check(
    'uncovered lines: the block is shown above the nalopen list',
    Boolean(block) && block.present && block.aboveList,
    JSON.stringify({ present: block && block.present, aboveList: block && block.aboveList }),
  );
  check(
    'uncovered lines: the heading counts the lines in plain language',
    Boolean(block) && block.title === '2 regels met een prijs staan niet in het concept',
    block ? block.title : 'no block',
  );
  check(
    'uncovered lines: each line shows its quote, page and section, with two buttons',
    Boolean(block) &&
      block.lines.length === 2 &&
      block.lines[0].quote === '“Fictieve carpaccio 11,00”' &&
      block.lines[0].meta === 'Pagina source-1 · website · regel 4 · onder Voorgerechten' &&
      block.lines[0].buttons.join('|') === 'Toevoegen|Geen gerecht' &&
      block.lines[1].quote === '“Fictieve steak 24,50”',
    block ? JSON.stringify(block.lines) : 'no block',
  );
  check(
    'uncovered lines: the free note is visible',
    Boolean(block) && block.free === 'Gratis: geen extra AI-aanroep nodig',
    block ? block.free : 'no block',
  );
  check(
    'uncovered lines: the block uses the orange attention tokens of this theme',
    Boolean(block) && block.borderLeft === block.attentionRgb && block.background === block.attentionBackgroundRgb,
    block ? JSON.stringify({ borderLeft: block.borderLeft, attentionRgb: block.attentionRgb, background: block.background, attentionBackgroundRgb: block.attentionBackgroundRgb }) : 'no block',
  );
  check('uncovered lines: no horizontal overflow at 390 px', Boolean(block) && block.overflow <= 0, block ? `overflow=${block.overflow}` : 'no block');
  check(
    'uncovered lines: the block is in view for the screenshot',
    Boolean(block) && block.top !== null && block.top >= 0 && block.top < block.height,
    block ? JSON.stringify({ top: block.top, height: block.height }) : 'no block',
  );
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'ai-uncovered-390-dark.png'));
  recordClickpath(
    'manual import: uncovered source lines',
    ['Menu importeren met AI', 'Prompt maken', 'Controleren', 'Toevoegen', 'Geen gerecht'],
    Boolean(block) && block.lines.length === 2,
  );

  // Keyboard: focus the first Toevoegen button and press Enter. The line
  // disappears and the new dish appears in nalopen with a section to check.
  const focused = await evalJs(cdp, `(() => {
    const button = document.querySelector('.mai-uncovered-row button');
    if (!button) return null;
    button.focus();
    return document.activeElement === button ? button.getAttribute('aria-label') : null;
  })()`);
  check('uncovered lines: the Toevoegen button takes focus', focused === 'Toevoegen: Fictieve carpaccio 11,00', focused);
  await pressKey(cdp, 'Enter', 'Enter', 13, '\r');
  const afterAdd = await waitFor(cdp, `document.querySelectorAll('.mai-uncovered-row').length === 1`, 15000);
  check('uncovered lines: Toevoegen removes the line after the server answer', afterAdd);
  const added = await readUncovered(cdp);
  check(
    'uncovered lines: the remaining uncovered line is the other one',
    Boolean(added) && added.lines.length === 1 && added.lines[0].quote === '“Fictieve steak 24,50”',
    added ? JSON.stringify(added.lines) : 'no block',
  );
  check(
    'uncovered lines: the added dish is in nalopen with a section to check',
    Boolean(added) && added.text.includes('Fictieve carpaccio') && added.text.includes('menukopje controleren'),
    added ? (added.text.match(/Fictieve carpaccio[^\n]*/) || ['missing'])[0] : 'no block',
  );
  check('uncovered lines: no horizontal overflow after adding', Boolean(added) && added.overflow <= 0, added ? `overflow=${added.overflow}` : 'no block');
  await evalJs(cdp, `(() => { const el = document.querySelector('.mai-uncovered'); if (el) el.scrollIntoView({ block: 'start', behavior: 'instant' }); return true; })()`);
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'ai-uncovered-after-add-390-dark.png'));

  // "Geen gerecht" on the last line: the block disappears with its last line.
  await clickButton(cdp, 'Geen gerecht');
  const gone = await waitFor(cdp, `!document.querySelector('.mai-uncovered')`, 15000);
  check('uncovered lines: the block disappears when no line is left', gone);
  const empty = await readUncovered(cdp);
  check('uncovered lines: nothing is invented after the last choice', empty.present === false, JSON.stringify(empty.lines));
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'ai-uncovered-empty-390-dark.png'));

  // 390 px light and 320 px light: the same block within the viewport.
  for (const [width, theme] of [[390, 'light'], [320, 'light']]) {
    await setViewport(cdp, width, 900);
    const opened = await openCoverageReview(cdp, theme);
    const narrow = await readUncovered(cdp);
    check(`uncovered lines ${width}px/${theme}: the block is shown`, Boolean(opened) && Boolean(narrow) && narrow.present);
    check(
      `uncovered lines ${width}px/${theme}: both lines and both buttons stay visible`,
      Boolean(narrow) && narrow.lines.length === 2 && narrow.lines.every((line) => line.buttons.length === 2 && line.focusable),
      narrow ? JSON.stringify(narrow.lines.map((line) => line.buttons)) : 'no block',
    );
    check(
      `uncovered lines ${width}px/${theme}: the buttons are named for screen readers`,
      Boolean(narrow) && narrow.lines.every((line) => line.accessible.every((label) => typeof label === 'string' && label.length > 0)),
      narrow ? JSON.stringify(narrow.lines.map((line) => line.accessible)) : 'no block',
    );
    check(`uncovered lines ${width}px/${theme}: no horizontal overflow`, Boolean(narrow) && narrow.overflow <= 0, narrow ? `overflow=${narrow.overflow}` : 'no block');
    await evalJs(cdp, `(() => { const el = document.querySelector('.mai-uncovered'); if (el) el.scrollIntoView({ block: 'start', behavior: 'instant' }); return true; })()`);
    screenshotFiles.push(await screenshot(cdp, OUT_DIR, `ai-uncovered-${width}-${theme}.png`));
  }
}

// ── Variant 5 (Lead order 6382953597): Lijst | Kaart, de kaart met markeringen
// en de acties in het paneel. Fixture en ontwikkelaarsbewijs: geen echt
// restaurant, geen model, geen sleutel en geen opslag.

function manualMapUrl(theme) {
  const params = new URLSearchParams({
    fixture: 'manual-map',
    restaurant: fixtures.RESTAURANT.id,
    name: fixtures.RESTAURANT.name,
    url: 'https://fictief-brasserie.invalid/diner',
    aiState: 'off',
    theme,
  });
  return `${MANUAL_URL}?${params.toString()}`;
}

/** Maakt de prompt, plakt het fictieve antwoord en wacht op de schakelaar. */
async function openMapReview(cdp, theme) {
  await openRoute(cdp, manualMapUrl(theme), `document.body.innerText.includes('Prompt maken')`);
  await clickButton(cdp, 'Prompt maken');
  await waitFor(cdp, `document.body.innerText.includes('gaat mee in de prompt')`, 15000);
  await setFieldValue(cdp, '#mai-answer', 'Korte samenvatting.\n```json\n{"menus":[],"coverage":{}}\n```');
  await waitFor(cdp, `document.body.innerText.includes('Antwoord geplakt')`, 15000);
  await clickButton(cdp, 'Controleren');
  return waitFor(cdp, `Boolean(document.querySelector('.mai-view-toggle'))`, 15000);
}

/** De zichtbare kaartstand, inclusief welke fictieve routes al zijn aangeroepen. */
async function readMap(cdp) {
  return evalJs(
    cdp,
    `(() => {
      const root = document.querySelector('.mai-map');
      const lines = root ? Array.from(root.querySelectorAll('.mai-map-line')) : [];
      const marks = root ? Array.from(root.querySelectorAll('.mai-map-mark')) : [];
      return {
        present: Boolean(root),
        legend: root ? Array.from(root.querySelectorAll('.mai-map-legend-item')).map((el) => ({
          label: (el.querySelector('.mai-map-legend-label') || {}).innerText || '',
          detail: (el.querySelector('.mai-map-legend-detail') || {}).innerText || '',
          swatch: (el.querySelector('.mai-map-swatch') || {}).innerText || '',
        })) : [],
        chips: root ? Array.from(root.querySelectorAll('.mai-map-chip')).map((el) => ({
          label: (el.querySelector('.mai-map-chip-label') || {}).innerText || '',
          glyph: (el.querySelector('.mai-map-swatch') || {}).innerText || '',
          top: Math.round(el.getBoundingClientRect().top),
          height: Math.round(el.getBoundingClientRect().height),
          left: Math.round(el.getBoundingClientRect().left),
          right: Math.round(el.getBoundingClientRect().right),
        })) : [],
        legendRowHeight: root && root.querySelector('.mai-map-chips') ? Math.round(root.querySelector('.mai-map-chips').getBoundingClientRect().height) : 0,
        explain: root && root.querySelector('.mai-map-legend-more')
          ? {
              tag: root.querySelector('.mai-map-legend-more').tagName,
              open: root.querySelector('.mai-map-legend-more').open,
              summary: (root.querySelector('.mai-map-legend-summary') || {}).innerText || '',
            }
          : null,
        sources: root ? Array.from(root.querySelectorAll('.mai-map-source')).map((el) => ({ text: (el.innerText || '').trim(), pressed: el.getAttribute('aria-pressed') })) : [],
        notice: root && root.querySelector('.mai-map-notice') ? root.querySelector('.mai-map-notice').innerText.trim() : null,
        counts: root && root.querySelector('.mai-map-counts') ? root.querySelector('.mai-map-counts').innerText.trim() : null,
        page: root && root.querySelector('.mai-map-pages') ? root.querySelector('.mai-map-pages .mai-why').innerText.trim() : null,
        marks: marks.map((el) => ({ aria: el.getAttribute('aria-label'), expanded: el.getAttribute('aria-expanded'), tone: (el.className.match(/mai-map-mark--([a-z_]+)/) || [])[1] || null })),
        lines: lines.map((el) => ({
          text: el.querySelector('.mai-map-text') ? el.querySelector('.mai-map-text').innerText.trim() : '',
          tone: (el.className.match(/mai-map-line--([a-z_]+)/) || [])[1] || null,
          marker: Boolean(el.querySelector('.mai-map-mark')),
        })),
        panels: root ? Array.from(root.querySelectorAll('.mai-map-panel')).map((el) => ({
          tone: (el.className.match(/mai-map-panel--([a-z_]+)/) || [])[1] || null,
          text: el.innerText.trim(),
          buttons: Array.from(el.querySelectorAll('button')).map((b) => b.innerText.trim()),
          named: Array.from(el.querySelectorAll('button')).every((b) => Boolean(b.getAttribute('aria-label'))),
          aria: el.getAttribute('aria-label'),
        })) : [],
        toggles: Array.from(document.querySelectorAll('.mai-view-btn')).map((el) => ({ text: el.innerText.trim(), pressed: el.getAttribute('aria-pressed') })),
        images: root ? root.querySelectorAll('img, canvas, iframe').length : 0,
        cardCalls: (window.__FIXTURE_CALLS__ || []).filter((entry) => entry.routeId === 'manual-source-map').length,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    })()`,
  );
}

/** Klikt de markering van een bepaalde kleur (de knop zelf, geen tekstmatch). */
async function clickMark(cdp, tone) {
  return evalJs(
    cdp,
    `(() => {
      const el = document.querySelector('.mai-map-mark--${tone}');
      if (!el) return false;
      el.click();
      return true;
    })()`,
  );
}

async function manualCardScenario(cdp, theme, width = 390) {
  await setViewport(cdp, width, 900);
  const opened = await openMapReview(cdp, theme);
  check(`kaart ${width}px/${theme}: de review opent met de schakelaar Lijst | Kaart`, opened);
  const before = await readMap(cdp);
  check(
    `kaart ${width}px/${theme}: de kaart is niet geladen en er is geen pagina opgevraagd`,
    before.present === false && before.cardCalls === 0 && before.toggles.length === 2,
    JSON.stringify({ present: before.present, calls: before.cardCalls, toggles: before.toggles }),
  );
  check(
    `kaart ${width}px/${theme}: Lijst staat aan en de kaart nog niet`,
    Boolean(before.toggles[0]) && before.toggles[0].pressed === 'true' && before.toggles[1].pressed === 'false',
    JSON.stringify(before.toggles),
  );

  // De kaart opent en laadt pas dan één pagina.
  await clickButton(cdp, 'Kaart');
  const shown = await waitFor(cdp, `Boolean(document.querySelector('.mai-map-lines'))`, 15000);
  check(`kaart ${width}px/${theme}: de kaart toont de regels van de bron`, shown);
  const map = await readMap(cdp);
  check(`kaart ${width}px/${theme}: precies één kaartpagina is opgevraagd`, map.cardCalls === 1, `calls=${map.cardCalls}`);
  check(
    `kaart ${width}px/${theme}: de legenda is één regel met vier kleine chips in volgorde`,
    map.chips.length === 4 &&
      map.chips.map((entry) => entry.label).join('|') === 'Overgenomen|Niet overgenomen|Prijs wijkt af|Geen gerecht' &&
      map.chips.map((entry) => entry.glyph).join('') === '✓○▲–' &&
      map.chips.every((entry) => entry.height > 0) &&
      (width > 320 ? new Set(map.chips.map((entry) => entry.top)).size === 1 && map.legendRowHeight <= 26 : map.legendRowHeight <= 50),
    JSON.stringify({ chips: map.chips, row: map.legendRowHeight }),
  );
  // BB3 (Lead review 6384867373): de chips plakten aan elkaar. Elke volgende
  // chip begint nu minstens 6 px na het einde van de vorige (op een eigen regel
  // geldt de rijafstand, die de wrapper al meet).
  const chipGaps = map.chips.slice(1).map((entry, index) => {
    const previous = map.chips[index];
    return entry.top === previous.top ? entry.left - previous.right : null;
  });
  check(
    `kaart ${width}px/${theme}: de legenda-chips hebben ruimte tussen zich`,
    chipGaps.filter((gap) => gap !== null).length >= (width > 320 ? 3 : 1) &&
      chipGaps.filter((gap) => gap !== null).every((gap) => gap >= 6),
    JSON.stringify({ gaps: chipGaps, chips: map.chips.map((entry) => [entry.label, entry.left, entry.right]) }),
  );
  check(
    `kaart ${width}px/${theme}: de lange uitleg zit dicht achter "Uitleg"`,
    Boolean(map.explain) && map.explain.tag === 'DETAILS' && map.explain.open === false && map.explain.summary === 'Uitleg',
    JSON.stringify(map.explain),
  );
  await evalJs(cdp, `(() => { const el = document.querySelector('.mai-map-legend-summary'); if (el) el.click(); return true; })()`);
  const explainOpened = await waitFor(cdp, `Boolean(document.querySelector('.mai-map-legend-more[open]'))`, 5000);
  const explained = await readMap(cdp);
  check(
    `kaart ${width}px/${theme}: "Uitleg" opent de vier regels met de vorm én de volledige tekst`,
    explainOpened &&
      explained.legend.length === 4 &&
      explained.legend.map((entry) => entry.label).join('|') === 'Overgenomen|Niet overgenomen|Prijs wijkt af|Geen gerecht' &&
      explained.legend.every((entry) => entry.swatch.length > 0 && entry.detail.length > 10),
    JSON.stringify(explained.legend),
  );
  await evalJs(cdp, `(() => { const el = document.querySelector('.mai-map-legend'); if (el) el.scrollIntoView({ block: 'start', behavior: 'instant' }); return true; })()`);
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, `ai-map-legend-uitleg-${width}-${theme}.png`));
  await evalJs(cdp, `(() => { const el = document.querySelector('.mai-map-legend-more'); if (el) el.open = false; return true; })()`);
  check(
    `kaart ${width}px/${theme}: een prijs zonder centen en zonder € staat als prijs op de kaart (AA1)`,
    map.lines.some((line) => /^Fictieve zeebaars 34/.test(line.text) && line.tone === 'uncovered' && line.marker === true) &&
      map.marks.some((mark) => /Fictieve zeebaars: niet overgenomen, kaart 34/.test(mark.aria || '')),
    JSON.stringify(map.lines.filter((line) => /zeebaars|bisque/i.test(line.text))),
  );
  check(
    `kaart ${width}px/${theme}: de bronnen staan in volgorde met hun weergave`,
    // BE-35 (#84): the third fixture source is a PDF without a text layer, so
    // the existing source list names exactly that (src/lib/menuSourceMap.js).
    map.sources.length === 3 &&
      map.sources[0].text.includes('Website') &&
      map.sources[1].text.includes('PDF') &&
      map.sources[2].text.includes('PDF zonder tekstlaag'),
    JSON.stringify(map.sources.map((entry) => entry.text)),
  );
  check(
    `kaart ${width}px/${theme}: de melding zegt dat dit de opgehaalde tekst van de website is`,
    map.notice === 'Opgehaalde tekst van de website',
    String(map.notice),
  );
  check(
    `kaart ${width}px/${theme}: rood, groen, oranje en grijs staan elk op hun eigen regel`,
    ['price_mismatch', 'covered', 'uncovered', 'not_dish'].every((tone) => map.lines.some((line) => line.tone === tone)),
    JSON.stringify(map.lines.map((line) => [line.text, line.tone])),
  );
  check(
    `kaart ${width}px/${theme}: regels zonder prijs blijven ongemarkeerd`,
    map.lines
      .filter((line) => line.text === 'FICTIEF DINER' || line.text === 'Voorgerechten')
      .every((line) => line.tone === null && line.marker === false),
    JSON.stringify(map.lines.filter((line) => line.tone === null).map((line) => line.text)),
  );
  check(
    `kaart ${width}px/${theme}: de prijs op een eigen regel hoort bij de naam erboven (één markering)`,
    map.marks.some((mark) => /Fictieve carpaccio: prijs wijkt af/.test(mark.aria || '')) &&
      map.lines.some((line) => line.text === '11,00' && line.marker === false && line.tone === 'price_mismatch'),
    JSON.stringify(map.lines),
  );
  check(
    `kaart ${width}px/${theme}: elke markering heeft een eigen tekst voor de schermlezer`,
    map.marks.length >= 4 && map.marks.every((mark) => typeof mark.aria === 'string' && mark.aria.length > 12),
    JSON.stringify(map.marks.map((mark) => mark.aria)),
  );
  check(`kaart ${width}px/${theme}: geen afbeelding of iframe in de kaart`, map.images === 0, `images=${map.images}`);
  check(`kaart ${width}px/${theme}: geen horizontale overflow`, map.overflow <= 0, `overflow=${map.overflow}`);
  await evalJs(cdp, `(() => { const el = document.querySelector('.mai-map'); if (el) el.scrollIntoView({ block: 'start', behavior: 'instant' }); return true; })()`);
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, `ai-map-${width}-${theme}.png`));

  // Rood: het paneel noemt beide prijzen en neemt de kaartprijs over.
  await clickMark(cdp, 'price_mismatch');
  const redOpen = await waitFor(cdp, `Boolean(document.querySelector('.mai-map-panel--price_mismatch'))`, 10000);
  const red = await readMap(cdp);
  const redPanel = red.panels.find((panel) => panel.tone === 'price_mismatch');
  check(
    `kaart ${width}px/${theme}: een tik op rood opent het paneel`,
    redOpen && Boolean(redPanel),
    JSON.stringify(red.panels.map((panel) => panel.tone)),
  );
  check(
    `kaart ${width}px/${theme}: het rode paneel noemt kaart- en conceptprijs en biedt overnemen of wijzigen`,
    Boolean(redPanel) &&
      /Kaart 11,00/.test(redPanel.text) &&
      /concept € 12,50/.test(redPanel.text) &&
      redPanel.buttons.join('|') === 'Neem 11,00 over|Wijzig' &&
      redPanel.named,
    redPanel ? JSON.stringify([redPanel.text, redPanel.buttons]) : 'no panel',
  );
  await evalJs(cdp, `(() => { const el = document.querySelector('.mai-map-panel--price_mismatch'); if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' }); return true; })()`);
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, `ai-map-red-panel-${width}-${theme}.png`));
  await clickButton(cdp, 'Neem 11,00 over');
  const taken = await waitFor(cdp, `document.body.innerText.includes('overgenomen uit de kaart')`, 15000);
  const afterTake = await readMap(cdp);
  check(
    `kaart ${width}px/${theme}: Neem de prijs over komt duurzaam terug in het paneel`,
    taken && afterTake.panels.some((panel) => /€ 11,00 overgenomen uit de kaart/.test(panel.text)),
    JSON.stringify(afterTake.panels.map((panel) => panel.text)),
  );
  const takeMessage = await evalJs(cdp, `document.body.innerText.includes('opslaan blijft een aparte stap')`);
  check(`kaart ${width}px/${theme}: de melding zegt dat opslaan een aparte stap blijft`, takeMessage, 'no message');

  // Oranje: Toevoegen of Geen gerecht, via hetzelfde durable pad.
  await clickMark(cdp, 'uncovered');
  const orangeOpen = await waitFor(cdp, `Boolean(document.querySelector('.mai-map-panel--uncovered'))`, 10000);
  const orange = await readMap(cdp);
  const orangePanel = orange.panels.find((panel) => panel.tone === 'uncovered');
  check(
    `kaart ${width}px/${theme}: het oranje paneel biedt Toevoegen en Geen gerecht`,
    orangeOpen && Boolean(orangePanel) && orangePanel.buttons.join('|') === 'Toevoegen|Geen gerecht' && orangePanel.named,
    orangePanel ? JSON.stringify(orangePanel.buttons) : 'no panel',
  );
  await evalJs(cdp, `(() => { const el = document.querySelector('.mai-map-panel--uncovered'); if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' }); return true; })()`);
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, `ai-map-orange-panel-${width}-${theme}.png`));
  // De eerste oranje regel (die de markering draagt) wordt grijs; de andere
  // oranje regels van de fictieve kaart blijven staan, want elke regel heeft
  // zijn eigen beslissing.
  const orangeLine = (orange.lines.find((line) => line.tone === 'uncovered' && line.marker) || {}).text || null;
  await clickButton(cdp, 'Geen gerecht');
  const dismissed = await waitFor(
    cdp,
    `(() => {
      const rows = Array.from(document.querySelectorAll('.mai-map-line')).map((el) => ({
        text: (el.querySelector('.mai-map-text') || {}).innerText || '',
        tone: (el.className.match(/mai-map-line--([a-z_]+)/) || [])[1] || null,
      }));
      return rows.some((row) => row.tone === 'not_dish') && !rows.some((row) => row.text === ${JSON.stringify(orangeLine)} && row.tone === 'uncovered');
    })()`,
    15000,
  );
  check(
    `kaart ${width}px/${theme}: Geen gerecht maakt die regel grijs en laat hem staan`,
    dismissed && Boolean(orangeLine),
    JSON.stringify({ line: orangeLine, dismissed }),
  );

  // Groen: het bijbehorende gerecht.
  await clickMark(cdp, 'covered');
  const greenOpen = await waitFor(cdp, `Boolean(document.querySelector('.mai-map-panel--covered'))`, 10000);
  const green = await readMap(cdp);
  const greenPanel = green.panels.find((panel) => panel.tone === 'covered');
  check(
    `kaart ${width}px/${theme}: een tik op groen toont het gerecht`,
    greenOpen && Boolean(greenPanel) && /Fictieve steak/.test(greenPanel.text) && greenPanel.buttons.length === 0,
    greenPanel ? greenPanel.text : 'no panel',
  );

  // PDF: eigen tekstweergave met eerlijke melding en pagina's op verzoek.
  await evalJs(cdp, `(() => { const el = [...document.querySelectorAll('.mai-map-source')].find((b) => b.innerText.includes('source-2')); if (el) el.click(); return true; })()`);
  const pdfShown = await waitFor(cdp, `document.body.innerText.includes('De echte PDF-pagina kan niet worden getoond')`, 15000);
  const pdf = await readMap(cdp);
  check(
    `kaart ${width}px/${theme}: een PDF toont de tekst met een eerlijke melding over de pagina-afbeelding`,
    pdfShown && typeof pdf.notice === 'string' && pdf.notice.includes('de import bewaart de PDF-bytes niet'),
    String(pdf.notice),
  );
  check(
    `kaart ${width}px/${theme}: pagina 1 van de PDF komt uit een eigen verzoek`,
    pdf.page === 'Pagina 1 van 2' && pdf.cardCalls >= 3,
    JSON.stringify({ page: pdf.page, calls: pdf.cardCalls }),
  );
  const callsBeforePageTwo = pdf.cardCalls;
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, `ai-map-pdf-${width}-${theme}.png`));
  await clickButton(cdp, 'Volgende');
  const pageTwo = await waitFor(cdp, `document.body.innerText.includes('Pagina 2 van 2')`, 15000);
  const second = await readMap(cdp);
  check(
    `kaart ${width}px/${theme}: pagina 2 wordt pas op verzoek geladen`,
    pageTwo && second.cardCalls === callsBeforePageTwo + 1 && second.lines.some((line) => line.text === 'Fictieve salade'),
    JSON.stringify({ calls: second.cardCalls, lines: second.lines.map((line) => line.text) }),
  );

  // Scan zonder tekst: geen verzonnen pagina. De fixturebron is een PDF zonder
  // tekstlaag, dus de kaart zegt dat met de bestaande melding
  // (src/lib/menuSourceMap.js PDF_SCAN_NOTICE) en toont geen regels.
  await evalJs(cdp, `(() => { const el = [...document.querySelectorAll('.mai-map-source')].find((b) => b.innerText.includes('source-3')); if (el) el.click(); return true; })()`);
  const imageShown = await waitFor(cdp, `document.body.innerText.includes('Deze PDF heeft geen tekstlaag; de pagina zelf wordt niet bewaard.')`, 15000);
  const image = await readMap(cdp);
  check(
    `kaart ${width}px/${theme}: een scan zonder tekst zegt eerlijk dat vergelijken nog niet kan`,
    imageShown && image.lines.length === 0 && String(image.notice).includes('Deze PDF heeft geen tekstlaag'),
    JSON.stringify({ notice: image.notice, lines: image.lines.length }),
  );

  // Terug naar de lijst: "Bekijk op kaart" opent dezelfde regel in de kaart.
  await clickButton(cdp, 'Lijst');
  const backToList = await waitFor(cdp, `Boolean(document.querySelector('.mai-review-list'))`, 10000);
  const back = await readMap(cdp);
  check(`kaart ${width}px/${theme}: Lijst brengt de nalopen-lijst terug`, backToList && back.present === false);
  const openedFromList = await evalJs(
    cdp,
    `(() => {
      const button = [...document.querySelectorAll('button')].find((el) => (el.innerText || '').trim() === 'Bekijk op kaart');
      if (!button) return false;
      button.click();
      return true;
    })()`,
  );
  const jumped = await waitFor(cdp, `Boolean(document.querySelector('.mai-map-line--focus'))`, 15000);
  const focused = await evalJs(
    cdp,
    `(() => {
      const line = document.querySelector('.mai-map-line--focus');
      const box = line ? line.getBoundingClientRect() : null;
      return {
        text: line && line.querySelector('.mai-map-text') ? line.querySelector('.mai-map-text').innerText.trim() : null,
        inView: Boolean(box) && box.top >= -8 && box.top <= window.innerHeight,
        source: [...document.querySelectorAll('.mai-map-source')]
          .filter((el) => el.getAttribute('aria-pressed') === 'true')
          .map((el) => el.innerText.trim()),
      };
    })()`,
  );
  check(
    `kaart ${width}px/${theme}: Bekijk op kaart opent de kaart, scrolt naar de regel en markeert hem`,
    openedFromList && jumped && Boolean(focused.text) && focused.inView,
    JSON.stringify(focused),
  );
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, `ai-map-from-list-${width}-${theme}.png`));
}

/** Toetsenbord: de schakelaar en een markering zijn met Tab en Enter te bedienen. */
async function manualCardKeyboardScenario(cdp) {
  await setViewport(cdp, 390, 900);
  const opened = await openMapReview(cdp, 'light');
  check('kaart toetsenbord: de review opent met de schakelaar', opened);
  const reached = await tabUntilInput(cdp, (info) => info.tag === 'BUTTON' && info.text === 'Kaart', 60);
  check('kaart toetsenbord: Tab bereikt de knop Kaart', Boolean(reached.info), JSON.stringify(reached.seen.slice(-5)));
  await pressKey(cdp, 'Enter', 'Enter', 13, '\r');
  const shown = await waitFor(cdp, `Boolean(document.querySelector('.mai-map-lines'))`, 15000);
  check('kaart toetsenbord: Enter opent de kaart', shown);
  // Focus de eerste markering en open hem met Enter: dezelfde actie als een tik.
  const focused = await evalJs(
    cdp,
    `(() => {
      const el = document.querySelector('.mai-map-mark');
      if (!el) return null;
      el.focus();
      return document.activeElement === el ? el.getAttribute('aria-label') : null;
    })()`,
  );
  check('kaart toetsenbord: een markering is met de tab/ focus bereikbaar en heeft een naam', Boolean(focused) && focused.length > 12, String(focused));
  await pressKey(cdp, 'Enter', 'Enter', 13, '\r');
  const panel = await waitFor(cdp, `Boolean(document.querySelector('.mai-map-panel'))`, 10000);
  check('kaart toetsenbord: Enter op de markering opent het paneel onder de regel', panel);
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'ai-map-keyboard-390-light.png'));
}

// BE-43 (#101): elk scenario is één benoemde stap. Met `--alleen=<naam>` draait
// alleen die stap; met `--lijst` zie je de namen zonder dat er iets start.
// Zonder vlag draait alles in deze volgorde, precies zoals voorheen.
const SCENARIOS = [
  { name: 'review', run: (cdp) => reviewScenario(cdp) },
  { name: 'read-only', run: (cdp) => readOnlyScenario(cdp) },
  { name: 'empty', run: (cdp) => emptyScenario(cdp) },
  { name: 'partial', run: (cdp) => partialScenario(cdp) },
  { name: 'image-only', run: (cdp) => imageOnlyScenario(cdp) },
  { name: 'structure', run: (cdp) => structureScenario(cdp) },
  { name: 'be30', run: (cdp) => be30Scenario(cdp) },
  // Stap 2 en 3 van de handmatige AI-import: stap 3 gaat verder op de pagina die
  // stap 2 achterliet en hoort dus direct na `manual-import`.
  { name: 'manual-import', run: (cdp) => manualImportScenario(cdp) },
  { name: 'manual-review-steps', run: (cdp) => manualReviewSteps(cdp) },
  // U1/U2: dit scenario opent zijn eigen afgekeurde antwoord.
  { name: 'manual-rejected', run: (cdp) => manualRejectedScenario(cdp) },
  // V1/V2 (review 6377050602): de afgeleide telling en status met de melding.
  { name: 'manual-normalized', run: (cdp) => manualNormalizedScenario(cdp) },
  // Variant 1 (order 6382189724): niet-overgenomen bronregels, met de
  // toetsenbordroute en de standen na Toevoegen en Geen gerecht.
  { name: 'manual-uncovered', run: (cdp) => manualUncoveredScenario(cdp) },
  // Variant 5 (order 6382953597): de schakelaar Lijst | Kaart, de markeringen,
  // de panelen en de luie kaartpagina. 390 px licht/donker en 320 px.
  {
    name: 'manual-card',
    run: async (cdp) => {
      for (const theme of ['light', 'dark']) await manualCardScenario(cdp, theme);
      await manualCardScenario(cdp, 'light', 320);
    },
  },
  { name: 'manual-card-keyboard', run: (cdp) => manualCardKeyboardScenario(cdp) },
  // #59 / BE-21 (review 6380804419): "Lees met AI" op het bestaande scherm.
  {
    name: 'ai-read',
    run: async (cdp) => {
      for (const theme of ['light', 'dark']) await aiReadScenario(cdp, theme);
    },
  },
  {
    name: 'ai-read-batch',
    run: async (cdp) => {
      for (const theme of ['light', 'dark']) await aiReadBatchScenario(cdp, theme);
    },
  },
  { name: 'ai-read-keyboard', run: (cdp) => aiReadKeyboardScenario(cdp) },
  { name: 'v2', run: (cdp) => v2Scenario(cdp) },
  { name: 'error', run: (cdp) => errorScenario(cdp) },
  {
    name: 'responsive',
    run: async (cdp) => {
      for (const width of [320, 390]) {
        for (const theme of ['light', 'dark']) await responsiveScenario(cdp, width, theme);
      }
      await responsiveScenario(cdp, 1024, 'dark');
      // Deze controle hoort bij dit scenario: alleen hier staan beide thema's.
      check('light and dark resolve to different background tokens', themeBackgrounds.light !== themeBackgrounds.dark, `${themeBackgrounds.light} / ${themeBackgrounds.dark}`);
    },
  },
  { name: 'keyboard', run: (cdp) => keyboardScenario(cdp) },
  { name: 'concept-list-clickpath', run: (cdp) => conceptListClickPath(cdp) },
  { name: 'concept-product-read-only', run: (cdp) => conceptProductReadOnlyScenario(cdp) },
  { name: 'concept-list-states', run: (cdp) => conceptListStatesScenario(cdp) },
  { name: 'concept-forced-write', run: (cdp) => conceptForcedWriteScenario(cdp) },
  {
    name: 'concept-responsive',
    run: async (cdp) => {
      for (const [width, theme] of [[320, 'light'], [390, 'light'], [390, 'dark'], [1024, 'dark']]) {
        await conceptResponsiveScenario(cdp, width, theme);
      }
    },
  },
  {
    name: 'concept-list-responsive',
    run: async (cdp) => {
      for (const [width, theme] of [[320, 'light'], [390, 'dark']]) {
        await conceptListResponsiveScenario(cdp, width, theme);
      }
      check('concept light and dark resolve to different background tokens', conceptThemeBackgrounds.light !== conceptThemeBackgrounds.dark, `${conceptThemeBackgrounds.light} / ${conceptThemeBackgrounds.dark}`);
    },
  },
  { name: 'concept-keyboard', run: (cdp) => conceptKeyboardScenario(cdp) },
  // BE-39 (#93): "Klaar voor publicatie" as the second badge in the list.
  { name: 'concept-publication', run: (cdp) => conceptPublicationScenario(cdp) },
  // De bewuste negatieve netwerkprobes en de afsluitende netwerkcontroles.
  {
    name: 'netwerk',
    run: async (cdp) => {
      await networkGuardScenario(cdp, networkGuard);
      const pageViolations = await evalJs(cdp, 'window.__FIXTURE_NETWORK_VIOLATIONS__ || []');
      check('network guard: page recorded only deliberate blocked attempts', pageViolations.every((entry) => entry.phase === 'negative-probe'), JSON.stringify(pageViolations.filter((entry) => entry.phase !== 'negative-probe').slice(0, 5)));
      networkEvidence = {
        guard: 'in-page fetch/XHR/WebSocket/EventSource/beacon + CDP Fetch + DNS lockdown',
        appViolations: networkGuard.appViolations(),
        deliberateViolations: networkGuard.negativeViolations(),
        pageViolations,
      };
    },
  },
];
const SELECTION = parseScenarioArgs(process.argv.slice(2), SCENARIOS);
// Een gefilterde run schrijft nooit naar het volledige bewijsbestand.
const EVIDENCE_PATH = filteredEvidencePath(BASE_EVIDENCE_PATH, SELECTION.filter);

async function main() {
  // BE-43 (#101): `--lijst` toont alleen de namen en `--alleen=<naam>` draait
  // de keuze. Een onbekende naam is een gebruiks fout: er start niets.
  const outcome = scenarioSelectionOutcome({ selection: SELECTION, entries: SCENARIOS, scriptName: SCRIPT_NAME });
  if (outcome.stop) {
    process.exitCode = outcome.exitCode;
    return;
  }

  const browserPath = findBrowser();
  if (!browserPath) {
    writeEvidence({ passed: false, head: 'pending-commit', dirty: true, error: 'browser_unavailable' });
    throw new Error('browser_unavailable: set BROWSER_PATH to an installed Edge/Chrome');
  }

  let server = null;
  let browser = null;
  let cdp = null;
  try {
    server = await startServer({ port: PORT, appUrl: `http://localhost:${PORT}`, outputDir: OUT_DIR });
    browser = await startBrowser(browserPath);
    cdp = new CdpClient(browser.target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    networkGuard = createNetworkGuard({ appOrigins: APP_ORIGINS, baseUrl: BATCH_URL });
    await enableFetchGuard(cdp, networkGuard);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: fixtureBootstrap(fixtures.scenarios, { appOrigins: APP_ORIGINS, baseUrl: BATCH_URL }),
    });

    scenarioRuns = await runScenarioSelection({ entries: SCENARIOS, checks, cdp, filter: SELECTION.filter });

    const exceptions = cdp.takeEvents('Runtime.exceptionThrown');
    check('no uncaught browser exception', exceptions.length === 0, JSON.stringify(exceptions.slice(0, 3)));
    const bootError = await evalJs(cdp, 'window.__FIXTURE_BOOT_ERROR__ || null');
    check('no fixture bootstrap error at the end', !bootError, bootError || 'ok');
    check('every page used the fictional fixture', (await evalJs(cdp, 'window.__FIXTURE_ACTIVE__ || null')) !== null);

    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT }).toString().trim();
    // The evidence file is this run's own output and is written after this
    // check. Exclude it so a clean code tree is not reported dirty merely
    // because a previous evidence run is being replaced.
    const statusLines = execFileSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT })
      .toString()
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((line) => !line.includes('ops/browser/evidence/menu-review-browser-evidence'));
    const dirty = statusLines.length > 0;
    const passed = checks.every((entry) => entry.passed);
    const evidence = writeEvidence({ passed, head, dirty, browser });

    console.log(`browser fixture checks: ${checks.filter((c) => c.passed).length}/${checks.length} passed`);
    console.log(`evidence: ${path.relative(REPO_ROOT, EVIDENCE_PATH)} (head ${evidence.head}${evidence.worktreeDirty ? ', dirty worktree' : ''})`);
    for (const failure of checks.filter((entry) => !entry.passed)) console.error(`FAIL: ${failure.name} — ${failure.detail}`);
    if (!passed) process.exitCode = 1;
  } catch (error) {
    const head = (() => {
      try {
        return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT }).toString().trim();
      } catch {
        return 'pending-commit';
      }
    })();
    writeEvidence({ passed: false, head, dirty: true, error: String((error && error.stack) || error), browser });
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    if (browser) killTree(browser.child);
    if (server) killTree(server);
    if (browser && browser.userDataDir) {
      try {
        fs.rmSync(browser.userDataDir, { recursive: true, force: true });
      } catch {
        // A locked temporary profile is harmless; it stays outside the repo.
      }
    }
  }
}


async function manualReviewSteps(cdp) {
  // Stap 3 — de twee open punten, elk met een eigen handeling.
  const step3 = await waitFor(cdp, `document.body.innerText.includes('3 gerechten · 1 in orde · 2 nalopen')`, 15000);
  check('manual import: step 3 summarises in plain language', step3);
  const saveBefore = await evalJs(cdp, `(() => {
    const button = [...document.querySelectorAll('button')].find((b) => b.innerText.includes('Opslaan als concept'));
    return button ? button.disabled : null;
  })()`);
  check('manual import: saving is disabled while points are open', saveBefore === true);

  await setFieldValue(cdp, 'select[aria-label="Kies de prijs voor Fictief glas wijn"]', '1');
  await clickButton(cdp, 'Kies');
  const afterPrice = await waitFor(cdp, `document.body.innerText.includes('1 nalopen')`, 15000);
  check('manual import: choosing a price resolves that line', afterPrice);
  await clickButton(cdp, 'Klopt');
  const reasonPanel = await waitFor(cdp, `document.body.innerText.includes('Waarom staat deze regel er toch?')`, 15000);
  check('manual import: "staat niet in de bron" asks for a reason', reasonPanel);
  const guardsReason = await evalJs(cdp, `(() => {
    const button = [...document.querySelectorAll('button')].find((b) => b.innerText.includes('Reden opslaan'));
    return button ? button.disabled : null;
  })()`);
  check('manual import: the reason cannot be saved empty', guardsReason === true);
  await setFieldValue(cdp, 'input[aria-label="Korte toelichting"]', 'Fictief op de papieren kaart gezien.');
  await clickButton(cdp, 'Reden opslaan');
  const afterReason = await waitFor(cdp, `document.body.innerText.includes('Alle punten zijn nagelopen')`, 15000);
  check('manual import: after the reason every point is handled', afterReason);

  const saveEnabled = await evalJs(cdp, `(() => {
    const button = [...document.querySelectorAll('button')].find((b) => b.innerText.includes('Opslaan als concept'));
    return button ? { disabled: button.disabled } : null;
  })()`);
  check('manual import: saving is enabled only after all human steps', Boolean(saveEnabled) && saveEnabled.disabled === false, JSON.stringify(saveEnabled));
  await clickButton(cdp, 'Opslaan als concept');
  const saved = await waitFor(cdp, `document.body.innerText.includes('Concept opgeslagen als versie 1')`, 15000);
  check('manual import: the existing concept route result is shown', saved);
  const savedText = await bodyText(cdp);
  // W6 (review 6380804419): the save message names the separate publish step.
  check('manual import: the confirmation keeps publishing a separate step', savedText.includes('Publiceren blijft een aparte stap'));
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'manual-ai-import-390-light.png'));

  // Toetsenbord: stap 1 is met Tab en Enter te bereiken en te activeren.
  await openRoute(cdp, manualUrl('dark'), `document.body.innerText.includes('Prompt maken')`);
  const reach = await tabUntil(cdp, 'Prompt maken', 60);
  check('manual import keyboard: "Prompt maken" is reachable with Tab', Boolean(reach.info), JSON.stringify(reach.seen.slice(-5)));
  if (reach.info) {
    await pressKey(cdp, 'Enter', 'Enter', 13, '\r');
    const opened = await waitFor(cdp, `document.body.innerText.includes('gaat mee in de prompt')`, 15000);
    check('manual import keyboard: Enter makes the prompt', opened);
  }

  // Licht/donker en 320/390 px op dezelfde stap-pagina.
  for (const [width, theme] of [[320, 'light'], [390, 'dark']]) {
    await setViewport(cdp, width, 900);
    await openRoute(cdp, manualUrl(theme), `document.body.innerText.includes('Menu importeren met AI')`);
    const snapshot = await evalJs(cdp, `(() => ({
      theme: document.documentElement.getAttribute('data-theme'),
      bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim().toLowerCase(),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      steps: [...document.querySelectorAll('h2')].map((h) => h.innerText),
      text: document.body.innerText,
    }))()`);
    check(`manual import ${width}px/${theme}: requested theme is active`, snapshot.theme === theme, snapshot.theme);
    check(`manual import ${width}px/${theme}: no horizontal overflow`, snapshot.overflow <= 0, `overflow=${snapshot.overflow}`);
    check(
      `manual import ${width}px/${theme}: all three steps are present`,
      snapshot.steps.join('|').includes('Prompt maken') &&
        snapshot.steps.join('|').includes('Antwoord plakken') &&
        snapshot.steps.join('|').includes('Nalopen en opslaan'),
    );
    check(`manual import ${width}px/${theme}: the plain-language intro is shown`, snapshot.text.includes('drie stappen'));
    themeBackgrounds[`manual-${theme}`] = snapshot.bg;
    screenshotFiles.push(await screenshot(cdp, OUT_DIR, `manual-ai-import-${width}-${theme}.png`));
  }
  check(
    'manual import light and dark resolve to different background tokens',
    themeBackgrounds['manual-light'] !== themeBackgrounds['manual-dark'],
    `${themeBackgrounds['manual-light']} / ${themeBackgrounds['manual-dark']}`,
  );

  // K2 — "Wissen" geeft het lege plakveld terug (aparte pagina, eenvoudige tekst).
  await openRoute(cdp, manualUrl('dark'), `document.body.innerText.includes('Prompt maken')`);
  await clickButton(cdp, 'Prompt maken');
  await waitFor(cdp, `document.body.innerText.includes('gaat mee in de prompt')`, 15000);
  await setFieldValue(cdp, '#mai-answer', 'Korte samenvatting zonder codeblok.');
  const wipeSummary = await waitFor(cdp, `document.body.innerText.includes('Antwoord geplakt')`, 15000);
  check('manual import: "Wissen" is offered next to the paste summary', wipeSummary);
  await clickButton(cdp, 'Wissen');
  const afterWipe = await evalJs(cdp, `(() => ({
    field: Boolean(document.querySelector('#mai-answer')),
    summary: document.body.innerText.includes('Antwoord geplakt'),
  }))()`);
  check('manual import: after wiping, the empty paste field returns', afterWipe.field === true && afterWipe.summary === false, JSON.stringify(afterWipe));
  // K5 — een verlopen stap geeft een gewone melding met [Opnieuw maken].
  await openRoute(cdp, manualExpiredUrl('light'), `document.body.innerText.includes('Prompt maken')`);
  await clickButton(cdp, 'Prompt maken');
  await waitFor(cdp, `document.body.innerText.includes('gaat mee in de prompt')`, 15000);
  await setFieldValue(cdp, '#mai-answer', 'Korte samenvatting zonder codeblok.');
  await waitFor(cdp, `document.body.innerText.includes('Antwoord geplakt')`, 15000);
  await clickButton(cdp, 'Controleren');
  const expiredNotice = await waitFor(cdp, `document.body.innerText.includes('Deze stap is verlopen')`, 15000);
  check('manual import: an expired step is a plain message, not a technical error', expiredNotice);
  const retryButton = await evalJs(cdp, `(() => {
    const button = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Opnieuw maken');
    return button ? { disabled: button.disabled } : null;
  })()`);
  check('manual import: an expired step offers "Opnieuw maken"', Boolean(retryButton) && retryButton.disabled === false, JSON.stringify(retryButton));
  await clickButton(cdp, 'Opnieuw maken');
  const remade = await waitFor(cdp, `document.body.innerText.includes('Prompt gemaakt')`, 15000);
  check('manual import: "Opnieuw maken" creates a new prompt from the same sources', remade);

}

main();
