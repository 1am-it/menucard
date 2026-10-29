'use strict';

// BE-49 (#115) — browsercheck voor de rustiger gerechtkaart en het snelle
// delen.
//
// Start een eigen lokale ontwikkelserver (dezelfde runtime als de andere
// ops/browser-checks) en bestuurt een lokaal geïnstalleerde Edge/Chrome via CDP.
// Niets hiervan raakt productie, Supabase of een externe host.
//
// Wat deze check vastlegt:
//   - kaart: de twee icoonknoppen rechtsonder (44 × 44 px, icoon ±20 px, geen
//     gevulde achtergrond, aria-label "Deel <gerecht>" / "Bewaar <gerecht>"),
//     het label links, de beschrijving in --text-secondary met gemeten contrast
//     ≥ 4,5:1, in licht en donker en op 1280/390/320 px; per stand een kleine
//     kaart-PNG in ops/browser/evidence/be-49/.
//   - eerste-keer: geen voorkeur → het blad "Hoe deel je meestal?" met echte
//     checkboxen (maximaal 3) → bewaren → het kleine menu met de favorieten en
//     "Meer…" → een keuze opent precies de juiste deellink en telt één keer.
//   - een-favoriet: één favoriet deelt meteen, zonder menu.
//   - toetsenbord: focus in het paneel, Tab blijft binnen, Esc sluit en de focus
//     gaat terug naar de knop; aria-expanded volgt.
//   - links: elke manier bouwt exact de link uit het contract (url-encoding) en
//     telt één keer; "Meer…" deelt via het systeemmenu of kopieert.
//   - instellingen: "Delen via" naast de themakeuze, met de huidige favorieten,
//     wijzigen en wissen.
//
// Bewijs: ops/browser/evidence/be49-browser-evidence.json (in git) en de
// kaart-PNG's in ops/browser/evidence/be-49/ (in git); de overige opnamen staan
// in ops/browser/output/be-49/ (buiten git). Dit is developer-evidence op een
// lokale build: geen productie en geen onafhankelijke acceptatie.
//
//   node ops/browser/run-be49-browser-check.js [--alleen=<scenario>] [--lijst]

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

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
  pngSize,
} = require('./lib/runtime');
const {
  parseScenarioArgs,
  scenarioSelectionOutcome,
  filteredEvidencePath,
  runScenarioSelection,
} = require('./lib/scenario-filter');
const { CdpClient } = require('./lib/cdp');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.BE49_PORT || 3158);
const APP = `http://localhost:${PORT}`;
const OUT_DIR = path.join(REPO_ROOT, 'ops', 'browser', 'output', 'be-49');
// De kleine kaart-PNG's horen bij de levering en staan daarom in git.
const EVIDENCE_DIR = path.join(REPO_ROOT, 'ops', 'browser', 'evidence', 'be-49');
const BASE_EVIDENCE_PATH = path.join(REPO_ROOT, 'ops', 'browser', 'evidence', 'be49-browser-evidence.json');

// Dezelfde echte fixture als de BE-44-check: "Poussin" (€20,95, label
// "Aanbevolen") uit de dinerkaart van restaurant 6.
const MENU_ID = '6-diner';
const DISH_ID = '6-diner-0-0';
const DISH_NAME = 'Poussin';
const DISH_CATEGORY = 'Specialiteiten van Bardot';
const RESTAURANT_NAME = 'Brasserie Bardot';
const SHARE_PREFERENCE_KEY = 'deelvoorkeur';
const DEEP_LINK = `/menu/${MENU_ID}?dish=${DISH_ID}&name=${encodeURIComponent(DISH_NAME).replace(/%20/g, '+')}&cat=${encodeURIComponent(DISH_CATEGORY).replace(/%20/g, '+')}`;

// Zo bouwt de knop de link: de BE-12-deeplink met de stand van dit moment.
const standFor = (theme) => (theme === 'dark' ? 'donker' : 'licht');
const expectedShareUrl = (theme) => `${APP}${DEEP_LINK}&stand=${standFor(theme)}`;
const encodedShareUrl = (theme) => encodeURIComponent(expectedShareUrl(theme));
const expectedLink = (method, theme) => {
  const url = encodedShareUrl(theme);
  if (method === 'whatsapp') return `https://wa.me/?text=${url}`;
  if (method === 'telegram') return `https://t.me/share/url?url=${url}`;
  if (method === 'sms') return `sms:?&body=${url}`;
  if (method === 'email') {
    const title = `${DISH_NAME} · ${RESTAURANT_NAME}`;
    return `mailto:?subject=${encodeURIComponent(title)}&body=${url}`;
  }
  return null;
};

const SCENARIOS = [
  { name: 'kaart', run: (cdp) => kaartScenario(cdp) },
  { name: 'eerste-keer', run: (cdp) => eersteKeerScenario(cdp) },
  { name: 'een-favoriet', run: (cdp) => eenFavorietScenario(cdp) },
  { name: 'toetsenbord', run: (cdp) => toetsenbordScenario(cdp) },
  { name: 'links', run: (cdp) => linksScenario(cdp) },
  { name: 'meer', run: (cdp) => meerScenario(cdp) },
  { name: 'instellingen', run: (cdp) => instellingenScenario(cdp) },
];
const SELECTION = parseScenarioArgs(process.argv.slice(2), SCENARIOS);

const checks = [];
const shots = [];
let viewport = { width: 1280, height: 900 };

function check(name, passed, detail) {
  checks.push({ name, passed: Boolean(passed), detail: detail === undefined ? null : String(detail) });
  if (!passed) console.log(`FAIL ${name} — ${detail === undefined ? '' : detail}`);
}

async function setViewport(cdp, width, height) {
  viewport = { width, height };
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
}

async function shot(cdp, dir, name, meta = {}, clip = null) {
  const info = await screenshot(cdp, dir, name, clip ? { clip } : {});
  shots.push({
    ...meta,
    file: path.relative(REPO_ROOT, path.join(dir, name)).replace(/\\/g, '/'),
    viewport: `${viewport.width}x${viewport.height}`,
    pngWidth: info.width,
    pngHeight: info.height,
  });
}

async function setTheme(cdp, theme) {
  await navigate(cdp, `${APP}/`, 'document.readyState === "complete"');
  await evalJs(cdp, `localStorage.setItem('bredaeats_theme', ${JSON.stringify(theme)})`);
}

const THEMES = ['light', 'dark'];
const WIDTHS = [1280, 390, 320];

