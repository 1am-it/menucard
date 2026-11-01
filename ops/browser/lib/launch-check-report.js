'use strict';

// BE-70 (#173) — het oordeel en het rapport van de lanceringscheck.
//
// De browser levert alleen metingen; hier vallen de beslissingen. Zo kan
// `node --test` de grenzen en het rapport controleren zonder browser of server
// (ops/browser/launchCheck.test.js), en kan een rood punt niet stil groen
// worden door een typefout in het oordeel.
//
// De grenzen komen uit het goedgekeurde contract van #173, uitkomst 2:
//  - laadgrootte: 250 kB werkelijk overgedragen bytes bij de eerste lading;
//  - geen afbeeldingen bij de eerste lading, behalve het logo en de iconen;
//  - geen horizontale overloop;
//  - tikdoelen minstens 24 px, de hoofdknoppen minstens 44 px;
//  - precies één h1 en geen overgeslagen kopniveau;
//  - de eerste Tab gaat naar een zichtbare focus;
//  - de a11y-audit met 0 fouten.

const BUDGET_KB = 250;
const MIN_TARGET = 24;
const MAIN_BUTTON = 44;

// Alleen het logo en de iconen mogen als afbeelding worden opgehaald. Het gaat
// om de bestandsnaam, niet om de map: `/icons/logo.svg` en `/logo.png` tellen
// allebei, een gerechtfoto (`/photos/poussin.jpg`) niet.
const ALLOWED_IMAGE_NAME = /(logo|wordmark|favicon|icon)/i;
const IMAGE_EXTENSION = /\.(png|svg|webp|jpe?g|gif|ico|avif)$/i;

const CONTROLS = [
  { key: 'load', label: 'laadgrootte', column: 'Laadgrootte (kB)' },
  { key: 'images', label: 'afbeeldingen', column: 'Afbeeldingen' },
  { key: 'overflow', label: 'overloop', column: 'Overloop' },
  { key: 'targets', label: 'tikdoelen', column: 'Tikdoelen' },
  { key: 'mainButtons', label: 'hoofdknoppen', column: 'Hoofdknoppen' },
  { key: 'headings', label: 'koppen', column: 'Koppen' },
  { key: 'keyboard', label: 'toetsenbord', column: 'Toetsenbord' },
  { key: 'a11y', label: 'a11y', column: 'a11y' },
];

/** Alleen het pad van een URL, zodat het bewijs geen host of query herhaalt. */
function pathOf(url) {
  const value = String(url || '');
  if (!value) return '';
  try {
    return new URL(value).pathname;
  } catch (error) {
    return value.slice(0, 120);
  }
}

/**
 * De zwaarste antwoorden van één eerste lading, aflopend op bytes. Dit is de
 * onderbouwing van "waar de bytes zaten" in het rapport; het bewijs bewaart
 * alleen het pad en het type, geen host en geen query.
 */
function topResponses(perRequest, limit = 8) {
  const list = Array.isArray(perRequest) ? perRequest : [];
  const grens = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : 8;
  return list
    .map((entry) => {
      const bytes = Number(entry && entry.bytes);
      return {
        type: String((entry && entry.type) || 'Other'),
        path: pathOf(entry && entry.url),
        bytes: Number.isFinite(bytes) && bytes > 0 ? bytes : 0,
      };
    })
    .filter((entry) => entry.bytes > 0)
    .sort((left, right) => right.bytes - left.bytes)
    .slice(0, grens)
    .map((entry) => ({ type: entry.type, path: entry.path, bytes: entry.bytes, kb: roundKb(entry.bytes) }));
}

/** Bytes naar kB met één decimaal; onbruikbare waarden worden 0. */
function roundKb(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round((value / 1024) * 10) / 10;
}

