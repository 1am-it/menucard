'use strict';

// BE-65 (#157, uitkomst 4) — het venster "Stuur je lijstje".
//
// Bronregressie (fs + regex), dezelfde conventie als de andere
// componenttests. Wat hier bewezen wordt:
//  - het venster komt achter "Versturen" en wordt nergens statisch geïmporteerd
//    (next/dynamic in de balk, dus buiten de eerste lading van / en /search);
//  - het is een echt dialoogvenster in een portal, met de focusregels van de
//    BE-61-vensters: focus erin, Tab blijft binnen, Esc sluit, focus terug;
//  - de gekozen gerechten komen uit de bestaande lijstje-opslag, met naam en
//    prijs;
//  - twee keuzekaarten als echte radio's in een fieldset, met "Gewoon delen" als
//    standaard;
//  - "Gewoon delen" deelt de lijstlink zoals ListShareButton; "Laat stemmen"
//    maakt eerst de stemlink en deelt pas daarna, en bij een fout gaat er niets
//    weg;
//  - de opmaak staat naast de component (BE-52), met alleen tokens, boven de
//    tabbalk en op desktop hooguit 440 px.
//
// Dit is ontwikkelaarsbewijs, geen browserbewijs.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

const DIALOG = read('src/components/SavedListSendDialog.js');
const CSS = read('src/components/saved-list-send.css');
const BAR = read('src/components/SavedDishesBar.js');

test('het venster laadt pas bij het openen en is nergens statisch geïmporteerd', () => {
  assert.match(DIALOG, /^'use client'/m);
  assert.match(BAR, /const SavedListSendDialog = dynamic\(\(\) => import\('\.\/SavedListSendDialog'\)/);
  assert.match(BAR, /\{sending \? <SavedListSendDialog open onClose=\{\(\) => setSending\(false\)\} \/> : null\}/);
  // Geen enkel ander bestand haalt het venster statisch binnen.
  const files = [];
  for (const folder of ['app', 'src/components', 'src/lib']) {
    for (const name of fs.readdirSync(path.join(ROOT, folder))) {
      if (name.endsWith('.js')) files.push(`${folder}/${name}`);
    }
  }
  const statisch = files.filter((file) => {
    const source = read(file);
    return /^import SavedListSendDialog from/m.test(source) ||
      /^import \{[^}]*SavedListSendDialog[^}]*\} from/m.test(source);
  });
  assert.deepEqual(statisch, []);
});

test('het is een dialoogvenster in een portal met de focusregels van BE-61', () => {
  assert.match(DIALOG, /import \{ createPortal \} from 'react-dom'/);
  assert.match(DIALOG, /createPortal\(\n\s+<div[\s\S]*?document\.body,\n\s+\)/);
  assert.match(DIALOG, /role="dialog"/);
  assert.match(DIALOG, /aria-modal="true"/);
  assert.match(DIALOG, /aria-labelledby="saved-send-titel"/);
  assert.match(DIALOG, /tabIndex=\{-1\}/);
  // Focus erin, Esc sluit, Tab blijft binnen, focus terug naar de opener.
  assert.match(DIALOG, /useDialogFocus\(open, panelRef, onClose\)/);
  assert.match(DIALOG, /const opener = document\.activeElement/);
  assert.match(DIALOG, /if \(event\.key === 'Escape'\) \{[\s\S]*?closeRef\.current\(\)/);
  assert.match(DIALOG, /if \(event\.shiftKey && document\.activeElement === items\[0\]\)/);
  assert.match(DIALOG, /else if \(!event\.shiftKey && document\.activeElement === last\)/);
  assert.match(DIALOG, /document\.contains\(opener\)\) opener\.focus\(\)/);
  // Een tik naast het paneel sluit het ook.
  assert.match(DIALOG, /if \(event\.target === event\.currentTarget\) onClose\(\)/);
});

