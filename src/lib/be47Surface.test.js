'use strict';

// BE-47 (#111) — de bedrading van "Mijn restaurant", als bronregressies.
//
// Zelfde conventie als public-pages-style.test.js en dishCounterReportSurface.test.js:
// fs + regex op de bronbestanden. De beslissingen zelf zijn al getest in
// ownerAccess.test.js, ownerRestaurantOverview.test.js en
// ownerAccountDeletion.test.js; hier gaat het om de vraag of de pagina's, de
// route en de stijlen ze ook echt zo gebruiken, en of de contractgrenzen
// (geen migratie, geen RLS-wijziging, geen eigen tokenopslag, telefoonveld
// alleen achter de vlag) overeind blijven.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const code = (source) => source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');

const LOGIN_PAGE = read('app/mijn-restaurant/inloggen/page.js');
const LOGIN_VIEW = read('app/mijn-restaurant/inloggen/OwnerLoginView.js');
const DASHBOARD_PAGE = read('app/mijn-restaurant/page.js');
const DASHBOARD = read('app/mijn-restaurant/OwnerDashboard.js');
const DELETION_VIEW = read('app/mijn-restaurant/OwnerAccountDeletion.js');
const DELETION_ROUTE = read('app/api/mijn-restaurant/account-verwijderen/route.js');
const INTERNAL_PAGE = read('app/internal/page.js');
const CSS = read('app/globals.css');

