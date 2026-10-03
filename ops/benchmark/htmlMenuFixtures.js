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
      <ul><li>Groepen vanaf 8 personen</li><li>Bel 000 000 0000 (testnummer)</li><li>Aanbetaling € 10,00 per reservering</li></ul>
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

  // ── BE-22 review fixes (H1, M1, L1, L2) ─────────────────────────────────
  {
    id: 'html-single-clock-times',
    kind: 'negative',
    notes: 'H1: single clock times in clear time context ("vanaf 12.00", "om 21.45", "uur") are times, never prices — even without an opening-hours heading.',
    html: page(`
      <h2>Fictief</h2>
      <ul><li>Lunch vanaf 12.00</li><li>Diner vanaf 17.30</li><li>Borrel vanaf 16.00</li><li>Keuken sluit om 21.45</li><li>Ontbijt 08.30 uur</li></ul>`),
    expected: { isMenu: false, items: [], rejectedReasons: ['clock_time'] },
  },
  {
    id: 'html-event-dates',
    kind: 'negative',
    notes: 'H1: dates in clear date/event context (event word, "op", month name) are never prices.',
    html: page(`
      <h2>Agenda</h2>
      <ul><li>Fictief event 12.05</li><li>Fictief feest 24.12</li><li>Fictieve markt op 01.06</li><li>Fictief concert 15 mei</li></ul>`),
    expected: { isMenu: false, items: [], rejectedReasons: ['date'] },
  },
  {
    id: 'html-dot-prices-not-times',
    kind: 'positive',
    notes: 'H1 positive: ordinary dot and comma prices stay prices — no time/date context, "vanaf" with a comma or €, € in event context, an invalid date.',
    html: page(`
      <h2>Kaart</h2>
      <ul>
        <li>Fictieve pasta 12.50</li>
        <li>Fictieve plank vanaf 12,50</li>
        <li>Fictieve schotel vanaf € 14.50</li>
        <li>Fictief concert-diner € 24.12</li>
        <li>Fictieve marktsalade 12.05</li>
        <li>Fictieve proeverij 24.50</li>
        <li>Fictieve soep 6.30</li>
      </ul>`),
    expected: {
      isMenu: true,
      items: [
        ['Kaart', 'Fictieve pasta', 'known', 1250],
        ['Kaart', 'Fictieve plank vanaf', 'known', 1250],
        ['Kaart', 'Fictieve schotel vanaf', 'known', 1450],
        ['Kaart', 'Fictief concert-diner', 'known', 2412],
        ['Kaart', 'Fictieve marktsalade', 'known', 1205],
        ['Kaart', 'Fictieve proeverij', 'known', 2450],
        ['Kaart', 'Fictieve soep', 'known', 630],
      ],
    },
  },
  {
    id: 'html-volumes-and-weights',
    kind: 'positive',
    notes: 'M1: volumes and weights (comma/dot, with/without space) are never prices; only the real price remains; a real dual price stays multiple_undecomposed; a trailing alcohol percentage is dropped from the displayed name.',
    html: page(`
      <h2>Dranken</h2>
      <ul>
        <li>Fictieve wijn 0,75 l</li>
        <li>Fictief bier 0,33 l 4,50</li>
        <li>Fictief bier 33cl 3,80</li>
        <li>Fictieve frisdrank 0.25l 2.75</li>
        <li>Fictief water 500 ml 3,20</li>
        <li>Fictieve huiswijn 0,75 l glas 5,50 / fles 27,50</li>
        <li>Fictieve tripel 8,5% vol 5,50</li>
      </ul>
      <h2>Vlees</h2>
      <ul><li>Fictieve steak 250 g 24,50</li><li>Fictieve olijven 0,20 kg € 4,50</li></ul>`),
    expected: {
      isMenu: true,
      items: [
        ['Dranken', 'Fictief bier 0,33 l', 'known', 450],
        ['Dranken', 'Fictief bier 33cl', 'known', 380],
        ['Dranken', 'Fictieve frisdrank 0.25l', 'known', 275],
        ['Dranken', 'Fictief water 500 ml', 'known', 320],
        ['Dranken', 'Fictieve huiswijn 0,75 l', 'multiple_undecomposed', null],
        ['Dranken', 'Fictieve tripel', 'known', 550],
        ['Vlees', 'Fictieve steak 250 g', 'known', 2450],
        ['Vlees', 'Fictieve olijven 0,20 kg', 'known', 450],
      ],
      rejectedReasons: ['missing_price'],
    },
  },
  {
    id: 'html-two-dishes-one-element',
    kind: 'difficult',
    notes: 'L1: one element holding two name+price pairs is rejected as ambiguous, never merged into one item; size variants of one drink stay one multiple_undecomposed item.',
    html: page(`
      <h2>Lunch</h2>
      <ul>
        <li>Fictieve soep 6,50 Fictieve salade 7,50</li>
        <li>Fictieve wrap 8,50</li>
        <li>Fictieve quiche 9,25</li>
        <li>Fictieve bowl 11,00</li>
        <li>Fictieve koffie klein 2,50 middel 3,00 groot 3,50</li>
      </ul>`),
    expected: {
      isMenu: true,
      items: [
        ['Lunch', 'Fictieve wrap', 'known', 850],
        ['Lunch', 'Fictieve quiche', 'known', 925],
        ['Lunch', 'Fictieve bowl', 'known', 1100],
        ['Lunch', 'Fictieve koffie', 'multiple_undecomposed', null],
      ],
      rejectedReasons: ['ambiguous_structure'],
    },
  },
  {
    id: 'html-non-dish-price-sections',
    kind: 'negative',
    notes: 'L2: clearly labelled voucher, admission, parking and cloakroom sections are never menus. Narrow heading labels only — an unlabelled list of such prices is NOT caught (documented limitation).',
    html: page(`
      <h2>Cadeaubonnen</h2>
      <div class="product-card"><h3>Fictieve bon klein</h3><span class="price">€ 25</span></div>
      <div class="product-card"><h3>Fictieve bon groot</h3><span class="price">€ 50</span></div>
      <h2>Entree</h2>
      <ul><li>Fictief kind tot 12 jaar 7,50</li><li>Fictief volwassen 15,00</li></ul>
      <h2>Parkeren</h2>
      <ul><li>Fictief parkeren per uur 2,50</li></ul>
      <h2>Garderobe</h2>
      <ul><li>Fictieve jas 1,00</li></ul>`),
    expected: { isMenu: false, items: [], rejectedReasons: ['non_menu_section'] },
  },

  // ── BE-22 review round 2 (N1, N2, N3) ───────────────────────────────────
  {
    id: 'html-table-two-dishes-per-row',
    kind: 'difficult',
    notes: 'N1: a row with two name+price pairs is ambiguous (never the first dish alone); one name with glas/fles price cells stays one multiple_undecomposed item; a description cell is not a second dish.',
    html: page(`
      <h2>Kaart</h2>
      <table>
        <tr><td>Fictieve soep</td><td>6,50</td><td>Fictieve salade</td><td>7,50</td></tr>
        <tr><td>Fictieve huiswijn</td><td>5,50</td><td>27,50</td></tr>
        <tr><td>Fictieve rosé</td><td>glas</td><td>5,75</td><td>fles</td><td>28,00</td></tr>
        <tr><td>Fictieve wrap</td><td>8,50</td></tr>
        <tr><td>Fictieve quiche</td><td>Met fictieve prei</td><td>9,25</td></tr>
      </table>`),
    expected: {
      isMenu: true,
      items: [
        ['Kaart', 'Fictieve huiswijn', 'multiple_undecomposed', null],
        ['Kaart', 'Fictieve rosé', 'multiple_undecomposed', null],
        ['Kaart', 'Fictieve wrap', 'known', 850],
        ['Kaart', 'Fictieve quiche', 'known', 925],
      ],
      rejectedReasons: ['ambiguous_structure'],
      descriptions: { 'Fictieve quiche': 'Met fictieve prei' },
    },
  },
  {
    id: 'html-card-two-pairs',
    kind: 'difficult',
    notes: 'N2: a card with two name/price element pairs, or a price outside its one price element, is ambiguous; a card with exactly one name and one price stays supported, even with a <strong> word in its description.',
    html: page(`
      <h2>Gerechten</h2>
      <div class="menu-item"><h3>Fictieve soep</h3><span class="price">6,50</span><h3>Fictieve salade</h3><span class="price">7,50</span></div>
      <div class="menu-item"><h3>Fictief broodje</h3><span class="price">6,00</span> Fictieve tosti 4,50</div>
      <div class="menu-item"><h3>Fictieve pasta</h3><p class="desc">Met <strong>verse</strong> fictieve kruiden</p><span class="price">€ 14,50</span></div>
      <div class="menu-item"><h3>Fictieve risotto</h3><p class="desc">Met fictieve paddenstoelen</p><span class="price">€ 16,00</span></div>
      <div class="menu-item"><h3>Fictieve curry</h3><span class="price">€ 15,50</span></div>`),
    expected: {
      isMenu: true,
      items: [
        ['Gerechten', 'Fictieve pasta', 'known', 1450],
        ['Gerechten', 'Fictieve risotto', 'known', 1600],
        ['Gerechten', 'Fictieve curry', 'known', 1550],
      ],
      rejectedReasons: ['ambiguous_structure'],
      descriptions: { 'Fictieve pasta': 'Met verse fictieve kruiden' },
    },
  },
  {
    id: 'html-size-letters-and-volumes',
    kind: 'difficult',
    notes: 'N3: a size letter after a price ("9,50 M 12,50 L") is never a volume — two prices stay multiple_undecomposed; a sub-euro quantity with "L" ("0,75 L 4,50") is a volume; a unit-like token after a price is kept as a price (fail closed).',
    html: page(`
      <h2>Fictief</h2>
      <ul>
        <li>Fictieve pizza 9,50 M 12,50 L</li>
        <li>Fictieve calzone 10,50 m 13,50 l</li>
        <li>Fictief bier 0,75 L 4,50</li>
        <li>Fictieve frisdrank 0,33 l 2,90</li>
        <li>Fictief tapbier 4,50 (0,25 l)</li>
      </ul>`),
    expected: {
      isMenu: true,
      items: [
        ['Fictief', 'Fictieve pizza', 'multiple_undecomposed', null],
        ['Fictief', 'Fictieve calzone', 'multiple_undecomposed', null],
        ['Fictief', 'Fictief bier 0,75 L', 'known', 450],
        ['Fictief', 'Fictieve frisdrank 0,33 l', 'known', 290],
        ['Fictief', 'Fictief tapbier', 'multiple_undecomposed', null],
      ],
    },
  },
]

module.exports = { HTML_MENU_CASES }
