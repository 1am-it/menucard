'use strict';

// BE-42 (#98) — browsercheck voor deel 1: 1A (kaartnamen als knoppen) en
// 3B (rustigere prijzen).
//
// Start de echte productiebuild (`next start`) op een lokale poort, bestuurt
// een lokaal geïnstalleerde Edge/Chrome via CDP (dezelfde runtime als de
// andere ops/browser-checks) en legt vast:
//
//   - /alle-restaurants: geen grote kaartlink en geen CTA meer, de
//     restaurantnaam is de link, elke menukaart is een eigen knop naar
//     /menu/<id>, de tabvolgorde is naam → knoppen, de focus is zichtbaar en
//     elk aanraakvlak is ≥ 44 px; een restaurant zonder menukaart blijft
//     ongewijzigd ("Nog geen menukaart" en "Bekijk restaurant →");
//   - /restaurant/6, /menu/6-diner, /search?q=steak en de home (met vaste
//     klok): het prijsvlak is var(--surface-soft) met var(--text-primary),
//     vet, rechts en ≥ 4,5:1 contrast in licht en donker;
//   - de koude eerste overdracht van /alle-restaurants (na 1A) en van
//     /restaurant/6 (de "voor"-meting voor 2A);
//   - screenshots van /alle-restaurants, /restaurant/6 en /restaurant/1 op
//     1280, 390 en 320 px, in licht en donker.
//
// Bewijs (screenshots + JSON) gaat standaard buiten de repository:
//   node ops/browser/run-be42-browser-check.js --out ../be42-evidence
//
// Dit is developer-evidence in een lokale, geïsoleerde omgeving: geen
// productie, geen echte Supabase-credentials en geen merge/publicatie.

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const { findBrowser, killTree, startBrowser, evalJs, navigate } = require('./lib/runtime');
const { CdpClient, waitForHttp } = require('./lib/cdp');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.BE42_PORT || 3152);
const APP = `http://localhost:${PORT}`;

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index > -1 && args[index + 1] ? args[index + 1] : fallback;
};
// Buiten git: de opdracht vraagt screenshots buiten de repository.
const OUT_DIR = path.resolve(option('out', path.join(REPO_ROOT, '..', 'be42-evidence')));
const OUT_PATH = path.join(OUT_DIR, 'be42-browser-evidence.json');

const checks = [];
const shots = [];
const transfer = [];
let viewport = { width: 1280, height: 900 };