test('de sluitknop is 44 bij 44 met aria-label "Sluiten"', () => {
  assert.match(DIALOG, /className="saved-send-close"[\s\S]*?aria-label=\{SEND_CLOSE_LABEL\}/);
  assert.match(CSS, /\.saved-send-close \{[\s\S]*?width: 44px;[\s\S]*?height: 44px;/);
  const send = require('../lib/savedListSend');
  assert.equal(send.SEND_CLOSE_LABEL, 'Sluiten');
});


test('de gerechten komen uit de bestaande lijstje-opslag, met naam en prijs', () => {
  assert.match(DIALOG, /import \{ dishCountLabel, listShareHref, readSavedList, safeBrowserStorage \} from '@\/src\/lib\/dishList'/);
  assert.match(DIALOG, /setEntries\(readSavedList\(safeBrowserStorage\(\)\)\)/);
  assert.match(DIALOG, /className="saved-send-dish-name">\{entry\.name\}/);
  assert.match(DIALOG, /className="saved-send-dish-price">\{entry\.price\}/);
});

test('twee keuzekaarten als radio\'s in een fieldset, standaard "Gewoon delen"', () => {
  assert.match(DIALOG, /const \[mode, setMode\] = useState\(SEND_PLAIN_MODE\)/);
  // Bij elk openen weer de standaardkeuze.
  assert.match(DIALOG, /setMode\(SEND_PLAIN_MODE\)\n\s+setMessage\(''\)/);
  assert.match(DIALOG, /<fieldset className="saved-send-modes">\n\s+<legend className="saved-send-legend">\{SEND_MODE_QUESTION\}<\/legend>/);
  assert.equal((DIALOG.match(/type="radio"/g) || []).length, 2);
  assert.equal((DIALOG.match(/name="saved-send-wijze"/g) || []).length, 2);
  assert.match(DIALOG, /value=\{SEND_PLAIN_MODE\}[\s\S]*?checked=\{mode === SEND_PLAIN_MODE\}/);
  assert.match(DIALOG, /value=\{SEND_VOTE_MODE\}[\s\S]*?checked=\{mode === SEND_VOTE_MODE\}/);
  assert.match(DIALOG, /\{SEND_PLAIN_LABEL\}<\/span>\n\s+<span className="saved-send-mode-hint">\{SEND_PLAIN_HINT\}/);
  assert.match(DIALOG, /\{SEND_VOTE_LABEL\}<\/span>\n\s+<span className="saved-send-mode-hint">\{SEND_VOTE_HINT\}/);
  // De gekozen kaart krijgt een rand van 2 px in --accent.
  assert.match(CSS, /\.saved-send-mode\.is-checked \{\n\s+border: 2px solid var\(--accent\);/);
});

test('"Gewoon delen" deelt de lijstlink zoals ListShareButton', () => {
  assert.match(DIALOG, /shareInput\.href = listShareHref\(\{ values: entries \}\)/);
  assert.match(DIALOG, /shareInput\.title = `Mijn lijstje · \$\{dishCountLabel\(entries\.length\)\}`/);
  // Dezelfde absolute link en dezelfde stand als de bestaande knop.
  assert.match(DIALOG, /const url = absoluteShareUrl\(\{/);
  assert.match(DIALOG, /const result = await performShare\(\{ \.\.\.shareInput, url \}\)/);
  // Geen nieuwe teller bij gewoon delen: precies zoals ListShareButton.
  const plain = DIALOG.indexOf('shareInput.href = listShareHref');
  const voteCount = DIALOG.indexOf('shareInput.count = () => {');
  assert.ok(voteCount > -1 && voteCount < plain, 'de teller staat alleen bij de stemming');
});

test('"Laat stemmen" maakt eerst de stemlink en deelt die daarna pas', () => {
  const vote = DIALOG.indexOf('if (normalizeSendMode(mode) === SEND_VOTE_MODE) {');
  const created = DIALOG.indexOf('const created = await createVoteLink({ dishKeys: entries.map((entry) => entry.id), theme })');
  const failed = DIALOG.indexOf('if (!created.ok) {');
  const share = DIALOG.indexOf('const result = await performShare({ ...shareInput, url })');
  assert.ok(vote > -1 && created > vote && failed > created && share > failed, 'de volgorde is maken, dan delen');
  // Bij een fout: de bestaande melding en meteen terug — er gaat niets weg.
  const guard = DIALOG.slice(failed, share);
  assert.match(guard, /setMessage\(created\.message\)/);
  assert.match(guard, /return/);
  assert.match(DIALOG, /shareInput\.title = voteTitle\(entries\.length\)/);
  assert.match(DIALOG, /shareInput\.href = created\.href/);
  // De grens van 12 wordt vóór de API gecontroleerd en gemeld.
  assert.match(DIALOG, /if \(tooManyForVote\(entries\.length\) && normalizeSendMode\(mode\) === SEND_VOTE_MODE\) \{\n\s+setMessage\(SEND_TOO_MANY_MESSAGE\)/);
  assert.match(DIALOG, /\{mode === SEND_VOTE_MODE && tooMany \? \(\n\s+<p className="saved-send-note">\{SEND_TOO_MANY_MESSAGE\}<\/p>/);
});

test('drie deelmanieren in een rij: de favorieten en "Meer…"', () => {
  assert.match(DIALOG, /const methods = sendMethods\(readSharePreference\(safeBrowserStorage\(\)\)\)/);
  assert.match(DIALOG, /<div className="saved-send-actions" role="group" aria-label="Delen via">/);
  assert.match(DIALOG, /\{methods\.map\(\(method\) => \(\n\s+<button[\s\S]*?\{sendMethodLabel\(method\)\}/);
  assert.match(CSS, /\.saved-send-actions \{\n\s+display: flex;/);
  // De laatste knop is "Meer…"; die krijgt het accent.
  assert.match(CSS, /\.saved-send-method:last-child \{[\s\S]*?background: var\(--accent-fill\);/);
  const send = require('../lib/savedListSend');
  assert.equal(send.sendMethods(null).length, 3);
  assert.equal(send.sendMethodLabel(send.sendMethods(null)[2]), 'Meer…');
});

test('de opmaak: een eigen bestand, alleen tokens, boven de tabbalk, 440 px', () => {
  assert.match(DIALOG, /import '\.\/saved-list-send\.css'/);
  assert.match(CSS, /\.saved-send-layer \{[\s\S]*?position: fixed;[\s\S]*?z-index: 150;/);
  assert.match(CSS, /\.saved-send-layer \{[\s\S]*?align-items: flex-end;[\s\S]*?padding: 12px 12px calc\(80px \+ env\(safe-area-inset-bottom\)\);/);
  assert.match(CSS, /\.saved-send-panel \{[\s\S]*?max-width: 440px;/);
  assert.match(CSS, /@media \(min-width: 721px\) \{[\s\S]*?\.saved-send-layer \{\n\s+align-items: center;/);
  const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(rules, /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(|gradient/);
  // De tabbalk staat op 120 en de balk op 119: het venster ligt erboven.
  assert.doesNotMatch(read('app/globals.css'), /\.saved-send-/);
});
