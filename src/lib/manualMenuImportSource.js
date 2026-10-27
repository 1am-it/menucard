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
const {
  MAX_IMAGE_BYTES,
  MAX_MENU_IMAGES,
  collectMenuImages,
  hasMenuText,
  isSharedSiteImage,
  mediaTypeForUrl,
  readingImageLimitNotice,
  sharedSiteImageKeys,
} = require('./menuImageRead');

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
 * BE-35 ronde 3 (#84): phase one of one reading. A page becomes either a ready
 * source (text, PDF, a concrete limitation) or an *open* capture: the menu
 * images of this page are candidates that still have to be fetched. Only the
 * page itself is fetched here.
 *
 * Waarom twee fasen: een afbeelding die op meer dan één pagina van dezelfde
 * lezing staat is site-opmaak en geen menukaart, en de tien afbeeldingen van een
 * lezing worden over alle bronnen verdeeld. Beide regels vragen om alle pagina's
 * voordat er één afbeelding wordt opgehaald. `fetchImpl` is altijd de veilige
 * fetch van de bestaande route; deze module kent zelf geen netwerk.
 */
async function capturePageSource({
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
      return {
        source: failureSource({
          id,
          url,
          kind: 'other',
          status: 'blocked',
          limitation: 'robots.txt staat het ophalen van deze pagina niet toe.',
        }),
      };
    }
  }
  let response;
  try {
    response = await fetchImpl(url, { encoding: 'buffer', maxBytes });
  } catch {
    return { source: failureSource({ id, url, kind: 'other', status: 'failed', limitation: 'Deze pagina kon niet worden opgehaald.' }) };
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
      source: {
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
      },
    };
  }
  if (contentType !== 'text/html' && contentType !== 'application/xhtml+xml') {
    return { source: failureSource({ id, url: finalUrl, kind: 'other', status: 'failed', limitation: 'Dit type bron wordt niet ondersteund.' }) };
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
      return {
        source: imageSourceDraft({ id, url: finalUrl, candidates, fetchedAt }),
        candidates,
        // Wat deze pagina is als geen enkele kandidaat een menukaart blijkt
        // (alleen site-opmaak): gewone tekst, of de bestaande lege bron.
        fallback: text === ''
          ? {
              ...failureSource({ id, url: finalUrl, kind: 'html', status: 'read', limitation: 'De pagina bevat geen leesbare tekst.' }),
              fetchedAt,
            }
          : {
              id,
              url: finalUrl,
              kind: 'html',
              status: 'read',
              text,
              hasText: true,
              sha256: sourceHashForText(text),
              fetchedAt,
              limitation: null,
            },
      };
    }
    return {
      source: {
        ...failureSource({ id, url: finalUrl, kind: 'html', status: 'read', limitation: 'De pagina bevat geen leesbare tekst.' }),
        fetchedAt,
      },
    };
  }
  return {
    source: {
      id,
      url: finalUrl,
      kind: 'html',
      status: 'read',
      text,
      hasText: true,
      sha256: sourceHashForText(text),
      fetchedAt,
      limitation: null,
    },
  };
}


/** The stable binding of an image reading: the candidate URLs, never a byte. */
function imageCandidateHash(candidates) {
  return createHash('sha256').update(candidates.map((candidate) => candidate.url).join('\n')).digest('hex');
}

/** The image source of one page, before its images are fetched. */
function imageSourceDraft({ id, url, candidates, fetchedAt }) {
  return {
    id,
    url,
    kind: 'image',
    status: 'read',
    text: '',
    hasText: false,
    imageRead: true,
    sha256: imageCandidateHash(candidates),
    images: [],
    imageCandidates: candidates.length,
    fetchedAt,
    limitation: null,
  };
}

/**
 * Fetches the chosen images of one page through the same safe route and words
 * the limitation: a failed image is named, a cut reading says how many it has.
 */
async function sourceWithImages({ source, candidates, fetchImpl, robotsCheck, notes = [] }) {
  const read = candidates.length > 0
    ? await readMenuImages({ images: candidates, fetchImpl, robotsCheck })
    : { images: [], limitations: [] };
  const all = [...notes, ...read.limitations];
  return {
    ...source,
    images: read.images,
    limitation: all.length > 0
      ? all.join(' ')
      : 'Deze pagina toont de menukaart als afbeelding; de AI leest de afbeeldingen.',
  };
}

