'use strict';

// BE-59 deel 3 (#146) — de gestubde sessie en API van de browsercheck.
//
// Eén zelfstandige functie, als tekst in de pagina gezet via
// Function.prototype.toString() (dezelfde truc als be58-stub-page.js). De echte
// pagina's, de echte Supabase-client en de echte accountmenu-component blijven
// staan; alleen de HTTP-laag is fictief:
//
//   - de sessie staat vóór het laden in localStorage onder de standaardsleutel
//     van de Supabase-client (`sb-127-auth-token`, want de check start de server
//     met NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9). Een gast krijgt die
//     sleutel juist niet: dan moet het accountmenu onzichtbaar blijven;
//   - de auth-origin antwoordt met diezelfde sessie, zodat een verversing nooit
//     naar buiten gaat;
//   - `GET /api/internal/v1/me` antwoordt met de rollen van de sessie,
//     `GET /api/internal/v1/workqueue-counts` met de open-werk-tellingen en
//     `GET /api/claims/mine` met geen claims (de houderpagina);
//   - een andere leesroute onder `/api/internal/v1/` antwoordt met een leeg
//     object en wordt als `apiRoutes` vastgelegd: de interne pagina waarop
//     "Bekijk de site" gecontroleerd wordt vraagt haar eigen gegevens op, en dat
//     is geen fout van deze check;
//   - elke schrijvende of onbekende `/api/`-route wordt geweigerd en als
//     schending vastgelegd, net als een externe oorsprong;
//   - al het anderezelfde-oorsprong-verkeer (statische bestanden) gaat naar de
//     echte fetch van de lokale dev-server.
//
// Niets hiervan komt bij een echt project: fictieve data in een lokale browser.
// Geen import, geen Node-API en geen `require` in de functie hieronder.

const AUTH_ORIGIN = 'http://127.0.0.1:9';
const STORAGE_KEY = 'sb-127-auth-token';

// Fictieve namen en restaurants. De restaurantnaam bestaat echt in
// data/restaurants.json, zodat de kop "Mijn restaurant · [naam]" dezelfde vorm
// heeft als in de app; er wordt niets aan de data toegevoegd.
const BEHEERDER_NAME = 'Sanne de Vries';
const BEHEERDER_EMAIL = 'sanne@example.invalid';
const BEHEERDER_ROLES = [{ role: 'internal' }, { role: 'editor' }];

const HOLDER_NAME = 'Youssef Kaddour';
const HOLDER_EMAIL = 'youssef@example.invalid';
const HOLDER_RESTAURANT_NAME = 'Restaurant Wolfslaar';
const HOLDER_ROLES = [
  { role: 'owner', restaurant_id: '1', restaurant_name: HOLDER_RESTAURANT_NAME },
];

// Zeven openstaande taken: twee concepten, drie bronnen, twee aanleveringen.
const OPEN_WORK_COUNTS = { 'menu-concepts': 2, 'source-triage': 3, 'import-inbox': 2 };

