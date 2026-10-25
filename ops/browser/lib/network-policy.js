'use strict';

// Fail-closed network policy for the isolated #59 browser fixture.
//
// The fixture used to fall back to the browser's native fetch for every URL it
// did not recognise. That made the "fictional only" claim unenforceable: a
// cross-origin request, a protocol-relative URL or an unknown same-origin API
// write could reach the real network. This module is the single source of truth
// for both layers:
//
//   1. the in-page guard (fetch, XHR, WebSocket, EventSource, sendBeacon);
//   2. the CDP `Fetch` interception used by the harness, which also covers
//      subresources and frame/document navigation.
//
// Only explicit local app resources and the explicit fictional fixture API
// routes are allowed. Everything else is refused and recorded as a concrete
// violation. The classifier is self-contained because it is also injected into
// the page through `Function.prototype.toString()`.

const FIXTURE_API_ROUTES = [
  { id: 'batch-analysis-process', match: 'exact', path: '/api/internal/v1/batch-analysis/process', methods: ['POST'] },
  { id: 'batch-analysis', match: 'prefix', path: '/api/internal/v1/batch-analysis', methods: ['GET'] },
  // The image/scan follow-up opens the existing Bronnen beoordelen page. Only
  // its read is fictionalised; every proposal write stays unknown/refused.
  { id: 'source-triage', match: 'exact', path: '/api/internal/v1/source-triage', methods: ['GET'] },
  // GET only, and the detail form allows exactly one path segment. The real
  // concept pages need these two reads; every save/decision/export POST stays
  // unknown and is refused before it can reach a handler.
  { id: 'menu-concepts-list', match: 'exact', path: '/api/internal/v1/menu-concepts', methods: ['GET'] },
  { id: 'menu-concepts-detail', match: 'detail', path: '/api/internal/v1/menu-concepts/', methods: ['GET'] },
  // #59 fase 2: the manual AI import. Only these exact fictional paths are
  // answered; the fixed fixture import id keeps every unknown import path
  // refused. The app itself never calls a provider, so no AI traffic exists.
  { id: 'manual-bundles', match: 'exact', path: '/api/internal/v1/manual-menu-import/bundles', methods: ['POST'] },
  { id: 'manual-restaurants', match: 'exact', path: '/api/internal/v1/manual-menu-import/restaurants', methods: ['GET'] },
  { id: 'manual-imports', match: 'exact', path: '/api/internal/v1/manual-menu-import/imports', methods: ['POST'] },
  { id: 'manual-decisions', match: 'exact', path: '/api/internal/v1/manual-menu-import/imports/fixture-import/decisions', methods: ['POST'] },
  { id: 'manual-follow-up', match: 'exact', path: '/api/internal/v1/manual-menu-import/imports/fixture-import/follow-up', methods: ['POST'] },
  { id: 'manual-save', match: 'exact', path: '/api/internal/v1/manual-menu-import/imports/fixture-import/save', methods: ['POST'] },
  // #59 variant 5 (Lead order 6382953597): one printed page of one source with
  // its markings, read-only from the fixture's sealed state.
  { id: 'manual-source-map', match: 'exact', path: '/api/internal/v1/manual-menu-import/imports/fixture-import/source-map', methods: ['POST'] },
  // #59 / BE-21 "Lees met AI" (Lead review 6380804419). GET decides whether the
  // block may offer the button and what this month cost; POST is the one
  // reading. Both are fictional; no provider is contacted.
  { id: 'menu-ai-status', match: 'exact', path: '/api/internal/v1/menu-ai-import', methods: ['GET'] },
  { id: 'menu-ai-read', match: 'exact', path: '/api/internal/v1/menu-ai-import', methods: ['POST'] },
  // #62: the real counts of the navigation shell. ?countsState=partial answers
  // with one unavailable number and ?countsState=error refuses the whole call,
  // so the check can prove that no number (and certainly not 0) is invented.
  { id: 'workqueue-counts', match: 'exact', path: '/api/internal/v1/workqueue-counts', methods: ['GET'] },
  { id: 'me', match: 'exact', path: '/api/internal/v1/me', methods: ['GET'] },
  { id: 'auth', match: 'prefix', path: '/auth/v1/', methods: ['GET', 'POST'] },
];

function defaultAppOrigins(port) {
  const value = Number(port || 3137);
  return [`http://localhost:${value}`, `http://127.0.0.1:${value}`];
}