// ── Stubs in de pagina ──────────────────────────────────────────────────────
// De check bewijst wat de knop doet, niet wat het systeem ermee doet: de
// teller, het klembord en de systeemmenu's zijn onderschept. Externe namen
// worden in deze browser niet opgezocht.

const STORE_CLEARED = `(() => {
  localStorage.removeItem(${JSON.stringify(SHARE_PREFERENCE_KEY)});
  localStorage.removeItem('bredaeats_bewaard');
  return true;
})()`;

function preferenceStored(values) {
  return `localStorage.setItem(${JSON.stringify(SHARE_PREFERENCE_KEY)}, JSON.stringify(${JSON.stringify(values)}))`;
}

const PREFERENCE_READ = `(() => {
  const raw = localStorage.getItem(${JSON.stringify(SHARE_PREFERENCE_KEY)});
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (error) { return 'kapot'; }
})()`;

// Een klik op de tijdelijke deellink wordt vastgelegd en tegengehouden, zodat er
// geen enkel extern programma opstart.
const LINK_STUB = `(() => {
  window.__opened = [];
  document.addEventListener('click', (event) => {
    const target = event.target;
    const anchor = target && target.closest ? target.closest('a[href]') : null;
    if (!anchor) return;
    const href = anchor.getAttribute('href') || '';
    if (!/^(https?:|sms:|mailto:)/i.test(href)) return;
    event.preventDefault();
    window.__opened.push(anchor.href);
  }, true);
  return true;
})()`;

const OPENED_READ = '(() => window.__opened || [])()';

const CLIPBOARD_STUB = `(() => {
  window.__copied = null;
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: (value) => { window.__copied = String(value); return Promise.resolve(); } },
    configurable: true,
  });
  return true;
})()`;

const CLIPBOARD_DENIED_STUB = `(() => {
  window.__copied = null;
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: () => Promise.reject(new Error('NotAllowedError')) },
    configurable: true,
  });
  return true;
})()`;

const SHARE_STUB = `(() => {
  window.__shared = null;
  Object.defineProperty(navigator, 'share', {
    value: (payload) => { window.__shared = payload; return Promise.resolve(); },
    configurable: true,
  });
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: () => Promise.reject(new Error('mag niet gebruikt worden')) },
    configurable: true,
  });
  return true;
})()`;

const COUNTER_STUB = `(() => {
  window.__counters = [];
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : ((input && input.url) || '');
    if (!url.includes('/api/v1/tellers')) return realFetch(input, init);
    const raw = init && init.body ? String(init.body) : null;
    let values = null;
    try { values = raw ? JSON.parse(raw) : null; } catch (error) { values = null; }
    window.__counters.push({
      url,
      method: init && init.method,
      keepalive: Boolean(init && init.keepalive),
      credentials: init && init.credentials,
      referrerPolicy: init && init.referrerPolicy,
      keys: values && typeof values === 'object' ? Object.keys(values).sort() : [],
      values,
    });
    return Promise.resolve(new Response(null, { status: 204 }));
  };
  return true;
})()`;

const COUNTER_CLEARED = '(() => { window.__counters = []; return true; })()';
const COUNTERS_READ = '(() => window.__counters || [])()';

function countersFor(counters, event) {
  return (counters || []).filter((entry) => entry.values && entry.values.event === event);
}


// ── Meethelpers in de pagina ────────────────────────────────────────────────

const PAGE_HELPERS = `
  const flat = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
  const cardFor = (name) => [...document.querySelectorAll('.menu-card')]
    .find((card) => flat((card.querySelector('.td-name') || {}).innerText) === name) || null;
  const box = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, left: r.left, width: Math.round(r.width), height: Math.round(r.height) }; };
  const pageBox = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), width: Math.round(r.width), height: Math.round(r.height) }; };
  const rgb = (value) => {
    const match = String(value || '').match(/rgba?\\(([^)]+)\\)/);
    if (!match) return null;
    const parts = match[1].split(',').map((entry) => parseFloat(entry));
    if (parts.length < 3) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const luminance = (color) => {
    const channel = (value) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
  };
  const contrast = (fg, bg) => {
    const a = luminance(fg);
    const b = luminance(bg);
    const lighter = Math.max(a, b);
    const darker = Math.min(a, b);
    return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
  };
  const solidBackground = (el) => {
    let node = el;
    while (node) {
      const color = rgb(getComputedStyle(node).backgroundColor);
      if (color && color.a >= 1) return color;
      node = node.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };
`;

/** Eén gerechtkaart: layout, knoppen, label en de gemeten kleuren. */
function readCardJs(name) {
  return `(() => {
    ${PAGE_HELPERS}
    const card = cardFor(${JSON.stringify(name)});
    if (!card) return { missing: true, cards: document.querySelectorAll('.menu-card').length };
    const share = card.querySelector('.dish-share-btn');
    const save = card.querySelector('.dish-save-btn');
    const shareIcon = share ? share.querySelector('svg') : null;
    const saveIcon = save ? save.querySelector('svg') : null;
    const desc = card.querySelector('.td-desc');
    const foot = card.querySelector('.card-foot');
    const labels = card.querySelector('.card-foot-labels');
    const tags = [...card.querySelectorAll('.card-foot .item-tag')].map((el) => flat(el.innerText));
    const nameEl = card.querySelector('.td-name');
    const priceEl = card.querySelector('.td-price');
    const status = card.querySelector('[role="status"]');
    const descStyle = desc ? getComputedStyle(desc) : null;
    const descColor = descStyle ? rgb(descStyle.color) : null;
    const cardColor = desc ? solidBackground(desc) : null;
    const shareStyle = share ? getComputedStyle(share) : null;
    const saveStyle = save ? getComputedStyle(save) : null;
    return {
      missing: false,
      theme: document.documentElement.getAttribute('data-theme'),
      name: nameEl ? flat(nameEl.innerText) : null,
      price: priceEl ? flat(priceEl.innerText) : null,
      desc: desc ? flat(desc.innerText).slice(0, 60) : null,
      descFontSize: descStyle ? parseFloat(descStyle.fontSize) : null,
      descLineHeight: descStyle ? parseFloat(descStyle.lineHeight) : null,
      descColor: descStyle ? descStyle.color : null,
      descBackground: cardColor ? 'rgb(' + cardColor.r + ', ' + cardColor.g + ', ' + cardColor.b + ')' : null,
      descContrast: descColor && cardColor ? contrast(descColor, cardColor) : null,
      shareLabel: share ? share.getAttribute('aria-label') : null,
      saveLabel: save ? save.getAttribute('aria-label') : null,
      shareBox: share ? box(share) : null,
      saveBox: save ? box(save) : null,
      shareIconBox: shareIcon ? box(shareIcon) : null,
      saveIconBox: saveIcon ? box(saveIcon) : null,
      shareBackground: shareStyle ? shareStyle.backgroundColor : null,
      saveBackground: saveStyle ? saveStyle.backgroundColor : null,
      savePressed: save ? save.getAttribute('aria-pressed') : null,
      saveFill: saveIcon ? saveIcon.getAttribute('fill') : null,
      shareExpanded: share ? share.getAttribute('aria-expanded') : null,
      shareVisibleText: share ? flat(share.innerText) : null,
      saveVisibleText: save ? flat(save.innerText) : null,
      statusRole: Boolean(status),
      foot: Boolean(foot),
      footContainsButtons: Boolean(foot && share && save && foot.contains(share) && foot.contains(save)),
      labelsLeftOfButtons: Boolean(labels && share && box(labels).left + box(labels).width <= box(share).left + 1),
      labelsInsideFoot: Boolean(foot && labels && foot.contains(labels)),
      tags,
      buttonsBelowName: Boolean(nameEl && share && box(share).top > box(nameEl).top),
      cardBox: pageBox(card),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  })()`;
}


