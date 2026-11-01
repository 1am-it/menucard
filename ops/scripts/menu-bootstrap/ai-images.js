#!/usr/bin/env node
'use strict';

// BE-71 (#176, besluit 021, R8 in ../corrections.md) — leest de menukaarten die
// alleen als afbeelding bestaan met de bestaande AI-menuherkenning.
//
//   node ops/scripts/menu-bootstrap/ai-images.js --plan   # wat, en de maximale kosten
//   node ops/scripts/menu-bootstrap/ai-images.js          # de echte run (eigenaar)
//
// De eigenaar draait dit zelf. `--plan` doet geen verzoek aan Anthropic en vraagt
// niet om de sleutel: het toont de restaurants, de afbeeldingen en de maximale
// kosten van de hele run.
//
// De sleutel komt alleen uit een verborgen, gemaskeerde invoer in de terminal:
// nooit uit een omgevingsvariabele, een argument of een bestand. Hij wordt niet
// gelogd, niet gecachet, niet in de uitvoer of in een foutmelding geschreven en
// niet aan een child-proces gegeven. Na gebruik wordt de invoerbuffer gewist;
// een onveranderlijke JS-string kan daarna nog bestaan tot de garbage collector
// hem opruimt — verder dan dat gaat het in deze taal niet.
//
// Grenzen: een harde kostengrens van € 1 voor de hele run, geen herpogingen,
// alleen de eigen website van het restaurant, robots.txt en minstens twee
// seconden rust via de bestaande ophaallaag (./fetchSource.js), en alleen
// afbeeldingen die PNG, JPEG, GIF of WebP zijn.
//
// De uitvoer staat los: per restaurant .local/menu-bootstrap-ai/<id>.json met de
// gerechten, de bron-afbeelding per gerecht, het model en de kosten. Daarna
// gelden dezelfde eis en dezelfde regels (R1-R9) als voor html, via de motor
// (./normalizeMenu.js en ./completeMenu.js). Dit script schrijft nooit naar
// data/.

const fs = require('node:fs');
const path = require('node:path');

const { createSourceFetcher, cacheKey } = require('./fetchSource');
const { fetchSameSiteWithRedirects } = require('../../../src/lib/restaurantSourceFetch');
const {
  collectMenuImages,
  mediaTypeForUrl,
  estimateOf,
  planImageRead,
  base64Bytes,
  MAX_MENU_IMAGES,
  MAX_IMAGE_BYTES,
  IMAGE_MEDIA_TYPES,
} = require('../../../src/lib/menuImageRead');
const {
  ANTHROPIC_MODEL,
  ANTHROPIC_API_KEY_ENV,
  createAnthropicStructuredCall,
} = require('../../../src/lib/menuExtractionAnthropicCall');
const { DEFAULT_EXTRACTION_LIMITS, loadMenuExtractionProtocol } = require('../../../src/lib/menuExtractionProtocol');
const { normaliseMenu } = require('./normalizeMenu');
const { assessCompleteMenu } = require('./completeMenu');

/** De harde grens voor de hele run (eigenaar, 1 nov 2026, 8b). */
const BUDGET_EUR_CENTS = 100;
/** Eén verzoek per restaurant, met een ruime maar vaste limiet. */
const CALL_TIMEOUT_MS = 180_000;
const MAX_OUTPUT_TOKENS = DEFAULT_EXTRACTION_LIMITS.maxOutputTokens;

const OUTPUT_DIR = path.join('.local', 'menu-bootstrap-ai');
const IMAGE_CACHE_DIR = path.join('.local', 'menu-bootstrap-cache', 'ai-images');
const REPORT_FILE = path.join('docs', 'menu-bootstrap-report.json');

/** Alleen deze vier soorten worden bekeken (grens van de opdracht). */
const ALLOWED_MEDIA_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
// De bestaande lezer kent geen GIF. Een GIF wordt dus nooit verstuurd maar met
// een reden overgeslagen: nooit een halve of een omgebouwde afbeelding.
const PROVIDER_MEDIA_TYPES = Object.freeze(Object.values(IMAGE_MEDIA_TYPES));
const SUPPORTED_MEDIA_TYPES = Object.freeze(ALLOWED_MEDIA_TYPES.filter((type) => PROVIDER_MEDIA_TYPES.includes(type)));

/**
 * De vijf restaurants met de soort "afbeelding" uit het rapport: het bewijs
 * staat in ../corrections.md (cache, ronde 3). De paden zijn de pagina's uit dat
 * bewijs; `imageRestaurantsFromReport` controleert ze tegen het rapport en houdt
 * alleen de eigen host van het restaurant over.
 */
const IMAGE_RESTAURANTS = Object.freeze({
  1: { path: '/menu' },
  8: { path: '/menukaart-restaurant-2/' },
  11: { path: '/cafe-lunchkaart/' },
  20: { path: '/gerechten' },
  23: { path: '/menu/' },
});

const SECRET_MASK = '[verborgen]';

/**
 * Ronde 6, punt 1 (Lead-review 6557509881): alleen een afbeelding met een
 * menuwoord in de bestandsnaam, de alt-tekst of het bijschrift is een kaart.
 * De pagina-hint van de bestaande lezer (`/menu/` in de url) is hier te ruim:
 * daardoor gingen portretten en camerafoto's mee.
 */
const MENU_WORD = /(?:menu|kaart|lunch|diner|dinner|gerechten|gerecht|prijslijst|prijzen|spijskaart|menus)/i;
/** Nooit een kaart: camera- en studionamen, portretten, logo's en sfeerbeelden. */
const NEVER_A_MENU = /(?:logo|icon|favicon|portret|portrait|studio|dsc\d|img[_-]?\d{3,}|sfeer|ambiance|interieur|interior|gevel|terras|\bteam\b|personeel)/i;