// This function is serialized into the page. Keep it free of module-level
// references and of Node-only APIs.
function classifyRequest(input, options) {
  const raw = typeof input === 'string' ? input : (input && input.url) || '';
  const method = String((options && options.method) || 'GET').toUpperCase();
  const appOrigins = (options && options.appOrigins) || [];
  const fixtureRoutes = (options && options.fixtureRoutes) || [];
  const baseUrl = (options && options.baseUrl) || 'http://localhost/';
  const trimmed = String(raw).trim();
  const result = {
    allowed: false,
    kind: 'blocked',
    reason: null,
    routeId: null,
    url: trimmed || null,
    origin: null,
    path: null,
    method,
    protocolRelative: trimmed.indexOf('//') === 0,
  };

  if (!trimmed || trimmed === 'about:blank') {
    result.allowed = true;
    result.kind = 'inline';
    result.url = trimmed || 'about:blank';
    return result;
  }

  let url;
  try {
    url = new URL(trimmed, baseUrl);
  } catch {
    result.reason = 'invalid_url';
    return result;
  }
  result.url = url.href;
  result.origin = url.origin;
  result.path = url.pathname;

  if (url.protocol === 'data:' || url.protocol === 'blob:') {
    result.allowed = true;
    result.kind = 'inline';
    return result;
  }

  function isFixtureApiPath(pathname) {
    return pathname === '/api' || pathname.indexOf('/api/') === 0 || pathname.indexOf('/auth/') === 0;
  }

  function matchingRoute(pathname, method) {
    // Exact routes win over prefix routes so the explicit process write is not
    // swallowed by its GET-only parent route. A `detail` route accepts exactly
    // one segment below its path (e.g. `/menu-concepts/<id>`), so a nested
    // `/versions` or `/decision` GET is not silently promoted to a read.
    // Two routes may share one path with different methods (the AI reading is
    // POST where its status is GET), so the method decides which one matches.
    const ordered = fixtureRoutes.slice().sort((a, b) => (a.match === 'exact' ? 0 : 1) - (b.match === 'exact' ? 0 : 1));
    let samePathWithoutMethod = null;
    for (const route of ordered) {
      const exact = pathname === route.path;
      const rest = pathname.indexOf(route.path) === 0 ? pathname.slice(route.path.length) : null;
      const detail = rest !== null && rest.length > 0 && rest.indexOf('/') === -1;
      const prefix = route.path.charAt(route.path.length - 1) === '/'
        ? pathname.indexOf(route.path) === 0
        : (pathname === route.path || pathname.indexOf(route.path + '/') === 0);
      const matches = (route.match === 'exact' && exact) || (route.match === 'detail' && detail) || (route.match === 'prefix' && prefix);
      if (!matches) continue;
      if (!route.methods || route.methods.indexOf(method) !== -1) return route;
      if (!samePathWithoutMethod) samePathWithoutMethod = route;
    }
    return samePathWithoutMethod;
  }

  if (url.protocol === 'ws:' || url.protocol === 'wss:') {
    const sameHost = appOrigins.some((origin) => {
      try {
        const app = new URL(origin);
        return app.host === url.host;
      } catch {
        return false;
      }
    });
    if (!sameHost) {
      result.reason = 'external_origin';
      return result;
    }
    if (isFixtureApiPath(url.pathname)) {
      result.reason = 'unknown_api_route';
      return result;
    }
    result.allowed = true;
    result.kind = 'websocket';
    return result;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    result.reason = 'unsupported_protocol';
    return result;
  }

  const sameOrigin = appOrigins.some((origin) => {
    try {
      return new URL(origin).origin === url.origin;
    } catch {
      return false;
    }
  });
  if (!sameOrigin) {
    result.reason = 'external_origin';
    return result;
  }

  if (isFixtureApiPath(url.pathname)) {
    const route = matchingRoute(url.pathname, method);
    if (!route) {
      result.reason = 'unknown_api_route';
      return result;
    }
    if (route.methods.indexOf(method) === -1) {
      result.reason = 'method_not_allowed';
      return result;
    }
    result.allowed = true;
    result.kind = 'fixture_api';
    result.routeId = route.id;
    return result;
  }

  if (method !== 'GET' && method !== 'HEAD') {
    result.reason = 'method_not_allowed';
    return result;
  }
  result.allowed = true;
  result.kind = 'app_resource';
  return result;
}

function describeBlocked(verdict) {
  return `fixture_network_blocked: ${verdict.reason || 'not_allowed'} (${verdict.method} ${verdict.url || 'unknown'})`;
}

function createNetworkGuard({ appOrigins, fixtureRoutes, baseUrl } = {}) {
  const violations = [];
  let phase = 'app';
  const config = {
    appOrigins: appOrigins || defaultAppOrigins(),
    fixtureRoutes: fixtureRoutes || FIXTURE_API_ROUTES,
    baseUrl: baseUrl || 'http://localhost/',
  };
  return {
    config,
    violations,
    classify(input, method) {
      return classifyRequest(input, { ...config, method: method || 'GET' });
    },
    setPhase(next) {
      phase = String(next || 'app');
    },
    getPhase() {
      return phase;
    },
    record(kind, input, method, verdict, extra = {}) {
      const entry = {
        phase,
        kind,
        method: String(method || 'GET').toUpperCase(),
        url: verdict && verdict.url ? verdict.url : String(input || ''),
        reason: (verdict && verdict.reason) || 'not_allowed',
        protocolRelative: Boolean(verdict && verdict.protocolRelative),
        at: new Date().toISOString(),
        ...extra,
      };
      if (violations.length < 100) violations.push(entry);
      return entry;
    },
    appViolations() {
      return violations.filter((entry) => entry.phase === 'app');
    },
    negativeViolations() {
      return violations.filter((entry) => entry.phase === 'negative-probe');
    },
  };
}

// CDP layer: intercept every HTTP(S) request before it leaves the browser.
// This covers subresources, XHR that bypassed the page guard and frame/document
// navigation. Disallowed requests are failed with `BlockedByClient` and recorded
// with a concrete reason.
async function enableFetchGuard(cdp, guard) {
  cdp.on('Fetch.requestPaused', (params) => {
    const request = params.request || {};
    const verdict = guard.classify(request.url, request.method);
    if (verdict.allowed) {
      cdp.send('Fetch.continueRequest', { requestId: params.requestId }).catch(() => {
        // The request may already have been cancelled by the page.
      });
      return;
    }
    guard.record('cdp_fetch', request.url, request.method, verdict, { resourceType: params.resourceType || null });
    cdp.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' }).catch(() => {
      // The request may already have been cancelled by the page.
    });
  });
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: '*', requestStage: 'Request' }],
  });
}

module.exports = {
  FIXTURE_API_ROUTES,
  defaultAppOrigins,
  classifyRequest,
  describeBlocked,
  createNetworkGuard,
  enableFetchGuard,
};
