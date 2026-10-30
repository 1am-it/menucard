// BE-56 (#137) — één centrale plek voor het eigen domein.
//
// De overstap van het Vercel-adres naar het eigen domein mag één instelling
// zijn: `NEXT_PUBLIC_SITE_URL` in de omgeving. Alles wat een absolute URL nodig
// heeft (metadata, robots.txt, de sitemap) leest die instelling hier, en nergens
// anders. Er staat dus geen enkel domein in de code.
//
// Waarom streng: een verkeerde basis-URL is erger dan geen basis-URL. Een
// gedeelde link met het verkeerde domein, of een sitemap vol andermans adres,
// merkt niemand meteen. Daarom is alleen een geldig https-adres goed. Zonder
// geldige waarde geeft `siteUrl()` een lege string terug en gokt de aanroeper
// niet: de sitemap blijft dan leeg en de sitemap-regel in robots.txt vervalt.
//
// Bewust CommonJS, zoals dishShare.js en kiesStemming.js: direct testbaar met
// `node --test`, zonder React of netwerk.

'use strict';

// De naam uit het contract (punt 5 van de stappenlijst).
const SITE_URL_ENV = 'NEXT_PUBLIC_SITE_URL';

/**
 * Een geconfigureerde basis-URL normaliseren: alleen https, zonder slash aan
 * het eind, zonder pad, query of inloggegevens. Alles wat niet klopt geeft ''.
 */
function normalizeSiteUrl(value) {
  const text = String(value === undefined || value === null ? '' : value).trim();
  if (!text) return '';
  let parsed;
  try {
    parsed = new URL(text);
  } catch (error) {
    return '';
  }
  // Alleen https: een http-basis maakt van elke deellink een onveilige link.
  if (parsed.protocol !== 'https:') return '';
  if (!parsed.hostname) return '';
  if (parsed.username || parsed.password) return '';
  // Een pad hoort niet in een basis-URL; `https://voorbeeld.nl/menu` is geen
  // domein maar een pagina, en zou elke link laten beginnen bij /menu.
  if (parsed.pathname !== '/' && parsed.pathname !== '') return '';
  if (parsed.search || parsed.hash) return '';
  // `parsed.host` laat de slash weg en houdt een eventuele poort.
  return `https://${parsed.host}`;
}

/**
 * Het eigen domein, of '' als de omgeving er geen geldige waarde voor heeft.
 * `env` is standaard `process.env`; een test geeft zijn eigen object mee.
 */
function siteUrl(env = process.env) {
  const source = env && typeof env === 'object' ? env : {};
  return normalizeSiteUrl(source[SITE_URL_ENV]);
}

/**
 * Een pad op het eigen domein, of null als er geen basis is. Zo blijft "geen
 * domein" overal hetzelfde: geen halve URL, maar niets.
 */
function absoluteSiteUrl(path, env = process.env) {
  const base = siteUrl(env);
  if (!base) return null;
  const href = String(path === undefined || path === null ? '' : path).trim() || '/';
  return `${base}${href.startsWith('/') ? '' : '/'}${href}`;
}

module.exports = {
  SITE_URL_ENV,
  absoluteSiteUrl,
  normalizeSiteUrl,
  siteUrl,
};