function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail });
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${name}`);
}


// ── gedeelde meethelpers in de pagina ───────────────────────────────────────
const HELPERS = `
  const parse = (value) => {
    const m = String(value).match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const parts = m[1].split(',').map((n) => parseFloat(n));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const lum = (c) => {
    const v = [c.r, c.g, c.b].map((x) => {
      const s = x / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const ratio = (a, b) => {
    const l1 = lum(a); const l2 = lum(b);
    return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
  };
  const tokens = () => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;left:-9999px;background:var(--surface-soft);color:var(--text-primary)';
    document.body.appendChild(probe);
    const soft = getComputedStyle(probe).backgroundColor;
    const primary = getComputedStyle(probe).color;
    probe.remove();
    return { soft, primary };
  };
`;

// ── 1A: /alle-restaurants ───────────────────────────────────────────────────
const ALLE_JS = `(() => {
  ${HELPERS}
  const card = document.querySelector('article.ar-card');
  if (!card) return { missing: true, cards: document.querySelectorAll('.ar-card').length };
  const nameLink = card.querySelector('a.ar-name-link');
  const buttons = [...card.querySelectorAll('a.ar-menu-button')];
  const focusables = [...card.querySelectorAll('a, button')];
  const t = tokens();
  const buttonStyle = buttons[0] ? getComputedStyle(buttons[0]) : null;
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    cards: document.querySelectorAll('.ar-card').length,
    menuCards: document.querySelectorAll('article.ar-card').length,
    noMenuCards: document.querySelectorAll('a.ar-card--nomenu').length,
    bigCtas: document.querySelectorAll('.ar-cta').length,
    cardIsLink: card.tagName === 'A',
    nameIsLink: Boolean(nameLink),
    nameText: card.querySelector('.ar-name') ? card.querySelector('.ar-name').innerText.trim() : null,
    nameHref: nameLink ? nameLink.getAttribute('href') : null,
    ariaLabel: card.querySelector('.ar-menu-buttons') ? card.querySelector('.ar-menu-buttons').getAttribute('aria-label') : null,
    buttons: buttons.map((el) => ({
      label: el.innerText.trim(),
      href: el.getAttribute('href'),
      height: Math.round(el.getBoundingClientRect().height),
    })),
    focusOrder: focusables.map((el) => el.getAttribute('href')),
    noMenu: (() => {
      const el = document.querySelector('.ar-card--nomenu');
      if (!el) return { missing: true };
      return {
        isWholeLink: el.tagName === 'A',
        href: el.getAttribute('href'),
        label: el.querySelector('.ar-nomenu-label') ? el.querySelector('.ar-nomenu-label').innerText.trim() : null,
        restaurantLink: el.querySelector('.ar-restaurant-link') ? el.querySelector('.ar-restaurant-link').innerText.trim() : null,
        extraActions: el.querySelectorAll('.ar-cta, a.ar-menu-button').length,
      };
    })(),
    buttonColors: buttons[0] ? {
      fg: buttonStyle.color,
      bg: buttonStyle.backgroundColor,
      soft: t.soft,
      primary: t.primary,
      ratio: ratio(parse(buttonStyle.color), parse(buttonStyle.backgroundColor)),
      fontWeight: buttonStyle.fontWeight,
    } : null,
    text: card.innerText.replace(/\\s+/g, ' ').trim(),
    overflow: Math.round(document.documentElement.scrollWidth) - Math.round(window.innerWidth),
  };
})()`;

// ── 3B: het prijsvlak op vier pagina's ──────────────────────────────────────
const priceJs = (selector) => `(() => {
  ${HELPERS}
  const el = document.querySelector('${selector}');
  const t = tokens();
  if (!el) return { missing: true, selector: '${selector}', theme: document.documentElement.getAttribute('data-theme') };
  const style = getComputedStyle(el);
  return {
    selector: '${selector}',
    theme: document.documentElement.getAttribute('data-theme'),
    text: el.innerText.trim(),
    fg: style.color,
    bg: style.backgroundColor,
    soft: t.soft,
    primary: t.primary,
    usesSoft: style.backgroundColor === t.soft,
    usesPrimary: style.color === t.primary,
    ratio: ratio(parse(style.color), parse(style.backgroundColor)),
    fontWeight: style.fontWeight,
    rightEdge: Math.round(el.getBoundingClientRect().right),
    containerRight: Math.round((() => {
      const parent = el.parentElement;
      const ps = getComputedStyle(parent);
      return parent.getBoundingClientRect().right
        - parseFloat(ps.paddingRight || '0')
        - parseFloat(ps.borderRightWidth || '0');
    })()),
  };
})()`;

// ── server, viewport, thema, screenshots ────────────────────────────────────
async function startProductionServer() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const log = fs.createWriteStream(path.join(OUT_DIR, 'next-start.log'));
  const env = {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-check-placeholder',
  };
  // Deze geïsoleerde checkout heeft geen globale npm; start dezelfde
  // productiebuild dan rechtstreeks met node (zelfde commando, zelfde env).
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const npmAvailable = spawnSync(npm, ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' }).status === 0;
  const nextBin = path.join(REPO_ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
  const child = npmAvailable
    ? spawn(npm, ['run', 'start', '--', '-p', String(PORT)], {
        cwd: REPO_ROOT,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
        detached: process.platform !== 'win32',
      })
    : spawn(process.execPath, [nextBin, 'start', '-p', String(PORT)], {
        cwd: REPO_ROOT,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        detached: process.platform !== 'win32',
      });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  await waitForHttp(`${APP}/`, 120000);
  return child;
}

async function setViewport(cdp, width, height) {
  viewport = { width, height };
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
}

async function shot(cdp, name) {
  const metrics = await cdp.send('Page.getLayoutMetrics');
  const content = metrics.cssContentSize || metrics.contentSize;
  const width = Math.min(viewport.width, Math.ceil(content.width));
  const wholePage = viewport.width >= 720;
  const height = wholePage ? Math.min(5000, Math.ceil(content.height)) : viewport.height;
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: wholePage,
    clip: { x: 0, y: 0, width, height, scale: 1 },
  });
  const buffer = Buffer.from(result.data, 'base64');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, buffer);
  shots.push({ file, bytes: buffer.length, viewport: `${viewport.width}x${viewport.height}` });
}

async function applyTheme(cdp, theme) {
  await navigate(cdp, `${APP}/`, 'document.readyState === "complete"');
  await evalJs(cdp, `localStorage.setItem('bredaeats_theme', '${theme}')`);
}

// ── netwerkmeting: de eerste overdracht met een koude cache ─────────────────
function attachNetworkMeter(cdp) {
  const requests = new Map();
  const finished = [];
  cdp.on('Network.requestWillBeSent', (event) => {
    requests.set(event.requestId, { url: event.request.url, type: event.type });
  });
  cdp.on('Network.loadingFinished', (event) => {
    const meta = requests.get(event.requestId) || { url: 'unknown', type: 'Other' };
    finished.push({ url: meta.url, type: meta.type, bytes: event.encodedDataLength || 0 });
  });
  return {
    reset() {
      requests.clear();
      finished.length = 0;
    },
    summary() {
      const totalBytes = finished.reduce((sum, entry) => sum + entry.bytes, 0);
      const document = finished.find((entry) => entry.type === 'Document');
      return {
        totalBytes,
        totalKb: Math.round((totalBytes / 1024) * 10) / 10,
        documentKb: document ? Math.round((document.bytes / 1024) * 10) / 10 : null,
        resourceCount: finished.length,
      };
    },
  };
}

// BE-42: de koude eerste overdracht van de twee pagina's die 1A en 3B raken.
// /restaurant/6 (Bardot, vier kaarten) is tegelijk de "voor"-meting voor deel 2
// (de hele kaart in tabbladen, eis < 250 KB). Zonder koude cache meet de
// tweede navigatie bijna niets.
async function measureTransfer(cdp, meter, { label, page, ready }) {
  await setViewport(cdp, 1280, 900);
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.clearBrowserCache');
  meter.reset();
  await navigate(cdp, `${APP}${page}`, ready);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const summary = meter.summary();
  transfer.push({ label, page, theme: 'dark', viewport: '1280x900', ...summary });
  console.log(`transfer ${page} (${label}): ${summary.totalKb} KB, ${summary.resourceCount} requests`);
  return summary;
}

let clockScriptId = null;
async function setFixedClock(cdp, iso) {
  if (clockScriptId) {
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: clockScriptId });
    clockScriptId = null;
  }
  if (!iso) return;
  const fixed = new Date(iso).getTime();
  const result = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const RealDate = Date;
      const fixed = ${fixed};
      class FixedDate extends RealDate {
        constructor(...args) { if (args.length === 0) super(fixed); else super(...args); }
        static now() { return fixed; }
      }
      FixedDate.parse = RealDate.parse;
      FixedDate.UTC = RealDate.UTC;
      window.Date = FixedDate;
    })();`,
  });
  clockScriptId = result.identifier;
}


