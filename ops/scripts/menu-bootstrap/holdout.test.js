'use strict';

// BE-73 (#180, besluit 021) — regressions for the holdout measurement. No
// network and no model: every page comes from a fake fetch or a fixture. The
// three promises of the contract are checked here: the top 50 with Wolfslaar
// skipped, nothing written to data/, and the report itself.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createSourceFetcher } = require('./fetchSource');
const engine = require('./engine');
const {
  FIRST_DISHES,
  PLACES,
  SAMPLE_SIZE,
  buildHoldoutReport,
  classifyPlace,
  inspectPage,
  pageText,
  percent,
  selectCandidates,
  renderHoldoutMarkdown,
  runHoldout,
  writeReports,
} = require('./holdout');

const FIXTURES = path.join(__dirname, '__fixtures__');
const COMPLETE_HTML = fs.readFileSync(path.join(FIXTURES, 'complete-menu.html'), 'utf8');

// A homepage that prints no card, only images that name one.
const IMAGE_HOME = `<!doctype html><html lang="nl"><head><title>Fictief — welkom</title></head><body>
<nav><a href="/">Home</a> <a href="/reserveren">Reserveren</a></nav>
<p>${'Welkom in ons restaurant aan de markt. '.repeat(20)}</p>
<img src="/images/menukaart-voorjaar.jpg" alt="Menukaart voorjaar" />
<img src="/images/dinerkaart.jpg" alt="Dinerkaart" />
</body></html>`;

// A homepage that shows almost nothing: its content is loaded by a script.
const SCRIPT_HOME = `<!doctype html><html lang="nl"><head><title>Fictief</title></head><body>
<div id="app"></div><script src="/app.js"></script>
</body></html>`;

// A homepage whose card lives on another host.
const EXTERNAL_HOME = `<!doctype html><html lang="nl"><head><title>Fictief — welkom</title></head><body>
<p>${'Wij koken elke dag met verse producten uit de streek. '.repeat(20)}</p>
<a href="https://static.platform.example/menu/fictief.pdf">Onze menukaart</a>
<a href="https://www.instagram.com/fictief">Instagram</a>
</body></html>`;

function fakeFetch(sites) {
  const calls = [];
  async function fetchImpl(url, options = {}) {
    calls.push({ url, userAgent: options.userAgent || null });
    const parsed = new URL(url);
    if (parsed.pathname === '/robots.txt') {
      return { body: 'User-agent: *\nAllow: /\n', bytes: null, finalUrl: url, contentType: 'text/plain', redirected: false };
    }
    const body = sites[`${parsed.hostname}${parsed.pathname}`];
    if (body === undefined) throw Object.assign(new Error('not found'), { reason: 'bad-status', statusCode: 404 });
    return {
      body: null,
      bytes: Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8'),
      finalUrl: url,
      contentType: Buffer.isBuffer(body) ? 'application/pdf' : 'text/html',
      redirected: false,
    };
  }
  return { fetchImpl, calls };
}

function fakeClock() {
  let current = 0;
  return {
    now: () => current,
    sleep: async (ms) => {
      current += ms;
    },
  };
}

test('de selectie: de top 50 op rangorde, en Wolfslaar wordt met een reden overgeslagen', () => {
  const candidates = [];
  for (let rank = 1; rank <= 60; rank += 1) candidates.push({ rank, name: `Restaurant ${rank}`, website: `https://r${rank}.example/` });
  candidates.push({ rank: 3, name: 'Wolfslaar Restaurant', website: 'https://www.restaurantwolfslaar.com/' });
  const { selected, excluded } = selectCandidates([...candidates].reverse(), { size: 50 });
  assert.equal(selected.length, 50);
  assert.deepEqual(selected.map((candidate) => candidate.rank), Array.from({ length: 50 }, (_, index) => index + 1));
  assert.ok(!selected.some((candidate) => /wolfslaar/i.test(candidate.name)));
  // The excluded candidate is reported, not silently dropped.
  assert.equal(excluded.length, 1);
  assert.match(excluded[0].reason, /#179/);
});

test('de selectie op de echte kandidatenlijst: vijftig kandidaten, elk met een eigen website', () => {
  const file = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'ops', 'data', 'breda-restaurant-candidates.json'), 'utf8'));
  const { selected, excluded } = selectCandidates(file.candidates);
  assert.equal(selected.length, SAMPLE_SIZE);
  assert.ok(selected.every((candidate) => typeof candidate.website === 'string' && candidate.website.startsWith('http')));
  assert.equal(selected[0].rank, 1);
  assert.ok(!selected.some((candidate) => /wolfslaar/i.test(candidate.name)));
  // Wolfslaar stands at rank 235, so in this sample the rule changes nothing.
  assert.deepEqual(excluded, []);
});

