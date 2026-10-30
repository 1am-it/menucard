// BE-44 (#105) — de deelgegevens van één gerecht (contract criterium 1, 2 en 3).
//
// Alles wat een gedeelde gerechtlink bepaalt, staat hier op één plek: de
// deeplink naar het gerecht (BE-12, src/lib/dishDeepLink.js), de stand die
// meegaat voor de voorvertoning, de gegevens voor het systeemdeelmenu en de
// metadata (og:title, og:description, og:url, og:image).
//
// Eigenaarsbesluit 28 oktober: er gaat GEEN begeleidende tekst mee. De payload
// is daarom exact `{ url, title }`; `title` is alleen de kop van het deelmenu,
// geen bericht. `buildSharePayload()` laat dat niet anders toe.
//
// De `stand` in de link (`?stand=donker`) kiest uitsluitend de kleuren van de
// voorvertoningsafbeelding. Hij verandert het thema van de pagina voor de
// ontvanger niet (BE-44 criterium 3) en is tegelijk het enige teken dat een
// bezoeker via een gedeelde link binnenkomt — daarom toont /menu/[id] de regel
// SHARED_DISH_NOTE alleen bij een geldig gerecht én een `stand` in de link.
//
// Bewust CommonJS, zoals dishDeepLink.js en menuPrice.js: direct testbaar met
// `node --test`, zonder browser, React of netwerk.

'use strict';

const { buildDishDeepLink } = require('./dishDeepLink');
const { honestPriceLabel } = require('./menuPrice');
const { normalizeSiteUrl } = require('./siteUrl');

const SHARE_THEME_PARAM = 'stand';
const SHARE_THEME_LIGHT = 'licht';
const SHARE_THEME_DARK = 'donker';
// Letterlijk de melding uit het contract (criterium 1), in een `role="status"`.
const COPIED_MESSAGE = 'Link gekopieerd';
const SHARED_DISH_NOTE = 'Iemand deelde dit gerecht met je';

/** De stand van een gedeelde link: 'licht' of 'donker', nooit iets anders. */
function normalizeShareTheme(value) {
  const text = String(value === undefined || value === null ? '' : value).trim().toLowerCase();
  if (text === SHARE_THEME_DARK || text === 'dark') return SHARE_THEME_DARK;
  return SHARE_THEME_LIGHT;
}

/** De stand zoals het thema hem op het <html>-element zet ('light'/'dark'). */
function shareThemeFromAttribute(value) {
  return normalizeShareTheme(value);
}

/** Draagt deze link de stand van een gedeelde link? */
function hasShareTheme(value) {
  const text = String(value === undefined || value === null ? '' : value).trim();
  return text === SHARE_THEME_LIGHT || text === SHARE_THEME_DARK;
}

function stripTrailingSlash(value) {
  return String(value === undefined || value === null ? '' : value).replace(/\/+$/, '');
}

/**
 * De basis-URL voor metadata en deellinks: NEXT_PUBLIC_SITE_URL als die er is,
 * anders de host van het huidige verzoek, anders de lokale ontwikkelhost.
 *
 * BE-56 (#137): de omgevingswaarde wordt gelezen via `normalizeSiteUrl()` uit
 * src/lib/siteUrl.js, dezelfde helper als app/layout.js, app/robots.js en
 * app/sitemap.js. Alleen een geldig https-adres telt daar (zonder slash aan het
 * eind); een lege of ongeldige waarde valt hier terug op wat deze pagina al
 * deed: de host van het verzoek.
 */
function siteBaseUrl({ envUrl, host, proto } = {}) {
  const configured = normalizeSiteUrl(envUrl);
  if (configured) return configured;
  const hostValue = typeof host === 'string' ? host.trim() : '';
  if (hostValue) {
    // Achter een proxy zegt de header het; lokaal (development, de browsercheck)
    // is het http. Zonder die twee is https de veilige aanname.
    const declared = String(proto || '').toLowerCase();
    const scheme = declared === 'http' || declared === 'https'
      ? declared
      : (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(hostValue) ? 'http' : 'https');
    return `${scheme}://${hostValue}`;
  }
  return 'http://localhost:3000';
}

/**
 * Dezelfde link met de stand erin. Een al aanwezige `stand` wordt vervangen,
 * zodat de link nooit twee standen tegelijk draagt.
 */
