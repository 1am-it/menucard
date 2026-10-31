'use strict';

// BE-51 (#121) — regressies voor de meetkern van de toegankelijkheidscheck.
//
// Wat hier wordt vastgelegd:
//   - het kleur- en contrastrekenwerk tegen vaste, met de hand narekende
//     WCAG-waarden (21:1 zwart/wit, 4,54:1 voor #767676 op wit, enz.);
//   - de grens tussen grote en gewone tekst (3:1 tegen 4,5:1);
//   - de uitspraak per criterium op vaste metingen, zodat een latere
//     "verbetering" van de check zelf opvalt;
//   - dat de bron die naar de browser gaat geldige JavaScript is, geen
//     `require` bevat en hetzelfde uitrekent als de Node-functie.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  parseColor,
  relativeLuminance,
  compositeColor,
  contrastRatio,
  isLargeText,
  requiredContrast,
  contrastResult,
  groupFailures,
  checksFromAudit,
  checksFromFocusWalk,
  checksFromReflow,
  checksFromMotion,
  checksFromDialog,
  inPageSource,
} = require('./a11y-audit');
const audit = require('./a11y-audit');

test('parseColor leest elke vorm die getComputedStyle teruggeeft', () => {
  assert.deepEqual(parseColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColor('#1F2328'), { r: 31, g: 35, b: 40, a: 1 });
  assert.deepEqual(parseColor('rgb(31, 35, 40)'), { r: 31, g: 35, b: 40, a: 1 });
  assert.deepEqual(parseColor('rgba(0, 0, 0, 0.5)'), { r: 0, g: 0, b: 0, a: 0.5 });
  assert.deepEqual(parseColor('rgb(31 35 40 / 50%)'), { r: 31, g: 35, b: 40, a: 0.5 });
  assert.deepEqual(parseColor('color(srgb 0.5 0.5 0.5)'), { r: 127.5, g: 127.5, b: 127.5, a: 1 });
  assert.deepEqual(parseColor('transparent'), { r: 0, g: 0, b: 0, a: 0 });
  assert.equal(parseColor('var(--accent)'), null);
  assert.equal(parseColor(''), null);
  assert.equal(parseColor(null), null);
});

test('contrastRatio geeft de narekende WCAG-waarden', () => {
  assert.equal(contrastRatio('#000', '#fff'), 21);
  assert.equal(contrastRatio('#fff', '#fff'), 1);
  // #767676 op wit is de bekende grens: 4,54:1, dus net AA voor gewone tekst.
  const grijs = contrastRatio('#767676', '#ffffff');
  assert.ok(grijs > 4.5 && grijs < 4.6, `verwacht ±4,54, kreeg ${grijs}`);
  // #777777 zakt er net onder; dat is de fout die de check moet vangen.
  assert.ok(contrastRatio('#777777', '#ffffff') < 4.5);
  // De donkere publieke tokens: oker op antraciet.
  const oker = contrastRatio('#F2C35B', '#1F2328');
  assert.ok(oker > 9 && oker < 10, `verwacht ±9,6, kreeg ${oker}`);
  assert.equal(contrastRatio('onzin', '#fff'), null);
});

test('relativeLuminance en compositie volgen de WCAG-formule', () => {
  assert.equal(relativeLuminance(parseColor('#000')), 0);
  assert.equal(relativeLuminance(parseColor('#fff')), 1);
  const half = compositeColor(parseColor('rgba(0, 0, 0, 0.5)'), parseColor('#fff'));
  assert.equal(Math.round(half.r), 128);
  assert.equal(compositeColor(parseColor('rgba(0, 0, 0, 0)'), parseColor('#123456')).r, 0x12);
});

