'use strict';

// BE-59 (#146, punt 3) — de footerlink "Voor restaurants · Inloggen" onderaan
// de publieke pagina's, en de ene ingang waar hij heen gaat.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

// De publieke pagina's: precies de koppen waar ook het accountmenu staat.
const PUBLIC_PAGES = [
  'app/HomeView.js',
  'app/search/page.js',
  'app/alle-restaurants/page.js',
  'app/restaurant/[id]/RestaurantDetailView.js',
  'app/menu/[id]/MenuView.js',
  'app/mijn-lijstje/MijnLijstjeView.js',
];

test('de footer toont de contracttekst en gaat naar /inloggen', () => {
  const source = read('src/components/PublicFooter.js');
  const { LOGIN_PAGE_HREF } = require('../lib/loginEntry');
  assert.equal(LOGIN_PAGE_HREF, '/inloggen');
  assert.match(source, /const LOGIN_HREF = '\/inloggen'/, 'dezelfde bestemming als de ene ingang');
  assert.match(source, /href=\{LOGIN_HREF\}/);
  assert.match(source, /Voor restaurants · Inloggen/);
  assert.match(source, /^import '\.\/public-footer\.css'$/m);
  assert.ok(fs.existsSync(path.join(ROOT, 'src/components/public-footer.css')));
});

test('de footer heeft geen sessiecheck nodig: geen Supabase, geen opslag, geen verzoek', () => {
  const source = read('src/components/PublicFooter.js');
  const imports = source.match(/^import .+$/gm) || [];
  assert.deepEqual(
    imports.map((line) => line.trim()),
    ["import Link from 'next/link'", "import './public-footer.css'"],
    'alleen next/link en de eigen CSS: niets extra in de eerste lading',
  );
  assert.doesNotMatch(source, /supabase|fetch\(|localStorage|useEffect/i);
});

test('elke publieke pagina met een kop toont de footer', () => {
  for (const file of PUBLIC_PAGES) {
    const source = read(file);
    assert.match(source, /import PublicFooter from '@\/src\/components\/PublicFooter'/, `${file} importeert de footer`);
    assert.match(source, /<PublicFooter \/>/, `${file} toont de footer`);
  }
});

test('de footer staat in de DOM na de inhoud (na </main>)', () => {
  for (const file of PUBLIC_PAGES) {
    const source = read(file);
    const main = source.lastIndexOf('</main>');
    const footer = source.indexOf('<PublicFooter />');
    assert.ok(main > 0 && footer > main, `${file} zet de footer onder de inhoud`);
  }
});

test('de opmaak gebruikt alleen tokens, met een tikvlak van 44 px', () => {
  const css = read('src/components/public-footer.css');
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(rules, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(rules, /\b(rgb|rgba|hsl|hsla)\(/);
  assert.match(rules, /\.public-footer-link \{[^}]*min-height: 44px;/);
});
