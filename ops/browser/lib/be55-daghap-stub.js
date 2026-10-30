'use strict';

// BE-55 stap B (#135) — de gestubde daghap-API van de browsercheck.
//
// Eén zelfstandige functie, als tekst in de pagina gezet. Hij antwoordt alleen
// op de twee daghap-routes; al het andere gaat naar de echte fetch. `?leeg=1`
// op de pagina geeft een lege lijst, zodat "geen aanbod, geen blok" te zien is.
//
// Niets hiervan komt bij een echt project: dit is fictieve data in een lokale
// browser.

const DAGHAP = {
  id: 11,
  soort: 'daghap',
  naam: 'Pompoensoep met brood',
  prijsCent: 650,
  prijs: '€ 6,50',
  beschrijving: 'Met geroosterde pompoenpitten',
  labels: ['veganistisch', 'glutenvrij'],
  verlooptOp: '2026-10-30T22:59:00.000Z',
};

const SEIZOEN = {
  id: 12,
  soort: 'seizoensgerecht',
  naam: 'Herfststoof met paddenstoelen',
  prijsCent: 1450,
  prijs: '€ 14,50',
  beschrijving: 'Langzaam gegaard met tijm',
  labels: ['vegetarisch'],
  verlooptOp: '2026-12-30T22:59:00.000Z',
};

/** De bron van de in-page stub; `aanbod` is JSON, dus geen injectie. */
function be55StubScript({ aanbod = [DAGHAP, SEIZOEN] } = {}) {
  return `(() => {
  if (window.__BE55_STUB__) return;
  window.__BE55_STUB__ = true;
  const nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  const aanbod = ${JSON.stringify(aanbod)};
  const gemeld = {};
  // BE-55 deel 5 (#135) — dezelfde kleine lijst die de zoekroute zou maken:
  // één restaurant met een daghap, één met een seizoensgerecht.
  const zoekAanbod = { '6': [{ soort: 'daghap', naam: ${JSON.stringify(DAGHAP.naam)} }], '19': [{ soort: 'seizoensgerecht', naam: ${JSON.stringify(SEIZOEN.naam)} }] };
  function groep(restaurantId, restaurantName, mealType, dish) {
    const hit = zoekAanbod[restaurantId];
    return {
      restaurantId: restaurantId,
      restaurantName: restaurantName,
      menus: [{
        mealType: mealType,
        count: 1,
        menuLink: '/menu/' + restaurantId + '-' + mealType,
        examples: [{ dishId: restaurantId + '-' + mealType + '-0-0', name: dish.naam, category: 'Hoofdgerechten', weakMatch: false, priceDisplay: dish.prijs, priceOnRequest: false, priceIsFrom: false }],
      }],
      ...(hit ? { vandaag: { soort: hit[0].soort, naam: hit[0].naam } } : {}),
    };
  }
  const groepen = [groep('6', 'Brasserie Bardot', 'diner', ${JSON.stringify(DAGHAP)}), groep('23', 'T-Huis', 'lunch', { naam: 'Tomatensoep', prijs: '€ 5,00' })];
  function antwoord(body, status) {
    return Promise.resolve(new Response(JSON.stringify(body), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' },
    }));
  }
  window.fetch = async function (input, init) {
    const url = String(typeof input === 'string' ? input : (input && input.url) || '');
    const method = String((init && init.method) || 'GET').toUpperCase();
    if (url.indexOf('/api/search') !== -1 && location.search.indexOf('vandaag=1') !== -1) {
      const filterAan = url.indexOf('vandaag=1') !== -1;
      (window.__BE55_ZOEK__ = window.__BE55_ZOEK__ || []).push(url);
      // De server filtert; de stub doet precies hetzelfde: alleen de treffers.
      const zichtbaar = filterAan ? groepen.filter((rij) => Boolean(rij.vandaag)) : groepen;
      return antwoord({ results: [], total: zichtbaar.length, nextCursor: null, hasMore: false, restaurantGroups: zichtbaar });
    }
    if (url.indexOf('/api/v1/daghap/vandaag') !== -1) {
      (window.__BE55_HOME__ = window.__BE55_HOME__ || []).push(url);
      return antwoord({ ok: true, aanbod: [
        { ...${JSON.stringify(DAGHAP)}, restaurantId: '6' },
        { ...${JSON.stringify(SEIZOEN)}, restaurantId: '19' },
      ] });
    }
    if (url.indexOf('/api/v1/daghap/publiek') !== -1) {
      const leeg = location.search.indexOf('leeg=1') !== -1;
      window.__BE55_LAATSTE__ = { url: url, methode: method };
      return antwoord({ ok: true, aanbod: leeg ? [] : aanbod });
    }
    const meld = /\\/api\\/v1\\/daghap\\/(\\d+)\\/meld$/.exec(url);
    if (meld && method === 'POST') {
      const body = JSON.parse((init && init.body) || '{}');
      (window.__BE55_MELDINGEN__ = window.__BE55_MELDINGEN__ || []).push(body);
      const sleutel = meld[1] + ':' + String(body.apparaat);
      if (gemeld[sleutel]) {
        return antwoord({ ok: true, gemeld: false, alGemeld: true, aantal: 2, inControle: false, message: 'Je had dit al gemeld. We kijken ernaar.' });
      }
      gemeld[sleutel] = true;
      return antwoord({ ok: true, gemeld: true, alGemeld: false, aantal: 1, inControle: false, message: 'Bedankt, we kijken ernaar.' });
    }
    if (nativeFetch) return nativeFetch(input, init);
    return antwoord({}, 404);
  };
})();`;
}

module.exports = { DAGHAP, SEIZOEN, be55StubScript };