test('grote tekst heeft 3:1 nodig, gewone tekst 4,5:1', () => {
  assert.equal(isLargeText(24, 400), true);
  assert.equal(isLargeText(23.9, 400), false);
  assert.equal(isLargeText(18.66, 700), true);
  assert.equal(isLargeText(18.5, 700), false);
  assert.equal(isLargeText(18.66, 400), false);
  assert.equal(requiredContrast(24, 400), 3);
  assert.equal(requiredContrast(14, 400), 4.5);

  // 4:1 haalt grote tekst wel en gewone tekst niet.
  const groot = contrastResult({ foreground: '#949494', background: '#ffffff', fontSizePx: 24, fontWeight: 400 });
  const gewoon = contrastResult({ foreground: '#949494', background: '#ffffff', fontSizePx: 14, fontWeight: 400 });
  assert.equal(groot.passed, true);
  assert.equal(gewoon.passed, false);
  assert.equal(gewoon.reason, 'contrast-te-laag');
});

test('groupFailures telt herhalingen en houdt één voorbeeld per groep', () => {
  const grouped = groupFailures([
    { criterion: 'contrast', reason: 'contrast-te-laag', name: 'span.x', passed: false, detail: '3,1:1' },
    { criterion: 'contrast', reason: 'contrast-te-laag', name: 'span.x', passed: false, detail: '3,1:1' },
    { criterion: 'contrast', reason: 'contrast-te-laag', name: 'span.y', passed: false, detail: '2,9:1' },
    { criterion: 'contrast', reason: null, name: 'span.z', passed: true, detail: null },
  ]);
  assert.equal(grouped.total, 3);
  assert.equal(grouped.groups, 2);
  assert.equal(grouped.entries[0].count, 2);
  assert.equal(grouped.entries[0].name, 'span.x');

  // Foutregels uit de audit dragen geen `passed`; die horen ook gegroepeerd te
  // worden, anders blijft het bewijs leeg terwijl er wel fouten zijn.
  const auditFouten = groupFailures([
    { criterion: 'contrast', reason: 'contrast-te-laag', name: 'span.a', detail: '3:1' },
    { criterion: 'contrast', reason: 'contrast-te-laag', name: 'span.a', detail: '3:1' },
  ]);
  assert.equal(auditFouten.total, 2);
  assert.equal(auditFouten.entries[0].count, 2);
});

const schoneMeting = {
  url: '/',
  title: 'BredaEats',
  lang: 'nl',
  contrast: { measured: 42, unmeasurable: 0, minRatio: 7.2, failures: [], failureTotal: 0 },
  interactive: [
    { selector: 'a.primary-nav-link', tag: 'a', name: 'Zoeken', symbolOnly: false, width: 96, height: 44, inlineInText: false, midSized: true, spacingOk: true },
    { selector: 'button.theme-btn', tag: 'button', name: 'Licht', symbolOnly: false, width: 60, height: 32, inlineInText: false, midSized: true, spacingOk: true },
  ],
  targets: [
    { selector: 'a.primary-nav-link', tag: 'a', name: 'Zoeken', symbolOnly: false, width: 96, height: 44, inlineInText: false, midSized: true, spacingOk: true },
    { selector: 'button.theme-btn', tag: 'button', name: 'Licht', symbolOnly: false, width: 60, height: 32, inlineInText: false, midSized: true, spacingOk: true },
  ],
  formfields: [{ selector: 'input#home-q', type: 'search', name: 'Zoek een gerecht', labelled: true }],
  headings: [
    { level: 1, text: 'Wat wil je eten?' },
    { level: 2, text: 'Populair in Breda' },
    { level: 2, text: 'Vanavond op de kaart' },
    { level: 3, text: 'Poussin' },
  ],
  landmarks: { main: 1, nav: 1, header: 1, footer: 0 },
};

test('checksFromAudit keurt een schone meting goed', () => {
  const { checks, errors } = checksFromAudit('home', 'licht', schoneMeting);
  assert.deepEqual(errors, []);
  assert.ok(checks.length >= 8);
  assert.ok(checks.every((check) => check.passed), JSON.stringify(checks.filter((c) => !c.passed)));
  assert.deepEqual(
    [...new Set(checks.map((check) => check.criterion))],
    ['contrast', 'naam', 'tikdoel', 'koppen', 'landmarks', 'taal', 'formulier']
  );
});

