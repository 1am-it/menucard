'use strict';

// BE-48 (#112) — the in-page part of the fake Supabase.
//
// This file holds one self-contained browser function. It is injected into the
// page through Function.prototype.toString() (the same trick
// lib/fixture-page.js uses), and it can be called directly from a unit test with
// Node's own Response, btoa and URL. The real app code — the real Supabase
// client, the real login page, the real mfa.enroll/challenge/verify calls — runs
// unchanged; only the HTTP layer is fictional.
//
// Everything the stub does is fail-closed: only the fake auth origin and the two
// app read routes are answered, and anything else is recorded as a violation and
// refused, so the check can never reach a real Supabase project or the internet.
//
// The fake access tokens are real JWT-shaped strings with an `aal` claim, because
// the SDK decodes that claim itself (getAuthenticatorAssuranceLevel). That is
// what makes "aal1 → code → aal2" provable without a real project.
//
// No import, no template literal and no Node API may be added to the function
// below: it is serialised and must run in a browser.

function installBe48AuthStub(settings) {
  const calls = [];
  const violations = [];
  let assurance = 'aal1';
  let challengeCount = 0;

  function base64url(value) {
    return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function token(payload) {
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = base64url(JSON.stringify(payload));
    // The SDK validates every JWT part against base64url, including its length,
    // so the fake signature must be a valid base64url-sized string too.
    return header + '.' + body + '.fixture-sig';
  }

  function jsonResponse(body, status) {
    return new Response(JSON.stringify(body), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // The SDK sends JSON for sign-in and factor calls and may send a form body for
  // `verify`; both are accepted here.
  function parseBody(body) {
    if (!body) return {};
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (error) {
      // not JSON: fall through to the form encoding
    }
    const result = {};
    const params = new URLSearchParams(body);
    params.forEach(function (value, key) {
      result[key] = value;
    });
    return result;
  }

  function user() {
    return {
      id: 'fixture-user',
      aud: 'authenticated',
      role: 'authenticated',
      email: settings.email,
      factors: settings.factors,
    };
  }

  function session() {
    return {
      access_token: token({ sub: 'fixture-user', role: 'authenticated', aal: assurance }),
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'fixture-refresh',
      user: user(),
    };
  }

  function needsSecondStep() {
    return settings.roles.some(function (row) {
      return row.role === 'internal' || row.role === 'editor';
    });
  }

  function appResponse(url, method) {
    const authorized = assurance === 'aal2' || !needsSecondStep();
    const known =
      url.pathname === '/api/internal/v1/me' ||
      url.pathname === '/api/internal/v1/workqueue-counts' ||
      url.pathname === '/api/internal/v1/menu-concepts';
    if (method === 'GET' && authorized && url.pathname === '/api/internal/v1/me') {
      return jsonResponse({ roles: settings.roles });
    }
    if (method === 'GET' && authorized && url.pathname === '/api/internal/v1/workqueue-counts') {
      return jsonResponse({ counts: settings.counts });
    }
    // The landing page after a successful second step reads this list; an empty
    // fictional list keeps that screen quiet, so the check measures navigation
    // instead of a data error.
    if (method === 'GET' && authorized && url.pathname === '/api/internal/v1/menu-concepts') {
      return jsonResponse({ items: [] });
    }
    if (method === 'GET' && known) {
      return jsonResponse({ error: 'Tweede inlogstap vereist', reason: 'aal2_required' }, 403);
    }
    violations.push({ kind: 'unknown_api_route', method: method, url: url.href });
    return jsonResponse({ error: 'fixture_unknown_api_route' }, 500);
  }

  function authResponse(url, method, body) {
    const path = url.pathname;
    if (path === '/auth/v1/token' && method === 'POST') {
      const parsed = body ? JSON.parse(body) : {};
      const granted =
        url.searchParams.get('grant_type') === 'password' &&
        parsed.email === settings.email &&
        parsed.password === settings.password;
      if (!granted) {
        // GoTrue's real error shape: `error_code` plus a human `msg`. The SDK
        // turns `error_code` into `error.code`, which is what the app's Dutch
        // translation keys on.
        return jsonResponse({ error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400);
      }
      assurance = 'aal1';
      return jsonResponse(session());
    }
    if (path === '/auth/v1/user' && method === 'GET') return jsonResponse(user());
    if (path === '/auth/v1/factors' && method === 'POST') {
      const parsed = body ? JSON.parse(body) : {};
      return jsonResponse({
        id: settings.factorId,
        type: parsed.factor_type === 'totp' ? 'totp' : parsed.factor_type,
        status: 'unverified',
        totp: {
          // A data URL may not contain a `#` (it starts a fragment), so the
          // fixture SVG uses named colours; real Supabase sends base64 SVG here.
          qr_code:
            '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180">' +
            '<rect width="180" height="180" fill="white"/>' +
            '<rect x="12" y="12" width="52" height="52" fill="black"/>' +
            '<rect x="116" y="12" width="52" height="52" fill="black"/>' +
            '<rect x="12" y="116" width="52" height="52" fill="black"/>' +
            '<rect x="72" y="72" width="36" height="36" fill="black"/>' +
            '</svg>',
          secret: 'JBSWY3DPEHPK3PXP',
        },
      });
    }
    if (path.indexOf('/auth/v1/factors/') === 0 && method === 'POST') {
      const rest = path.slice('/auth/v1/factors/'.length);
      if (rest.slice(-'/challenge'.length) === '/challenge') {
        challengeCount += 1;
        return jsonResponse({ id: 'challenge-' + challengeCount });
      }
      if (rest.slice(-'/verify'.length) === '/verify') {
        const parsed = body ? JSON.parse(body) : {};
        if (parsed.code !== settings.totpCode) {
          return jsonResponse({ error_code: 'mfa_verification_failed', msg: 'Invalid TOTP code entered' }, 422);
        }
        assurance = 'aal2';
        return jsonResponse(session());
      }
    }
    if (path === '/auth/v1/recover' && method === 'POST') return jsonResponse({});
    if (path === '/auth/v1/verify' && method === 'POST') {
      const params = parseBody(body);
      if (params.type !== 'recovery' || params.token !== settings.totpCode) {
        return jsonResponse({ error_code: 'otp_expired', msg: 'Token has expired or is invalid' }, 403);
      }
      assurance = 'aal1';
      return jsonResponse(session());
    }
    if (path === '/auth/v1/logout' && method === 'POST') return new Response(null, { status: 204 });
    violations.push({ kind: 'unknown_auth_route', method: method, url: url.href });
    return jsonResponse({ error: 'fixture_unknown_auth_route' }, 404);
  }

  window.fetch = async function (input, init) {
    const href = typeof input === 'string' ? input : (input && input.url) || String(input);
    const url = new URL(href, window.location.href);
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    const body = init && typeof init.body === 'string' ? init.body : null;
    calls.push({ method: method, path: url.pathname, url: url.href });
    if (url.origin === settings.authOrigin) return authResponse(url, method, body);
    if (url.origin === window.location.origin) return appResponse(url, method);
    violations.push({ kind: 'external_origin', method: method, url: url.href });
    throw new TypeError('fixture_network_blocked: ' + url.href);
  };

  try {
    window.localStorage.setItem('bredaeats_theme', settings.theme);
  } catch (error) {
    // A blocked storage context is harmless for this check.
  }

  window.__BE48__ = {
    settings: settings,
    calls: calls,
    violations: violations,
    assurance: function () {
      return assurance;
    },
  };
  return window.__BE48__;
}

module.exports = { installBe48AuthStub };
