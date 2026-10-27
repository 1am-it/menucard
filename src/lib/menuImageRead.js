'use strict';

// BE-33 (#79) — a menu that only exists as an image or as a scan.
//
// Pure and offline, like the rest of the extraction chain: no fetch, no SDK, no
// database and no clock. It answers only four questions, each with its own
// test:
//   1. which images of *this* website are menu images (not a logo, not an
//      atmosphere photo, never another site);
//   2. may this reading happen at all, within the fixed limits (6 images or 10
//      pages per reading, one fixed maximum file size);
//   3. what does the human see before and after (the estimate, the notice);
//   4. how is the origin of a dish that came from an image worded, and when is
//      it refused.
//
// The rule of criterion 3 lives here and in the validator: an image quote can
// never be checked literally, so every dish read from an image must name its
// origin ("afbeelding N" or "pagina N") and is shown as "Controle nodig".
// Nothing is approved or published by any of this.

// Criterion 2: at most 6 images or 10 pages per reading, and one fixed maximum
// file size (the provider's own documented limit for an image is 5 MB).
const MAX_MENU_IMAGES = 6;
const MAX_SCAN_PAGES = 10;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

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

// The words the model must use for the origin of a dish read from an image.
const IMAGE_LOCATOR_HINT = 'afbeelding N of pagina N';
const IMAGE_EVIDENCE_RULE =
  'Een citaat uit een afbeelding of scan is niet letterlijk te controleren. Elk gerecht uit een afbeeldingsbron krijgt daarom een locator in de vorm "afbeelding N" of "pagina N"; een gerecht zonder die herkomst wordt geweigerd.';

