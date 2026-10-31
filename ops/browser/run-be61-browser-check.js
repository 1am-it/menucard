'use strict';

// BE-61 (#152) — browsercheck voor het deelblad "Delen via", variant A: in
// licht en donker op 1280, 390 en 320 px.
//
// Fixture-bewijs: een echte browser via CDP en de echte pagina, met een verse
// productieopbouw (`next build` + `next start`, de BE-57-opzet). Geen
// Supabase-project, geen productiesleutel, geen productiedata.
//
// Wat bewezen wordt (met het paneel open):
//  - "Opslaan" staat volledig in beeld en is met de muis te raken
//    (`elementFromPoint` in het midden geeft de knop zelf);
//  - geen horizontale overloop;
//  - op 390 en 320 px ligt het paneel boven de tabbalk;
//  - de vorm uit het ontwerp: greepje van 36 × 4 px, sluitknop van 44 × 44 px
//    met `aria-label="Sluiten"`, twee echte radios in één fieldset, vijf regels
//    van 56 px met een icoon van 36 px, "n van 3 gekozen", "Opslaan" van 52 px
//    en geen "Annuleren" meer;
//  - het thema van elke opname is aangetoond, niet aangenomen: vóór de opname
//    gaat het thema via de themaknop van de app zelf en legt themeProof
//    `data-theme`, de actieve knop en de helderheid van `--bg` vast;
//  - de volgorde van kiezen: 1-2-3 in de lijst, "3 van 3 gekozen", de andere
//    regels uit, de hint over 3 favorieten, en het telefoonmenu dat de lijst
//    uitschakelt en dimt.
//
// Niet bewezen hier: de opslag zelf en de keuze van het gedrag (zie
// src/lib/sharePreference.test.js). Dit is ontwikkelaarsbewijs, geen
// onafhankelijke review en geen productieacceptatie.
//
// Gebruik: node ops/browser/run-be61-browser-check.js [--alleen=<scenario>] [--lijst]
// Poort: BE61_PORT of 3188 (binnen 3180-3189). Draai deze check alleen.

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
const {
  THEME_LABELS,
  themeProofScript,
  clickThemeScript,
  themeProofValue,
  themeOk,
} = require('./lib/theme-proof');
const { contrastRatio } = require('./lib/a11y-audit');

const SCRIPT_NAME = 'run-be61-browser-check.js';
const PORT = Number(process.env.BE61_PORT || 3188);
const APP = `http://localhost:${PORT}`;
const APP_ORIGINS = defaultAppOrigins(PORT);
const OUT_DIR = path.join(__dirname, 'output', 'be-61');
const EVIDENCE_DIR = path.join(__dirname, 'evidence');
const BASE_EVIDENCE_PATH = path.join(EVIDENCE_DIR, 'be61-browser-evidence.json');
const SHOT_DIR = path.join(EVIDENCE_DIR, 'be-61');
// De pagina met de kop, de themaknop en de vaste tabbalk, zonder
// restaurantgegevens: /mijn-lijstje leest alleen localStorage.
const PAGE = '/mijn-lijstje';

const SIZES = [
  { name: '1280', width: 1280, height: 900 },
  { name: '390', width: 390, height: 844 },
  { name: '320', width: 320, height: 720 },
];

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
  await waitFor(cdp, `window.innerWidth === ${width}`, 8000);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function shot(cdp, name, meta = {}) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  // Een volledige viewport, geen uitsnede: het paneel en de vaste tabbalk
  // moeten samen op de opname staan.
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

/**
 * Het thema zetten via de themaknop van de app zelf (BE-46 deel 2, BE-57): een
 * klik op "Licht" of "Donker", geen los attribuut en geen schrijfactie in de
 * opslag. Geeft het bewijs terug waarmee de opname wordt gecontroleerd.
 */
async function applyTheme(cdp, theme) {
  const label = THEME_LABELS[theme];
  const klaar = await waitFor(cdp, `document.querySelectorAll('.theme-btn').length === 2`, 15000);
  if (!klaar) throw new Error(`theme_button_missing: ${label}`);
  // De knop staat al in de server-HTML, dus een klik telt pas als het thema
  // daarna echt aangetoond is. Enkele pogingen dekken de hydratatie.
  for (let poging = 0; poging < 4; poging += 1) {
    const clicked = await evalJs(cdp, clickThemeScript(label));
    if (clicked !== 'clicked') throw new Error(`theme_button_missing: ${label}`);
    await sleep(300);
    const proof = await themeProof(cdp);
    if (themeOk(proof, theme)) return proof;
  }
  throw new Error(`theme_not_applied: ${label}`);
}

