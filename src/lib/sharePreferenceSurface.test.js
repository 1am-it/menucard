'use strict';

// BE-49 (#115) — de bedrading van de rustige gerechtkaart en het snelle delen,
// als oppervlaktetest.
//
// Zelfde conventie als dishShareSurface.test.js en dishListSurface.test.js: het
// bronbestand lezen met fs + regex. De rekenregels zelf (links, voorkeur,
// gedragskeuze, teller) staan in sharePreference.test.js; hier gaat het om de
// vraag of de kaart, de knoppen, het blad, de instellingen en de tokens ze ook
// echt zo gebruiken.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const code = (source) => source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');

const MENU_BODY = read('src/components/MenuBody.js');
const SHARE_BUTTON = read('src/components/DishShareButton.js');
const SAVE_BUTTON = read('src/components/DishSaveButton.js');
const DIALOG = read('src/components/ShareDialog.js');
const SETTINGS = read('src/components/ShareSettingsButton.js');
const LIB = read('src/lib/sharePreference.js');
const CSS = read('app/globals.css');
const DIALOG_CSS = read('src/components/share-dialog.css');

const PUBLIC_HEADERS = [
  'app/HomeView.js',
  'app/alle-restaurants/page.js',
  'app/claim/[restaurantId]/ClaimView.js',
  'app/menu/[id]/MenuView.js',
  'app/mijn-lijstje/MijnLijstjeView.js',
  'app/nvwa/[id]/NvwaView.js',
  'app/restaurant/[id]/RestaurantDetailView.js',
  'app/search/page.js',
];

function cssBlockOf(source, selector) {
  const start = source.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `${selector} staat niet in de css`);
  const open = source.indexOf('{', start);
  return source.slice(open + 1, source.indexOf('}', open));
}

function cssBlock(selector) {
  return cssBlockOf(CSS, selector);
}

test('de kaartregel: label links, de twee icoonknoppen rechts, onder de beschrijving', () => {
  const desc = MENU_BODY.indexOf('{item.desc && (');
  const foot = MENU_BODY.indexOf('<div className="card-foot">');
  const labels = MENU_BODY.indexOf('<div className="card-foot-labels">');
  const buttons = MENU_BODY.indexOf('<DishShareButton');
  assert.ok(desc > 0 && foot > desc && labels > foot && buttons > labels);
  // De supplementen en de allergenen staan tussen de beschrijving en de
  // onderste regel: de knoppen staan dus niet meer tussen de tekst.
  assert.ok(MENU_BODY.indexOf('{item.sup') < foot);
  assert.ok(MENU_BODY.indexOf('item.allergens') < foot);
  // En de knoppen krijgen de gerechtnaam voor hun aria-labels mee.
  assert.match(MENU_BODY, /name=\{item\.name\}/);
  assert.match(CSS, /\.card-foot \{[^}]*justify-content: space-between/);
});

