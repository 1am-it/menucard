'use strict';

// BE-64 (#156) — browsercheck voor /voor-restaurants.
//
// Fixture-bewijs: een echte browser via CDP en de echte pagina, met een verse
// productieopbouw (`next build` + `next start` in een eigen bouwmap, de
// BE-57-opzet). Geen Supabase-project, geen productiesleutel, geen
// productiedata, geen netwerk buiten de eigen app.
//
// Wat gemeten wordt, in licht en donker op 1280, 390 en 320 px:
//  - de hero: de h1, de intro, de twee knoppen (minstens 44 px hoog, naar
//    /mijn-restaurant/claimen en /inloggen) en de regel eronder;
//  - het voorbeeld van het weekoverzicht: vier tegels met "—" (geen cijfers) en
//    de regel "Voorbeeld van je eigen overzicht in Mijn restaurant";
//  - "Wat je krijgt": zes kaarten met een icoon in --accent, de titels uit het
//    contract en "Binnenkort" bij het QR-kaartje;
//  - het allergenenblok: de titel, de momentopname-tekst en de knop "Bekijk een
//    voorbeeld" naar /nvwa/<id> van een bestaand restaurant;
//  - de twee knoppen onderaan;
//  - de link "Voor restaurants" in de kop leidt naar deze pagina;
//  - de opmaak: vanaf 960 px staat het weekoverzicht rechts naast de h1-kolom,
//    staan de eerste drie kaarten in één rij en staat de allergenenknop rechts
//    van de tekst; op 390 en 320 px staat alles onder elkaar;
//  - geen horizontale overloop en alle onderdelen passen in beeld.
//
// Het thema van elke opname is aangetoond, niet aangenomen: vóór de opname gaat
// het thema via de themakeuze in het instellingenpaneel en legt themeProof
// `data-theme`, de actieve knop en de helderheid van `--bg` vast.
//
// Niet bewezen hier: de a11y-run (die draait apart:
// ops/browser/run-a11y-public-check.js --alleen=voor-restaurants). Dit is
// ontwikkelaarsbewijs, geen onafhankelijke review en geen productieacceptatie.
//
// Gebruik: node ops/browser/run-be64-browser-check.js
// Poort: BE64_PORT of 3188 (binnen 3180-3189). Draai deze check alleen.

const fs = require('node:fs');
const path = require('node:path');

const {
  findBrowser,
  killTree,
  startServer,
  startBrowser,
  evalJs,
  waitFor,
  navigate,
  screenshot,
} = require('./lib/runtime');
const { CdpClient } = require('./lib/cdp');
const { createNetworkGuard, enableFetchGuard, defaultAppOrigins } = require('./lib/network-policy');
const {
  THEME_LABELS,
  themeProofScript,
  clickThemeScript,
  themeProofValue,
  themeOk,
} = require('./lib/theme-proof');
const { FOR_RESTAURANTS } = require('../../src/lib/forRestaurantsCopy');

const SCRIPT_NAME = 'run-be64-browser-check.js';
const PORT = Number(process.env.BE64_PORT || 3188);
const APP = `http://localhost:${PORT}`;
const APP_ORIGINS = defaultAppOrigins(PORT);
const PAGE = '/voor-restaurants';
const OUT_DIR = path.join(__dirname, 'output', 'be-64');
const EVIDENCE_DIR = path.join(__dirname, 'evidence');
const EVIDENCE_PATH = path.join(EVIDENCE_DIR, 'be64-browser-evidence.json');
const SHOT_DIR = path.join(EVIDENCE_DIR, 'be-64');

const SIZES = [
  { name: '1280', width: 1280, height: 900 },
  { name: '390', width: 390, height: 844 },
  { name: '320', width: 320, height: 720 },
];

const SETTINGS_BUTTON = '.pha-settings';
const MENU_BUTTON = '.pha-menu';
const PANEL = '.pha-panel';

const checks = [];
const shots = [];
let networkEvidence = null;
let viewport = { width: 1280, height: 900 };

function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail: detail === undefined ? null : String(detail) });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function setViewport(cdp, width, height) {
  viewport = { width, height };
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  await waitFor(cdp, `window.innerWidth === ${width}`, 8000);
}

