'use strict';

// BE-69 (#172) — de twee publieke tekstpagina's /privacy en /colofon, als één
// geteste bron, net als src/lib/forRestaurantsCopy.js.
//
// Uitkomst 4 van het contract: de teksten staan op één plek en de pagina's
// renderen die zonder eigen tekst. De tekst zelf is een concept van de Lead dat
// de eigenaar vóór de lancering goedkeurt; hier staat hij letterlijk, zonder
// herschrijven, zodat een test kan bewijzen dat er niets is veranderd.
//
// Uitkomst 5: elke [...] in de tekst blijft letterlijk staan en staat in
// LEGAL_PLACEHOLDERS. De lanceringscheck kan daarmee melden wat nog open is
// (datum, organisatie, adres, KvK-nummer, e-mailadres en de regio van opslag).
// Een test faalt zodra er een placeholder bij komt die niet in die lijst staat.
//
// Geen 'use client' en geen eigen logica: dit bestand is platte tekst en wordt
// door de Server Components van beide pagina's gelezen.

const PRIVACY_HREF = '/privacy';
const COLOFON_HREF = '/colofon';

// De open gegevens, in de volgorde waarin ze in de teksten voorkomen.
const LEGAL_PLACEHOLDERS = Object.freeze([
  '[DATUM]',
  '[NAAM ORGANISATIE]',
  '[ADRES]',
  '[KVK-NUMMER]',
  '[E-MAILADRES]',
  '[REGIO VAN OPSLAG]',
]);

// De link naast het e-mailformulier op /inloggen (uitkomst 3). De tekst hoort
// bij de privacyverklaring en niet bij de inlogcopy, daarom staat hij hier.
const LOGIN_PRIVACY_LINK = Object.freeze({
  label: 'Wat we met je e-mailadres doen',
  href: PRIVACY_HREF,
});

const paragraph = (text) => Object.freeze({ type: 'paragraph', text });

// Een alinea waarin één woord naar een andere pagina leidt; de rest van de
// zin komt uit de tekst zelf.
const paragraphWithLink = (text, linkText, href) =>
  Object.freeze({ type: 'paragraph', text, link: Object.freeze({ text: linkText, href }) });

const list = (...items) => Object.freeze({ type: 'list', items: Object.freeze(items) });

// De eerste vier secties van de privacyverklaring; de rest staat eronder in
// PRIVACY_REST. Samen houden ze de volgorde van het contract aan.
const PRIVACY_START = Object.freeze({
  href: PRIVACY_HREF,
  metadata: Object.freeze({
    title: 'Privacy · Onze Menukaarten',
    description:
      'Wat Onze Menukaarten van je bewaart, waarom en hoe lang: als bezoeker, bij een stemming, bij een daghap en als restauranthouder.',
  }),
  title: 'Privacy',
  updated: 'Laatst bijgewerkt: [DATUM]',
  intro:
    'Onze Menukaarten laat zien wat je vanavond kunt eten, waar en voor welke prijs. We willen zo weinig mogelijk over je weten. Hieronder staat precies wat we bewaren, waarom, en hoe lang.',
  sections: Object.freeze([
    Object.freeze({
      id: 'wie-zijn-wij',
      heading: 'Wie zijn wij',
      blocks: Object.freeze([
        paragraph(
          'Onze Menukaarten is een dienst van [NAAM ORGANISATIE], [ADRES], KvK [KVK-NUMMER]. Vragen over privacy stel je via [E-MAILADRES].',
        ),
      ]),
    }),
    Object.freeze({
      id: 'als-bezoeker',
      heading: 'Als bezoeker',
      blocks: Object.freeze([
        paragraph('Je hebt geen account nodig. We vragen je niet om je naam of e-mailadres.'),
        list(
          'In je eigen browser bewaren we je lijstje, je themakeuze (licht of donker), je deelvoorkeur en of je een tip al gezien hebt. Dit staat alleen op je eigen toestel. Wij kunnen het niet inzien. Je wist het door de websitegegevens in je browser te wissen.',
          'Tellers. We tellen hoe vaak een gerecht of restaurant bekeken, bewaard of gedeeld wordt, per dag. We bewaren daarbij geen IP-adres, geen account en niets dat naar jou leidt. Alleen het totaal per dag.',
          'Cookies. We gebruiken geen cookies om je te volgen en geen advertentiecookies. Daarom vragen we ook geen toestemming voor cookies.',
        ),
      ]),
    }),
    Object.freeze({
      id: 'samen-kiezen',
      heading: 'Samen kiezen (stemmen)',
      blocks: Object.freeze([
        paragraph('Start je een stemming of stem je mee, dan bewaren we:'),
        list(
          'de gekozen gerechten;',
          'de roepnaam die je zelf invult (die mag verzonnen zijn);',
          'een willekeurig kenmerk van je browser, zodat je niet twee keer stemt;',
          'je stemmen.',
        ),
        paragraph(
          'We bewaren geen e-mailadres en geen IP-adres. Een stemming en alle stemmen worden na 7 dagen automatisch verwijderd.',
        ),
      ]),
    }),
    Object.freeze({
      id: 'daghap',
      heading: 'Daghap: "laat het me weten"',
      blocks: Object.freeze([
        paragraph(
          'Vraag je bij een daghap om een melding, dan bewaren we alleen een willekeurig kenmerk van je browser bij die daghap. Zo telt je melding één keer. Er hoort geen naam of e-mailadres bij.',
        ),
      ]),
    }),
  ]),
});

