'use strict';

// BE-71 (#176, besluit 021) — the reusable engine for one restaurant: fetch
// (./fetchSource.js), read with the existing deterministic readers
// (./readMenuSource.js), apply the completeness requirement
// (./completeMenu.js). It produces a report entry and, when the card passes, a
// data/menus.json entry (./menuEntry.js). The caller decides whether to write.

const { findSameHostMenuCandidates } = require('../../../src/lib/sameHostDiscovery');
const { createSourceFetcher, MAX_CANDIDATES } = require('./fetchSource');
const { readHtmlMenu, readPdfMenu } = require('./readMenuSource');
const { assessCompleteMenu } = require('./completeMenu');
const { buildExport } = require('./menuEntry');

async function readResponse(page) {
  if (page.kind === 'pdf') return readPdfMenu(page.bytes);
  if (page.kind === 'html') return readHtmlMenu(page.text);
  return { kind: 'other', title: null, categories: [], attention: [], refusal: { status: 'unparsed', reason: 'unsupported_content_type' } };
}

function pricedCountOf(menu) {
  let count = 0;
  for (const category of (menu && menu.categories) || []) {
    for (const item of category.items || []) if (Number.isFinite(item.price)) count += 1;
  }
  return count;
}

function dishCountOf(menu) {
  return ((menu && menu.categories) || []).reduce((sum, category) => sum + (category.items || []).length, 0);
}

/**
 * Runs the whole engine for one restaurant. `restaurant.website` is the only
 * entry point; the same host, one link step and at most five candidates come
 * from the url-intake's own discovery module.
 *
 * Resolves a bounded, reviewable record:
 * `{ restaurantId, name, website, status, reasons, candidates, chosen,
 *    menu, sourceUrl, kind, dishCount, pricedCount, pageCount }`
 * `status` is `done` (a card that meets the requirement), `skipped` (read but
 * refused, with the reasons) or `blocked` (fetching refused).
 */
async function bootstrapRestaurant({ restaurantId, restaurant, menus, scraped, fetcher, cacheDir, fetchImpl, sleep, now } = {}) {
  const record = {
    restaurantId,
    name: (restaurant && restaurant.name) || restaurantId,
    website: (restaurant && restaurant.website) || null,
    status: 'skipped',
    reasons: [],
    candidates: [],
    chosen: null,
    menu: null,
    sourceUrl: null,
    kind: null,
    dishCount: 0,
    pricedCount: 0,
    pageCount: null,
    entry: null,
    entryKey: null,
    menuScope: null,
  };
  if (!record.website) {
    record.reasons.push({ code: 'no_website', text: 'geen website in data/restaurants.json' });
    return record;
  }

  const source = fetcher || createSourceFetcher({ cacheDir, fetchImpl, sleep, now });
  const home = await source.getPage(record.website);
  if (!home.ok) {
    record.status = 'blocked';
    record.reasons.push({ code: home.reason, text: home.detail || home.reason, detail: home.url });
    return record;
  }

  const reads = [];
  const homeRead = await readResponse(home);
  reads.push({ url: home.finalUrl || home.url, kind: homeRead.kind, menu: homeRead, refusal: homeRead.refusal });

  // One link step, only for a homepage that itself holds no complete card.
  const homePasses = homeRead.refusal === null && assessCompleteMenu(homeRead).ok;
  if (!homePasses && home.kind === 'html') {
    const queue = findSameHostMenuCandidates(home.text, home.finalUrl || home.url).slice(0, MAX_CANDIDATES);
    for (const candidate of queue) {
      if (reads.length > MAX_CANDIDATES) break;
      const page = await source.getPage(candidate.url);
      if (!page.ok) {
        reads.push({ url: candidate.url, kind: null, menu: null, refusal: { status: 'not_read', reason: page.reason }, detail: page.detail });
        continue;
      }
      const read = await readResponse(page);
      reads.push({ url: page.finalUrl || candidate.url, kind: read.kind, menu: read, refusal: read.refusal });
      if (read.refusal === null && assessCompleteMenu(read).ok) break;
    }
  }

  record.candidates = reads.map((read) => ({
    url: read.url,
    kind: read.kind,
    dishCount: read.menu ? dishCountOf(read.menu) : 0,
    pricedCount: read.menu ? pricedCountOf(read.menu) : 0,
    refusal: read.refusal || null,
  }));

  // Best = most priced dishes; a card that meets the requirement always wins.
  let best = null;
  for (const read of reads) {
    if (!read.menu) continue;
    const assessment = assessCompleteMenu(read.menu);
    if (assessment.ok) {
      best = { read, assessment };
      break;
    }
    if (!best || assessment.pricedCount > best.assessment.pricedCount) best = { read, assessment };
  }
  if (!best) {
    record.reasons.push({ code: 'no_menu', text: 'geen menukaart gevonden' });
    return record;
  }

  record.kind = best.read.kind;
  record.sourceUrl = best.read.url;
  record.dishCount = best.assessment.dishCount;
  record.pricedCount = best.assessment.pricedCount;
  record.pageCount = best.read.menu.pageCount || null;

  if (!best.assessment.ok) {
    record.reasons.push(...best.assessment.reasons);
    record.status = best.assessment.dishCount === 0 ? 'skipped' : 'skipped';
    return record;
  }

  record.menu = best.read.menu;
  record.status = 'done';
  const built = buildExport({ restaurantId, menu: best.read.menu, menus, sourceUrl: record.sourceUrl, scraped });
  record.entry = built.entry;
  record.entryKey = built.key;
  record.menuScope = built.scope;
  return record;
}

module.exports = { bootstrapRestaurant, dishCountOf, pricedCountOf, readResponse };
