'use strict';

// BE-46 (#106) — de bedrading van "samen kiezen".
//
// Zelfde conventie als dishCounterSurface.test.js en dishListSurface.test.js:
// de bronbestanden lezen met fs + regex. De rekenregels staan in
// kiesStemming.test.js, de API in kiesHandlers.test.js en de migratie in
// kiesMigration.test.js; hier gaat het om de vraag of de routes, de pagina, de
// knoppen en de cron ze ook echt zo gebruiken.
//
// Wat deze test bewijst:
//   - er zijn precies vier API-routes, met de methoden uit het contract, en elk
//     antwoord is `no-store`;
//   - de service role, de echte data en de reserveerroutering komen alleen via
//     de route-deps binnen;
//   - de cronroute staat één keer per dag in vercel.json en is beveiligd zoals
//     de bestaande cronroutes;
//   - "Samen kiezen" staat naast "Lijstje delen", maakt de stemming via de
//     route en deelt via de bestaande deelroute van BE-49;
//   - de stemlink heeft roepnaam → kaartenstapel → uitslag, met pointer-events,
//     pijltjestoetsen, labels, `role="status"`, een echte lijst en knoppen van
//     minstens 44 px;
//   - er gaat geen IP-adres, user agent, cookie of account mee, en er is geen
//     nieuwe dependency.

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const code = (source) => source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');

const CREATE_ROUTE = read('app/api/v1/kies/route.js');
const READ_ROUTE = read('app/api/v1/kies/[code]/route.js');
const VOTE_ROUTE = read('app/api/v1/kies/[code]/stem/route.js');
const CRON_ROUTE = read('app/api/cron/kies-opruimen/route.js');
const DEPS = read('src/lib/kiesRouteDeps.js');
const HANDLERS = read('src/lib/kiesHandlers.js');
const STEMS = read('src/lib/kiesStemming.js');
const PAGE = read('app/kies/[code]/page.js');
const VIEW = read('app/kies/[code]/KiesView.js');
const IMAGE = read('app/kies/[code]/share-image/route.js');
const START_BUTTON = read('src/components/KiesStartButton.js');
const SHARE_BUTTON = read('src/components/KiesShareButton.js');
const LIST_VIEW = read('app/mijn-lijstje/MijnLijstjeView.js');
// BE-52 (#128): de kies-opmaak staat naast de view en de component, niet meer in
// app/globals.css. De regels zelf zijn ongewijzigd verhuisd.
const KIES_CSS = read('app/kies/kies.css');
const KIES_START_CSS = read('src/components/kies-start.css');
const CSS = `${KIES_CSS}\n${KIES_START_CSS}`;
const BROWSER_CHECK = read('ops/browser/run-be46-browser-check.js');

test('kies: vier routes met de methoden uit het contract, elk zonder cache', () => {
  assert.match(CREATE_ROUTE, /export async function POST\(request\)/);
  assert.doesNotMatch(CREATE_ROUTE, /export (async )?function (GET|PUT|PATCH|DELETE)/);
  assert.match(READ_ROUTE, /export async function GET\(request, \{ params \}\)/);
  assert.doesNotMatch(READ_ROUTE, /export (async )?function (POST|PUT|PATCH|DELETE)/);
  assert.match(VOTE_ROUTE, /export async function POST\(request, \{ params \}\)/);
  assert.match(VOTE_ROUTE, /export async function DELETE\(request, \{ params \}\)/);

  for (const route of [CREATE_ROUTE, READ_ROUTE, VOTE_ROUTE, CRON_ROUTE]) {
    assert.match(route, /'Cache-Control': 'no-store'/);
    assert.match(route, /export const dynamic = 'force-dynamic'/);
  }
  // Beide stemroutes gebruiken dezelfde handler, met de code uit het pad.
  assert.match(VOTE_ROUTE, /kiesHandlers\.vote\(request, \{ code \}\)/);
  assert.match(VOTE_ROUTE, /kiesHandlers\.undoVote\(request, \{ code \}\)/);
  assert.match(READ_ROUTE, /kiesHandlers\.readStemmingRequest\(request, \{ code \}\)/);
  assert.match(CREATE_ROUTE, /kiesHandlers\.createStemming\(request\)/);
});

