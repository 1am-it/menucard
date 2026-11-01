'use strict';

// BE-73 (#180, besluit 021) — measuring, never publishing: the BE-71 engine
// (./engine.js: fetching, reading and the completeness requirement, unchanged)
// over the top 50 of ops/data/breda-restaurant-candidates.json.
//
//   node ops/scripts/menu-bootstrap/holdout.js
//
// The run writes exactly two files: docs/menu-holdout-report.md and
// docs/menu-holdout-report.json. Nothing goes to data/, no card is published
// and the engine is not touched. The same fetching rules as BE-71 apply
// (robots.txt, at least two seconds of rest per host, the honest user agent and
// the cache in .local/). A site that blocks is skipped, never worked around.
// No AI, no OCR, no paid service, no database and no new dependency.

const fs = require('node:fs');
const path = require('node:path');
const { bootstrapRestaurant } = require('./engine');
const { createSourceFetcher, DEFAULT_CACHE_DIR } = require('./fetchSource');
const { chooseSameHostCandidates, hasMenuWord } = require('./candidateChoice');
const { REASON_TEXT } = require('./completeMenu');
const { collectAnchors } = require('../../../src/lib/sameHostDiscovery');
const { normalizeHostname } = require('../../../src/lib/restaurantHostMatch');
const { serialize } = require('../../../src/lib/menuExport');

const CANDIDATES_FILE = path.join('ops', 'data', 'breda-restaurant-candidates.json');
const REPORT_DIR = 'docs';
const REPORT_BASENAME = 'menu-holdout-report';
const BASELINE_REPORT = path.join('docs', 'menu-bootstrap-report.json');
const SAMPLE_SIZE = 50;
const FIRST_DISHES = 10;
// A page this thin, without a single same-host menu link, loads its content
// with JavaScript (the evidence round 3 of BE-71 recorded for those sites).
const THIN_PAGE_WORDS = 200;
// An html page is never this big; a bigger cache entry is a pdf or an image and
// its base64 body is not worth parsing just to look for menu words.
const MAX_CACHE_FILE_BYTES = 4 * 1024 * 1024;

// Who does not take part, and why. Wolfslaar is the known duplicate of #179, so
// the rule stays: a later top 50 that does contain it still skips it.
const SKIP_RULES = [{ pattern: /wolfslaar/i, reason: 'bekende dubbele, gerepareerd in #179' }];

// The closed vocabulary of round 3 of BE-71 for where the card lives. A blocked
// site gets its own value: nothing was read there, so no card can be judged.
const PLACES = {
  subpage: 'subpagina',
  pdfText: 'pdf met tekstlaag',
  pdfNoText: 'pdf zonder tekstlaag',
  image: 'afbeelding',
  external: 'extern platform',
  javascript: 'JavaScript',
  none: 'geen kaart online',
  blocked: 'geblokkeerd',
};

// Platforms that are never the card itself, so a link to them is not evidence
// of an external menu.
const NOT_A_CARD_HOST = /(?:instagram|facebook|fb\.me|twitter|x\.com|tiktok|youtube|youtu\.be|google|goo\.gl|tripadvisor|untappd|whatsapp|wa\.me|mailto|tel:)/i;

function today() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** The skip rule for one candidate, or null when it takes part. */
function skipReasonFor(candidate) {
  const haystacks = [candidate && candidate.name, candidate && candidate.website, candidate && candidate.websiteHost];
  for (const rule of SKIP_RULES) {
    if (haystacks.some((value) => typeof value === 'string' && rule.pattern.test(value))) return rule.reason;
  }
  return null;
}

/**
 * The measured sample: the top `size` candidates by rank, minus everyone the
 * skip rules name. Returns `{ selected, excluded }`; an excluded candidate is
 * reported with its reason instead of disappearing silently.
 */
function selectCandidates(candidates, { size = SAMPLE_SIZE } = {}) {
  const ordered = (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => candidate && typeof candidate === 'object')
    .slice()
    .sort((a, b) => Number(a.rank || 0) - Number(b.rank || 0));
  const selected = [];
  const excluded = [];
  for (const candidate of ordered) {
    const reason = skipReasonFor(candidate);
    if (reason) {
      excluded.push({ rank: candidate.rank, name: candidate.name, website: candidate.website || null, reason });
      continue;
    }
    if (selected.length >= size) break;
    selected.push(candidate);
  }
  return { selected, excluded };
}