const REASONS = Object.freeze({
  source_empty: 'Er is geen leesbare tekst, afbeelding of pagina om te lezen.',
  too_many_images: `Deze pagina heeft meer dan ${MAX_MENU_IMAGES} menu-afbeeldingen; maximaal ${MAX_MENU_IMAGES} per lezing.`,
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


/**
 * Is this image a menu image of the same website? The rule is intentionally
 * narrow and explainable: the same host as the page, an image extension, and a
 * menu word in the file name, the alt text or the text of the link around it.
 * A logo or an atmosphere photo is never included, and neither is any other
 * website (criterion 2: no Instagram, no Google).
 */
function isMenuImageCandidate({ url, alt, linkText } = {}, pageUrl) {
  const absolute = absoluteUrl(url, pageUrl);
  if (!absolute) return false;
  const host = hostOfUrl(absolute);
  const pageHost = hostOfUrl(pageUrl);
  if (!host || !pageHost || host !== pageHost) return false;
  if (!mediaTypeForUrl(absolute)) return false;
  const haystack = [absolute, alt, linkText].filter(Boolean).join(' ');
  if (NOT_MENU.test(haystack)) return false;
  return MENU_HINT.test(haystack);
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
  const seen = new Set();
  const push = (src, alt, linkText) => {
    const absolute = absoluteUrl(src, pageUrl);
    if (!absolute || seen.has(absolute)) return;
    if (!isMenuImageCandidate({ url: absolute, alt, linkText }, pageUrl)) return;
    seen.add(absolute);
    found.push({ number: found.length + 1, url: absolute, alt: String(alt || '').slice(0, 200), mediaType: mediaTypeForUrl(absolute) });
  };
  for (const match of source.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    push(attributeOf(tag, 'src') || attributeOf(tag, 'data-src'), attributeOf(tag, 'alt'), `${attributeOf(tag, 'title')} ${hintFor(match.index)}`);
  }
  for (const match of source.matchAll(/<source\b[^>]*>/gi)) {
    const srcset = attributeOf(match[0], 'srcset');
    if (srcset) push(srcset.split(',')[0].trim().split(/\s+/)[0], '', hintFor(match.index));
  }
  return found.slice(0, limit);
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
 * What may go to the same model, within the fixed limits, before any budget is
 * spent. One text source always wins: text is free and exactly checkable. An
 * image page sends its own images (never more than 6); a scan PDF goes as one
 * document (never more than 10 pages, and only when its page count is known).
 */
function planImageRead({ sources } = {}) {
  const list = (Array.isArray(sources) ? sources : []).filter((source) => source && typeof source.id === 'string');
  if (list.length === 0) return refused('source_empty');
  const textSources = list.filter((source) => modeOfSource(source) === 'text');
  if (textSources.length > 0) {
    return {
      ok: true,
      mode: 'text',
      reason: null,
      message: null,
      imageCount: 0,
      pageCount: 0,
      sources: textSources.map((source) => ({ id: source.id, url: source.url || null, mode: 'text' })),
      estimate: estimateOf(0, 0),
    };
  }

  const imageSources = list.filter((source) => modeOfSource(source) === 'image');
  const documentSources = list.filter((source) => modeOfSource(source) === 'document');
  if (imageSources.length === 0 && documentSources.length === 0) return refused('source_empty');

  let imageCount = 0;
  const images = [];
  for (const source of imageSources) {
    const entries = Array.isArray(source.images) ? source.images : [];
    imageCount += entries.length;
    for (const image of entries) {
      if (base64Bytes(image.data) > MAX_IMAGE_BYTES) return refused('image_too_large', { imageUrl: image.url || null });
      images.push({ sourceId: source.id, url: image.url || null, mediaType: image.mediaType || mediaTypeForUrl(image.url) });
    }
  }
  if (imageCount > MAX_MENU_IMAGES) return refused('too_many_images', { imageCount });

  let pageCount = 0;
  const documents = [];
  for (const source of documentSources) {
    if (base64Bytes(source.documentBase64) > MAX_DOCUMENT_BYTES) return refused('document_too_large', { sourceUrl: source.url || null });
    if (!Number.isInteger(source.pageCount) || source.pageCount < 1) return refused('page_count_unknown', { sourceUrl: source.url || null });
    if (source.pageCount > MAX_SCAN_PAGES) return refused('too_many_pages', { pageCount: source.pageCount, sourceUrl: source.url || null });
    pageCount += source.pageCount;
    documents.push({ sourceId: source.id, url: source.url || null, pageCount: source.pageCount });
  }

  const mode = images.length > 0 && documents.length > 0 ? 'mixed' : images.length > 0 ? 'image' : 'document';
  return {
    ok: true,
    mode,
    reason: null,
    message: null,
    imageCount,
    pageCount,
    sources: [
      ...imageSources.map((source) => ({ id: source.id, url: source.url || null, mode: 'image' })),
      ...documentSources.map((source) => ({ id: source.id, url: source.url || null, mode: 'document', pageCount: source.pageCount })),
    ],
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

/** The honest notice above the reading, per mode. `Controle nodig` always. */
function imageReadNotice(plan) {
  if (!plan || plan.ok !== true) return null;
  if (plan.mode === 'text') return null;
  if (plan.mode === 'document') {
    return `De AI leest deze PDF als document (${plan.pageCount} ${plan.pageCount === 1 ? 'pagina' : "pagina's"}). Een citaat uit een scan is niet letterlijk te controleren: elk gerecht krijgt de herkomst "gelezen van pagina N" en het label "${CONTROLE_NODIG}".`;
  }
  return `De AI leest ${plan.imageCount} ${plan.imageCount === 1 ? 'menu-afbeelding' : 'menu-afbeeldingen'} van deze website. Een citaat uit een afbeelding is niet letterlijk te controleren: elk gerecht krijgt de herkomst "gelezen van afbeelding N" en het label "${CONTROLE_NODIG}".`;
}

module.exports = {
  MAX_MENU_IMAGES,
  MAX_SCAN_PAGES,
  MAX_IMAGE_BYTES,
  MAX_DOCUMENT_BYTES,
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
  hostOfUrl,
  imageProvenance,
  imageReadNotice,
  isMenuImageCandidate,
  mediaTypeForUrl,
  modeOfSource,
  planImageRead,
  provenanceLabel,
};
