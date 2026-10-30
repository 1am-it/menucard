'use strict';

// BE-56 (#137) — wat zoekmachines van de site mogen zien, als rekenregels.
//
// app/robots.js en app/sitemap.js zijn de dunne Next.js-ingangen; de regels
// staan hier, zodat `node --test` ze direct kan controleren zonder React of een
// gebouwde app. Beide krijgen de basis-URL van buiten (uit src/lib/siteUrl.js):
// deze module leest zelf geen omgeving.
//
// De lijst met privépaden komt uit het contract (punt 3 en 4). Hij geldt voor
// robots.txt én als vangnet voor de sitemap: een persoonlijke of interne pagina
// hoort in geen van beide.

const { normalizeSiteUrl } = require('./siteUrl');

const SITEMAP_PATH = '/sitemap.xml';

// Nooit indexeren: intern gereedschap, de API, het eigenaarsgedeelte, de
// claimflow en de twee persoonlijke pagina's (het lijstje en de stemming).
const PRIVATE_PATHS = ['/internal', '/api', '/mijn-restaurant', '/claim', '/kies', '/mijn-lijstje'];

// De publieke pagina's zonder eigen id in de URL.
const PUBLIC_PATHS = ['/', '/alle-restaurants'];

/** Draagt dit pad een van de privépaden (ook als het eronder hangt)? */
function isPrivatePath(value) {
  const path = String(value === undefined || value === null ? '' : value);
  return PRIVATE_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** Een pad op de gegeven basis-URL, of null als die basis er niet is. */
function absoluteHref(baseUrl, path) {
  const base = normalizeSiteUrl(baseUrl);
  if (!base) return null;
  const href = String(path === undefined || path === null ? '' : path).trim() || '/';
  return `${base}${href.startsWith('/') ? '' : '/'}${href}`;
}

/**
 * De inhoud van /robots.txt (contract, punt 3): alles publiek toestaan, de
 * privépaden uitsluiten, en de sitemap-regel alleen als er een basis-URL is.
 * Zonder basis blijft die regel weg: een sitemap die niet bestaat, helpt
 * zoekmachines niet.
 */
function robotsMetadata({ siteUrl: configuredUrl } = {}) {
  const metadata = {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [...PRIVATE_PATHS],
    },
  };
  const sitemap = absoluteHref(configuredUrl, SITEMAP_PATH);
  if (sitemap) metadata.sitemap = sitemap;
  return metadata;
}

module.exports = {
  PRIVATE_PATHS,
  PUBLIC_PATHS,
  SITEMAP_PATH,
  absoluteHref,
  isPrivatePath,
  robotsMetadata,
};
