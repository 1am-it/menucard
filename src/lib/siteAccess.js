'use strict';

// Toegang tot de site zolang hij nog niet publiek is (eigenaarsbesluit 30 okt:
// "de site/app mag nog niet naar productie / publiek").
//
// Twee losse regels, allebei uit de omgeving:
//   - SITE_ACCESS_PASSWORD gezet → elke pagina en API vraagt eerst dat
//     wachtwoord (HTTP Basic, de gebruikersnaam doet er niet toe). Leeg of niet
//     gezet → geen poort, zoals voorheen.
//   - NEXT_PUBLIC_SITE_INDEXABLE niet precies 'true' → elke response krijgt
//     `X-Robots-Tag: noindex, nofollow`. Pas bij de lancering zet de eigenaar
//     die op 'true'.
//
// Vercel-cronroutes en de healthcheck hebben hun eigen geheim en blijven buiten
// de poort; Next.js-bestanden onder /_next ook. middleware.js is alleen de
// dunne ingang; de regels staan hier zodat `node --test` ze kan controleren.

const OPEN_PREFIXES = ['/api/cron/', '/api/health/', '/_next/'];
const OPEN_FILES = ['/favicon.ico', '/robots.txt'];

function isOpenPath(pathname) {
  const path = String(pathname || '/');
  return OPEN_PREFIXES.some((prefix) => path.startsWith(prefix)) || OPEN_FILES.includes(path);
}

function decodeBasicPassword(authorization) {
  const header = String(authorization || '');
  const match = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(header.trim());
  if (!match) return null;
  let decoded;
  try {
    decoded = typeof atob === 'function' ? atob(match[1]) : Buffer.from(match[1], 'base64').toString('binary');
  } catch {
    return null;
  }
  const colon = decoded.indexOf(':');
  return colon === -1 ? null : decoded.slice(colon + 1);
}

// Vergelijking zonder vroeg te stoppen, zodat de duur niets over het
// wachtwoord verraadt.
function sameSecret(a, b) {
  const left = String(a);
  const right = String(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * Mag dit verzoek door?
 * @returns {{ allow: boolean, noindex: boolean }}
 */
function siteAccessDecision({ pathname, authorization, password, indexable } = {}) {
  const noindex = String(indexable || '').trim() !== 'true';
  const secret = String(password || '');
  if (!secret || isOpenPath(pathname)) return { allow: true, noindex };
  const given = decodeBasicPassword(authorization);
  return { allow: given !== null && sameSecret(given, secret), noindex };
}

module.exports = { siteAccessDecision, isOpenPath, decodeBasicPassword };