async function shot(cdp, name, meta = {}) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  // Een volledige viewport, geen uitsnede. De opname is altijd een PNG.
  const file = await screenshot(cdp, SHOT_DIR, `${name}.png`);
  shots.push({
    ...file,
    viewport: `${viewport.width}x${viewport.height}`,
    theme: meta.theme || null,
    state: meta.state || null,
    themeProof: meta.themeProof || null,
  });
  return file;
}

async function themeProof(cdp) {
  return themeProofValue(await evalJs(cdp, themeProofScript()));
}

// Het paneel openen zoals een bezoeker het opent: de instellingenknop op
// desktop, de menuknop op de telefoon. Beide knoppen bestaan al vóór de
// hydratatie, dus een klik die niets opent wordt herhaald.
async function openPanel(cdp, opener) {
  if (await evalJs(cdp, `Boolean(document.querySelector('${PANEL}'))`)) return true;
  const ready = await waitFor(cdp, `Boolean(document.querySelector('${opener}'))`, 15000);
  if (!ready) return false;
  for (let poging = 0; poging < 4; poging += 1) {
    await evalJs(cdp, `(() => { const b = document.querySelector('${opener}'); if (!b) return false; b.click(); return true; })()`);
    const open = await waitFor(cdp, `Boolean(document.querySelector('${PANEL}'))`, 4000);
    if (open) {
      await sleep(180);
      return true;
    }
    await sleep(400);
  }
  return false;
}

async function closePanel(cdp) {
  if (!(await evalJs(cdp, `Boolean(document.querySelector('${PANEL}'))`))) return true;
  await evalJs(cdp, `(() => { const b = document.querySelector('.pha-close'); if (!b) return false; b.click(); return true; })()`);
  return (await waitFor(cdp, `!document.querySelector('${PANEL}')`, 6000)) === true;
}

/**
 * Het thema zetten via de themakeuze in het paneel zelf (geen los attribuut en
 * geen schrijfactie in de opslag). Geeft het bewijs terug waarmee de opname
 * wordt gecontroleerd.
 */
async function applyTheme(cdp, theme, opener) {
  const label = THEME_LABELS[theme];
  if (!(await openPanel(cdp, opener))) throw new Error(`panel_missing: ${opener}`);
  const klaar = await waitFor(cdp, `document.querySelectorAll('.theme-btn').length >= 2`, 15000);
  if (!klaar) throw new Error(`theme_button_missing: ${label}`);
  for (let poging = 0; poging < 4; poging += 1) {
    const clicked = await evalJs(cdp, clickThemeScript(label));
    if (clicked !== 'clicked') throw new Error(`theme_button_missing: ${label}`);
    await sleep(300);
    const proof = await themeProof(cdp);
    if (themeOk(proof, theme)) return proof;
  }
  throw new Error(`theme_not_applied: ${label}`);
}

