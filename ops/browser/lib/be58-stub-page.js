'use strict';

// BE-58 deel 4 (#143) — de gestubde sessie en API van de browsercheck.
//
// Eén zelfstandige functie, als tekst in de pagina gezet via
// Function.prototype.toString() (dezelfde truc als be48-stub-page.js). De echte
// pagina's, de echte Supabase-client en de echte fetch-aanroepen blijven staan;
// alleen de HTTP-laag is fictief:
//
//   - de sessie staat vóór het laden in localStorage onder de standaardsleutel
//     van de Supabase-client (`sb-127-auth-token`, want de check start de server
//     met NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9);
//   - de auth-origin antwoordt met diezelfde sessie, zodat een verversing nooit
//     naar buiten gaat;
//   - de `/api/...`-routes van de houderpagina en de interne lijst antwoorden
//     met fictieve data en houden hun stand bij (goedkeuren, afwijzen met reden,
//     bevestigen), zodat de check de echte schermen test;
//   - elke andere `/api/`-route wordt geweigerd en als schending vastgelegd;
//     al het anderezelfde-oorsprong-verkeer (statische bestanden) gaat naar de
//     echte fetch van de lokale dev-server;
//   - een externe oorsprong wordt geblokkeerd en vastgelegd.
//
// Niets hiervan komt bij een echt project: fictieve data in een lokale browser.
// Geen import, geen Node-API en geen `require` in de functie hieronder.

const AUTH_ORIGIN = 'http://127.0.0.1:9';
const STORAGE_KEY = 'sb-127-auth-token';
const STATE_KEY = 'be58-state';

const RESTAURANT_ID = '1';
const MENU_ID = '1-lunch';

// Fictieve gerechten van de eigen kaart (vorm van menuGerechtenVoorScherm).
const GERECHTEN = [
  {
    categorieIndex: 0,
    gerechtIndex: 0,
    categorie: 'Soepen',
    naam: 'Pompoensoep met rozemarijnolie',
    prijs: '€ 7,50',
    prijsCent: 750,
    tijdelijkNietBeschikbaar: false,
  },
  {
    categorieIndex: 0,
    gerechtIndex: 1,
    categorie: 'Soepen',
    naam: 'Bouillon van gevogelte',
    prijs: '€ 6,50',
    prijsCent: 650,
    tijdelijkNietBeschikbaar: false,
  },
  {
    categorieIndex: 1,
    gerechtIndex: 0,
    categorie: 'Hoofdgerechten',
    naam: 'Gegrilde zeebaars',
    prijs: '€ 19,50',
    prijsCent: 1950,
    tijdelijkNietBeschikbaar: false,
  },
];

// Twee wijzigingen in controle: één gewone prijswijziging en één "grote
// wijziging" (meer dan 50% verschil), zodat de markering echt te zien is.
const WIJZIGINGEN = [
  {
    wijzigingId: 101,
    restaurantId: RESTAURANT_ID,
    menuId: MENU_ID,
    categorieIndex: 0,
    gerechtIndex: 0,
    gerechtNaam: 'Pompoensoep met rozemarijnolie',
    soort: 'prijs',
    oudePrijsCent: 750,
    prijsCent: 895,
    beschikbaar: null,
    status: 'in_controle',
    groteWijziging: false,
    afwijsReden: null,
    ingediendOp: '2026-10-30T09:15:00.000Z',
    beoordeeldOp: null,
  },
  {
    wijzigingId: 102,
    restaurantId: RESTAURANT_ID,
    menuId: MENU_ID,
    categorieIndex: 1,
    gerechtIndex: 0,
    gerechtNaam: 'Gegrilde zeebaars',
    soort: 'prijs',
    oudePrijsCent: 1950,
    prijsCent: 4200,
    beschikbaar: null,
    status: 'in_controle',
    groteWijziging: true,
    afwijsReden: null,
    ingediendOp: '2026-10-30T09:20:00.000Z',
    beoordeeldOp: null,
  },
];

