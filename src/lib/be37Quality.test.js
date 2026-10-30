'use strict';

// BE-37 (#89) — de kwaliteitscheck als regressie. Elke assert hoort bij een
// gemeten bevinding uit ops/browser/evidence/kwaliteit-voor.json; de "na"-
// meting staat in kwaliteit-na.json. Zelfde conventie als de andere
// surface-tests: fs.readFileSync + regex, geen gerenderde DOM-harness.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const css = () => read('app/globals.css');

function rule(selector) {
  const source = css();
  const index = source.indexOf(selector);
  assert.ok(index > -1, `missing rule: ${selector}`);
  return source.slice(index, source.indexOf('}', index));
}

// ── criterium 1: contrast ─────────────────────────────────────────────────
test('BE-37 contrast: control borders use the input-border token, not the decorative card edge', () => {
  const block = rule('.back-btn,\n.detail-menu-btn-outline,\n.dip-btn-secondary,\n.rp-btn-website,\n.rp-btn-reserveer { border-color');
  assert.match(block, /border-color: var\(--input-border\)/);
  for (const selector of ['.internal-nav-workqueue-trigger,', '.internal-nav-signout,', '.brn-chip,', '.srr-recheck { border-color: var(--input-border); }']) {
    assert.ok(css().includes(selector), `missing internal control border: ${selector}`);
  }
});

