'use strict';

// BE-69 (#172, acceptatie 1) — de teksten van /privacy en /colofon staan
// letterlijk in src/lib/legalCopy.js.
//
// Deze test vergelijkt elke sectie met de tekst uit het contract. Hij faalt dus
// ook bij een "verbeterde" zin: de tekst mag niet herschreven worden en een
// twijfel hoort in het checkpoint, niet in een stille aanpassing.
//
// Daarnaast: LEGAL_PLACEHOLDERS is compleet (elke [...] in de tekst staat in de
// lijst en andersom), en de twee verboden formuleringen komen nergens voor.

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  COLOFON,
  COLOFON_HREF,
  LEGAL_PLACEHOLDERS,
  LOGIN_PRIVACY_LINK,
  PRIVACY,
  PRIVACY_HREF,
} = require('./legalCopy');

/** Elke tekst uit het document als "sectiekop :: tekst", in leesvolgorde. */
function textsOf(document) {
  const lines = [];
  for (const section of document.sections) {
    for (const block of section.blocks) {
      if (block.type === 'list') {
        for (const item of block.items) lines.push(`${section.heading} :: ${item}`);
      } else {
        lines.push(`${section.heading} :: ${block.text}`);
      }
    }
  }
  return lines;
}

/** Alle strings in het object, ook in geneste lijsten. */
function stringsOf(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const item of value) stringsOf(item, out);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) stringsOf(item, out);
  return out;
}

test('de twee pagina\'s hebben het pad uit het contract', () => {
  assert.equal(PRIVACY_HREF, '/privacy');
  assert.equal(COLOFON_HREF, '/colofon');
  assert.equal(PRIVACY.href, PRIVACY_HREF);
  assert.equal(COLOFON.href, COLOFON_HREF);
});

test('de privacyverklaring heeft kop, datum en intro uit het contract', () => {
  assert.equal(PRIVACY.title, 'Privacy');
  assert.equal(PRIVACY.updated, 'Laatst bijgewerkt: [DATUM]');
  assert.equal(
    PRIVACY.intro,
    'Onze Menukaarten laat zien wat je vanavond kunt eten, waar en voor welke prijs. We willen zo weinig mogelijk over je weten. Hieronder staat precies wat we bewaren, waarom, en hoe lang.',
  );
});

test('de privacyverklaring heeft de acht secties, in de volgorde van het contract', () => {
  assert.deepEqual(PRIVACY.sections.map((section) => section.heading), [
    'Wie zijn wij',
    'Als bezoeker',
    'Samen kiezen (stemmen)',
    'Daghap: "laat het me weten"',
    'Als restauranthouder',
    'Wie helpt ons',
    'Je rechten',
    'Wijzigingen',
  ]);
});

test('de privacyverklaring bevat elke alinea en elk lijstitem letterlijk', () => {
  assert.deepEqual(textsOf(PRIVACY), [
    'Wie zijn wij :: Onze Menukaarten is een dienst van [NAAM ORGANISATIE], [ADRES], KvK [KVK-NUMMER]. Vragen over privacy stel je via [E-MAILADRES].',
    'Als bezoeker :: Je hebt geen account nodig. We vragen je niet om je naam of e-mailadres.',
    'Als bezoeker :: In je eigen browser bewaren we je lijstje, je themakeuze (licht of donker), je deelvoorkeur en of je een tip al gezien hebt. Dit staat alleen op je eigen toestel. Wij kunnen het niet inzien. Je wist het door de websitegegevens in je browser te wissen.',
    'Als bezoeker :: Tellers. We tellen hoe vaak een gerecht of restaurant bekeken, bewaard of gedeeld wordt, per dag. We bewaren daarbij geen IP-adres, geen account en niets dat naar jou leidt. Alleen het totaal per dag.',
    'Als bezoeker :: Cookies. We gebruiken geen cookies om je te volgen en geen advertentiecookies. Daarom vragen we ook geen toestemming voor cookies.',
    'Samen kiezen (stemmen) :: Start je een stemming of stem je mee, dan bewaren we:',
    'Samen kiezen (stemmen) :: de gekozen gerechten;',
    'Samen kiezen (stemmen) :: de roepnaam die je zelf invult (die mag verzonnen zijn);',
    'Samen kiezen (stemmen) :: een willekeurig kenmerk van je browser, zodat je niet twee keer stemt;',
    'Samen kiezen (stemmen) :: je stemmen.',
    'Samen kiezen (stemmen) :: We bewaren geen e-mailadres en geen IP-adres. Een stemming en alle stemmen worden na 7 dagen automatisch verwijderd.',
    'Daghap: "laat het me weten" :: Vraag je bij een daghap om een melding, dan bewaren we alleen een willekeurig kenmerk van je browser bij die daghap. Zo telt je melding één keer. Er hoort geen naam of e-mailadres bij.',
    'Als restauranthouder :: Log je in om je restaurant te beheren, dan bewaren we:',
    'Als restauranthouder :: je e-mailadres, om je een inlogcode te sturen;',
    'Als restauranthouder :: welk restaurant je beheert, en de gegevens van je aanvraag (het e-mailadres van de aanvraag en of het bij het restaurant past);',
    'Als restauranthouder :: wat je aanpast aan je aanbod, met het tijdstip.',
    'Als restauranthouder :: Je blijft ingelogd via een cookie die nodig is om in te loggen. Dat is een functionele cookie, geen volgcookie. We bewaren deze gegevens zolang je account bestaat. Je verwijdert je account zelf in Mijn restaurant; daarna wissen we je gegevens. Wat je aan je restaurant hebt bijgedragen, zoals een prijs op de menukaart, blijft staan zonder je naam.',
    'Wie helpt ons :: Vercel host de website.',
    'Wie helpt ons :: Supabase bewaart de gegevens en verstuurt de inlogcodes.',
    'Wie helpt ons :: Zij verwerken gegevens alleen in onze opdracht. [REGIO VAN OPSLAG]. We verkopen geen gegevens en delen ze niet met adverteerders.',
    'Je rechten :: Je mag vragen welke gegevens we van je hebben, en ze laten verbeteren of verwijderen. Je mag ook bezwaar maken. Mail naar [E-MAILADRES]; we reageren binnen een maand. Ben je het niet met ons eens, dan kun je een klacht indienen bij de Autoriteit Persoonsgegevens.',
    'Wijzigingen :: Als we deze verklaring aanpassen, staat de nieuwe datum bovenaan.',
  ]);
});