/** Hooguit drie afbeeldingen per AI-verzoek (ronde 6, punt 2). */
const IMAGE_CHUNK_SIZE = 3;

/**
 * De extra instructie van deze run (ronde 6, punt 3). Hij komt náást het
 * vastgepinde protocol (MENU-EXTRACTION.md blijft ongewijzigd) en vraagt om
 * trouw aan de bron: geen verzonnen namen, geen verzonnen toevoegingen, en een
 * tussenkop wordt een categorie.
 */
const AI_READ_INSTRUCTIONS = [
  'Aanvulling voor deze startvulling (gaat vóór de algemene stijlregels, niet boven de bron):',
  '1. Neem een gerechtnaam letterlijk over van de afbeelding, inclusief spelling en hoofdletters.',
  '2. Maak van een tussenkop op de kaart een categorie; verzin geen categorieën en voeg geen gerechten toe.',
  '3. Voeg niets toe dat niet op de afbeelding staat: geen "(salade)", geen vertaling, geen toelichting.',
  '4. Een gerecht dat je niet zeker kunt lezen, laat je weg; verzin geen naam en geen prijs.',
].join('\n');

function text(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function hostOf(value) {
  try {
    return new URL(String(value)).host.toLowerCase();
  } catch {
    return null;
  }
}

/** De sleutel mag nergens opduiken, ook niet in een foutmelding van de SDK. */
function redact(value, secret) {
  const source = typeof value === 'string' ? value : String(value === undefined || value === null ? '' : value);
  if (typeof secret !== 'string' || secret === '') return source;
  return source.split(secret).join(SECRET_MASK);
}

/** De invoerbuffer wissen, voor zover dat in JavaScript kan. */
function wipeSecret(buffer) {
  if (Buffer.isBuffer(buffer)) buffer.fill(0);
}

/**
 * De vijf restaurants uit het rapport, met de kaartpagina uit het correctielog.
 * Een id dat het rapport niet kent, of een pad op een andere host, wordt
 * overgeslagen met een reden: nooit een gok.
 */
function imageRestaurantsFromReport(report) {
  const entries = new Map(((report && report.restaurants) || []).map((entry) => [String(entry.id), entry]));
  const restaurants = [];
  const skipped = [];
  for (const [id, spec] of Object.entries(IMAGE_RESTAURANTS)) {
    const entry = entries.get(id);
    if (!entry) {
      skipped.push({ id, reason: 'not_in_report' });
      continue;
    }
    const website = text(entry.website);
    let pageUrl = null;
    try {
      pageUrl = new URL(spec.path, website).href;
    } catch {
      pageUrl = null;
    }
    if (!pageUrl || hostOf(pageUrl) !== hostOf(website)) {
      skipped.push({ id, reason: 'other_host', detail: website || null });
      continue;
    }
    restaurants.push({ id, name: entry.name || id, website, pageUrl });
  }
  return { restaurants, skipped };
}

/* ------------------------------------------------------------------ *
 * Kiezen: alleen een echte kaart, en hooguit één extra ophaalstap
 * ------------------------------------------------------------------ */

/** De bestandsnaam van een url, zonder query, fragment en mappen. */
function fileNameOf(value) {
  const parts = String(value || '').split(/[?#]/)[0].split('/');
  return parts.length > 0 ? parts[parts.length - 1] : '';
}

/**
 * Is dit een kaart? Het menuwoord moet in de bestandsnaam, de alt-tekst, de
 * titel of het bijschrift staan, en een camera- of studionummer, een portret of
 * een logo valt altijd af. Zo blijven echte kaartafbeeldingen over en gaan
 * portretten (`Studio-1412…`, `DSC05737`) en sfeerfoto's niet naar de AI.
 */
function isStrictMenuImage({ url, alt, caption } = {}) {
  const haystack = [fileNameOf(url), alt, caption].filter(Boolean).join(' ');
  if (haystack.trim() === '') return false;
  if (NEVER_A_MENU.test(haystack)) return false;
  return MENU_WORD.test(haystack);
}

/**
 * De kandidaten van één pagina, met per afgevallen afbeelding de reden. De
 * bestaande lezer levert de url's, de alt-teksten en het bijschrift; deze
 * strengere regel beslist daarna wat er werkelijk naar de AI gaat.
 */
function collectStrictMenuImages({ html, pageUrl, limit = MAX_MENU_IMAGES } = {}) {
  const found = collectMenuImages({ html, pageUrl, limit: Number.MAX_SAFE_INTEGER });
  const images = [];
  const dropped = [];
  for (const candidate of found) {
    if (images.length >= limit) break;
    if (isStrictMenuImage(candidate)) {
      images.push({ number: images.length + 1, url: candidate.url, mediaType: candidate.mediaType, alt: candidate.alt || '' });
      continue;
    }
    const haystack = [fileNameOf(candidate.url), candidate.alt, candidate.caption].filter(Boolean).join(' ');
    dropped.push({ url: candidate.url, reason: NEVER_A_MENU.test(haystack) ? 'never_a_menu' : 'no_menu_word' });
  }
  return { images, dropped };
}

/** De anchors van een pagina, met hun tekst, voor de linkstap. */
function pageLinks({ html, pageUrl } = {}) {
  const source = String(html || '');
  const pageHost = hostOf(pageUrl);
  if (!pageHost) return [];
  const links = [];
  for (const match of source.matchAll(/<a\b([^>]*)>([\s\S]{0,600}?)<\/a>/gi)) {
    const href = /\bhref\s*=\s*["']([^"']*)["']/i.exec(match[1]);
    if (!href) continue;
    let absolute;
    try {
      absolute = new URL(decodeAttribute(href[1]), pageUrl).href;
    } catch {
      continue;
    }
    if (hostOf(absolute) !== pageHost) continue;
    const label = decodeAttribute(match[2].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    const title = (/\btitle\s*=\s*["']([^"']*)["']/i.exec(match[1]) || [])[1] || '';
    links.push({ url: absolute, label, title: decodeAttribute(title) });
  }
  return links;
}

/** Dezelfde decodering als de bestaande lezer, hier lokaal gehouden. */
function decodeAttribute(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

/**
 * De kandidaten voor de ene extra ophaalstap: een link met een menuwoord op
 * dezelfde host, die nog niet gelezen is. Een pdf telt ook mee — die kan deze
 * lezer niet lezen, maar de vondst hoort wel in het rapport.
 */
function menuSourceLinks({ html, pageUrl, limit = 1 } = {}) {
  const seen = new Set();
  const links = [];
  for (const link of pageLinks({ html, pageUrl })) {
    if (links.length >= limit) break;
    const clean = link.url.split('#')[0];
    if (clean === String(pageUrl).split('#')[0]) continue;
    if (seen.has(clean)) continue;
    const haystack = [fileNameOf(clean), link.label, link.title].filter(Boolean).join(' ');
    if (!MENU_WORD.test(haystack) || NEVER_A_MENU.test(haystack)) continue;
    seen.add(clean);
    links.push({ url: clean, kind: /\.pdf$/i.test(fileNameOf(clean)) ? 'pdf' : 'html' });
  }
  return links;
}

/** Kaarten die alleen als svg bestaan: geen leesbare afbeelding in deze ronde. */
function svgMenuUrls({ html, pageUrl, limit = 10 } = {}) {
  const pageHost = hostOf(pageUrl);
  if (!pageHost) return [];
  const source = String(html || '');
  const urls = [];
  for (const tag of source.match(/<(?:img|a|source)\b[^>]*>/gi) || []) {
    const raw = /\b(?:src|data-src|href|srcset)\s*=\s*["']([^"']*)["']/i.exec(tag);
    if (!raw) continue;
    const value = raw[1].split(',')[0].trim().split(/\s+/)[0];
    let absolute;
    try {
      absolute = new URL(decodeAttribute(value), pageUrl).href;
    } catch {
      continue;
    }
    if (hostOf(absolute) !== pageHost) continue;
    if (!/\.svg$/i.test(fileNameOf(absolute))) continue;
    if (!MENU_WORD.test(`${fileNameOf(absolute)} ${decodeAttribute(tag)}`) || NEVER_A_MENU.test(fileNameOf(absolute))) continue;
    if (!urls.includes(absolute) && urls.length < limit) urls.push(absolute);
  }
  return urls;
}

/* ------------------------------------------------------------------ *
 * De sleutel: alleen interactief, met een masker
 * ------------------------------------------------------------------ */

/**
 * Leest één regel van de terminal zonder hem te tonen: elk teken wordt een `*`
 * op dezelfde regel. Alleen een echte terminal (TTY) kan dit; zonder terminal
 * weigert de functie, want dan zou de sleutel via een pijp of een bestand
 * binnenkomen. Resolves de ingevoerde bytes als Buffer, zodat de aanroeper ze
 * na gebruik kan wissen.
 */
function readHiddenLine({ prompt = '', input = process.stdin, output = process.stderr } = {}) {
  return new Promise((resolve, reject) => {
    if (!input || input.isTTY !== true || typeof input.setRawMode !== 'function') {
      reject(new Error('de sleutel kan alleen in een interactieve terminal worden ingevoerd'));
      return;
    }
    const buffer = Buffer.alloc(512);
    let length = 0;
    const done = (error) => {
      try {
        input.removeListener('data', onData);
      } catch {
        // Een stream die zijn listener niet kan verwijderen, eindigt de lezing ook.
      }
      try {
        input.setRawMode(false);
      } catch {
        // Best effort: de shell herstelt de terminalstand bij het afsluiten.
      }
      if (typeof input.pause === 'function') input.pause();
      if (typeof output.write === 'function') output.write('\n');
      if (error) {
        wipeSecret(buffer);
        reject(error);
        return;
      }
      resolve(buffer.subarray(0, length));
    };
    const onData = (chunk) => {
      const value = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      for (const char of value) {
        if (char === '\u0003') {
          done(new Error('afgebroken'));
          return;
        }
        if (char === '\r' || char === '\n') {
          done(null);
          return;
        }
        if (char === '\u007f' || char === '\b') {
          if (length > 0) {
            length -= 1;
            if (typeof output.write === 'function') output.write('\b \b');
          }
          continue;
        }
        // Alleen zichtbare invoer: een geplakte stuurtekst hoort niet in de sleutel.
        if (char < ' ') continue;
        if (length >= buffer.length) continue;
        buffer.write(char, length, 'utf8');
        length += Buffer.byteLength(char, 'utf8');
        if (typeof output.write === 'function') output.write('*');
      }
    };
    if (typeof output.write === 'function') output.write(prompt);
    input.setRawMode(true);
    input.on('data', onData);
    if (typeof input.resume === 'function') input.resume();
  });
}

/* ------------------------------------------------------------------ *
 * Ophalen: één pagina, de afbeeldingen daarvan, via de bestaande laag
 * ------------------------------------------------------------------ */

/**
 * De afbeeldingsdownload met dezelfde regels als de rest van de startvulling:
 * robots.txt, dezelfde site, rust tussen verzoeken en de cache onder
 * .local/menu-bootstrap-cache/. Een geweigerd verzoek wordt ook gecachet, zodat
 * een tweede run de site niet opnieuw lastigvalt.
 */
function createImageLoader({ fetcher, cacheDir = IMAGE_CACHE_DIR, now = () => new Date() } = {}) {
  if (!fetcher || typeof fetcher.pacedFetch !== 'function') throw new TypeError('een fetcher is verplicht');
  const fileFor = (url) => path.join(cacheDir, `${cacheKey(url)}.json`);

  function store(entry) {
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(fileFor(entry.url), JSON.stringify(entry));
    } catch {
      // Een cache die niet schrijfbaar is kost een tweede verzoek, nooit de run.
    }
  }

  function load(url) {
    try {
      const parsed = JSON.parse(fs.readFileSync(fileFor(url), 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  return async function loadImage(url) {
    const cached = load(url);
    if (cached) {
      if (cached.ok !== true) return { ...cached, fromCache: true };
      return {
        ok: true,
        url,
        finalUrl: cached.finalUrl,
        contentType: cached.contentType,
        mediaType: cached.mediaType,
        fetchedAt: cached.fetchedAt,
        bytes: Buffer.from(String(cached.bodyBase64 || ''), 'base64'),
        fromCache: true,
      };
    }

    const gate = await fetcher.robotsCheck(url);
    if (!gate.shouldFetchPage) {
      const entry = { ok: false, url, reason: 'robots', detail: gate.robotsStatus || null };
      store(entry);
      return entry;
    }

    let fetched;
    try {
      fetched = await fetchSameSiteWithRedirects(url, {
        fetchImpl: fetcher.pacedFetch,
        fetchOptions: { encoding: 'buffer', maxBytes: MAX_IMAGE_BYTES },
        robotsCheck: fetcher.robotsCheck,
      });
    } catch (error) {
      const entry = { ok: false, url, reason: (error && error.reason) || 'fetch_failed' };
      store(entry);
      return entry;
    }

    const response = fetched.response;
    const contentType = response.contentType || '';
    const finalUrl = response.finalUrl || url;
    const mediaType = ALLOWED_MEDIA_TYPES.includes(contentType) ? contentType : mediaTypeForUrl(finalUrl);
    // Alleen PNG, JPEG, GIF en WebP worden bekeken; GIF kan de bestaande lezer
    // niet verwerken en wordt daarom met een reden overgeslagen.
    if (!mediaType || !ALLOWED_MEDIA_TYPES.includes(mediaType)) {
      const entry = { ok: false, url, reason: 'not_an_image', detail: contentType || null };
      store(entry);
      return entry;
    }
    if (!SUPPORTED_MEDIA_TYPES.includes(mediaType)) {
      const entry = { ok: false, url, reason: 'unsupported_media_type', detail: mediaType };
      store(entry);
      return entry;
    }
    const bytes = response.bytes || Buffer.from(String(response.body || ''), 'utf8');
    if (bytes.length > MAX_IMAGE_BYTES) {
      const entry = { ok: false, url, reason: 'image_too_large', detail: `${bytes.length} bytes` };
      store(entry);
      return entry;
    }
    const entry = {
      ok: true,
      url,
      finalUrl,
      contentType,
      mediaType,
      fetchedAt: now().toISOString(),
      bodyBase64: bytes.toString('base64'),
    };
    store(entry);
    return { ...entry, bytes, fromCache: false };
  };
}

/** De standaard paginalader: dezelfde fetcher, dezelfde cache, dezelfde rust. */
function defaultLoadPage(fetcher) {
  return async function loadPage(url) {
    const page = await fetcher.getPage(url);
    if (!page.ok) return { ok: false, url, reason: page.reason || 'not_read', detail: page.detail || null };
    if (page.kind !== 'html') return { ok: false, url, reason: 'not_html', detail: page.kind || null };
    return { ok: true, url, finalUrl: page.finalUrl || url, text: page.text, fromCache: page.fromCache === true };
  };
}

/**
 * Wat de run zou lezen, zonder netwerk naar Anthropic: per restaurant de
 * kaartpagina en de kandidaten-afbeeldingen die erop staan, met de schatting en
 * het maximum van die lezing.
 *
 * Ronde 6, punt 1 (Lead-review 6557509881): alleen een afbeelding met een
 * menuwoord (bestandsnaam, alt of bijschrift) is een kaart. Vindt de pagina er
 * geen, dan volgt hooguit één extra ophaalstap op dezelfde site — een link met
 * een menuwoord, of de vondst dat de kaart een pdf of een svg is. Wat er per site
 * gevonden is, staat in `imageSearch` en komt zo in het rapport.
 */
async function planImages({ restaurants = [], loadPage, log = () => {} } = {}) {
  const planned = [];
  let maxCostEurCents = 0;
  for (const restaurant of restaurants) {
    const record = {
      ...restaurant,
      images: [],
      estimate: null,
      status: 'planned',
      reason: null,
      imageSearch: { pageUrl: restaurant.pageUrl, found: 0, kept: 0, dropped: [], extraStep: null, svgMenus: [] },
    };
    let page;
    try {
      page = await loadPage(restaurant.pageUrl);
    } catch (error) {
      page = { ok: false, reason: 'page_error', detail: (error && error.message) || null };
    }
    if (!page || page.ok !== true) {
      record.status = 'skipped';
      record.reason = (page && page.reason) || 'not_read';
      planned.push(record);
      log(`${restaurant.id} ${restaurant.name}: overgeslagen, ${record.reason}`);
      continue;
    }
    record.pageUrl = page.finalUrl || restaurant.pageUrl;
    record.imageSearch.pageUrl = record.pageUrl;

    const selected = collectStrictMenuImages({ html: page.text, pageUrl: record.pageUrl, limit: MAX_MENU_IMAGES });
    record.imageSearch.found = selected.images.length + selected.dropped.length;
    record.imageSearch.dropped = selected.dropped.slice(0, 12);
    record.imageSearch.svgMenus = svgMenuUrls({ html: page.text, pageUrl: record.pageUrl });
    record.images = selected.images.filter((image) => SUPPORTED_MEDIA_TYPES.includes(image.mediaType)).slice(0, MAX_MENU_IMAGES);

    // Hooguit één extra ophaalstap op dezelfde site (ronde 6, punt 1).
    if (record.images.length === 0) {
      const [candidate] = menuSourceLinks({ html: page.text, pageUrl: record.pageUrl, limit: 1 });
      if (candidate && candidate.kind === 'html') {
        let second;
        try {
          second = await loadPage(candidate.url);
        } catch (error) {
          second = { ok: false, reason: 'page_error', detail: (error && error.message) || null };
        }
        record.imageSearch.extraStep = {
          url: candidate.url,
          ok: second && second.ok === true,
          reason: (second && second.reason) || null,
          images: 0,
          dropped: 0,
        };
        if (second && second.ok === true) {
          const extraPageUrl = second.finalUrl || candidate.url;
          const extra = collectStrictMenuImages({ html: second.text, pageUrl: extraPageUrl, limit: MAX_MENU_IMAGES });
          record.imageSearch.extraStep.images = extra.images.length;
          record.imageSearch.extraStep.dropped = extra.dropped.length;
          const extraSvg = svgMenuUrls({ html: second.text, pageUrl: extraPageUrl });
          if (extraSvg.length > 0) record.imageSearch.svgMenus = extraSvg;
          record.images = extra.images.filter((image) => SUPPORTED_MEDIA_TYPES.includes(image.mediaType)).slice(0, MAX_MENU_IMAGES);
          if (record.images.length > 0) record.pageUrl = extraPageUrl;
        }
      } else if (candidate && candidate.kind === 'pdf') {
        // Een pdf kan deze lezer niet lezen; de vondst gaat als reden het rapport in.
        record.imageSearch.extraStep = { url: candidate.url, ok: null, reason: 'pdf', images: 0, dropped: 0 };
        record.imageSearch.pdfMenu = candidate.url;
      }
    }
    record.imageSearch.kept = record.images.length;
    record.estimate = estimateOf(record.images.length, 0);
    if (record.images.length === 0) {
      record.status = 'skipped';
      record.reason = record.imageSearch.svgMenus.length > 0
        ? 'menu_is_svg'
        : record.imageSearch.pdfMenu
          ? 'menu_is_pdf'
          : 'no_images';
    } else {
      maxCostEurCents += record.estimate.maxEurCents;
    }
    planned.push(record);
    log(
      `${record.id} ${record.name}: ${record.imageSearch.found} gevonden, ${record.images.length} kaart(en)${
        record.estimate && record.images.length > 0 ? `, maximaal ${record.estimate.maxEurCents} cent` : `, overgeslagen (${record.reason})`
      } — ${record.pageUrl}`,
    );
  }
  return { restaurants: planned, maxCostEurCents };
}

/* ------------------------------------------------------------------ *
 * Lezen: het antwoord van de bestaande AI-lezing naar de vorm van de motor
 * ------------------------------------------------------------------ */

/** De bron-afbeelding van één gerecht, uit zijn bewijs ("afbeelding N"). */
function sourceImageOf(evidence, byNumber) {
  const locator = evidence && typeof evidence.locator === 'string' ? evidence.locator : '';
  const match = /afbeelding\s+(\d+)/i.exec(locator);
  if (!match) return null;
  return byNumber.get(Number(match[1])) || null;
}

/**
 * Vertaalt het antwoord van de AI-lezing naar de vorm die de motor leest
 * (`{ categories: [{ name, uncertain, items: [{ name, desc, price }] }],
 * attention }`). Een toeslag (`supplementOf`) blijft een toeslag (R5), een
 * gerecht met meer dan één prijs wordt een aandachtspunt, en een onzekere sectie
 * blijft onzeker — zodat dezelfde eis en dezelfde regels gelden als voor html.
 */
function toMenuReading(answer, { images = [] } = {}) {
  const byNumber = new Map((Array.isArray(images) ? images : []).map((image) => [image.number, image.url]));
  const categories = [];
  const attention = [];
  const menus = Array.isArray(answer && answer.menus) ? answer.menus : [];
  for (const menu of menus) {
    for (const category of Array.isArray(menu && menu.categories) ? menu.categories : []) {
      const items = [];
      for (const item of Array.isArray(category && category.items) ? category.items : []) {
        const name = text(item && item.name);
        if (!name) continue;
        const variants = Array.isArray(item.priceVariants) ? item.priceVariants : [];
        const known = item.priceStatus === 'known' && Number.isInteger(item.amountMinorUnits);
        if (!known && (item.priceStatus === 'multiple_undecomposed' || variants.length > 0)) {
          attention.push({ code: 'price_variants', detail: name });
        }
        items.push({
          name,
          desc: text(item.description),
          price: known ? item.amountMinorUnits / 100 : null,
          ...(item.supplementOf ? { priceIsSupplement: true } : {}),
          sourceImage: sourceImageOf(item.evidence, byNumber),
        });
      }
      categories.push({ name: text(category && category.name), uncertain: category && category.uncertain === true, items });
    }
  }
  return { title: menus.length > 0 ? text(menus[0].title) || null : null, categories, attention };
}

/** De gerechten als één lijst, met categorie en bron-afbeelding per gerecht. */
function flattenDishes(reading) {
  const dishes = [];
  for (const category of (reading && reading.categories) || []) {
    for (const item of category.items || []) {
      dishes.push({
        name: item.name,
        category: category.name,
        price: item.price,
        sourceImage: item.sourceImage || null,
        ...(item.priceIsSupplement ? { priceIsSupplement: true } : {}),
      });
    }
  }
  return dishes;
}

/** De afbeeldingen in groepen van hooguit `size` (ronde 6, punt 2). */
function chunkImages(images, size = IMAGE_CHUNK_SIZE) {
  const list = Array.isArray(images) ? images : [];
  if (!Number.isInteger(size) || size <= 0) throw new RangeError('een groep moet minstens één afbeelding hebben');
  const chunks = [];
  for (let index = 0; index < list.length; index += size) chunks.push(list.slice(index, index + size));
  return chunks;
}

/**
 * De antwoorden van de groepen samenvoegen tot één lezing: dezelfde categorienaam
 * wordt één categorie (in de volgorde van de eerste vondst), de gerechten komen
 * erachter en een onzekere groep blijft onzeker.
 */
function mergeMenuReadings(readings) {
  const categories = [];
  const byName = new Map();
  const attention = [];
  let title = null;
  for (const reading of Array.isArray(readings) ? readings : []) {
    if (!reading) continue;
    if (title === null && reading.title) title = reading.title;
    for (const category of reading.categories || []) {
      const existing = byName.get(category.name);
      if (existing) {
        existing.items.push(...(category.items || []));
        if (category.uncertain === true) existing.uncertain = true;
        continue;
      }
      const copy = { name: category.name, uncertain: category.uncertain === true, items: [...(category.items || [])] };
      byName.set(category.name, copy);
      categories.push(copy);
    }
    attention.push(...(reading.attention || []));
  }
  return { title, categories, attention };
}

/**
 * Het vastgepinde protocol blijft ongewijzigd; de extra instructie van deze
 * startvulling komt er als laatste blok achter (ronde 6, punt 3). Zo is in de
 * test te zien dat de tekst uit MENU-EXTRACTION.md letterlijk vooraan staat.
 */
function composeProtocol(protocol) {
  const pinned = typeof protocol === 'string' ? protocol : '';
  if (pinned.trim() === '') return AI_READ_INSTRUCTIONS;
  return `${pinned.replace(/\s+$/, '')}\n\n${AI_READ_INSTRUCTIONS}\n`;
}


/* ------------------------------------------------------------------ *
 * De run: één verzoek per restaurant, met de harde kostengrens
 * ------------------------------------------------------------------ */

/**
 * Leest elk gepland restaurant met de AI, in groepen van hooguit drie
 * afbeeldingen per verzoek. De werkelijke kosten van elk verzoek komen uit de
 * eigen usage van de provider en worden direct opgeteld; kan het volgende
 * verzoek de grens van `budgetEurCents` niet meer reserveren, dan stopt de run.
 * Er zijn geen herpogingen: een fout of een onbekende prijs stopt de run in
 * plaats van hem te herhalen.
 */
async function readImages({
  plan,
  adapter,
  loadImage,
  writeOutput = () => {},
  log = () => {},
  secret = '',
  protocol = '',
  model = ANTHROPIC_MODEL,
  scraped = null,
  budgetEurCents = BUDGET_EUR_CENTS,
} = {}) {
  const outcomes = [];
  let spentEurCents = 0;
  let stop = null;

  for (const record of plan.restaurants) {
    const outcome = {
      id: record.id,
      name: record.name,
      pageUrl: record.pageUrl,
      status: 'skipped',
      reason: null,
      message: null,
      dishCount: 0,
      pricedCount: 0,
      complete: false,
      costEurCents: 0,
      attempted: false,
    };
    outcomes.push(outcome);
    if (stop) {
      outcome.reason = stop;
      log(`${record.id} ${record.name}: overgeslagen, ${stop}`);
      continue;
    }
    if (record.status !== 'planned' || !Array.isArray(record.images) || record.images.length === 0) {
      outcome.reason = record.reason || 'no_images';
      continue;
    }

    const images = [];
    for (const candidate of record.images) {
      const loaded = await loadImage(candidate.url);
      if (!loaded || loaded.ok !== true) {
        log(`${record.id}: afbeelding ${candidate.number} overgeslagen (${(loaded && loaded.reason) || 'not_read'})`);
        continue;
      }
      images.push({
        number: candidate.number,
        url: loaded.finalUrl || candidate.url,
        mediaType: loaded.mediaType,
        data: loaded.bytes.toString('base64'),
      });
    }
    if (images.length === 0) {
      outcome.reason = 'no_images_read';
      continue;
    }

    // Ronde 6, punt 2: hooguit drie afbeeldingen per verzoek. De grenzen van een
    // afbeeldingslezing en de reservering gelden per verzoek, en er zijn nog
    // steeds geen herpogingen.
    outcome.attempted = true;
    outcome.chunks = [];
    outcome.attempts = 0;
    const readings = [];
    let failure = null;
    for (const chunk of chunkImages(images, IMAGE_CHUNK_SIZE)) {
      // De AI telt de afbeeldingen per verzoek: binnen dit verzoek is de eerste
      // afbeelding weer "afbeelding 1". De pagina-orde blijft in `sourceImages`.
      const local = chunk.map((image, index) => ({ ...image, number: index + 1, pageNumber: image.number }));
      const check = planImageRead({ sources: [{ id: record.id, url: record.pageUrl, images: chunk }] });
      if (!check.ok) {
        failure = { reason: check.reason || 'reading_refused' };
        break;
      }
      const reserve = estimateOf(chunk.length, 0).maxEurCents;
      if (spentEurCents + reserve > budgetEurCents) {
        stop = 'budget_ceiling';
        failure = { reason: stop };
        break;
      }
      let answer;
      outcome.attempts += 1;
      try {
        answer = await adapter.call({
          protocol: composeProtocol(protocol),
          sources: [{ id: record.id, url: record.pageUrl, kind: 'image', images: local }],
          limits: { maxOutputTokens: MAX_OUTPUT_TOKENS, callTimeoutMs: CALL_TIMEOUT_MS },
        });
      } catch (error) {
        const failedCall = (error && error.callRecord) || null;
        const cost = failedCall && Number.isInteger(failedCall.costEurCents) ? failedCall.costEurCents : null;
        if (cost !== null) {
          spentEurCents += cost;
          outcome.costEurCents += cost;
        }
        outcome.message = redact((error && error.message) || 'het verzoek is mislukt', secret);
        // Geen herpoging; een onbekende prijs stopt de run.
        if (cost === null) stop = 'cost_unknown';
        failure = { reason: (error && error.code) || 'call_failed' };
        break;
      }

      const call = adapter.lastCall || null;
      const cost = call && Number.isInteger(call.costEurCents) ? call.costEurCents : null;
      if (cost !== null) {
        spentEurCents += cost;
        outcome.costEurCents += cost;
      } else {
        stop = 'cost_unknown';
      }
      outcome.chunks.push({ images: chunk.map((image) => image.number), costEurCents: cost });
      readings.push(toMenuReading(answer, { images: local }));
      if (cost === null) {
        failure = { reason: 'cost_unknown' };
        break;
      }
    }

    if (failure) {
      // Een grens die vóór het eerste verzoek al blokkeert, is een overslag en
      // geen mislukte lezing; daarna is het een mislukt verzoek zonder herpoging.
      outcome.status = failure.reason === 'budget_ceiling' && outcome.attempts === 0 ? 'skipped' : 'failed';
      outcome.reason = failure.reason;
      log(`${record.id} ${record.name}: ${outcome.status === 'skipped' ? 'overgeslagen' : 'mislukt'}, ${outcome.reason}`);
      continue;
    }

    const menuReading = mergeMenuReadings(readings);
    if (menuReading.categories.length === 0) {
      outcome.status = 'failed';
      outcome.reason = 'answer_without_categories';
      log(`${record.id} ${record.name}: mislukt, het antwoord bevat geen categorieën`);
      continue;
    }

    const normalised = normaliseMenu(menuReading, { restaurantName: record.name });
    const assessment = assessCompleteMenu(normalised);
    const dishes = flattenDishes(normalised);
    outcome.status = 'read';
    outcome.dishCount = assessment.dishCount;
    outcome.pricedCount = assessment.pricedCount;
    outcome.complete = assessment.ok;
    outcome.calls = outcome.chunks.length;
    writeOutput({
      restaurantId: record.id,
      name: record.name,
      pageUrl: record.pageUrl,
      scraped,
      model,
      // Ronde 6, punt 3: de vlag en de bron-afbeelding per gerecht, zodat de
      // Lead elke prijs tegen de afbeelding kan nakijken.
      aiRead: true,
      instruction: { appended: true },
      budget: { ceilingEurCents: budgetEurCents, spentEurCents },
      chunks: outcome.chunks,
      sourceImages: images.map((image) => ({
        number: image.number,
        url: image.url,
        mediaType: image.mediaType,
        bytes: base64Bytes(image.data),
      })),
      dishes,
      reading: normalised,
      assessment,
      writesData: false,
    });
    log(
      `${record.id} ${record.name}: ${assessment.dishCount} gerechten, ${assessment.pricedCount} met prijs, ${outcome.costEurCents} cent in ${outcome.calls} verzoek(en)${assessment.ok ? '' : ` — niet compleet: ${assessment.reasons.map((reason) => reason.code).join(', ')}`}`,
    );
  }

  return { outcomes, spentEurCents, stop };
}

/**
 * De hele run. `planOnly` doet geen verzoek en vraagt niet om de sleutel: het
 * plant alleen. Anders wordt de sleutel één keer interactief gevraagd, gebruikt
 * en daarna gewist — de sleutel komt niet uit de omgeving, een argument of een
 * bestand, en gaat niet naar een child-proces.
 */
async function runAiImages(options = {}) {
  const {
    restaurants = [],
    planOnly = false,
    loadPage,
    loadImage,
    promptKey,
    createCall,
    writeOutput = () => {},
    log = () => {},
    protocol = '',
    budgetEurCents = BUDGET_EUR_CENTS,
    model = ANTHROPIC_MODEL,
    scraped = null,
  } = options;

  const plan = await planImages({ restaurants, loadPage, log });
  if (planOnly) {
    log(`Maximaal ${plan.maxCostEurCents} cent van de harde grens van ${budgetEurCents} cent, zonder verzoek en zonder sleutel.`);
    return { planOnly: true, plan, outcomes: [], spentEurCents: 0, stop: null, calls: 0 };
  }

  const secretBuffer = await promptKey();
  let secret = null;
  try {
    secret = Buffer.isBuffer(secretBuffer) ? secretBuffer.toString('utf8') : String(secretBuffer || '');
    if (secret === '') throw new Error('er is geen sleutel ingevoerd');
    const adapter = createCall(secret);
    if (!adapter || adapter.enabled !== true || typeof adapter.call !== 'function') {
      throw new Error('de AI-aanroep is niet beschikbaar');
    }
    const result = await readImages({
      plan,
      adapter,
      loadImage,
      writeOutput,
      log,
      secret,
      protocol,
      model,
      scraped,
      budgetEurCents,
    });
    const calls = result.outcomes.reduce(
      (total, outcome) => total + (Number.isInteger(outcome.attempts) ? outcome.attempts : 0),
      0,
    );
    return { planOnly: false, plan, ...result, calls };
  } finally {
    // De ingevoerde bytes wissen en de string loslaten; meer kan JavaScript
    // niet doen voor een onveranderlijke string.
    wipeSecret(secretBuffer);
    secret = null;
  }
}

function parseArgs(argv) {
  const args = { plan: false, only: null, help: false };
  for (const arg of argv) {
    if (arg === '--plan') args.plan = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg.startsWith('--only=')) {
      args.only = arg.slice('--only='.length).split(',').map((id) => id.trim()).filter(Boolean);
    }
  }
  return args;
}

/** De Nederlandse kalenderdatum van de lezing, zoals bij de rest van de kaarten. */
function today(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** De uitvoer staat los van de app: alleen .local, nooit data/. */
function createWriter({ outputDir = OUTPUT_DIR } = {}) {
  const written = [];
  const write = (record) => {
    fs.mkdirSync(outputDir, { recursive: true });
    const file = path.join(outputDir, `${record.restaurantId}.json`);
    fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
    written.push(file);
    return file;
  };
  write.files = written;
  return write;
}

/** Een samenvatting van de run, ook in .local: wat er gelezen is en wat het kostte. */
function writeRunSummary({ outputDir = OUTPUT_DIR, summary } = {}) {
  fs.mkdirSync(outputDir, { recursive: true });
  const file = path.join(outputDir, 'run.json');
  fs.writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`);
  return file;
}

const USAGE = `Gebruik:
  node ops/scripts/menu-bootstrap/ai-images.js --plan
  node ops/scripts/menu-bootstrap/ai-images.js [--only=1,8]

--plan toont de restaurants met een kaart als afbeelding, hun afbeeldingen en de
maximale kosten van de hele run. Het doet geen verzoek aan Anthropic en vraagt
niet om de sleutel.

Alleen een afbeelding met een menuwoord (bestandsnaam, alt of bijschrift) is een
kaart; portretten, camera- en studionummers en logo's vallen af. Vindt een pagina
er geen, dan volgt hooguit één extra ophaalstap op dezelfde site en staat de
vondst (kaart, pdf of svg) in het plan. Een restaurant met meer dan drie
afbeeldingen wordt in groepen van drie gelezen; de reservering en de kostengrens
gelden per verzoek.

Zonder --plan volgt de echte run. De sleutel wordt dan één keer verborgen in de
terminal gevraagd; hij komt niet uit een omgevingsvariabele, een argument of een
bestand. De harde grens is ${BUDGET_EUR_CENTS} cent (€ 1) voor de hele run, er
zijn geen herpogingen, en de uitvoer gaat naar ${OUTPUT_DIR} — nooit naar data/.
`;

async function main(argv = process.argv.slice(2), deps = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const report = deps.report || JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8'));
  const { restaurants, skipped } = imageRestaurantsFromReport(report);
  for (const entry of skipped) console.log(`${entry.id}: overgeslagen (${entry.reason})`);
  const selected = args.only ? restaurants.filter((restaurant) => args.only.includes(restaurant.id)) : restaurants;
  if (selected.length === 0) {
    console.error('geen restaurant met een kaart als afbeelding gevonden');
    return 2;
  }

  const fetcher = deps.fetcher || createSourceFetcher({});
  const writer = createWriter();
  const protocol = args.plan ? null : loadMenuExtractionProtocol();

  const result = await runAiImages({
    restaurants: selected,
    planOnly: args.plan,
    loadPage: defaultLoadPage(fetcher),
    loadImage: createImageLoader({ fetcher }),
    promptKey: () => readHiddenLine({ prompt: 'Anthropic-sleutel (wordt niet getoond): ' }),
    createCall: (secret) =>
      createAnthropicStructuredCall({ env: { [ANTHROPIC_API_KEY_ENV]: secret }, model: ANTHROPIC_MODEL }),
    writeOutput: writer,
    log: (line) => console.log(line),
    protocol: protocol ? protocol.text : '',
    model: ANTHROPIC_MODEL,
    scraped: today(),
  });

  if (result.planOnly) return 0;
  const summary = {
    scraped: today(),
    calls: result.calls,
    spentEurCents: result.spentEurCents,
    stop: result.stop,
    read: result.outcomes.filter((outcome) => outcome.status === 'read').length,
    complete: result.outcomes.filter((outcome) => outcome.complete).length,
    outcomes: result.outcomes,
    writesData: false,
  };
  writeRunSummary({ summary });
  console.log(
    `Klaar: ${summary.read} gelezen, ${summary.complete} compleet, ${summary.calls} verzoek(en), ${summary.spentEurCents} cent van ${BUDGET_EUR_CENTS}.`,
  );
  if (result.stop) console.log(`Gestopt: ${result.stop}.`);
  return 0;
}

if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${(error && error.message) || 'de run is mislukt'}\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  AI_READ_INSTRUCTIONS,
  ALLOWED_MEDIA_TYPES,
  BUDGET_EUR_CENTS,
  CALL_TIMEOUT_MS,
  IMAGE_CACHE_DIR,
  IMAGE_CHUNK_SIZE,
  IMAGE_RESTAURANTS,
  MAX_OUTPUT_TOKENS,
  MENU_WORD,
  NEVER_A_MENU,
  OUTPUT_DIR,
  REPORT_FILE,
  SECRET_MASK,
  USAGE,
  chunkImages,
  collectStrictMenuImages,
  composeProtocol,
  createImageLoader,
  createWriter,
  defaultLoadPage,
  flattenDishes,
  imageRestaurantsFromReport,
  isStrictMenuImage,
  main,
  menuSourceLinks,
  mergeMenuReadings,
  pageLinks,
  parseArgs,
  planImages,
  readHiddenLine,
  readImages,
  redact,
  runAiImages,
  sourceImageOf,
  svgMenuUrls,
  toMenuReading,
  today,
  wipeSecret,
  writeRunSummary,
};