// Het paneel openen zoals een bezoeker dat doet: een klik op "Delen via". De
// knop bestaat al vóór de hydratatie, dus een klik die niets opent wordt
// herhaald in plaats van meteen te falen.
async function openPanel(cdp) {
  const geopend = await waitFor(cdp, `Boolean(document.querySelector('.share-settings-btn'))`, 15000);
  if (!geopend) throw new Error('settings_button_missing');
  for (let poging = 0; poging < 4; poging += 1) {
    await evalJs(cdp, `(() => { const button = document.querySelector('.share-settings-btn'); button.click(); return true; })()`);
    const open = await waitFor(cdp, `Boolean(document.querySelector('.share-sheet'))`, 4000);
    if (open) {
      await sleep(180);
      return;
    }
    await sleep(400);
  }
  throw new Error('panel_not_open');
}


// De meting met het paneel open. Alles wat het ontwerp belooft wordt hier
// gemeten, niet aangenomen.
const PANEL_STATE = `(() => {
  const panel = document.querySelector('.share-sheet');
  if (!panel) return { open: false };
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      top: Math.round(r.top), bottom: Math.round(r.bottom),
      left: Math.round(r.left), right: Math.round(r.right),
      width: Math.round(r.width), height: Math.round(r.height),
    };
  };
  const tekst = (el) => (el ? (el.innerText || '').replace(/\\s+/g, ' ').trim() : '');
  const save = panel.querySelector('button[type="submit"]');
  const saveBox = box(save);
  const midden = saveBox ? { x: Math.floor((saveBox.left + saveBox.right) / 2), y: Math.floor((saveBox.top + saveBox.bottom) / 2) } : null;
  const top = midden ? document.elementFromPoint(midden.x, midden.y) : null;
  const tabbar = document.querySelector('.mobile-tabbar');
  const tabbarBox = box(tabbar);
  const tabbarZichtbaar = Boolean(tabbarBox && tabbarBox.width > 0 && tabbarBox.height > 0);
  const punten = tabbarZichtbaar
    ? [0.2, 0.5, 0.8].map((deel) => {
        const x = Math.round(window.innerWidth * deel);
        const y = Math.round((tabbarBox.top + tabbarBox.bottom) / 2);
        const el = document.elementFromPoint(x, y);
        return { x, y, inPaneel: Boolean(el && (el === panel || panel.contains(el))) };
      })
    : [];
  const rows = [...panel.querySelectorAll('.share-fav-row')];
  const radios = [...panel.querySelectorAll('.share-segment input[type="radio"]')];
  const segment = panel.querySelector('.share-segment');
  const active = panel.querySelector('.share-segment-option.is-active');
  const inactief = [...panel.querySelectorAll('.share-segment-option')].find((el) => el !== active) || null;
  return {
    open: true,
    role: panel.getAttribute('role'),
    modal: panel.getAttribute('aria-modal'),
    label: panel.getAttribute('aria-labelledby') ? tekst(document.getElementById(panel.getAttribute('aria-labelledby'))) : '',
    hint: panel.getAttribute('aria-describedby') ? tekst(document.getElementById(panel.getAttribute('aria-describedby'))) : '',
    panel: box(panel),
    layer: box(panel.closest('.share-layer')),
    grabber: box(panel.querySelector('.share-grabber')),
    close: box(panel.querySelector('.share-close')),
    closeLabel: panel.querySelector('.share-close') ? panel.querySelector('.share-close').getAttribute('aria-label') : null,
    save: saveBox,
    saveTekst: tekst(save),
    saveDisabled: save ? save.disabled : null,
    saveKleur: save ? getComputedStyle(save).backgroundColor : '',
    saveTekstKleur: save ? getComputedStyle(save).color : '',
    saveTop: top ? { tag: top.tagName, cls: String(top.className || ''), isSave: Boolean(top === save || save.contains(top)) } : null,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    tabbar: tabbarBox,
    tabbarZichtbaar,
    tabbarPunten: punten,
    legende: segment && segment.querySelector('legend') ? tekst(segment.querySelector('legend')) : '',
    radios: radios.map((input) => ({ value: input.value, checked: input.checked, type: input.type })),
    actief: tekst(active),
    actiefAchtergrond: active ? getComputedStyle(active).backgroundColor : '',
    actiefTekstKleur: active ? getComputedStyle(active).color : '',
    actiefRandKleur: active ? getComputedStyle(active).borderTopColor : '',
    houderAchtergrond: segment ? getComputedStyle(segment).backgroundColor : '',
    inactiefAchtergrond: inactief ? getComputedStyle(inactief).backgroundColor : '',
    lijstTitel: tekst(panel.querySelector('.share-fav-title')),
    teller: tekst(panel.querySelector('.share-fav-count')),
    rijen: rows.length,
    rijHoogtes: rows.map((row) => Math.round(row.getBoundingClientRect().height)),
    iconen: rows.map((row) => box(row.querySelector('.share-fav-icon-box'))),
    labels: rows.map((row) => tekst(row.querySelector('.share-option-label'))),
    merkjes: rows.map((row) => tekst(row.querySelector('.share-fav-mark'))),
    gekozen: rows.map((row) => Boolean(row.querySelector('.share-fav-input') && row.querySelector('.share-fav-input').checked)),
    uitgeschakeld: rows.map((row) => {
      const input = row.querySelector('.share-fav-input');
      // Een uitgezette fieldset schakelt zijn invoervelden uit; de eigenschap
      // disabled ziet alleen het eigen attribuut, het :disabled-pseudoklasse
      // van de browser ziet ook de fieldset.
      return Boolean(input && (input.disabled || input.matches(':disabled')));
    }),
    lijstGedimd: (() => {
      const lijst = panel.querySelector('.share-options');
      return lijst ? Number(getComputedStyle(lijst).opacity) : null;
    })(),
    wissen: Boolean(panel.querySelector('.share-clear')),
    wissenKleur: panel.querySelector('.share-clear') ? getComputedStyle(panel.querySelector('.share-clear')).color : '',
    knoppen: [...panel.querySelectorAll('button')].map((button) => tekst(button)),
    focus: document.activeElement ? String(document.activeElement.className || document.activeElement.tagName) : '',
  };
})()`;