test('checksFromAudit noemt elke fout met criterium en reden', () => {
  const meting = {
    ...schoneMeting,
    lang: 'en',
    contrast: {
      measured: 10,
      unmeasurable: 0,
      minRatio: 2.1,
      failureTotal: 1,
      failures: [
        {
          selector: 'span.tonight-meta',
          text: 'Bardot',
          foreground: 'rgb(92, 86, 80)',
          background: 'rgb(255, 255, 255)',
          fontSizePx: 12,
          fontWeight: 400,
          ratio: 2.1,
          required: 4.5,
          reason: 'contrast-te-laag',
        },
      ],
    },
    interactive: [{ selector: 'button.mf-tag-x', tag: 'button', name: '×', symbolOnly: true, width: 20, height: 20, inlineInText: false }],
    targets: [{ selector: 'button.mf-tag-x', tag: 'button', name: '×', symbolOnly: true, width: 20, height: 20, inlineInText: false, midSized: false, spacingOk: false }],
    headings: [{ level: 2, text: 'Zonder h1' }, { level: 4, text: 'Sprong' }],
    landmarks: { main: 2, nav: 0, header: 0, footer: 0 },
    formfields: [{ selector: 'input.mf-search', type: 'search', name: '', labelled: false }],
  };
  const { checks, errors } = checksFromAudit('menu', 'donker', meting);
  const redenen = errors.map((error) => `${error.criterion}:${error.reason}`);
  for (const verwacht of [
    'contrast:contrast-te-laag',
    'naam:alleen-symbool',
    'tikdoel:te-klein',
    'koppen:aantal-h1',
    'koppen:niveau-overgeslagen',
    'landmarks:main',
    'landmarks:nav',
    'taal:lang',
    'formulier:geen-label',
  ]) {
    assert.ok(redenen.includes(verwacht), `mist ${verwacht} in ${redenen.join(', ')}`);
  }
  assert.ok(checks.some((check) => check.passed === false));
});

test('checksFromAudit laat een inline link in een zin met rust', () => {
  const meting = {
    ...schoneMeting,
    targets: [{ selector: 'a.inline', tag: 'a', name: 'de menukaart', width: 80, height: 18, inlineInText: true, midSized: false, spacingOk: false }],
  };
  const { errors } = checksFromAudit('home', 'licht', meting);
  assert.deepEqual(errors.filter((error) => error.criterion === 'tikdoel'), []);
});

test('BE-70: een link in een vaste laag is geen tikdoel dat te dicht op een ander staat', () => {
  // /alle-restaurants op 390 px: de naamlink van een kaart (130×24, middenformaat)
  // lag binnen 12 px van `a.mobile-tab-link` in de zwevende menubalk. Die balk is
  // zelf `position: fixed`; de links erin niet. Ze horen allebei bij de vaste laag
  // en tellen daarom niet als buur (ops/browser/lib/a11y-audit.js, insideFixedLayer).
  const kaart = { selector: 'a.ar-name.ar-name-link', tag: 'a', name: 'Restaurant Zuyd', width: 130, height: 24, inlineInText: false, midSized: true, spacingOk: true, fixed: false };
  const balk = { selector: 'a.mobile-tab-link', tag: 'a', name: 'Restaurants', width: 96, height: 48, inlineInText: false, midSized: true, spacingOk: true, fixed: true };
  const goed = checksFromAudit('alle-restaurants', 'licht', { ...schoneMeting, targets: [kaart, balk] });
  assert.deepEqual(goed.errors.filter((error) => error.criterion === 'tikdoel'), [], 'de vaste balk geeft geen fout meer');

  // Een buur die niet in een vaste laag ligt blijft wel een echt rood punt.
  const dichtbij = { ...kaart, spacingOk: false };
  const rood = checksFromAudit('alle-restaurants', 'licht', { ...schoneMeting, targets: [dichtbij] });
  const fout = rood.errors.find((error) => error.criterion === 'tikdoel');
  assert.ok(fout, 'een te dicht doel zonder vaste laag blijft een fout');
  assert.equal(fout.reason, 'te-dicht-op-elkaar');

  // De wandeling zit in het in-de-pagina-script: ook de ouders tellen mee.
  const bron = audit.inPageSource('auditPage', [{ minTarget: 44, midTarget: 24 }]);
  assert.match(bron, /function insideFixedLayer\(element\)/);
  assert.match(bron, /style\.position === 'fixed' \|\| style\.position === 'sticky'/);
  assert.match(bron, /node = node\.parentElement/);
  assert.match(bron, /fixed: insideFixedLayer\(element\)/);
});