// ── Interactie ──────────────────────────────────────────────────────────────

/** De menukaart openen, met of zonder bewaarde deelvoorkeur. */
async function openMenu(cdp, width, theme, { preference = null, clipboard = CLIPBOARD_STUB } = {}) {
  await setViewport(cdp, width, width === 1280 ? 950 : 844);
  await setTheme(cdp, theme);
  await evalJs(cdp, STORE_CLEARED);
  await navigate(
    cdp,
    `${APP}/menu/${MENU_ID}`,
    `Boolean([...document.querySelectorAll('.menu-card .td-name')].find((el) => (el.innerText || '').trim() === ${JSON.stringify(DISH_NAME)}))`,
  );
  if (preference) await evalJs(cdp, preferenceStored(preference));
  await evalJs(cdp, LINK_STUB);
  await evalJs(cdp, clipboard);
  await evalJs(cdp, COUNTER_STUB);
  await evalJs(cdp, COUNTER_CLEARED);
}

function clickShareJs() {
  return `(() => {
    ${PAGE_HELPERS}
    const card = cardFor(${JSON.stringify(DISH_NAME)});
    const button = card ? card.querySelector('.dish-share-btn') : null;
    if (!button) return false;
    button.click();
    return true;
  })()`;
}

function clickSaveJs() {
  return `(() => {
    ${PAGE_HELPERS}
    const card = cardFor(${JSON.stringify(DISH_NAME)});
    const button = card ? card.querySelector('.dish-save-btn') : null;
    if (!button) return false;
    button.click();
    return true;
  })()`;
}

/**
 * Klikken tot het effect optreedt: de server rendert de knop al, maar de
 * klikhandler bestaat pas na hydratatie. Zonder deze lus verdwijnt een vroege
 * klik zonder fout.
 */
async function clickUntil(cdp, clickJs, observedJs, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let clicked = false;
  while (Date.now() < deadline) {
    clicked = await evalJs(cdp, clickJs);
    if (!clicked) return { clicked: false, observed: false };
    if (await waitFor(cdp, observedJs, 1500)) return { clicked: true, observed: true };
  }
  return { clicked, observed: false };
}

const SHEET_OPEN = `Boolean(document.querySelector('.share-sheet'))`;
const MENU_OPEN = `Boolean(document.querySelector('.share-menu'))`;
const SHEET_CLOSED = `!document.querySelector('.share-sheet')`;
const MENU_CLOSED = `!document.querySelector('.share-menu')`;

/**
 * Enter op de gefocusseerde knop, net zo lang tot het effect optreedt. Zo blijft
 * het pad echt toetsenbord-only, ook als de pagina nog aan het hydrateren is.
 */
async function pressEnterUntil(cdp, observedJs, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await pressKey(cdp, 'Enter', 'Enter', 13, '\r');
    if (await waitFor(cdp, observedJs, 1200)) return true;
  }
  return false;
}

/** Het openstaande paneel: titel, checkboxen, knoppen en menu-items. */
function readPanelJs(selector) {
  return `(() => {
    ${PAGE_HELPERS}
    const panel = document.querySelector(${JSON.stringify(selector)});
    if (!panel) return { open: false };
    const inputs = [...panel.querySelectorAll('input')].map((input) => ({
      type: input.type,
      value: input.value,
      name: input.name,
      checked: input.checked,
      disabled: input.disabled,
      box: box(input),
    }));
    const buttons = [...panel.querySelectorAll('button')].map((button) => flat(button.innerText));
    const save = panel.querySelector('button[type="submit"]');
    return {
      open: true,
      role: panel.getAttribute('role'),
      modal: panel.getAttribute('aria-modal'),
      label: panel.getAttribute('aria-labelledby'),
      title: flat((panel.querySelector('.share-panel-title') || {}).innerText),
      hint: flat((panel.querySelector('.share-panel-hint') || {}).innerText),
      inputs,
      buttons,
      saveLabel: save ? flat(save.innerText) : null,
      saveDisabled: save ? save.disabled : null,
      items: [...panel.querySelectorAll('.share-menu-item')].map((item) => flat(item.innerText)),
      panelBox: box(panel),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  })()`;
}

/** Wat heeft de focus, en zit het in het paneel? */
function activeElementJs() {
  return `(() => {
    ${PAGE_HELPERS}
    const el = document.activeElement;
    const panel = document.querySelector('.share-sheet, .share-menu');
    if (!el) return null;
    return {
      tag: el.tagName,
      type: el.getAttribute('type'),
      value: el.value || null,
      text: flat(el.innerText).slice(0, 60),
      label: el.getAttribute('aria-label'),
      insidePanel: Boolean(panel && panel.contains(el)),
      isShareButton: el.classList ? el.classList.contains('dish-share-btn') : false,
      expanded: el.getAttribute('aria-expanded'),
    };
  })()`;
}

/** Een checkbox in het blad aan- of uitzetten (een echte klik op de input). */
function toggleCheckboxJs(value) {
  return `(() => {
    const input = document.querySelector('.share-sheet input[value=' + JSON.stringify(${JSON.stringify(value)}) + ']');
    if (!input) return false;
    input.click();
    return true;
  })()`;
}