const readPanel = (cdp) => evalJs(cdp, PANEL_STATE);

// Een echt invoerpunt: een klik op de regel van een deelmanier, zoals een
// bezoeker die geeft.
const clickMethod = (value) => `(() => {
  const input = document.querySelector('.share-sheet input[value=' + JSON.stringify(${JSON.stringify(value)}) + ']');
  if (!input) return false;
  input.click();
  return true;
})()`;

const clickPhone = `(() => {
  const input = document.querySelector('.share-sheet input[value="telefoonmenu"]');
  if (!input) return false;
  input.click();
  return true;
})()`;

const clickFavorites = `(() => {
  const input = document.querySelector('.share-sheet input[value="favorieten"]');
  if (!input) return false;
  input.click();
  return true;
})()`;

const inBeeld = (rect) =>
  Boolean(rect) &&
  rect.top >= -1 &&
  rect.left >= -1 &&
  rect.bottom <= viewport.height + 1 &&
  rect.right <= viewport.width + 1;

async function panelScenario(cdp) {
  for (const theme of ['light', 'dark']) {
    for (const size of SIZES) {
      const waar = `${theme}/${size.name}`;
      await setViewport(cdp, size.width, size.height);
      await navigate(cdp, `${APP}${PAGE}`, `Boolean(document.querySelector('.share-settings-btn'))`);
      // Het thema en zijn bewijs vóór het openen: het paneel dekt de
      // themaknop daarna af.
      const proof = await applyTheme(cdp, theme);
      await openPanel(cdp);
      const staat = await readPanel(cdp);

      check(`paneel ${waar}: het thema is aangetoond (data-theme, actieve knop, --bg-helderheid)`,
        themeOk(proof, theme), JSON.stringify(proof));
      check(`paneel ${waar}: het is een echt dialoogvenster met een naam en een hint`,
        staat.role === 'dialog' && staat.modal === 'true' && staat.label.length > 0 && staat.hint.length > 0,
        JSON.stringify({ role: staat.role, modal: staat.modal, label: staat.label, hint: staat.hint }));
      check(`paneel ${waar}: het paneel staat in beeld`, inBeeld(staat.panel), JSON.stringify(staat.panel));
      check(`paneel ${waar}: geen horizontale overloop`, staat.overflow <= 0, staat.overflow);
      check(`paneel ${waar}: een greepje van 36 × 4 px bovenaan`,
        Boolean(staat.grabber) && staat.grabber.width === 36 && staat.grabber.height === 4,
        JSON.stringify(staat.grabber));
      check(`paneel ${waar}: een ronde sluitknop van 44 × 44 px met aria-label "Sluiten"`,
        Boolean(staat.close) && staat.close.width === 44 && staat.close.height === 44 && staat.closeLabel === 'Sluiten',
        JSON.stringify({ box: staat.close, label: staat.closeLabel }));
      check(`paneel ${waar}: de schakelaar is één radiogroep met een verborgen legend`,
        staat.radios.length === 2 && staat.radios.every((radio) => radio.type === 'radio') && staat.legende === 'Hoe wil je delen?'
          && staat.radios.map((radio) => radio.value).join(',') === 'favorieten,telefoonmenu'
          && staat.radios[0].checked === true && staat.radios[1].checked === false,
        JSON.stringify({ radios: staat.radios, legende: staat.legende }));
      check(`paneel ${waar}: de actieve stand heeft een eigen achtergrond`,
        staat.actief === 'Mijn favorieten' && staat.actiefAchtergrond !== staat.inactiefAchtergrond,
        JSON.stringify({ actief: staat.actief, actiefAchtergrond: staat.actiefAchtergrond, inactief: staat.inactiefAchtergrond }));
      // BE-61 review (#152, punt 2): het actieve deel moet in beide thema's
      // duidelijk van de houder te onderscheiden zijn: minstens 3:1. Dat mag via
      // de vulling (donker) of via de rand (licht); beide worden gemeten.
      {
        const vulling = contrastRatio(staat.actiefAchtergrond, staat.houderAchtergrond);
        const rand = contrastRatio(staat.actiefRandKleur, staat.houderAchtergrond);
        const beste = Math.max(Number(vulling) || 0, Number(rand) || 0);
        check(`paneel ${waar}: het actieve deel wijkt minstens 3:1 af van de houder`,
          beste >= 3,
          JSON.stringify({ beste, vulling, rand, actief: staat.actiefAchtergrond, randKleur: staat.actiefRandKleur, houder: staat.houderAchtergrond, tekst: staat.actiefTekstKleur }));
      }
      check(`paneel ${waar}: "Favorieten" links en "0 van 3 gekozen" rechts`,
        staat.lijstTitel === 'Favorieten' && staat.teller === '0 van 3 gekozen',
        JSON.stringify({ titel: staat.lijstTitel, teller: staat.teller }));
      check(`paneel ${waar}: vijf regels van minstens 56 px met een icoon van 36 px`,
        staat.rijen === 5 && staat.rijHoogtes.every((hoogte) => hoogte >= 56)
          && staat.iconen.every((icoon) => icoon && icoon.width === 36 && icoon.height === 36)
          && staat.labels.join(',') === 'WhatsApp,Link kopiëren,Sms,Telegram,E-mail',
        JSON.stringify({ hoogtes: staat.rijHoogtes, iconen: staat.iconen, labels: staat.labels }));
      check(`paneel ${waar}: nog niets gekozen, dus "Opslaan" staat uit`,
        staat.saveDisabled === true && staat.merkjes.every((merkje) => merkje === ''),
        JSON.stringify({ disabled: staat.saveDisabled, merkjes: staat.merkjes }));
      check(`paneel ${waar}: de knop "Opslaan" is 52 px hoog en staat volledig in beeld`,
        Boolean(staat.save) && staat.save.height === 52 && inBeeld(staat.save),
        JSON.stringify(staat.save));
      check(`paneel ${waar}: elementFromPoint in het midden van "Opslaan" geeft de knop zelf`,
        Boolean(staat.saveTop) && staat.saveTop.isSave === true, JSON.stringify(staat.saveTop));
      check(`paneel ${waar}: "Wissen" staat er als tekstlink, "Annuleren" niet meer`,
        staat.wissen === true && !staat.knoppen.includes('Annuleren') && staat.knoppen.includes('Opslaan'),
        JSON.stringify(staat.knoppen));
      if (size.width < 600) {
        check(`paneel ${waar}: het paneel ligt boven de tabbalk`,
          staat.tabbarZichtbaar === true && staat.panel.bottom >= staat.tabbar.top
            && staat.tabbarPunten.length === 3 && staat.tabbarPunten.every((punt) => punt.inPaneel),
          JSON.stringify({ paneel: staat.panel, tabbalk: staat.tabbar, punten: staat.tabbarPunten }));
      }
      await shot(cdp, `be61-paneel-${size.name}-${theme}.png`, { theme, state: 'paneel-open', themeProof: proof });
    }
  }

  const zonderBewijs = shots.filter((opname) => !themeOk(opname.themeProof, opname.theme));
  check('thema: elke opname heeft een kloppend themabewijs', zonderBewijs.length === 0 && shots.length === 6,
    `${shots.length - zonderBewijs.length}/${shots.length} opnamen: ${zonderBewijs.map((opname) => opname.file).join(',')}`);
}


