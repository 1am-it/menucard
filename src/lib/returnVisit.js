// BE-62 (#153) — de teksten waarmee een ontvanger terugkomt, zonder account.
//
// Eén plek voor wat er op /kies na het stemmen, bij een gedeeld gerecht en bij
// een gedeeld lijstje staat. De pagina's zelf bepalen alleen wánneer het vlak
// verschijnt (na een eigen stem, of bij een gedeelde link); de woorden staan
// hier, zodat ze testbaar zijn zonder browser en niet per pagina verschillen.
//
// Geen account, geen cookie en geen nieuwe serverdata in dit bestand: het is
// uitsluitend tekst en de bestaande home-link.

'use strict';

const HOME_HREF = '/';

// Na het stemmen (ontwerp, punt 1).
const KIES_RETURN_TITLE_FALLBACK = 'Zelf ook een lijstje maken?';
const KIES_RETURN_BODY = 'Zoek op gerecht in alle menukaarten van Breda, altijd met prijs. Geen account nodig.';
const KIES_RETURN_CTA = 'Zoek een gerecht →';

// Gedeeld gerecht en gedeeld lijstje (ontwerp, punt 2 en 3).
const SHARED_RETURN_TITLE = 'Zelf ook zin in iets?';
const SHARED_RETURN_BODY = 'Zoek op gerecht in alle menukaarten van Breda. Geen app of account nodig.';
const SHARED_RETURN_CTA = 'Zoek een gerecht';

function textOf(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

/**
 * De kop boven het vlak na het stemmen: "Jij koos <gerecht>. Zelf ook een
 * lijstje maken?" Zonder bruikbare gerechtnaam blijft alleen de vraag over.
 */
function kiesReturnTitle(dishName) {
  const name = textOf(dishName);
  return name ? `Jij koos ${name}. ${KIES_RETURN_TITLE_FALLBACK}` : KIES_RETURN_TITLE_FALLBACK;
}

/**
 * Het eerste gerecht dat deze bezoeker "lekker" gaf, opgezocht in de gerechten
 * van de stemming. `lekker` is de volgorde waarin gestemd is (zie
 * src/lib/kiesStemming.js), dus het eerste bruikbare id is precies het gerecht
 * uit het ontwerp. Onbekend of verdwenen id: overslaan, geen gok.
 */
function firstLekkerDish({ dishes, lekker } = {}) {
  const list = Array.isArray(dishes) ? dishes : [];
  const voted = Array.isArray(lekker) ? lekker : [];
  for (const id of voted) {
    const key = textOf(id);
    if (!key) continue;
    const dish = list.find((item) => item && textOf(item.id) === key);
    if (dish && textOf(dish.name)) return dish;
  }
  return null;
}

/** De naam van dat eerste "lekker"-gerecht, of null als er geen is. */
function firstLekkerDishName({ dishes, lekker } = {}) {
  const dish = firstLekkerDish({ dishes, lekker });
  return dish ? textOf(dish.name) : null;
}

module.exports = {
  HOME_HREF,
  KIES_RETURN_BODY,
  KIES_RETURN_CTA,
  KIES_RETURN_TITLE_FALLBACK,
  SHARED_RETURN_BODY,
  SHARED_RETURN_CTA,
  SHARED_RETURN_TITLE,
  firstLekkerDish,
  firstLekkerDishName,
  kiesReturnTitle,
};