function togglePhoneJs() {
  return `(() => {
    const input = document.querySelector('.share-sheet input[name="deelvoorkeur-telefoonmenu"]');
    if (!input) return false;
    input.click();
    return true;
  })()`;
}

const SAVE_SHEET_JS = `(() => {
  const button = document.querySelector('.share-sheet button[type="submit"]');
  if (!button || button.disabled) return false;
  button.click();
  return true;
})()`;

function clickMenuItemJs(label) {
  return `(() => {
    const item = [...document.querySelectorAll('.share-menu-item')].find((el) => (el.innerText || '').trim() === ${JSON.stringify(label)});
    if (!item) return false;
    item.click();
    return true;
  })()`;
}


/** De kaart in beeld brengen vóór een opname, en de uitsnede teruggeven. */
function focusCardJs() {
  return `(() => {
    ${PAGE_HELPERS}
    const card = cardFor(${JSON.stringify(DISH_NAME)});
    if (!card) return false;
    card.scrollIntoView({ block: 'center' });
    return true;
  })()`;
}

function cardClipJs() {
  return `(() => {
    ${PAGE_HELPERS}
    const card = cardFor(${JSON.stringify(DISH_NAME)});
    if (!card) return null;
    const r = card.getBoundingClientRect();
    const pad = 6;
    // De clip van Page.captureScreenshot is in pagina-coördinaten, niet in
    // venster-coördinaten: de pagina is immers naar de kaart gescrold.
    return {
      x: Math.max(0, Math.round(r.left + window.scrollX - pad)),
      y: Math.max(0, Math.round(r.top + window.scrollY - pad)),
      width: Math.round(r.width + pad * 2),
      height: Math.round(r.height + pad * 2),
    };
  })()`;
}

const TRANSPARENT = ['rgba(0, 0, 0, 0)', 'transparent'];

/** De korte openingsanimatie laten aflopen vóór een opname. */
function settle(ms = 300) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── 1. De kaart: rustiger, leesbaar, twee icoonknoppen rechtsonder ──────────
async function kaartScenario(cdp) {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      const label = `${width}/${theme}`;
      await openMenu(cdp, width, theme, { preference: { phone: true } });
      await evalJs(cdp, focusCardJs());
      await new Promise((resolve) => setTimeout(resolve, 250));
      const card = await evalJs(cdp, readCardJs(DISH_NAME));

      check(`kaart (${label}): het gerecht staat bovenaan met zijn prijs`, card.name === DISH_NAME && card.price === '€20,95', JSON.stringify({ name: card.name, price: card.price }));
      check(`kaart (${label}): de beschrijving staat er nog`, Boolean(card.desc) && card.desc.length > 20, card.desc);
      check(`kaart (${label}): de beschrijving is minstens 13 px met ruime regelafstand`, card.descFontSize >= 13 && card.descLineHeight / card.descFontSize >= 1.4, JSON.stringify({ size: card.descFontSize, ratio: card.descLineHeight / card.descFontSize }));
      check(`kaart (${label}): de beschrijving haalt contrast ≥ 4,5:1 op de kaart`, card.descContrast >= 4.5, JSON.stringify({ contrast: card.descContrast, color: card.descColor, background: card.descBackground }));
      check(`kaart (${label}): de deelknop heet "Deel ${DISH_NAME}"`, card.shareLabel === `Deel ${DISH_NAME}`, card.shareLabel);
      check(`kaart (${label}): de bewaarknop heet "Bewaar ${DISH_NAME}"`, card.saveLabel === `Bewaar ${DISH_NAME}`, card.saveLabel);
      check(`kaart (${label}): beide knoppen zijn minstens 44 × 44 px`, Boolean(card.shareBox && card.saveBox) && card.shareBox.width >= 44 && card.shareBox.height >= 44 && card.saveBox.width >= 44 && card.saveBox.height >= 44, JSON.stringify({ share: card.shareBox, save: card.saveBox }));
      check(`kaart (${label}): het zichtbare icoon is ±20 px`, Boolean(card.shareIconBox && card.saveIconBox) && card.shareIconBox.width >= 18 && card.shareIconBox.width <= 22 && card.saveIconBox.width >= 18 && card.saveIconBox.width <= 22, JSON.stringify({ share: card.shareIconBox, save: card.saveIconBox }));
      check(`kaart (${label}): geen gevulde achtergrond`, TRANSPARENT.includes(card.shareBackground) && TRANSPARENT.includes(card.saveBackground), JSON.stringify({ share: card.shareBackground, save: card.saveBackground }));
      check(`kaart (${label}): de knoppen tonen geen tekst`, card.shareVisibleText === '' && card.saveVisibleText === '', JSON.stringify({ share: card.shareVisibleText, save: card.saveVisibleText }));
      check(`kaart (${label}): "Delen" en "Bewaren" staan in de onderste regel`, card.foot === true && card.footContainsButtons === true, JSON.stringify({ foot: card.foot, buttons: card.footContainsButtons }));
      check(`kaart (${label}): het label staat links, de knoppen rechts`, card.labelsInsideFoot === true && card.labelsLeftOfButtons === true, JSON.stringify({ inside: card.labelsInsideFoot, left: card.labelsLeftOfButtons }));
      check(`kaart (${label}): het label van dit gerecht staat er ("Aanbevolen")`, card.tags.map((tag) => tag.toLowerCase()).includes('aanbevolen'), JSON.stringify(card.tags));
      check(`kaart (${label}): de knoppen staan onder de naam, niet ernaast`, card.buttonsBelowName === true);
      check(`kaart (${label}): de bewaarknop staat uit met aria-pressed="false"`, card.savePressed === 'false' && card.saveFill === 'none', JSON.stringify({ pressed: card.savePressed, fill: card.saveFill }));
      check(`kaart (${label}): de deelknop zegt aria-expanded="false"`, card.shareExpanded === 'false', card.shareExpanded);
      check(`kaart (${label}): de statusmelding staat in een role="status"`, card.statusRole === true);
      check(`kaart (${label}): de stand van de pagina is ${theme}`, card.theme === theme, card.theme);
      check(`kaart (${label}): geen horizontale overloop`, card.overflow <= 0, `overflow=${card.overflow}`);

      const clip = await evalJs(cdp, cardClipJs());
      check(`kaart (${label}): de kaart is volledig in beeld voor de opname`, Boolean(clip) && clip.width > 100 && clip.height > 80, JSON.stringify(clip));
      if (clip) {
        // De kleine kaart-PNG hoort bij de levering (evidence/be-49/), de
        // volledige opname blijft buiten git in output/be-49/.
        await shot(cdp, EVIDENCE_DIR, `be49-kaart-${width}-${theme}.png`, { scenario: 'kaart', theme, width }, clip);
        await shot(cdp, OUT_DIR, `be49-kaart-volledig-${width}-${theme}.png`, { scenario: 'kaart', theme, width });
      }

      // "Gerecht bewaard": gevulde bladwijzer en aria-pressed="true".
      if (width === 390) {
        await clickUntil(cdp, clickSaveJs(), `(() => {
          ${PAGE_HELPERS}
          const card = cardFor(${JSON.stringify(DISH_NAME)});
          const button = card ? card.querySelector('.dish-save-btn') : null;
          return Boolean(button && button.getAttribute('aria-pressed') === 'true');
        })()`);
        const saved = await evalJs(cdp, readCardJs(DISH_NAME));
        check(`kaart (${label}): bewaard is de bladwijzer gevuld met aria-pressed="true"`, saved.savePressed === 'true' && saved.saveFill === 'currentColor', JSON.stringify({ pressed: saved.savePressed, fill: saved.saveFill }));
        check(`kaart (${label}): bewaard blijft het een icoonknop zonder tekst of vlak`, TRANSPARENT.includes(saved.saveBackground) && saved.saveVisibleText === '', JSON.stringify({ background: saved.saveBackground, text: saved.saveVisibleText }));
        const savedClip = await evalJs(cdp, cardClipJs());
        if (savedClip) await shot(cdp, OUT_DIR, `be49-bewaard-${width}-${theme}.png`, { scenario: 'kaart', state: 'bewaard', theme, width }, savedClip);
      }
    }
  }
}


