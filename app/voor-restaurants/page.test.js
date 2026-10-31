'use strict';

// BE-64 (#156) — bronregressie op /voor-restaurants volgens het goedgekeurde
// ontwerp en het contract van issue #156.
//
// Zelfde conventie als app/inloggen/page.test.js: fs + regex op de bron, geen
// React en geen browser. De echte meting (licht en donker op 1280, 390 en
// 320 px) staat in ops/browser/run-be64-browser-check.js.
//
// Wat hier vastligt:
//   - de teksten uit het contract, uit één bron (src/lib/forRestaurantsCopy.js);
//   - geen verboden claims over de allergenen ("voldoet", "compliant",
//     "gecertificeerd", "gegarandeerd", "keuring", "NVWA-goedgekeurd");
//   - het label "Binnenkort" bij het QR-kaartje;
//   - de knoppen naar claimen en inloggen, en de knop naar een bestaand
//     /nvwa/[id]-voorbeeld;
//   - geen client-JS in de pagina zelf, geen afbeeldingen, geen dependency;
//   - de sitemap blijft dicht zolang de site niet publiek is.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

const PAGE = 'app/voor-restaurants/page.js';
const CSS = 'app/voor-restaurants/voor-restaurants.css';
const COPY = 'src/lib/forRestaurantsCopy.js';

const {
  FOR_RESTAURANTS,
  FOR_RESTAURANTS_HREF,
  NVWA_PREVIEW_RESTAURANT_ID,
} = require('../../src/lib/forRestaurantsCopy');

test('de pagina is een Server Component met een eigen stylesheet', () => {
  const source = read(PAGE);
  assert.doesNotMatch(source, /^'use client'/m, 'geen clientcomponent nodig');
  assert.match(source, /^import '\.\/voor-restaurants\.css'$/m);
  assert.ok(fs.existsSync(path.join(ROOT, CSS)), 'het stylesheet staat naast de pagina (BE-52)');
});

test('de pagina leest de teksten uit src/lib/forRestaurantsCopy.js en niets zelf verzonnen', () => {
  const source = read(PAGE);
  assert.match(source, /import \{ FOR_RESTAURANTS \} from '@\/src\/lib\/forRestaurantsCopy'/);
  for (const field of [
    'FOR_RESTAURANTS.title',
    'FOR_RESTAURANTS.intro',
    'FOR_RESTAURANTS.primary.href',
    'FOR_RESTAURANTS.primary.label',
    'FOR_RESTAURANTS.secondary.href',
    'FOR_RESTAURANTS.secondary.label',
    'FOR_RESTAURANTS.micro',
    'FOR_RESTAURANTS.preview.eyebrow',
    'FOR_RESTAURANTS.preview.empty',
    'FOR_RESTAURANTS.preview.caption',
    'FOR_RESTAURANTS.featuresTitle',
    'FOR_RESTAURANTS.allergens.title',
    'FOR_RESTAURANTS.allergens.body',
    'FOR_RESTAURANTS.allergens.actionLabel',
    'FOR_RESTAURANTS.allergens.previewHref',
  ]) {
    assert.ok(source.includes(`{${field}}`), `${field} komt uit de gedeelde bron`);
  }
  assert.equal(FOR_RESTAURANTS_HREF, '/voor-restaurants');
});

test('de contractteksten staan er letterlijk, uit één bron', () => {
  assert.equal(FOR_RESTAURANTS.title, 'Gasten zoeken op gerecht. Zorg dat ze jóuw kaart vinden.');
  assert.equal(
    FOR_RESTAURANTS.intro,
    'Op onze menukaarten zoekt Breda op wat ze willen eten, met prijs erbij. Beheer zelf je kaart, je prijzen en je daghap, en zie wat gasten interessant vinden.',
  );
  assert.equal(FOR_RESTAURANTS.primary.label, 'Claim je restaurant');
  assert.equal(FOR_RESTAURANTS.secondary.label, 'Ik heb al een account');
  assert.equal(FOR_RESTAURANTS.micro, 'Claimen kost niets · inloggen met een e-mailcode, zonder wachtwoord');
  assert.equal(FOR_RESTAURANTS.featuresTitle, 'Wat je krijgt');
  assert.equal(FOR_RESTAURANTS.features.length, 6);
  assert.deepEqual(
    FOR_RESTAURANTS.features.map((feature) => feature.title),
    [
      'Gevonden op gerecht',
      'Zelf prijzen aanpassen',
      'Daghap en seizoen',
      'Zien wat werkt',
      'Gasten delen je gerechten',
      'QR-kaartje op tafel',
    ],
  );
  assert.equal(
    FOR_RESTAURANTS.features[0].body,
    'Wie "mosselen" of "pasta onder €15" zoekt, ziet jouw gerechten met prijs. Niet alleen je naam.',
  );
  assert.equal(FOR_RESTAURANTS.allergens.title, 'Allergenenoverzicht om te downloaden');
  assert.match(FOR_RESTAURANTS.allergens.body, /14 allergenen uit EU-verordening 1169\/2011/);
  assert.match(FOR_RESTAURANTS.allergens.body, /momentopname van wat je zelf hebt ingevuld/);
  assert.match(FOR_RESTAURANTS.allergens.body, /Jij blijft verantwoordelijk voor de juistheid/);
  assert.equal(FOR_RESTAURANTS.allergens.actionLabel, 'Bekijk een voorbeeld');
});

