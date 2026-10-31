'use strict';

// BE-63 (#155, ronde 4) — de houder-inlog heeft één bron van logica.
//
// De opdracht eist dat /inloggen en /mijn-restaurant/inloggen dezelfde aanroep,
// dezelfde codestap en dezelfde foutmeldingen gebruiken, en dat er geen tweede
// kopie van de inloglogica ontstaat. Deze surface-test bewaakt dat in de bron:
// de Supabase-aanroepen, de rolopzoeking en de neutrale meldingen staan alleen
// in src/components/OwnerLoginCodeForm.js; de twee pagina's verwijzen ernaar.
// Geen browser en geen netwerk: dit is ontwikkelaarsbewijs, geen acceptatie.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const code = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');

const FORM = 'src/components/OwnerLoginCodeForm.js';
const OWNER_VIEW = 'app/mijn-restaurant/inloggen/OwnerLoginView.js';
const LOGIN_PAGE = 'app/inloggen/page.js';

test('de houder-inlog heeft één bron: de gedeelde component', () => {
  const form = code(read(FORM));
  assert.match(form, /from '@\/src\/lib\/claimEmailCodeFlow'/);
  assert.match(form, /requestOwnerSignInCode\(supabase\.auth, \{/);
  assert.match(form, /verifyOwnerSignInCode\(supabase\.auth, \{/);
  assert.match(form, /resolveOwnerEntry\(/);
  assert.match(form, /getSupabaseBrowser\(\)/);
  assert.match(form, /setNotice\(result\.notice\)/);

  for (const file of [OWNER_VIEW, LOGIN_PAGE]) {
    const surface = code(read(file));
    assert.match(surface, /from '@\/src\/components\/OwnerLoginCodeForm'/, `${file} gebruikt de gedeelde component`);
    assert.doesNotMatch(surface, /requestOwnerSignInCode|verifyOwnerSignInCode/, `${file} heeft geen eigen kopie`);
    assert.doesNotMatch(surface, /signInWithOtp|verifyOtp|supabase/i, `${file} praat niet zelf met Supabase`);
  }
});

test('beide pagina\'s tonen dezelfde stappen en dezelfde foutmeldingen', () => {
  const form = read(FORM);
  assert.match(form, /role="alert"/);
  assert.match(form, /role="status"/);
  assert.match(form, /Nieuwe code sturen/);
  assert.match(form, /'Ander e-mailadres'/);
  assert.match(form, /OWNER_ACCESS_MESSAGES\.signInTitle/);
  assert.match(form, /OWNER_ACCESS_MESSAGES\.codeTitle/);
  // /mijn-restaurant/inloggen blijft dezelfde flow (kleinste oplossing): geen
  // doorverwijzing en geen tweede formulier.
  const ownerView = code(read(OWNER_VIEW));
  assert.match(ownerView, /<OwnerLoginCodeForm \/>/);
  assert.doesNotMatch(ownerView, /redirect\(/, 'geen doorverwijzing naar /inloggen');
});

test('de inloglogica zelf is niet veranderd: de flowmodule blijft de bron', () => {
  const flow = read('src/lib/claimEmailCodeFlow.js');
  assert.match(flow, /async function requestOwnerSignInCode/);
  assert.match(flow, /async function verifyOwnerSignInCode/);
  assert.match(flow, /options: \{ shouldCreateUser: false \}/);
  // Het formulier roept de bestaande modules aan en vertaalt niets zelf.
  const form = code(read(FORM));
  assert.match(form, /from '@\/src\/lib\/authErrors'/);
  assert.match(form, /MESSAGES\.generic/);
  assert.doesNotMatch(form, /error\.message/);
});

test('de gedeelde component bewaart zelf geen sessie of token', () => {
  const form = code(read(FORM));
  assert.doesNotMatch(form, /localStorage|sessionStorage/);
  assert.doesNotMatch(form, /document\.cookie/);
});

test('de telefoonvariant blijft achter de bestaande vlag', () => {
  const form = read(FORM);
  assert.match(form, /isSmsLoginEnabled\(process\.env\.NEXT_PUBLIC_OWNER_SMS_LOGIN\)/);
  assert.match(form, /\{smsEnabled && \(/, 'zonder de vlag geen telefoonveld');
});