// ── 2. Eerste keer delen: het blad, de favorieten en het kleine menu ────────
async function eersteKeerScenario(cdp) {
  const width = 390;
  const theme = 'light';
  await openMenu(cdp, width, theme);
  await evalJs(cdp, focusCardJs());
  await new Promise((resolve) => setTimeout(resolve, 200));

  const opened = await clickUntil(cdp, clickShareJs(), SHEET_OPEN);
  check('eerste keer: zonder voorkeur opent het blad "Hoe deel je meestal?"', opened.observed, JSON.stringify(opened));
  const sheet = await evalJs(cdp, readPanelJs('.share-sheet'));
  check('eerste keer: het blad is een echt dialoogvenster', sheet.role === 'dialog' && sheet.modal === 'true' && Boolean(sheet.label), JSON.stringify({ role: sheet.role, modal: sheet.modal }));
  check('eerste keer: de titel is "Hoe deel je meestal?"', sheet.title === 'Hoe deel je meestal?', sheet.title);
  check('eerste keer: de uitleg noemt het maximum van 3', /maximaal 3/.test(sheet.hint || ''), sheet.hint);
  const methodInputs = (sheet.inputs || []).filter((input) => input.name === 'deelmanier');
  check('eerste keer: vijf echte checkboxen, in de volgorde van het contract', methodInputs.length === 5 && methodInputs.every((input) => input.type === 'checkbox') && methodInputs.map((input) => input.value).join(',') === 'whatsapp,copy,sms,telegram,email', JSON.stringify(methodInputs.map((input) => input.value)));
  const phoneInput = (sheet.inputs || []).find((input) => input.name === 'deelvoorkeur-telefoonmenu');
  check('eerste keer: "Liever altijd het telefoonmenu" is er ook, als checkbox', Boolean(phoneInput) && phoneInput.type === 'checkbox', JSON.stringify(phoneInput));
  check('eerste keer: de checkboxen zijn minstens 20 px', methodInputs.every((input) => input.box.width >= 20 && input.box.height >= 20), JSON.stringify(methodInputs.map((input) => input.box)));
  check('eerste keer: zonder keuze kan er niets bewaard worden', sheet.saveDisabled === true, JSON.stringify({ label: sheet.saveLabel, disabled: sheet.saveDisabled }));
  await settle();
  await shot(cdp, OUT_DIR, `be49-blad-${width}-${theme}.png`, { scenario: 'eerste-keer', state: 'blad', theme, width });

  // Maximaal 3: na drie keuzes zijn de andere twee uitgeschakeld en telt een
  // vierde klik niet mee.
  await evalJs(cdp, toggleCheckboxJs('whatsapp'));
  await evalJs(cdp, toggleCheckboxJs('copy'));
  await evalJs(cdp, toggleCheckboxJs('sms'));
  const threeChosen = await evalJs(cdp, readPanelJs('.share-sheet'));
  const chosen = (threeChosen.inputs || []).filter((input) => input.name === 'deelmanier' && input.checked);
  const atLimit = (threeChosen.inputs || []).filter((input) => input.name === 'deelmanier' && !input.checked);
  check('eerste keer: drie aangevinkte manieren', chosen.length === 3, JSON.stringify(chosen.map((input) => input.value)));
  check('eerste keer: de overige twee zijn uitgeschakeld', atLimit.length === 2 && atLimit.every((input) => input.disabled === true), JSON.stringify(atLimit.map((input) => ({ value: input.value, disabled: input.disabled }))));
  await evalJs(cdp, toggleCheckboxJs('telegram'));
  const afterFourth = await evalJs(cdp, readPanelJs('.share-sheet'));
  check('eerste keer: een vierde keuze kan niet', (afterFourth.inputs || []).filter((input) => input.name === 'deelmanier' && input.checked).length === 3, JSON.stringify(afterFourth.inputs));
  await shot(cdp, OUT_DIR, `be49-blad-max3-${width}-${theme}.png`, { scenario: 'eerste-keer', state: 'max3', theme, width });

  // Terug naar twee favorieten en bewaren: dan volgt het kleine menu.
  await evalJs(cdp, toggleCheckboxJs('sms'));
  const saved = await clickUntil(cdp, SAVE_SHEET_JS, MENU_OPEN);
  check('eerste keer: bewaren sluit het blad en opent het kleine menu', saved.observed, JSON.stringify(saved));
  const menu = await evalJs(cdp, readPanelJs('.share-menu'));
  check('eerste keer: het menu toont de twee favorieten en "Meer…"', menu.items.join(',') === 'WhatsApp,Link kopiëren,Meer…', JSON.stringify(menu.items));
  check('eerste keer: het menu zegt bij welk gerecht het hoort', menu.title === `Deel ${DISH_NAME}`, menu.title);
  const stored = await evalJs(cdp, PREFERENCE_READ);
  check('eerste keer: de voorkeur staat alleen in localStorage', JSON.stringify(stored) === JSON.stringify({ methods: ['whatsapp', 'copy'] }), JSON.stringify(stored));
  await settle();
  await shot(cdp, OUT_DIR, `be49-menu-${width}-${theme}.png`, { scenario: 'eerste-keer', state: 'menu', theme, width });

  // Eén tik op WhatsApp: de juiste deellink, de teller, en het menu dicht.
  const picked = await clickUntil(cdp, clickMenuItemJs('WhatsApp'), `(() => (window.__opened || []).length > 0)()`);
  const openedLinks = await evalJs(cdp, OPENED_READ);
  const counters = countersFor(await evalJs(cdp, COUNTERS_READ), 'gedeeld');
  check('eerste keer: WhatsApp opent de link uit het contract', picked.observed && openedLinks[0] === expectedLink('whatsapp', theme), JSON.stringify({ opened: openedLinks, expected: expectedLink('whatsapp', theme) }));
  check('eerste keer: het menu is daarna dicht', await evalJs(cdp, MENU_CLOSED));
  check('eerste keer: de teller telt één keer, met alleen dish en event', counters.length === 1 && JSON.stringify(counters[0].keys) === JSON.stringify(['dish', 'event']) && counters[0].values.dish === DISH_ID, JSON.stringify(counters));
}