test('BE-47: /mijn-restaurant/inloggen gebruikt de gedeelde BE-48-flow', () => {
  assert.match(LOGIN_PAGE, /import OwnerLoginView from '\.\/OwnerLoginView'/);
  assert.match(LOGIN_VIEW, /from '@\/src\/lib\/claimEmailCodeFlow'/);
  assert.match(LOGIN_VIEW, /requestOwnerSignInCode\(/);
  assert.match(LOGIN_VIEW, /verifyOwnerSignInCode\(/);
  // Criterion 1: the owner branch never creates an account.
  const flow = read('src/lib/claimEmailCodeFlow.js');
  assert.match(flow, /async function requestOwnerSignInCode/);
  assert.match(flow, /options: \{ shouldCreateUser: false \}/);
  // The internal/editor account is sent to /internal/login, never to this screen.
  assert.match(LOGIN_VIEW, /resolveOwnerEntry\(/);
  assert.match(LOGIN_VIEW, /INTERNAL_LOGIN_HREF/);
});

test('BE-47: het codescherm heeft de twee vervolgknoppen en neutrale tekst', () => {
  assert.match(LOGIN_VIEW, /Nieuwe code sturen/);
  assert.match(LOGIN_VIEW, /'Ander e-mailadres'/);
  // The neutral notice comes straight from the flow module (never invented here).
  assert.match(LOGIN_VIEW, /setNotice\(result\.notice\)/);
  assert.match(LOGIN_VIEW, /\{noticeAlert\}/);
  // The neutral "if this address is known to us" notice lives in the flow module.
  const flow = read('src/lib/claimEmailCodeFlow.js');
  assert.match(flow, /codeSentEmail: 'Als dit e-mailadres bij ons bekend is/);
});

test('BE-47: het houder-scherm haalt rollen en claims uit de bestaande routes', () => {
  assert.match(DASHBOARD, /'\/api\/internal\/v1\/me'/);
  assert.match(DASHBOARD, /'\/api\/claims\/mine'/);
  assert.match(DASHBOARD, /buildOwnerOverview\(/);
  assert.match(DASHBOARD, /restaurantIndex/);
  // Criterion 2: without a session the visitor goes to the sign-in page.
  assert.match(DASHBOARD, /router\.replace\(OWNER_LOGIN_HREF\)/);
  // Sign out exists.
  assert.match(DASHBOARD, /OWNER_OVERVIEW_MESSAGES\.signOut/);
  // The server page only hands over the small static index, not the datasets.
  assert.match(DASHBOARD_PAGE, /import restaurantsData from '@\/data\/restaurants\.json'/);
  assert.match(DASHBOARD_PAGE, /buildOwnerRestaurantIndex\(restaurantsData, menusData\)/);
  assert.doesNotMatch(code(DASHBOARD_PAGE), /menusData\b.*props|restaurantsData\b.*props/);
});

test('BE-47: de verwijderroute is POST-only en gebruikt de geteste handler', () => {
  assert.match(DELETION_ROUTE, /export async function POST\(request\)/);
  assert.doesNotMatch(DELETION_ROUTE, /export (async )?function (GET|PUT|PATCH|DELETE)/);
  assert.match(DELETION_ROUTE, /createAccountDeletionHandler\(\{ getSupabase: getSupabaseAdmin \}\)/);
  assert.match(DELETION_ROUTE, /export const dynamic = 'force-dynamic'/);
  // The route itself carries no rule and no id from the request.
  assert.doesNotMatch(code(DELETION_ROUTE), /deleteUser\(|verifyOtp\(|body\.(userId|id|email)/);
  // The screen posts only the code and the session token.
  assert.match(DELETION_VIEW, /'\/api\/mijn-restaurant\/account-verwijderen'/);
  assert.match(DELETION_VIEW, /JSON\.stringify\(\{ code \}\)/);
  assert.match(DELETION_VIEW, /req|session\.access_token/);
  assert.doesNotMatch(code(DELETION_VIEW), /userId|deleteUser\(/);
});

test('BE-47: toegankelijkheid — labels, autocomplete, inputmode, role=alert', () => {
  for (const source of [LOGIN_VIEW, DELETION_VIEW]) {
    assert.match(source, /role="alert"/);
    assert.match(source, /autoComplete="one-time-code"/);
    assert.match(source, /inputMode="numeric"/);
    assert.match(source, /<label className="auth-label" htmlFor=/);
  }
  assert.match(LOGIN_VIEW, /autoComplete="email"/);
  // Every error paragraph is linked to its field through aria-describedby.
  assert.match(LOGIN_VIEW, /aria-describedby=\{error \? 'owner-login-error'/);
  assert.match(DELETION_VIEW, /aria-describedby=\{error \? 'owner-delete-error'/);
});

test('BE-47: zonder de vlag is er nergens een telefoonveld', () => {
  // The page renders the phone toggle and the phone input only inside `smsEnabled`.
  assert.match(LOGIN_VIEW, /const smsEnabled = isSmsLoginEnabled\(process\.env\.NEXT_PUBLIC_OWNER_SMS_LOGIN\)/);
  assert.match(LOGIN_VIEW, /\{smsEnabled && \(/);
  assert.match(LOGIN_VIEW, /\{effectiveChannel === 'sms' \? \(/);
  // …and the channel can only become sms when the flag is on.
  assert.match(LOGIN_VIEW, /const effectiveChannel = smsEnabled && channel === 'sms' \? 'sms' : 'email'/);
  // No other owner screen offers a phone field.
  assert.doesNotMatch(DASHBOARD + DELETION_VIEW, /type="tel"/);
});

test('BE-47: /internal stuurt een owner-only account door en laat de rest staan', () => {
  assert.match(INTERNAL_PAGE, /import \{ resolveInternalOwnerRedirect \} from '@\/src\/lib\/ownerAccess'/);
  assert.match(INTERNAL_PAGE, /const ownerHref = resolveInternalOwnerRedirect\(roles\)/);
  assert.match(INTERNAL_PAGE, /router\.replace\(ownerHref\)/);
  // The old "nothing to open yet" note for owners is gone (comments aside).
  assert.doesNotMatch(code(INTERNAL_PAGE), /Nog niets te openen/);
  // An account without a usable role still gets the explicit status.
  assert.match(INTERNAL_PAGE, /Dit account heeft geen interne toegang/);
  // BE-47: an owner now has a real destination in the shared internal nav, instead
  // of the old "nog niet beschikbaar" note.
  const nav = read('src/components/InternalNav.js');
  assert.match(nav, /href="\/mijn-restaurant"/);
  assert.match(nav, /Mijn restaurant/);
  assert.doesNotMatch(code(nav), /nog niet beschikbaar/);
});

test('BE-47: de stijlen gebruiken alleen tokens en blijven ≥ 44 px', () => {
  // BE-52 (#128): de houderstijlen staan naast de pagina, niet meer in
  // app/globals.css; de gedeelde BE-48-authstijl blijft daar staan.
  const ownerCss = read('app/mijn-restaurant/mijn-restaurant.css');
  assert.match(ownerCss, /BE-47 \(issue 111\)/, 'the BE-47 style block exists');
  const block = ownerCss;
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b/, 'no hard-coded colour');
  assert.doesNotMatch(block, /\brgba?\(/, 'no hard-coded colour');
  for (const selector of ['.owner-link', '.owner-main']) {
    assert.ok(block.includes(selector), `${selector} exists`);
  }
  assert.match(block, /\.owner-link \{[^}]*min-height: 44px/);
  // The reusable auth controls already guarantee the 44 px minimum (BE-48).
  const auth = CSS.slice(CSS.indexOf('.auth-submit {'), CSS.indexOf('.auth-submit {') + 400);
  assert.match(auth, /min-height: 44px/);
});

test('BE-47: de houder-sessie blijft de standaard Supabase-sessie, zonder eigen opslag', () => {
  for (const file of ['app/mijn-restaurant/OwnerDashboard.js', 'app/mijn-restaurant/inloggen/OwnerLoginView.js']) {
    const source = read(file);
    assert.doesNotMatch(source, /localStorage|sessionStorage/, `${file} must not store tokens itself`);
    assert.doesNotMatch(source, /document\.cookie/, `${file} must not write cookies itself`);
  }
  // The documented practical duration lives in the one place that owns the client.
  const browser = read('src/lib/supabaseBrowser.js');
  assert.match(browser, /createClient\(url, anonKey\)/);
  assert.match(browser, /criterium 3/);
  assert.match(browser, /access token is 1 uur/i);
  assert.match(browser, /ververst het access token zelf/i);
  assert.doesNotMatch(code(browser), /localStorage|sessionStorage/, 'the shared client adds no own token storage');
});

test('BE-47: criterium 4 is gebouwd op expliciete ON DELETE-cascades', () => {
  const roles = read('supabase/migrations/0001_field_provenance.sql');
  const claims = read('supabase/migrations/0003_restaurant_claims.sql');
  assert.match(roles, /user_id\s+uuid not null references auth\.users\(id\) on delete cascade/);
  assert.match(claims, /user_id\s+uuid not null references auth\.users\(id\) on delete cascade/);
});

test('BE-47: geen migratie, geen nieuwe tabel, geen RLS-wijziging', () => {
  const migrations = fs.readdirSync(path.join(ROOT, 'supabase', 'migrations'));
  assert.ok(!migrations.some((file) => /be47|mijn-restaurant|owner-account/i.test(file)), 'BE-47 adds no migration');
  for (const file of migrations) {
    const source = read(path.join('supabase', 'migrations', file));
    // Alleen de BE-47-markers zelf. Een latere, goedgekeurde migratie mag de
    // woorden "mijn-restaurant" of "/mijn-restaurant/menukaart" noemen (0025 van
    // BE-58, #143) zonder daarmee een BE-47-wijziging te zijn.
    assert.doesNotMatch(source, /BE-47|#111/, `${file} must stay untouched by BE-47`);
  }
  // No RLS policy is written by the new app code either.
  assert.doesNotMatch(
    DELETION_ROUTE + DELETION_VIEW + DASHBOARD + read('src/lib/ownerAccountDeletion.js'),
    /create policy|alter table|Row Level Security/i,
  );
});

test('BE-45-bijvangst: de getallenkolom in /internal/tellers staat expliciet op --text-primary', () => {
  // BE-52 (#128): deze regels staan naast de tellerspagina.
  const css = read('app/internal/tellers/tellers.css');
  assert.match(css, /\.tellers-table td\.tellers-col-number \{ color: var\(--text-primary\); \}/);
  assert.match(css, /\.tellers-table th\.tellers-col-number \{ color: var\(--text-secondary\); \}/);
  // No rule paints a number cell with the accent or a link colour.
  assert.doesNotMatch(css, /\.tellers-col-number[^{]*\{[^}]*var\(--accent\)/);
  const page = read('app/internal/tellers/page.js');
  assert.match(page, /<td className="tellers-col-number">\{formatNumber\(row\.gedeeld\)\}<\/td>/);
});

