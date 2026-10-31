'use strict';

// BE-65 (#157, ronde 4) — de gestubde kies-API van de browsercheck.
//
// De browsercheck raakt het venster "Stuur je lijstje" aan. Een tik op een
// deelmanier met "Laat stemmen" zou zonder deze stub een echte stemming
// aanmaken. Daarom antwoordt deze stub op POST /api/v1/kies met een vaste code
// en onthoudt hij elke oproep in `window.__BE65_KIES_CALLS__`. Al het andere
// gaat naar de echte fetch (inclusief de netwerkguard).
//
// Niets hiervan komt bij een echt project: dit is fictieve data in een lokale
// browser, en de check bewijst dat er nul echte stemmingen zijn gemaakt.

// 22 tekens uit [A-Za-z0-9_-]: geldig volgens KIES_CODE_PATTERN.
const KIES_CODE = 'be65stubcode0123456789';

function be65KiesStubScript() {
  return `(() => {
  if (window.__BE65_KIES_STUB__) return;
  window.__BE65_KIES_STUB__ = true;
  window.__BE65_KIES_CALLS__ = [];
  const nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : ((input && input.url) || '');
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (method === 'POST' && /\\/api\\/v1\\/kies$/.test(url)) {
      let body = null;
      try { body = JSON.parse((init && init.body) || '{}'); } catch (error) { body = null; }
      window.__BE65_KIES_CALLS__.push({ url: url, body: body });
      return Promise.resolve(new Response(JSON.stringify({ code: ${JSON.stringify(KIES_CODE)}, sluitOm: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    }
    return nativeFetch ? nativeFetch(input, init) : Promise.reject(new Error('geen fetch'));
  };
})();`;
}

module.exports = { KIES_CODE, be65KiesStubScript };
