'use strict';

// #59 fase 2 — bronlezing voor de handmatige AI-import.
//
// Hergebruikt de bestaande veilige route: robots.txt-gate, zelfde-site-
// redirects en safeOutboundFetch (SSRF-, type-, grootte- en timeoutgrenzen).
// Geen tweede egress-pad en geen nieuwe vendor.
//
// Wat hier wordt toegevoegd is alleen de presentatie die de prompt nodig heeft:
// per bron een vaste id, URL, ophaaltijd, SHA-256 en platte tekst. De tekst is
// dezelfde tekst waartegen de quote-controle later plaatsvindt. Een scan of
// afbeelding zonder tekstlaag levert bewust géén tekst op, met een expliciete
// beperking in plaats van verzonnen inhoud.
//
// De fetch en de robotscheck worden ingevoerd, zodat tests zonder netwerk
// dezelfde regels bewijzen.

const { createHash } = require('node:crypto');
const { decodeEntities } = require('./htmlMenuStructure');
const { sourceHashForText } = require('./manualMenuImportBundle');
const { MAX_IMAGE_BYTES, MAX_MENU_IMAGES, collectMenuImages, hasMenuText, mediaTypeForUrl } = require('./menuImageRead');

const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
const MAX_TEXT_CHARS = 120_000;
const MAX_SOURCES = 5;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

function decodeEntitiesSafely(text) {
  try {
    return decodeEntities(text);
  } catch {
    return text;
  }
}