// ── 3. Eén favoriet: meteen delen, zonder menu ──────────────────────────────
async function eenFavorietScenario(cdp) {
  for (const { width, theme } of [{ width: 390, theme: 'light' }, { width: 1280, theme: 'dark' }]) {
    const label = `${width}/${theme}`;
    await openMenu(cdp, width, theme, { preference: { methods: ['telegram'] } });
    const clicked = await clickUntil(cdp, clickShareJs(), `(() => (window.__opened || []).length > 0)()`);
    const openedLinks = await evalJs(cdp, OPENED_READ);
    const counters = countersFor(await evalJs(cdp, COUNTERS_READ), 'gedeeld');
    check(`een favoriet (${label}): één tik deelt meteen via Telegram`, clicked.observed && openedLinks.length === 1 && openedLinks[0] === expectedLink('telegram', theme), JSON.stringify({ opened: openedLinks, expected: expectedLink('telegram', theme) }));
    check(`een favoriet (${label}): er opent geen blad of menu`, (await evalJs(cdp, SHEET_CLOSED)) && (await evalJs(cdp, MENU_CLOSED)));
    check(`een favoriet (${label}): de teller telt één keer`, counters.length === 1 && counters[0].values.dish === DISH_ID, JSON.stringify(counters));
    const card = await evalJs(cdp, readCardJs(DISH_NAME));
    check(`een favoriet (${label}): de knop blijft dicht (aria-expanded="false")`, card.shareExpanded === 'false', card.shareExpanded);
  }
}

// ── 4. Het toetsenbordpad ───────────────────────────────────────────────────
async function toetsenbordScenario(cdp) {
  const width = 390;
  const theme = 'light';
  await openMenu(cdp, width, theme);
  // De knop krijgt de focus zoals met Tab; Enter opent het blad.
  await evalJs(cdp, `(() => {
    const card = document.querySelector('.menu-card');
    const button = card ? card.querySelector('.dish-share-btn') : null;
    if (!button) return false;
    button.focus();
    return document.activeElement === button;
  })()`);
  const focused = await evalJs(cdp, `(() => {
    const el = document.activeElement;
    return Boolean(el && el.classList && el.classList.contains('dish-share-btn'));
  })()`);
  check('toetsenbord: de deelknop kan de focus krijgen', focused === true);
  const sheetOpened = await pressEnterUntil(cdp, SHEET_OPEN);
  check('toetsenbord: Enter opent het blad', sheetOpened === true);

  const first = await evalJs(cdp, activeElementJs());
  check('toetsenbord: de focus staat meteen in het blad', Boolean(first && first.insidePanel), JSON.stringify(first));
  check('toetsenbord: en wel op de eerste checkbox', Boolean(first && first.tag === 'INPUT' && first.type === 'checkbox' && first.value === 'whatsapp'), JSON.stringify(first));

  await pressKey(cdp, 'Tab', 'Tab', 9);
  await pressKey(cdp, 'Tab', 'Tab', 9);
  const afterTabs = await evalJs(cdp, activeElementJs());
  check('toetsenbord: Tab blijft binnen het blad', Boolean(afterTabs && afterTabs.insidePanel), JSON.stringify(afterTabs));

  // Shift+Tab vanaf de eerste checkbox blijft ook binnen (focus-trap).
  await evalJs(cdp, `(() => {
    const input = document.querySelector('.share-sheet input[value="whatsapp"]');
    if (!input) return false;
    input.focus();
    return true;
  })()`);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers: 8 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers: 8 });
  const wrapped = await evalJs(cdp, activeElementJs());
  check('toetsenbord: Shift+Tab vanaf het begin blijft binnen het blad', Boolean(wrapped && wrapped.insidePanel), JSON.stringify(wrapped));

  await pressKey(cdp, 'Escape', 'Escape', 27);
  const closed = await waitFor(cdp, SHEET_CLOSED, 5000);
  const back = await evalJs(cdp, activeElementJs());
  check('toetsenbord: Esc sluit het blad', closed === true);
  check('toetsenbord: de focus gaat terug naar de deelknop', Boolean(back && back.isShareButton), JSON.stringify(back));
  check('toetsenbord: en de knop zegt weer aria-expanded="false"', Boolean(back && back.expanded === 'false'), JSON.stringify(back));

  // Hetzelfde voor het kleine menu.
  await evalJs(cdp, preferenceStored({ methods: ['whatsapp', 'copy'] }));
  await navigate(cdp, `${APP}/menu/${MENU_ID}`, `Boolean(document.querySelector('.dish-share-btn'))`);
  await evalJs(cdp, `(() => { const button = document.querySelector('.dish-share-btn'); if (!button) return false; button.focus(); return true; })()`);
  const menuOpened = await pressEnterUntil(cdp, MENU_OPEN);
  const menuFirst = await evalJs(cdp, activeElementJs());
  check('toetsenbord: Enter opent het kleine menu met de focus erin', menuOpened === true && Boolean(menuFirst && menuFirst.insidePanel), JSON.stringify(menuFirst));
  check('toetsenbord: de focus staat op de eerste favoriet', Boolean(menuFirst && menuFirst.text === 'WhatsApp'), JSON.stringify(menuFirst));
  await pressKey(cdp, 'Escape', 'Escape', 27);
  const menuClosed = await waitFor(cdp, MENU_CLOSED, 5000);
  const menuBack = await evalJs(cdp, activeElementJs());
  check('toetsenbord: Esc sluit het menu en de focus keert terug', menuClosed === true && Boolean(menuBack && menuBack.isShareButton), JSON.stringify(menuBack));
}