test('het colofon heeft de vijf secties, in de volgorde van het contract', () => {
  assert.equal(COLOFON.title, 'Colofon');
  assert.deepEqual(COLOFON.sections.map((section) => section.heading), [
    'Over Onze Menukaarten',
    'Waar de gegevens vandaan komen',
    'Klopt er iets niet?',
    'Contact',
    'Privacy',
  ]);
});

test('het colofon bevat elke alinea letterlijk, met de verwijzing naar /privacy', () => {
  assert.deepEqual(textsOf(COLOFON), [
    'Over Onze Menukaarten :: Onze Menukaarten helpt je kiezen wat je vanavond eet in Breda: per gerecht, met de prijs erbij. Het is een dienst van [NAAM ORGANISATIE], [ADRES], KvK [KVK-NUMMER].',
    'Waar de gegevens vandaan komen :: Menukaarten en prijzen komen van de eigen websites en menukaarten van restaurants, en van restauranthouders zelf. Locatiegegevens komen deels van OpenStreetMap (© OpenStreetMap-bijdragers, beschikbaar onder de Open Database License). Bij elk restaurant staat waar de menukaart vandaan komt.',
    'Klopt er iets niet? :: Prijzen en gerechten kunnen veranderen. We doen ons best, maar kunnen niet garanderen dat alles altijd klopt. Ziet je iets dat niet klopt? Mail naar [E-MAILADRES]. Ben je de eigenaar van het restaurant? Via "Voor restaurants" beheer je je eigen gegevens.',
    'Contact :: [E-MAILADRES]',
    'Privacy :: Lees onze privacyverklaring.',
  ]);

  const privacySection = COLOFON.sections.find((section) => section.id === 'privacy');
  const linkBlock = privacySection.blocks[0];
  assert.deepEqual({ ...linkBlock.link }, { text: 'privacyverklaring', href: '/privacy' });
});

test('LEGAL_PLACEHOLDERS is compleet: elke [...] in de tekst staat in de lijst en andersom', () => {
  const inText = new Set();
  for (const text of [...stringsOf(PRIVACY), ...stringsOf(COLOFON)]) {
    for (const match of text.match(/\[[^\]]+\]/g) || []) inText.add(match);
  }
  const found = [...inText].sort();
  assert.deepEqual(found, LEGAL_PLACEHOLDERS.slice().sort(), 'dezelfde placeholders, geen enkele erbij en geen enkele vergeten');

  // De placeholders staan er ook echt, letterlijk, en zijn niet weggepoetst.
  const alleTekst = [...stringsOf(PRIVACY), ...stringsOf(COLOFON)].join(' ');
  for (const placeholder of LEGAL_PLACEHOLDERS) {
    assert.ok(alleTekst.includes(placeholder), `${placeholder} staat letterlijk in de tekst`);
  }
  // [E-MAILADRES] staat op vier plekken: bij "Wie zijn wij" en "Je rechten" in
  // de verklaring, en in het colofon bij "Klopt er iets niet?" en "Contact".
  assert.equal((alleTekst.match(/\[E-MAILADRES\]/g) || []).length, 4);
});

test('de verboden formuleringen komen nergens voor', () => {
  const alleTekst = [...stringsOf(PRIVACY), ...stringsOf(COLOFON)].join('\n').toLowerCase();
  assert.equal(alleTekst.includes('eu-wetgeving'), false);
  assert.equal(alleTekst.includes('voldoet aan'), false);
});

test('de link naast de e-mailcode op /inloggen hoort bij de privacyverklaring', () => {
  assert.deepEqual({ ...LOGIN_PRIVACY_LINK }, { label: 'Wat we met je e-mailadres doen', href: '/privacy' });
});

test('beide documenten hebben metadata met een titel en een beschrijving', () => {
  for (const document of [PRIVACY, COLOFON]) {
    assert.ok(document.metadata.title.includes('Onze Menukaarten'), `${document.title} heeft een titel`);
    assert.ok(document.metadata.description.length > 40, `${document.title} heeft een echte beschrijving`);
  }
});