async function main() {
  const browserPath = findBrowser();
  if (!browserPath) throw new Error('browser_unavailable: set BROWSER_PATH to an installed Edge/Chrome');

  let server = null;
  let browser = null;
  let cdp = null;
  const pages = {};
  try {
    server = await startProductionServer();
    browser = await startBrowser(browserPath);
    cdp = new CdpClient(browser.target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    const meter = attachNetworkMeter(cdp);

    // Overdracht: "na" voor 1A op de lijst, en de "voor"-meting van de
    // restaurantpagina voor deel 2 (2A).
    await applyTheme(cdp, 'dark');
    const transferNa = await measureTransfer(cdp, meter, {
      label: 'na 1A',
      page: '/alle-restaurants',
      ready: 'document.readyState === "complete" && document.querySelector(".ar-card") !== null',
    });
    const transferVoorDeel2 = await measureTransfer(cdp, meter, {
      label: 'voor 2A (Bardot, 4 kaarten)',
      page: '/restaurant/6',
      ready: 'document.readyState === "complete" && document.querySelector(".td-price") !== null',
    });
    check('overdracht: /alle-restaurants blijft onder 250 KB', transferNa.totalKb < 250, `${transferNa.totalKb} KB`);
    check('overdracht: /restaurant/6 (voor deel 2) blijft onder 250 KB', transferVoorDeel2.totalKb < 250, `${transferVoorDeel2.totalKb} KB`);

    for (const theme of ['light', 'dark']) {
      await applyTheme(cdp, theme);

      // 1A — /alle-restaurants, gemeten op 1280 px.
      await setViewport(cdp, 1280, 900);
      await navigate(cdp, `${APP}/alle-restaurants`, 'document.querySelector(".ar-card") !== null');
      const alle = await evalJs(cdp, ALLE_JS);
      pages[`alle-restaurants-${theme}`] = alle;
      check(`1A ${theme}: de kaart is geen grote link meer, de naam is de link`, !alle.cardIsLink && alle.nameIsLink && /^\/restaurant\//.test(alle.nameHref || ''), JSON.stringify({ nameHref: alle.nameHref, cardIsLink: alle.cardIsLink }));
      check(`1A ${theme}: de grote knop "Bekijk N menukaarten" is weg`, alle.bigCtas === 0, `${alle.bigCtas} .ar-cta`);
      check(`1A ${theme}: elke menukaart is een eigen knop naar /menu/<id>`, alle.buttons.length === 4 && alle.buttons.every((b) => /^\/menu\/[^/]+$/.test(b.href || '')), JSON.stringify(alle.buttons.map((b) => b.href)));
      check(`1A ${theme}: de knoppen dragen de echte kaartnamen`, alle.buttons.every((b) => b.label.length > 2), JSON.stringify(alle.buttons.map((b) => b.label)));
      check(`1A ${theme}: tabvolgorde is naam → kaartknoppen`, alle.focusOrder[0] === alle.nameHref && alle.focusOrder.slice(1).every((href) => /^\/menu\//.test(href || '')), JSON.stringify(alle.focusOrder));
      check(`1A ${theme}: alle aanraakvlakken zijn ≥ 44 px`, alle.buttons.every((b) => b.height >= 44), JSON.stringify(alle.buttons.map((b) => b.height)));
      check(`1A ${theme}: menuknoppen gebruiken de zachte tokenparen (≥ 4,5:1)`, Boolean(alle.buttonColors) && alle.buttonColors.bg === alle.buttonColors.soft && alle.buttonColors.ratio >= 4.5, JSON.stringify({ ratio: alle.buttonColors ? alle.buttonColors.ratio : null }));
      check(`1A ${theme}: geen horizontale overflow op 1280 px`, alle.overflow <= 1, `${alle.overflow}px`);
      check(`1A ${theme}: een restaurant zonder menukaart blijft zoals het was`,
        Boolean(alle.noMenu) && !alle.noMenu.missing && alle.noMenu.isWholeLink
          && /^\/restaurant\//.test(alle.noMenu.href || '')
          && alle.noMenu.label === 'Nog geen menukaart'
          && /^Bekijk restaurant/.test(alle.noMenu.restaurantLink || '')
          && alle.noMenu.extraActions === 0,
        JSON.stringify(alle.noMenu));

      // Zichtbare focus op de eerste menuknop.
      const focus = await evalJs(cdp, `(() => {
        const el = document.querySelector('a.ar-menu-button');
        if (!el) return { missing: true };
        el.focus();
        const s = getComputedStyle(el);
        return { active: document.activeElement === el, outlineWidth: s.outlineWidth, outlineStyle: s.outlineStyle, outlineColor: s.outlineColor };
      })()`);
      check(`1A ${theme}: de focus op een menuknop is zichtbaar`, Boolean(focus.active) && parseFloat(focus.outlineWidth) >= 2 && focus.outlineStyle !== 'none', JSON.stringify(focus));

      // 1A — telefoonbreedtes: knoppen blijven ≥ 44 px en niets loopt buiten beeld.
      for (const width of [390, 320]) {
        await setViewport(cdp, width, 800);
        await navigate(cdp, `${APP}/alle-restaurants`, 'document.querySelector(".ar-card") !== null');
        const phone = await evalJs(cdp, `(() => ({
          overflow: Math.round(document.documentElement.scrollWidth) - Math.round(window.innerWidth),
          heights: [...document.querySelectorAll('a.ar-menu-button')].map((el) => Math.round(el.getBoundingClientRect().height)),
        }))()`);
        pages[`alle-restaurants-${theme}-${width}`] = phone;
        check(`1A ${theme} ${width}px: knoppen ≥ 44 px en geen horizontale overflow`, phone.heights.every((h) => h >= 44) && phone.overflow <= 1, JSON.stringify(phone));
      }


      // 3B — het prijsvlak op de restaurantpagina, de menupagina en zoeken.
      await setViewport(cdp, 1280, 900);
      for (const [label, url, selector, ready] of [
        ['restaurant', `${APP}/restaurant/6`, '.td-price', 'document.querySelector(".td-price") !== null'],
        ['menu', `${APP}/menu/6-diner`, '.td-price', 'document.querySelector(".td-price") !== null'],
        // De eerste treffer op /search kan de zachte "op aanvraag"-variant zijn;
        // die is apart gedekt en verandert niet in BE-42. Hier telt een echte prijs.
        ['search', `${APP}/search?q=steak`, '.price-label:not(.price-label--soft)', 'document.querySelector(".price-label:not(.price-label--soft)") !== null'],
      ]) {
        await navigate(cdp, url, ready);
        const price = await evalJs(cdp, priceJs(selector));
        pages[`price-${label}-${theme}`] = price;
        check(`3B ${theme} ${label}: zacht vlak, primaire tekst, vet, ≥ 4,5:1`, !price.missing && price.usesSoft && price.usesPrimary && price.ratio >= 4.5 && Number(price.fontWeight) >= 700, JSON.stringify({ bg: price.bg, fg: price.fg, ratio: price.ratio, weight: price.fontWeight }));
        check(`3B ${theme} ${label}: de prijs staat rechts in zijn rij`, price.rightEdge >= price.containerRight - 2, JSON.stringify({ right: price.rightEdge, container: price.containerRight }));
      }

      // "op aanvraag" blijft de bestaande gedempte variant op hetzelfde zachte vlak.
      await navigate(cdp, `${APP}/search?q=pasta`, 'document.querySelector(".price-label--soft") !== null');
      const onRequest = await evalJs(cdp, priceJs('.price-label--soft'));
      pages[`price-on-request-${theme}`] = onRequest;
      check(`3B ${theme} search: "op aanvraag" blijft gedempt op het zachte vlak (≥ 4,5:1)`, !onRequest.missing && onRequest.usesSoft && onRequest.ratio >= 4.5, JSON.stringify({ bg: onRequest.bg, fg: onRequest.fg, ratio: onRequest.ratio }));

      // 3B — home, "Vanavond op de kaart", met de vaste BE-29-klok.
      await setFixedClock(cdp, '2026-10-23T18:00:00.000Z');
      await navigate(cdp, `${APP}/`, 'document.querySelector(".tonight-price") !== null');
      const tonight = await evalJs(cdp, priceJs('.tonight-price'));
      pages[`price-home-${theme}`] = tonight;
      check(`3B ${theme} home: zacht vlak, primaire tekst, vet, ≥ 4,5:1`, !tonight.missing && tonight.usesSoft && tonight.usesPrimary && tonight.ratio >= 4.5 && Number(tonight.fontWeight) >= 700, JSON.stringify({ bg: tonight.bg, fg: tonight.fg, ratio: tonight.ratio, weight: tonight.fontWeight }));
      await setFixedClock(cdp, null);

      // Screenshots: /alle-restaurants en /restaurant/6 op 1280, 390 en 320 px.
      for (const [name, url, ready] of [
        ['alle-restaurants', `${APP}/alle-restaurants`, 'document.querySelector(".ar-card") !== null'],
        ['restaurant-6', `${APP}/restaurant/6`, 'document.querySelector(".td-price") !== null'],
        // De lokale data heeft geen restaurant met precies één kaart; met twee
        // kaarten is /restaurant/1 (Wolfslaar) het kleinste echte geval.
        ['restaurant-1', `${APP}/restaurant/1`, 'document.querySelector(".td-price") !== null'],
      ]) {
        for (const [width, height] of [[1280, 900], [390, 844], [320, 720]]) {
          await setViewport(cdp, width, height);
          await navigate(cdp, url, ready);
          await new Promise((resolve) => setTimeout(resolve, 250));
          await shot(cdp, `${name}-${theme}-${width}.png`);
        }
      }
    }


    const failed = checks.filter((entry) => entry.passed === false);
    const record = {
      generatedAt: new Date().toISOString(),
      ticket: '#98 BE-42 deel 1 (1A + 3B)',
      kind: 'developer evidence — local production build, no production data or credentials',
      app: APP,
      checks: { total: checks.length, failed: failed.length, entries: checks },
      measurements: pages,
      transfer,
      screenshots: shots,
      gaps: [
        'Geen restaurant met precies één menukaart in de lokale data; /restaurant/1 (Wolfslaar, twee kaarten) is het kleinste echte geval (geen data toegevoegd).',
        'Dit is developer-evidence op een lokale productiebuild: geen productie, geen echte Supabase-credentials, geen merge of publicatie.',
      ],
      result: failed.length === 0 ? 'passed' : 'failed',
    };
    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, `${JSON.stringify(record, null, 2)}\n`);
    console.log(JSON.stringify({ result: record.result, checks: checks.length, failed: failed.length, shots: shots.length, out: OUT_PATH }, null, 2));
    if (failed.length > 0) {
      for (const entry of failed) console.log(`FAILED: ${entry.name} — ${entry.detail}`);
      process.exitCode = 1;
    }
  } finally {
    if (cdp) cdp.close();
    if (browser) killTree(browser.child);
    if (server) killTree(server);
    if (browser && browser.userDataDir) {
      try {
        fs.rmSync(browser.userDataDir, { recursive: true, force: true });
      } catch {
        // Een vergrendeld tijdelijk profiel is onschadelijk; het staat buiten de repo.
      }
    }
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});