function withShareTheme(href, theme) {
  if (!href) return null;
  const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(String(href));
  let parsed;
  try {
    parsed = new URL(String(href), 'http://share.invalid');
  } catch (error) {
    return null;
  }
  parsed.searchParams.set(SHARE_THEME_PARAM, normalizeShareTheme(theme));
  // `URLSearchParams` schrijft een komma als %2C; de id's van een gedeeld
  // lijstje blijven zo leesbaar in de chat. De pagina leest beide vormen.
  const suffix = `${parsed.pathname}${parsed.search}`.replace(/%2C/gi, ',');
  const path = parsed.hash ? `${suffix}${parsed.hash}` : suffix;
  return absolute ? `${parsed.origin}${path}` : path;
}

/**
 * De deeplink van één gerecht, met de stand van de deler erbij: precies de
 * bestaande BE-12-link, niets meer.
 */
function dishShareHref({ menuLink, dishId, name, category, theme } = {}) {
  const link = buildDishDeepLink({ menuLink, dishId, name, category });
  if (!link) return null;
  return withShareTheme(link, theme);
}

/** Een relatieve link naar een volledige URL maken. */
function dishShareUrl({ baseUrl, href } = {}) {
  if (!href) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(String(href))) return String(href);
  return `${stripTrailingSlash(baseUrl)}${String(href).startsWith('/') ? '' : '/'}${href}`;
}

/** Het adres van de voorvertoningsafbeelding (1200 × 630) van dit gerecht. */
function shareImageHref({ menuId, dishId, name, category, theme } = {}) {
  if (!menuId || !dishId || !name || !category) return null;
  const params = new URLSearchParams();
  params.set('dish', String(dishId));
  params.set('name', String(name));
  params.set('cat', String(category));
  params.set(SHARE_THEME_PARAM, normalizeShareTheme(theme));
  return `/menu/${menuId}/share-image?${params.toString()}`;
}

/** De kop van het deelmenu: gerecht en restaurant, geen berichttekst. */
function dishShareTitle({ name, restaurantName } = {}) {
  const dish = String(name === undefined || name === null ? '' : name).trim();
  const restaurant = String(restaurantName === undefined || restaurantName === null ? '' : restaurantName).trim();
  if (dish && restaurant) return `${dish} · ${restaurant}`;
  return dish || restaurant;
}

/** De prijs zoals de menukaart hem toont; zonder echte prijs "op aanvraag". */
function dishSharePrice(item) {
  return honestPriceLabel(item) || (item && item.price) || 'op aanvraag';
}

/**
 * Eén regel beschrijving: witruimte plat, afgekapt op een woordgrens. Leeg
 * blijft leeg — er wordt nooit een verzonnen regel bijgemaakt.
 */
function oneLineDescription(value, maxLength = 110) {
  const text = String(value === undefined || value === null ? '' : value).split(/\s+/).filter(Boolean).join(' ');
  if (!text) return '';
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  const kept = cut.slice(0, lastSpace > 40 ? lastSpace : maxLength).replace(/[,;:.\s]+$/, '');
  return `${kept}…`;
}

/** og:description: restaurant en adres, en daarachter één regel beschrijving. */
function shareOgDescription({ restaurantName, address, description } = {}) {
  const place = [restaurantName, address]
    .map((part) => String(part === undefined || part === null ? '' : part).trim())
    .filter(Boolean)
    .join(' · ');
  const line = oneLineDescription(description);
  if (place && line) return `${place} — ${line}`;
  return place || line;
}

/**
 * De payload voor `navigator.share()`: alleen `url` en `title` (geen `text`).
 * Zonder URL is er niets te delen en dus geen payload.
 */
function buildSharePayload({ title, url } = {}) {
  if (!url) return null;
  const payload = { url: String(url) };
  if (title) payload.title = String(title);
  return payload;
}

/** Welke weg het delen neemt: het systeemmenu, het klembord, of geen van twee. */
function shareTarget({ share, clipboard } = {}) {
  if (typeof share === 'function') return 'share';
  if (clipboard && typeof clipboard.writeText === 'function') return 'clipboard';
  return 'none';
}

/**
 * Het klembord-alternatief. Een mislukte of geweigerde kopie geeft nooit een
 * valse melding: alleen een geslaagde kopie levert COPIED_MESSAGE op.
 */
async function copyShareLink(clipboard, url) {
  if (!url || !clipboard || typeof clipboard.writeText !== 'function') {
    return { ok: false, message: '' };
  }
  try {
    await clipboard.writeText(String(url));
    return { ok: true, message: COPIED_MESSAGE };
  } catch (error) {
    return { ok: false, message: '' };
  }
}

