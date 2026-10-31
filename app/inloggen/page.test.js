'use strict';

// BE-59 (#146, punt 4) / BE-63 (#155, ronde 4) — bronregressie op de pagina
// /inloggen volgens het goedgekeurde ontwerp: één bron van tekst
// (src/lib/loginEntry.js), het e-mailformulier direct op de pagina, het
// claimblok met drie stappen, de bezoekerszin en de teamlink. Geen eigen
// inloglogica op deze pagina: die staat in src/components/OwnerLoginCodeForm.js
// (zie ownerLoginSurface.test.js).

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

const PAGE = 'app/inloggen/page.js';
const CSS = 'app/inloggen/inloggen.css';

test('/inloggen is een Server Component met een eigen stylesheet', () => {
  const source = read(PAGE);
  assert.doesNotMatch(source, /^'use client'/m, 'geen clientcomponent nodig');
  assert.match(source, /^import '\.\/inloggen\.css'$/m);
  assert.ok(fs.existsSync(path.join(ROOT, CSS)));
});

test('de pagina toont de tekst uit src/lib/loginEntry.js en niets zelf verzonnen', () => {
  const source = read(PAGE);
  assert.match(source, /import \{ LOGIN_PAGE \} from '@\/src\/lib\/loginEntry'/);
  for (const field of [
    'LOGIN_PAGE.eyebrow',
    'LOGIN_PAGE.title',
    'LOGIN_PAGE.intro',
    'LOGIN_PAGE.submitLabel',
    'LOGIN_PAGE.emailHelp',
    'LOGIN_PAGE.claim.title',
    'LOGIN_PAGE.claim.actionHref',
    'LOGIN_PAGE.visitor',
    'LOGIN_PAGE.teamLabel',
    'LOGIN_PAGE.teamHref',
  ]) {
    assert.ok(source.includes(`{${field}}`), `${field} komt uit de gedeelde bron`);
  }
});

test('het e-mailformulier staat direct op de pagina, uit de gedeelde houder-inlog', () => {
  const source = read(PAGE);
  assert.match(source, /import OwnerLoginCodeForm from '@\/src\/components\/OwnerLoginCodeForm'/);
  assert.match(source, /<OwnerLoginCodeForm\b/);
  assert.match(source, /submitLabel=\{LOGIN_PAGE\.submitLabel\}/);
  assert.match(source, /showSignInHeading=\{false\}/, 'de h1 staat al op de pagina');
  assert.match(source, /headingLevel=\{2\}/, 'één h1 per pagina');
  assert.match(source, /emailHelp=\{LOGIN_PAGE\.emailHelp\}/);
  assert.match(source, /<h1 className="inloggen-title" id="inloggen-title">/);
});

test('het claimblok staat ernaast, met drie genummerde stappen en de omlijnde knop', () => {
  const source = read(PAGE);
  assert.match(source, /<aside className="inloggen-claim" aria-labelledby="inloggen-claim-title">/);
  assert.match(source, /<h2 className="inloggen-claim-title" id="inloggen-claim-title">/);
  assert.match(source, /\{LOGIN_PAGE\.claim\.steps\.map\(\(step, index\) => \(/);
  assert.match(source, /<ol className="inloggen-steps">/);
  assert.match(source, /className="inloggen-claim-action" href=\{LOGIN_PAGE\.claim\.actionHref\}/);
});

test('de bezoekerszin en de kleine teamlink staan onderaan', () => {
  const source = read(PAGE);
  assert.match(source, /className="inloggen-visitor">\{LOGIN_PAGE\.visitor\}/);
  assert.match(source, /className="inloggen-team-link" href=\{LOGIN_PAGE\.teamHref\}/);
  assert.match(source, /\{LOGIN_PAGE\.teamLabel\}/);
  // De teamlink is niet de grote knop: die hoort bij het claimblok.
  assert.doesNotMatch(source, /inloggen-team-link[^>]*href="\/internal\/login"/, 'geen tweede, los pad');
});

test('/inloggen bevat geen eigen inloglogica, geen sessiecheck en geen Supabase', () => {
  const source = read(PAGE);
  assert.doesNotMatch(source, /supabase|signInWith|verifyOtp|totp|mfa/i);
  assert.doesNotMatch(source, /localStorage|document\.cookie/);
  assert.doesNotMatch(source, /useEffect|useState/, 'de pagina zelf handelt niets af');
  assert.doesNotMatch(source, /requestOwnerSignInCode|verifyOwnerSignInCode/, 'de flow staat in de gedeelde component');
});

test('de pagina heeft dezelfde kop als de publieke pagina\'s, met het accountmenu', () => {
  const source = read(PAGE);
  // BE-63 (#155): het accountmenu zit nu in de ene gedeelde kopcomponent.
  assert.match(source, /import PublicHeaderActions from '@\/src\/components\/PublicHeaderActions'/);
  assert.match(source, /<PublicHeaderActions \/>/);
});

test('de kop heeft het navigatielandmark van de publieke pagina\'s', () => {
  // BE-59 deel 3: zonder <nav> faalde de a11y-check van de publieke pagina's
  // (ops/browser/lib/a11y-audit.js) op een ontbrekend nav-landmark.
  const source = read(PAGE);
  assert.match(source, /<nav className="inloggen-nav" aria-label="Naar de site">\s*<Wordmark \/>\s*<\/nav>/);
  const css = read(CSS);
  assert.match(css, /\.inloggen-nav \{[^}]*display: flex/);
});

test('de opmaak gebruikt alleen tokens en geen harde kleuren', () => {
  const css = read(CSS);
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(rules, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(rules, /\b(rgb|rgba|hsl|hsla)\(/);
  assert.match(rules, /\.inloggen-form \.auth-input \{[^}]*min-height: 52px/, '52 px hoge velden');
  assert.match(rules, /\.inloggen-form \.auth-submit \{[^}]*background: var\(--button-primary-bg\)/, 'de knop uit het ontwerp');
  assert.match(rules, /\.inloggen-claim \{[^}]*background: var\(--bg-elevated\)/, 'het claimblok staat op --bg-elevated');
  assert.match(rules, /min-height: 44px/, 'grote tikvlakken');
});
