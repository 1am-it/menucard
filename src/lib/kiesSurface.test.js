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
const CSS = read('app/globals.css');

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
  // De knoppen van de stapel zijn hoog genoeg.
  assert.match(CSS, /\.kies-vote-btn,\n\.kies-undo \{[\s\S]*?min-height: 52px;/);
  assert.match(CSS, /\.kies-uitslag-actions \.share-btn \{[\s\S]*?min-height: 44px;/);
  assert.match(CSS, /\.kies-time-input \{[\s\S]*?min-height: 44px;/);
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
      value.includes('var(--') || /^rgba\(0, 0, 0, 0\.18\)$/.test(value),
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