/** The visible text of one html page: no scripts, no styles, no tags. */
function pageText(html) {
  return String(html || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function attribute(tag, name) {
  const match = String(tag || '').match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match ? match[2] || match[3] || match[4] || '' : '';
}

/** How many images of a page name a menu word (alt, title or file name). */
function menuImageCount(html) {
  let count = 0;
  for (const match of String(html || '').matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    if (hasMenuWord(`${attribute(tag, 'alt')} ${attribute(tag, 'title')} ${attribute(tag, 'src')}`)) count += 1;
  }
  return count;
}

/** The links to another host that could hold the card: a menu word or a pdf. */
function externalMenuLinks(html, baseUrl) {
  const baseHost = normalizeHostname(baseUrl);
  if (!baseHost) return [];
  const found = [];
  for (const anchor of collectAnchors(html, baseUrl)) {
    if (normalizeHostname(anchor.url.href) === baseHost) continue;
    const href = String(anchor.hrefPath || '');
    if (NOT_A_CARD_HOST.test(anchor.url.hostname) || NOT_A_CARD_HOST.test(href)) continue;
    const text = String(anchor.visibleText || '').replace(/\s+/g, ' ').trim();
    const isPdf = /\.pdf(?:$|[?#])/i.test(href);
    if (!isPdf && !hasMenuWord(text) && !hasMenuWord(href)) continue;
    found.push({ url: anchor.url.href, text: text || href });
  }
  return found;
}

/**
 * What one already fetched page shows, without a second request: its visible
 * word count, the images that name a menu word, its same-host menu links and
 * the menu links that leave the site.
 */
function inspectPage(html, url) {
  return {
    url,
    words: pageText(html).split(/\s+/).filter(Boolean).length,
    menuImages: menuImageCount(html),
    sameHostMenuLinks: chooseSameHostCandidates(html, url, { max: 5 }).length,
    externalMenuLinks: externalMenuLinks(html, url),
  };
}

// A short, verifiable label for one url in the report: its path, not the host.
function pathOf(url) {
  try {
    const parsed = new URL(String(url || ''));
    return `${parsed.pathname}${parsed.search}` || '/';
  } catch (error) {
    return String(url || '—');
  }
}

/**
 * The pages of one restaurant the engine already fetched, with what they show.
 * Only pages the engine really read are inspected: the html comes from the
 * cache, so classification costs no second request.
 */
function readPages(record, htmlByUrl) {
  const pages = [];
  for (const candidate of (record && record.candidates) || []) {
    if (candidate.kind !== 'html') continue;
    const html = htmlByUrl instanceof Map ? htmlByUrl.get(candidate.url) : null;
    if (!html) continue;
    pages.push({ candidate, inspection: inspectPage(html, candidate.url) });
  }
  return pages;
}

/**
 * Where the card lives, in the closed vocabulary of round 3 of BE-71:
 * `{ place, evidence }`. A card the engine read tells its own kind; when it read
 * no card, the pages it did fetch decide, in this order: a pdf without a text
 * layer, an image that names a menu word, a menulink to another host, a page
 * that loads its content with JavaScript, and otherwise no card online.
 */
function classifyPlace(record, htmlByUrl = new Map()) {
  if (!record) return { place: PLACES.none, evidence: null };
  if (record.status === 'blocked') {
    const reason = (record.reasons || [])[0];
    return { place: PLACES.blocked, evidence: reason ? reason.detail || reason.text : null };
  }
  // A card counts only when the reader really recognised dishes on it; an html
  // page the reader refused outright is not "the card on a subpage".
  const hasCard = (record.dishCount || 0) > 0 || (record.pricedCount || 0) > 0;
  if (hasCard && record.kind === 'pdf') {
    return { place: PLACES.pdfText, evidence: `${record.dishCount || 0} gerechten uit een pdf met tekstlaag (${pathOf(record.sourceUrl)})` };
  }
  if (hasCard && record.kind === 'html') {
    return { place: PLACES.subpage, evidence: `${record.dishCount || 0} gerechten uit html op ${pathOf(record.sourceUrl)}` };
  }

  const pdfNoText = ((record && record.candidates) || []).find(
    (candidate) => candidate.kind === 'pdf' && candidate.refusal && candidate.refusal.reason === 'no_text_layer',
  );
  if (pdfNoText) return { place: PLACES.pdfNoText, evidence: `pdf zonder tekstlaag: ${pathOf(pdfNoText.url)}` };

  const pages = readPages(record, htmlByUrl);
  if (pages.length === 0) return { place: PLACES.none, evidence: 'geen gelezen pagina in de cache' };

  const withImages = pages
    .filter((page) => page.inspection.menuImages > 0 && (page.candidate.pricedCount || 0) === 0)
    .sort((a, b) => b.inspection.menuImages - a.inspection.menuImages)[0];
  if (withImages) {
    return {
      place: PLACES.image,
      evidence: `${withImages.inspection.menuImages} afbeelding(en) met een menuwoord op ${pathOf(withImages.candidate.url)}, 0 prijzen in de html`,
    };
  }

  const withExternal = pages.find((page) => page.inspection.externalMenuLinks.length > 0);
  if (withExternal) {
    const links = withExternal.inspection.externalMenuLinks;
    const host = (() => {
      try {
        return new URL(links[0].url).hostname;
      } catch (error) {
        return links[0].url;
      }
    })();
    return { place: PLACES.external, evidence: `${links.length} menulink(en) naar ${host} op ${pathOf(withExternal.candidate.url)}` };
  }

  const home = pages[0].inspection;
  const allThin = pages.every((page) => page.inspection.words < THIN_PAGE_WORDS);
  if (allThin || (home.words < THIN_PAGE_WORDS && home.sameHostMenuLinks === 0)) {
    return { place: PLACES.javascript, evidence: `homepage: ${home.words} woorden, ${home.sameHostMenuLinks} menulink(en)` };
  }
  return { place: PLACES.none, evidence: `homepage: ${home.words} woorden, ${home.sameHostMenuLinks} menulink(en), geen kaart gevonden` };
}

/**
 * Every html page the run already fetched, keyed by both the requested url and
 * the final url after redirects. Read from the .local cache: classification
 * costs no request. Entries above MAX_CACHE_FILE_BYTES hold a pdf or an image
 * and are skipped.
 */
function loadHtmlCache(cacheDir) {
  const byUrl = new Map();
  let names = [];
  try {
    names = fs.readdirSync(cacheDir);
  } catch (error) {
    return byUrl;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(cacheDir, name);
    try {
      if (fs.statSync(file).size > MAX_CACHE_FILE_BYTES) continue;
      const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!entry || entry.ok !== true || entry.kind !== 'html' || typeof entry.bodyBase64 !== 'string') continue;
      const html = Buffer.from(entry.bodyBase64, 'base64').toString('utf8');
      if (entry.url) byUrl.set(entry.url, html);
      if (entry.finalUrl) byUrl.set(entry.finalUrl, html);
    } catch (error) {
      // An unreadable cache entry costs the evidence, never the run.
    }
  }
  return byUrl;
}

/** The first `limit` dishes that carry a price, in card order. */
function pricedDishes(menu, limit = FIRST_DISHES) {
  const out = [];
  for (const category of (menu && menu.categories) || []) {
    for (const item of category.items || []) {
      if (!Number.isFinite(item.price)) continue;
      out.push({ name: item.name, price: item.price, category: category.name || null });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** A percentage with one decimal, rounded, or null when it cannot be told. */
function percent(part, total) {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return null;
  return Math.round((part / total) * 1000) / 10;
}

/**
 * The report document. `results` are `{ candidate, record }` pairs from the
 * engine, `excluded` the candidates the skip rules named, `baseline` the totals
 * of the BE-71 report on the 25 known restaurants, `pages` the cached html.
 * Pure: it only formats what the engine measured.
 */
function buildHoldoutReport({ results = [], excluded = [], baseline = null, scraped, generatedAt, pages = new Map() } = {}) {
  const rows = results.map(({ candidate, record }) => {
    const where = classifyPlace(record, pages);
    return {
      rank: candidate.rank,
      name: record.name || candidate.name,
      website: record.website || candidate.website || null,
      menuUrl: record.sourceUrl || null,
      form: record.kind || null,
      place: where.place,
      placeEvidence: where.evidence,
      dishCount: record.dishCount || 0,
      pricedCount: record.pricedCount || 0,
      status: record.status,
      reasons: record.reasons || [],
      sample: record.status === 'done' ? pricedDishes(record.menu) : [],
    };
  });

  // The same grouping as the BE-71 report: the first reason per candidate.
  const groups = {};
  for (const row of rows) {
    if (row.status === 'done') continue;
    const first = (row.reasons || [])[0];
    const code = (first && first.code) || 'unknown';
    const label = REASON_TEXT[code] || (first && first.text) || code;
    groups[label] = (groups[label] || 0) + 1;
  }

  const kinds = {};
  for (const row of rows) kinds[row.place] = (kinds[row.place] || 0) + 1;

  const done = rows.filter((row) => row.status === 'done').length;
  const blocked = rows.filter((row) => row.status === 'blocked').length;
  const skipped = rows.filter((row) => row.status === 'skipped').length;
  const total = rows.length;
  const baselineTotal = baseline && Number.isFinite(baseline.restaurants) ? baseline.restaurants : null;
  const baselineDone = baseline && Number.isFinite(baseline.done) ? baseline.done : null;

  return {
    issue: '#180 (BE-73)',
    decision: 'planning/decisions/021-breda-menu-bootstrap.md',
    measurement: 'alleen meten: niets naar data/, niets gepubliceerd, motor van BE-71 ongewijzigd',
    scraped: scraped || null,
    generatedAt: generatedAt || null,
    selection: {
      source: 'ops/data/breda-restaurant-candidates.json',
      measured: total,
      excluded,
    },
    totals: { restaurants: total, done, skipped, blocked, measured: total - blocked },
    places: kinds,
    groups,
    baseline: { restaurants: baselineTotal, done: baselineDone, percent: percent(baselineDone, baselineTotal) },
    comparison: {
      baselinePercent: percent(baselineDone, baselineTotal),
      holdoutPercent: percent(done, total),
      differencePoints:
        percent(done, total) === null || percent(baselineDone, baselineTotal) === null
          ? null
          : Math.round((percent(done, total) - percent(baselineDone, baselineTotal)) * 10) / 10,
    },
    restaurants: rows,
  };
}

function euro(value) {
  return Number.isFinite(value) ? `€ ${value.toFixed(2).replace('.', ',')}` : '—';
}

function percentText(value) {
  return Number.isFinite(value) ? `${String(value).replace('.', ',')}%` : '—';
}

function statusText(row) {
  if (row.status === 'done') return 'geslaagd';
  const reasons = (row.reasons || []).map((reason) => reason.text + (reason.detail ? ` (${reason.detail})` : ''));
  return `${row.status === 'blocked' ? 'geblokkeerd' : 'overgeslagen'}: ${reasons.join('; ') || 'onbekende reden'}`;
}

/** The markdown report that belongs next to the json. */
function renderHoldoutMarkdown(report) {
  const total = report.totals.restaurants;
  const lines = [];
  lines.push('# Holdout-meting menulezer — 50 restaurants in Breda');
  lines.push('');
  lines.push('Meting volgens besluit 021 (BE-73, #180): dezelfde motor als de startvulling van BE-71');
  lines.push('(ophalen, lezen en de volledigheidseis, **ongewijzigd**) over de top 50 van');
  lines.push('`ops/data/breda-restaurant-candidates.json`. **Alleen meten:** er is niets naar `data/`');
  lines.push('geschreven en er is niets gepubliceerd. Alleen de eigen websites van de kandidaten,');
  lines.push('geen AI, geen OCR en geen betaalde dienst. Wie blokkeert wordt overgeslagen.');
  lines.push('');
  lines.push(`- Ophaaldatum: ${report.scraped || '—'}`);
  lines.push(`- Gegenereerd: ${report.generatedAt || '—'}`);
  lines.push(`- Selectie: de top ${total} van de kandidatenlijst, ${report.totals.measured} daarvan meetbaar`);
  if (report.selection.excluded.length === 0) {
    lines.push('- Vooraf overgeslagen: niemand (Wolfslaar staat niet in deze top 50)');
  } else {
    for (const skipped of report.selection.excluded) {
      lines.push(`- Vooraf overgeslagen: ${skipped.name} (${skipped.website || '—'}) — ${skipped.reason}`);
    }
  }
  lines.push(`- Geslaagd: ${report.totals.done} · overgeslagen: ${report.totals.skipped} · geblokkeerd: ${report.totals.blocked} (van ${total})`);
  lines.push('');
  lines.push('## De 25 bekende tegenover de 50 onbekende');
  lines.push('');
  lines.push('| Batch | Geslaagd | Van | Percentage |');
  lines.push('| --- | --- | --- | --- |');
  const baselineDone = report.baseline.done === null ? '—' : report.baseline.done;
  const baselineTotal = report.baseline.restaurants === null ? '—' : report.baseline.restaurants;
  lines.push(`| 25 bestaande restaurants (BE-71, ronde 3) | ${baselineDone} | ${baselineTotal} | ${percentText(report.baseline.percent)} |`);
  lines.push(`| 50 onbekende restaurants (deze meting) | ${report.totals.done} | ${total} | ${percentText(report.comparison.holdoutPercent)} |`);
  lines.push('');
  const difference = Number.isFinite(report.comparison.differencePoints)
    ? `${String(report.comparison.differencePoints).replace('.', ',')} procentpunt`
    : 'niet te berekenen';
  lines.push(`Verschil: ${difference}. ${report.totals.blocked} site(s) blokkeerden en zijn niet meegeteld als meting.`);
  lines.push('');
  lines.push('## Werkwijze');
  lines.push('');
  lines.push('- De kaart is gelezen door de ongewijzigde motor van BE-71: geen regel versoepeld, geen');
  lines.push('  uitzondering voor één site, niets naar `data/` geschreven.');
  lines.push('- De plek van de kaart komt uit wat de motor zelf ophaalde. Herkende hij gerechten, dan zegt de');
  lines.push('  bron het: een html-pagina op de eigen site is `subpagina`, een pdf met tekstlaag is');
  lines.push('  `pdf met tekstlaag` (de kaart-url in de tabel laat zien of dat de homepage of een subpagina is).');
  lines.push('- Herkende hij geen gerechten, dan beslist het bewijs uit de cache van de pagina\'s die hij wél');
  lines.push('  ophaalde, in deze volgorde: `pdf zonder tekstlaag`, `afbeelding` (een afbeelding met een');
  lines.push('  menuwoord in de naam op een pagina zonder prijzen), `extern platform` (een menulink naar een');
  lines.push('  andere host), `JavaScript` (minder dan 200 woorden en geen menulink) en anders');
  lines.push('  `geen kaart online`.');
  lines.push('- `geblokkeerd` is geen oordeel over de kaart: robots.txt of het netwerk weigerde het ophalen, dus');
  lines.push('  er is niets gelezen. Er is nooit om een blokkade heen gewerkt.');
  lines.push('- De steekproef per geslaagde kaart is de eerste 10 gerechten met een prijs, in kaartvolgorde.');
  lines.push('');
  lines.push('## Plek van de kaart');
  lines.push('');
  lines.push('| Plek | Aantal |');
  lines.push('| --- | --- |');
  for (const [place, count] of Object.entries(report.places).sort((a, b) => b[1] - a[1])) lines.push(`| ${place} | ${count} |`);
  lines.push('');
  lines.push('## Redenen, gegroepeerd');
  lines.push('');
  const groupEntries = Object.entries(report.groups);
  if (groupEntries.length === 0) lines.push('Geen overgeslagen of geblokkeerde restaurants.');
  for (const [text, count] of groupEntries.sort((a, b) => b[1] - a[1])) lines.push(`- ${text}: ${count}`);
  lines.push('');
  lines.push('## Per kandidaat');
  lines.push('');
  lines.push('| # | Restaurant | Kaart | Vorm | Plek | Gerechten | Met prijs | Uitkomst |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const row of report.restaurants) {
    // The Kaart column only names a page that really held dishes; a page the
    // reader refused outright is not the card (the Plek column says what it is).
    const card = row.dishCount > 0 ? row.menuUrl || '—' : '—';
    lines.push(`| ${row.rank} | ${row.name} | ${card} | ${row.form || '—'} | ${row.place} | ${row.dishCount} | ${row.pricedCount} | ${statusText(row)} |`);
  }
  lines.push('');
  lines.push('## Bewijs per niet-geslaagde kandidaat');
  lines.push('');
  const withoutCard = report.restaurants.filter((row) => row.status !== 'done');
  if (withoutCard.length === 0) {
    lines.push('Elke kandidaat slaagde.');
  } else {
    lines.push('| # | Restaurant | Plek | Bewijs |');
    lines.push('| --- | --- | --- | --- |');
    for (const row of withoutCard) lines.push(`| ${row.rank} | ${row.name} | ${row.place} | ${row.placeEvidence || '—'} |`);
  }
  lines.push('');
  lines.push('## Steekproef: de eerste 10 gerechten met prijs per geslaagde kaart');
  lines.push('');
  const passed = report.restaurants.filter((row) => row.status === 'done');
  if (passed.length === 0) lines.push('Geen enkele kaart slaagde, dus er is niets om na te kijken.');
  for (const row of passed) {
    lines.push(`### ${row.name} (${row.rank})`);
    lines.push('');
    lines.push(`${row.menuUrl} · ${row.form} · ${row.dishCount} gerechten, ${row.pricedCount} met prijs.`);
    lines.push('');
    for (const dish of row.sample) lines.push(`- ${dish.name}${dish.category ? ` (${dish.category})` : ''} — ${euro(dish.price)}`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

/**
 * The measurement itself: the top 50 through the unchanged engine, one
 * restaurant after the other, over the shared fetcher (so the per-host rest and
 * the cache of BE-71 apply). `pages` may be injected; otherwise the html comes
 * from the cache once the run is done, so classification costs no request.
 */
async function runHoldout({ candidates, fetcher, scraped, generatedAt, sampleSize = SAMPLE_SIZE, baseline = null, cacheDir = DEFAULT_CACHE_DIR, pages = null, log } = {}) {
  const { selected, excluded } = selectCandidates(candidates, { size: sampleSize });
  const source = fetcher || createSourceFetcher({ cacheDir });
  const say = typeof log === 'function' ? log : (message) => console.log(message);
  const results = [];

  say(`Holdout: ${selected.length} kandidaten meten, ${excluded.length} vooraf overgeslagen.`);
  for (const candidate of selected) {
    const record = await bootstrapRestaurant({
      restaurantId: `rank-${candidate.rank}`,
      restaurant: { name: candidate.name, website: candidate.website },
      // Empty on purpose: this run never writes a card, so no existing entry of
      // data/menus.json is read or replaced.
      menus: {},
      scraped,
      fetcher: source,
    });
    results.push({ candidate, record });
    const state = record.status === 'done' ? `geslaagd, ${record.dishCount} gerechten` : `${record.status}: ${(record.reasons || []).map((reason) => reason.text).join('; ')}`;
    say(`${candidate.rank} ${candidate.name}: ${state}`);
  }

  const htmlByUrl = pages instanceof Map ? pages : loadHtmlCache(cacheDir);
  return buildHoldoutReport({ results, excluded, baseline, scraped, generatedAt, pages: htmlByUrl });
}

/** Writes the two report files and nothing else. */
function writeReports({ report, outDir = REPORT_DIR }) {
  const json = path.join(outDir, `${REPORT_BASENAME}.json`);
  const md = path.join(outDir, `${REPORT_BASENAME}.md`);
  fs.writeFileSync(json, serialize(report));
  fs.writeFileSync(md, renderHoldoutMarkdown(report));
  return { md, json };
}

/** The totals of the BE-71 report on the 25 known restaurants, or null. */
function readBaseline(file = BASELINE_REPORT) {
  try {
    const previous = readJson(file);
    const totals = previous && previous.totals;
    if (!totals) return null;
    return { restaurants: totals.restaurants, done: totals.done };
  } catch (error) {
    return null;
  }
}

async function main() {
  const file = readJson(CANDIDATES_FILE);
  const report = await runHoldout({
    candidates: file.candidates || [],
    scraped: today(),
    generatedAt: new Date().toISOString(),
    baseline: readBaseline(),
  });
  const written = writeReports({ report });
  console.log(`Rapport: ${written.md} en ${written.json}.`);
  console.log(`Geslaagd ${report.totals.done} van ${report.totals.restaurants} · overgeslagen ${report.totals.skipped} · geblokkeerd ${report.totals.blocked}.`);
  for (const [place, count] of Object.entries(report.places).sort((a, b) => b[1] - a[1])) console.log(`  ${place}: ${count}`);
  console.log('Niets naar data/ geschreven.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}

module.exports = {
  CANDIDATES_FILE,
  BASELINE_REPORT,
  FIRST_DISHES,
  MAX_CACHE_FILE_BYTES,
  PLACES,
  REPORT_BASENAME,
  REPORT_DIR,
  SAMPLE_SIZE,
  SKIP_RULES,
  THIN_PAGE_WORDS,
  buildHoldoutReport,
  classifyPlace,
  externalMenuLinks,
  inspectPage,
  loadHtmlCache,
  menuImageCount,
  pageText,
  percent,
  pricedDishes,
  readBaseline,
  renderHoldoutMarkdown,
  runHoldout,
  selectCandidates,
  skipReasonFor,
  writeReports,
};

