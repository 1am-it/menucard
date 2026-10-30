'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { siteAccessDecision, isOpenPath, decodeBasicPassword } = require('./siteAccess');

const basic = (user, pass) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

test('zonder wachtwoord: alles open, maar standaard noindex', () => {
  assert.deepEqual(siteAccessDecision({ pathname: '/' }), { allow: true, noindex: true });
  assert.deepEqual(siteAccessDecision({ pathname: '/', password: '' }), { allow: true, noindex: true });
});

test('indexeren alleen bij NEXT_PUBLIC_SITE_INDEXABLE "true"', () => {
  assert.equal(siteAccessDecision({ pathname: '/', indexable: 'true' }).noindex, false);
  for (const value of [undefined, '', 'false', '1', 'yes']) {
    assert.equal(siteAccessDecision({ pathname: '/', indexable: value }).noindex, true, String(value));
  }
});

test('met wachtwoord: zonder of met fout wachtwoord geweigerd', () => {
  const password = 'geheim-123';
  assert.equal(siteAccessDecision({ pathname: '/', password }).allow, false);
  assert.equal(siteAccessDecision({ pathname: '/menu/6-diner', password, authorization: basic('x', 'fout') }).allow, false);
  assert.equal(siteAccessDecision({ pathname: '/api/v1/kies', password, authorization: 'Bearer geheim-123' }).allow, false);
  assert.equal(siteAccessDecision({ pathname: '/', password, authorization: 'Basic !!!' }).allow, false);
});

test('met wachtwoord: juist wachtwoord door, gebruikersnaam maakt niet uit', () => {
  const password = 'geheim:met:dubbelepunt';
  assert.equal(siteAccessDecision({ pathname: '/', password, authorization: basic('', password) }).allow, true);
  assert.equal(siteAccessDecision({ pathname: '/internal', password, authorization: basic('eigenaar', password) }).allow, true);
});

test('cron, healthcheck en Next.js-bestanden blijven buiten de poort', () => {
  for (const pathname of ['/api/cron/kies-opruimen', '/api/cron/osm-breda', '/api/health/db', '/_next/static/x.js', '/favicon.ico', '/robots.txt']) {
    assert.equal(isOpenPath(pathname), true, pathname);
    assert.equal(siteAccessDecision({ pathname, password: 'p' }).allow, true, pathname);
  }
  for (const pathname of ['/', '/api/v1/daghap', '/api/cronx', '/internal/login', '/mijn-restaurant']) {
    assert.equal(isOpenPath(pathname), false, pathname);
  }
});

test('Basic-header lezen', () => {
  assert.equal(decodeBasicPassword(basic('a', 'b')), 'b');
  assert.equal(decodeBasicPassword('Basic ' + Buffer.from('zonderdubbelepunt').toString('base64')), null);
  assert.equal(decodeBasicPassword(undefined), null);
});

test('vercel.json: elke cronroute valt onder een open prefix', () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'vercel.json'), 'utf8'));
  for (const cron of vercel.crons || []) {
    assert.equal(isOpenPath(cron.path), true, cron.path);
  }
});

test('middleware.js gebruikt deze regels en de twee omgevingsvariabelen', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'middleware.js'), 'utf8');
  assert.match(source, /siteAccessDecision/);
  assert.match(source, /SITE_ACCESS_PASSWORD/);
  assert.match(source, /NEXT_PUBLIC_SITE_INDEXABLE/);
  assert.match(source, /X-Robots-Tag/);
});
