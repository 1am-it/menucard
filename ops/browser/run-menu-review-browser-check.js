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

main();
