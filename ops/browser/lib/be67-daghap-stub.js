'use strict';

// BE-67 (#164) — de gestubde API van de browsercheck van het dagmenu.
//
// Eén zelfstandige functie, als tekst in de pagina gezet. Hij antwoordt op:
//  - GET  /api/v1/daghap            → het aanbod van de houder, met de cijfers;
//  - GET  /api/v1/daghap/publiek    → wat de bezoeker ziet: een dagmenu en een
//                                     uitverkochte daghap;
//  - PATCH /api/v1/daghap/<id>/uitverkocht → Op = op heen en terug;
//  - POST /api/v1/tellers           → 204, met de klik in `tellers` vastgelegd.
//
// Al het andere gaat naar de fetch die er al stond (de auth-stub van BE-48, en
// daaronder de echte app). Geen database, geen productiesleutel, geen internet:
// dit is fictieve data in een lokale browser.

// Het dagmenu van de houder: drie gangen, twee prijzen, en "Elke week op" di en
// do. De cijfers dekken de regel van BE-57: één onder de vijf ("< 5") en één
// erboven.
const DAGMENU = {
  id: 21,
  soort: 'dagmenu',
  naam: 'Drie gangen van de chef',
  gangen: [
    { gang: 'voor', naam: 'Pompoensoep met gember' },
    { gang: 'hoofd', naam: 'Kabeljauw met venkel' },
    { gang: 'na', naam: 'Appeltaart met kaneelijs' },
  ],
  prijsCent: 2950,
  prijs: '€ 29,50',
  prijs3Cent: 3650,
  prijs3: '€ 36,50',
  beschrijving: 'Vanavond, zolang de voorraad strekt',
  labels: ['vegetarisch'],
  verlooptOp: '2026-10-31T22:59:00.000Z',
  herhaalWeekdagen: [2, 4],
  herhaalTot: '2026-12-31',
};

const DAGHAP = {
  id: 11,
  soort: 'daghap',
  naam: 'Pompoensoep met brood',
  prijsCent: 650,
  prijs: '€ 6,50',
  beschrijving: 'Met geroosterde pompoenpitten',
  labels: ['veganistisch'],
  verlooptOp: '2026-10-31T22:59:00.000Z',
};

/** Het aanbod in het overzicht van de houder (GET /api/v1/daghap). */
const HOLDER_AANBOD = [
  {
    id: DAGMENU.id,
    soort: DAGMENU.soort,
    naam: DAGMENU.naam,
    prijs: DAGMENU.prijs,
    prijs3: DAGMENU.prijs3,
    gangen: DAGMENU.gangen,
    beschrijving: DAGMENU.beschrijving,
    labels: DAGMENU.labels,
    status: 'online',
    verlooptOp: DAGMENU.verlooptOp,
    herhaalWeekdagen: DAGMENU.herhaalWeekdagen,
    herhaalTot: DAGMENU.herhaalTot,
    uitverkochtOp: null,
    inControle: false,
    // BE-67, uitkomst 4: bekeken "≥ 5", bewaard "< 5", gedeeld "≥ 5".
    cijfers: { bekekenTekst: '12', bewaardTekst: '< 5', gedeeldTekst: '6' },
  },
  {
    id: DAGHAP.id,
    soort: DAGHAP.soort,
    naam: DAGHAP.naam,
    prijs: DAGHAP.prijs,
    beschrijving: DAGHAP.beschrijving,
    labels: DAGHAP.labels,
    status: 'online',
    verlooptOp: DAGHAP.verlooptOp,
    uitverkochtOp: null,
    inControle: false,
    cijfers: { bekekenTekst: '< 5', bewaardTekst: '< 5', gedeeldTekst: '< 5' },
  },
];

/** Wat de bezoeker in het blok "Vandaag" ziet (GET /api/v1/daghap/publiek). */
const PUBLIEK_AANBOD = [
  { ...DAGMENU, restaurantId: '6', uitverkocht: false },
  // Op = op: dit aanbod blijft in de lijst staan, grijs en doorgestreept.
  { ...DAGHAP, restaurantId: '6', uitverkocht: true },
];

/** De bron van de in-page stub; alles is JSON, dus geen injectie. */
function be67StubScript({ aanbod = HOLDER_AANBOD, publiek = PUBLIEK_AANBOD } = {}) {
  return `(() => {
  if (window.__BE67_STUB__) return;
  window.__BE67_STUB__ = true;
  const nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  const aanbod = ${JSON.stringify(aanbod)};
  const publiek = ${JSON.stringify(publiek)};
  // De houder ziet na elke klik de verse lijst; de stub onthoudt de stand dus.
  const stand = JSON.parse(JSON.stringify(aanbod));
  window.__BE67__ = { aanbod: stand, tellers: [], uitverkocht: [], publiekCalls: [] };
  function antwoord(body, status) {
    return Promise.resolve(new Response(JSON.stringify(body), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' },
    }));
  }
  function leeg(status) {
    return Promise.resolve(new Response(null, { status: status }));
  }
  function vandaag() {
    // Europe/Amsterdam, precies zoals src/lib/daghapAanbod.js het leest.
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' });
  }
  window.fetch = async function (input, init) {
    const rauw = typeof input === 'string' ? input : (input && input.url) || '';
    const pad = rauw.replace(/^https?:\\/\\/[^/]+/, '').split('?')[0];
    const url = rauw.replace(/^https?:\\/\\/[^/]+/, '');
    const method = String((init && init.method) || 'GET').toUpperCase();
    if (pad === '/api/v1/tellers') {
      let body = null;
      try { body = JSON.parse((init && init.body) || 'null'); } catch (error) { body = null; }
      window.__BE67__.tellers.push({ body: body, method: method });
      return leeg(204);
    }
    if (pad === '/api/v1/daghap/publiek') {
      window.__BE67__.publiekCalls.push({ url: url, method: method });
      return antwoord({ ok: true, aanbod: publiek });
    }
    const uit = /^\\/api\\/v1\\/daghap\\/(\\d+)\\/uitverkocht$/.exec(pad);
    if (uit && method === 'PATCH') {
      let body = {};
      try { body = JSON.parse((init && init.body) || '{}') || {}; } catch (error) { body = {}; }
      const rij = stand.find((item) => String(item.id) === uit[1]);
      if (rij) rij.uitverkochtOp = body.uitverkocht === true ? vandaag() : null;
      window.__BE67__.uitverkocht.push({ id: uit[1], uitverkocht: body.uitverkocht === true });
      return antwoord({ ok: true, aanbod: rij || null });
    }
    if (pad === '/api/v1/daghap' && method === 'GET') {
      return antwoord({ ok: true, aanbod: stand });
    }
    if (nativeFetch) return nativeFetch(input, init);
    return antwoord({}, 404);
  };
})();`;
}

module.exports = { DAGMENU, DAGHAP, HOLDER_AANBOD, PUBLIEK_AANBOD, be67StubScript };