/** Deterministische, platte weergave van HTML voor de prompt. */
function htmlToPlainText(html) {
  const stripped = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|table|ul|ol|dl|dt|dd|option)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\t\u00a0]+/g, ' ');
  const decoded = decodeEntitiesSafely(stripped);
  return decoded
    .split('\n')
    .map((line) => line.replace(/[ ]{2,}/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n')
    .slice(0, MAX_TEXT_CHARS);
}

function failureSource({ id, url, kind, status, limitation }) {
  return { id, url, kind, status, text: '', hasText: false, sha256: null, limitation, fetchedAt: null };
}

/**
 * BE-33 (#79, criterion 2): the number of pages of a PDF, as far as it can be
 * seen without a new dependency. A compressed page tree can hide it; then the
 * answer is `null` and the reading is refused instead of sending an unbounded
 * document. `readPdfPages` (the existing PDF route) may supply the real count.
 */
function pdfPageCount(bytes) {
  if (!bytes || typeof bytes.length !== 'number' || bytes.length === 0) return null;
  const text = bytes.toString('latin1');
  const pages = text.match(/\/Type\s*\/Page(?![s\w])/g);
  if (pages && pages.length > 0) return pages.length;
  const counts = [...text.matchAll(/\/Count\s+(\d+)/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isInteger(value) && value > 0);
  return counts.length > 0 ? Math.max(...counts) : null;
}

/**
 * Fetches the menu images of one page through the same safe route (robots, the
 * same site, a fixed size). A failed image is skipped with a limitation and is
 * never replaced by a guess. No more than the fixed maximum is fetched.
 */
async function readMenuImages({ images, fetchImpl, robotsCheck, maxImageBytes = MAX_IMAGE_BYTES } = {}) {
  const list = Array.isArray(images) ? images : [];
  const read = [];
  const limitations = [];
  for (const image of list.slice(0, MAX_MENU_IMAGES)) {
    if (typeof robotsCheck === 'function') {
      const gate = await robotsCheck(image.url);
      if (gate && gate.shouldFetchPage === false) {
        limitations.push(`robots.txt staat het ophalen van afbeelding ${image.number} niet toe.`);
        continue;
      }
    }
    let response;
    try {
      response = await fetchImpl(image.url, { encoding: 'buffer', maxBytes: maxImageBytes });
    } catch {
      limitations.push(`Afbeelding ${image.number} kon niet worden opgehaald.`);
      continue;
    }
    const bytes = response && response.bytes;
    if (!bytes || typeof bytes.length !== 'number' || bytes.length === 0) {
      limitations.push(`Afbeelding ${image.number} is leeg.`);
      continue;
    }
    if (bytes.length > maxImageBytes) {
      limitations.push(`Afbeelding ${image.number} is groter dan de vaste limiet en wordt niet verstuurd.`);
      continue;
    }
    const mediaType = mediaTypeForUrl(image.url);
    if (!mediaType) {
      limitations.push(`Afbeelding ${image.number} heeft geen ondersteund formaat.`);
      continue;
    }
    read.push({ ...image, mediaType, data: bytes.toString('base64'), bytes: bytes.length });
  }
  return { images: read, limitations };
}

/**
 * Leest één bron. `fetchImpl` is altijd de veilige fetch van de bestaande
 * route; deze module kent zelf geen netwerk.
 */
async function readManualImportSource({
  id,
  url,
  fetchImpl,
  robotsCheck,
  now = new Date(),
  maxBytes = MAX_SOURCE_BYTES,
  maxDocumentBytes = MAX_DOCUMENT_BYTES,
  readPdfPages = null,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl_required');
  const fetchedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  if (typeof robotsCheck === 'function') {
    const gate = await robotsCheck(url);
    if (gate && gate.shouldFetchPage === false) {
      return failureSource({
        id,
        url,
        kind: 'other',
        status: 'blocked',
        limitation: 'robots.txt staat het ophalen van deze pagina niet toe.',
      });
    }
  }
  let response;
  try {
    response = await fetchImpl(url, { encoding: 'buffer', maxBytes });
  } catch {
    return failureSource({ id, url, kind: 'other', status: 'failed', limitation: 'Deze pagina kon niet worden opgehaald.' });
  }
  const finalUrl = response && response.finalUrl ? response.finalUrl : url;
  const contentType = response && response.contentType ? response.contentType : '';
  if (contentType === 'application/pdf') {
    // BE-33 (#79): a PDF without a text layer is a scan. It goes to the same
    // model as a document, within the fixed size; the page count is measured
    // here only to enforce the 10-page limit, never to invent text.
    const bytes = response && response.bytes;
    const sha256 = bytes && typeof bytes.length === 'number' && bytes.length > 0
      ? createHash('sha256').update(bytes).digest('hex')
      : sourceHashForText(String(bytes ? bytes.toString('base64') : ''));
    const pageCount = bytes && typeof bytes.length === 'number' && bytes.length <= maxDocumentBytes
      ? pdfPageCount(bytes) || (typeof readPdfPages === 'function' ? await readPdfPages(bytes) : null)
      : null;
    const tooLarge = Boolean(bytes && typeof bytes.length === 'number' && bytes.length > maxDocumentBytes);
    return {
      id,
      url: finalUrl,
      kind: 'pdf',
      status: 'read',
      text: '',
      hasText: false,
      imageRead: true,
      sha256,
      pageCount,
      documentBase64: bytes && typeof bytes.length === 'number' && bytes.length > 0 && !tooLarge ? bytes.toString('base64') : null,
      fetchedAt,
      limitation: tooLarge
        ? 'De PDF is groter dan de vaste limiet en gaat niet als document naar de AI.'
        : 'De PDF gaat als document naar de AI; de pagina’s worden niet als tekst gelezen.',
    };
  }
  if (contentType !== 'text/html' && contentType !== 'application/xhtml+xml') {
    return failureSource({ id, url: finalUrl, kind: 'other', status: 'failed', limitation: 'Dit type bron wordt niet ondersteund.' });
  }
  const html = response.bytes ? response.bytes.toString('utf8') : String(response.body || '');
  const text = htmlToPlainText(html);
  // BE-35 ronde 2 (#84): a real menu page carries navigation, footer and
  // opening-hours text while the menu itself is only an image. Menu images of
  // this same page therefore go before the text when that text holds no menu
  // (the tested hasMenuText rule: fewer than three price lines). A page with a
  // real text menu stays a text source: free and exactly checkable.
  const candidates = collectMenuImages({ html, pageUrl: finalUrl, limit: Number.MAX_SAFE_INTEGER });
  const menuOnlyAsImage = candidates.length > 0 && !hasMenuText(text);
  if (text === '' || menuOnlyAsImage) {
    if (candidates.length > 0) {
      // BE-33 (#79, criterion 2) with the BE-35 ronde 2 (#84) overflow rule: the
      // first 10 candidates in page order are fetched, each through the same safe
      // route. More candidates is never an empty reading, and the limitation
      // names the real number.
      const selected = candidates.slice(0, MAX_MENU_IMAGES);
      const { images, limitations } = await readMenuImages({ images: selected, fetchImpl, robotsCheck });
      const notes = [];
      if (candidates.length > MAX_MENU_IMAGES) {
        notes.push(`Deze pagina heeft ${candidates.length} menu-afbeeldingen; de eerste ${MAX_MENU_IMAGES} zijn gelezen.`);
      }
      notes.push(...limitations);
      return {
        id,
        url: finalUrl,
        kind: 'image',
        status: 'read',
        text: '',
        hasText: false,
        imageRead: true,
        sha256: createHash('sha256').update(candidates.map((candidate) => candidate.url).join('\n')).digest('hex'),
        images,
        imageCandidates: candidates.length,
        fetchedAt,
        limitation: notes.length > 0 ? notes.join(' ') : 'Deze pagina toont de menukaart als afbeelding; de AI leest de afbeeldingen.',
      };
    }
    return {
      ...failureSource({ id, url: finalUrl, kind: 'html', status: 'read', limitation: 'De pagina bevat geen leesbare tekst.' }),
      fetchedAt,
    };
  }
  return {
    id,
    url: finalUrl,
    kind: 'html',
    status: 'read',
    text,
    hasText: true,
    sha256: sourceHashForText(text),
    fetchedAt,
    limitation: null,
  };
}

/** Leest een begrensde set URL's, met een vaste sourceId per bron. */
async function readManualImportSources({
  urls,
  fetchImpl,
  robotsCheck,
  now = new Date(),
  maxBytes = MAX_SOURCE_BYTES,
  maxDocumentBytes = MAX_DOCUMENT_BYTES,
  readPdfPages = null,
} = {}) {
  const list = (Array.isArray(urls) ? urls : []).filter((url) => typeof url === 'string' && url.trim());
  if (list.length === 0) return [];
  return Promise.all(
    list.slice(0, MAX_SOURCES).map((url, index) =>
      readManualImportSource({
        id: `source-${index + 1}`,
        url: url.trim(),
        fetchImpl,
        robotsCheck,
        now,
        maxBytes,
        maxDocumentBytes,
        readPdfPages,
      }),
    ),
  );
}

module.exports = {
  MAX_SOURCE_BYTES,
  MAX_TEXT_CHARS,
  MAX_SOURCES,
  MAX_DOCUMENT_BYTES,
  htmlToPlainText,
  pdfPageCount,
  readMenuImages,
  readManualImportSource,
  readManualImportSources,
};