function installBe58Stub(settings) {
  const calls = [];
  const violations = [];
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

  // De stand van de fictieve server, bewaard in sessionStorage: na het opslaan
  // ververst de pagina zichzelf, en de ingestuurde wijziging moet dan blijven.
  function initialState() {
    return {
      wijzigingen: (settings.wijzigingen || []).map(function (rij) {
        return Object.assign({}, rij);
      }),
      bevestiging: Object.assign({}, settings.bevestiging || {}),
      nextId: 200,
    };
  }

  let state = null;

  function saveState() {
    try {
      window.sessionStorage.setItem(settings.stateKey, JSON.stringify(state));
    } catch (error) {
      // zonder opslag blijft de stand van dit document over
    }
  }

  function loadState() {
    if (state) return state;
    try {
      const raw = window.sessionStorage.getItem(settings.stateKey);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && Array.isArray(parsed.wijzigingen)) {
        state = parsed;
        return state;
      }
    } catch (error) {
      // valt terug op de beginstand
    }
    state = initialState();
    saveState();
    return state;
  }

  function eigenWijzigingen() {
    return loadState().wijzigingen.slice().sort(function (links, rechts) {
      return String(rechts.ingediendOp).localeCompare(String(links.ingediendOp));
    });
  }

  function metStatus(status) {
    return loadState().wijzigingen.filter(function (rij) {
      return rij.status === status;
    });
  }

  function bevestigingNu() {
    return Object.assign({}, loadState().bevestiging);
  }

  function parseBody(body) {
    if (!body) return {};
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (error) {
      // geen JSON: ongeldig verzoek
    }
    return null;
  }

  function authResponse(url, method) {
    if (url.pathname === '/auth/v1/token' && method === 'POST') return jsonResponse(session());
    if (url.pathname === '/auth/v1/user' && method === 'GET') return jsonResponse(user());
    if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
    violations.push({ kind: 'unknown_auth_route', method: method, url: url.href });
    return jsonResponse({ error: 'fixture_unknown_auth_route' }, 404);
  }

  function appResponse(url, method, body) {
    const pad = url.pathname;

    if (pad === '/api/internal/v1/me' && method === 'GET') {
      return jsonResponse({ roles: settings.roles });
    }
    if (pad === '/api/internal/v1/workqueue-counts' && method === 'GET') {
      return jsonResponse({ counts: settings.counts });
    }

    if (pad === '/api/v1/menukaart/gerechten' && method === 'GET') {
      return jsonResponse({
        ok: true,
        restaurantId: settings.restaurantId,
        menuId: settings.menuId,
        menuNaam: settings.menuNaam,
        gerechten: settings.gerechten,
        bevestiging: bevestigingNu(),
      });
    }

    if (pad === '/api/v1/menukaart/wijzigingen' && method === 'GET') {
      const restaurant = url.searchParams.get('restaurant');
      return jsonResponse({
        ok: true,
        wijzigingen: eigenWijzigingen().filter(function (rij) {
          return !restaurant || rij.restaurantId === restaurant;
        }),
        daglimiet: { maximum: 30, resterend: 30 },
      });
    }

    if (pad === '/api/v1/menukaart/wijzigingen' && method === 'POST') {
      const gevraagd = parseBody(body);
      if (!gevraagd) return jsonResponse({ error: 'invalid_body', message: 'Het verzoek is ongeldig.' }, 400);
      const gerecht =
        (settings.gerechten || []).filter(function (rij) {
          return rij.categorieIndex === gevraagd.categorieIndex && rij.gerechtIndex === gevraagd.gerechtIndex;
        })[0] || null;
      if (!gerecht) {
        return jsonResponse({ error: 'gerecht_onbekend', message: 'Dit gerecht staat niet op de kaart.' }, 400);
      }
      const prijsCent =
        gevraagd.soort === 'prijs' ? Math.round(Number(String(gevraagd.prijs).replace(',', '.')) * 100) : null;
      if (gevraagd.soort === 'prijs' && !(prijsCent >= 50 && prijsCent <= 15000)) {
        return jsonResponse(
          { error: 'prijs_buiten_grens', message: 'De prijs moet tussen € 0,50 en € 150 liggen.' },
          400,
        );
      }
      const huidig = loadState();
      const rij = {
        wijzigingId: huidig.nextId++,
        restaurantId: settings.restaurantId,
        menuId: settings.menuId,
        categorieIndex: gevraagd.categorieIndex,
        gerechtIndex: gevraagd.gerechtIndex,
        gerechtNaam: gerecht.naam,
        soort: gevraagd.soort,
        oudePrijsCent: gerecht.prijsCent,
        prijsCent: prijsCent,
        beschikbaar: gevraagd.soort === 'beschikbaarheid' ? Boolean(gevraagd.beschikbaar) : null,
        status: 'in_controle',
        groteWijziging: Boolean(
          prijsCent !== null &&
            gerecht.prijsCent > 0 &&
            Math.abs(prijsCent - gerecht.prijsCent) / gerecht.prijsCent > 0.5,
        ),
        afwijsReden: null,
        ingediendOp: new Date().toISOString(),
        beoordeeldOp: null,
      };
      huidig.wijzigingen.push(rij);
      saveState();
      return jsonResponse(
        { ok: true, wijziging: rij, message: 'We controleren een wijziging kort voordat gasten hem zien.' },
        201,
      );
    }

    if (pad === '/api/v1/menukaart/bevestigen' && method === 'POST') {
      const bevestiging = {
        actief: true,
        label: 'Bevestigd door het restaurant',
        datum: settings.bevestigDatum,
        verlooptOp: settings.verlooptOp,
      };
      loadState().bevestiging = bevestiging;
      saveState();
      return jsonResponse({ ok: true, bevestiging: bevestiging, geldigDagen: 90 });
    }

    if (pad === '/api/internal/v1/menukaart-wijzigingen' && method === 'GET') {
      const status = url.searchParams.get('status') || 'in_controle';
      const rijen = metStatus(status);
      return jsonResponse({
        ok: true,
        status: status,
        wijzigingen: rijen,
        groteWijzigingen: rijen.filter(function (rij) {
          return rij.groteWijziging;
        }).length,
      });
    }

    const beoordeel = /^\/api\/internal\/v1\/menukaart-wijzigingen\/(\d+)\/(goedkeuren|afwijzen)$/.exec(pad);
    if (beoordeel && method === 'POST') {
      const id = Number(beoordeel[1]);
      const actie = beoordeel[2];
      const rij = loadState().wijzigingen.filter(function (item) {
        return item.wijzigingId === id;
      })[0];
      if (!rij) return jsonResponse({ error: 'niet_gevonden', message: 'Deze wijziging bestaat niet.' }, 404);
      if (rij.status !== 'in_controle') {
        return jsonResponse({ error: 'status_ongeldig', message: 'Deze wijziging is al beoordeeld.' }, 409);
      }
      if (actie === 'afwijzen') {
        const gevraagd = parseBody(body);
        const reden = gevraagd && typeof gevraagd.reden === 'string' ? gevraagd.reden.trim() : '';
        if (!reden) {
          return jsonResponse(
            { error: 'afwijs_reden_verplicht', message: 'Geef een reden op voor het afwijzen.' },
            400,
          );
        }
        rij.afwijsReden = reden;
        rij.status = 'afgewezen';
        rij.beoordeeldOp = new Date().toISOString();
        saveState();
        return jsonResponse({ ok: true, wijziging: rij });
      }
      rij.status = 'goedgekeurd';
      rij.beoordeeldOp = new Date().toISOString();
      const bevestiging = {
        actief: true,
        label: 'Bevestigd door het restaurant',
        datum: settings.bevestigDatum,
        verlooptOp: settings.verlooptOp,
      };
      loadState().bevestiging = bevestiging;
      saveState();
      return jsonResponse({ ok: true, wijziging: rij, bevestiging: bevestiging });
    }

    violations.push({ kind: 'unknown_api_route', method: method, url: url.href });
    return jsonResponse({ error: 'fixture_unknown_api_route' }, 404);
  }

  window.fetch = async function (input, init) {
    const href = typeof input === 'string' ? input : (input && input.url) || String(input);
    const url = new URL(href, window.location.href);
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    const body = init && typeof init.body === 'string' ? init.body : null;

    if (url.origin === settings.authOrigin) {
      calls.push({ kind: 'auth', method: method, path: url.pathname, url: url.href });
      return authResponse(url, method);
    }
    if (url.origin === window.location.origin && url.pathname.indexOf('/api/') === 0) {
      calls.push({ kind: 'api', method: method, path: url.pathname, url: url.href, body: body });
      return appResponse(url, method, body);
    }
    if (url.origin === window.location.origin) {
      if (!nativeFetch) throw new TypeError('fixture_network_blocked: ' + url.href);
      return nativeFetch(input, init);
    }
    violations.push({ kind: 'external_origin', method: method, url: url.href });
    throw new TypeError('fixture_network_blocked: ' + url.href);
  };

  try {
    window.localStorage.setItem('bredaeats_theme', settings.theme);
    window.localStorage.setItem(settings.storageKey, JSON.stringify(session()));
  } catch (error) {
    // een geblokkeerde opslag is voor deze check niet fataal
  }

  window.__BE58__ = {
    settings: settings,
    calls: calls,
    violations: violations,
    state: function () {
      return loadState();
    },
    clear: function () {
      state = initialState();
      saveState();
      return state;
    },
  };
  return window.__BE58__;
}

