'use strict';

// The in-page fixture: a fictional Supabase session (so the real client-side
// auth path runs) and fictional same-origin API responses. It never contacts a
// real Supabase project or production API. The query parameters choose the
// fixture and the app's own light/dark theme before first paint.

function fixtureBootstrap(scenarios) {
  return `(() => {
  try {
    const fixtures = ${JSON.stringify(scenarios)};
    const params = new URLSearchParams(location.search);
    const fixture = params.get('fixture') || 'review';
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
    const nativeFetch = window.fetch ? window.fetch.bind(window) : null;
    window.fetch = async function (input, init) {
      const raw = typeof input === 'string' ? input : (input && input.url) || '';
      const url = new URL(raw, location.href);
      if (url.pathname.includes('/auth/v1/')) {
        return new Response(JSON.stringify(session), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.pathname.includes('/api/internal/v1/me')) {
        return new Response(JSON.stringify({ roles: [{ role: 'internal', restaurant_id: null }, { role: 'editor', restaurant_id: null }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.pathname.includes('/api/internal/v1/batch-analysis')) {
        if (fixture === 'error') {
          return new Response(JSON.stringify({ error: 'De batchanalyse kon niet worden geladen.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.pathname.endsWith('/process')) {
          return new Response(JSON.stringify({ outcome: 'done' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        const body = fixtures[fixture] || fixtures.review;
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (nativeFetch) return nativeFetch(input, init);
      throw new Error('network disabled in fixture');
    };
    window.__FIXTURE_ACTIVE__ = fixture;
  } catch (error) {
    window.__FIXTURE_BOOT_ERROR__ = String((error && error.stack) || error);
  }
})();`;
}

module.exports = { fixtureBootstrap };