/**
 * De relatieve deeplink met de stand van dit moment, absoluut gemaakt tegen de
 * oorsprong van de pagina. Zonder href of zonder bruikbare oorsprong: geen URL.
 */
function absoluteShareUrl({ href, origin, theme } = {}) {
  const themed = withShareTheme(href, theme);
  if (!themed) return null;
  try {
    return new URL(themed, origin || 'http://localhost').toString();
  } catch (error) {
    return null;
  }
}

/**
 * Delen zoals de eigenaar het wil (BE-44 criterium 1 en 4): het systeemmenu als
 * dat er is, anders de link naar het klembord, anders niets. Eén functie voor
 * het gerecht en het lijstje, zodat de twee knoppen niet uit elkaar lopen.
 *
 * `browser` is `window` (of een stub in een test). Een afgebroken of mislukte
 * deelactie geeft geen melding en vooral geen tweede, stille poging.
 */
async function shareLink({ browser, href, title, theme } = {}) {
  const navigatorRef = browser && browser.navigator ? browser.navigator : null;
  const origin = browser && browser.location ? browser.location.origin : undefined;
  const url = absoluteShareUrl({ href, origin, theme });
  if (!url) return { mode: 'none', message: '', url: null };
  const mode = shareTarget({
    share: navigatorRef ? navigatorRef.share : undefined,
    clipboard: navigatorRef ? navigatorRef.clipboard : undefined,
  });
  if (mode === 'share') {
    try {
      await navigatorRef.share(buildSharePayload({ title, url }));
    } catch (error) {
      // Afgebroken door de gebruiker of niet beschikbaar: geen melding.
    }
    return { mode: 'share', message: '', url };
  }
  if (mode === 'clipboard') {
    const result = await copyShareLink(navigatorRef.clipboard, url);
    return { mode: 'clipboard', message: result.message, url };
  }
  return { mode: 'none', message: '', url: null };
}

/**
 * De metadata van een gedeelde gerechtlink: og:title "<gerecht> · <prijs>",
 * og:description met restaurant, adres en één regel beschrijving, og:url en de
 * voorvertoningsafbeelding. Geen foto.
 */
function dishShareMetadata({
  dishName, priceLabel, restaurantName, address, description, baseUrl, href, imageHref,
} = {}) {
  const title = [String(dishName || '').trim(), String(priceLabel || '').trim()].filter(Boolean).join(' · ');
  const ogDescription = shareOgDescription({ restaurantName, address, description });
  const url = dishShareUrl({ baseUrl, href });
  const image = dishShareUrl({ baseUrl, href: imageHref });
  const openGraph = { title };
  if (ogDescription) openGraph.description = ogDescription;
  if (url) openGraph.url = url;
  openGraph.locale = 'nl_NL';
  openGraph.type = 'website';
  openGraph.siteName = 'Onze Menukaarten';
  if (image) openGraph.images = [{ url: image, width: 1200, height: 630, alt: title }];
  const metadata = { title };
  if (ogDescription) metadata.description = ogDescription;
  // De basis voor alle relatieve metadata: NEXT_PUBLIC_SITE_URL, anders de
  // host van dit verzoek (zie siteBaseUrl). Alleen als die basis echt een URL
  // is; anders laat deze pagina de algemene waarde staan.
  if (baseUrl && /^https?:\/\//i.test(String(baseUrl))) {
    try {
      metadata.metadataBase = new URL(String(baseUrl));
    } catch (error) {
      // Geen geldige basis: dan geen metadataBase, geen gok.
    }
  }
  metadata.openGraph = openGraph;
  return metadata;
}

module.exports = {
  COPIED_MESSAGE,
  SHARED_DISH_NOTE,
  SHARE_THEME_DARK,
  SHARE_THEME_LIGHT,
  SHARE_THEME_PARAM,
  absoluteShareUrl,
  buildSharePayload,
  copyShareLink,
  dishShareHref,
  dishShareMetadata,
  dishSharePrice,
  dishShareTitle,
  dishShareUrl,
  hasShareTheme,
  normalizeShareTheme,
  oneLineDescription,
  shareImageHref,
  shareLink,
  shareOgDescription,
  shareTarget,
  shareThemeFromAttribute,
  siteBaseUrl,
  withShareTheme,
};
