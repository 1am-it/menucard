'use strict';

// The in-page fixture: a fictional Supabase session (so the real client-side
// auth path runs) and fictional same-origin API responses. It never contacts a
// real Supabase project or production API.
//
// Isolation is fail-closed (Delivery Lead review 6248407225). The previous
// implementation fell back to the native fetch for unknown URLs. Now every
// fetch, XHR, WebSocket, EventSource and sendBeacon call is classified against
// the shared network policy; only explicit local app resources and explicit
// fictional fixture API routes are allowed. Unknown external URLs, protocol-
// relative external URLs and unknown API/write routes are rejected and recorded
// in `window.__FIXTURE_NETWORK_VIOLATIONS__`. The CDP layer in the harness
// applies the same policy to subresources and navigation.
//
// The query parameters choose the fixture and the app's own light/dark theme
// before first paint.

const { FIXTURE_API_ROUTES, classifyRequest } = require('./network-policy');

function fixtureBootstrap(scenarios, options = {}) {
  const config = {
    appOrigins: options.appOrigins,
    fixtureRoutes: options.fixtureRoutes || FIXTURE_API_ROUTES,
    baseUrl: options.baseUrl || 'http://localhost:3137/internal/source-triage/batch',
  };
  return `(() => {
  try {
    const fixtures = ${JSON.stringify(scenarios)};
    const policyConfig = ${JSON.stringify(config)};
    const classify = ${classifyRequest.toString()};
    const params = new URLSearchParams(location.search);
    const pathname = location.pathname || (location.href ? new URL(location.href).pathname : '');
    const requestedFixture = params.get('fixture');
    // A real click from the list to a detail drops the query string. The path
    // therefore chooses the concept dataset, so the click path is exercised
    // without inventing a fixture-only link. The same applies to the image/
    // scan follow-up into Bronnen beoordelen.
    const fixture = requestedFixture
      || (pathname.indexOf('/internal/menu-concepts') === 0
        ? 'concepts'
        : pathname === '/internal/source-triage' ? 'triage' : 'review');
    const theme = params.get('theme') === 'light' ? 'light' : 'dark';
    const session = {
      access_token: 'fixture-token',
      token_type: 'bearer',
      expires_in: 86400,
      expires_at: Math.floor(Date.now() / 1000) + 86400,
      refresh_token: 'fixture-refresh',
      user: { id: 'fixture-user', aud: 'authenticated', role: 'authenticated', email: 'fixture@example.invalid' },
    };
    const authValue = JSON.stringify(session);
    const store = new Map([['bredaeats_theme', theme], ['auth-token', authValue]]);
    const proto = window.Storage && window.Storage.prototype;
    if (proto) {
      const nativeGet = proto.getItem;
      const nativeSet = proto.setItem;
      const nativeRemove = proto.removeItem;
      proto.getItem = function (key) {
        const k = String(key);
        if (k.includes('auth-token')) return store.get('auth-token') || null;
        if (k === 'bredaeats_theme') return store.get('bredaeats_theme') || null;
        return nativeGet.call(this, k);
      };
      proto.setItem = function (key, value) {
        const k = String(key);
        if (k.includes('auth-token')) { store.set('auth-token', String(value)); return; }
        if (k === 'bredaeats_theme') { store.set('bredaeats_theme', String(value)); return; }
        return nativeSet.call(this, k, value);
      };
      proto.removeItem = function (key) {
        const k = String(key);
        if (k.includes('auth-token')) { store.delete('auth-token'); return; }
        if (k === 'bredaeats_theme') { store.delete('bredaeats_theme'); return; }
        return nativeRemove.call(this, k);
      };
    }
    const violations = window.__FIXTURE_NETWORK_VIOLATIONS__ = window.__FIXTURE_NETWORK_VIOLATIONS__ || [];
    window.__FIXTURE_NETWORK_BLOCKED__ = false;
    function describeBlocked(verdict) {
      return 'fixture_network_blocked: ' + (verdict.reason || 'not_allowed') + ' (' + (verdict.method || 'GET') + ' ' + (verdict.url || 'unknown') + ')';
    }
    function recordViolation(kind, raw, method, verdict) {
      if (violations.length < 50) {
        violations.push({
          phase: window.__FIXTURE_NETWORK_PHASE__ || 'app',
          kind: kind,
          method: String(method || 'GET').toUpperCase(),
          url: verdict && verdict.url ? verdict.url : String(raw || ''),
          reason: (verdict && verdict.reason) || 'not_allowed',
          protocolRelative: Boolean(verdict && verdict.protocolRelative),
          at: new Date().toISOString(),
        });
      }
      window.__FIXTURE_NETWORK_BLOCKED__ = true;
    }
    function jsonResponse(body, status) {
      return new Response(JSON.stringify(body), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
    }
    const fixtureState = { manualStep: 0, manualState: 0, aiRead: false };
    // #59 variant 5: which fictional API routes the screen actually called, so
    // the browser check can prove that a card page is only fetched on request.
    const calls = (window.__FIXTURE_CALLS__ = window.__FIXTURE_CALLS__ || []);
    function fixtureResponse(verdict) {
      if (calls.length < 200) calls.push({ routeId: verdict.routeId || null, at: new Date().toISOString() });
      if (verdict.routeId === 'auth') return jsonResponse(session);
      if (verdict.routeId === 'me') {
        return jsonResponse({ roles: [{ role: 'internal', restaurant_id: null }, { role: 'editor', restaurant_id: null }] });
      }
      if (verdict.routeId === 'batch-analysis-process') return jsonResponse({ outcome: 'done' });
      if (typeof verdict.routeId === 'string' && verdict.routeId.indexOf('manual-') === 0) {
        const scenario = fixtures[fixture];
        const manual = scenario && scenario.manual;
        if (!manual) return jsonResponse({ error: 'Fictief importszenario ontbreekt.' }, 500);
        // K1: elke stap levert een nieuw (fictief) toestandstoken. De browser
        // geeft het bij de volgende stap terug; de fixture antwoordt alleen op
        // een token dat hij zelf heeft uitgegeven.
        const nextToken = () => {
          fixtureState.manualState += 1;
          return 'fixture-state-' + fixtureState.manualState;
        };
        if (verdict.routeId === 'manual-restaurants') {
          const url = new URL(verdict.url, 'http://localhost');
          const id = url.searchParams.get('id');
          if (id) {
            const found = manual.restaurants.find((entry) => entry.id === id);
            return found ? jsonResponse({ restaurant: found }) : jsonResponse({ error: 'Onbekend restaurant.' }, 404);
          }
          const query = (url.searchParams.get('q') || '').toLowerCase();
          return jsonResponse({ restaurants: manual.restaurants.filter((entry) => entry.name.toLowerCase().includes(query)) });
        }
        if (verdict.routeId === 'manual-bundles') {
          return jsonResponse({ bundle: manual.bundle, prompt: manual.prompt, state: nextToken(), validUntil: manual.validUntil });
        }
        // K5: een verlopen stap is een gewone melding; de pagina biedt daarna
        // "Opnieuw maken". Alleen met ?manualFail=expired, dus nooit stil.
        if (verdict.routeId === 'manual-imports' && params.get('manualFail') === 'expired') {
          return jsonResponse(
            { error: 'Deze stap is verlopen. Maak opnieuw een prompt.', reason: 'state_expired' },
            409,
          );
        }
        // U1/U2: een fictief afgekeurd antwoord (422) met leesbare punten en de
        // herstelvraag, zodat het scherm de echte foutweergave kan tonen.
        if (verdict.routeId === 'manual-imports' && params.get('manualFail') === 'schema') {
          return jsonResponse(manual.rejection.body, manual.rejection.status);
        }
        // V1/V2 (review 6377050602): hetzelfde antwoord, maar met de door het
        // systeem afgeleide telling en status. Alleen met ?manualNormalize=1,
        // dus nooit stil: het bestaande scenario antwoordt ongewijzigd.
        if (verdict.routeId === 'manual-imports' && params.get('manualNormalize') === '1') {
          return jsonResponse({
            import: manual.normalized.import,
            review: manual.normalized.review,
            state: nextToken(),
            validUntil: manual.validUntil,
          });
        }
        if (verdict.routeId === 'manual-imports') {
          return jsonResponse({
            import: manual.import,
            review: manual.reviews[0],
            state: nextToken(),
            validUntil: manual.validUntil,
          });
        }
        if (verdict.routeId === 'manual-follow-up') return jsonResponse({ prompt: manual.followUpPrompt });
        if (verdict.routeId === 'manual-decisions') {
          fixtureState.manualStep = Math.min(fixtureState.manualStep + 1, manual.reviews.length - 1);
          return jsonResponse({
            row: null,
            review: manual.reviews[fixtureState.manualStep],
            state: nextToken(),
            validUntil: manual.validUntil,
          });
        }
        if (verdict.routeId === 'manual-save') return jsonResponse(manual.saved);
        // #59 variant 5 (Lead order 6382953597): one printed page of one source.
        // Only a source and a page that the fixture itself prepared are answered;
        // anything else is refused, so the check never invents a page.
        if (verdict.routeId === 'manual-source-map') {
          let body = {};
          try {
            body = JSON.parse(verdict.body || '{}');
          } catch (ignored) {
            return jsonResponse({ error: 'Ongeldig verzoek.', reason: 'body_invalid' }, 400);
          }
          const key = String(body.source_id || '') + ':' + String(body.page || 1);
          // De kaartstap loopt mee met de beslisstap: na een keuze antwoordt de
          // fixture met dezelfde stand die de review al toont.
          const steps = Array.isArray(manual.cardSteps) ? manual.cardSteps : [manual.cards || {}];
          const step = steps[Math.min(fixtureState.manualStep, steps.length - 1)] || {};
          const card = step[key];
          return card
            ? jsonResponse({ card, validUntil: manual.validUntil })
            : jsonResponse({ error: 'Deze pagina bestaat niet op deze kaart.', reason: 'page_out_of_range' }, 422);
        }
      }
      // #59 / BE-21 "Lees met AI" (Lead review 6380804419): only the two
      // fictional AI routes below are answered; the app itself never reaches a
      // provider, so no AI traffic exists in this check.
      if (typeof verdict.routeId === 'string' && verdict.routeId.indexOf('menu-ai-') === 0) {
        const scenario = fixtures[fixture];
        const ai = scenario && (scenario.ai || (scenario.manual && scenario.manual.ai));
        if (!ai) return jsonResponse({ error: 'Fictief AI-szenario ontbreekt.' }, 500);
        if (verdict.routeId === 'menu-ai-status') {
          // ?aiState=off shows the same block without a key or flag (W3).
          if (params.get('aiState') === 'off') return jsonResponse(ai.statusOff, 200);
          // BB3 (review 6384867373): after a fictional reading the month line
          // must show the new total, exactly like the real route that counts the
          // durable concepts. The state lives in this page load only.
          return jsonResponse(fixtureState.aiRead && ai.statusAfterRead ? ai.statusAfterRead : ai.status, 200);
        }
        if (verdict.routeId === 'menu-ai-read') {
          // Y3 (review 6381657192): aiState=slow holds the fictional answer
          // briefly, so the real "AI bezig" state is observable and can be
          // screenshotted. Still fixture only: no provider is contacted.
          const answer = () => {
            if (ai.read.body) {
              fixtureState.aiRead = true;
              return jsonResponse(ai.read.body, ai.read.status);
            }
            return jsonResponse({ error: 'De AI is nu niet bereikbaar. Ga verder met de handmatige import.', reason: 'provider_unavailable' }, 422);
          };
          if (params.get('aiState') === 'slow') {
            return new Promise((resolve) => setTimeout(() => resolve(answer()), 2500));
          }
          return answer();
        }
      }
      if (verdict.routeId === 'batch-analysis') {
        if (fixture === 'error') {
          return jsonResponse({ error: 'De batchanalyse kon niet worden geladen.' }, 500);
        }
        const scenario = fixtures[fixture] || fixtures.review;
        return jsonResponse(scenario && scenario.batch ? scenario.batch : scenario);
      }
      if (verdict.routeId === 'source-triage') {
        const scenario = fixtures[fixture] || fixtures.triage;
        const triage = scenario && scenario.triage ? scenario.triage : (fixtures.triage && fixtures.triage.triage);
        return triage ? jsonResponse(triage) : jsonResponse({ error: 'Fictief brontriagescenario ontbreekt.' }, 500);
      }
      if (verdict.routeId === 'menu-concepts-list' || verdict.routeId === 'menu-concepts-detail') {
        const scenario = fixtures[fixture];
        if (!scenario) return jsonResponse({ error: 'Fictief conceptenscenario ontbreekt.' }, 500);
        if (verdict.routeId === 'menu-concepts-list') {
          if (scenario.listStatus && scenario.listStatus !== 200) {
            return jsonResponse({ error: scenario.listError || 'De menuconcepten konden niet worden geladen.' }, scenario.listStatus);
          }
          return jsonResponse(scenario.list || { items: [] });
        }
        if (scenario.detailStatus && scenario.detailStatus !== 200) {
          return jsonResponse({ error: scenario.detailError || 'Het menuconcept kon niet worden geladen.' }, scenario.detailStatus);
        }
        const prefix = '/api/internal/v1/menu-concepts/';
        const id = decodeURIComponent(new URL(verdict.url).pathname.slice(prefix.length));
        const detail = (scenario.detail || {})[id];
        return detail ? jsonResponse(detail) : jsonResponse({ error: 'Menuconcept niet gevonden.' }, 404);
      }
      return jsonResponse({ error: 'fixture route not implemented' }, 500);
    }

    const nativeFetch = window.fetch ? window.fetch.bind(window) : null;
    window.fetch = async function (input, init) {
      const raw = typeof input === 'string' ? input : (input && input.url) || '';
      const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      const verdict = classify(raw, { appOrigins: policyConfig.appOrigins, fixtureRoutes: policyConfig.fixtureRoutes, baseUrl: policyConfig.baseUrl, method: method });
      if (!verdict.allowed) {
        recordViolation('fetch', raw, method, verdict);
        throw new Error(describeBlocked(verdict));
      }
      if (verdict.kind === 'fixture_api') {
        // The request body travels with the verdict so a fictional read route can
        // answer for exactly the source and page the screen asked for.
        verdict.body = typeof (init && init.body) === 'string' ? init.body : null;
        return fixtureResponse(verdict);
      }
      if (!nativeFetch) {
        recordViolation('fetch_no_native', raw, method, { reason: 'native_fetch_unavailable', url: String(raw) });
        throw new Error('fixture_network_blocked: native_fetch_unavailable');
      }
      return nativeFetch(input, init);
    };

    const NativeXHR = window.XMLHttpRequest;
    if (NativeXHR && NativeXHR.prototype) {
      const nativeOpen = NativeXHR.prototype.open;
      const nativeSend = NativeXHR.prototype.send;
      NativeXHR.prototype.open = function (method, url) {
        this.__fixtureRequest = { method: String(method || 'GET').toUpperCase(), url: String(url || '') };
        return nativeOpen.apply(this, arguments);
      };
      NativeXHR.prototype.send = function (body) {
        const request = this.__fixtureRequest || { method: 'GET', url: '' };
        const verdict = classify(request.url, { appOrigins: policyConfig.appOrigins, fixtureRoutes: policyConfig.fixtureRoutes, baseUrl: policyConfig.baseUrl, method: request.method });
        if (!verdict.allowed || verdict.kind !== 'app_resource') {
          recordViolation('xhr', request.url, request.method, verdict.reason ? verdict : { reason: 'non_app_resource', url: request.url, method: request.method });
          const xhr = this;
          setTimeout(function () {
            try {
              const event = new Event('error');
              xhr.dispatchEvent(event);
              if (typeof xhr.onerror === 'function') xhr.onerror(event);
              xhr.dispatchEvent(new Event('loadend'));
            } catch (ignored) {}
          }, 0);
          return undefined;
        }
        return nativeSend.apply(this, arguments);
      };
    }

    const NativeWebSocket = window.WebSocket;
    if (NativeWebSocket) {
      function GuardedWebSocket(url, protocols) {
        const verdict = classify(url, { appOrigins: policyConfig.appOrigins, fixtureRoutes: policyConfig.fixtureRoutes, baseUrl: policyConfig.baseUrl, method: 'GET' });
        if (!verdict.allowed || verdict.kind !== 'websocket') {
          recordViolation('websocket', url, 'GET', verdict);
          throw new Error(describeBlocked(verdict));
        }
        return protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
      }
      GuardedWebSocket.prototype = NativeWebSocket.prototype;
      GuardedWebSocket.CONNECTING = NativeWebSocket.CONNECTING;
      GuardedWebSocket.OPEN = NativeWebSocket.OPEN;
      GuardedWebSocket.CLOSING = NativeWebSocket.CLOSING;
      GuardedWebSocket.CLOSED = NativeWebSocket.CLOSED;
      window.WebSocket = GuardedWebSocket;
    }

    const NativeEventSource = window.EventSource;
    if (NativeEventSource) {
      function GuardedEventSource(url, options) {
        const verdict = classify(url, { appOrigins: policyConfig.appOrigins, fixtureRoutes: policyConfig.fixtureRoutes, baseUrl: policyConfig.baseUrl, method: 'GET' });
        if (!verdict.allowed || verdict.kind !== 'app_resource') {
          recordViolation('eventsource', url, 'GET', verdict);
          throw new Error(describeBlocked(verdict));
        }
        return new NativeEventSource(url, options);
      }
      GuardedEventSource.prototype = NativeEventSource.prototype;
      window.EventSource = GuardedEventSource;
    }

    if (window.navigator && typeof window.navigator.sendBeacon === 'function') {
      const nativeBeacon = window.navigator.sendBeacon.bind(window.navigator);
      window.navigator.sendBeacon = function (url, data) {
        const verdict = classify(url, { appOrigins: policyConfig.appOrigins, fixtureRoutes: policyConfig.fixtureRoutes, baseUrl: policyConfig.baseUrl, method: 'POST' });
        if (!verdict.allowed) {
          recordViolation('beacon', url, 'POST', verdict);
          return false;
        }
        return nativeBeacon(url, data);
      };
    }

    window.__FIXTURE_ACTIVE__ = fixture;
  } catch (error) {
    window.__FIXTURE_BOOT_ERROR__ = String((error && error.stack) || error);
  }
})();`;
}

module.exports = { fixtureBootstrap };