/**
 * De volgorde van kiezen: eerst Sms, dan WhatsApp, dan E-mail. De merkjes
 * moeten dan 2-1-3 zijn (in de volgorde van de lijst) en de teller "3 van 3
 * gekozen". Daarna schakelt het telefoonmenu de lijst uit en dimt hem.
 */
async function kiezenScenario(cdp) {
  await setViewport(cdp, 390, 844);
  await navigate(cdp, `${APP}${PAGE}`, `Boolean(document.querySelector('.share-settings-btn'))`);
  const proof = await applyTheme(cdp, 'light');
  await openPanel(cdp);

  for (const value of ['sms', 'whatsapp', 'email']) {
    const clicked = await evalJs(cdp, clickMethod(value));
    check(`kiezen: de regel ${value} is aan te klikken`, clicked === true, clicked);
    await sleep(120);
  }
  const gekozen = await readPanel(cdp);
  check('kiezen: de merkjes volgen de volgorde van kiezen (WhatsApp 2, Sms 1, E-mail 3)',
    gekozen.merkjes.join('|') === '2||1||3', gekozen.merkjes.join('|'));
  check('kiezen: de teller zegt "3 van 3 gekozen"', gekozen.teller === '3 van 3 gekozen', gekozen.teller);
  check('kiezen: de hint zegt dat er 3 gekozen zijn', /3 favorieten gekozen/.test(gekozen.hint), gekozen.hint);
  check('kiezen: de twee andere regels staan uit, de gekozen niet',
    gekozen.uitgeschakeld.join('|') === 'false|true|false|true|false', gekozen.uitgeschakeld.join('|'));
  check('kiezen: met een keuze staat "Opslaan" aan', gekozen.saveDisabled === false, gekozen.saveDisabled);
  check('kiezen: de gekozen regels zijn herkenbaar opgemaakt',
    gekozen.gekozen.filter(Boolean).length === 3 && gekozen.merkjes.filter(Boolean).length === 3,
    JSON.stringify(gekozen.gekozen));
  await shot(cdp, 'be61-kiezen-390-light.png', { theme: 'light', state: 'drie-gekozen', themeProof: proof });

  // Het telefoonmenu: dezelfde keuze, maar de lijst gaat uit en dimt.
  await evalJs(cdp, clickPhone);
  await sleep(140);
  const telefoon = await readPanel(cdp);
  check('telefoonmenu: de schakelaar staat op "Telefoonmenu"',
    telefoon.radios[1].checked === true && telefoon.radios[0].checked === false && telefoon.actief === 'Telefoonmenu',
    JSON.stringify(telefoon.radios));
  check('telefoonmenu: de hele lijst is uitgeschakeld en gedimd',
    telefoon.uitgeschakeld.every(Boolean) && telefoon.lijstGedimd !== null && telefoon.lijstGedimd < 1,
    JSON.stringify({ uit: telefoon.uitgeschakeld, opacity: telefoon.lijstGedimd }));
  check('telefoonmenu: de hint gaat over het deelmenu van de telefoon',
    telefoon.hint === 'Je deelt altijd via het deelmenu van je telefoon.', telefoon.hint);
  check('telefoonmenu: "Opslaan" blijft bruikbaar', telefoon.saveDisabled === false, telefoon.saveDisabled);
  await shot(cdp, 'be61-telefoonmenu-390-light.png', { theme: 'light', state: 'telefoonmenu', themeProof: proof });

  // Terug naar de favorieten: de gekozen volgorde blijft bewaard.
  await evalJs(cdp, clickFavorites);
  await sleep(140);
  const terug = await readPanel(cdp);
  check('terug naar de favorieten: de volgorde van kiezen blijft bewaard',
    terug.merkjes.join('|') === '2||1||3' && terug.actief === 'Mijn favorieten',
    `${terug.merkjes.join('|')} / ${terug.actief}`);
}