test('de beschrijving gebruikt de secundaire teksttoken uit beide thema’s', () => {
  const desc = cssBlock('.td-desc');
  assert.match(desc, /color: var\(--text-secondary\)/);
  assert.doesNotMatch(desc, /#[0-9a-fA-F]{3,6}\b|rgba?\(/, 'geen vaste kleur in de beschrijving');
  assert.equal((CSS.match(/--text-secondary:/g) || []).length >= 2, true);
});

test('de icoonknoppen: 44 × 44 px, icoon ±20 px, geen gevuld vlak, wel een naam', () => {
  for (const selector of ['.dish-share-btn', '.dish-save-btn']) {
    const block = cssBlock(selector);
    assert.match(block, /min-height: 44px/, selector);
    assert.match(block, /min-width: 44px/, selector);
    assert.match(block, /background: transparent/, selector);
    assert.match(block, /border: 0/, selector);
    assert.doesNotMatch(block, /#[0-9a-fA-F]{3,6}\b|rgba?\(/, `${selector} gebruikt een vaste kleur`);
  }
  assert.match(CSS, /\.dish-share-btn \.dish-share-icon \{ width: 20px; height: 20px; \}/);
  assert.match(CSS, /\.dish-save-btn \.dish-share-icon \{ width: 20px; height: 20px; \}/);

  assert.match(SHARE_BUTTON, /aria-label=\{`Deel \$\{shareName\}`\}/);
  assert.match(SHARE_BUTTON, /aria-expanded=\{open\}/);
  assert.match(SAVE_BUTTON, /aria-label=\{`Bewaar \$\{saveName\}`\}/);
  assert.match(SAVE_BUTTON, /aria-pressed=\{saved\}/);
});

test('het blad heeft echte checkboxen, maximaal 3, en een telefoonmenu-optie', () => {
  assert.match(DIALOG, /import \{ createPortal \} from 'react-dom'/);
  assert.match(DIALOG, /createPortal\(/);
  assert.match(DIALOG, /role="dialog"/);
  assert.match(DIALOG, /aria-modal="true"/);
  assert.match(DIALOG, /type="checkbox"/);
  assert.match(DIALOG, /disabled=\{!checked && atLimit\}/);
  assert.match(DIALOG, /MAX_SHARE_FAVORITES/);
  // BE-61: het telefoonmenu is geen losse checkbox meer maar het tweede deel
  // van de schakelaar.
  assert.match(DIALOG, /SHARE_SEGMENT_PHONE_LABEL/);
  assert.match(DIALOG, /SHARE_SHEET_TITLE/);
  assert.match(DIALOG, /SHARE_SETTINGS_TITLE/);
  // Esc sluit en de focus keert terug naar de knop die het paneel opende.
  assert.match(DIALOG, /event\.key === 'Escape'/);
  assert.match(DIALOG, /opener\.focus\(\)/);
  // Tab blijft binnen het paneel.
  assert.match(DIALOG, /event\.key !== 'Tab'/);
  // En de opslag van het blad gaat via de lib, niet hier.
  assert.match(SHARE_BUTTON, /writeSharePreference\(storage, preference\)/);
  assert.match(SHARE_BUTTON, /clearSharePreference\(storage\)/);
});

test('BE-61: de schakelaar is één echte radiogroep in een fieldset', () => {
  assert.match(DIALOG, /<fieldset className="share-segment">/);
  assert.match(DIALOG, /<legend className="visually-hidden">\{SHARE_SEGMENT_LEGEND\}<\/legend>/);
  // Twee echte radio-inputs met dezelfde naam: één groep, dus één stand.
  assert.equal((DIALOG.match(/type="radio"/g) || []).length, 2);
  assert.equal((DIALOG.match(/name=\{`\$\{idPrefix\}-modus`\}/g) || []).length, 2);
  assert.match(DIALOG, /value="favorieten"[\s\S]*value="telefoonmenu"/);
  assert.match(DIALOG, /checked=\{!phone\}/);
  assert.match(DIALOG, /checked=\{phone\}/);
  // De actieve stand: lichte achtergrond met een schaduw in een gevulde houder.
  assert.match(cssBlockOf(DIALOG_CSS, '.share-segment'), /background: var\(--bg-elevated\)/);
  assert.match(cssBlockOf(DIALOG_CSS, '.share-segment-option.is-active'),
    /background: var\(--bg-card\)[\s\S]*box-shadow: var\(--shadow-sm\)/);
  // Het keuzepunt blijft een echt input, dus toetsenbord en pijltjes werken.
  assert.match(DIALOG_CSS, /\.share-segment-input:focus-visible/);
});

test('BE-61: de volgnummers volgen de volgorde van kiezen, met "n van 3"', () => {
  assert.match(DIALOG, /const order = methods\.indexOf\(method\.id\)/);
  assert.match(DIALOG, /const checked = order >= 0/);
  assert.match(DIALOG, /\{checked \? order \+ 1 : ''\}/);
  assert.match(DIALOG, /shareFavoriteCountLabel\(methods\.length\)/);
  assert.match(DIALOG, /className=\{`share-fav-mark\$\{checked \? ' is-chosen' : ''\}`\}/);
  // Per regel: een icoon van 36 px in een afgerond vlak, het label, het rondje.
  assert.match(DIALOG, /<span className="share-fav-icon-box">[\s\S]*<span className="share-option-label">\{method\.label\}<\/span>[\s\S]*share-fav-mark/);
  assert.match(cssBlockOf(DIALOG_CSS, '.share-fav-icon-box'), /width: 36px/);
  assert.match(cssBlockOf(DIALOG_CSS, '.share-fav-row'), /min-height: 56px/);
});

test('BE-61: bij 3 gekozen gaan de andere regels uit en zegt de hint dat', () => {
  assert.match(DIALOG, /disabled=\{!checked && atLimit\}/);
  assert.match(DIALOG, /\{phone \? SHARE_PHONE_MENU_HINT : atLimit \? SHARE_HINT_FULL : SHARE_SHEET_HINT\}/);
  assert.match(LIB, /SHARE_PHONE_MENU_HINT = 'Je deelt altijd via het deelmenu van je telefoon\.'/);
  assert.match(LIB, /SHARE_HINT_FULL = 'Je hebt 3 favorieten gekozen/);
  // Het telefoonmenu schakelt de hele lijst uit en dimt hem.
  assert.match(DIALOG, /className=\{`share-options\$\{phone \? ' is-muted' : ''\}`\} disabled=\{phone\}/);
  assert.match(cssBlockOf(DIALOG_CSS, '.share-options.is-muted'), /opacity: 0\.55/);
});

test('BE-61: "Opslaan" staat uit zonder keuze en "Annuleren" is uit het blad', () => {
  assert.match(DIALOG, /className="share-btn share-btn-primary share-save" disabled=\{nothing\}/);
  assert.match(DIALOG, /const nothing = !phone && methods\.length === 0/);
  assert.match(cssBlockOf(DIALOG_CSS, '.share-save'), /min-height: 52px/);
  // "Wissen" is er alleen in de instellingen, als tekstlink in --accent.
  assert.match(DIALOG, /\{settings \? \([\s\S]*SHARE_CLEAR_LABEL[\s\S]*\) : null\}/);
  assert.match(cssBlockOf(DIALOG_CSS, '.share-clear'), /color: var\(--accent\)/);
  // Het blad zelf heeft geen "Annuleren" meer; het kleine menu wel.
  const sheet = DIALOG.slice(DIALOG.indexOf('export function ShareDialog'), DIALOG.indexOf('export function ShareMenu'));
  assert.notEqual(sheet.indexOf('export function ShareDialog'), -1);
  assert.doesNotMatch(sheet, /SHARE_CANCEL_LABEL/);
  assert.match(DIALOG.slice(DIALOG.indexOf('export function ShareMenu')), /SHARE_CANCEL_LABEL/);
  // Sluiten gaat met het kruisje (44 × 44 px, met een naam), Esc of een tik
  // naast het paneel.
  assert.match(DIALOG, /className="share-close" aria-label=\{SHARE_CLOSE_LABEL\} onClick=\{onClose\}/);
  assert.match(cssBlockOf(DIALOG_CSS, '.share-close'), /width: 44px[\s\S]*height: 44px/);
  assert.match(DIALOG, /if \(event\.target === event\.currentTarget\) onClose\(\)/);
});

test('BE-61: de vijf manieren hebben een eigen lijnicoon, zonder merklogo', () => {
  for (const method of ['whatsapp', 'copy', 'sms', 'telegram', 'email']) {
    assert.match(DIALOG, new RegExp(`^  ${method}:`, 'm'), method);
  }
  assert.match(DIALOG, /stroke="currentColor"/);
  assert.match(DIALOG, /aria-hidden="true"/);
  // Geen gevulde merktekens en geen externe afbeelding of icoonpakket.
  assert.doesNotMatch(code(DIALOG), /fill="(?!none)[^"]+"|<img|@fortawesome|lucide/);
  assert.match(cssBlockOf(DIALOG_CSS, '.share-fav-icon'), /width: 20px/);
});

test('"Delen via" staat naast de themakeuze op elke publieke pagina', () => {
  for (const file of PUBLIC_HEADERS) {
    const source = read(file);
    assert.match(source, /import ShareSettingsButton from '@\/src\/components\/ShareSettingsButton'/, file);
    assert.match(source, /<ThemeToggle \/>\s*<ShareSettingsButton \/>/, `${file}: naast de themakeuze`);
  }
  assert.match(SETTINGS, /\{SHARE_SETTINGS_LABEL\}/);
  assert.match(SETTINGS, /mode="settings"/);
  assert.match(SETTINGS, /aria-expanded=\{open\}/);
});

test('de voorkeur gaat alleen naar localStorage, zonder cookie of netwerk', () => {
  for (const source of [SHARE_BUTTON, SAVE_BUTTON, DIALOG, SETTINGS, LIB]) {
    assert.doesNotMatch(code(source), /document\.cookie/);
    assert.doesNotMatch(code(source), /sessionStorage/);
    assert.doesNotMatch(code(source), /XMLHttpRequest|sendBeacon/);
  }
  // De teller is de enige keer dat er iets de deur uit gaat, en die kent alleen
  // dish en event — de gekozen manier nooit.
  assert.match(SHARE_BUTTON, /void sendDishCounter\(\{ dish, event: SHARED_EVENT \}\)/);
  assert.doesNotMatch(SHARE_BUTTON, /sendDishCounter\(\{[^}]*method/);
  assert.match(LIB, /SHARE_PREFERENCE_KEY = 'deelvoorkeur'/);
  // De link per manier: alleen de url (en bij e-mail het onderwerp).
  assert.match(LIB, /https:\/\/wa\.me\/\?text=\$\{encoded\}/);
  assert.match(LIB, /https:\/\/t\.me\/share\/url\?url=\$\{encoded\}/);
  assert.match(LIB, /sms:\?&body=\$\{encoded\}/);
  assert.match(LIB, /mailto:\?subject=\$\{subject\}&body=\$\{encoded\}/);
});

test('de nieuwe CSS gebruikt alleen tokens en respecteert prefers-reduced-motion', () => {
  const start = CSS.indexOf('/* ── BE-49 (issue 115) — het deelblad');
  assert.notEqual(start, -1, 'de BE-49-CSS staat niet in app/globals.css');
  const block = CSS.slice(start, CSS.indexOf('@keyframes share-panel-in'));
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, 'geen vaste kleur in de nieuwe CSS');
  assert.match(block, /var\(--bg-card\)/);
  assert.match(block, /var\(--text-secondary\)/);
  assert.match(block, /var\(--button-primary-bg\)/);
  assert.match(CSS, /@media \(prefers-reduced-motion: no-preference\) \{\s*\.share-panel \{ animation: share-panel-in/);
  // Op de telefoon een bottom sheet, op een breed scherm een klein dialoog.
  assert.match(CSS, /@media \(min-width: 721px\) \{\s*\.share-layer \{ align-items: center; \}/);
  assert.match(cssBlock('.share-layer'), /position: fixed/);
  assert.match(cssBlock('.share-layer'), /z-index: 150/);
});

test('de deeplinks en de OG-afbeeldingen zijn niet aangeraakt', () => {
  const shareImage = read('app/menu/[id]/share-image/route.js');
  assert.match(shareImage, /width: 1200, height: 630/);
  // De deellink komt nog steeds uit absoluteShareUrl (BE-44), niet uit een
  // tweede opbouw in dit ticket.
  assert.match(SHARE_BUTTON, /absoluteShareUrl\(\{/);
  assert.match(read('src/lib/dishShare.js'), /buildDishDeepLink/);
});

