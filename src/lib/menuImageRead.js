'use strict';

// BE-33 (#79) — a menu that only exists as an image or as a scan.
//
// Pure and offline, like the rest of the extraction chain: no fetch, no SDK, no
// database and no clock. It answers only four questions, each with its own
// test:
//   1. which images of *this* website are menu images (not a logo, not an
//      atmosphere photo, never another site);
//   2. may this reading happen at all, within the fixed limits (10 images or 10
//      pages per reading, one fixed maximum file size);
//   3. what does the human see before and after (the estimate, the notice);
//   4. how is the origin of a dish that came from an image worded, and when is
//      it refused.
//
// The rule of criterion 3 lives here and in the validator: an image quote can
// never be checked literally, so every dish read from an image must name its
// origin ("afbeelding N" or "pagina N") and is shown as "Controle nodig".
// Nothing is approved or published by any of this.

// Criterion 2: at most 10 images or 10 pages per reading, and one fixed maximum
// file size (the provider's own documented limit for an image is 5 MB).
// BE-35 ronde 2 (#84): the live Al Dente pages have 7 (and more) menu images of
// one menu; six was lower than the real page, so the page was refused. Ten is
// the same order of magnitude and is read in page order, never silently zero.
const MAX_MENU_IMAGES = 10;
const MAX_SCAN_PAGES = 10;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
// BE-35 ronde 3 (#84): a picture whose *declared* longest side is smaller than
// this (both width and height attributes) is an icon or thumbnail, not a menu
// page. Only an explicit HTML size counts, so a missing attribute is never a
// reason to drop an image, and a portrait menu scan (1200x1700) stays.
const MIN_MENU_IMAGE_EDGE = 600;

const CONTROLE_NODIG = 'Controle nodig';
const IMAGE_MEDIA_TYPES = Object.freeze({
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
});
// The words that make a file or an alt text a menu image. Deliberately the same
// vocabulary the deterministic analysis already uses for this signal.
const MENU_HINT = /(?:menu|menukaart|kaart|lunch|diner|dinner|spijskaart|gerechten|food|drinks|dranken)/i;
// Never a menu: logo's, icons, atmosphere and other channels. A menu photo can
// not be recognised as a menu, so it is not offered; another site is refused
// earlier by the same-host rule.
const NOT_MENU = /(?:logo|icon|favicon|avatar|sprite|placeholder|sfeer|ambiance|interior|interieur|terras|gevel|team|personeel|social|instagram|facebook|google|tripadvisor|review|sterren|award)/i;
// BE-35 ronde 3 (#84): WordPress names a generated header (or site icon)
// "cropped-…". Such a file sits on every page and is never a menu page, even on
// a page whose URL or title names the menu.
const SITE_ASSET_NAME = /cropped-/i;

// The words the model must use for the origin of a dish read from an image.
const IMAGE_LOCATOR_HINT = 'afbeelding N of pagina N';
const IMAGE_EVIDENCE_RULE =
  'Een citaat uit een afbeelding of scan is niet letterlijk te controleren. Elk gerecht uit een afbeeldingsbron krijgt daarom een locator in de vorm "afbeelding N" of "pagina N"; een gerecht zonder die herkomst wordt geweigerd.';

const REASONS = Object.freeze({
  source_empty: 'Er is geen leesbare tekst, afbeelding of pagina om te lezen.',
  too_many_pages: `Deze PDF heeft meer dan ${MAX_SCAN_PAGES} pagina's; maximaal ${MAX_SCAN_PAGES} per lezing.`,
  image_too_large: `Een afbeelding is groter dan ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB; die wordt niet verstuurd.`,
  document_too_large: `De PDF is groter dan ${Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024))} MB; die wordt niet verstuurd.`,
  page_count_unknown: `Het aantal pagina's van deze PDF is niet vast te stellen; maximaal ${MAX_SCAN_PAGES} pagina's per lezing.`,
  image_unavailable: 'De menu-afbeeldingen konden niet worden opgehaald.',
});