/**
 * Sluiten en opslaan: het kruisje, Esc en een tik naast het paneel sluiten
 * het; "Opslaan" bewaart de keuze in localStorage en sluit het paneel.
 */
async function sluitenScenario(cdp) {
  await setViewport(cdp, 390, 844);
  await navigate(cdp, `${APP}${PAGE}`, `Boolean(document.querySelector('.share-settings-btn'))`);
  await evalJs(cdp, `(() => { try { localStorage.removeItem('deelvoorkeur'); } catch (error) { return false; } return true; })()`);
  const proof = await applyTheme(cdp, 'light');

  await openPanel(cdp);
  const focusBijOpen = await evalJs(cdp, 'String(document.activeElement.className || document.activeElement.tagName)');
  check('toetsenbord: de focus staat bij openen in het paneel', /share-(close|fav|segment)/.test(focusBijOpen), focusBijOpen);

  await evalJs(cdp, clickMethod('sms'));
  await sleep(120);
  await evalJs(cdp, clickMethod('whatsapp'));
  await sleep(120);
  await evalJs(cdp, `(() => { document.querySelector('.share-sheet button[type="submit"]').click(); return true; })()`);
  const dicht = await waitFor(cdp, `!document.querySelector('.share-sheet')`, 8000);
  const bewaard = await evalJs(cdp, `(() => { try { return localStorage.getItem('deelvoorkeur'); } catch (error) { return null; } })()`);
  check('opslaan: het paneel sluit en de voorkeur staat in localStorage',
    dicht === true && typeof bewaard === 'string' && bewaard.includes('sms') && bewaard.includes('whatsapp'),
    String(bewaard));

  await openPanel(cdp);
  await evalJs(cdp, `(() => { document.querySelector('.share-close').click(); return true; })()`);
  const dichtMetKruisje = await waitFor(cdp, `!document.querySelector('.share-sheet')`, 8000);
  check('sluiten: het kruisje sluit het paneel', dichtMetKruisje === true, dichtMetKruisje);

  await openPanel(cdp);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  const dichtMetEsc = await waitFor(cdp, `!document.querySelector('.share-sheet')`, 8000);
  check('sluiten: Esc sluit het paneel', dichtMetEsc === true, dichtMetEsc);

  await openPanel(cdp);
  const punt = await evalJs(cdp, `(() => {
    const layer = document.querySelector('.share-layer');
    const r = layer.getBoundingClientRect();
    return { x: Math.round(r.left + 6), y: Math.round(r.top + 6) };
  })()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: punt.x, y: punt.y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: punt.x, y: punt.y, button: 'left', clickCount: 1 });
  const dichtMetTik = await waitFor(cdp, `!document.querySelector('.share-sheet')`, 8000);
  check('sluiten: een tik naast het paneel sluit het', dichtMetTik === true, dichtMetTik);
  check('sluiten: het thema bleef aangetoond tijdens deze reeks', themeOk(proof, 'light'), JSON.stringify(proof));
}

const SCENARIOS = [
  { name: 'paneel', run: (cdp) => panelScenario(cdp) },
  { name: 'kiezen', run: (cdp) => kiezenScenario(cdp) },
  { name: 'sluiten', run: (cdp) => sluitenScenario(cdp) },
];

const SELECTION = parseScenarioArgs(process.argv.slice(2), SCENARIOS);

function evidencePath() {
  // Een gefilterde run schrijft naar een eigen bestand dat git negeert
  // (ops/browser/evidence/*.filtered.json); alleen de volledige run vervangt
  // het bewijs dat bij de levering hoort.
  return SELECTION.filter
    ? path.join(EVIDENCE_DIR, 'be61-browser-evidence.filtered.json')
    : BASE_EVIDENCE_PATH;
}

function writeEvidence(extra = {}) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const failed = checks.filter((entry) => !entry.passed);
  const record = {
    script: SCRIPT_NAME,
    kind: 'fixture_browser_evidence',
    category: `lokale browsercheck op een verse productieopbouw (next build + next start op poort ${PORT}); geen productie en geen echte acceptatie`,
    startedAt: new Date().toISOString(),
    port: PORT,
    page: PAGE,
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


async function main() {
  const outcome = scenarioSelectionOutcome({ selection: SELECTION, entries: SCENARIOS, scriptName: SCRIPT_NAME });
  if (outcome.stop) {
    process.exitCode = outcome.exitCode;
    return;
  }

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
    // De BE-57-opzet: een verse productieopbouw en `next start`, zodat er geen
    // HMR-herlaadbeurt midden in een meting valt. Deze check draait daarom
    // alleen (geen tweede browsercheck tegelijk).
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

