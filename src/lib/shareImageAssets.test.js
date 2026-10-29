'use strict';

// BE-44 (#105) — het bold font van de voorvertoningsafbeeldingen.
//
// De Lead-opdracht vraagt één vet font, in de repo, als subset van ≤ 150 kB, met
// de licentie erbij, zonder npm-dependency en zonder dat het ooit op een gewone
// pagina meelaadt. Deze test bewijst precies dat, plus dat alleen de
// og:image-routes het bestand lezen.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const FONT_PATH = path.join(ROOT, 'assets', 'fonts', 'NotoSans-Bold-latin.ttf');
const LICENSE_PATH = path.join(ROOT, 'assets', 'fonts', 'OFL.txt');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

/** Alle .js-bestanden onder app/, zodat de importeur-telling echt is. */
function appFiles(dir = path.join(ROOT, 'app')) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      out.push(...appFiles(full));
    } else if (entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

test('het bold font staat in de repo, is een echte TTF en blijft onder 150 kB', () => {
  assert.ok(fs.existsSync(FONT_PATH), 'assets/fonts/NotoSans-Bold-latin.ttf ontbreekt');
  const buffer = fs.readFileSync(FONT_PATH);
  assert.ok(buffer.length > 5000, 'een font van een paar kilobyte kan geen letters bevatten');
  assert.ok(buffer.length <= 150 * 1024, `het subset moet ≤ 150 kB zijn, nu ${buffer.length} bytes`);
  // Een TrueType-font begint met 0x00010000 (of 'true'/'OTTO').
  const magic = buffer.readUInt32BE(0);
  assert.ok(magic === 0x00010000 || magic === 0x4f54544f || buffer.toString('ascii', 0, 4) === 'true', `onbekende fontkop: ${magic.toString(16)}`);
});

test('de licentie van het font staat ernaast', () => {
  assert.ok(fs.existsSync(LICENSE_PATH), 'assets/fonts/OFL.txt ontbreekt');
  const license = fs.readFileSync(LICENSE_PATH, 'utf8');
  assert.match(license, /SIL Open Font License, Version 1\.1/);
  assert.match(license, /Copyright \d{4} The Noto Project Authors/);
});

test('het font wordt alleen door de og:image-routes gelezen, nooit door een pagina', () => {
  const importers = appFiles()
    .filter((file) => /app\/_share\/fonts['"]/.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(ROOT, file).replace(/\\/g, '/'));
  assert.ok(importers.length > 0, 'geen enkele route leest het font');
  for (const importer of importers) {
    assert.match(importer, /share-image\/route\.js$/, `${importer} hoort geen og:image-route te zijn`);
  }
  // Geen stylesheet en geen @font-face naar dit bestand: het laadt dus nooit
  // mee op een gewone pagina.
  const css = fs.readFileSync(path.join(ROOT, 'app', 'globals.css'), 'utf8');
  assert.doesNotMatch(css, /NotoSans|assets\/fonts/);
  const fontsModule = read('app/_share/fonts.js');
  assert.match(fontsModule, /readFile/);
  assert.match(fontsModule, /NotoSans-Bold-latin\.ttf/);
  assert.match(fontsModule, /SHARE_BOLD_FAMILY = 'Share Bold'/);
});

test('de voorvertoning van een gerecht gebruikt de vaste kaart, het bold font en de artboard-maten', () => {
  const route = read('app/menu/[id]/share-image/route.js');
  const card = read('app/_share/ShareCard.js');
  assert.match(route, /import ShareCard from '@\/app\/_share\/ShareCard'/);
  assert.match(route, /loadShareBoldFonts\(\)/);
  assert.match(route, /fonts,/);
  assert.match(route, /fontSize: '64px'/, 'de restaurantnaam is ±64 px');
  assert.match(route, /fontSize: '76px'/, 'het gerecht is ±76 px');
  assert.match(route, /fontSize: '46px'/, 'de prijs is ±46 px');
  assert.match(route, /fontSize: '30px'/, 'de beschrijving is ±30 px');
  assert.match(route, /fontFamily: SHARE_BOLD_FAMILY/, 'restaurant, gerecht en prijs staan vet');
  // Het "om"-blokje met --accent-fill/--on-accent-fill vóór "onze menukaarten",
  // rechtsonder.
  assert.match(card, /colors\.logo/);
  assert.match(card, /colors\.logoText/);
  const footer = card.slice(card.indexOf('justifyContent: \'flex-end\''));
  assert.ok(footer.indexOf('om') < footer.indexOf('onze menukaarten'), 'het blokje staat vóór de regel');
});
