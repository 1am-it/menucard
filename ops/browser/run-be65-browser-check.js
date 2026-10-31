'use strict';

// BE-65 (#157) — browsercheck voor de deelkaart, de bewaar- en deelknoppen en
// de balk na het bewaren.
//
// Fixture-bewijs: een echte browser via CDP, de echte pagina's uit een
// productieopbouw (`mode: 'start'`, eigen NEXT_DIST_DIR), in licht en donker op
// 1280, 390 en 320 px. Het thema gaat via een klik op de themaknop van de app
// zelf en elke opname draagt zijn eigen themeProof (lib/theme-proof.js).
// /search krijgt zijn resultaten uit de bestaande gestubde zoek-API
// (lib/be60-zoek-stub.js): fictieve gerechten, geen database, geen internet.
//
// Wat bewezen wordt:
//  - de kaart in de hero: drie tabjes, aria-pressed wisselt en de tekst van het
//    voorbeeld verandert;
//  - kaart, knoppen en balk staan in beeld en er is geen horizontale overloop;
//  - de knoppen bij de gerechten op de home en in /search zijn minstens 44 × 44
//    px, staan niet in een <a> en bewaren werkt;
//  - de balk na het bewaren staat in beeld, boven de tabbalk (elementFromPoint
//    op de tabbalk komt bij de tabbalk uit) en is weg na sluiten;
//  - daarna de bestaande a11y-audit op / en /search, met 0 fouten.
//
// Dit is ontwikkelaarsbewijs, geen onafhankelijke review en geen echte
// acceptatie. Gebruik: node ops/browser/run-be65-browser-check.js
// [--alleen=<scenario>] [--lijst]. Poort: BE65_PORT of 3194.

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
  parseScenarioArgs,
  scenarioSelectionOutcome,
  runScenarioSelection,
} = require('./lib/scenario-filter');
const { be60StubScript } = require('./lib/be60-zoek-stub');
const {
  THEME_LABELS,
  themeProofScript,
  clickThemeScript,
  themeProofValue,
  themeOk,
} = require('./lib/theme-proof');
const audit = require('./lib/a11y-audit');

const SCRIPT_NAME = 'run-be65-browser-check.js';
const PORT = Number(process.env.BE65_PORT || 3194);
const APP = `http://localhost:${PORT}`;
const APP_ORIGINS = defaultAppOrigins(PORT);
const OUT_DIR = path.join(__dirname, 'output', 'be-65');
const EVIDENCE_DIR = path.join(__dirname, 'evidence');
const BASE_EVIDENCE_PATH = path.join(EVIDENCE_DIR, 'be65-browser-evidence.json');
const SHOT_DIR = path.join(EVIDENCE_DIR, 'be-65');

const checks = [];
const shots = [];
let scenarioRuns = null;
let networkEvidence = null;
let viewport = { width: 1280, height: 900 };

function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail: detail === undefined ? null : String(detail) });
}

