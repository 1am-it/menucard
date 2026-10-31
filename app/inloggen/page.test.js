'use strict';

// BE-59 (#146, punt 4) — bronregressie op de pagina /inloggen: één ingang met
// twee keuzes en de claimlink, zonder eigen inloglogica of sessiecheck.

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

test('de pagina toont de keuzes uit src/lib/loginEntry.js en niets zelf verzonnen', () => {
  const source = read(PAGE);
  assert.match(source, /import \{ CLAIM_LINK, LOGIN_CHOICES, LOGIN_INTRO \} from '@\/src\/lib\/loginEntry'/);
  assert.match(source, /\{LOGIN_CHOICES\.map\(\(choice\) => \(/);
  assert.match(source, /href=\{choice\.href\}/);
  assert.match(source, /href=\{CLAIM_LINK\.href\}/);
  assert.doesNotMatch(source, /\/mijn-restaurant\/inloggen|\/internal\/login/, 'geen tweede, losse paden');
});

test('/inloggen bevat geen inloglogica, geen sessiecheck en geen Supabase', () => {
  const source = read(PAGE);
  assert.doesNotMatch(source, /supabase|signInWith|verifyOtp|totp|mfa/i);
  assert.doesNotMatch(source, /localStorage|document\.cookie/);
  assert.doesNotMatch(source, /useEffect|useState/, 'er valt niets af te handelen op deze pagina');
});

test('de pagina heeft dezelfde kop als de publieke pagina\'s, met het accountmenu', () => {
  const source = read(PAGE);
  assert.match(source, /import AccountMenuButton from '@\/src\/components\/AccountMenuButton'/);
  assert.match(source, /<AccountMenuButton \/>/);
  assert.match(source, /<h1 className="inloggen-title">Inloggen<\/h1>/);
});

test('de opmaak gebruikt alleen tokens en geen harde kleuren', () => {
  const css = read(CSS);
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(rules, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(rules, /\b(rgb|rgba|hsl|hsla)\(/);
  assert.match(rules, /min-height: 72px/, 'grote tikvlakken');
  assert.match(rules, /max-width: 359px/, 'op 320 px gaan de kaarten netjes onder elkaar');
});