test('de motor van BE-71 blijft ongewijzigd: dezelfde exports', () => {
  assert.deepEqual(Object.keys(engine).sort(), ['bootstrapRestaurant', 'dishCountOf', 'pricedCountOf', 'readResponse']);
  assert.equal(typeof engine.bootstrapRestaurant, 'function');
});

test('de plek van de kaart: subpagina, pdf met of zonder tekstlaag, afbeelding, extern platform, JavaScript, geen kaart', () => {
  assert.equal(classifyPlace({ status: 'done', kind: 'html', sourceUrl: 'https://x.nl/menukaart/', dishCount: 12, pricedCount: 12, candidates: [] }).place, PLACES.subpage);
  assert.equal(classifyPlace({ status: 'skipped', kind: 'pdf', sourceUrl: 'https://x.nl/kaart.pdf', dishCount: 47, pricedCount: 47, candidates: [] }).place, PLACES.pdfText);
  assert.equal(classifyPlace({ status: 'blocked', reasons: [{ code: 'robots', text: 'robots' }] }).place, PLACES.blocked);
  // A page the reader refused is not "the card on a subpage": nothing was found.
  assert.equal(classifyPlace({ status: 'skipped', kind: 'html', sourceUrl: 'https://x.nl/', dishCount: 0, pricedCount: 0, candidates: [] }).place, PLACES.none);

  const noText = {
    status: 'skipped',
    kind: null,
    candidates: [{ url: 'https://x.nl/kaart.pdf', kind: 'pdf', dishCount: 0, pricedCount: 0, refusal: { status: 'unparsed', reason: 'no_text_layer' } }],
  };
  assert.equal(classifyPlace(noText).place, PLACES.pdfNoText);

  const pages = (url, html) => new Map([[url, html]]);
  const failed = (url) => ({ status: 'skipped', kind: null, candidates: [{ url, kind: 'html', dishCount: 0, pricedCount: 0, refusal: { status: 'too_few_items' } }] });

  assert.equal(classifyPlace(failed('https://x.nl/'), pages('https://x.nl/', IMAGE_HOME)).place, PLACES.image);

  const external = classifyPlace(failed('https://y.nl/'), pages('https://y.nl/', EXTERNAL_HOME));
  assert.equal(external.place, PLACES.external);
  assert.match(external.evidence, /static\.platform\.example/);

  assert.equal(classifyPlace(failed('https://z.nl/'), pages('https://z.nl/', SCRIPT_HOME)).place, PLACES.javascript);

  // A page with plenty of text and a menulink, and no card behind it: no card online.
  const withLink = EXTERNAL_HOME.replace(/<a href="https:[\s\S]*$/, '<a href="/menukaart/">Menukaart</a></body></html>');
  assert.equal(classifyPlace(failed('https://n.nl/'), pages('https://n.nl/', withLink)).place, PLACES.none);
  // No page in the cache at all: no card can be judged.
  assert.equal(classifyPlace(failed('https://n.nl/')).place, PLACES.none);
});

test('de paginameting telt woorden, menu-afbeeldingen, eigen menulinks en menulinks naar een andere host', () => {
  const home = inspectPage(`${IMAGE_HOME}<a href="/menukaart/">Menukaart</a>`, 'https://x.nl/');
  assert.ok(home.words > 10);
  assert.equal(home.menuImages, 2);
  assert.equal(home.sameHostMenuLinks, 1);
  assert.deepEqual(home.externalMenuLinks, []);

  const external = inspectPage(EXTERNAL_HOME, 'https://y.nl/');
  assert.equal(external.externalMenuLinks.length, 1);
  assert.equal(external.externalMenuLinks[0].url, 'https://static.platform.example/menu/fictief.pdf');

  // No tags, no scripts and no styles in the visible text.
  assert.equal(pageText('<style>a{}</style><script>var a=1</script><p>Hallo daar</p>'), 'Hallo daar');
  assert.equal(percent(3, 25), 12);
  assert.equal(percent(0, 0), null);
});

test('de meetrun schrijft alleen het rapport, nooit iets in data/', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-holdout-'));
  const dataDir = path.join(__dirname, '..', '..', '..', 'data');
  const dataFiles = () => fs.readdirSync(dataDir, { recursive: true }).map(String).sort();
  const snapshot = (file) => fs.readFileSync(path.join(dataDir, file), 'utf8');
  const before = { files: dataFiles(), menus: snapshot('menus.json'), restaurants: snapshot('restaurants.json') };

  const clock = fakeClock();
  const { fetchImpl } = fakeFetch({ 'compleet.nl/': COMPLETE_HTML, 'afbeelding.nl/': IMAGE_HOME });
  const fetcher = createSourceFetcher({ cacheDir: null, fetchImpl, sleep: clock.sleep, now: clock.now });
  const report = await runHoldout({
    candidates: [
      { rank: 1, name: 'Complete Kaart', website: 'https://compleet.nl/' },
      { rank: 2, name: 'Alleen Afbeelding', website: 'https://afbeelding.nl/' },
    ],
    fetcher,
    scraped: '2026-11-01',
    generatedAt: '2026-11-01T10:00:00.000Z',
    baseline: { restaurants: 25, done: 3 },
    pages: new Map([['https://afbeelding.nl/', IMAGE_HOME]]),
    log: () => {},
  });

  assert.equal(report.totals.done, 1);
  assert.equal(report.totals.skipped, 1);
  assert.equal(report.places[PLACES.subpage], 1);
  assert.equal(report.places[PLACES.image], 1);

  const written = writeReports({ report, outDir });
  assert.deepEqual(fs.readdirSync(outDir).sort(), ['menu-holdout-report.json', 'menu-holdout-report.md']);
  assert.equal(path.basename(written.md), 'menu-holdout-report.md');
  assert.equal(JSON.parse(fs.readFileSync(written.json, 'utf8')).totals.done, 1);

  // The report itself: the comparison with the 25, the kind of card, the outcome
  // and the first ten dishes with a price for the one card that passed.
  const markdown = fs.readFileSync(written.md, 'utf8');
  assert.match(markdown, /\| 25 bestaande restaurants \(BE-71, ronde 3\) \| 3 \| 25 \| 12% \|/);
  assert.match(markdown, /\| 50 onbekende restaurants \(deze meting\) \| 1 \| 2 \| 50% \|/);
  assert.match(markdown, /Verschil: 38 procentpunt/);
  assert.match(markdown, /\| 1 \| Complete Kaart \| https:\/\/compleet\.nl\/ \| html \| subpagina \| 12 \| 12 \| geslaagd \|/);
  assert.match(markdown, /### Complete Kaart \(1\)/);
  assert.equal(report.restaurants[0].sample.length, FIRST_DISHES);
  assert.match(markdown, /- Tomatensoep \(Voorgerechten\) — € 6,50/);
  assert.match(markdown, /Alleen Afbeelding \| afbeelding/);

  // data/ is byte for byte the same, and no file was added there.
  assert.deepEqual(dataFiles(), before.files);
  assert.equal(snapshot('menus.json'), before.menus);
  assert.equal(snapshot('restaurants.json'), before.restaurants);

  fs.rmSync(outDir, { recursive: true, force: true });
});

test('het rapport zonder basisrapport of zonder geslaagde kaart valt niet om', () => {
  const report = buildHoldoutReport({
    results: [],
    excluded: [],
    baseline: null,
    scraped: '2026-11-01',
    generatedAt: '2026-11-01T10:00:00.000Z',
  });
  assert.equal(report.totals.restaurants, 0);
  assert.equal(report.baseline.percent, null);
  assert.equal(report.comparison.differencePoints, null);
  const markdown = renderHoldoutMarkdown(report);
  assert.match(markdown, /Verschil: niet te berekenen/);
  assert.match(markdown, /Geen enkele kaart slaagde/);
});