// Alles wat deze pagina op dit moment toont, in één meting: de tekst, de
// doelen van de knoppen, de hoogte van de tikvlakken en de kleur van de iconen.
const VR_STATE = `(() => {
  const tekst = (sel) => {
    const el = document.querySelector(sel);
    return el ? (el.innerText || '').replace(/\\s+/g, ' ').trim() : '';
  };
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return {
      visible: st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0 && r.height > 0,
      width: Math.round(r.width), height: Math.round(r.height),
      top: Math.round(r.top), bottom: Math.round(r.bottom),
    };
  };
  const link = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return { tekst: (el.innerText || '').replace(/\\s+/g, ' ').trim(), href: el.getAttribute('href'), box: box(sel) };
  };
  const stat = (sel) => {
    const el = document.querySelector(sel);
    return el ? (el.innerText || '').replace(/\\s+/g, ' ').trim() : '';
  };
  // De token --accent als echte kleur, om mee te vergelijken.
  const probe = document.createElement('span');
  probe.style.color = 'var(--accent)';
  document.body.appendChild(probe);
  const accent = getComputedStyle(probe).color;
  probe.remove();
  const icon = document.querySelector('.vr-feature-icon');
  const restaurantsLink = document.querySelector('.pha-restaurants');
  // De opmaak zelf (Lead-review ronde 2): waar staan de blokken ten opzichte
  // van elkaar. top is absoluut, met de scrollpositie erbij, zodat de meting
  // niet afhangt van waar de pagina op dat moment staat.
  const rect = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left: Math.round(r.left), right: Math.round(r.right),
      top: Math.round(r.top + window.scrollY), bottom: Math.round(r.bottom + window.scrollY),
    };
  };
  const layout = {
    heroText: rect('.vr-hero-text'),
    preview: rect('.vr-preview'),
    // offsetTop: de eerste drie kaarten in dezelfde rij hebben dezelfde waarde.
    featureTops: [...document.querySelectorAll('.vr-feature')].map((el) => el.offsetTop),
    allergensText: rect('.vr-allergens-text'),
    allergensAction: rect('.vr-allergens-action'),
  };
  return {
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    h1: tekst('.vr-title'),
    h1Size: document.querySelector('.vr-title') ? Math.round(parseFloat(getComputedStyle(document.querySelector('.vr-title')).fontSize)) : 0,
    intro: tekst('.vr-intro'),
    micro: tekst('.vr-micro'),
    primary: link('.vr-cta-primary'),
    secondary: link('[aria-label="Aan de slag"] .vr-cta-secondary'),
    heroActions: document.querySelectorAll('.vr-hero .vr-cta-primary, .vr-hero .vr-cta-secondary').length,
    bottomActions: document.querySelectorAll('.vr-bottom-actions .vr-cta-primary, .vr-bottom-actions .vr-cta-secondary').length,
    previewEyebrow: tekst('.vr-preview-eyebrow'),
    previewValues: [...document.querySelectorAll('.vr-preview-value')].map((el) => (el.innerText || '').trim()),
    previewLabels: [...document.querySelectorAll('.vr-preview-label')].map((el) => (el.innerText || '').trim()),
    previewCaption: tekst('.vr-preview-caption'),
    featuresTitle: tekst('.vr-features .vr-section-title'),
    features: [...document.querySelectorAll('.vr-feature')].map((el) => ({
      titel: (el.querySelector('.vr-feature-title') ? el.querySelector('.vr-feature-title').innerText : '').replace(/\\s+/g, ' ').trim(),
      body: (el.querySelector('.vr-feature-body') ? el.querySelector('.vr-feature-body').innerText : '').replace(/\\s+/g, ' ').trim(),
      soon: Boolean(el.querySelector('.vr-soon')),
    })),
    iconColor: icon ? getComputedStyle(icon).color : null,
    accent,
    allergensTitle: tekst('.vr-allergens .vr-section-title'),
    allergensBody: tekst('.vr-allergens-body'),
    allergensAction: link('.vr-allergens-action'),
    restaurantsHref: restaurantsLink ? restaurantsLink.getAttribute('href') : null,
    restaurantsText: restaurantsLink ? (restaurantsLink.innerText || '').trim() : '',
    footerLinks: [...document.querySelectorAll('.public-footer-link')].map((el) => ({
      tekst: (el.innerText || '').trim(), href: el.getAttribute('href'), height: Math.round(el.getBoundingClientRect().height),
    })),
    layout,
  };
})()`;

// Naar een onderdeel scrollen en pas daarna meten: de vaste tabbalk telt als
// onderkant van het zichtbare gebied.
async function scrollEnMeet(cdp, selector) {
  const gevonden = await evalJs(
    cdp,
    `(() => { const el = document.querySelector('${selector}'); if (!el) return false; el.scrollIntoView({ block: 'center', behavior: 'instant' }); return true; })()`,
  );
  if (!gevonden) return null;
  await sleep(350);
  return evalJs(
    cdp,
    `(() => {
      const el = document.querySelector('${selector}');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const tabbar = document.querySelector('.mobile-tabbar');
      const tr = tabbar ? tabbar.getBoundingClientRect() : null;
      const onderkant = tr && tr.height > 0 ? tr.top : window.innerHeight;
      return {
        inBeeld: r.top >= -1 && r.left >= -1 && r.bottom <= onderkant + 1 && r.right <= window.innerWidth + 1,
        top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height),
        viewportHeight: window.innerHeight, onderkant: Math.round(onderkant),
      };
    })()`,
  );
}