function installBe59Stub(settings) {
  const calls = [];
  const violations = [];
  const apiRoutes = [];
  const nativeFetch = window.fetch ? window.fetch.bind(window) : null;

  function jsonResponse(body, status) {
    return new Response(JSON.stringify(body), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function base64url(value) {
    return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function token(payload) {
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = base64url(JSON.stringify(payload));
    // De SDK controleert elk JWT-deel op base64url, ook de (fictieve) handtekening.
    return header + '.' + body + '.fixture-sig';
  }

  function user() {
    return {
      id: settings.userId,
      aud: 'authenticated',
      role: 'authenticated',
      email: settings.email,
      user_metadata: { full_name: settings.name },
      factors: [],
    };
  }

  function session() {
    return {
      access_token: token({ sub: settings.userId, role: 'authenticated', aal: 'aal2' }),
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'fixture-refresh',
      user: user(),
    };
  }

  function authResponse(url, method) {
    if (url.pathname === '/auth/v1/token' && method === 'POST') return jsonResponse(session());
    if (url.pathname === '/auth/v1/user' && method === 'GET') return jsonResponse(user());
    if (url.pathname === '/auth/v1/logout') return jsonResponse({});
    return jsonResponse({ error: 'fixture_unknown_auth_route' }, 404);
  }

  function appResponse(url, method) {
    if (method === 'GET' && url.pathname === '/api/internal/v1/me') {
      return jsonResponse({ roles: settings.roles });
    }
    if (method === 'GET' && url.pathname === '/api/internal/v1/workqueue-counts') {
      return jsonResponse({ counts: settings.counts });
    }
    if (method === 'GET' && url.pathname === '/api/claims/mine') {
      return jsonResponse({ claims: [] });
    }
    if (method === 'GET' && url.pathname.indexOf('/api/internal/v1/') === 0) {
      // De interne pagina onder de check vraagt haar eigen gegevens op; dat is
      // geen onderdeel van deze controle en geen fout. Wel vastleggen.
      apiRoutes.push(url.pathname);
      return jsonResponse({});
    }

    violations.push({ kind: 'unknown_api_route', method: method, url: url.href });
    return jsonResponse({ error: 'fixture_unknown_api_route' }, method === 'GET' ? 404 : 405);
  }

  window.fetch = async function (input, init) {
    const href = typeof input === 'string' ? input : (input && input.url) || String(input);
    const url = new URL(href, window.location.href);
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();

    if (url.origin === settings.authOrigin) {
      calls.push({ kind: 'auth', method: method, path: url.pathname, url: url.href });
      return authResponse(url, method);
    }
    if (url.origin === window.location.origin && url.pathname.indexOf('/api/') === 0) {
      calls.push({ kind: 'api', method: method, path: url.pathname, url: url.href });
      return appResponse(url, method);
    }
    if (url.origin === window.location.origin) {
      if (!nativeFetch) throw new TypeError('fixture_network_blocked: ' + url.href);
      return nativeFetch(input, init);
    }
    violations.push({ kind: 'external_origin', method: method, url: url.href });
    throw new TypeError('fixture_network_blocked: ' + url.href);
  };

  // De sessie van deze stand: bij een gast juist geen sleutel, zodat het
  // accountmenu niets laadt en de goedkope sessiecontrole "geen sessie" zegt.
  try {
    const pattern = /^sb-.+-auth-token(\.\d+)?$/;
    const bestaand = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key && pattern.test(key)) bestaand.push(key);
    }
    for (const key of bestaand) window.localStorage.removeItem(key);
    if (settings.session) window.localStorage.setItem(settings.storageKey, JSON.stringify(session()));
    window.localStorage.setItem('bredaeats_theme', settings.theme);
  } catch (error) {
    // een geblokkeerde opslag is voor deze check niet fataal
  }

  window.__BE59__ = {
    settings: settings,
    calls: calls,
    violations: violations,
    apiRoutes: apiRoutes,
    sessionValue: function () {
      return window.localStorage.getItem(settings.storageKey);
    },
  };
  return window.__BE59__;
}

/** De instellingen van de stub; alles fictief en als JSON te vervoeren. */
function be59Settings(options = {}) {
  const settings = {
    authOrigin: AUTH_ORIGIN,
    storageKey: STORAGE_KEY,
    session: false,
    userId: 'fixture-gast',
    name: 'Gast',
    email: 'gast@example.invalid',
    theme: 'light',
    roles: [],
    counts: {},
  };
  for (const key of Object.keys(options)) {
    if (options[key] !== undefined) settings[key] = options[key];
  }
  settings.theme = settings.theme === 'dark' ? 'dark' : 'light';
  settings.session = Boolean(settings.session);
  if (!Array.isArray(settings.roles)) settings.roles = [];
  if (!settings.counts || typeof settings.counts !== 'object') settings.counts = {};
  return settings;
}

/** De bron voor `Page.addScriptToEvaluateOnNewDocument`. */
function be59StubScript(options = {}) {
  return `(${installBe59Stub.toString()})(${JSON.stringify(be59Settings(options))})`;
}

module.exports = {
  AUTH_ORIGIN,
  STORAGE_KEY,
  BEHEERDER_NAME,
  BEHEERDER_EMAIL,
  BEHEERDER_ROLES,
  HOLDER_NAME,
  HOLDER_EMAIL,
  HOLDER_RESTAURANT_NAME,
  HOLDER_ROLES,
  OPEN_WORK_COUNTS,
  be59Settings,
  be59StubScript,
};