test('de metadata is de titel en de korte description uit het contract', () => {
  const source = read(PAGE);
  assert.match(source, /export const metadata = \{/);
  assert.match(source, /title: FOR_RESTAURANTS\.metadata\.title/);
  assert.match(source, /description: FOR_RESTAURANTS\.metadata\.description/);
  assert.equal(FOR_RESTAURANTS.metadata.title, 'Voor restaurants · onze menukaarten');
  assert.ok(FOR_RESTAURANTS.metadata.description.length > 40);
  assert.ok(FOR_RESTAURANTS.metadata.description.length <= 160, 'een korte description');
  // Noindex blijft gelden (middleware/app/robots.js); geen eigen robots-tags.
  assert.doesNotMatch(source, /robots\s*:/i);
});

test('geen verboden claim over allergenen, ook niet in de metadata', () => {
  // Het taalbeleid van src/lib/nvwaComplianceCopy.test.js: de site keurt niet,
  // certificeert niet en garandeert geen wettelijke naleving.
  const forbidden = /voldoet|compliant|gecertificeerd|gegarandeerd|keuring|NVWA-goedgekeurd/i;
  for (const file of [PAGE, COPY]) {
    const source = read(file);
    const match = source.match(forbidden);
    assert.equal(match, null, `${file} bevat een verboden claim: ${match && match[0]}`);
  }
  assert.doesNotMatch(FOR_RESTAURANTS.metadata.description, forbidden);
  assert.doesNotMatch(FOR_RESTAURANTS.allergens.body, forbidden);
});

test('het QR-kaartje draagt het label "Binnenkort"', () => {
  const source = read(PAGE);
  const qr = FOR_RESTAURANTS.features.find((feature) => feature.key === 'qr');
  assert.ok(qr, 'de zesde kaart is het QR-kaartje');
  assert.equal(FOR_RESTAURANTS.soonLabel, 'Binnenkort');
  assert.equal(qr.soon, true);
  assert.equal(
    FOR_RESTAURANTS.features.filter((feature) => feature.soon).length,
    1,
    'alleen het QR-kaartje is "Binnenkort"',
  );
  assert.match(source, /feature\.soon \? <span className="vr-soon">\{FOR_RESTAURANTS\.soonLabel\}<\/span> : null/);
  assert.match(read(CSS), /\.vr-soon \{/);
});

test('de knoppen gaan naar claimen en inloggen, twee keer op de pagina', () => {
  assert.equal(FOR_RESTAURANTS.primary.href, '/mijn-restaurant/claimen');
  assert.equal(FOR_RESTAURANTS.secondary.href, '/inloggen');
  const source = read(PAGE);
  assert.match(source, /function StartActions\(\{ className \}\)/);
  assert.match(source, /className="vr-cta-primary" href=\{FOR_RESTAURANTS\.primary\.href\}/);
  assert.match(source, /className="vr-cta-secondary" href=\{FOR_RESTAURANTS\.secondary\.href\}/);
  const used = source.match(/<StartActions className="vr-actions" \/>/g) || [];
  assert.equal(used.length, 2, 'de hero en het blok onderaan');
});

test('het allergenenblok linkt naar een bestaand /nvwa/[id]-voorbeeld met allergenen', () => {
  const restaurants = require('../../data/restaurants.json');
  const menus = require('../../data/menus.json');
  assert.ok(restaurants[NVWA_PREVIEW_RESTAURANT_ID], `restaurant ${NVWA_PREVIEW_RESTAURANT_ID} bestaat`);
  // Het voorbeeld moet gevulde allergenen hebben, anders is het een lege matrix.
  let known = 0;
  let total = 0;
  for (const [key, menu] of Object.entries(menus)) {
    if (!key.startsWith(`${NVWA_PREVIEW_RESTAURANT_ID}-`)) continue;
    for (const category of menu.categories || []) {
      for (const item of category.items || []) {
        total += 1;
        if (Array.isArray(item.allergens) && item.allergens.length > 0) known += 1;
      }
    }
  }
  assert.ok(total > 0, 'het restaurant heeft gerechten');
  assert.ok(known > 0, 'het voorbeeld heeft ingevulde allergenen');
  assert.equal(FOR_RESTAURANTS.allergens.previewHref, `/nvwa/${NVWA_PREVIEW_RESTAURANT_ID}`);
  const source = read(PAGE);
  assert.match(
    source,
    /className="vr-cta-secondary vr-allergens-action" href=\{FOR_RESTAURANTS\.allergens\.previewHref\}/,
  );
});

test('het weekoverzicht is voorbeeldwerk: geen cijfers, wel "—" en de uitleg', () => {
  assert.equal(FOR_RESTAURANTS.preview.empty, '—');
  assert.deepEqual(
    FOR_RESTAURANTS.preview.stats.map((stat) => stat.label),
    ['keer in de top', 'keer bekeken', 'keer bewaard', 'keer gedeeld'],
  );
  assert.equal(FOR_RESTAURANTS.preview.caption, 'Voorbeeld van je eigen overzicht in Mijn restaurant');
  const source = read(PAGE);
  assert.match(source, /\{FOR_RESTAURANTS\.preview\.stats\.map\(\(stat\) => \(/);
  // Geen enkel cijfer in de labels van het voorbeeld.
  const preview = FOR_RESTAURANTS.preview.stats.map((stat) => stat.label).join(' ');
  assert.doesNotMatch(preview, /\d/);
});

test('de kop is de gedeelde publieke kop, met het navigatielandmark', () => {
  const source = read(PAGE);
  assert.match(source, /import PublicHeaderActions from '@\/src\/components\/PublicHeaderActions'/);
  assert.match(source, /<PublicHeaderActions \/>/);
  assert.match(source, /<nav className="vr-nav" aria-label="Naar de site">\s*<Wordmark \/>\s*<\/nav>/);
  assert.match(read(CSS), /\.vr-nav \{[^}]*display: flex/);
});

test('de pagina bevat geen client-JS, geen afbeeldingen en geen nieuwe dependency', () => {
  const source = read(PAGE);
  assert.doesNotMatch(source, /useState|useEffect|onClick|localStorage|document\.|window\./);
  assert.doesNotMatch(source, /<img|next\/image|background-image/);
  assert.doesNotMatch(source, /supabase|fetch\(/i);
  const imports = source.match(/^import .+$/gm) || [];
  assert.deepEqual(
    imports.map((line) => line.trim()),
    [
      "import Link from 'next/link'",
      "import { FOR_RESTAURANTS } from '@/src/lib/forRestaurantsCopy'",
      "import PublicFooter from '@/src/components/PublicFooter'",
      "import PublicHeaderActions from '@/src/components/PublicHeaderActions'",
      "import Wordmark from '@/src/components/Wordmark'",
      "import './voor-restaurants.css'",
    ],
    'alleen bestaande, eigen onderdelen',
  );
  // De iconen zijn inline SVG (geen afbeelding, geen externe set).
  assert.match(source, /<svg[\s\S]{0,400}stroke="currentColor"/);
  assert.equal((source.match(/const ICONS = \{/g) || []).length, 1);
});

test('de opmaak gebruikt alleen tokens en geen harde kleuren', () => {
  const rules = read(CSS).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(rules, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(rules, /\b(rgb|rgba|hsl|hsla)\(/);
  assert.match(rules, /\.vr-cta-primary \{[^}]*background: var\(--button-primary-bg\)/, 'de primaire knop uit het ontwerp');
  assert.match(rules, /\.vr-preview \{[^}]*background: var\(--bg-elevated\)/, 'het weekoverzicht op --bg-elevated');
  assert.match(rules, /\.vr-allergens \{[^}]*background: var\(--bg-elevated\)/, 'het allergenenblok op --bg-elevated');
  assert.match(rules, /\.vr-feature-icon \{[^}]*color: var\(--accent\)/, 'de iconen in --accent');
  assert.match(rules, /min-height: 44px/, 'grote tikvlakken');
  assert.match(rules, /@media \(min-width: 1000px\)/, 'twee kolommen op desktop');
});

test('de sitemap en robots blijven dicht, ook voor deze pagina', () => {
  const seo = require('../../src/lib/seo');
  assert.equal(seo.isIndexable(undefined), false);
  assert.equal(seo.isIndexable(''), false);
  assert.equal(seo.isIndexable('true'), true);
  // De pagina komt niet in de sitemap: alleen de vaste publieke paden, elke
  // restaurantpagina en elke menukaart, en niets anders.
  const entries = seo.sitemapEntries({ siteUrl: 'https://example.test', restaurants: [], menus: [] });
  assert.deepEqual(entries.map((entry) => entry.url), seo.PUBLIC_PATHS.map((p) => `https://example.test${p}`));
  assert.equal(entries.some((entry) => entry.url.includes('/voor-restaurants')), false);
  assert.equal(seo.PUBLIC_PATHS.includes('/voor-restaurants'), false);
});


