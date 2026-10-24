// Menu source structure regression corpus — the versioned STRUCT-* catalogue.
// See docs/guides/menu-source-structure-regression-corpus.md.
//
// Every case is a fictional, hand-written page or small site on the
// `.invalid` TLD with fictional dish names ("Fictieve …"): never HTML, URLs,
// names, dishes or text copied from a real restaurant. Each case records the
// layers it guards, its input, and what the real product chain must produce
// (src/lib: HTML parser → source analysis → menu hierarchy → concept → batch
// status → Publicatievoorbeeld/export). Negative expectations (`mustNot`)
// record what must never be recognised, merged or moved.
//
// A case whose product behaviour is not decided yet is `status:
// 'unclassified'`: it runs and is reported, but never passes or fails.
//
// Isolated tooling, never imported by product code. CommonJS like the rest of
// ops/benchmark.

'use strict'

const STRUCTURE_CORPUS_VERSION = '1.0.0'

/** The product layers a case can guard. */
const LAYERS = ['html_parser', 'source_analysis', 'hierarchy', 'concept', 'batch_status', 'export']

const HOST = 'https://www.fictief-struct.invalid'
const page = (body) => `<!doctype html><html lang="nl"><head><title>Fictief</title></head><body><main>${body}</main></body></html>`
const list = (...dishes) => `<ul>${dishes.map(([name, price]) => `<li>${name}${price ? ` <span>€ ${price}</span>` : ''}</li>`).join('')}</ul>`
// A small site: a homepage linking one menu page (so the batch status reflects
// the menu itself, not the rule for a menu on the already known homepage).
const site = (html) => ({ homepage: page('<nav><a href="/menukaart">Menukaart</a></nav><p>Welkom.</p>'), pages: { '/menukaart': { status: 'html', html: page(html) } } })
const SENTENCE = 'Deze fictieve gerechten worden geserveerd als klein gerecht om te delen.'
const LONG_SECTION = 'Huisgemaakte fictieve pasta en risotto met groenten van lokale telers uit de streek'

/**
 * A case:
 *   id, name, status ('classified' | 'unclassified'), layers, input, expected.
 * input:
 *   { page: html }                         one homepage holding the menu
 *   { homepage: html, pages: { path: { status: 'html', html } | { status: 'blocked' } | { status: 'error' } } }
 *   live?: data/menus.json-shaped entries for restaurant "struct" (the current public menu)
 *   edits?: concept edits (src/lib/menuConcept.js sanitizeEdits shape)
 * expected (every key optional; only given keys are checked):
 *   recognized, menus: [{ title, structure, sections: [[path, itemCount, uncertain]] }],
 *   parserRejected: reasons that must appear, statuses: { status: count } (exact),
 *   blockers: sorted statuses (exact), removed: [[scope, name]] (exact),
 *   batchLabel, notes: substrings, export: true (concept = preview = export),
 *   conceptRoutes: [[dish, full source route, uncertain]] (the route reaching the concept/review),
 *   mustNot: { pathLabelIncludes: [text], dishInPath: [[dish, full source route]], dishRecognised: [dish] }
 */
