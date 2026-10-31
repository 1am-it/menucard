'use strict';

// BE-66 (#162) — een stub voor de verzendstap van /inloggen.
//
// Sinds BE-66 laadt /inloggen de Supabase-client pas bij een tik op "Stuur mij
// een inlogcode". De BE-63-browsercheck moet die stap kunnen meten zonder een
// Supabase-project en zonder echte e-mail. Deze stub vangt daarom precies één
// oproep af: `POST {authOrigin}/auth/v1/otp`, het endpoint dat de Supabase-client
// zelf gebruikt. Het antwoord is hetzelfde lege succesantwoord dat Supabase bij
// een bestaand adres geeft; de app toont daarna haar neutrale melding en de
// codestap.
//
// Al het andere verkeer naar de app gaat gewoon door (naar de eigen origin);
// elke andere bestemming wordt vastgelegd en geweigerd. Geen Supabase, geen
// e-mail, geen productie.

const AUTH_ORIGIN = 'http://127.0.0.1:9';

function installBe66OtpStub(settings) {
  // Deze hulpfunctie staat bewust *binnen* de stub: de stub gaat als broncode
  // de pagina in (`installBe66OtpStub.toString()`), dus alles wat hij gebruikt
  // moet in zijn eigen scope staan. Een helper buiten de functie is in de pagina
  // niet gedefinieerd en zou de verzendstap als netwerkfout laten eindigen.
  function jsonResponse(body, status) {
    return new Response(JSON.stringify(body), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const calls = [];
  const violations = [];
  const stubErrors = [];
  const nativeFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;

  window.fetch = async function (input, init) {
    const href = typeof input === 'string' ? input : (input && input.url) || String(input);
    const url = new URL(href, window.location.href);
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();

    if (url.origin === settings.authOrigin) {
      if (url.pathname === '/auth/v1/otp' && method === 'POST') {
        calls.push({ kind: 'otp', method: method, path: url.pathname, url: url.href });
        try {
          return jsonResponse({}, 200);
        } catch (error) {
          stubErrors.push(String((error && error.message) || error));
          throw error;
        }
      }
      violations.push({ kind: 'unexpected_auth_route', method: method, url: url.href });
      return jsonResponse({ error: 'fixture_unexpected_auth_route' }, 404);
    }

    if (url.origin === window.location.origin) {
      if (!nativeFetch) throw new TypeError('fixture_network_blocked: ' + url.href);
      return nativeFetch(input, init);
    }

    violations.push({ kind: 'external_origin', method: method, url: url.href });
    throw new TypeError('fixture_network_blocked: ' + url.href);
  };

  window.__BE66__ = {
    settings: settings,
    calls: calls,
    violations: violations,
    stubErrors: stubErrors,
    nativeFetchAvailable: Boolean(nativeFetch),
    otpCount: function () {
      return calls.length;
    },
  };
  return window.__BE66__;
}

/** De instellingen van de stub; alles fictief en als JSON te vervoeren. */
function be66Settings(options = {}) {
  const settings = { authOrigin: AUTH_ORIGIN };
  for (const key of Object.keys(options)) {
    if (options[key] !== undefined) settings[key] = options[key];
  }
  return settings;
}

/** De bron voor `Page.addScriptToEvaluateOnNewDocument`. */
function be66OtpStubScript(options = {}) {
  return `(${installBe66OtpStub.toString()})(${JSON.stringify(be66Settings(options))})`;
}

module.exports = {
  AUTH_ORIGIN,
  be66OtpStubScript,
  be66Settings,
  installBe66OtpStub,
};