/** Het logo en de iconen zijn de enige toegestane afbeeldingen. */
function imageAllowed(url) {
  const zonderQuery = String(url || '').split(/[?#]/)[0];
  const bestand = zonderQuery.slice(zonderQuery.lastIndexOf('/') + 1);
  if (!bestand || !IMAGE_EXTENSION.test(bestand)) return false;
  return ALLOWED_IMAGE_NAME.test(bestand);
}

// ─── De acht controles, elk als gewone functie ───────────────────────────────

function loadVerdict(kb, budgetKb = BUDGET_KB) {
  const value = Number(kb);
  const passed = Number.isFinite(value) && value >= 0 && value <= budgetKb;
  return { passed, kb: Number.isFinite(value) ? value : null, budgetKb, detail: `${value} kB van ${budgetKb} kB` };
}

function imageVerdict(urls) {
  const list = Array.isArray(urls) ? urls.map(String) : [];
  const offending = list.filter((url) => !imageAllowed(url));
  return {
    passed: offending.length === 0,
    total: list.length,
    allowed: list.filter((url) => imageAllowed(url)),
    offending,
    detail: offending.length === 0 ? `${list.length} afbeeldingen, alleen logo en iconen` : `${offending.length} onverwachte afbeeldingen`,
  };
}

function overflowVerdict(overflow) {
  const gemeten = overflow === null || overflow === undefined || overflow === '';
  const value = gemeten ? NaN : Number(overflow);
  const passed = Number.isFinite(value) ? value <= 0 : false;
  return { passed, value: Number.isFinite(value) ? value : null, detail: Number.isFinite(value) ? `${value} px overloop` : 'geen meting' };
}

/** Elk tikdoel minstens 24 px; tekstlinks binnen een zin tellen niet mee. */
function targetVerdict(targets, minTarget = MIN_TARGET) {
  const list = Array.isArray(targets) ? targets : [];
  const tooSmall = list
    .filter((entry) => !entry.inlineInText)
    .filter((entry) => Number(entry.width) < minTarget || Number(entry.height) < minTarget)
    .map((entry) => ({ selector: entry.selector || null, name: entry.name || null, width: entry.width, height: entry.height }));
  return {
    passed: tooSmall.length === 0,
    total: list.length,
    tooSmall,
    detail: `${list.length} doelen, ${tooSmall.length} onder ${minTarget} px`,
  };
}

/** De hoofdknoppen van de pagina: minstens 44 px hoog én breed. */
function mainButtonVerdict(buttons, minSize = MAIN_BUTTON) {
  const list = Array.isArray(buttons) ? buttons : [];
  const small = list
    .filter((entry) => Number(entry.width) < minSize || Number(entry.height) < minSize)
    .map((entry) => ({ selector: entry.selector || null, text: entry.text || null, width: entry.width, height: entry.height }));
  return {
    passed: small.length === 0,
    total: list.length,
    small,
    detail: list.length === 0 ? 'geen hoofdknoppen op deze pagina' : `${list.length} hoofdknoppen, ${small.length} onder ${minSize} px`,
  };
}

/** Precies één h1 en geen niveau overgeslagen (h1 → h3 is een sprong). */
function headingVerdict(headings) {
  const list = (Array.isArray(headings) ? headings : [])
    .filter((heading) => Number.isFinite(Number(heading.level)))
    .map((heading) => ({ level: Number(heading.level), text: String(heading.text || '') }));
  const h1 = list.filter((heading) => heading.level === 1);
  const jumps = [];
  let previous = 0;
  for (const heading of list) {
    if (previous > 0 && heading.level > previous + 1) jumps.push(`h${previous} → h${heading.level} bij "${heading.text}"`);
    previous = heading.level;
  }
  return {
    passed: h1.length === 1 && jumps.length === 0,
    count: list.length,
    h1Count: h1.length,
    h1: h1.length > 0 ? h1[0].text : null,
    jumps,
    detail: `${h1.length} h1 bij ${list.length} koppen${jumps.length === 0 ? '' : `; ${jumps.length} sprongen`}`,
  };
}

/** De eerste Tab moet op een zichtbaar focusdoel landen. */
function keyboardVerdict(step) {
  const value = step && typeof step === 'object' ? step : {};
  const visible = Boolean(value.indicator && value.indicator.visible);
  const passed = value.done === false && value.inPage === true && visible;
  return {
    passed,
    selector: value.selector || null,
    name: value.name || null,
    indicator: value.indicator || null,
    detail: passed ? `${value.selector} met zichtbare focus` : `geen zichtbare focus (${value.selector || 'geen doel'})`,
  };
}

function a11yVerdict(errors) {
  const list = Array.isArray(errors) ? errors : [];
  return {
    passed: list.length === 0,
    errors: list.map((error) => ({
      criterion: error.criterion || null,
      reason: error.reason || null,
      name: error.name || null,
      detail: error.detail === undefined ? null : error.detail,
    })),
    detail: `${list.length} fouten`,
  };
}

/**
 * Eén meting van één pagina, breedte en thema → één rij met de acht controles.
 * De oordelen komen uit de functies hierboven; hier wordt niets zelf bedacht.
 */
function comboRow(measurement) {
  const input = measurement && typeof measurement === 'object' ? measurement : {};
  // De meting levert bytes; een aanroeper mag ook al kB meegeven.
  const kb = input.kb === undefined || input.kb === null ? roundKb(input.bytes) : input.kb;
  const load = loadVerdict(kb, input.budgetKb === undefined ? BUDGET_KB : input.budgetKb);
  const images = imageVerdict(input.imageUrls);
  const overflow = overflowVerdict(input.overflow);
  const targets = targetVerdict(input.targets);
  const mainButtons = mainButtonVerdict(input.mainButtons);
  const headings = headingVerdict(input.headings);
  const keyboard = keyboardVerdict(input.focusStep);
  const a11y = a11yVerdict(input.a11yErrors);
  const controls = { load, images, overflow, targets, mainButtons, headings, keyboard, a11y };
  const red = CONTROLS.filter((control) => controls[control.key].passed !== true).map((control) => control.label);
  return {
    page: input.page || null,
    path: input.path || null,
    viewport: input.viewport || null,
    theme: input.theme || null,
    bytes: Number.isFinite(Number(input.bytes)) ? Number(input.bytes) : 0,
    requests: Number.isFinite(Number(input.requests)) ? Number(input.requests) : 0,
    controls,
    red,
    passed: red.length === 0,
  };
}

/**
 * De pagina samengevat over al zijn metingen: de laadgrootte van de eerste
 * meting (1280 px, licht) en de grootste gemeten waarde ernaast, plus per
 * controle hoeveel metingen rood waren.
 */
function pageSummary(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const page = list.length > 0 ? list[0].page : null;
  const path = list.length > 0 ? list[0].path : null;
  const eerste = list.find((row) => row.viewport === '1280' && row.theme === 'light') || list[0] || null;
  const worst = list.reduce((hoogste, row) => (row.bytes > (hoogste ? hoogste.bytes : -1) ? row : hoogste), null);
  const red = {};
  for (const control of CONTROLS) {
    const aantal = list.filter((row) => row.controls[control.key] && row.controls[control.key].passed !== true).length;
    if (aantal > 0) red[control.key] = aantal;
  }
  return {
    page,
    path,
    combos: list.length,
    loadKb: eerste ? roundKb(eerste.bytes) : null,
    worstLoadKb: worst ? roundKb(worst.bytes) : null,
    requests: eerste ? eerste.requests : null,
    red,
    green: list.length > 0 && Object.keys(red).length === 0,
  };
}

function summaryOf(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const pages = [];
  for (const row of list) {
    if (!pages.includes(row.page)) pages.push(row.page);
  }
  return pages.map((page) => pageSummary(list.filter((row) => row.page === page)));
}

/** Eén cel: groen, of rood met het aantal rode metingen van die controle. */
function cell(summary, control) {
  const aantal = summary.red[control.key];
  return aantal ? `rood (${aantal}/${summary.combos})` : 'groen';
}

/** De eerste concrete redenen bij een rood punt, voor in de samenvatting. */
function reden(verdict) {
  const lijst = [];
  if (Array.isArray(verdict.offending)) lijst.push(...verdict.offending.slice(0, 3));
  if (Array.isArray(verdict.tooSmall)) lijst.push(...verdict.tooSmall.slice(0, 3).map((entry) => `${entry.selector} ${entry.width}×${entry.height}`));
  if (Array.isArray(verdict.small)) lijst.push(...verdict.small.slice(0, 3).map((entry) => `${entry.selector} ${entry.width}×${entry.height}`));
  if (Array.isArray(verdict.jumps)) lijst.push(...verdict.jumps.slice(0, 3));
  if (Array.isArray(verdict.errors)) lijst.push(...verdict.errors.slice(0, 3).map((error) => `${error.criterion}: ${error.reason} (${error.name})`));
  return lijst.length === 0 ? '' : ` — ${lijst.join('; ')}`;
}

/** De korte samenvatting `docs/launch-check.md`, uit dezelfde gegevens als het JSON-bewijs. */
function markdownReport(evidence) {
  const input = evidence && typeof evidence === 'object' ? evidence : {};
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const summaries = summaryOf(rows);
  const rood = rows.filter((row) => !row.passed);
  const regels = [];
  regels.push("# Lanceringscheck publieke pagina's");
  regels.push('');
  regels.push('Automatisch geschreven door `ops/browser/run-launch-check.js` (BE-70, #173).');
  regels.push(`Laatste meting: ${input.ranAt || 'onbekend'} · poort ${input.port || '?'} · bewijs: \`ops/browser/evidence/launch-check.json\`.`);
  regels.push('');
  regels.push('## Wat er gemeten is');
  regels.push('');
  regels.push("Per pagina, in licht en donker op 1280, 390 en 320 px, op een verse lokale productieopbouw (`next build` + `next start`), met een echte browser via CDP en met gestubde API's waar een pagina die nodig heeft. Het thema gaat via de themakeuze in het instellingenpaneel, het paneel is dicht vóór de opname en elke opname heeft een `themeProof` (data-theme, actieve knop en de helderheid van `--bg`).");
  regels.push('');
  regels.push(`- **Laadgrootte:** de werkelijk overgedragen bytes bij de eerste lading, gemeten met CDP \`Network.loadingFinished\` (\`encodedDataLength\`) zonder cache. Budget: ${input.budgetKb || BUDGET_KB} kB per pagina.`);
  regels.push('- **Afbeeldingen:** geen afbeeldingen bij de eerste lading, behalve het logo en de iconen.');
  regels.push('- **Overloop:** geen horizontale overloop (`scrollWidth` ≤ `innerWidth`).');
  regels.push('- **Tikdoelen:** elk doel minstens 24 px; de hoofdknoppen minstens 44 px.');
  regels.push('- **Koppen:** precies één h1 en geen overgeslagen niveau.');
  regels.push('- **Toetsenbord:** de eerste Tab landt op een zichtbare focus.');
  regels.push('- **a11y:** de bestaande audit (`ops/browser/lib/a11y-audit.js`) met 0 fouten.');
  regels.push('');
  regels.push('## Uitslag per pagina');
  regels.push('');
  regels.push(`| Pagina | ${CONTROLS.map((control) => control.column).join(' | ')} | Groen |`);
  regels.push(`| --- | ${CONTROLS.map(() => '---').join(' | ')} | --- |`);
  for (const summary of summaries) {
    const cellen = CONTROLS.map((control) => (control.key === 'load'
      ? `${summary.loadKb} kB (${cell(summary, control)})`
      : cell(summary, control)));
    regels.push(`| \`${summary.path}\` | ${cellen.join(' | ')} | ${summary.green ? 'groen' : 'rood'} |`);
  }
  regels.push('');
  if (rood.length === 0) {
    regels.push("Alle pagina's zijn groen op alle controles.");
  } else {
    regels.push('## Rode punten met de reden');
    regels.push('');
    for (const row of rood) {
      for (const control of CONTROLS) {
        const verdict = row.controls[control.key];
        if (!verdict || verdict.passed === true) continue;
        regels.push(`- \`${row.path}\` · ${row.viewport} px · ${row.theme} · **${control.label}**: ${verdict.detail}${reden(verdict)}`);
      }
    }
  }
  regels.push('');
  regels.push('## Waar de bytes zaten');
  regels.push('');
  const zwaarste = [...rows].sort((left, right) => (Number(right.bytes) || 0) - (Number(left.bytes) || 0)).slice(0, 6);
  if (zwaarste.length === 0) {
    regels.push('Nog geen meting.');
  } else {
    regels.push('De zwaarste eerste ladingen, met de grootste antwoorden van die lading (CDP `Network.loadingFinished` → het pad en het type per respons).');
    regels.push('');
    for (const row of zwaarste) {
      regels.push(`- \`${row.path}\` · ${row.viewport} px · ${row.theme} · ${roundKb(row.bytes)} kB · ${row.requests || 0} aanvragen`);
      const antwoorden = Array.isArray(row.topResponses) ? row.topResponses.slice(0, 5) : [];
      if (antwoorden.length === 0) {
        regels.push(`  - geen antwoorden vastgelegd`);
        continue;
      }
      for (const antwoord of antwoorden) {
        regels.push(`  - ${antwoord.kb} kB · ${antwoord.type} · \`${antwoord.path || '(geen pad)'}\``);
      }
    }
  }
  regels.push('');
  regels.push('## Open punten (eigenaar)');
  regels.push('');
  regels.push(Array.isArray(input.ownerOpenPoints) && input.ownerOpenPoints.length > 0
    ? input.ownerOpenPoints.map((punt) => `- ${punt}`).join('\n')
    : '- Geen open punten voor de eigenaar.');
  regels.push('');
  regels.push('## Open punten');
  regels.push('');
  regels.push(Array.isArray(input.openPoints) && input.openPoints.length > 0
    ? input.openPoints.map((punt) => `- ${punt}`).join('\n')
    : '- Nog geen open punten vastgelegd.');
  regels.push('');
  regels.push('Ontwikkelaarsbewijs op een lokale opbouw: geen productie, geen onafhankelijke review en geen echte acceptatie.');
  regels.push('');
  return `${regels.join('\n')}\n`;
}

module.exports = {
  BUDGET_KB,
  MIN_TARGET,
  MAIN_BUTTON,
  CONTROLS,
  roundKb,
  pathOf,
  topResponses,
  imageAllowed,
  loadVerdict,
  imageVerdict,
  overflowVerdict,
  targetVerdict,
  mainButtonVerdict,
  headingVerdict,
  keyboardVerdict,
  a11yVerdict,
  comboRow,
  pageSummary,
  summaryOf,
  markdownReport,
};