const PRIVACY_REST = Object.freeze([
  Object.freeze({
    id: 'als-restauranthouder',
    heading: 'Als restauranthouder',
    blocks: Object.freeze([
      paragraph('Log je in om je restaurant te beheren, dan bewaren we:'),
      list(
        'je e-mailadres, om je een inlogcode te sturen;',
        'welk restaurant je beheert, en de gegevens van je aanvraag (het e-mailadres van de aanvraag en of het bij het restaurant past);',
        'wat je aanpast aan je aanbod, met het tijdstip.',
      ),
      paragraph(
        'Je blijft ingelogd via een cookie die nodig is om in te loggen. Dat is een functionele cookie, geen volgcookie. We bewaren deze gegevens zolang je account bestaat. Je verwijdert je account zelf in Mijn restaurant; daarna wissen we je gegevens. Wat je aan je restaurant hebt bijgedragen, zoals een prijs op de menukaart, blijft staan zonder je naam.',
      ),
    ]),
  }),
  Object.freeze({
    id: 'wie-helpt-ons',
    heading: 'Wie helpt ons',
    blocks: Object.freeze([
      list('Vercel host de website.', 'Supabase bewaart de gegevens en verstuurt de inlogcodes.'),
      paragraph(
        'Zij verwerken gegevens alleen in onze opdracht. [REGIO VAN OPSLAG]. We verkopen geen gegevens en delen ze niet met adverteerders.',
      ),
    ]),
  }),
  Object.freeze({
    id: 'je-rechten',
    heading: 'Je rechten',
    blocks: Object.freeze([
      paragraph(
        'Je mag vragen welke gegevens we van je hebben, en ze laten verbeteren of verwijderen. Je mag ook bezwaar maken. Mail naar [E-MAILADRES]; we reageren binnen een maand. Ben je het niet met ons eens, dan kun je een klacht indienen bij de Autoriteit Persoonsgegevens.',
      ),
    ]),
  }),
  Object.freeze({
    id: 'wijzigingen',
    heading: 'Wijzigingen',
    blocks: Object.freeze([
      paragraph('Als we deze verklaring aanpassen, staat de nieuwe datum bovenaan.'),
    ]),
  }),
]);

// De volledige verklaring: kop, datum en de acht secties in de volgorde van het
// contract (#172).
const PRIVACY = Object.freeze({
  ...PRIVACY_START,
  sections: Object.freeze([...PRIVACY_START.sections, ...PRIVACY_REST]),
});

const COLOFON = Object.freeze({
  href: COLOFON_HREF,
  metadata: Object.freeze({
    title: 'Colofon · Onze Menukaarten',
    description:
      'Wie Onze Menukaarten maakt, waar de menukaarten en prijzen vandaan komen en hoe je contact opneemt als er iets niet klopt.',
  }),
  title: 'Colofon',
  sections: Object.freeze([
    Object.freeze({
      id: 'over-bredaeats',
      heading: 'Over Onze Menukaarten',
      blocks: Object.freeze([
        paragraph(
          'Onze Menukaarten helpt je kiezen wat je vanavond eet in Breda: per gerecht, met de prijs erbij. Het is een dienst van [NAAM ORGANISATIE], [ADRES], KvK [KVK-NUMMER].',
        ),
      ]),
    }),
    Object.freeze({
      id: 'waar-de-gegevens-vandaan-komen',
      heading: 'Waar de gegevens vandaan komen',
      blocks: Object.freeze([
        paragraph(
          'Menukaarten en prijzen komen van de eigen websites en menukaarten van restaurants, en van restauranthouders zelf. Locatiegegevens komen deels van OpenStreetMap (© OpenStreetMap-bijdragers, beschikbaar onder de Open Database License). Bij elk restaurant staat waar de menukaart vandaan komt.',
        ),
      ]),
    }),
    Object.freeze({
      id: 'klopt-er-iets-niet',
      heading: 'Klopt er iets niet?',
      blocks: Object.freeze([
        paragraph(
          'Prijzen en gerechten kunnen veranderen. We doen ons best, maar kunnen niet garanderen dat alles altijd klopt. Ziet je iets dat niet klopt? Mail naar [E-MAILADRES]. Ben je de eigenaar van het restaurant? Via "Voor restaurants" beheer je je eigen gegevens.',
        ),
      ]),
    }),
    Object.freeze({
      id: 'contact',
      heading: 'Contact',
      blocks: Object.freeze([paragraph('[E-MAILADRES]')]),
    }),
    Object.freeze({
      id: 'privacy',
      heading: 'Privacy',
      blocks: Object.freeze([
        paragraphWithLink('Lees onze privacyverklaring.', 'privacyverklaring', PRIVACY_HREF),
      ]),
    }),
  ]),
});

module.exports = {
  COLOFON,
  COLOFON_HREF,
  LEGAL_PLACEHOLDERS,
  LOGIN_PRIVACY_LINK,
  PRIVACY,
  PRIVACY_HREF,
};
