'use strict';

// BE-62 (#153) — de gestubde kies-API van de browsercheck.
//
// De check bekijkt /kies/<code> na het stemmen. Zonder deze stub zou een tik op
// "Lekker" een echte stemming aanmaken. Daarom beantwoordt deze stub alleen
// /api/v1/kies* met fictieve gerechten en onthoudt hij de stemmen in het
// geheugen van de pagina. Elk ander verzoek gaat naar de echte fetch.
//
// Niets hiervan komt bij een echt project: fictieve data in een lokale browser.

// 22 tekens uit [A-Za-z0-9_-]: geldig volgens KIES_CODE_PATTERN.
const BE62_KIES_CODE = 'be62stubcode0123456789';

const BE62_DISHES = [
  {
    id: 'fictie-0-0',
    name: 'Poussin',
    price: '€ 24,50',
    description: 'Geroosterde poussin met citroen en tijm.',
    restaurant: 'Fictief Restaurant Een',
    reserve: { href: 'tel:+31000000000', method: 'phone' },
    route: 'https://www.google.com/maps/search/?api=1&query=Fictief+1%2C+Breda',
  },
  {
    id: 'fictie-0-1',
    name: 'Risotto',
    price: '€ 18,00',
    description: 'Risotto met paddenstoelen en parmezaan.',
    restaurant: 'Fictief Restaurant Een',
    reserve: { href: 'tel:+31000000000', method: 'phone' },
    route: 'https://www.google.com/maps/search/?api=1&query=Fictief+1%2C+Breda',
  },
  {
    id: 'fictie-0-2',
    name: 'Tiramisu',
    price: '€ 8,50',
    description: 'Tiramisu met mascarpone en espresso.',
    restaurant: 'Fictief Restaurant Twee',
    reserve: { href: 'tel:+31000000001', method: 'phone' },
    route: 'https://www.google.com/maps/search/?api=1&query=Fictief+2%2C+Breda',
  },
];

function be62KiesStubScript() {
  return `(() => {
  if (window.__BE62_KIES_STUB__) return;
  window.__BE62_KIES_STUB__ = true;
  const code = ${JSON.stringify(BE62_KIES_CODE)};
  const dishes = ${JSON.stringify(BE62_DISHES)};
  const votes = [];
  const calls = (window.__BE62_KIES_CALLS__ = []);
  let sequence = 0;

  function outcome() {
    const rows = dishes.map((dish, index) => {
      const own = votes.filter((vote) => vote.dishKey === dish.id);
      const lekker = own.filter((vote) => vote.lekker).length;
      const row = Object.assign({}, dish);
      row.lekker = lekker;
      row.lieverNiet = own.length - lekker;
      row.kiezers = own.filter((vote) => vote.lekker).map((vote) => vote.roepnaam);
      row.lieverNietKiezers = own.filter((vote) => !vote.lekker).map((vote) => vote.roepnaam);
      row.position = index;
      return row;
    });
    rows.sort((a, b) => (b.lekker - a.lekker) || (a.lieverNiet - b.lieverNiet) || (a.position - b.position));
    return {
      uitslag: rows.map((row) => {
        const copy = Object.assign({}, row);
        delete copy.position;
        return copy;
      }),
      stemmers: new Set(votes.map((vote) => vote.stemmer)).size,
      stemmen: votes.length,
    };
  }

  function json(body, status) {
    return new Response(JSON.stringify(body), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const native = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (input, init) {
    const options = init || {};
    const raw = typeof input === 'string' ? input : (input && input.url) || '';
    if (raw.indexOf('/api/v1/tellers') === 0) {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (raw.indexOf('/api/v1/kies') !== 0) {
      return native ? native(input, init) : Promise.reject(new Error('geen fetch'));
    }
    const method = String(options.method || 'GET').toUpperCase();
    let body = null;
    try { body = options.body ? JSON.parse(options.body) : null; } catch (error) { body = null; }
    if (calls.length < 100) calls.push({ method: method, url: raw, body: body });
    if (method === 'GET') {
      return Promise.resolve(json(Object.assign({ code: code, dishes: dishes, sluitOm: null, gesloten: false }, outcome())));
    }
    if (method === 'POST') {
      const index = votes.findIndex((vote) => vote.stemmer === body.stemmer && vote.dishKey === body.dishKey);
      const replaced = index >= 0;
      sequence += 1;
      const record = {
        stemmer: body.stemmer,
        roepnaam: body.roepnaam,
        dishKey: body.dishKey,
        lekker: Boolean(body.lekker),
        gestemdOp: new Date(Date.now() + sequence).toISOString(),
      };
      if (replaced) votes[index] = record;
      else votes.push(record);
      return Promise.resolve(json(Object.assign({ ok: true, vervangen: replaced }, outcome())));
    }
    return Promise.resolve(json({ error: 'unsupported' }, 404));
  };
})();`;
}

module.exports = { BE62_DISHES, BE62_KIES_CODE, be62KiesStubScript };
