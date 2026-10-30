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

/**
 * De sitemap (contract, punt 4): de home, de lijstpagina, elke restaurantpagina
 * en elke menukaart uit de statische gegevens. Geen interne of persoonlijke
 * pagina's — `isPrivatePath()` is hier het vangnet. Zonder eigen domein is de
 * sitemap leeg: een half gevulde sitemap met relatieve adressen bestaat niet.
 */
function sitemapEntries({ siteUrl: configuredUrl, restaurants = [], menus = [] } = {}) {
  const base = normalizeSiteUrl(configuredUrl);
  if (!base) return [];

  const paths = [...PUBLIC_PATHS];
  const add = (path) => {
    if (!path || isPrivatePath(path) || paths.includes(path)) return;
    paths.push(path);
  };
  // Alleen een simpele id komt in een pad; een id met een slash, vraagteken of
  // ander teken is geen echte pagina en hoort er niet in.
  const validId = (value) => /^[A-Za-z0-9_-]+$/.test(String(value === undefined || value === null ? '' : value).trim());
  for (const id of restaurants || []) {
    if (validId(id)) add(`/restaurant/${String(id).trim()}`);
  }
  for (const id of menus || []) {
    if (validId(id)) add(`/menu/${String(id).trim()}`);
  }
  return paths.map((path) => ({ url: `${base}${path}` }));
}

// Zolang de site niet publiek is (eigenaarsbesluit 30 okt) zijn robots.txt en de
// sitemap dicht. Pas als NEXT_PUBLIC_SITE_INDEXABLE precies 'true' is, gelden de
// regels hierboven. Dezelfde vlag stuurt de noindex-kop in middleware.js.
function isIndexable(value) {
  return String(value === undefined || value === null ? '' : value).trim() === 'true';
}

/** robots.txt zolang de site nog niet publiek is: niets indexeren. */
function closedRobotsMetadata() {
  return { rules: { userAgent: '*', disallow: '/' } };
}

module.exports = {
  closedRobotsMetadata,
  isIndexable,
  PRIVATE_PATHS,
  PUBLIC_PATHS,
  SITEMAP_PATH,
  absoluteHref,
  isPrivatePath,
  robotsMetadata,
  sitemapEntries,
};