test('kies: de service role, de echte data en BE-07 komen alleen via de route-deps binnen', () => {
  assert.match(DEPS, /import \{ getSupabaseAdmin \} from '@\/src\/lib\/supabaseAdmin'/);
  assert.match(DEPS, /import menusData from '@\/data\/menus\.json'/);
  assert.match(DEPS, /import restaurantsData from '@\/data\/restaurants\.json'/);
  assert.match(DEPS, /import \{ getReservationActions \} from '@\/src\/utils\/reservation'/);
  assert.match(DEPS, /createKiesHandlers\(\{/);
  assert.match(DEPS, /getSupabase: getSupabaseAdmin/);
  assert.match(DEPS, /reservationFor: \(restaurant\) => getReservationActions\(restaurant \|\| \{\}\)\[0\] \|\| null/);

  // De handlers zelf kennen geen omgeving en geen client: alles is ingespoten.
  assert.doesNotMatch(code(HANDLERS), /supabaseAdmin|process\.env/);
  assert.match(HANDLERS, /from\(KIES_TABLE_STEMMINGEN\)/);
  assert.match(HANDLERS, /from\(KIES_TABLE_STEMMEN\)/);
  assert.match(HANDLERS, /rpc\(KIES_CLEANUP_FUNCTION, \{ p_dagen: KIES_RETENTION_DAYS \}\)/);
  // En de uitslag gaat altijd door de ene rekenregel uit kiesStemming.js.
  assert.match(HANDLERS, /stemmingResult\(\{ dishes, votes \}\)/);
});

test('kies: het opruimen staat één keer per dag in vercel.json en is beveiligd als de andere crons', () => {
  const vercel = JSON.parse(read('vercel.json'));
  const cron = vercel.crons.filter((entry) => entry.path === '/api/cron/kies-opruimen');
  assert.equal(cron.length, 1, 'precies één cronregel');
  // Dagelijks: vijf velden, met vaste minuut en uur (dus één keer per dag).
  assert.match(cron[0].schedule, /^\d{1,2} \d{1,2} \* \* \*$/);
  assert.match(CRON_ROUTE, /cronAuthorized\(\{/);
  assert.match(CRON_ROUTE, /secret: process\.env\.CRON_SECRET/);
  assert.match(CRON_ROUTE, /status: 401/);
  assert.match(CRON_ROUTE, /kiesHandlers\.cleanupStemmingen\(\)/);
});

test('kies: "Samen kiezen" staat naast "Lijstje delen" en deelt via de BE-49-route', () => {
  assert.match(LIST_VIEW, /import KiesStartButton from '@\/src\/components\/KiesStartButton'/);
  assert.match(LIST_VIEW, /<ListShareButton[\s\S]*<KiesStartButton dishes=\{own\} \/>/);
  assert.match(START_BUTTON, /\{KIES_LABEL\}/);
  assert.match(START_BUTTON, /fetch\(KIES_ENDPOINT, \{/);
  assert.match(START_BUTTON, /dish_keys: dishes\.map\(\(dish\) => dish\.id\)/);
  assert.match(START_BUTTON, /sluit_om: sluitOmValue/);
  assert.match(START_BUTTON, /sluitOmFromTime\(time\)/);
  assert.match(START_BUTTON, /\{KIES_SLUIT_TITLE\}/);
  assert.match(START_BUTTON, /\{KIES_SLUIT_NONE_LABEL\}/);
  assert.match(START_BUTTON, /import KiesShareButton/);
  // De bestaande deelroute van BE-49, met de bestaande teller.
  assert.match(SHARE_BUTTON, /performShare\(\{/);
  assert.match(SHARE_BUTTON, /sharePlan\(readSharePreference\(storage\)/);
  assert.match(SHARE_BUTTON, /sendDishCounter\(\{ dish, event: SHARED_EVENT \}\)/);
  assert.match(SHARE_BUTTON, /count: countShared/);
});

test('kies: de stemlink gaat van roepnaam naar de kaartenstapel naar de uitslag', () => {
  assert.match(PAGE, /if \(!isKiesCode\(code\)\) notFound\(\)/);
  assert.match(PAGE, /kiesMetadata\(\{/);
  assert.match(PAGE, /kiesImageHref\(\{ code \}\)/);
  assert.match(VIEW, /phase === 'naam'/);
  assert.match(VIEW, /phase === 'stemmen'/);
  assert.match(VIEW, /phase === 'uitslag'/);
  assert.match(VIEW, /\{KIES_ROEPNAAM_LABEL\}/);
  assert.match(VIEW, /\{KIES_JOIN_LABEL\}/);
  // Na het laatste gerecht en bij opnieuw openen: meteen de uitslag.
  assert.match(VIEW, /nextDishIndex\(body\.dishes, stored\.gestemd\) === -1/);
  // De uitslag is een echte lijst.
  assert.match(VIEW, /<ul className="kies-uitslag">/);
  assert.match(VIEW, /<li key=\{row\.id\}/);
  assert.match(VIEW, /\{KIES_RESULT_FAVOURITE\}/);
  assert.match(VIEW, /\{KIES_RESERVE_LABEL\}/);
  assert.match(VIEW, /\{KIES_ROUTE_LABEL\}/);
  assert.match(VIEW, /row\.reserve\.href/);
  assert.match(VIEW, /row\.route/);
});

test('kies: swipen met pointer-events, een label, toetsenbord en reduced motion', () => {
  assert.match(VIEW, /onPointerDown=\{pointerDown\}/);
  assert.match(VIEW, /onPointerMove=\{pointerMove\}/);
  assert.match(VIEW, /onPointerUp=\{\(event\) => finishDrag\(event, false\)\}/);
  assert.match(VIEW, /swipeOutcome\(\{ dx: event\.clientX - drag\.startX, width \}\)/);
  assert.match(VIEW, /swipeFeedback\(\{ dx, width: 1 \}\)/);
  assert.match(VIEW, /event\.key === 'ArrowRight'/);
  assert.match(VIEW, /event\.key === 'ArrowLeft'/);
  // De kaart zelf: alleen horizontaal slepen, verticaal blijft scrollen.
  assert.match(CSS, /\.kies-card-wrap \{[\s\S]*?touch-action: pan-y;/);
  // Beweging alleen als de bezoeker dat wil.
  assert.match(CSS, /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\.kies-dish-card/);
  assert.match(STEMS, /const SWIPE_THRESHOLD = 0\.3;/);
});


test('kies: toegankelijk — aria-labels met de gerechtnaam, role="status" en 44 px', () => {
  assert.match(VIEW, /aria-label=\{`\$\{KIES_LIEVER_NIET_LABEL\}: \$\{currentDish\.name\}`\}/);
  assert.match(VIEW, /aria-label=\{`\$\{KIES_LEKKER_LABEL\}: \$\{currentDish\.name\}`\}/);
  assert.match(VIEW, /className="kies-progress" role="status">\{kiesProgressLabel\(index, dishes\.length\)\}/);
  assert.match(VIEW, /<p className="kies-status" role="status">\{message\}<\/p>/);
  // De knoppen van de stapel zijn hoog genoeg: de mockup vraagt 56 px.
  assert.match(CSS, /\.kies-vote-btn \{[\s\S]*?min-height: 56px;/);
  // De undo-link is een tekstlink, maar blijft een tikvlak van 44 px.
  assert.match(CSS, /\.kies-undo \{[\s\S]*?min-height: 44px;/);
  assert.match(CSS, /\.kies-uitslag-actions \.share-btn \{[\s\S]*?min-height: 44px;/);
  assert.match(CSS, /\.kies-time-input \{[\s\S]*?min-height: 44px;/);
});

test('kies: de kaartenstapel en de uitslag volgen de goedgekeurde mockup', () => {
  // De kaart: ±85% van de breedte en 440 px hoog op 390 px, met daarachter een
  // tweede kaart als stapel.
  assert.match(CSS, /\.kies-card-wrap \{[\s\S]*?max-width: 360px;[\s\S]*?height: 454px;/);
  assert.match(CSS, /\.kies-dish-card \{[\s\S]*?height: 440px;/);
  assert.match(CSS, /\.kies-card-ghost \{[\s\S]*?pointer-events: none;/);
  assert.match(VIEW, /<div className="kies-card-ghost" aria-hidden="true" \/>/);
  // Op de kaart: restaurantnaam, grote gerechtnaam, prijs als pil, beschrijving.
  const card = VIEW.slice(VIEW.indexOf('className="kies-card-ghost"'), VIEW.indexOf('kies-vote-actions'));
  const order = ['className="kies-rest"', 'className="kies-dish"', 'className="kies-price"', 'className="kies-desc"']
    .map((name) => card.indexOf(name));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'de volgorde op de kaart is die van de mockup');
  assert.match(CSS, /\.kies-price \{[\s\S]*?border-radius: var\(--radius-pill\);/);
  // De voortgang: de tekst uit criterium 6 naast een dunne balk.
  assert.match(VIEW, /className="kies-progress-bar" aria-hidden="true">[\s\S]*?className="kies-progress-fill"/);
  assert.match(CSS, /\.kies-progress-fill \{[\s\S]*?background: var\(--button-primary-bg\);/);
  // Twee knoppen naast elkaar van ±132 px breed en 56 px hoog, met een icoon.
  assert.match(CSS, /\.kies-vote-actions \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 132px\)\);/);
  assert.match(VIEW, /<CrossIcon \/>/);
  assert.match(VIEW, /<CheckIcon \/>/);
  assert.match(CSS, /\.kies-vote-lekker \{[\s\S]*?background: var\(--button-primary-bg\);/);
  // "Vorige stem ongedaan maken" is een tekstlink met een terug-pijl.
  assert.match(VIEW, /className="kies-undo"[\s\S]*?<BackIcon \/>[\s\S]*?<span>\{KIES_UNDO_LABEL\}<\/span>/);
  assert.match(CSS, /\.kies-undo \{[\s\S]*?text-decoration: underline;/);
  // Het label blijft in beeld: het staat aan de kant waar de kaart vandaan komt.
  assert.match(CSS, /\.kies-swipe-lekker \{\n {2}left: 16px;/);
  assert.match(CSS, /\.kies-swipe-liever-niet \{\n {2}right: 16px;/);
  // De uitslag: "Reserveer" in de primaire kleur, "Route" met rand, en per
  // gerecht een balk met het aandeel "lekker".
  assert.match(VIEW, /className="lijst-primary-btn"[\s\S]*?\{KIES_RESERVE_LABEL\}/);
  assert.match(VIEW, /className="share-btn"[\s\S]*?\{KIES_ROUTE_LABEL\}/);
  assert.match(VIEW, /const favourite = position === 0 && row\.lekker > 0/);
  assert.match(VIEW, /<span className="kies-uitslag-bar" aria-hidden="true">[\s\S]*?width: `\$\{kiesLekkerShare\(row\)\}%`/);
  assert.match(CSS, /\.kies-uitslag-bar-fill \{[\s\S]*?background: var\(--button-primary-bg\);/);
});

test('kies: alleen tokens, dus licht en donker zonder eigen regels', () => {
  const start = CSS.indexOf('BE-46 — Samen kiezen');
  assert.ok(start > 0, 'de BE-46-regels staan er');
  const section = CSS.slice(start);
  assert.ok(section.length > 3000, 'de BE-46-regels zijn niet leeg');
  const declarations = [...section.matchAll(/(?:color|background|border-color|border)\s*:\s*([^;]+);/g)]
    .map((match) => match[1].trim());
  for (const value of declarations) {
    assert.ok(
      // `0`, `none` en `transparent` dragen geen eigen kleur: de tekstlink van
      // "Vorige stem ongedaan maken" zet daarmee rand en achtergrond uit.
      value.includes('var(--') || /^rgba\(0, 0, 0, 0\.18\)$/.test(value) || /^(0|none|transparent)$/.test(value),
      `geen vaste kleur in de BE-46-regels: ${value}`,
    );
  }
});

test('kies: de voorvertoning is "Kies mee: <n> gerechten" in de stijl van BE-44', () => {
  assert.match(IMAGE, /import \{ ImageResponse \} from 'next\/og'/);
  assert.match(IMAGE, /import ShareCard from '@\/app\/_share\/ShareCard'/);
  assert.match(IMAGE, /kiesImageTitle\(dishes\.length\)/);
  assert.match(IMAGE, /shareThemeFor\(url\.searchParams\.get\('stand'\)\)/);
  assert.match(IMAGE, /width: 1200, height: 630/);
  assert.equal(STEMS.match(/const KIES_IMAGE_PREFIX = '([^']+)'/)[1], 'Kies mee:');
});

test('kies: de browsercheck wacht op de clientkant en leest de stemmen vóór de herlaadbeurt', () => {
  // Twee fouten die de eerste volledige run lieten zakken (30 oktober): de check
  // las de SSR-tekst "Bezig…" nog voordat React werkte, en las de gestubde
  // oproepen pas na een herlaadbeurt (waarna de stub leeg begint).
  assert.match(BROWSER_CHECK, /const HYDRATED = `Boolean\(\(window\.__KIES_CALLS__ \|\| \[\]\)\.length\)`;/);
  assert.match(BROWSER_CHECK, /const PAGE_READY = `\$\{HYDRATED\} && Boolean\(document\.querySelector\('#kies-roepnaam'\)/);
  assert.match(BROWSER_CHECK, /async function openFresh\(cdp, query = '', want = 'light'\) \{\n {2}await navigate\(cdp, PAGE_URL\(query\), HYDRATED\);/);
  assert.match(BROWSER_CHECK, /async function warmUp\(cdp\) \{[\s\S]*?await waitFor\(cdp, PAGE_READY, 120000\);/);
  const calls = BROWSER_CHECK.indexOf('const calls = await callsOf(cdp);');
  const reload = BROWSER_CHECK.indexOf("await cdp.send('Page.reload', { ignoreCache: false });\n  const reopened");
  assert.ok(calls > 0 && reload > 0 && calls < reload, 'de stemmen worden vóór de herlaadbeurt gelezen');
  // De route van maken tot uitslag is een eigen scenario, met de gedeeld-teller.
  assert.match(BROWSER_CHECK, /\{ name: 'maken', run: \(cdp\) => createScenario\(cdp\) \}/);
  assert.match(BROWSER_CHECK, /window\.__KIES_TELLERS__/);
});

test('kies: de browsercheck zet het thema per opname en controleert het vóór de opname', () => {
  // De eerste volledige run leverde "lichte" opnames op die donker waren: het
  // thema werd vóór de navigatie gezet en een schone start wiste de opslag (en
  // dus de themakeuze). Daarom: elke opname in zijn eigen thema, met bewijs.
  assert.match(BROWSER_CHECK, /async function themeProof\(cdp\) \{/);
  assert.match(BROWSER_CHECK, /async function shotInTheme\(cdp, name, want, state\) \{/);
  assert.match(BROWSER_CHECK, /check\(`thema: \$\{name\} staat echt in \$\{want\}`/);
  assert.match(BROWSER_CHECK, /proof\.attr === want/);
  assert.match(BROWSER_CHECK, /proof\.active\[0\] === activeLabel/);
  assert.match(BROWSER_CHECK, /isLight \? proof\.luminance > 200 : proof\.luminance < 80/);
  assert.match(BROWSER_CHECK, /themeProof: meta\.themeProof \|\| null/);
  // Een schone start laat de themakeuze staan en wist alleen de eigen voortgang.
  assert.match(BROWSER_CHECK, /localStorage\.removeItem\(\$\{JSON\.stringify\(PROGRESS_KEY\)\}\)/);
  assert.match(BROWSER_CHECK, /localStorage\.setItem\(\$\{JSON\.stringify\(THEME_KEY\)\}, 'light'\)/);
  // Geen enkele opname gaat nog buiten shotInTheme om.
  assert.doesNotMatch(BROWSER_CHECK, /await shot\(cdp, 'be46-/);
  for (const [name, want, state] of [
    ['be46-stapel-390-light.png', 'light', 'stapel'],
    ['be46-stapel-390-dark.png', 'dark', 'stapel'],
    ['be46-sleep-390-light.png', 'light', 'sleep-lekker'],
    ['be46-sleep-390-dark.png', 'dark', 'sleep-lekker'],
    ['be46-uitslag-390-light.png', 'light', 'uitslag'],
    ['be46-uitslag-390-dark.png', 'dark', 'uitslag'],
    ['be46-stapel-na-swipen-390-dark.png', 'dark', 'stapel-na-swipen'],
    ['be46-sluitingstijd-390-dark.png', 'dark', 'sluitingstijd'],
    ['be46-zonder-migratie-390-dark.png', 'dark', 'zonder-migratie'],
  ]) {
    assert.match(BROWSER_CHECK, new RegExp(`shotInTheme\\(cdp, '${name.replace('.', '\\.')}', '${want}', '${state}'\\)`));
  }
  // De stapelmetingen van de mockup staan er ook echt in.
  assert.match(BROWSER_CHECK, /async function readStack\(cdp\) \{/);
  assert.match(BROWSER_CHECK, /mockup: de kaart is ±85% van de breedte op 390 px/);
  assert.match(BROWSER_CHECK, /mockup: "Lekker" heeft de primaire knopkleur/);
});

test('kies: privacy — geen ip, user agent, cookie of account, en geen nieuwe dependency', () => {
  for (const source of [STEMS, HANDLERS, VIEW, START_BUTTON, SHARE_BUTTON, PAGE, IMAGE, DEPS]) {
    assert.doesNotMatch(source, /ip_address|ipAddress|user_agent|userAgent\(|navigator\.userAgent|document\.cookie/i);
  }
  // Geen account en geen sessie in de stemlink.
  assert.doesNotMatch(code(VIEW), /signIn|signOut|session\b/i);
  assert.doesNotMatch(code(START_BUTTON), /signIn|signOut|session\b/i);
  // De eigen opslag gaat via de lib, met try/catch — nooit rechtstreeks.
  for (const source of [VIEW, START_BUTTON]) {
    assert.doesNotMatch(code(source), /window\.localStorage|localStorage\.(get|set|remove)Item/);
  }
  assert.match(STEMS, /function readKiesProgressMap\(storage\) \{[\s\S]*?catch \(error\) \{\s*return \{\};/);
  assert.match(STEMS, /function writeKiesProgress\(storage, code, progress\) \{[\s\S]*?catch \(error\) \{\s*return \{ ok: false/);

  // Geen nieuwe dependency voor het swipen of de pagina's.
  const pkg = JSON.parse(read('package.json'));
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), [
    '@anthropic-ai/sdk',
    '@supabase/supabase-js',
    'next',
    'pdfjs-dist',
    'react',
    'react-dom',
  ]);
});

