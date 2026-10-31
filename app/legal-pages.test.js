'use strict';

// BE-69 (#172, acceptatie 2) — de oppervlakte van /privacy en /colofon.
//
// Een bronregressie (fs + regex, de bestaande conventie in app/): de pagina's
// zijn statisch, hebben geen client-JS van zichzelf, geen afbeeldingen en geen
// eigen tekst. De opmaak gebruikt alleen tokens en staat in een eigen bestand
// naast de code (BE-52). Het echte beeld bewijst de browsercheck
// (ops/browser/run-be69-browser-check.js).
//
// Wat hier NIET bewezen wordt: het gerenderde beeld, de schermlezer en de
// a11y-run. Dat is developer-evidence uit de browsercheck, geen onafhankelijke
// review en geen productieacceptatie.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

const PAGES = [
  { file: 'app/privacy/page.js', document: 'PRIVACY', title: 'Privacy' },
  { file: 'app/colofon/page.js', document: 'COLOFON', title: 'Colofon' },
];

const USE_CLIENT = /^[ \t]*['"]use client['"];?[ \t]*$/m;

test('beide pagina\'s zijn statische Server Components zonder eigen client-JS', () => {
  for (const page of PAGES) {
    const source = read(page.file);
    assert.doesNotMatch(source, USE_CLIENT, `${page.file} is geen client-component`);
    assert.doesNotMatch(source, /\b(async|await|fetch\(|cookies\(|headers\(|searchParams)\b/, `${page.file} haalt niets op en is statisch (○)`);
    assert.match(source, /export const metadata = \{/, `${page.file} heeft metadata`);
    assert.match(source, new RegExp(`title: ${page.document}\\.metadata\\.title`), `${page.file} gebruikt de titel uit legalCopy`);
    assert.match(source, new RegExp(`description: ${page.document}\\.metadata\\.description`), `${page.file} gebruikt de beschrijving uit legalCopy`);
    assert.doesNotMatch(source, /<img\b|<Image\b/, `${page.file} heeft geen afbeeldingen`);
  }
});

test('de vorm staat in één component: h1, een h2 per sectie en geen eigen tekst', () => {
  const source = read('src/components/LegalDocument.js');
  assert.doesNotMatch(source, USE_CLIENT, 'de gedeelde vorm is een Server Component');
  assert.doesNotMatch(source, /<img\b|<Image\b/, 'geen afbeeldingen');
  assert.match(source, /<h1 className="legal-title">\{document\.title\}<\/h1>/);
  assert.match(source, /<h2 className="legal-section-title" id=\{`legal-\$\{section\.id\}`\}>/, 'elke sectie is een h2 met een id');
  assert.match(source, /aria-labelledby=\{`legal-\$\{section\.id\}`\}/, 'de sectie hangt aan zijn kop');
  assert.match(source, /<nav className="legal-nav" aria-label="Naar de site">/, 'het navigatielandmark van de publieke pagina\'s');
  // De koppen komen in de DOM in de volgorde van de tekst: eerst de h1, daarna
  // de h2 per sectie; de bron staat dus in die volgorde.
  assert.ok(source.indexOf('<h1') < source.indexOf('<h2'), 'de h1 staat vóór de h2\'s');
  // Geen eigen zinnen in dit bestand: alleen tekst uit het document.
  assert.doesNotMatch(source, /Onze Menukaarten|KvK|Autoriteit Persoonsgegevens/, 'de teksten komen uit src/lib/legalCopy.js');
});

test('de opmaak is een eigen bestand met alleen tokens, systeemlettertype en een smalle kolom', () => {
  const css = read('src/components/legal-document.css')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(fs.existsSync(path.join(ROOT, 'src/components/legal-document.css')));
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, 'geen hardgecodeerde kleur');
  assert.doesNotMatch(css, /\b(rgb|rgba|hsl|hsla)\(/, 'geen rgb()/hsl()-kleur');
  assert.doesNotMatch(css, /url\(/, 'geen afbeeldingen of externe bronnen');
  assert.match(css, /\.legal-main \{[^}]*max-width: 680px;/, 'een smalle kolom van ongeveer 680 px');
  assert.match(css, /\.legal-main \{[^}]*font-family: system-ui/, 'het systeemlettertype, net als /voor-restaurants');
  assert.match(css, /color: var\(--text-primary\)/, 'kleuren via de tokens');
  assert.doesNotMatch(read('app/globals.css'), /legal-section-title|legal-main/, 'app/globals.css blijft ongemoeid');
});

test('de footer heeft de twee nieuwe links en /inloggen verwijst naar de privacyverklaring', () => {
  const { PRIVACY_HREF, COLOFON_HREF, LOGIN_PRIVACY_LINK } = require('../src/lib/legalCopy');
  const footer = read('src/components/PublicFooter.js');
  assert.match(footer, new RegExp(`href=\\{PRIVACY_HREF\\} prefetch=\\{false\\}>\\s*Privacy\\s*<\\/Link>`));
  assert.match(footer, new RegExp(`href=\\{COLOFON_HREF\\} prefetch=\\{false\\}>\\s*Colofon\\s*<\\/Link>`));
  assert.equal(PRIVACY_HREF, '/privacy');
  assert.equal(COLOFON_HREF, '/colofon');

  const inloggen = read('app/inloggen/page.js');
  assert.match(inloggen, /import \{ LOGIN_PRIVACY_LINK \} from '@\/src\/lib\/legalCopy'/);
  assert.match(inloggen, /className="inloggen-privacy-link" href=\{LOGIN_PRIVACY_LINK\.href\}/);
  assert.match(inloggen, /\{LOGIN_PRIVACY_LINK\.label\}/);
  assert.equal(LOGIN_PRIVACY_LINK.href, PRIVACY_HREF);
  assert.equal(LOGIN_PRIVACY_LINK.label, 'Wat we met je e-mailadres doen');
});

test('de twee pagina\'s staan in de sitemap zoals de andere publieke pagina\'s', () => {
  const { PUBLIC_PATHS } = require('../src/lib/seo');
  assert.ok(PUBLIC_PATHS.includes('/privacy'));
  assert.ok(PUBLIC_PATHS.includes('/colofon'));
});