/** De instellingen van de stub; alles fictief en als JSON te vervoeren. */
function be58Settings(options = {}) {
  const settings = {
    authOrigin: AUTH_ORIGIN,
    storageKey: STORAGE_KEY,
    stateKey: STATE_KEY,
    userId: 'fixture-houder',
    email: 'houder@example.invalid',
    restaurantId: RESTAURANT_ID,
    menuId: MENU_ID,
    menuNaam: 'Lunchkaart',
    theme: 'dark',
    roles: [{ role: 'owner', restaurant_id: RESTAURANT_ID }],
    counts: { 'menu-concepts': 0, 'source-triage': 0, 'import-inbox': 0 },
    gerechten: GERECHTEN,
    wijzigingen: WIJZIGINGEN,
    bevestiging: { actief: false, label: '', datum: '', verlooptOp: null },
    bevestigDatum: '31 oktober 2026',
    verlooptOp: '2027-01-29',
  };
  for (const key of Object.keys(options)) {
    if (options[key] !== undefined) settings[key] = options[key];
  }
  settings.theme = settings.theme === 'light' ? 'light' : 'dark';
  if (!Array.isArray(settings.roles)) settings.roles = [];
  return settings;
}

/** De bron voor `Page.addScriptToEvaluateOnNewDocument`. */
function be58StubScript(options = {}) {
  return `(${installBe58Stub.toString()})(${JSON.stringify(be58Settings(options))})`;
}

module.exports = {
  AUTH_ORIGIN,
  STORAGE_KEY,
  RESTAURANT_ID,
  MENU_ID,
  GERECHTEN,
  WIJZIGINGEN,
  be58Settings,
  be58StubScript,
};