const verwacht = FOR_RESTAURANTS;
const FEATURE_TITLES = verwacht.features.map((feature) => feature.title);

async function paginaScenario(cdp) {
  for (const size of SIZES) {
    await setViewport(cdp, size.width, size.height);
    await navigate(cdp, `${APP}${PAGE}`, "Boolean(document.querySelector('.vr-title'))");
    const opener = size.width >= 900 ? SETTINGS_BUTTON : MENU_BUTTON;
    const prefix = `voor-restaurants ${size.name}`;

    const licht = await applyTheme(cdp, 'light', opener);
    await closePanel(cdp);
    const state = await evalJs(cdp, VR_STATE);
    await shot(cdp, `be64-voor-restaurants-${size.name}-licht`, { theme: 'light', themeProof: licht, state: 'pagina' });

    const donker = await applyTheme(cdp, 'dark', opener);
    await closePanel(cdp);
    await sleep(120);
    await shot(cdp, `be64-voor-restaurants-${size.name}-donker`, { theme: 'dark', themeProof: donker, state: 'pagina' });

    check(`${prefix}: de h1 uit het contract staat er`, state.h1 === verwacht.title, state.h1);
    check(`${prefix}: de intro uit het contract staat er`, state.intro === verwacht.intro, state.intro);
    check(`${prefix}: de regel over claimen en de e-mailcode staat er`, state.micro === verwacht.micro, state.micro);
    check(
      `${prefix}: "Claim je restaurant" is minstens 44 px hoog en gaat naar claimen`,
      Boolean(state.primary)
        && state.primary.tekst === verwacht.primary.label
        && state.primary.href === '/mijn-restaurant/claimen'
        && state.primary.box.height >= 44,
      JSON.stringify(state.primary),
    );
    check(
      `${prefix}: "Ik heb al een account" is minstens 44 px hoog en gaat naar /inloggen`,
      Boolean(state.secondary)
        && state.secondary.tekst === verwacht.secondary.label
        && state.secondary.href === '/inloggen'
        && state.secondary.box.height >= 44,
      JSON.stringify(state.secondary),
    );
    check(
      `${prefix}: de twee knoppen staan in de hero en nog eens onderaan`,
      state.heroActions === 2 && state.bottomActions === 2,
      `${state.heroActions}/${state.bottomActions}`,
    );
    check(
      `${prefix}: het weekoverzicht toont vier tegels met "—" en geen cijfers`,
      state.previewValues.length === 4
        && state.previewValues.every((value) => value === verwacht.preview.empty)
        && state.previewLabels.join('|') === verwacht.preview.stats.map((stat) => stat.label).join('|'),
      `${state.previewLabels.join(', ')} = ${state.previewValues.join(', ')}`,
    );
    check(
      `${prefix}: het weekoverzicht zegt dat het een voorbeeld is`,
      state.previewEyebrow === verwacht.preview.eyebrow && state.previewCaption === verwacht.preview.caption,
      `${state.previewEyebrow} / ${state.previewCaption}`,
    );

    check(
      `${prefix}: "Wat je krijgt" heeft de zes kaarten met de titels uit het contract`,
      state.featuresTitle === verwacht.featuresTitle
        && state.features.length === 6
        && state.features
          .map((feature) => feature.titel.replace(verwacht.soonLabel, '').trim())
          .join('|') === FEATURE_TITLES.join('|'),
      state.features.map((feature) => feature.titel).join(' / '),
    );
    check(
      `${prefix}: alleen het QR-kaartje draagt "Binnenkort"`,
      state.features.filter((feature) => feature.soon).length === 1
        && Boolean(state.features[5])
        && state.features[5].titel.includes('QR-kaartje op tafel')
        && state.features[5].titel.includes(verwacht.soonLabel),
      state.features[5] && state.features[5].titel,
    );
    check(
      `${prefix}: de iconen staan in --accent`,
      Boolean(state.iconColor) && state.iconColor === state.accent,
      `${state.iconColor} = ${state.accent}`,
    );
    check(
      `${prefix}: het allergenenblok heeft de titel en de momentopname-tekst`,
      state.allergensTitle === verwacht.allergens.title
        && state.allergensBody.includes('momentopname van wat je zelf hebt ingevuld')
        && state.allergensBody.includes('14 allergenen uit EU-verordening 1169/2011')
        && !/voldoet|compliant|gecertificeerd|gegarandeerd|keuring/i.test(state.allergensBody),
      state.allergensTitle,
    );
    check(
      `${prefix}: "Bekijk een voorbeeld" is minstens 44 px hoog en gaat naar het nvwa-voorbeeld`,
      Boolean(state.allergensAction)
        && state.allergensAction.tekst === verwacht.allergens.actionLabel
        && state.allergensAction.href === verwacht.allergens.previewHref
        && state.allergensAction.box.height >= 44,
      JSON.stringify(state.allergensAction),
    );
    check(
      `${prefix}: de link "Voor restaurants" in de kop leidt naar deze pagina`,
      state.restaurantsHref === PAGE && state.restaurantsText === 'Voor restaurants',
      `${state.restaurantsText} -> ${state.restaurantsHref}`,
    );
    check(
      `${prefix}: de footer linkt naar deze pagina en naar /inloggen`,
      state.footerLinks.length === 2
        && state.footerLinks[0].href === PAGE
        && state.footerLinks[1].href === '/inloggen'
        && state.footerLinks.every((linkItem) => linkItem.height >= 44),
      JSON.stringify(state.footerLinks),
    );
    check(`${prefix}: geen horizontale overloop`, state.overflow <= 0, state.overflow);
    check(
      `${prefix}: het thema is in licht en donker aangetoond`,
      themeOk(licht, 'light') && themeOk(donker, 'dark'),
      `${licht.attr}/${donker.attr}`,
    );
    check(`${prefix}: de h1 is minimaal 32 px`, state.h1Size >= 32, `${state.h1Size}px`);

    // De opmaak die de Lead in ronde 2 voorschreef. Vanaf 960 px het
    // desktopontwerp, daaronder alles onder elkaar.
    const { heroText, preview, featureTops, allergensText, allergensAction } = state.layout;
    if (size.width >= 960) {
      check(
        `${prefix}: het weekoverzicht staat rechts naast de h1-kolom, op dezelfde hoogte`,
        Boolean(heroText) && Boolean(preview)
          && preview.left > heroText.right
          && Math.abs(preview.top - heroText.top) <= 200,
        `weekoverzicht ${JSON.stringify(preview)} naast de h1-kolom ${JSON.stringify(heroText)}`,
      );
      check(
        `${prefix}: de eerste drie kaarten staan in één rij`,
        featureTops.length === 6 && featureTops[0] === featureTops[1] && featureTops[1] === featureTops[2],
        `offsetTop: ${featureTops.join(', ')}`,
      );
      check(
        `${prefix}: de allergenenknop staat rechts van de tekst`,
        Boolean(allergensText) && Boolean(allergensAction) && allergensAction.left > allergensText.right,
        `knop ${JSON.stringify(allergensAction)} naast de tekst ${JSON.stringify(allergensText)}`,
      );
    } else {
      check(
        `${prefix}: het weekoverzicht staat onder de h1 in plaats van ernaast`,
        Boolean(heroText) && Boolean(preview)
          && preview.top >= heroText.bottom - 1
          && Math.abs(preview.left - heroText.left) <= 1,
        `weekoverzicht ${JSON.stringify(preview)} onder de h1-kolom ${JSON.stringify(heroText)}`,
      );
      check(
        `${prefix}: de kaarten staan onder elkaar`,
        featureTops.length === 6 && featureTops[1] > featureTops[0],
        `offsetTop: ${featureTops.join(', ')}`,
      );
      check(
        `${prefix}: de allergenenknop staat onder de tekst`,
        Boolean(allergensText) && Boolean(allergensAction) && allergensAction.top >= allergensText.bottom - 1,
        `knop ${JSON.stringify(allergensAction)} onder de tekst ${JSON.stringify(allergensText)}`,
      );
    }

    // De blokken die in één keer in beeld passen, één voor één gemeten.
    for (const [selector, label] of [
      ['.vr-preview', 'het weekoverzicht'],
      ['.vr-allergens', 'het allergenenblok'],
      ['.vr-bottom-actions', 'de knoppen onderaan'],
    ]) {
      const meting = await scrollEnMeet(cdp, selector);
      check(
        `${prefix}: ${label} past volledig in beeld`,
        Boolean(meting) && meting.inBeeld === true,
        JSON.stringify(meting),
      );
      const naam = selector.replace(/^\./, '').replace(/[^a-z]/g, '');
      await shot(cdp, `be64-voor-restaurants-${size.name}-${naam}`, { theme: null, state: 'detail' });
    }
  }
}