/** De melding in de role="status" van deze kaart. */
function readStatusJs() {
  return `(() => {
    ${PAGE_HELPERS}
    const card = cardFor(${JSON.stringify(DISH_NAME)});
    const status = card ? card.querySelector('[role="status"]') : null;
    return status ? flat(status.innerText) : '';
  })()`;
}

// ── 5. Elke manier: de juiste link, met url-encoding, en één telling ────────
async function linksScenario(cdp) {
  const width = 1280;
  const theme = 'light';
  for (const method of ['whatsapp', 'telegram', 'sms', 'email', 'copy']) {
    const label = `links (${method})`;
    await openMenu(cdp, width, theme, { preference: { methods: [method] } });
    const observed = method === 'copy'
      ? '(() => Boolean(window.__copied))()'
      : '(() => (window.__opened || []).length > 0)()';
    const clicked = await clickUntil(cdp, clickShareJs(), observed);
    const opened = await evalJs(cdp, OPENED_READ);
    const copied = await evalJs(cdp, 'window.__copied');
    const counters = countersFor(await evalJs(cdp, COUNTERS_READ), 'gedeeld');
    if (method === 'copy') {
      check(`${label}: het klembord krijgt de deeplink met de stand`, clicked.observed && copied === expectedShareUrl(theme), JSON.stringify({ copied, expected: expectedShareUrl(theme) }));
      const status = await evalJs(cdp, readStatusJs());
      check(`${label}: "Link gekopieerd" verschijnt in de statusmelding`, status === 'Link gekopieerd', status);
    } else {
      check(`${label}: de link is exact de link uit het contract`, clicked.observed && opened.length === 1 && opened[0] === expectedLink(method, theme), JSON.stringify({ opened, expected: expectedLink(method, theme) }));
      check(`${label}: de link opent geen systeemmenu`, (await evalJs(cdp, 'Boolean(window.__shared)')) === false);
    }
    check(`${label}: de teller telt één keer, met alleen dish en event`, counters.length === 1 && JSON.stringify(counters[0].keys) === JSON.stringify(['dish', 'event']) && counters[0].values.dish === DISH_ID, JSON.stringify(counters));
  }
}

// ── 6. "Meer…": het systeemmenu, of kopiëren op desktop ────────────────────
async function meerScenario(cdp) {
  // Desktop zonder navigator.share: "Meer…" kopieert met de melding.
  await openMenu(cdp, 1280, 'light', { preference: { methods: ['whatsapp', 'copy'] } });
  const menuOpened = await clickUntil(cdp, clickShareJs(), MENU_OPEN);
  const more = await clickUntil(cdp, clickMenuItemJs('Meer…'), '(() => Boolean(window.__copied))()');
  const copied = await evalJs(cdp, 'window.__copied');
  const counters = countersFor(await evalJs(cdp, COUNTERS_READ), 'gedeeld');
  const status = await evalJs(cdp, readStatusJs());
  check('meer (desktop): het menu opent met de favorieten', menuOpened.observed === true);
  check('meer (desktop): "Meer…" valt terug op kopiëren', more.observed && copied === expectedShareUrl('light'), JSON.stringify({ copied }));
  check('meer (desktop): met de melding "Link gekopieerd"', status === 'Link gekopieerd', status);
  check('meer (desktop): en de teller telt één keer', counters.length === 1, JSON.stringify(counters));

  // Telefoon met navigator.share: "Meer…" is het systeemmenu, met alleen url
  // en title.
  await openMenu(cdp, 390, 'dark', { preference: { methods: ['whatsapp', 'copy'] }, clipboard: SHARE_STUB });
  await clickUntil(cdp, clickShareJs(), MENU_OPEN);
  const sharedClick = await clickUntil(cdp, clickMenuItemJs('Meer…'), '(() => Boolean(window.__shared))()');
  const payload = await evalJs(cdp, 'window.__shared');
  const keys = payload && typeof payload === 'object' ? Object.keys(payload).sort() : [];
  const mobileCounters = countersFor(await evalJs(cdp, COUNTERS_READ), 'gedeeld');
  check('meer (telefoon): "Meer…" gebruikt het systeemmenu', sharedClick.observed === true, JSON.stringify(payload));
  check('meer (telefoon): met alleen url en title, zonder tekst', JSON.stringify(keys) === JSON.stringify(['title', 'url']) && payload.url === expectedShareUrl('dark'), JSON.stringify({ keys, payload }));
  check('meer (telefoon): en de teller telt één keer', mobileCounters.length === 1, JSON.stringify(mobileCounters));
}


/** De knop "Delen via" in de kop, en of hij naast de themakeuze staat. */
function readSettingsJs() {
  return `(() => {
    ${PAGE_HELPERS}
    const button = document.querySelector('.share-settings-btn');
    const theme = document.querySelector('.theme-switch');
    if (!button) return { found: false };
    return {
      found: true,
      text: flat(button.innerText),
      box: box(button),
      expanded: button.getAttribute('aria-expanded'),
      hasPopup: button.getAttribute('aria-haspopup'),
      sameParentAsTheme: Boolean(theme && button.parentElement && button.parentElement.parentElement === theme.parentElement),
      themeFound: Boolean(theme),
    };
  })()`;
}

function clickSettingsJs() {
  return `(() => {
    const button = document.querySelector('.share-settings-btn');
    if (!button) return false;
    button.click();
    return true;
  })()`;
}

function clickSheetButtonJs(text) {
  return `(() => {
    const button = [...document.querySelectorAll('.share-sheet button')].find((el) => (el.innerText || '').trim() === ${JSON.stringify(text)});
    if (!button) return false;
    button.click();
    return true;
  })()`;
}