test('BE-37 contrast: the dark wine line uses a gold that meets 4.5:1 on the dark card', () => {
  const source = css();
  // De donkere kaart is #2A2F35; #a87c4a haalde daar 3,63:1. In de donkere
  // root staat nu dezelfde goudfamilie als de nav-indicator (#d8bc7a, 7,3:1).
  assert.match(source, /--wine:\s+#d8bc7a;/);
  assert.doesNotMatch(source, /--wine:\s+#a87c4a;/);
  for (const light of source.matchAll(/--wine:\s+(#[0-9a-fA-F]{6});/g)) {
    assert.notEqual(light[1].toLowerCase(), '#a87c4a');
  }
});

test('BE-37 contrast: the Bronnen task row and chips use the 3:1 control border in both themes', () => {
  const source = css();
  assert.match(source, /\.brn-task \{[^}]*border: 1px solid var\(--input-border\)/);
  assert.match(source, /\.brn-chip \{[^}]*border: 1px solid var\(--input-border\)/);
  assert.match(source, /\.brn-chip\[aria-pressed="true"\] \{[^}]*border-color: var\(--on-accent-fill\)/);
});

// ── criterium 3: toetsenbord, focus en schermlezer ────────────────────────
test('BE-37 focus: every interactive element has the shared focus ring', () => {
  const source = css();
  for (const selector of ['button:focus-visible', 'a:focus-visible', 'summary:focus-visible', 'input:focus-visible']) {
    assert.ok(source.includes(selector), selector);
  }
  const global = source.slice(source.indexOf('button:focus-visible,\na:focus-visible,'));
  assert.match(global.slice(0, 400), /outline: 2px solid var\(--border-focus\)/);
});

test('BE-37 focus: the phone tab bar rings in its own text colour, not on the oker', () => {
  assert.match(css(), /\.mobile-tab-link:focus-visible \{ outline-color: var\(--tabbar-text\); \}/);
});

test('BE-37 focus: a search field only hides its ring for the mouse', () => {
  const source = css();
  assert.match(source, /\.search-field \.search-input:focus:not\(:focus-visible\)/);
  assert.match(source, /\.home-search-input:focus:not\(:focus-visible\)/);
  assert.match(source, /\.mf-search:focus:not\(:focus-visible\)/);
  assert.match(source, /\.mf-search:focus-visible \{ outline: 2px solid var\(--border-focus\)/);
});

test('BE-37 screen reader: the shared row action and AI block render labels through <EmojiText>', () => {
  const row = read('src/components/SourceResultRow.js');
  assert.match(row, /import EmojiText from '@\/src\/components\/EmojiText'/);
  assert.equal((row.match(/<EmojiText value=\{step\.label\} \/>/g) || []).length, 2);
  const action = read('src/components/AiReadAction.js');
  assert.match(action, /<EmojiText value=\{label\} \/>/);
  assert.match(action, /<EmojiText value=\{aiReadOutcomeLine/);
  assert.match(action, /<EmojiText value=\{state\.nextLabel\} \/>/);
  const section = read('app/internal/coverage/CoverageCheckSection.js');
  assert.equal((section.match(/<EmojiText value=\{row\.step\.label\} \/>/g) || []).length, 3);
});

test('BE-37 screen reader: Dekking, Bronnen, de menukaart en de restaurantpagina show no bare emoji', () => {
  const files = [
    'app/internal/coverage/page.js',
    'app/internal/coverage/NewFoundSection.js',
    'app/internal/bronnen/BronnenView.js',
    'app/internal/toevoegen/page.js',
    'src/components/RestaurantListCard.js',
    'src/components/MenuBody.js',
    'app/menu/[id]/MenuView.js',
    'app/restaurant/[id]/RestaurantDetailView.js',
  ];
  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
  const offenders = [];
  for (const file of files) {
    read(file).split('\n').forEach((line, index) => {
      const code = line
        .replace(/\/\/.*$/, '')
        .replace(/'[^']*'/g, "''")
        .replace(/"[^"]*"/g, '""');
      if (!EMOJI.test(code)) return;
      if (/aria-hidden="true"/.test(line)) return;
      offenders.push(`${file}:${index + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], 'a decorative emoji must go through <Emoji> or <EmojiText>');
});

test('BE-37 focus: the ring appears immediately on the components that animate', () => {
  // `transition: all` liet de ring 150 ms in een halve kleur staan; de ring
  // zelf doet daarom niet meer mee aan de transition.
  const source = css();
  const block = source.slice(source.indexOf('.meal-btn,\n.cat-nav-item,\n.mf-btn,\n.primary-nav-link,'));
  assert.match(block.slice(0, 400), /transition-property: background-color, border-color, color;/);
  for (const selector of ['.meal-btn,', '.cat-nav-item,', '.mf-btn,', '.primary-nav-link,']) {
    assert.ok(block.slice(0, 200).includes(selector), selector);
  }
});

// ── criterium 4: telefoon ─────────────────────────────────────────────────
test('BE-37 phone: the measured controls have a 44px tap target and the checkboxes a 44px hit area', () => {
  const source = css();
  const minHeight = source.slice(source.indexOf('.home-chip,\n.home-meal-btn,\n.now-open-btn,'));
  assert.match(minHeight.slice(0, 900), /min-height: 44px/);
  for (const selector of ['.theme-btn { min-height: 44px;', '.primary-nav-link { min-height: 44px; }', '.mf-search,', '.stg-btn-secondary,', '.internal-nav-link { min-height: 44px;']) {
    assert.ok(source.includes(selector), selector);
  }
  // Een native selectievakje negeert padding; het label eromheen is het
  // tikvlak van 44 px en de box zelf houdt zijn eigen maat.
  assert.match(source, /\.cov-check-hit,\s*\n\.brn-pick-hit \{ display: inline-flex; flex: none; align-items: center; justify-content: center; width: 44px; height: 44px; \}/);
  assert.match(source, /\.brn-pick-spacer \{ width: 44px; \}/);
  assert.match(read('app/internal/coverage/CoverageCheckSection.js'), /<label className="cov-check-hit">\s*\n\s*<input\s*\n\s*type="checkbox"/);
  assert.match(read('app/internal/bronnen/BronnenView.js'), /<label className="brn-pick-hit">\s*\n\s*<input\s*\n\s*type="checkbox"/);
  assert.match(source, /\.search-clear,\s*\n\.mf-clear \{ width: 44px; height: 44px;/);
  assert.match(
    source,
    /\.brn-breadcrumb a\.stg-link,\s*\n\.dip-row a,\s*\n\.rp-line a,\s*\n\.rp-source a \{ min-height: 44px; display: inline-flex; align-items: center; \}/,
  );
  assert.match(source, /\.dip-claim,\s*\n\.dip-nvwa-btn \{ display: inline-flex; align-items: center; min-height: 44px; \}/);
  const detail = read('app/restaurant/[id]/RestaurantDetailView.js');
  assert.match(detail, /className="dip-claim"/);
  assert.match(detail, /className="dip-nvwa-btn"/);
  // Het woordmerk en de interne huislink zijn zelf een tikvlak.
  assert.match(source, /a\.wordmark \{ min-height: 44px; \}/);
  assert.match(source, /a\.internal-nav-home \{ min-width: 44px; min-height: 44px; \}/);
  assert.match(source, /a\.srr-paste-link \{ min-height: 44px; display: inline-flex; align-items: center; \}/);
});

test('BE-37 phone: Dekking at 320px can shrink its column, so nothing runs off the screen', () => {
  const source = css();
  assert.match(source, /\.cov-new,\s*\n\.cov-new > \* \{ min-width: 0; \}/);
});

test('BE-37 phone: Dekking keeps its two action buttons inside the screen at 320px', () => {
  const source = css();
  assert.match(source, /\.cov-check,\s*\n\.cov-check-head \{ min-width: 0; \}/);
  assert.match(source, /\.cov-check-head > \.cov-check-action \{ flex: 1 1 100%; white-space: normal;/);
});

// ── criterium 5: slordigheden ─────────────────────────────────────────────
test('BE-37 Dekking: the column heads no longer run into each other', () => {
  const source = css();
  assert.match(source, /\.cov-check-table th \{ padding-right: 14px; vertical-align: bottom; \}/);
  assert.match(source, /\.cov-check-table th:first-child \{ width: 1%; white-space: nowrap; \}/);
  assert.match(source, /\.cov-check-table th:last-child \{ padding-right: 0; \}/);
});

test('BE-37 Dekking: a row that is in the control is shown once, not twice', () => {
  const section = read('app/internal/coverage/CoverageCheckSection.js');
  assert.match(section, /const activeBatchUrls = useMemo\(/);
  assert.match(section, /const visibleRows = useMemo\(\s*\n\s*\(\) => rows\.filter\(\(row\) => !row\.url \|\| !activeBatchUrls\.has\(row\.url\)\),/);
  assert.match(section, /\{visibleRows\.map\(\(row\) => \(/);
  assert.doesNotMatch(section, /\{rows\.map\(\(row\) => \(/);
  assert.match(section, /van deze rijen staan hieronder bij &quot;Resultaat van de controle&quot;/);
  assert.match(section, /checkSelection\(visibleRows, selected\)/);
});

test('BE-37 slordigheden: the internal sign-in screens are Dutch', () => {
  const login = read('app/internal/login/page.js');
  assert.match(login, /<h1 className="auth-title">Inloggen \(intern\)<\/h1>/);
  // BE-48 (#112): a real <label> per field instead of a placeholder-only field.
  assert.match(login, /htmlFor="auth-email"[\s\S]{0,120}E-mailadres/);
  assert.match(login, /htmlFor="auth-password"[\s\S]{0,120}Wachtwoord/);
  assert.match(login, /\{busy \? 'Bezig met inloggen…' : 'Inloggen'\}/);
  assert.doesNotMatch(login, /Sign in|Signing in|Internal sign-in/);

  const activate = read('app/internal/activate/page.js');
  assert.match(activate, />Je account activeren</);
  assert.match(activate, /'Account activeren'/);
  assert.doesNotMatch(activate, /Activate your account|Activate account|Activating…|Enter the email address/);

  const setPassword = read('app/internal/set-password/page.js');
  assert.match(setPassword, />Stel je wachtwoord in</);
  assert.match(setPassword, /'Wachtwoord opslaan'/);
  assert.doesNotMatch(setPassword, /Set your password|'Set password'|Checking your invitation link|New password|Confirm new password/);

  const forgot = read('app/internal/wachtwoord-vergeten/page.js');
  assert.match(forgot, />Wachtwoord vergeten</);
  assert.match(forgot, /'Stuur mij een code'/);
  assert.doesNotMatch(forgot, /Forgot password|Send reset link|Reset password/);

  // BE-48 (#112): the Dutch auth texts now live in one shared translation
  // (src/lib/authErrors.js); activationFlow.js only calls it. The behaviour
  // itself is proven in activationFlow.test.js and authErrors.test.js.
  assert.match(read('src/lib/activationFlow.js'), /require\('\.\/authErrors'\)/);
  assert.match(read('src/lib/authErrors.js'), /Deze code is ongeldig of verlopen\. Vraag een nieuwe code aan\./);
  assert.match(read('src/lib/setPasswordFlow.js'), /De wachtwoorden zijn niet gelijk\./);
  assert.doesNotMatch(read('src/lib/setPasswordFlow.js'), /Passwords do not match|Password must be at least|Something went wrong setting/);

  // BE-37 (#89): ook de gedeelde interne navigatie en de statuspagina.
  const nav = read('src/components/InternalNav.js');
  assert.match(nav, />\s*Uitloggen\s*</);
  assert.doesNotMatch(nav, /Sign out/);
  assert.doesNotMatch(nav, /Owner tools|not available yet|No internal access/);
  const home = read('app/internal/page.js');
  const homeCode = home
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  assert.match(home, /Uitloggen/);
  // BE-47 (#111, criterium 5): de owner-only tak is nu een doorsturing naar
  // /mijn-restaurant; de oude owner-notitie bestaat daar niet meer. De
  // statuspagina blijft Nederlands.
  assert.match(homeCode, /resolveInternalOwnerRedirect\(roles\)/);
  assert.doesNotMatch(homeCode, /Beheerdersfuncties|Nog niets te openen/);
  assert.match(home, /Dit account heeft geen interne toegang\./);
  assert.doesNotMatch(homeCode, /Sign out|Owner tools|Nothing to open yet|Your account has no internal role/);
});

// ── criterium 2 en 6: meten en bewijs ─────────────────────────────────────
test('BE-37 evidence: the browser check is a real, runnable script with the contract routes', () => {
  const script = read('ops/browser/run-kwaliteit-browser-check.js');
  assert.match(script, /run-kwaliteit-browser-check/);
  for (const route of ["path: '/'", "path: '/alle-restaurants'", "path: '/restaurant/6'", "path: '/menu/6-diner'"]) {
    assert.ok(script.includes(route), route);
  }
  for (const page of ['/internal/coverage', '/internal/bronnen', '/internal/toevoegen', '/internal/menu-import']) {
    assert.ok(script.includes(page), page);
  }
  assert.match(script, /summary\.totalKb < 250/);
  assert.match(script, /kwaliteit-\$\{LABEL\}\.json/);
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['test:browser:kwaliteit'], 'node ops/browser/run-kwaliteit-browser-check.js');
});


test('BE-37 dialog: the cleanup confirmation opens with focus inside, closes with Escape and returns focus', () => {
  const view = read('app/internal/bronnen/BronnenView.js');
  assert.match(view, /const cleanupTriggerRef = useRef\(null\)/);
  assert.match(view, /const cleanupDialogRef = useRef\(null\)/);
  assert.match(view, /if \(event\.key !== 'Escape'\) return/);
  assert.match(view, /onCancelCleanup\(\)/);
  assert.match(view, /if \(trigger\) trigger\.focus\(\)/);
  assert.match(view, /ref=\{cleanupTriggerRef\}/);
  assert.match(view, /role="alertdialog"[^>]*ref=\{cleanupDialogRef\}/);
  assert.match(view, /const first = dialog \? dialog\.querySelector\('button'\) : null/);
});
