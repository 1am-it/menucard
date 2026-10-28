'use strict';

// BE-41 — the one rule for opening something that came from outside the app.
//
// The review screen may offer "Originele menukaart openen" next to its title,
// and the list may offer "PR bekijken" next to a card. Both are real external
// links, so both need the same two answers in one place instead of a second
// interpretation per screen:
//   - is this URL safe to open at all (`http(s)` only, never `javascript:`,
//     `data:`, a bare path or an empty value)?
//   - what does the reader get (webpagina, pdf or afbeelding) and from which
//     domain, so the small line under the button can tell the truth?
//
// Deliberately CommonJS and side-effect free, like the other src/lib modules:
// the list, the detail and the browser fixtures all read this file.

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'svg'];

/** Only a real http(s) URL with a host is ever opened in a new tab. */
function isHttpUrl(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  // A scheme check first, so "javascript:alert(1)" can never reach `new URL`
  // and a relative path never silently becomes an app route. The character
  // after the two slashes must exist, so "https://" and "https:///pad" are
  // refused instead of being read as a host.
  if (!/^https?:\/\/[^/?#\s]/i.test(trimmed)) return false;
  try {
    const url = new URL(trimmed);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0;
  } catch {
    return false;
  }
}

/** The extension of the last path segment, ignoring any query string or hash. */
function extensionOf(pathname) {
  const last = String(pathname || '').split('/').pop() || '';
  const dot = last.lastIndexOf('.');
  return dot === -1 ? '' : last.slice(dot + 1).toLowerCase();
}

/** What the reader gets: a web page, a pdf or an image. The copy is `kind`. */
function sourceKind(pathname) {
  const ext = extensionOf(pathname);
  if (ext === 'pdf') return 'pdf';
  if (IMAGE_EXTENSIONS.includes(ext)) return 'afbeelding';
  return 'webpagina';
}

/**
 * Everything the screen needs to open a concept's original menu, or null when
 * it must not offer the button at all. `note` is the small line under it:
 * "Opent in een nieuw tabblad · <domein> · webpagina | pdf | afbeelding".
 */
function menuSourceLink(sourceUrl) {
  if (!isHttpUrl(sourceUrl)) return null;
  const url = new URL(sourceUrl.trim());
  const domain = url.hostname.replace(/^www\./i, '').toLowerCase();
  const kind = sourceKind(url.pathname);
  return {
    href: url.href,
    domain,
    kind,
    note: `Opent in een nieuw tabblad · ${domain} · ${kind}`,
  };
}

module.exports = {
  isHttpUrl,
  menuSourceLink,
  sourceKind,
  IMAGE_EXTENSIONS,
};
