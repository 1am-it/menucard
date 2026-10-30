'use strict';

// BE-48 (#112) — de claimpagina als scherm: structurele regressie zonder browser.
//
// De codeflow zelf is getest in claimEmailCodeFlow.test.js en de echte schermen
// draaien in ops/browser/run-be48-browser-check.js. Deze test bewaakt wat je in
// de bron al kunt zien en wat anders stil kan terugvallen: echte labels in plaats
// van een placeholder, de juiste autocomplete/inputmode, fouten in role="alert",
// Nederlandse tekst, geen Supabase-`error.message` en geen rechtstreekse
// Supabase-aanroepen buiten de geteste module. Geen browser, geen netwerk.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CLAIM_VIEW = path.join(REPO_ROOT, 'app/claim/[restaurantId]/ClaimView.js');
const FLOW = path.join(REPO_ROOT, 'src/lib/claimEmailCodeFlow.js');
const CSS = path.join(REPO_ROOT, 'app/globals.css');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

// De kop van ClaimView legt in commentaar uit wat het scherm níet meer doet
// (`error.message`, `signInWithOtp`). De negatieve controles kijken daarom naar
// de code zonder commentaar, zodat uitleg geen valse melding geeft.
function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

test('claim: elk veld heeft een echt label en nooit alleen een placeholder', () => {
  const view = read(CLAIM_VIEW);
  assert.match(view, /htmlFor="claim-email"[\s\S]{0,120}E-mailadres/);
  assert.match(view, /htmlFor="claim-code"[\s\S]{0,120}Code uit de e-mail/);
  assert.doesNotMatch(view, /\splaceholder=/);
});

test('claim: de velden zeggen wat een wachtwoordmanager en telefoon nodig hebben', () => {
  const view = read(CLAIM_VIEW);
  assert.match(view, /id="claim-email"[\s\S]{0,400}autoComplete="email"/);
  assert.match(view, /id="claim-code"[\s\S]{0,400}autoComplete="one-time-code"/);
  assert.match(view, /id="claim-code"[\s\S]{0,400}inputMode="numeric"/);
  assert.match(view, /pattern="\[0-9\]\*"/);
});

test('claim: fouten staan in role="alert" met de gedeelde foutstijl', () => {
  const view = read(CLAIM_VIEW);
  const code = withoutComments(view);
  assert.match(view, /className="auth-error" id="claim-error" role="alert"/);
  // Geen enkele plek die nog een eigen claim-foutstijl of Engelse API-tekst toont.
  assert.doesNotMatch(code, /claim-error"\)/);
  assert.doesNotMatch(code, /data\.error/);
  assert.doesNotMatch(code, /error\.message/);
  assert.doesNotMatch(code, /setError\(err\.message\)/);
});

test('claim: alle Supabase-aanroepen lopen via de geteste codeflow', () => {
  const view = read(CLAIM_VIEW);
  const code = withoutComments(view);
  assert.match(view, /from '@\/src\/lib\/claimEmailCodeFlow'/);
  assert.match(code, /requestEmailCode/);
  assert.match(code, /verifyEmailCode/);
  assert.doesNotMatch(code, /signInWithOtp/);
  assert.doesNotMatch(code, /verifyOtp/);
  assert.doesNotMatch(code, /resetPasswordForEmail/);
  // De link in de mail blijft werken: dat is een eigenschap van de flow.
  assert.match(read(FLOW), /emailRedirectTo/);
});

test('claim: de twee herstelknoppen en de gedeelde knopstijl staan er', () => {
  const view = read(CLAIM_VIEW);
  assert.match(view, /Nieuwe code sturen/);
  assert.match(view, /Ander e-mailadres/);
  assert.match(view, /className="auth-submit"/);
  assert.match(view, /className="auth-secondary"/);
  assert.match(view, /className="claim-step"/);
  assert.match(view, /className="auth-input auth-input--code"/);
});

test('claim: de stapelstijl gebruikt alleen tokens', () => {
  const css = read(CSS);
  const rule = css.match(/\/\* BE-48 \(issue 112\): de claim gebruikt[\s\S]*?\.claim-step \.auth-actions \{[^}]*\}/);
  assert.ok(rule, 'de claim-stapelstijl ontbreekt in app/globals.css');
  assert.doesNotMatch(rule[0], /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(rule[0], /rgb\(|hsl\(/);
});