// ── 7. "Delen via" in de instellingen ──────────────────────────────────────
async function instellingenScenario(cdp) {
  for (const { width, theme } of [{ width: 1280, theme: 'light' }, { width: 390, theme: 'dark' }]) {
    const label = `${width}/${theme}`;
    await openMenu(cdp, width, theme, { preference: { methods: ['whatsapp', 'copy'] } });

    const settingsReady = await waitFor(cdp, `Boolean(document.querySelector('.share-settings-btn') && document.querySelector('.theme-switch'))`, 8000);
    check(`instellingen (${label}): de knop staat naast de themakeuze in de kop`, settingsReady === true, settingsReady);
    const settings = await evalJs(cdp, readSettingsJs());
    check(`instellingen (${label}): "Delen via" staat naast de themakeuze`, settings.found === true && settings.text === 'Delen via' && settings.sameParentAsTheme === true, JSON.stringify(settings));
    check(`instellingen (${label}): de knop heeft een tikvlak van 44 px`, Boolean(settings.box) && settings.box.height >= 44, JSON.stringify(settings.box));
    check(`instellingen (${label}): de knop zegt aria-expanded="false"`, settings.expanded === 'false', settings.expanded);

    const opened = await clickUntil(cdp, clickSettingsJs(), SHEET_OPEN);
    const sheet = await evalJs(cdp, readPanelJs('.share-sheet'));
    const checked = (sheet.inputs || []).filter((input) => input.name === 'deelmanier' && input.checked).map((input) => input.value);
    check(`instellingen (${label}): hetzelfde blad opent, met de huidige favorieten`, opened.observed && sheet.title === 'Delen via' && checked.join(',') === 'whatsapp,copy', JSON.stringify({ title: sheet.title, checked }));
    check(`instellingen (${label}): er is een knop "Wissen"`, (sheet.buttons || []).includes('Wissen'), JSON.stringify(sheet.buttons));
    await settle();
    await shot(cdp, OUT_DIR, `be49-instellen-${width}-${theme}.png`, { scenario: 'instellingen', theme, width });

    // Wijzigen: "Link kopiëren" eraf, "E-mail" erbij.
    await evalJs(cdp, toggleCheckboxJs('copy'));
    await evalJs(cdp, toggleCheckboxJs('email'));
    const savedChange = await clickUntil(cdp, SAVE_SHEET_JS, SHEET_CLOSED);
    const changed = await evalJs(cdp, PREFERENCE_READ);
    check(`instellingen (${label}): wijzigen bewaart meteen`, savedChange.observed && JSON.stringify(changed) === JSON.stringify({ methods: ['whatsapp', 'email'] }), JSON.stringify(changed));

    // Wissen: terug naar het blad bij de volgende tik.
    const reopened = await clickUntil(cdp, clickSettingsJs(), SHEET_OPEN);
    const cleared = await clickUntil(cdp, clickSheetButtonJs('Wissen'), SHEET_CLOSED);
    const afterClear = await evalJs(cdp, PREFERENCE_READ);
    check(`instellingen (${label}): "Wissen" haalt de voorkeur weg`, reopened.observed && cleared.observed && afterClear === null, JSON.stringify(afterClear));
    const shareAgain = await clickUntil(cdp, clickShareJs(), SHEET_OPEN);
    const firstSheet = await evalJs(cdp, readPanelJs('.share-sheet'));
    check(`instellingen (${label}): daarna opent weer "Hoe deel je meestal?"`, shareAgain.observed && firstSheet.title === 'Hoe deel je meestal?', firstSheet.title);
    await pressKey(cdp, 'Escape', 'Escape', 27);
    await waitFor(cdp, SHEET_CLOSED, 5000);
  }
}


// ── Uitvoering ──────────────────────────────────────────────────────────────
async function main() {
  const outcome = scenarioSelectionOutcome({ selection: SELECTION, entries: SCENARIOS, scriptName: 'run-be49-browser-check.js' });
  if (outcome.stop) {
    process.exitCode = outcome.exitCode;
    return;
  }

  const browserPath = findBrowser();
  if (!browserPath) throw new Error('browser_unavailable: set BROWSER_PATH to an installed Edge/Chrome');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  let server = null;
  let browser = null;
  let cdp = null;
  let scenarioRuns = [];

  try {
    server = await startServer({ port: PORT, appUrl: APP, outputDir: OUT_DIR, readyPath: `/menu/${MENU_ID}` });
    browser = await startBrowser(browserPath);
    cdp = new CdpClient(browser.target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    scenarioRuns = await runScenarioSelection({ entries: SCENARIOS, checks, cdp, filter: SELECTION.filter });

    const failed = checks.filter((entry) => entry.passed === false);
    let head = null;
    try {
      head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    } catch (error) {
      head = null;
    }
    const record = {
      generatedAt: new Date().toISOString(),
      ticket: '#115 BE-49 — rustiger gerechtkaart en snel delen',
      category: 'developer evidence — local build, no production data or credentials',
      head,
      app: APP,
      filter: SELECTION.filter,
      scenarios: scenarioRuns,
      checks: { total: checks.length, failed: failed.length, entries: checks },
      screenshots: shots,
      fixture: {
        menu: MENU_ID,
        dish: DISH_ID,
        name: DISH_NAME,
        category: DISH_CATEGORY,
        restaurant: RESTAURANT_NAME,
        deepLink: DEEP_LINK,
        preferenceKey: SHARE_PREFERENCE_KEY,
      },
      gaps: [
        'Het systeemdeelmenu is van de telefoon: navigator.share is hier een stub die de payload vastlegt, geen echte share-sheet.',
        'Het klembord is een stub: de check bewijst welke link gekopieerd wordt en dat de melding verschijnt, niet het echte systeemklembord.',
        'Een klik op een deellink (WhatsApp, Telegram, Sms, E-mail) wordt in de check tegengehouden en vastgelegd; er is geen echt WhatsApp, Telegram, sms- of mailprogramma geopend.',
        'De voorkeur is localStorage in een tijdelijk browserprofiel: de check bewijst lezen, schrijven, wijzigen en wissen, geen privémodus of volle schijf.',
        'De goedgekeurde mockup is een extern Claude-artifact: de opnamen in evidence/be-49/ zijn bedoeld voor de visuele vergelijking door de Lead of eigenaar, niet automatisch vergeleken.',
        'Dit is developer-evidence op een lokale build: geen productie, geen Supabase-credentials, geen merge of publicatie.',
        'De app-brede AI-activering valt buiten deze opdracht; er is hier niets aan AI of Supabase geactiveerd.',
      ],
      result: failed.length === 0 ? 'passed' : 'failed',
    };
    const outPath = filteredEvidencePath(BASE_EVIDENCE_PATH, SELECTION.filter);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`);
    console.log(JSON.stringify({ result: record.result, checks: checks.length, failed: failed.length, screenshots: shots.length, evidence: outPath }, null, 2));
    if (failed.length > 0) process.exitCode = 1;
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

