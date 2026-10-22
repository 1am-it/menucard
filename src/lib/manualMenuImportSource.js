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

const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
const MAX_TEXT_CHARS = 120_000;
const MAX_SOURCES = 5;

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
  return { id, url, kind, status, text: '', sha256: null, limitation, fetchedAt: null };
}

/**
 * Leest één bron. `fetchImpl` is altijd de veilige fetch van de bestaande
 * route; deze module kent zelf geen netwerk.
 */
async function readManualImportSource({ id, url, fetchImpl, robotsCheck, now = new Date(), maxBytes = MAX_SOURCE_BYTES } = {}) {
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
    // Een PDF-tekstlaag lezen is het werk van de bestaande PDF-route; zonder
    // die stap is een PDF een scan: expliciet geen tekst, geen verzonnen menu.
    const bytes = response && response.bytes;
    const sha256 = bytes && typeof bytes.length === 'number' && bytes.length > 0
      ? createHash('sha256').update(bytes).digest('hex')
      : sourceHashForText(String(bytes ? bytes.toString('base64') : ''));
    return {
      id,
      url: finalUrl,
      kind: 'pdf',
      status: 'read',
      text: '',
      sha256,
      fetchedAt,
      limitation: 'PDF opgehaald zonder tekstlaagcontrole; voeg het bestand zelf toe aan de AI.',
    };
  }
  if (contentType !== 'text/html' && contentType !== 'application/xhtml+xml') {
    return failureSource({ id, url: finalUrl, kind: 'other', status: 'failed', limitation: 'Dit type bron wordt niet ondersteund.' });
  }
  const html = response.bytes ? response.bytes.toString('utf8') : String(response.body || '');
  const text = htmlToPlainText(html);
  if (text === '') {
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
    sha256: sourceHashForText(text),
    fetchedAt,
    limitation: null,
  };
}

/** Leest een begrensde set URL's, met een vaste sourceId per bron. */
async function readManualImportSources({ urls, fetchImpl, robotsCheck, now = new Date(), maxBytes = MAX_SOURCE_BYTES } = {}) {
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
      }),
    ),
  );
}

module.exports = {
  MAX_SOURCE_BYTES,
  MAX_TEXT_CHARS,
  MAX_SOURCES,
  htmlToPlainText,
  readManualImportSource,
  readManualImportSources,
};