test('checksFromFocusWalk eist zichtbare focus en DOM-volgorde', () => {
  const goed = checksFromFocusWalk('home', 'licht', {
    total: 3,
    steps: [
      { index: 0, selector: 'a.skip', name: 'Naar de inhoud', indicator: { visible: true, changes: ['outline'] } },
      { index: 1, selector: 'a.primary-nav-link', name: 'Zoeken', indicator: { visible: true, changes: ['box-shadow'] } },
      { index: 2, selector: 'button.theme-btn', name: 'Licht', indicator: { visible: true, changes: ['rand'] } },
    ],
  });
  assert.deepEqual(goed.errors, []);
  assert.ok(goed.checks.every((check) => check.passed));

  const fout = checksFromFocusWalk('home', 'licht', {
    total: 3,
    steps: [
      { index: 0, selector: 'a.skip', name: 'Naar de inhoud', indicator: { visible: false, changes: ['tekstkleur'] } },
      { index: 2, selector: 'button.theme-btn', name: 'Licht', indicator: { visible: true, changes: ['rand'] } },
      { index: 1, selector: 'a.primary-nav-link', name: 'Zoeken', indicator: null },
    ],
  });
  const redenen = fout.errors.map((error) => error.reason);
  assert.ok(redenen.includes('geen-zichtbare-focus'));
  assert.ok(redenen.includes('volgorde'));

  // Een element dat Tab overslaat: wel in de lijst, niet bereikt.
  const onbereikt = checksFromFocusWalk('home', 'licht', {
    total: 3,
    steps: [
      { index: 0, selector: 'a.skip', name: 'Naar de inhoud', indicator: { visible: true, changes: ['outline'] } },
      { index: 2, selector: 'button.theme-btn', name: 'Licht', indicator: { visible: true, changes: ['rand'] } },
    ],
  });
  assert.ok(onbereikt.errors.map((error) => error.reason).includes('niet-bereikt'));
});

test('checksFromReflow meldt horizontale scroll en afgekapte tekst', () => {
  const schoon = checksFromReflow('home', 'licht', { viewportWidth: 320, scrollWidth: 320, overflowX: 0, offenderTotal: 0, clippedTotal: 0, ellipsisTotal: 2 });
  assert.ok(schoon.checks.every((check) => check.passed));
  assert.deepEqual(schoon.errors, []);

  const fout = checksFromReflow('menu', 'donker', {
    viewportWidth: 320,
    scrollWidth: 348,
    overflowX: 28,
    offenders: [{ selector: 'div.category-tabs', left: 0, right: 348 }],
    offenderTotal: 1,
    clipped: [{ selector: 'span.lijst-row-name', text: 'Poussin', scrollWidth: 120, clientWidth: 60 }],
    clippedTotal: 1,
    ellipsisTotal: 0,
  });
  const redenen = fout.errors.map((error) => error.reason);
  assert.ok(redenen.includes('horizontale-scroll'));
  assert.ok(redenen.includes('buiten-beeld'));
  assert.ok(redenen.includes('tekst-afgekapt'));
});

test('checksFromMotion eist rust onder prefers-reduced-motion', () => {
  const rustig = checksFromMotion('home', 'licht', { prefersReducedMotion: true, scrollBehaviour: 'auto', animationTotal: 0, transitionTotal: 0 });
  assert.ok(rustig.checks.every((check) => check.passed));

  const beweegt = checksFromMotion('home', 'licht', {
    prefersReducedMotion: true,
    scrollBehaviour: 'smooth',
    animationTotal: 1,
    animations: [{ selector: 'div.cov-spinner', name: 'cov-spin', duration: 0.9 }],
    transitionTotal: 0,
  });
  const redenen = beweegt.errors.map((error) => error.reason);
  assert.ok(redenen.includes('animatie'));
  assert.ok(redenen.includes('vloeiend-scrollen'));
});

