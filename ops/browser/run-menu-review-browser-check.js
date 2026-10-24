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

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(__dirname, 'output');
const EVIDENCE_DIR = path.join(__dirname, 'evidence');
const EVIDENCE_PATH = path.join(EVIDENCE_DIR, 'menu-review-browser-evidence.json');
const PORT = Number(process.env.BROWSER_FIXTURE_PORT || 3137);
const APP_ORIGINS = defaultAppOrigins(PORT);
const BATCH_URL = `http://localhost:${PORT}/internal/source-triage/batch`;
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

function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail: detail === undefined ? null : String(detail) });
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
  check('review: control is collapsed before the click path', !before.includes('8 gerechten in 4 rubrieken'));

  const clicked = await clickButton(cdp, 'Menukaart controleren');
  check('review: "Menukaart controleren" is a real button', clicked);
  const expanded = await waitFor(cdp, `document.body.innerText.includes('8 gerechten in 4 rubrieken')`, 15000);
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
      groupButtons: buttons.filter((b) => b.text === 'Rubriek klopt zo').length,
    };
  })()`);

  const text = snapshot.text;
  check('review: item and section counts come from the fixture', text.includes('8 gerechten in 4 rubrieken'));
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

  const breadcrumb = snapshot.links.find((link) => link.href === '/internal/source-triage');
  const original = snapshot.links.find((link) => link.href === fixtures.FOUND_URL);
  const review = snapshot.links.find((link) => link.href === `/internal/source-triage/batch?${BATCH_QUERY}&item=1`);
  check('review: breadcrumb link is exact', Boolean(breadcrumb), breadcrumb && breadcrumb.text);
  check('review: original menu link is exact and safe', original && original.target === '_blank' && original.rel.includes('noopener') && original.rel.includes('noreferrer'));
  check('review: "handmatig beoordelen" opens the same batch item', Boolean(review), review && review.href);
  check('review: light theme is active', snapshot.theme === 'light' && snapshot.bg === '#fcfaf4', `${snapshot.theme}/${snapshot.bg}`);
  check('review: address bar keeps the batch context', snapshot.url.includes(`batch=${fixtures.BATCH_ID}`), snapshot.url);
  check('review: no horizontal overflow at 1024 px', snapshot.overflow <= 0, `overflow=${snapshot.overflow}`);

  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'menu-review-desktop-light.png'));

  const closed = await clickButton(cdp, 'Controle sluiten');
  const collapsed = closed && (await waitFor(cdp, `!document.body.innerText.includes('8 gerechten in 4 rubrieken')`, 10000));
  check('review: "Controle sluiten" closes the same panel', collapsed);
}


async function readOnlyScenario(cdp) {
  await setViewport(cdp, 1024, 900);
  await openRoute(cdp, `${BATCH_URL}?fixture=readonly&${BATCH_QUERY}&item=1&theme=dark`, `document.body.innerText.includes('8 gerechten in 4 rubrieken')`);
  const snapshot = await evalJs(cdp, `(() => {
    const text = document.body.innerText;
    const buttons = [...document.querySelectorAll('button')].map((b) => (b.innerText || '').trim());
    return { text, buttons, overflow: document.documentElement.scrollWidth - window.innerWidth };
  })()`);
  check('readonly: colleague view is explicitly read-only', snapshot.text.includes('alleen lezen') && !snapshot.text.includes('Gestart door jou'));
  check('readonly: no save or group-accept control is offered', !snapshot.buttons.some((text) => text.includes('Concept opslaan') || text === 'Rubriek klopt zo'));
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
    `${BATCH_URL}?fixture=image_only&${BATCH_QUERY}&item=1&theme=light`,
    `document.body.innerText.includes('Menu alleen als afbeelding: niet ondersteund')`,
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
  check('image-only: the explicit non-supported status is shown', snapshot.text.includes('Menu alleen als afbeelding: niet ondersteund'));
  check('image-only: no successful extraction is claimed', !snapshot.text.includes('Menukaart gevonden') && !snapshot.text.includes('Bron bevestigd'));
  check('image-only: the reason stays visible', snapshot.text.includes('beeldanalyse/OCR is niet geconfigureerd'));
  check('image-only: no confirm action is offered', !snapshot.hasConfirm);
  check(
    'image-only: the human route is linked with restaurant and reason',
    snapshot.link === '/internal/source-triage?restaurant=9001&reason=image_only',
    snapshot.link,
  );
  check('image-only: no horizontal overflow at 390 px', snapshot.overflow <= 0, `overflow=${snapshot.overflow}`);
  check('image-only: light theme is active', snapshot.theme === 'light');
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'menu-review-image-only-390-light.png'));

  await setViewport(cdp, 320, 900);
  await openRoute(
    cdp,
    `${BATCH_URL}?fixture=image_only&${BATCH_QUERY}&item=1&theme=dark`,
    `document.body.innerText.includes('Menu alleen als afbeelding: niet ondersteund')`,
  );
  const small = await evalJs(cdp, `(() => ({
    text: document.body.innerText,
    theme: document.documentElement.getAttribute('data-theme'),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  }))()`);
  check('image-only: the status and reason also hold at 320 px/dark', small.text.includes('Menu alleen als afbeelding: niet ondersteund') && small.text.includes('beeldanalyse/OCR is niet geconfigureerd'));
  check('image-only: no horizontal overflow at 320 px', small.overflow <= 0, `overflow=${small.overflow}`);
  check('image-only: dark theme is active at 320 px', small.theme === 'dark');
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'menu-review-image-only-320-dark.png'));

  const steps = [{ action: 'open batch result', reached: true }];
  const clicked = await clickLink(cdp, 'Bronnen beoordelen');
  const arrived = await waitForPath(cdp, '/internal/source-triage', 'Bronnen beoordelen', 30000);
  steps.push({ action: 'click Bronnen beoordelen', href: clicked, reached: Boolean(clicked), arrived });
  const triage = await evalJs(cdp, `(() => {
    const detail = document.querySelector('.stg-detail-card');
    const block = document.querySelector('.stg-followup');
    return {
      pathname: location.pathname,
      search: location.search,
      text: document.body.innerText,
      detailTitle: (document.querySelector('.stg-detail-title') || {}).innerText || '',
      detailText: detail ? detail.innerText : '',
      followupText: block ? block.innerText : '',
      banner: (document.querySelector('.di-banner-neutral[role="note"]') || {}).innerText || '',
    };
  })()`);
  check('image-only follow-up: the existing Bronnen beoordelen page opens', arrived && triage.pathname === '/internal/source-triage');
  check('image-only follow-up: the restaurant is preselected', triage.detailTitle.includes('Fictief Brasserie Noord'));
  check(
    'image-only follow-up: the detail names the real reason',
    triage.detailText.includes('Menu alleen als afbeelding of scan: niet ondersteund'),
    triage.followupText,
  );
  check(
    'image-only follow-up: the detail names the fitting next step',
    triage.detailText.includes('Kies een andere tekst- of pdf-bron of markeer deze bron als onbruikbaar'),
    triage.detailText.slice(0, 200),
  );
  check(
    'image-only follow-up: the reason is not only a page banner',
    triage.followupText.length > 0 && triage.banner === '',
    `followup=${triage.followupText.slice(0, 80)} banner=${triage.banner.slice(0, 40)}`,
  );
  check(
    'image-only follow-up: the generic onboarding route stays visible as secondary context',
    triage.detailText.includes('Algemene route: Bron controleren via Onboarding Restaurant'),
    triage.detailText.slice(0, 200),
  );
  check('image-only follow-up: no menu status or confirmation is claimed', !triage.text.includes('Bron bevestigd') && !triage.text.includes('Menukaart gevonden'));
  check('image-only follow-up: the context is kept in the address bar', triage.search.includes('restaurant=9001') && triage.search.includes('reason=image_only'));
  check('image-only follow-up: no proposal or publication happened', triage.text.includes('Leg een voorstel vast') && !triage.text.includes('Bron bevestigd'));
  await evalJs(cdp, `(() => {
    const block = document.querySelector('.stg-followup');
    if (block) block.scrollIntoView({ block: 'center', behavior: 'instant' });
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'menu-review-image-only-follow-up-320-dark.png'));

  // R5: a fitting "unusable" reason exists. The human still chooses the action;
  // the existing `other` reason is preselected with its fixed, required note.
  const suggestion = await evalJs(cdp, `(async () => {
    const radio = document.querySelector('input[type="radio"][value="mark_unusable"]');
    if (!radio) return { found: false };
    radio.click();
    await new Promise((resolve) => setTimeout(resolve, 150));
    const select = document.querySelector('select[id$="-reason"]');
    const note = document.querySelector('textarea[id$="-note"]');
    const hint = document.querySelector('p[id$="-reason-help"]');
    return {
      found: Boolean(select),
      reason: select ? select.value : null,
      note: note ? note.value : null,
      required: note ? note.getAttribute('aria-required') : null,
      describedBy: select ? (select.getAttribute('aria-describedby') || '') : '',
      hint: hint ? hint.innerText : '',
      text: (document.querySelector('.stg-detail-card') || {}).innerText || '',
    };
  })()`);
  check('image-only follow-up: an unusable proposal can be prepared', suggestion.found);
  check('image-only follow-up: a fitting reason is preselected', suggestion.reason === 'other', String(suggestion.reason));
  check(
    'image-only follow-up: the fixed explanation is visible and filled in',
    (suggestion.note || '').includes('alleen als afbeelding of scan') && suggestion.hint.length > 0,
    `${suggestion.note} | ${suggestion.hint}`,
  );
  check('image-only follow-up: the preselected reason is described to assistive tech', String(suggestion.describedBy || '').includes('-reason-help'), suggestion.describedBy);
  check('image-only follow-up: the note stays required', suggestion.required === 'true', String(suggestion.required));
  check(
    'image-only follow-up: choosing the reason saves nothing by itself',
    suggestion.text.includes('Voorstel opslaan') && !suggestion.text.includes('Voorstel opgeslagen'),
  );
  await evalJs(cdp, `(() => {
    const select = document.querySelector('select[id$="-reason"]');
    if (select) select.scrollIntoView({ block: 'center', behavior: 'instant' });
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'menu-review-image-only-follow-up-reason-320-dark.png'));

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
  await openRoute(cdp, url('light'), `document.body.innerText.includes('Rubriekindeling controleren')`);

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
  check('structure: the existing "Menukaart controleren" path shows the section control', initial.text.includes('Rubriekindeling controleren'));
  check(
    'structure: each uncertain section carries its path, source route and locator',
    initial.rows.length === 2 &&
      initial.rows[0].includes(fixtures.structureSections[0].label) &&
      initial.rows[0].includes(fixtures.structureSections[0].sourceRoute) &&
      initial.rows[0].includes(fixtures.structureSections[0].locator) &&
      initial.rows[1].includes(fixtures.structureSections[1].label) &&
      initial.rows[1].includes(fixtures.structureSections[1].locator),
    JSON.stringify(initial.rows),
  );
  check('structure: nothing is treated before the human acts', initial.radios.length === 4 && initial.radios.every((r) => !r.checked));
  check('structure: the progress counter starts at 0 van 2', initial.text.includes('0 van 2 behandeld'));
  check(
    'structure: no one-click confirmation is offered before handling',
    !initial.buttons.some((b) => b.text.includes('Bevestig bron')),
    JSON.stringify(initial.buttons.map((b) => b.text)),
  );
  check('structure: no accept-all action exists', !/alles accepteren|accepteer alles|alles goedkeuren/i.test(initial.text));
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
  const panel = opened && (await waitFor(cdp, `document.body.innerText.includes('2 onzekere rubrieken behandeld')`, 10000));
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
      { step: 'uncertain result opens the section control', arrived: initial.text.includes('Rubriekindeling controleren') },
      { step: 'keep the first uncertain section', arrived: keptFirst === true },
      { step: 'correct the second uncertain section with a path', arrived: Boolean(inputReady && typed) },
      { step: 'all sections treated', arrived: completed === true },
      { step: 'confirmation panel shows the handled decisions', arrived: Boolean(panel) },
    ],
    Boolean(panel),
    JSON.stringify({ required: fixtures.structureSections.map((section) => section.label) }),
  );
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'menu-review-structure-1024-light.png'));

  // Keyboard: a fresh page at 390 px, Tab to the first decision radio, Space selects it.
  await setViewport(cdp, 390, 900);
  await openRoute(cdp, url('light'), `document.body.innerText.includes('Rubriekindeling controleren')`);
  const reach = await tabUntilInput(cdp, (info) => info.tag === 'INPUT' && info.type === 'radio');
  let keyboardOk = false;
  if (reach.info) {
    await pressKey(cdp, ' ', 'Space', 32, ' ');
    const selected = await waitFor(cdp, `document.body.innerText.includes('1 van 2 behandeld')`, 10000);
    const checked = await evalJs(cdp, `Boolean(document.querySelector('.bta-structure-choices input[type="radio"]:checked'))`);
    keyboardOk = selected && checked;
  }
  check('structure keyboard: Tab reaches a section decision and Space selects it', keyboardOk, reach.info ? `tabs=${reach.tabs}` : JSON.stringify(reach.seen.slice(-6)));
  screenshotFiles.push(await screenshot(cdp, OUT_DIR, 'menu-review-structure-keyboard-390-light.png'));

  // Responsive: 390 px in both themes, with the correction field open.
  for (const theme of ['light', 'dark']) {
    await setViewport(cdp, 390, 900);
    await openRoute(cdp, url(theme), `document.body.innerText.includes('Rubriekindeling controleren')`);
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
    `document.body.innerText.includes('Rubriekindeling controleren')`,
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
  check('concept v2 read-only: counts keep both items, the variant and the supplement', v2.text.includes('2 items') && v2.text.includes('1 rubriek') && v2.text.includes('2 prijsvarianten') && v2.text.includes('1 supplement'));
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
  await openRoute(cdp, reviewUrl({ theme, item: true }), `document.body.innerText.includes('8 gerechten in 4 rubrieken')`);
  const snapshot = await evalJs(cdp, `(() => {
    const breadcrumb = document.querySelector('a[href="/internal/source-triage"]');
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
  check(`responsive ${width}px/${theme}: the menu content is unchanged`, snapshot.text.includes('Fictief Lunch › Koud') && snapshot.text.includes('8 gerechten in 4 rubrieken'));
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
    const opened = await waitFor(cdp, `document.body.innerText.includes('8 gerechten in 4 rubrieken')`, 15000);
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
    command: 'npm run test:browser:menu-review',
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
    Boolean(block) && block.title === 'Laat AI de kaart lezen' && block.buttons.includes('Lees met AI') && block.text.includes('Kost ongeveer 1 cent · duurt ± 1 minuut'),
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


async function main() {
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

    await reviewScenario(cdp);
    await readOnlyScenario(cdp);
    await emptyScenario(cdp);
    await partialScenario(cdp);
    await imageOnlyScenario(cdp);
    await structureScenario(cdp);
    await manualImportScenario(cdp);
    await manualReviewSteps(cdp);
    // U1/U2: pas na de bestaande stroom, want die gaat verder op de pagina die
    // stap 2 achterliet. Dit scenario opent zijn eigen afgekeurde antwoord.
    await manualRejectedScenario(cdp);
    // V1/V2 (review 6377050602): de afgeleide telling en status met de melding.
    await manualNormalizedScenario(cdp);
    // #59 / BE-21 (review 6380804419): "Lees met AI" op het bestaande scherm.
    for (const theme of ['light', 'dark']) await aiReadScenario(cdp, theme);
    for (const theme of ['light', 'dark']) await aiReadBatchScenario(cdp, theme);
    await aiReadKeyboardScenario(cdp);
    await v2Scenario(cdp);
    await errorScenario(cdp);
    for (const width of [320, 390]) {
      for (const theme of ['light', 'dark']) await responsiveScenario(cdp, width, theme);
    }
    await responsiveScenario(cdp, 1024, 'dark');
    check('light and dark resolve to different background tokens', themeBackgrounds.light !== themeBackgrounds.dark, `${themeBackgrounds.light} / ${themeBackgrounds.dark}`);
    await keyboardScenario(cdp);
    await conceptListClickPath(cdp);
    await conceptProductReadOnlyScenario(cdp);
    await conceptListStatesScenario(cdp);
    await conceptForcedWriteScenario(cdp);
    for (const [width, theme] of [[320, 'light'], [390, 'light'], [390, 'dark'], [1024, 'dark']]) {
      await conceptResponsiveScenario(cdp, width, theme);
    }
    for (const [width, theme] of [[320, 'light'], [390, 'dark']]) {
      await conceptListResponsiveScenario(cdp, width, theme);
    }
    check('concept light and dark resolve to different background tokens', conceptThemeBackgrounds.light !== conceptThemeBackgrounds.dark, `${conceptThemeBackgrounds.light} / ${conceptThemeBackgrounds.dark}`);
    await conceptKeyboardScenario(cdp);
    await networkGuardScenario(cdp, networkGuard);

    const pageViolations = await evalJs(cdp, 'window.__FIXTURE_NETWORK_VIOLATIONS__ || []');
    check('network guard: page recorded only deliberate blocked attempts', pageViolations.every((entry) => entry.phase === 'negative-probe'), JSON.stringify(pageViolations.filter((entry) => entry.phase !== 'negative-probe').slice(0, 5)));
    networkEvidence = {
      guard: 'in-page fetch/XHR/WebSocket/EventSource/beacon + CDP Fetch + DNS lockdown',
      appViolations: networkGuard.appViolations(),
      deliberateViolations: networkGuard.negativeViolations(),
      pageViolations,
    };

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
      .filter((line) => !line.includes('ops/browser/evidence/menu-review-browser-evidence.json'));
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