function writeEvidence(extra = {}) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const failed = checks.filter((entry) => !entry.passed);
  const record = {
    script: SCRIPT_NAME,
    ticket: 'BE-64 (#156)',
    kind: 'fixture_browser_evidence',
    category: `lokale browsercheck op een verse productieopbouw (next build + next start op poort ${PORT}); geen productie en geen echte acceptatie`,
    startedAt: new Date().toISOString(),
    port: PORT,
    pages: [PAGE],
    network: networkEvidence,
    checks,
    shots,
    failed: failed.length,
    passed: failed.length === 0 && checks.length > 0,
    ...extra,
  };
  fs.writeFileSync(EVIDENCE_PATH, JSON.stringify(record, null, 2));
  return record;
}


async function main() {
  const watchdog = setTimeout(() => {
    writeEvidence({ error: 'timeout na 10 minuten' });
    process.exit(2);
  }, 10 * 60 * 1000);
  if (typeof watchdog.unref === 'function') watchdog.unref();

  const browserPath = findBrowser();
  if (!browserPath) {
    writeEvidence({ error: 'browser_unavailable' });
    throw new Error('browser_unavailable: set BROWSER_PATH to an installed Edge/Chrome');
  }

  let server = null;
  let browser = null;
  let cdp = null;
  try {
    // De BE-57-opzet: een verse productieopbouw in een eigen bouwmap en
    // `next start`, zodat er geen HMR-herlaadbeurt midden in een meting valt.
    // Deze check draait daarom alleen (geen tweede browsercheck tegelijk).
    server = await startServer({ port: PORT, appUrl: APP, outputDir: OUT_DIR, readyPath: PAGE, mode: 'start' });
    browser = await startBrowser(browserPath);
    cdp = new CdpClient(browser.target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    const guard = createNetworkGuard({
      appOrigins: APP_ORIGINS,
      baseUrl: `${APP}${PAGE}`,
      fixtureRoutes: [],
    });
    await enableFetchGuard(cdp, guard);

    await paginaScenario(cdp);

    const pageViolations = await evalJs(cdp, 'window.__FIXTURE_NETWORK_VIOLATIONS__ || []');
    const guardViolations = guard.appViolations();
    check('netwerk: geen geblokkeerde oproep in de pagina', pageViolations.length === 0, JSON.stringify(pageViolations.slice(0, 3)));
    check('netwerk: geen geblokkeerde oproep op CDP-niveau', guardViolations.length === 0, JSON.stringify(guardViolations.slice(0, 3)));
    networkEvidence = { appViolations: guardViolations, pageViolations };

    const exceptions = cdp.takeEvents('Runtime.exceptionThrown');
    check('geen onafgevangen browserfout', exceptions.length === 0, JSON.stringify(exceptions.slice(0, 2)));

    const record = writeEvidence({});
    console.log(JSON.stringify({
      passed: record.passed,
      checks: checks.length,
      failed: record.failed,
      screenshots: shots.length,
      evidence: EVIDENCE_PATH,
    }, null, 2));
    if (!record.passed) process.exitCode = 1;
  } catch (error) {
    writeEvidence({ error: String((error && error.stack) || error) });
    console.error(error);
    process.exitCode = 1;
  } finally {
    clearTimeout(watchdog);
    if (cdp) cdp.close();
    if (browser) killTree(browser.child);
    if (server) killTree(server);
    if (browser && browser.userDataDir) {
      try {
        fs.rmSync(browser.userDataDir, { recursive: true, force: true });
      } catch {
        // Een vergrendeld tijdelijk profiel staat buiten de repo en is onschadelijk.
      }
    }
  }
}

main();