async function setViewport(cdp, width, height) {
  viewport = { width, height };
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function shot(cdp, name, meta = {}) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const file = await screenshot(cdp, SHOT_DIR, name);
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

/** Het thema via de themaknop van de app zelf, met bewijs. */
async function applyTheme(cdp, theme) {
  const label = THEME_LABELS[theme];
  const klaar = await waitFor(cdp, `document.querySelectorAll('.theme-btn').length === 2`, 15000);
  if (!klaar) throw new Error(`theme_button_missing: ${label}`);
  const clicked = await evalJs(cdp, clickThemeScript(label));
  if (clicked !== 'clicked') throw new Error(`theme_button_missing: ${label}`);
  await sleep(260);
  return themeProof(cdp);
}


/** De kaart: de radiogroep, de zichtbare labels, het getoonde voorbeeld en de overloop. */
const KAART_STAAT = `(() => {
  const card = document.querySelector('.share-hero');
  const radios = Array.from(document.querySelectorAll('.share-hero-radio'));
  const tabs = Array.from(document.querySelectorAll('.share-hero-tab'));
  const panels = Array.from(document.querySelectorAll('.share-hero-example'));
  const zichtbaar = panels.filter((p) => getComputedStyle(p).display !== 'none');
  const inBeeld = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= window.innerWidth + 0.5;
  };
  // Het label zoals een gebruiker het ziet: alleen de zichtbare span telt.
  const zichtbaarLabel = (el) => Array.from(el.children)
    .filter((kind) => getComputedStyle(kind).display !== 'none')
    .map((kind) => kind.textContent.trim())
    .join('');
  const toppen = tabs.map((t) => Math.round(t.getBoundingClientRect().top));
  const paneel = zichtbaar[0] || null;
  const bubble = paneel ? paneel.querySelector('.share-hero-bubble') : null;
  const note = paneel ? paneel.querySelector('.share-hero-note') : null;
  return {
    thema: document.documentElement.getAttribute('data-theme'),
    kaart: Boolean(card),
    tabjes: tabs.length,
    radios: radios.length,
    labels: tabs.map(zichtbaarLabel),
    aangevinkt: radios.map((r) => r.checked),
    toppen,
    eenRegel: toppen.length === 3 && new Set(toppen).size === 1,
    breedtes: tabs.map((t) => Math.round(t.getBoundingClientRect().width)),
    panelen: panels.length,
    zichtbarePanelen: zichtbaar.length,
    zichtbaar: paneel ? paneel.className : '',
    bubble: bubble ? bubble.textContent.trim() : '',
    note: note ? note.textContent.trim() : '',
    figuurLabel: paneel ? paneel.getAttribute('aria-label') : '',
    stemregels: paneel ? Array.from(paneel.querySelectorAll('.share-hero-vote-row')).map((row) => {
      const naam = row.querySelector('.share-hero-vote-name');
      const telling = row.querySelector('.share-hero-vote-count');
      const track = row.querySelector('.share-hero-vote-track');
      const fill = row.querySelector('.share-hero-vote-fill');
      const tr = track ? track.getBoundingClientRect() : null;
      const fr = fill ? fill.getBoundingClientRect() : null;
      return {
        naam: naam ? naam.textContent.trim() : '',
        vet: naam ? Number(window.getComputedStyle(naam).fontWeight) >= 700 : null,
        telling: telling ? telling.textContent.trim() : '',
        aandeel: tr && fr && tr.width > 0 ? Math.round((fr.width / tr.width) * 100) : null,
        balkKleur: track ? window.getComputedStyle(track).backgroundColor : '',
        vulKleur: fill ? window.getComputedStyle(fill).backgroundColor : '',
      };
    }) : [],
    kaartInBeeld: inBeeld(card),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  };
})()`;

const KLIK_TAB = (index) => `document.querySelectorAll('.share-hero-tab')[${index}].click()`;

/** De knoppen bij de gerechten: maat, plaats en stand. */
const knoppenStaat = (scope) => `(() => {
  const buttons = Array.from(document.querySelectorAll(${JSON.stringify(scope)}));
  return buttons.map((b) => {
    const r = b.getBoundingClientRect();
    return {
      label: b.getAttribute('aria-label') || '',
      pressed: b.getAttribute('aria-pressed'),
      breed: Math.round(r.width),
      hoog: Math.round(r.height),
      inLink: Boolean(b.closest('a')),
      zichtbaar: r.width > 0 && r.height > 0,
    };
  });
})()`;

/** De balk: in beeld, boven de tabbalk, en wat er op de tabbalk ligt. */
const BALK_STAAT = `(() => {
  const bar = document.querySelector('.saved-bar');
  const tabbar = document.querySelector('.mobile-tabbar');
  const lezen = (key) => { try { return window.sessionStorage.getItem(key); } catch (error) { return 'fout'; } };
  if (!bar) return { balk: false, vlag: lezen('bredaeats_balk_gesloten') };
  const r = bar.getBoundingClientRect();
  const zichtbaar = tabbar ? getComputedStyle(tabbar).display !== 'none' : false;
  const t = tabbar ? tabbar.getBoundingClientRect() : null;
  const middenTabbalk = t && zichtbaar ? document.elementFromPoint((t.left + t.right) / 2, (t.top + t.bottom) / 2) : null;
  const middenBalk = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
  const sluit = bar.querySelector('.saved-bar-close');
  const send = bar.querySelector('.saved-bar-send');
  return {
    balk: true,
    tekst: (bar.querySelector('.saved-bar-text') || {}).textContent,
    breedte: Math.round(r.width),
    rechtsRuimte: Math.round(window.innerWidth - r.right),
    onderRuimte: Math.round(window.innerHeight - r.bottom),
    inBeeld: r.left >= 0 && r.right <= window.innerWidth + 0.5 && r.top >= 0 && r.bottom <= window.innerHeight + 0.5,
    tabbarZichtbaar: zichtbaar,
    bovenTabbalk: t && zichtbaar ? r.bottom <= t.top + 0.5 : null,
    opTabbalk: middenTabbalk ? Boolean(middenTabbalk.closest('.mobile-tabbar')) : null,
    opBalk: middenBalk ? Boolean(middenBalk.closest('.saved-bar')) : false,
    sluitLabel: sluit ? sluit.getAttribute('aria-label') : '',
    verstuurHref: send ? send.getAttribute('href') : '',
    vlag: lezen('bredaeats_balk_gesloten'),
  };
})()`;

async function homeScenario(cdp) {
  for (const theme of ['light', 'dark']) {
    for (const width of [1280, 390, 320]) {
      const waar = `home ${theme}/${width}`;
      await setViewport(cdp, width, 900);
      await leegOpslag(cdp);
      await navigate(cdp, `${APP}/`, `Boolean(document.querySelector('.share-hero-tab'))`);
      await waitFor(cdp, `document.querySelectorAll('.tonight-actions button').length > 0`, 15000);
      const proof = await applyTheme(cdp, theme);
      check(`${waar}: het thema is aangetoond`, themeOk(proof, theme), JSON.stringify(proof));

      const kaart = await evalJs(cdp, KAART_STAAT);
      check(`${waar}: de deelkaart staat er met drie radio's en drie tabjes`,
        kaart.kaart && kaart.radios === 3 && kaart.tabjes === 3,
        JSON.stringify({ kaart: kaart.kaart, radios: kaart.radios, tabjes: kaart.tabjes }));
      check(`${waar}: precies één radio staat aan`, kaart.aangevinkt.filter(Boolean).length === 1, kaart.aangevinkt.join(','));
      check(`${waar}: alle drie de tabjes staan op één regel (gelijke offsetTop)`, kaart.eenRegel === true,
        `offsetTop ${kaart.toppen.join(',')}`);
      const verwacht = width <= 640
        ? ['Eén gerecht', 'Lijstje', 'Stemmen']
        : ['Eén gerecht', 'Een lijstje', 'Laat stemmen'];
      check(`${waar}: de labels zijn ${verwacht.join(' / ')}`,
        kaart.labels.join('|') === verwacht.join('|'), kaart.labels.join('|'));
      check(`${waar}: de drie voorbeelden staan in de HTML, één is zichtbaar`,
        kaart.panelen === 3 && kaart.zichtbarePanelen === 1,
        JSON.stringify({ panelen: kaart.panelen, zichtbaar: kaart.zichtbarePanelen }));
      check(`${waar}: de kaart staat in beeld`, kaart.kaartInBeeld, JSON.stringify({ inBeeld: kaart.kaartInBeeld, overflow: kaart.overflow }));
      check(`${waar}: geen horizontale overloop`, kaart.overflow <= 0, kaart.overflow);
      await shot(cdp, `be65-home-${width}-${theme}-tabjes.png`, { theme, state: 'tabjes', themeProof: proof });

      const teksten = [];
      for (let index = 0; index < kaart.tabjes; index += 1) {
        await evalJs(cdp, KLIK_TAB(index));
        await sleep(120);
        const nu = await evalJs(cdp, KAART_STAAT);
        teksten.push(`${nu.bubble}|${nu.note}`);
        check(`${waar}: tabje ${index + 1} is na de klik het enige aangevinkte tabje`,
          nu.aangevinkt[index] === true && nu.aangevinkt.filter(Boolean).length === 1, nu.aangevinkt.join(','));
        check(`${waar}: tabje ${index + 1} toont alleen zijn eigen voorbeeld`,
          nu.zichtbarePanelen === 1 && nu.zichtbaar.includes(['een', 'lijstje', 'stemmen'][index]),
          JSON.stringify({ zichtbaar: nu.zichtbaar, aantal: nu.zichtbarePanelen }));
      }
      check(`${waar}: de drie tabjes geven elk een eigen voorbeeld`, new Set(teksten).size === kaart.tabjes, teksten.join(' / '));

      // Het voorbeeld "Laat stemmen" (Lead-review ronde 3, punt 1) staat nu open.
      const stemmen = await evalJs(cdp, KAART_STAAT);
      const regels = stemmen.stemregels;
      check(`${waar}: het stemvoorbeeld noemt de gerechten met hun telling`,
        regels.length === 2 &&
          regels[0].naam === 'Pasta pesto' && regels[0].telling === '3× lekker' &&
          regels[1].naam === 'Huisgemaakte burger' && regels[1].telling === '1× lekker',
        JSON.stringify(regels.map((r) => `${r.naam} ${r.telling}`)));
      check(`${waar}: de koploper is vet, de tweede regel niet`,
        regels.length === 2 && regels[0].vet === true && regels[1].vet === false,
        JSON.stringify(regels.map((r) => r.vet)));
      check(`${waar}: de balkjes zijn 75% en 25%`,
        regels.length === 2 && Math.abs(regels[0].aandeel - 75) <= 2 && Math.abs(regels[1].aandeel - 25) <= 2,
        JSON.stringify(regels.map((r) => r.aandeel)));
      check(`${waar}: het gevulde deel en de rest hebben een eigen kleur`,
        regels.length === 2 && regels.every((r) => r.vulKleur && r.balkKleur && r.vulKleur !== r.balkKleur),
        JSON.stringify(regels.map((r) => `${r.balkKleur}/${r.vulKleur}`)));
      await shot(cdp, `be65-home-${width}-${theme}-kaart.png`, { theme, state: 'stemmen', themeProof: proof });

      const knoppen = await evalJs(cdp, knoppenStaat('.tonight-actions button'));
      check(`${waar}: elk gerecht heeft Bewaren en Delen`, knoppen.length >= 2, knoppen.length);
      check(`${waar}: de knoppen zijn minstens 44 bij 44 px`, knoppen.length > 0 && knoppen.every((k) => k.breed >= 44 && k.hoog >= 44),
        JSON.stringify(knoppen.map((k) => `${k.breed}x${k.hoog}`)));
      check(`${waar}: geen knop staat in een link`, knoppen.every((k) => !k.inLink), JSON.stringify(knoppen.filter((k) => k.inLink).map((k) => k.label)));

      await evalJs(cdp, `document.querySelector('.tonight-actions .dish-save-btn').click()`);
      await sleep(240);
      const na = await evalJs(cdp, knoppenStaat('.tonight-actions .dish-save-btn'));
      check(`${waar}: Bewaren zet de knop aan`, na[0] ? na[0].pressed === 'true' : false, na[0] ? na[0].pressed : 'geen knop');
      const balk = await evalJs(cdp, BALK_STAAT);
      check(`${waar}: de balk verschijnt met het aantal en de tekst`,
        balk.balk === true && String(balk.tekst || '').trim() === '1 gerecht bewaard · Stuur je lijstje, met of zonder stemmen', balk.tekst);
      check(`${waar}: de balk staat helemaal in beeld`, balk.inBeeld === true,
        JSON.stringify({ breedte: balk.breedte, rechts: balk.rechtsRuimte, onder: balk.onderRuimte }));
      check(`${waar}: Versturen wijst naar /mijn-lijstje`, balk.verstuurHref === '/mijn-lijstje', balk.verstuurHref);
      check(`${waar}: de sluitknop heeft een aria-label`, Boolean(balk.sluitLabel), balk.sluitLabel);
      check(`${waar}: de balk ligt boven de tabbalk en de tabbalk blijft aanklikbaar`,
        balk.tabbarZichtbaar ? balk.bovenTabbalk === true && balk.opTabbalk === true : balk.opTabbalk === null,
        JSON.stringify({ zichtbaar: balk.tabbarZichtbaar, boven: balk.bovenTabbalk, opTabbalk: balk.opTabbalk, opBalk: balk.opBalk }));
      if (width === 1280) {
        check(`${waar}: rechtsonder en hooguit 420 px breed`, balk.breedte <= 420 && balk.rechtsRuimte <= 40,
          `${balk.breedte}px breed, ${balk.rechtsRuimte}px van rechts, ${balk.onderRuimte}px van onderen`);
      }
      await shot(cdp, `be65-home-${width}-${theme}-balk.png`, { theme, state: 'balk', themeProof: proof });

      await evalJs(cdp, `document.querySelector('.saved-bar-close').click()`);
      await sleep(180);
      const dicht = await evalJs(cdp, BALK_STAAT);
      check(`${waar}: de balk is weg na sluiten`, dicht.balk === false, JSON.stringify(dicht));
      check(`${waar}: de balk blijft dicht in deze sessie`, dicht.vlag === '1', dicht.vlag);
    }

    // De a11y-audit van de bestaande lib op de home, in dit thema.
    await setViewport(cdp, 1280, 900);
    await navigate(cdp, `${APP}/`, `Boolean(document.querySelector('.share-hero-tab'))`);
    await applyTheme(cdp, theme);
    await a11y(cdp, 'gast home', theme);
  }

  const zonderBewijs = shots.filter((opname) => !themeOk(opname.themeProof, opname.theme));
  check('thema: elke opname heeft een kloppend themabewijs', zonderBewijs.length === 0 && shots.length >= 12,
    `${shots.length - zonderBewijs.length}/${shots.length} opnamen: ${zonderBewijs.map((opname) => opname.file).join(',')}`);
}

async function zoekScenario(cdp) {
  for (const theme of ['light', 'dark']) {
    for (const width of [1280, 390, 320]) {
      const waar = `zoeken ${theme}/${width}`;
      await setViewport(cdp, width, 900);
      await leegOpslag(cdp);
      await navigate(cdp, `${APP}/search?q=steak`, `Boolean(document.querySelector('.dish-result-actions .dish-share-buttons'))`);
      const proof = await applyTheme(cdp, theme);
      check(`${waar}: het thema is aangetoond`, themeOk(proof, theme), JSON.stringify(proof));

      const knoppen = await evalJs(cdp, knoppenStaat('.dish-result-actions button'));
      check(`${waar}: elk resultaat heeft de bewaar- en deelknoppen`, knoppen.length >= 4, knoppen.length);
      check(`${waar}: de knoppen zijn minstens 44 bij 44 px`, knoppen.length > 0 && knoppen.every((k) => k.breed >= 44 && k.hoog >= 44),
        JSON.stringify(knoppen.map((k) => `${k.breed}x${k.hoog}`)));
      check(`${waar}: geen knop staat in een link`, knoppen.every((k) => !k.inLink), JSON.stringify(knoppen.filter((k) => k.inLink).map((k) => k.label)));
      const overflow = await evalJs(cdp, 'document.documentElement.scrollWidth - window.innerWidth');
      check(`${waar}: geen horizontale overloop`, Number(overflow) <= 0, overflow);

      await evalJs(cdp, `document.querySelector('.dish-result-actions .dish-save-btn').click()`);
      await sleep(240);
      const na = await evalJs(cdp, knoppenStaat('.dish-result-actions .dish-save-btn'));
      check(`${waar}: Bewaren zet de knop aan`, na[0] ? na[0].pressed === 'true' : false, na[0] ? na[0].pressed : 'geen knop');
      const balk = await evalJs(cdp, BALK_STAAT);
      check(`${waar}: de balk verschijnt met het aantal en de tekst`,
        balk.balk === true && String(balk.tekst || '').trim() === '1 gerecht bewaard · Stuur je lijstje, met of zonder stemmen', balk.tekst);
      check(`${waar}: de balk staat helemaal in beeld`, balk.inBeeld === true,
        JSON.stringify({ breedte: balk.breedte, rechts: balk.rechtsRuimte, onder: balk.onderRuimte }));
      check(`${waar}: de balk ligt boven de tabbalk en de tabbalk blijft aanklikbaar`,
        balk.tabbarZichtbaar ? balk.bovenTabbalk === true && balk.opTabbalk === true : balk.opTabbalk === null,
        JSON.stringify({ zichtbaar: balk.tabbarZichtbaar, boven: balk.bovenTabbalk, opTabbalk: balk.opTabbalk }));
      await shot(cdp, `be65-zoeken-${width}-${theme}-balk.png`, { theme, state: 'balk', themeProof: proof });

      await evalJs(cdp, `document.querySelector('.saved-bar-close').click()`);
      await sleep(180);
      const dicht = await evalJs(cdp, BALK_STAAT);
      check(`${waar}: de balk is weg na sluiten`, dicht.balk === false, JSON.stringify(dicht));
    }

    await setViewport(cdp, 1280, 900);
    await navigate(cdp, `${APP}/search?q=steak`, `Boolean(document.querySelector('.dish-result-actions .dish-share-buttons'))`);
    await applyTheme(cdp, theme);
    await a11y(cdp, 'gast zoeken', theme);
  }
}

const SCENARIOS = [
  { name: 'home', run: (cdp) => homeScenario(cdp) },
  { name: 'zoeken', run: (cdp) => zoekScenario(cdp) },
];

const SELECTION = parseScenarioArgs(process.argv.slice(2), SCENARIOS);

function evidencePath() {
  return SELECTION.filter
    ? path.join(EVIDENCE_DIR, 'be65-browser-evidence.filtered.json')
    : BASE_EVIDENCE_PATH;
}


async function main() {
  const outcome = scenarioSelectionOutcome({ selection: SELECTION, entries: SCENARIOS, scriptName: SCRIPT_NAME });
  if (outcome.stop) {
    process.exitCode = outcome.exitCode;
    return;
  }

  const watchdog = setTimeout(() => {
    writeEvidence({ error: 'timeout na 12 minuten' });
    process.exit(2);
  }, 12 * 60 * 1000);
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
    // Eigen bouwmap, zodat deze check nooit de `.next` van een andere meting
    // hergebruikt of overschrijft.
    process.env.NEXT_DIST_DIR = process.env.NEXT_DIST_DIR || '.next-be65';
    server = await startServer({ port: PORT, appUrl: APP, outputDir: OUT_DIR, mode: 'start' });
    browser = await startBrowser(browserPath);
    cdp = new CdpClient(browser.target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    const guard = createNetworkGuard({
      appOrigins: APP_ORIGINS,
      baseUrl: `${APP}/search?q=steak`,
      fixtureRoutes: [
        { id: 'zoeken', match: 'prefix', path: '/api/search', methods: ['GET'] },
        { id: 'restaurants', match: 'prefix', path: '/api/restaurants', methods: ['GET'] },
        { id: 'daghap', match: 'prefix', path: '/api/v1/daghap', methods: ['GET'] },
        { id: 'tellers', match: 'exact', path: '/api/v1/tellers', methods: ['POST'] },
        { id: 'bekeken', match: 'exact', path: '/api/v1/bekeken', methods: ['POST'] },
      ],
    });
    await enableFetchGuard(cdp, guard);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: be60StubScript() });

    scenarioRuns = await runScenarioSelection({ entries: SCENARIOS, checks, cdp, filter: SELECTION.filter });

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
      evidence: evidencePath(),
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

function writeEvidence(extra = {}) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const failed = checks.filter((entry) => !entry.passed);
  const record = {
    script: SCRIPT_NAME,
    kind: 'fixture_browser_evidence',
    category: `lokale browsercheck van de productieopbouw (next start op poort ${PORT}) met een gestubde zoek-API; geen productie en geen echte acceptatie`,
    startedAt: new Date().toISOString(),
    port: PORT,
    filter: SELECTION.filter,
    scenarioRuns,
    network: networkEvidence,
    checks,
    shots,
    failed: failed.length,
    passed: failed.length === 0 && checks.length > 0,
    ...extra,
  };
  fs.writeFileSync(evidencePath(), JSON.stringify(record, null, 2));
  return record;
}

async function leegOpslag(cdp) {
  await evalJs(cdp, `(() => { try { window.localStorage.clear(); window.sessionStorage.clear(); } catch (error) {} return true; })()`);
}

/** De a11y-audit van de bestaande lib, met 0 fouten als eis. */
async function a11y(cdp, label, theme) {
  const measured = await evalJs(cdp, audit.inPageSource('auditPage', [{ minTarget: 44 }]));
  const review = audit.checksFromAudit(label, theme === 'light' ? 'licht' : 'donker', measured, { minTarget: 44 });
  for (const failure of review.errors) {
    check(`${label} (${theme}) · a11y-fout · ${failure.criterion}`, false, `${failure.reason} · ${failure.name}`);
  }
  check(`${label} (${theme}) · a11y-audit zonder fouten`, review.errors.length === 0, `${review.errors.length} fouten`);
}