function hostOfUrl(value) {
  try {
    return new URL(String(value)).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

function absoluteUrl(value, pageUrl) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (raw === '' || /^(?:data|javascript|mailto):/i.test(raw)) return null;
  try {
    const url = new URL(raw, pageUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

/** The provider media type of an image URL, or null when it is not an image. */
function mediaTypeForUrl(value) {
  const text = String(value || '').split(/[?#]/)[0];
  const match = /\.([a-z0-9]+)$/i.exec(text);
  if (!match) return null;
  return IMAGE_MEDIA_TYPES[match[1].toLowerCase()] || null;
}

function decodeAttribute(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function attributeOf(tag, name) {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i');
  const match = pattern.exec(tag);
  return match ? decodeAttribute(match[1]) : '';
}


// BE-35 ronde 2 (#84): "does this text already contain a menu?" — one pure,
// tested rule. A price pattern is a euro amount, a comma/dot amount like 12,50
// or 12.50, or 12,- . A date such as 27.10.2026 is not a price. A page with
// fewer than three such lines has no menu text (navigation, footer and opening
// hours alone), even when it does have readable text.
const MENU_PRICE_PATTERN = /(?:€\s*\d|\b\d{1,4}\s*[.,]\s*\d{2}\b|\b\d{1,4}\s*[.,]\s*-)/;
const DATE_LIKE_PATTERN = /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g;
const MENU_TEXT_MIN_PRICE_LINES = 3;

/** How many lines of a plain-text page carry a price. */
function menuPriceLineCount(text) {
  const lines = String(text || '').split('\n');
  let count = 0;
  for (const line of lines) {
    const withoutDates = line.replace(DATE_LIKE_PATTERN, ' ');
    if (MENU_PRICE_PATTERN.test(withoutDates)) count += 1;
  }
  return count;
}

/** Does this readable text hold a menu? Three price lines are the threshold. */
function hasMenuText(text) {
  return menuPriceLineCount(text) >= MENU_TEXT_MIN_PRICE_LINES;
}

/** The `<title>` of a page, decoded, or an empty string. */
function pageTitleOf(html) {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(String(html || ''));
  return match ? decodeAttribute(match[1].replace(/\s+/g, ' ').trim()) : '';
}

/**
 * BE-35 ronde 2 (#84): the page itself can name the menu. A URL such as
 * "/menu-classico/" or "/menukaart-restaurant-2/" and a `<title>` with a menu
 * word are a page-wide hint: images of this same website are then candidates
 * even when the file name says nothing about a menu. NOT_MENU still applies.
 */
function pageHasMenuContext({ html, pageUrl } = {}) {
  return MENU_HINT.test(`${String(pageUrl || '')} ${pageTitleOf(html)}`);
}

function edgeOf(tag, name) {
  const raw = attributeOf(tag, name).trim();
  if (raw === '') return null;
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * BE-35 ronde 3 (#84): an image that HTML itself declares smaller than a menu
 * page is an icon or thumbnail. The *longest* declared side decides, so a
 * portrait menu scan with a short width stays a candidate.
 */
function isSmallImageTag(tag) {
  if (typeof tag !== 'string' || tag === '') return false;
  const width = edgeOf(tag, 'width');
  const height = edgeOf(tag, 'height');
  if (width === null || height === null) return false;
  return Math.max(width, height) < MIN_MENU_IMAGE_EDGE;
}

/** The file name of an image URL, without the query, fragment or folders. */
function fileNameOfUrl(value) {
  const text = String(value || '').split(/[?#]/)[0];
  const parts = text.split('/');
  return parts.length > 0 ? parts[parts.length - 1] : '';
}

/** BE-35 ronde 3 (#84): a WordPress generated header or site icon ("cropped-"). */
function isSiteAssetUrl(value) {
  return SITE_ASSET_NAME.test(fileNameOfUrl(value));
}

/**
 * Is this image a menu image of the same website? The rule is intentionally
 * narrow and explainable: the same host as the page, an image extension, no
 * logo/atmosphere word, and a menu word in the file name, the alt text, the
 * link around it or — since BE-35 ronde 2 (#84) — in the page itself. A logo or
 * an atmosphere photo is never included, and neither is any other website
 * (criterion 2: no Instagram, no Google).
 */
function isMenuImageCandidate({ url, alt, linkText, small } = {}, pageUrl, { pageHint = false } = {}) {
  const absolute = absoluteUrl(url, pageUrl);
  if (!absolute) return false;
  const host = hostOfUrl(absolute);
  const pageHost = hostOfUrl(pageUrl);
  if (!host || !pageHost || host !== pageHost) return false;
  if (!mediaTypeForUrl(absolute)) return false;
  if (small === true) return false;
  // BE-35 ronde 3 (#84): a WordPress header or site icon is never a menu page.
  if (isSiteAssetUrl(absolute)) return false;
  const haystack = [absolute, alt, linkText].filter(Boolean).join(' ');
  if (NOT_MENU.test(haystack)) return false;
  return MENU_HINT.test(haystack) || pageHint;
}

/**
 * The WordPress size suffix of one file ("-300x212", "-768x1024"), used as the
 * grouping key so that the same picture is offered once. The version without
 * the suffix is the original and is preferred.
 */
function fileVariantKey(url) {
  return String(url || '').replace(/-\d+x\d+(\.[a-z0-9]+)$/i, '$1');
}

/**
 * The menu images of one page, in page order, de-duplicated, never more than
 * the limit. Understands the shapes the existing analyzer already reads: a
 * plain `<img>`, a lazy `data-src`, a `<source srcset>` and an `<a>` around the
 * image whose own address or text names the menu.
 */
function collectMenuImages({ html, pageUrl, limit = MAX_MENU_IMAGES } = {}) {
  const source = String(html || '');
  if (source === '' || hostOfUrl(pageUrl) === null) return [];
  // BE-35 ronde 2 (#84): a URL or <title> that names the menu makes the images
  // of this same website candidates, even without a menu word in the file name.
  const pageHint = pageHasMenuContext({ html: source, pageUrl });
  // The links around an image count as a menu hint, so their ranges are read
  // first; the images themselves are then taken in document order.
  const anchors = [];
  for (const match of source.matchAll(/<a\b([^>]*)>([\s\S]{0,2000}?)<\/a>/gi)) {
    anchors.push({
      start: match.index,
      end: match.index + match[0].length,
      hint: `${attributeOf(`<a ${match[1]}>`, 'href')} ${attributeOf(`<a ${match[1]}>`, 'title')}`,
    });
  }
  const hintFor = (index) => {
    const anchor = anchors.find((entry) => entry.start <= index && index <= entry.end);
    return anchor ? anchor.hint : '';
  };
  const found = [];
  const groups = new Map();
  const push = (src, alt, linkText, tag) => {
    const absolute = absoluteUrl(src, pageUrl);
    if (!absolute) return;
    if (!isMenuImageCandidate({ url: absolute, alt, linkText, small: isSmallImageTag(tag) }, pageUrl, { pageHint })) return;
    const key = fileVariantKey(absolute);
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, found.length);
      found.push({ number: 0, url: absolute, alt: String(alt || '').slice(0, 200), mediaType: mediaTypeForUrl(absolute) });
      return;
    }
    // The same file in another WordPress size: keep one image, preferring the
    // original that has no -WxH suffix.
    const stored = found[existing];
    if (stored.url !== key && absolute === key) {
      found[existing] = { ...stored, url: absolute, alt: String(alt || stored.alt || '').slice(0, 200), mediaType: mediaTypeForUrl(absolute) };
    }
  };
  for (const match of source.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    push(
      attributeOf(tag, 'src') || attributeOf(tag, 'data-src'),
      attributeOf(tag, 'alt'),
      `${attributeOf(tag, 'title')} ${hintFor(match.index)}`,
      tag,
    );
  }
  for (const match of source.matchAll(/<source\b[^>]*>/gi)) {
    const srcset = attributeOf(match[0], 'srcset');
    if (srcset) push(srcset.split(',')[0].trim().split(/\s+/)[0], '', hintFor(match.index), match[0]);
  }
  return found.slice(0, limit).map((entry, index) => ({ ...entry, number: index + 1 }));
}

/** The bytes of a base64 string, without decoding it into a new buffer. */
function base64Bytes(value) {
  if (typeof value !== 'string' || value === '') return 0;
  return Math.floor((value.replace(/=+$/, '').length * 3) / 4);
}

function modeOfSource(source) {
  if (!source) return 'none';
  if (typeof source.text === 'string' && source.text.trim() !== '') return 'text';
  if (Array.isArray(source.images) && source.images.length > 0) return 'image';
  if (typeof source.documentBase64 === 'string' && source.documentBase64.length > 0) return 'document';
  return 'none';
}

function estimateOf(imageCount, pageCount) {
  return {
    imageCount,
    pageCount,
    // A reservation, not a price: the real cost comes from the provider's own
    // usage and is counted in the same month ledger. The hard per-call maximum
    // stays the existing one.
    maxEurCents: 30,
    label:
      imageCount > 0
        ? `Geschat: ${imageCount} ${imageCount === 1 ? 'afbeelding' : 'afbeeldingen'} · maximaal 30 cent per lezing`
        : pageCount > 0
          ? `Geschat: ${pageCount} ${pageCount === 1 ? 'pagina' : "pagina's"} · maximaal 30 cent per lezing`
          : 'Geschat: 1 tekstbron · maximaal 30 cent per lezing',
  };
}

function refused(reason, extra = {}) {
  return { ok: false, mode: 'none', reason, message: REASONS[reason], imageCount: 0, pageCount: 0, sources: [], estimate: null, ...extra };
}

/**
 * BE-35 ronde 3 (#84): an image that one reading finds on more than one page is
 * site layout (header, decoration), not a menu image. Pure: it only looks at the
 * candidate URLs of the pages of this reading.
 */
function sharedSiteImageKeys(pages = []) {
  const seen = new Map();
  (Array.isArray(pages) ? pages : []).forEach((page, index) => {
    if (!page) return;
    const pageId = typeof page.pageUrl === 'string' && page.pageUrl !== '' ? page.pageUrl : `page-${index + 1}`;
    for (const image of (Array.isArray(page.images) ? page.images : [])) {
      const url = image && typeof image === 'object' ? image.url : image;
      if (typeof url !== 'string' || url === '') continue;
      const key = fileVariantKey(url);
      if (!seen.has(key)) seen.set(key, new Set());
      seen.get(key).add(pageId);
    }
  });
  const shared = new Set();
  for (const [key, pagesOfImage] of seen) {
    if (pagesOfImage.size > 1) shared.add(key);
  }
  return shared;
}

/** Is this image one of the images that several pages of this reading share? */
function isSharedSiteImage(url, sharedKeys) {
  if (!sharedKeys || typeof sharedKeys.has !== 'function') return false;
  return sharedKeys.has(fileVariantKey(url));
}

/** The honest limitation of a reading that was cut to its first ten images. */
function readingImageLimitNotice(availableImageCount) {
  return `Deze lezing heeft ${availableImageCount} menu-afbeeldingen; de eerste ${MAX_MENU_IMAGES} zijn gelezen.`;
}

/**
 * What may go to the same model, within the fixed limits, before any budget is
 * spent. Text, images and scans can go together; an image page sends its own
 * images and a scan PDF goes as one document (never more than 10 pages, and only
 * when its page count is known). BE-35 ronde 3 (#84): the ten images are a limit
 * of the whole reading, in source and page order. A reading with at least one
 * usable image is never refused; it names the real number instead.
 */
function planImageRead({ sources } = {}) {
  const list = (Array.isArray(sources) ? sources : []).filter((source) => source && typeof source.id === 'string');
  if (list.length === 0) return refused('source_empty');

  const textSources = list.filter((source) => modeOfSource(source) === 'text');
  // BE-35 ronde 3 (#84): an image source whose images could not be fetched (or
  // were all cut) still counts as an image source of this reading, so the real
  // number of menu images is visible in the plan. It contributes no image and is
  // never sent empty to the model.
  const imageSources = list.filter((source) => modeOfSource(source) === 'image'
    || (source.imageRead === true && modeOfSource(source) === 'none'));
  const documentSources = list.filter((source) => modeOfSource(source) === 'document');
  if (textSources.length === 0 && imageSources.length === 0 && documentSources.length === 0) return refused('source_empty');

  // The first ten menu images of this reading, in source and page order.
  const selectedPerSource = new Map();
  const images = [];
  let availableImageCount = 0;
  let readingImageCount = 0;
  let remaining = MAX_MENU_IMAGES;
  for (const source of imageSources) {
    const entries = Array.isArray(source.images) ? source.images : [];
    const offered = Number.isInteger(source.imageCandidates) && source.imageCandidates > entries.length
      ? source.imageCandidates
      : entries.length;
    availableImageCount += offered;
    // BE-35 ronde 3 (#84): the reading itself can name the real total even when
    // a page fell outside the ten and is no source of this reading any more.
    if (Number.isInteger(source.readingImageCandidates) && source.readingImageCandidates > readingImageCount) {
      readingImageCount = source.readingImageCandidates;
    }
    let selected = 0;
    for (const image of entries) {
      if (base64Bytes(image.data) > MAX_IMAGE_BYTES) return refused('image_too_large', { imageUrl: image.url || null });
      if (remaining > 0) {
        images.push({ sourceId: source.id, url: image.url || null, mediaType: image.mediaType || mediaTypeForUrl(image.url) });
        remaining -= 1;
        selected += 1;
      }
    }
    if (selected > 0) selectedPerSource.set(source.id, selected);
  }
  if (readingImageCount > availableImageCount) availableImageCount = readingImageCount;
  const imageCount = images.length;
  // Only a reading that really used all ten places was cut by the limit; a
  // failed download is named per source and is no reading limit.
  const truncatedImages = imageCount >= MAX_MENU_IMAGES && availableImageCount > imageCount;

  let pageCount = 0;
  const documents = [];
  for (const source of documentSources) {
    if (base64Bytes(source.documentBase64) > MAX_DOCUMENT_BYTES) return refused('document_too_large', { sourceUrl: source.url || null });
    if (!Number.isInteger(source.pageCount) || source.pageCount < 1) return refused('page_count_unknown', { sourceUrl: source.url || null });
    if (source.pageCount > MAX_SCAN_PAGES) return refused('too_many_pages', { pageCount: source.pageCount, sourceUrl: source.url || null });
    pageCount += source.pageCount;
    documents.push({ sourceId: source.id, url: source.url || null, pageCount: source.pageCount });
  }

  const hasImages = imageCount > 0;
  const hasDocuments = documents.length > 0;
  const hasText = textSources.length > 0;
  // Nothing usable at all is still an honest refusal, never an empty reading.
  if (!hasImages && !hasDocuments && !hasText) return refused('source_empty');
  const mode = hasImages && (hasDocuments || hasText) ? 'mixed' : hasImages ? 'image' : hasDocuments ? 'document' : 'text';
  const limitation = truncatedImages ? readingImageLimitNotice(availableImageCount) : null;

  // What goes to the model, in source order: a text source by its text, an
  // image source only when at least one of its images is read, a scan as one
  // document. An image page whose images were all cut is not sent empty.
  const plannedSources = [];
  for (const source of list) {
    const sourceMode = modeOfSource(source);
    if (sourceMode === 'text') {
      plannedSources.push({ id: source.id, url: source.url || null, mode: 'text' });
    } else if (sourceMode === 'document') {
      plannedSources.push({ id: source.id, url: source.url || null, mode: 'document', pageCount: source.pageCount });
    } else if (sourceMode === 'image' && selectedPerSource.has(source.id)) {
      plannedSources.push({ id: source.id, url: source.url || null, mode: 'image', imageCount: selectedPerSource.get(source.id) });
    }
  }

  return {
    ok: true,
    mode,
    reason: null,
    message: null,
    imageCount,
    pageCount,
    availableImageCount,
    limitation,
    sources: plannedSources,
    estimate: estimateOf(imageCount, pageCount),
  };
}

/**
 * The origin of a dish read from an image: exactly "afbeelding N" or
 * "pagina N". Anything else (a line number, an empty locator, a bare quote) is
 * not a provenance of an image reading and is refused by the validator.
 */
function imageProvenance(locator) {
  if (typeof locator !== 'string') return null;
  const text = locator.trim();
  const match = /^(afbeelding|pagina)\s+(\d{1,3})$/i.exec(text);
  if (!match) return null;
  const number = Number(match[2]);
  if (!Number.isInteger(number) || number < 1) return null;
  const kind = match[1].toLowerCase() === 'afbeelding' ? 'image' : 'page';
  return {
    kind,
    number,
    label: kind === 'image' ? `gelezen van afbeelding ${number}` : `gelezen van pagina ${number}`,
  };
}

/** The provenance sentence of one review row, or null for a text row. */
function provenanceLabel(source, locator) {
  if (!source || modeOfSource(source) === 'text') return null;
  const provenance = imageProvenance(locator);
  return provenance ? provenance.label : null;
}

/**
 * The honest notice above the reading, per mode. `Controle nodig` always. A
 * reading that was cut to its first ten images says so in the same sentence.
 */
function imageReadNotice(plan) {
  if (!plan || plan.ok !== true) return null;
  if (plan.mode === 'text') return null;
  const cut = plan.limitation ? ` ${plan.limitation}` : '';
  const images = `${plan.imageCount} ${plan.imageCount === 1 ? 'menu-afbeelding' : 'menu-afbeeldingen'}`;
  if (plan.mode === 'document') {
    return `De AI leest deze PDF als document (${plan.pageCount} ${plan.pageCount === 1 ? 'pagina' : "pagina's"}). Een citaat uit een scan is niet letterlijk te controleren: elk gerecht krijgt de herkomst "gelezen van pagina N" en het label "${CONTROLE_NODIG}".${cut}`;
  }
  if (plan.mode === 'mixed') {
    if (plan.pageCount > 0) {
      return `De AI leest ${images} en deze PDF als document (${plan.pageCount} ${plan.pageCount === 1 ? 'pagina' : "pagina's"}). Een citaat uit een afbeelding of scan is niet letterlijk te controleren: elk gerecht uit beeld krijgt de herkomst "afbeelding N" of "pagina N" en het label "${CONTROLE_NODIG}".${cut}`;
    }
    return `De AI leest de tekstbronnen en ${images} van deze website. Een citaat uit een afbeelding is niet letterlijk te controleren: elk gerecht uit een afbeelding krijgt de herkomst "gelezen van afbeelding N" en het label "${CONTROLE_NODIG}".${cut}`;
  }
  return `De AI leest ${images} van deze website. Een citaat uit een afbeelding is niet letterlijk te controleren: elk gerecht krijgt de herkomst "gelezen van afbeelding N" en het label "${CONTROLE_NODIG}".${cut}`;
}

module.exports = {
  MAX_MENU_IMAGES,
  MAX_SCAN_PAGES,
  MAX_IMAGE_BYTES,
  MAX_DOCUMENT_BYTES,
  MIN_MENU_IMAGE_EDGE,
  MENU_TEXT_MIN_PRICE_LINES,
  IMAGE_MEDIA_TYPES,
  MENU_HINT,
  NOT_MENU,
  CONTROLE_NODIG,
  IMAGE_LOCATOR_HINT,
  IMAGE_EVIDENCE_RULE,
  REASONS,
  base64Bytes,
  collectMenuImages,
  estimateOf,
  hasMenuText,
  hostOfUrl,
  imageProvenance,
  imageReadNotice,
  isMenuImageCandidate,
  isSharedSiteImage,
  isSiteAssetUrl,
  mediaTypeForUrl,
  menuPriceLineCount,
  modeOfSource,
  pageHasMenuContext,
  pageTitleOf,
  planImageRead,
  provenanceLabel,
  readingImageLimitNotice,
  sharedSiteImageKeys,
};
