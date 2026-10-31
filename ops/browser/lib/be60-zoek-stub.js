'use strict';

// BE-60 (#150) — de gestubde zoek-API van de browsercheck.
//
// Eén zelfstandige functie, als tekst in de pagina gezet. Hij antwoordt alleen
// op /api/search; al het andere gaat naar de echte fetch. Zo ziet de echte
// zoekpagina een resultaat met een goedgekeurde prijswijziging (€ 18,50) en een
// gerecht dat tijdelijk niet beschikbaar is, zonder database en zonder
// overlay-rijen.
//
// Niets hiervan komt bij een echt project: dit is fictieve data in een lokale
// browser.

const NIEUWE_PRIJS = '€18,50';
const OUDE_PRIJS = '€23,75';
const LABEL = 'Tijdelijk niet beschikbaar';

function be60StubScript() {
  return `(() => {
  if (window.__BE60_STUB__) return;
  window.__BE60_STUB__ = true;
  const nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  function antwoord(body, status) {
    return Promise.resolve(new Response(JSON.stringify(body), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' },
    }));
  }
  // Twee gerechten in één groep: de eerste heeft de nieuwe prijs, de tweede het
  // label. Beide blijven zichtbaar, in dezelfde volgorde.
  const groepen = [{
    restaurantId: '23',
    restaurantName: 'T-Huis',
    menus: [{
      mealType: 'lunch',
      count: 2,
      menuLink: '/menu/23-lunch',
      examples: [
        { dishId: '23-lunch-0-10', name: 'Steak à la T-Huis', category: 'Breakfast & Lunch',
          weakMatch: false, priceDisplay: ${JSON.stringify(NIEUWE_PRIJS)}, priceOnRequest: false, priceIsFrom: false },
        { dishId: '23-lunch-0-11', name: 'Tournedos à la T-Huis', category: 'Breakfast & Lunch',
          weakMatch: false, priceDisplay: '€21,00', priceOnRequest: false, priceIsFrom: false,
          tijdelijkNietBeschikbaar: true },
      ],
    }],
  }];
  window.fetch = async function (input, init) {
    const url = String(typeof input === 'string' ? input : (input && input.url) || '');
    if (url.indexOf('/api/search') !== -1) {
      (window.__BE60_ZOEK__ = window.__BE60_ZOEK__ || []).push(url);
      return antwoord({ results: [], total: groepen.length, nextCursor: null, hasMore: false, restaurantGroups: groepen });
    }
    if (nativeFetch) return nativeFetch(input, init);
    return antwoord({}, 404);
  };
})();`;
}

module.exports = { NIEUWE_PRIJS, OUDE_PRIJS, LABEL, be60StubScript };
