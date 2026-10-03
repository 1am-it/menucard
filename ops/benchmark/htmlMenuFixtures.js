// BE-22 — synthetic HTML menu fixtures for the offline menu-structure
// benchmark. Every page below is written by hand for this foundation, with
// fictional dish names ("Fictieve …") — never HTML, menu text, or any other
// content copied from a real restaurant website. Each case carries its own
// expected result (`expected`) so a deterministic or a future model-assisted
// adapter is scored against the same reference.
//
// `expected.isMenu` — whether a menu should be recognized at all.
// `expected.items` — the dishes/drinks a perfect extractor returns, as
//   `[sectionLabel, name, priceStatus, amountMinorUnits]` (sectionLabel is
//   the deepest heading label, or null when there is none).
// `expected.rejectedReasons` — reasons that must appear among rejected lines.
//
// Isolated tooling, never imported by product code — see manifest.js's own
// header comment.
//
// Deliberately CommonJS, same reasoning as every pure-logic module under
// `src/lib/`.

'use strict'

const page = (body) => `<!doctype html><html lang="nl"><head><title>Fictief</title><script>var x = "€ 99,00";</script></head><body>${body}</body></html>`

const HTML_MENU_CASES = [
  // ── Supported structures ────────────────────────────────────────────────
  {
    id: 'html-headings-lists',
    kind: 'positive',
    notes: 'Semantic h2 sections with list items: name and price in the same li.',
    html: page(`
      <nav><ul><li><a href="/">Home</a></li><li><a href="/menu">Menu</a></li><li><a href="/contact">Contact</a></li></ul></nav>
      <main>
        <h2>Voorgerechten</h2>
        <ul>
          <li><span>Fictieve soep</span> <span>€ 6,50</span></li>
          <li><span>Fictieve salade</span> <span>€ 8,75</span></li>
        </ul>
        <h2>Hoofdgerechten</h2>
        <ul>
          <li>Fictief stoofvlees — € 19,50</li>
          <li>Fictieve risotto — € 17,00</li>
        </ul>
      </main>`),
    expected: {
      isMenu: true,
      items: [
        ['Voorgerechten', 'Fictieve soep', 'known', 650],
        ['Voorgerechten', 'Fictieve salade', 'known', 875],
        ['Hoofdgerechten', 'Fictief stoofvlees', 'known', 1950],
        ['Hoofdgerechten', 'Fictieve risotto', 'known', 1700],
      ],
    },
  },
  {
    id: 'html-table',
    kind: 'positive',
    notes: 'A table with a header row; one cell per row is the price.',
    html: page(`
      <h2>Dranken</h2>
      <table>
        <thead><tr><th>Drank</th><th>Prijs</th></tr></thead>
        <tbody>
          <tr><td>Fictieve cola</td><td>3,50</td></tr>
          <tr><td>Fictieve limonade</td><td>3,75</td></tr>
          <tr><td>Fictief bier</td><td>4,50</td></tr>
          <tr><td>Fictieve thee</td><td>3,00</td></tr>
        </tbody>
      </table>`),
    expected: {
      isMenu: true,
      items: [
        ['Dranken', 'Fictieve cola', 'known', 350],
        ['Dranken', 'Fictieve limonade', 'known', 375],
        ['Dranken', 'Fictief bier', 'known', 450],
        ['Dranken', 'Fictieve thee', 'known', 300],
      ],
    },
  },
  {
    id: 'html-definition-list',
    kind: 'positive',
    notes: 'A definition list: dt name, dd price.',
    html: page(`
      <h3>Desserts</h3>
      <dl>
        <dt>Fictieve taart</dt><dd>€ 7,00</dd>
        <dt>Fictief ijs</dt><dd>€ 5,50</dd>
        <dt>Fictieve mousse</dt><dd>€ 6,25</dd>
      </dl>`),
    expected: {
      isMenu: true,
      items: [
        ['Desserts', 'Fictieve taart', 'known', 700],
        ['Desserts', 'Fictief ijs', 'known', 550],
        ['Desserts', 'Fictieve mousse', 'known', 625],
      ],
    },
  },
  {
    id: 'html-repeated-cards',
    kind: 'positive',
    notes: 'Repeated item cards with name, description and price elements; the description belongs to the same card.',
    html: page(`
      <h2>Lunch</h2>
      <div class="grid">
        <div class="menu-item"><h4 class="item-name">Fictief broodje kaas</h4><p class="item-desc">Met oude kaas en mosterd</p><span class="item-price">€ 7,50</span></div>
        <div class="menu-item"><h4 class="item-name">Fictieve tosti</h4><p class="item-desc">Ham en kaas</p><span class="item-price">€ 5,00</span></div>
        <div class="menu-item"><h4 class="item-name">Fictieve soep van de dag</h4><span class="item-price">€ 6,00</span></div>
      </div>`),
    expected: {
      isMenu: true,
      items: [
        ['Lunch', 'Fictief broodje kaas', 'known', 750],
        ['Lunch', 'Fictieve tosti', 'known', 500],
        ['Lunch', 'Fictieve soep van de dag', 'known', 600],
      ],
      descriptions: { 'Fictief broodje kaas': 'Met oude kaas en mosterd', 'Fictieve tosti': 'Ham en kaas' },
    },
  },
  {
    id: 'html-aria-structure',
    kind: 'positive',
    notes: 'An accessible structure: role=heading and role=list/listitem with consistent labels.',
    html: page(`
      <div role="heading" aria-level="2">Borrel</div>
      <div role="list">
        <div role="listitem">Fictieve bitterballen <span>€ 8,50</span></div>
        <div role="listitem">Fictieve nachos <span>€ 9,00</span></div>
        <div role="listitem">Fictieve kaasplank <span>€ 12,50</span></div>
      </div>`),
    expected: {
      isMenu: true,
      items: [
        ['Borrel', 'Fictieve bitterballen', 'known', 850],
        ['Borrel', 'Fictieve nachos', 'known', 900],
        ['Borrel', 'Fictieve kaasplank', 'known', 1250],
      ],
    },
  },
  {
    id: 'html-nested-sections',
    kind: 'difficult',
    notes: 'Nested sections (h2 > h3, and a list item that labels a nested list) keep the full heading path.',
    html: page(`
      <h2>Dranken</h2>
      <h3>Warm</h3>
      <ul><li>Fictieve koffie 3,00</li><li>Fictieve thee 2,80</li></ul>
      <h3>Koud</h3>
      <ul>
        <li>Frisdrank
          <ul><li>Fictieve cola 3,20</li><li>Fictieve tonic 3,40</li></ul>
        </li>
      </ul>`),
    expected: {
      isMenu: true,
      items: [
        ['Warm', 'Fictieve koffie', 'known', 300],
        ['Warm', 'Fictieve thee', 'known', 280],
        ['Frisdrank', 'Fictieve cola', 'known', 320],
        ['Frisdrank', 'Fictieve tonic', 'known', 340],
      ],
      paths: { 'Fictieve cola': ['Dranken', 'Koud', 'Frisdrank'], 'Fictieve koffie': ['Dranken', 'Warm'] },
    },
  },
  {
    id: 'html-allergen-markers',
    kind: 'difficult',
    notes: 'Allergen and diet icons/markers are excluded from names and counted, never interpreted.',
    html: page(`
      <h2>Hoofdgerechten</h2>
      <ul>
        <li class="dish vegan">Fictieve curry <img src="v.svg" alt="vegan"> <span class="allergen">G, N</span> € 16,50</li>
        <li class="dish">Fictieve vis <i class="icon-fish"></i> € 21,00</li>
        <li class="dish">Fictieve pasta <span class="diet-badge">vega</span> € 15,00</li>
      </ul>`),
    expected: {
      isMenu: true,
      items: [
        ['Hoofdgerechten', 'Fictieve curry', 'known', 1650],
        ['Hoofdgerechten', 'Fictieve vis', 'known', 2100],
        ['Hoofdgerechten', 'Fictieve pasta', 'known', 1500],
      ],
      minIgnoredMarkers: 4,
    },
  },
  {
    id: 'html-dual-prices',
    kind: 'difficult',
    notes: 'Glass/bottle prices stay multiple_undecomposed — never collapsed into one invented amount.',
    html: page(`
      <h2>Wijnen</h2>
      <ul>
        <li>Fictieve huiswijn wit — glas 5,50 / fles 27,50</li>
        <li>Fictieve huiswijn rood — glas 5.50 - fles 27.50</li>
        <li>Fictieve cava 7,00</li>
        <li>Fictieve rosé 5,75</li>
      </ul>`),
    expected: {
      isMenu: true,
      items: [
        ['Wijnen', 'Fictieve huiswijn wit', 'multiple_undecomposed', null],
        ['Wijnen', 'Fictieve huiswijn rood', 'multiple_undecomposed', null],
        ['Wijnen', 'Fictieve cava', 'known', 700],
        ['Wijnen', 'Fictieve rosé', 'known', 575],
      ],
    },
  },
  {
    id: 'html-repeated-markup',
    kind: 'difficult',
    notes: 'The same menu rendered twice (desktop and mobile columns) is de-duplicated.',
    html: page(`
      <h2>Lunch</h2>
      <div class="col desktop"><ul><li>Fictieve wrap 8,50</li><li>Fictieve bowl 11,00</li><li>Fictieve quiche 9,25</li></ul></div>
      <div class="col mobile"><ul><li>Fictieve wrap 8,50</li><li>Fictieve bowl 11,00</li><li>Fictieve quiche 9,25</li></ul></div>`),
    expected: {
      isMenu: true,
      items: [
        ['Lunch', 'Fictieve wrap', 'known', 850],
        ['Lunch', 'Fictieve bowl', 'known', 1100],
        ['Lunch', 'Fictieve quiche', 'known', 925],
      ],
      minDuplicatesRemoved: 3,
    },
  },
  {
    id: 'html-on-request-and-modifiers',
    kind: 'difficult',
    notes: 'An explicit "dagprijs" is on_request; "+ extra …" lines are modifiers, never dishes; an unpriced dish in a priced section is reported.',
    html: page(`
      <h2>Vis</h2>
      <ul>
        <li>Fictieve dagvangst — dagprijs</li>
        <li>Fictieve mosselen € 22,50</li>
        <li>Fictieve zalm € 19,00</li>
        <li>+ extra friet € 3,50</li>
        <li>Fictieve kreeft</li>
      </ul>`),
    expected: {
      isMenu: true,
      items: [
        ['Vis', 'Fictieve dagvangst', 'on_request', null],
        ['Vis', 'Fictieve mosselen', 'known', 2250],
        ['Vis', 'Fictieve zalm', 'known', 1900],
      ],
      rejectedReasons: ['modifier', 'missing_price'],
    },
  },

  // ── Never a menu ────────────────────────────────────────────────────────
  {
    id: 'html-opening-hours',
    kind: 'negative',
    notes: 'Opening hours in a list — never a menu, whatever the numbers look like.',
    html: page(`
      <h2>Openingstijden</h2>
      <ul><li>Maandag 12.00 - 22.00</li><li>Dinsdag 12.00 - 22.00</li><li>Woensdag 12.00 - 22.00</li><li>Do t/m zo 11.30 - 23.00</li></ul>
      <ul><li>Keuken open tot 21.30 uur</li><li>Lunch 12.00 - 16.00</li><li>Diner 17.00 - 22.00</li></ul>`),
    expected: { isMenu: false, items: [], rejectedReasons: ['non_menu_section'] },
  },
  {
    id: 'html-reservation-contact-reviews',
    kind: 'negative',
    notes: 'Reservation, contact and review blocks — phone numbers, group sizes and stars are never dishes or prices.',
    html: page(`
      <h2>Reserveren</h2>
      <ul><li>Groepen vanaf 8 personen</li><li>Bel 076 123 45 67</li><li>Aanbetaling € 10,00 per reservering</li></ul>
      <h2>Contact</h2>
      <ul><li>Fictiefstraat 1</li><li>1234 AB Fictiefstad</li><li>info@fictief.invalid</li></ul>
      <h2>Reviews</h2>
      <ul><li>★★★★★ Heerlijk gegeten, € 50,00 goed besteed!</li><li>★★★★ Fijne avond</li><li>★★★★★ Aanrader</li></ul>`),
    expected: { isMenu: false, items: [], rejectedReasons: ['non_menu_section'] },
  },
  {
    id: 'html-loose-prices',
    kind: 'negative',
    notes: 'Prices without any dish name in the same element.',
    html: page(`<h2>Prijzen</h2><ul><li>€ 12,50</li><li>€ 14,00</li><li>€ 9,75</li><li>16,50</li></ul>`),
    expected: { isMenu: false, items: [], rejectedReasons: ['missing_name'] },
  },
  {
    id: 'html-prose-prices',
    kind: 'negative',
    notes: 'Prices in running text are never items — only list/table/definition/card structures count.',
    html: page(`
      <h2>Over ons</h2>
      <p>Onze lunch is er vanaf € 12,50 en een driegangendiner vanaf € 39,50.</p>
      <p>Een kopje koffie kost € 3,00 en een glas wijn € 5,50. Kom gezellig langs!</p>
      <div>Fictieve high tea € 29,50 per persoon, reserveer vooraf.</div>`),
    expected: { isMenu: false, items: [] },
  },
  {
    id: 'html-shared-dining-per-person',
    kind: 'negative',
    notes: 'Shared dining and arrangements priced per person or per table are service units, never dishes; unpriced dishes are not items.',
    html: page(`
      <h2>Shared dining</h2>
      <ul>
        <li>3 gangen p.p. € 37,50</li>
        <li>4 gangen per persoon € 42,50</li>
        <li>Fictieve chef's selectie — prijs per tafel € 120,00</li>
        <li>Fictieve gerechten om te delen</li>
      </ul>
      <h2>Arrangementen</h2>
      <ul><li>Fictief borrelarrangement € 24,50</li><li>Fictief vergaderpakket € 35,00</li></ul>`),
    expected: { isMenu: false, items: [], rejectedReasons: ['service_unit', 'non_menu_section'] },
  },
  {
    id: 'html-missing-prices',
    kind: 'negative',
    notes: 'A list of dish names without any prices — no menu can be claimed.',
    html: page(`<h2>Gerechten</h2><ul><li>Fictieve soep</li><li>Fictieve salade</li><li>Fictief stoofvlees</li><li>Fictieve taart</li></ul>`),
    expected: { isMenu: false, items: [] },
  },
  {
    id: 'html-too-few-items',
    kind: 'negative',
    notes: 'Only two priced items — below the minimum, stays unparsed.',
    html: page(`<h2>Snacks</h2><ul><li>Fictieve friet 3,50</li><li>Fictieve kroket 2,75</li></ul>`),
    expected: { isMenu: false, items: [] },
  },
]

module.exports = { HTML_MENU_CASES }