/**
 * Leest één bron. `fetchImpl` is altijd de veilige fetch van de bestaande
 * route; deze module kent zelf geen netwerk. Binnen één bron geldt de grens van
 * tien afbeeldingen per pagina; over meerdere bronnen verdeelt
 * `readManualImportSources` die tien.
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
  const captured = await capturePageSource({
    id,
    url,
    fetchImpl,
    robotsCheck,
    now,
    maxBytes,
    maxDocumentBytes,
    readPdfPages,
  });
  if (!Array.isArray(captured.candidates)) return captured.source;
  const notes = [];
  if (captured.candidates.length > MAX_MENU_IMAGES) {
    notes.push(`Deze pagina heeft ${captured.candidates.length} menu-afbeeldingen; de eerste ${MAX_MENU_IMAGES} zijn gelezen.`);
  }
  return sourceWithImages({
    source: captured.source,
    candidates: captured.candidates.slice(0, MAX_MENU_IMAGES),
    fetchImpl,
    robotsCheck,
    notes,
  });
}


/**
 * Leest een begrensde set URL's, met een vaste sourceId per bron en de regels
 * van BE-35 ronde 3 (#84) over de hele lezing:
 *   1. een afbeelding die op meer dan één pagina van deze lezing staat is
 *      site-opmaak en geen menukandidaat;
 *   2. de eerste tien menu-afbeeldingen in volgorde van bron en pagina worden
 *      gelezen, nooit nul als er één past, met het echte aantal erbij. Een
 *      pagina die buiten die tien valt wordt geen lege beeldbron: zij valt uit
 *      de lezing, zodat de bundel en het model dezelfde bronnen zien.
 */
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
  const captured = await Promise.all(
    list.slice(0, MAX_SOURCES).map((url, index) =>
      capturePageSource({
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

  // Regel 1: site-opmaak staat op meer dan één pagina van deze lezing.
  const pages = captured
    .map((entry, index) => (
      Array.isArray(entry.candidates)
        ? { pageUrl: entry.source.url || `page-${index + 1}`, images: entry.candidates }
        : null
    ))
    .filter(Boolean);
  const shared = sharedSiteImageKeys(pages);
  const menuCandidates = captured.map((entry) => (Array.isArray(entry.candidates)
    ? entry.candidates.filter((candidate) => !isSharedSiteImage(candidate.url, shared))
    : null));
  const totalCandidates = menuCandidates.reduce((sum, candidates) => sum + (candidates ? candidates.length : 0), 0);

  // Regel 2: de eerste tien menu-afbeeldingen van de lezing, in bronvolgorde.
  // Een pagina die geen plaats meer heeft levert geen lege beeldbron op: zij
  // valt uit de lezing, zodat de bundel en het model precies dezelfde bronnen
  // zien. Het echte aantal van de hele lezing blijft op de gelezen bron staan.
  const cut = totalCandidates > MAX_MENU_IMAGES;
  let remaining = MAX_MENU_IMAGES;
  const planned = captured.map((entry, index) => {
    if (!Array.isArray(entry.candidates)) return { type: 'plain', entry };
    const kept = menuCandidates[index];
    if (kept.length === 0) return { type: 'fallback', entry };
    const take = kept.slice(0, Math.max(0, remaining));
    remaining -= take.length;
    if (take.length === 0) return { type: 'cut' };
    return {
      type: 'image',
      entry,
      // De binding en het eerlijke aantal gaan over de kandidaten zonder
      // site-opmaak; `readingImageCandidates` is het aantal van de hele lezing.
      source: {
        ...entry.source,
        sha256: imageCandidateHash(kept),
        imageCandidates: kept.length,
        ...(cut ? { readingImageCandidates: totalCandidates } : {}),
      },
      take,
      notes: cut ? [readingImageLimitNotice(totalCandidates)] : [],
    };
  });

  const finished = await Promise.all(planned.map(async (plan) => {
    if (plan.type === 'plain') return plan.entry.source;
    if (plan.type === 'cut') return null;
    if (plan.type === 'fallback') return plan.entry.fallback;
    const source = await sourceWithImages({
      source: plan.source,
      candidates: plan.take,
      fetchImpl,
      robotsCheck,
      notes: plan.notes,
    });
    if (source.images.length > 0) return source;
    // Geen enkele afbeelding kwam binnen: dan is dit geen beeldbron maar de
    // gewone pagina (met de eerlijke beperking), of anders niets leesbaars.
    const fallback = plan.entry.fallback;
    if (!fallback || fallback.hasText !== true) return null;
    return { ...fallback, limitation: [source.limitation, fallback.limitation].filter(Boolean).join(' ') };
  }));
  return finished.filter(Boolean);
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
