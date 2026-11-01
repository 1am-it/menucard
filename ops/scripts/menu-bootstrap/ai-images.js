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
 */
async function planImages({ restaurants = [], loadPage, log = () => {} } = {}) {
  const planned = [];
  let maxCostEurCents = 0;
  for (const restaurant of restaurants) {
    const record = { ...restaurant, images: [], estimate: null, status: 'planned', reason: null };
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
    record.images = collectMenuImages({ html: page.text, pageUrl: record.pageUrl, limit: MAX_MENU_IMAGES })
      .filter((image) => SUPPORTED_MEDIA_TYPES.includes(image.mediaType))
      .slice(0, MAX_MENU_IMAGES)
      .map((image) => ({ number: image.number, url: image.url, mediaType: image.mediaType }));
    record.estimate = estimateOf(record.images.length, 0);
    if (record.images.length === 0) {
      record.status = 'skipped';
      record.reason = 'no_images';
    } else {
      maxCostEurCents += record.estimate.maxEurCents;
    }
    planned.push(record);
    log(
      `${record.id} ${record.name}: ${record.images.length} afbeelding(en), maximaal ${record.estimate.maxEurCents} cent — ${record.pageUrl}`,
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


/* ------------------------------------------------------------------ *
 * De run: één verzoek per restaurant, met de harde kostengrens
 * ------------------------------------------------------------------ */

/**
 * Leest elk gepland restaurant met één AI-verzoek. De werkelijke kosten van elk
 * verzoek komen uit de eigen usage van de provider en worden direct opgeteld;
 * kan het volgende verzoek de grens van `budgetEurCents` passeren, dan stopt de
 * run. Er zijn geen herpogingen: één verzoek per restaurant, en een fout of een
 * onbekende prijs stopt de run in plaats van hem te herhalen.
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
    // De reservering is het maximum van deze lezing; past die niet meer, dan
    // gaat er geen enkel verzoek meer uit.
    const reserve = record.estimate && Number.isInteger(record.estimate.maxEurCents) ? record.estimate.maxEurCents : 0;
    if (spentEurCents + reserve > budgetEurCents) {
      stop = 'budget_ceiling';
      outcome.reason = stop;
      log(`${record.id} ${record.name}: overgeslagen, de kostengrens van ${budgetEurCents} cent is bereikt`);
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
    // De grenzen van een afbeeldingslezing (MAX_MENU_IMAGES, MAX_IMAGE_BYTES)
    // gelden ook hier, en worden vóór elk betaald verzoek gecontroleerd.
    const reading = planImageRead({ sources: [{ id: record.id, url: record.pageUrl, images }] });
    if (!reading.ok) {
      outcome.reason = reading.reason || 'reading_refused';
      log(`${record.id} ${record.name}: overgeslagen, ${outcome.reason}`);
      continue;
    }

    outcome.attempted = true;
    let answer;
    try {
      answer = await adapter.call({
        protocol,
        sources: [{ id: record.id, url: record.pageUrl, kind: 'image', images }],
        limits: { maxOutputTokens: MAX_OUTPUT_TOKENS, callTimeoutMs: CALL_TIMEOUT_MS },
      });
    } catch (error) {
      const failed = (error && error.callRecord) || null;
      const cost = failed && Number.isInteger(failed.costEurCents) ? failed.costEurCents : null;
      if (cost !== null) spentEurCents += cost;
      outcome.status = 'failed';
      outcome.reason = (error && error.code) || 'call_failed';
      outcome.message = redact((error && error.message) || 'het verzoek is mislukt', secret);
      outcome.costEurCents = cost;
      log(`${record.id} ${record.name}: mislukt, ${outcome.reason}`);
      // Geen herpoging; een onbekende prijs stopt de run.
      if (cost === null) stop = 'cost_unknown';
      continue;
    }

    const call = adapter.lastCall || null;
    const cost = call && Number.isInteger(call.costEurCents) ? call.costEurCents : null;
    outcome.costEurCents = cost;
    if (cost !== null) spentEurCents += cost;

    const menuReading = toMenuReading(answer, { images });
    if (menuReading.categories.length === 0) {
      outcome.status = 'failed';
      outcome.reason = 'answer_without_categories';
      log(`${record.id} ${record.name}: mislukt, het antwoord bevat geen categorieën`);
      if (cost === null) stop = 'cost_unknown';
      continue;
    }

    const normalised = normaliseMenu(menuReading, { restaurantName: record.name });
    const assessment = assessCompleteMenu(normalised);
    const dishes = flattenDishes(normalised);
    outcome.status = 'read';
    outcome.dishCount = assessment.dishCount;
    outcome.pricedCount = assessment.pricedCount;
    outcome.complete = assessment.ok;
    writeOutput({
      restaurantId: record.id,
      name: record.name,
      pageUrl: record.pageUrl,
      scraped,
      model,
      budget: { ceilingEurCents: budgetEurCents, spentEurCents },
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
      `${record.id} ${record.name}: ${assessment.dishCount} gerechten, ${assessment.pricedCount} met prijs, ${cost} cent${assessment.ok ? '' : ` — niet compleet: ${assessment.reasons.map((reason) => reason.code).join(', ')}`}`,
    );
    if (cost === null) stop = 'cost_unknown';
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
    const calls = result.outcomes.filter((outcome) => outcome.attempted).length;
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
  ALLOWED_MEDIA_TYPES,
  BUDGET_EUR_CENTS,
  CALL_TIMEOUT_MS,
  IMAGE_CACHE_DIR,
  IMAGE_RESTAURANTS,
  MAX_OUTPUT_TOKENS,
  OUTPUT_DIR,
  REPORT_FILE,
  SECRET_MASK,
  USAGE,
  createImageLoader,
  createWriter,
  defaultLoadPage,
  flattenDishes,
  imageRestaurantsFromReport,
  main,
  parseArgs,
  planImages,
  readHiddenLine,
  readImages,
  redact,
  runAiImages,
  sourceImageOf,
  toMenuReading,
  today,
  wipeSecret,
  writeRunSummary,
};