const STRUCTURE_CASES = [
  {
    id: 'STRUCT-001',
    name: 'Plat menu: korte rubrieken zonder gedeelde titel',
    status: 'classified',
    layers: ['html_parser', 'hierarchy', 'concept', 'export'],
    input: site(`<h2>Voorgerechten</h2>${list(['Fictieve soep', '6,50'], ['Fictieve salade', '8,75'])}<h2>Hoofdgerechten</h2>${list(['Fictief stoofvlees', '19,50'], ['Fictieve risotto', '17,00'])}`),
    expected: {
      recognized: true,
      menus: [{ title: null, structure: 'normalized', sections: [[['Voorgerechten'], 2, false], [['Hoofdgerechten'], 2, false]] }],
      statuses: { new: 4 },
      blockers: [],
      batchLabel: 'Menukaart gevonden · controle nodig',
      export: true,
      flatExport: true,
    },
  },
  {
    id: 'STRUCT-002',
    name: 'Gedeelde menutitel met geneste varianten en rubrieken',
    status: 'classified',
    layers: ['html_parser', 'hierarchy', 'concept', 'export'],
    input: {
      page: page(`<h1>Fictief seizoensmenu</h1>
        <h2>Lunch</h2><h3>Broodjes</h3>${list(['Fictief broodje kaas', '8,50'], ['Fictief broodje ei', '7,50'])}
        <h2>Diner</h2><h3>Voor</h3>${list(['Fictieve gamba', '14,50'])}<h3>Hoofd</h3>${list(['Fictieve zeebaars', '24,50'], ['Fictieve stoof', '21,00'])}`),
    },
    expected: {
      recognized: true,
      menus: [{ title: 'Fictief seizoensmenu', structure: 'normalized', sections: [[['Lunch', 'Broodjes'], 2, false], [['Diner', 'Voor'], 1, false], [['Diner', 'Hoofd'], 2, false]] }],
      statuses: { new: 5 },
      blockers: [],
      export: true,
      mustNot: { pathLabelIncludes: [' — '] },
    },
  },
  {
    id: 'STRUCT-003',
    name: 'Zelfde gerecht in Lunch en Diner: geen duplicaat, geen kruisvariant-match',
    status: 'classified',
    layers: ['source_analysis', 'hierarchy', 'concept'],
    input: {
      homepage: page('<nav><a href="/lunch">Lunch</a> <a href="/diner">Diner</a></nav><p>Welkom.</p>'),
      pages: {
        '/lunch': { status: 'html', html: page(`<h1>Lunch</h1><h2>Gerechten</h2>${list(['Fictieve soep', '7,50'], ['Fictieve salade', '13,50'], ['Fictief broodje', '8,50'])}`) },
        '/diner': { status: 'html', html: page(`<h1>Diner</h1><h2>Gerechten</h2>${list(['Fictieve salade', '15,50'], ['Fictieve stoof', '24,00'], ['Fictieve zeebaars', '26,00'])}`) },
      },
      // Published today: the soup only on the diner menu.
      live: {
        'struct-lunch': { subtitle: 'Lunchkaart', categories: [{ name: 'Gerechten', items: [{ name: 'Fictieve salade', priceValue: 13.5 }] }] },
        'struct-diner': { subtitle: 'Dinerkaart', categories: [{ name: 'Gerechten', items: [{ name: 'Fictieve soep', priceValue: 9.5 }, { name: 'Fictieve stoof', priceValue: 24 }] }] },
      },
    },
    expected: {
      recognized: true,
      menus: [
        { title: 'Lunch', structure: 'normalized', sections: [[['Gerechten'], 3, false]] },
        { title: 'Diner', structure: 'normalized', sections: [[['Gerechten'], 3, false]] },
      ],
      // Salade on both menus is no duplicate; the lunch soup is new, never the published diner soup.
      statuses: { unchanged: 2, new: 4 },
      blockers: ['removed'],
      removed: [['Diner', 'Fictieve soep']],
      lineStatuses: [['Lunch', 'Fictieve soep', 'new'], ['Lunch', 'Fictieve salade', 'unchanged'], ['Diner', 'Fictieve salade', 'new'], ['Diner', 'Fictieve stoof', 'unchanged']],
    },
  },
  {
    id: 'STRUCT-004',
    name: 'Herhaalde opgemaakte gerechtblokken (vette titel, omschrijving, eindprijs)',
    status: 'classified',
    layers: ['html_parser', 'source_analysis', 'concept'],
    input: {
      page: page(`<h1>Lunch</h1><h2>A la carte</h2>
        <p><strong>Fictieve tomatensoep</strong> basilicum, room 7,50<br>
           <strong>Fictief broodje kroket</strong><br>twee kroketten<br>9,50<br>
           <strong>Fictieve salade</strong><br>geitenkaas<br>honing<br>14</p>`),
    },
    expected: {
      recognized: true,
      menus: [{ title: 'Lunch', structure: 'normalized', sections: [[['A la carte'], 3, false]] }],
      evidencePatterns: ['formatted_block'],
      statuses: { new: 3 },
      blockers: [],
      export: true,
    },
  },
  {
    id: 'STRUCT-005',
    name: 'Veilige, lager geneste verklarende prozakop',
    status: 'classified',
    layers: ['html_parser', 'hierarchy', 'concept'],
    input: {
      page: page(`<h2>Lunch</h2><h3>A LA CARTE</h3><h4>${SENTENCE}</h4>${list(['Fictieve lunchsoep', '8,50'], ['Fictieve lunchsalade', '13,50'])}
        <h2>Diner</h2><h3>A LA CARTE</h3><h4>${SENTENCE}</h4>${list(['Fictieve dinersoep', '9,50'], ['Fictieve dinerstoof', '22,00'])}`),
    },
    expected: {
      recognized: true,
      menus: [{ title: null, structure: 'normalized', sections: [[['Lunch', 'A LA CARTE'], 2, false], [['Diner', 'A LA CARTE'], 2, false]] }],
      statuses: { new: 4 },
      blockers: [],
      mustNot: { pathLabelIncludes: ['klein gerecht'] },
    },
  },
  {
    id: 'STRUCT-006',
    name: 'Lange echte rubriekkop zonder zinsvorm blijft een kop',
    status: 'classified',
    layers: ['html_parser', 'hierarchy', 'concept'],
    input: { page: page(`<h2>Diner</h2><h3>${LONG_SECTION}</h3>${list(['Fictieve pasta', '18,50'], ['Fictieve risotto', '19,50'])}<h3>Desserts</h3>${list(['Fictief ijs', '7,50'])}`) },
    expected: {
      recognized: true,
      menus: [{ title: 'Diner', structure: 'normalized', sections: [[[LONG_SECTION], 2, false], [['Desserts'], 1, false]] }],
      // The section is kept; a section name over 60 characters is still a
      // "Rubriek onduidelijk" check for the reviewer (existing concept rule).
      statuses: { unclear_category: 2, new: 1 },
      blockers: ['unclear_category', 'unclear_category'],
    },
  },
  {
    id: 'STRUCT-007',
    name: 'Zinachtige kop op hetzelfde niveau blijft uncertain, nooit bij de vorige rubriek',
    status: 'classified',
    layers: ['html_parser', 'hierarchy', 'concept', 'batch_status'],
    input: site(`<h2>Lunch</h2>${list(['Fictieve lunchsoep', '7,50'], ['Fictieve lunchsalade', '13,50'])}<h2>${SENTENCE}</h2>${list(['Fictieve extra soep', '8,50'], ['Fictieve extra salade', '12,50'])}`),
    expected: {
      recognized: true,
      menus: [{ title: null, structure: 'uncertain', sections: [[['Lunch'], 2, false], [[SENTENCE], 2, true]] }],
      statuses: { new: 2, unclear_category: 2 },
      blockers: ['unclear_category', 'unclear_category'],
      batchLabel: 'Controle nodig',
      mustNot: { dishInPath: [['Fictieve extra soep', ['Lunch']], ['Fictieve extra salade', ['Lunch']]] },
    },
  },
  {
    id: 'STRUCT-008',
    name: 'Zinachtige kop als enige kop blijft uncertain',
    status: 'classified',
    layers: ['html_parser', 'hierarchy', 'concept', 'batch_status'],
    input: site(`<h2>${SENTENCE}</h2>${list(['Fictieve soep', '7,50'], ['Fictieve salade', '13,50'], ['Fictief broodje', '8,50'])}`),
    expected: {
      recognized: true,
      menus: [{ title: null, structure: 'uncertain', sections: [[[SENTENCE], 3, true]] }],
      statuses: { unclear_category: 3 },
      blockers: ['unclear_category', 'unclear_category', 'unclear_category'],
      batchLabel: 'Controle nodig',
    },
  },
  {
    id: 'STRUCT-009',
    name: 'Zinachtig label van een geneste lijst komt nooit bij de vorige rubriek',
    status: 'classified',
    layers: ['html_parser', 'hierarchy', 'concept'],
    input: site(`<h2>Lunch</h2><ul>
        <li>Soepen<ul><li>Fictieve tomatensoep <span>€ 7,50</span></li><li>Fictieve uiensoep <span>€ 7,00</span></li></ul></li>
        <li>${SENTENCE}<ul><li>Fictief bordje <span>€ 9,50</span></li><li>Fictief plankje <span>€ 11,00</span></li></ul></li>
      </ul>`),
    expected: {
      recognized: true,
      // The sentence-like label is kept: its dishes stay under exactly
      // "Lunch › <label>" (source route), marked uncertain — never under the
      // sibling "Soepen", never flattened into "Lunch".
      menus: [{ title: 'Lunch', structure: 'uncertain', sections: [[['Soepen'], 2, false], [[SENTENCE], 2, true]] }],
      conceptRoutes: [
        ['Fictief bordje', ['Lunch', SENTENCE], true],
        ['Fictief plankje', ['Lunch', SENTENCE], true],
        ['Fictieve tomatensoep', ['Lunch', 'Soepen'], false],
      ],
      statuses: { new: 2, unclear_category: 2 },
      blockers: ['unclear_category', 'unclear_category'],
      mustNot: {
        dishInPath: [
          ['Fictief bordje', ['Lunch', 'Soepen']],
          ['Fictief plankje', ['Lunch', 'Soepen']],
          ['Fictief bordje', ['Lunch']],
          ['Fictief plankje', ['Lunch']],
        ],
      },
      batchLabel: 'Controle nodig',
    },
  },
  {
    id: 'STRUCT-010',
    name: 'Korte subkoppen op meerdere niveaus',
    status: 'classified',
    layers: ['html_parser', 'hierarchy', 'concept', 'export'],
    input: { page: page(`<h2>Diner</h2><h3>A LA CARTE</h3><h4>Vis</h4>${list(['Fictieve zeebaars', '24,50'], ['Fictieve tong', '29,00'])}<h4>Vlees</h4>${list(['Fictieve entrecote', '26,50'])}`) },
    expected: {
      recognized: true,
      menus: [{ title: 'Diner', structure: 'normalized', sections: [[['A LA CARTE', 'Vis'], 2, false], [['A LA CARTE', 'Vlees'], 1, false]] }],
      statuses: { new: 3 },
      blockers: [],
      export: true,
    },
  },
  {
    id: 'STRUCT-011',
    name: 'Ontbrekende prijs: nooit een gerecht, wel een afgewezen regel',
    status: 'classified',
    layers: ['html_parser', 'source_analysis'],
    input: { page: page(`<h2>Lunch</h2>${list(['Fictieve soep', '7,50'], ['Fictieve salade', '13,50'], ['Fictief broodje', '8,50'], ['Fictieve dagspecialiteit', null])}`) },
    expected: {
      recognized: true,
      menus: [{ title: null, structure: 'normalized', sections: [[['Lunch'], 3, false]] }],
      parserRejected: ['missing_price'],
      mustNot: { dishRecognised: ['Fictieve dagspecialiteit'] },
    },
  },
  {
    id: 'STRUCT-012',
    name: 'Dubbele prijzen en prijsrange: als prijsvarianten bewaard, nooit één bedrag',
    status: 'classified',
    layers: ['html_parser', 'source_analysis'],
    input: {
      page: page(`<h2>Lunch</h2>${list(['Fictieve soep', '7,50'], ['Fictieve salade', '13,50'], ['Fictief broodje', '8,50'])}
        <h2>Diner</h2><p><strong>Fictieve stoof</strong> rund 22,50<br><strong>Fictieve duokaart</strong> soep 6,50 salade 7,50<br><strong>Fictieve pizza</strong> klein of groot 12 / 16<br><strong>Fictieve wijn</strong> glas 5,50 fles 27,50<br><strong>Fictieve vis</strong> kabeljauw 24</p>`),
    },
    expected: {
      recognized: true,
      menus: [{ title: null, structure: 'normalized', sections: [[['Lunch'], 3, false], [['Diner'], 4, true]] }],
      // Two printed amounts on one dish row are that dish's price variants
      // (#59 Lead review 6351417692 K2): every amount is kept with the label
      // the source prints, none becomes "the" price and none is dropped.
      // #59 Lead review 6380804419 (W6): a price list the source names itself
      // ("glas 5,50 fles 27,50") is a complete price, so the row is no longer
      // "twee prijzen"; it stays a review target because its rubric is
      // uncertain. An unnamed multiple price ("12 / 16") still asks for one
      // choice.
      parserRejected: ['ambiguous_structure'],
      lineStatuses: [
        ['', 'Fictieve pizza', 'multiple_prices'],
        ['', 'Fictieve wijn', 'unclear_category'],
      ],
    },
  },
  {
    id: 'STRUCT-013',
    name: 'Supplement, tijd, datum, arrangement en prijs per persoon worden afgewezen',
    status: 'classified',
    layers: ['html_parser'],
    input: {
      page: page(`<h2>Menu</h2>${list(['Fictieve soep', '7,50'], ['Fictieve salade', '13,50'], ['Fictief broodje', '8,50'], ['+ extra fictieve saus', '2,50'], ['Fictieve keuken open vanaf 12.00', null], ['Fictief feest 24.12', '45,00'], ['Fictief 3-gangen arrangement', '45,00'], ['Fictieve borrelplank per persoon', '12,50'])}`),
    },
    expected: {
      recognized: true,
      menus: [{ title: null, structure: 'normalized', sections: [[['Menu'], 3, false]] }],
      parserRejected: ['modifier', 'clock_time', 'date', 'service_unit'],
      mustNot: { dishRecognised: ['+ extra fictieve saus', 'Fictief feest 24.12', 'Fictief 3-gangen arrangement', 'Fictieve borrelplank per persoon'] },
    },
  },
  {
    id: 'STRUCT-014',
    name: 'Gevonden menupagina',
    status: 'classified',
    layers: ['source_analysis', 'batch_status'],
    input: {
      homepage: page('<nav><a href="/menukaart">Menukaart</a></nav><p>Welkom.</p>'),
      pages: { '/menukaart': { status: 'html', html: page(`<h2>Menu</h2>${list(['Fictieve soep', '7,50'], ['Fictieve salade', '13,50'], ['Fictief broodje', '8,50'])}`) } },
    },
    expected: { recognized: true, batchLabel: 'Menukaart gevonden · controle nodig', notes: ['Menukaart herkend uit de HTML'] },
  },
  {
    id: 'STRUCT-015',
    name: 'Afgewezen pagina: gelezen, maar geen menukaart',
    status: 'classified',
    layers: ['source_analysis', 'batch_status'],
    input: {
      homepage: page('<nav><a href="/menukaart">Menukaart</a></nav><p>Welkom.</p>'),
      pages: { '/menukaart': { status: 'html', html: page(`<h2>Openingstijden</h2>${list(['Maandag t/m vrijdag 12.00 - 22.00', null])}<p>Onze fictieve kaart wisselt per seizoen.</p>`) } },
    },
    expected: { recognized: false, batchLabel: 'Geen bruikbare menukaart gevonden', parserRejected: ['non_menu_section'] },
  },
  {
    id: 'STRUCT-016',
    name: 'Niet-beschikbare pagina: robots of fout, geen menukaart',
    status: 'classified',
    layers: ['source_analysis', 'batch_status'],
    input: {
      homepage: page('<nav><a href="/menukaart">Menukaart</a> <a href="/lunchkaart">Lunchkaart</a></nav><p>Welkom.</p>'),
      pages: { '/menukaart': { status: 'blocked' }, '/lunchkaart': { status: 'error' } },
    },
    expected: { recognized: false, batchLabel: 'Geen bruikbare menukaart gevonden', notes: ['niet automatisch raadplegen', 'is mislukt'] },
  },
  {
    id: 'STRUCT-017',
    name: 'Concept, publicatievoorbeeld en export hebben dezelfde structuur (met een keuze voor een verdwenen gerecht)',
    status: 'classified',
    layers: ['hierarchy', 'concept', 'export'],
    input: {
      page: page(`<h1>Fictief seizoensmenu</h1><h2>Diner</h2><h3>Voor</h3>${list(['Fictieve gamba', '14,50'], ['Fictieve burrata', '12,00'])}<h3>Hoofd</h3>${list(['Fictieve zeebaars', '24,50'])}`),
      live: { 'struct-menukaart': { subtitle: 'Menukaart', categories: [{ name: 'Hoofd', path: ['Diner', 'Hoofd'], items: [{ name: 'Fictieve zeebaars', priceValue: 23.5, tags: ['aanbevolen'] }, { name: 'Fictieve kaasplank', priceValue: 12 }] }] } },
      edits: { removed: { 'diner|fictieve kaasplank': 'keep' } },
    },
    expected: {
      recognized: true,
      menus: [{ title: 'Fictief seizoensmenu', structure: 'normalized', sections: [[['Diner', 'Voor'], 2, false], [['Diner', 'Hoofd'], 1, false]] }],
      statuses: { new: 2, price_changed: 1 },
      blockers: [],
      export: true,
    },
  },
  {
    id: 'STRUCT-018',
    name: 'JSON-LD-menu met geneste secties (hiërarchie nog niet verliesvrij)',
    status: 'unclassified',
    layers: ['source_analysis', 'hierarchy'],
    note: 'Productkeuze open: JSON-LD-secties worden nog als platte rubrieknaam samengevoegd; alleen het HTML-pad is verliesvrij.',
    input: {
      page: page(`<script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Menu',
        name: 'Fictief menu',
        hasMenuSection: [{ name: 'Diner', hasMenuSection: [{ name: 'Voor', hasMenuItem: [{ name: 'Fictieve gamba', offers: { price: '14.50' } }] }] }],
      })}</script><p>Welkom.</p>`),
    },
    expected: {},
  },
  {
    id: 'STRUCT-019',
    name: 'Tabelrijen; een prijs zonder naam is geen gerecht',
    status: 'classified',
    layers: ['html_parser', 'source_analysis'],
    input: site('<h2>Wijnen</h2><table><tr><td>Fictieve rode wijn</td><td>€ 5,50</td></tr><tr><td>Fictieve witte wijn</td><td>€ 5,00</td></tr><tr><td>Fictieve rosé</td><td>€ 5,25</td></tr><tr><td></td><td>€ 4,50</td></tr></table>'),
    expected: {
      recognized: true,
      menus: [{ title: null, structure: 'normalized', sections: [[['Wijnen'], 3, false]] }],
      evidencePatterns: ['table_row'],
      parserRejected: ['missing_name'],
    },
  },
  {
    id: 'STRUCT-020',
    name: 'Definitielijst (naam en prijs in dt/dd)',
    status: 'classified',
    layers: ['html_parser', 'source_analysis'],
    input: site('<h2>Desserts</h2><dl><dt>Fictief ijs</dt><dd>€ 6,50</dd><dt>Fictieve taart</dt><dd>€ 5,75</dd><dt>Fictieve mousse</dt><dd>€ 7,00</dd></dl>'),
    expected: { recognized: true, menus: [{ title: null, structure: 'normalized', sections: [[['Desserts'], 3, false]] }], evidencePatterns: ['definition'] },
  },
  {
    id: 'STRUCT-021',
    name: 'Herhaalde gerechtkaarten met naam- en prijselement',
    status: 'classified',
    layers: ['html_parser', 'source_analysis'],
    input: site(
      `<h2>Borrel</h2>${[['Fictieve bitterballen', '7,50'], ['Fictieve nachos', '9,00'], ['Fictieve olijven', '4,50']]
        .map(([name, price]) => `<div class="menu-item"><span class="name">${name}</span><span class="price">€ ${price}</span></div>`)
        .join('')}`
    ),
    expected: { recognized: true, menus: [{ title: null, structure: 'normalized', sections: [[['Borrel'], 3, false]] }], evidencePatterns: ['repeated_card'] },
  },
  {
    id: 'STRUCT-022',
    name: 'Regels met br en een eigen prijselement (line_break_list)',
    status: 'classified',
    layers: ['html_parser', 'source_analysis'],
    input: site('<h2>Koud</h2><p>Fictieve salade <strong>14,50</strong><br>Fictief tartaar <strong>16,50</strong><br>Fictieve carpaccio <strong>13</strong></p>'),
    expected: { recognized: true, menus: [{ title: null, structure: 'normalized', sections: [[['Koud'], 3, false]] }], evidencePatterns: ['line_break_list'] },
  },
  {
    id: 'STRUCT-023',
    name: 'HTML-entiteiten in titel, rubriek en gerecht worden één keer gedecodeerd, tot in de export',
    status: 'classified',
    layers: ['html_parser', 'source_analysis', 'concept', 'export'],
    input: site(
      '<h1>Fictief caf&eacute;</h1><h2>Lunch &amp; diner</h2>' +
        '<ul><li>Fictieve &lsquo;vangst van de dag&rsquo; <span>€ 9,50</span></li><li>Fictieve cr&egrave;me br&ucirc;l&eacute;e <span>€ 8,50</span></li>' +
        '<li>Fictieve vis &#38; friet <span>€ 17,00</span></li><li>Fictief &amp;lsquo;letterlijk&amp;rsquo; <span>€ 6,00</span></li></ul>'
    ),
    expected: {
      recognized: true,
      menus: [{ title: 'Fictief café', structure: 'normalized', sections: [[['Lunch & diner'], 4, false]] }],
      lineStatuses: [
        ['', 'Fictieve ‘vangst van de dag’', 'new'],
        ['', 'Fictieve crème brûlée', 'new'],
        ['', 'Fictieve vis & friet', 'new'],
        ['', 'Fictief &lsquo;letterlijk&rsquo;', 'new'], // decoded once: an escaped reference stays text
      ],
      export: true,
      mustNot: { dishRecognised: ['Fictieve &lsquo;vangst van de dag&rsquo;', 'Fictieve cr&egrave;me br&ucirc;l&eacute;e'], pathLabelIncludes: ['&amp;', '&eacute;'] },
    },
  },
]

module.exports = { STRUCTURE_CORPUS_VERSION, LAYERS, HOST, STRUCTURE_CASES }