test('checksFromDialog eist focus in het venster, vasthouden en teruggeven', () => {
  const goed = checksFromDialog('deelblad', 'licht', {
    open: true,
    inside: true,
    trapped: true,
    restored: true,
    ariaModal: 'true',
    labelledBy: 'deel-titel',
    name: '',
  });
  assert.ok(goed.checks.every((check) => check.passed));

  const fout = checksFromDialog('deelblad', 'licht', { open: true, inside: false, trapped: false, restored: false, ariaModal: null, name: '' });
  const redenen = fout.errors.map((error) => error.reason);
  for (const verwacht of ['focus-niet-binnen', 'focus-ontsnapt', 'focus-niet-terug', 'geen-naam', 'geen-aria-modal']) {
    assert.ok(redenen.includes(verwacht), `mist ${verwacht}`);
  }
});

test('de bron voor de browser is geldige JavaScript zonder require', () => {
  for (const naam of ['auditPage', 'reflowAudit', 'motionAudit', 'scaleText', 'prepareFocusWalk', 'readFocusStep', 'dialogAudit', 'activeElementAudit']) {
    const bron = inPageSource(naam, [{}]);
    assert.doesNotThrow(() => new Function(`return ${bron}`), `${naam} is geen geldige JavaScript`);
    assert.doesNotMatch(bron, /\brequire\(/, `${naam} mag geen require bevatten`);
  }
});

test('de bron voor de browser gebruikt geen functie die er niet in staat', () => {
  // Deze fout is echt gebeurd: een hulpje werd in de pagina gebruikt maar niet
  // meegestuurd, en dan faalt de hele meting met "is not defined".
  const globals = new Set([
    'Array', 'Object', 'Math', 'Number', 'String', 'Boolean', 'JSON', 'Set', 'Map', 'WeakMap',
    'Promise', 'Error', 'RegExp', 'parseFloat', 'parseInt', 'isNaN', 'isFinite', 'console',
    'document', 'window', 'getComputedStyle', 'CSS', 'requestAnimationFrame', 'setTimeout',
    'clearTimeout', 'Element', 'Node', 'Intl', 'URL', 'Date', 'Symbol', 'if', 'for', 'while',
    'switch', 'catch', 'function', 'return', 'typeof', 'new', 'await', 'async', 'else',
  ]);
  const zonderTekst = (bron) =>
    bron
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1 ')
      .replace(/`[^`]*`/g, '``')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''")
      .replace(/"(?:[^"\\]|\\.)*"/g, '""');

  for (const naam of ['auditPage', 'reflowAudit', 'motionAudit', 'scaleText', 'prepareFocusWalk', 'readFocusStep', 'dialogAudit', 'activeElementAudit']) {
    const bron = zonderTekst(inPageSource(naam, [{}]));
    const gedeclareerd = new Set();
    for (const match of bron.matchAll(/function ([A-Za-z_$][\w$]*)\s*\(/g)) gedeclareerd.add(match[1]);
    for (const match of bron.matchAll(/(?:const|let|var) ([A-Za-z_$][\w$]*)\s*=/g)) gedeclareerd.add(match[1]);
    const aangeroepen = new Set();
    for (const match of bron.matchAll(/(^|[^\w$.])([A-Za-z_$][\w$]*)\s*\(/g)) aangeroepen.add(match[2]);
    const ontbreekt = [...aangeroepen].filter(
      (naam2) => !gedeclareerd.has(naam2) && !globals.has(naam2) && !/^[A-Z]/.test(naam2)
    );
    assert.deepEqual(ontbreekt, [], `${naam} mist hulpjes: ${ontbreekt.join(', ')}`);
  }
});

test('de bron voor de browser rekent hetzelfde als de Node-functie', () => {
  const bron = inPageSource('contrastResult', [{ foreground: '#767676', background: '#ffffff', fontSizePx: 14, fontWeight: 400 }]);
  const inDePagina = new Function(`return ${bron}`)();
  const inNode = contrastResult({ foreground: '#767676', background: '#ffffff', fontSizePx: 14, fontWeight: 400 });
  assert.equal(inDePagina.ratio, inNode.ratio);
  assert.equal(inDePagina.required, inNode.required);
  assert.equal(inDePagina.passed, inNode.passed);
});

