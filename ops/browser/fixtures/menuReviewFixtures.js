'use strict';

// Fictional fixtures for the #59 browser check of the EXISTING batch import and
// menu-review UI. They are generated through the real product helpers
// (summarizeRecognisedMenu, buildMenuConcept, buildExtractionResult) so the
// browser sees the same shapes the server sends. No production data, identity,
// credential or URL is used; every URL is on the .invalid TLD.

const { summarizeRecognisedMenu, buildMenuConcept, storedConceptInput, recognisedLines } = require('../../../src/lib/menuConcept');
const { uncertainSections } = require('../../../src/lib/menuStructureReview');
const {
  adviceRecord,
  sourceFragments,
  storedAdviceView,
  validateAdvice,
} = require('../../../src/lib/menuStructureAdvice');

const { buildTriageView } = require('../../../src/lib/sourceTriage');
const { buildExtractionResult } = require('../../../src/lib/menuExtractionResult');
const {
  buildProductReviewView,
  summarizeProductMenu,
  readConceptProduct,
  PRODUCT_READ_ONLY_MESSAGE,
  UNSUPPORTED_MESSAGE,
  INVALID_MESSAGE,
} = require('../../../src/lib/menuProductIntegrationV2');

const BATCH_ID = 'batch-fictief-0001';
const RESTAURANT = { id: '9001', name: 'Fictief Brasserie Noord', known: true };
const SOURCE_URL = 'https://fictief-brasserie.invalid/menu';
const FOUND_URL = 'https://fictief-bron.invalid/menu';

const evidence = (locator, quote) => ({ sourceId: 'src-fictief-1', locator, quote });

const reviewMenus = [
  {
    title: 'Fictief Lunch',
    sourceId: 'src-fictief-1',
    categories: [
      {
        name: 'Koud',
        path: ['Fictief Lunch', 'Koud'],
        sourcePath: ['LUNCH', 'KOUD'],
        items: [
          { name: 'Fictieve salade', desc: 'Fictieve groenten en fictieve dressing', price: '12.50', evidence: evidence('LUNCH > KOUD > regel 1', 'Fictieve salade 12,50') },
          { name: 'Fictieve soep', price: '8.00', evidence: evidence('LUNCH > KOUD > regel 2', 'Fictieve soep 8,00') },
          { name: 'Fictieve soep', price: '8.00', evidence: evidence('LUNCH > KOUD > regel 3', 'Fictieve soep 8,00') },
        ],
      },
      {
        name: 'Warm',
        path: ['Fictief Lunch', 'Warm'],
        sourcePath: ['LUNCH', 'WARM'],
        uncertain: true,
        items: [
          { name: 'Fictieve pasta', price: '14.50', evidence: evidence('LUNCH > WARM > regel 1', 'Fictieve pasta 14,50') },
          { name: 'Fictief stoofpotje', priceText: '9.50 / 18.00', priceStatus: 'multiple_undecomposed', evidence: evidence('LUNCH > WARM > regel 2', 'Fictief stoofpotje 9,50 / 18,00') },
        ],
      },
    ],
  },
  {
    title: 'Fictief Diner',
    sourceId: 'src-fictief-1',
    categories: [
      {
        name: 'Voor',
        path: ['Fictief Diner', 'Voor'],
        sourcePath: ['DINER', 'VOOR'],
        uncertain: true,
        items: [{ name: 'Fictieve burrata', price: '13.00', evidence: evidence('DINER > VOOR > regel 1', 'Fictieve burrata 13,00') }],
      },
      {
        name: 'Hoofd',
        path: ['Fictief Diner', 'Hoofd'],
        sourcePath: ['DINER', 'HOOFD'],
        items: [
          { name: 'Fictieve zeebaars', price: '24.00', evidence: evidence('DINER > HOOFD > regel 1', 'Fictieve zeebaars 24,00') },
          { name: 'Fictieve kaasplank', desc: 'Fictieve kazen zonder bronprijs' },
        ],
      },
    ],
  },
];

const limitations = ['Fictief: arrangementen en supplementen worden niet als gerecht opgeslagen.'];
const extraction = buildExtractionResult({
  sourceInventory: [{ id: 'src-fictief-1', url: SOURCE_URL, kind: 'html', status: 'read', contentHash: 'fictief-hash', itemCount: 8 }],
  menus: reviewMenus,
  unknownMenuContexts: [],
  limitations,
});
const menu = summarizeRecognisedMenu(reviewMenus);
const concept = buildMenuConcept({ menus: reviewMenus, liveLines: [], edits: {} });

// A fictional v2 view: one dish, one glass/bottle wine, one unresolved
// supplement. It is built through the same sanitized reader the app uses.
const v2Product = {
  schemaVersion: 'menu-extraction-product/v2',
  menus: [
    {
      id: 'menu-1',
      title: 'Fictief Diner',
      sourceId: 'src-fictief-1',
      variant: { id: 'variant-1', label: 'Diner', sourceLabel: 'DINNER', locale: 'nl', location: null, order: 1 },
      categories: [
        {
          id: 'cat-1',
          name: 'Hoofd',
          path: ['Diner', 'Hoofd'],
          sourcePath: ['DINNER', 'HOOFD'],
          kind: 'section',
          choice: null,
          uncertain: false,
          items: [
            {
              id: 'item-1',
              kind: 'beverage',
              name: 'Fictieve wijn',
              description: 'Fictief, per glas of fles',
              price: { status: 'multiple_undecomposed', amountMinorUnits: null, currency: null, text: 'Glas 6,50 / Fles 25,00', isFrom: false, evidence: null },
              priceVariants: [
                { id: 'pv-1', label: 'Glas', kind: 'glass', amountMinorUnits: 650, currency: 'EUR', text: null, isSupplement: false, perPerson: false, evidence: { sourceId: 'src-fictief-1', locator: 'regel 2', quote: 'Fictieve wijn Glas 6,50 Fles 25,00' }, origin: 'extracted' },
                { id: 'pv-2', label: 'Fles', kind: 'bottle', amountMinorUnits: 2500, currency: 'EUR', text: null, isSupplement: false, perPerson: false, evidence: { sourceId: 'src-fictief-1', locator: 'regel 2', quote: 'Fictieve wijn Glas 6,50 Fles 25,00' }, origin: 'extracted' },
              ],
              primaryPriceRef: null,
              supplementOf: null,
              choiceGroupRef: null,
              allergens: { status: 'unknown', codes: [], sourceText: null, sourceTextStatus: 'unknown' },
              dietaryLabels: [],
              availability: null,
              evidence: { sourceId: 'src-fictief-1', locator: 'regel 2', quote: 'Fictieve wijn Glas 6,50 Fles 25,00' },
              origins: { name: 'extracted', description: 'extracted', price: 'unknown', allergens: 'unknown', supplementOf: 'unknown', availability: 'unknown', kind: 'extracted' },
            },
            {
              id: 'item-2',
              kind: 'supplement',
              name: 'Extra fictief brood',
              description: null,
              price: { status: 'known', amountMinorUnits: 200, currency: 'EUR', text: null, isFrom: false, evidence: { sourceId: 'src-fictief-1', locator: 'regel 3', quote: 'Extra fictief brood 2,00' } },
              priceVariants: [],
              primaryPriceRef: null,
              supplementOf: { status: 'unresolved', label: 'Bij de maaltijd', context: { menuId: 'menu-1', categoryId: 'cat-1' }, limitation: 'Geen expliciet doelitem in de bron.' },
              choiceGroupRef: null,
              allergens: { status: 'unknown', codes: [], sourceText: null, sourceTextStatus: 'unknown' },
              dietaryLabels: [],
              availability: null,
              evidence: { sourceId: 'src-fictief-1', locator: 'regel 3', quote: 'Extra fictief brood 2,00' },
              origins: { name: 'extracted', description: 'unknown', price: 'extracted', allergens: 'unknown', supplementOf: 'extracted', availability: 'unknown', kind: 'extracted' },
            },
          ],
        },
      ],
    },
  ],
  rejected: [],
  coverage: { status: 'partial', sourcesRead: 1, pagesRead: 2, itemsExtracted: 2, unreadSources: [], limitations: ['Fictieve v2-beperking: één pagina was onleesbaar.'] },
};
const v2View = buildProductReviewView(v2Product);
const v2Menu = summarizeProductMenu(v2View);

const v2Item = item({
  menu: v2Menu,
  product: v2View,
  productBlocked: true,
  productReason: 'product_v2_read_only',
  productSchemaVersion: 'menu-extraction-product/v2',
  coverage: v2View.coverage,
  limitations: ['Fictieve v2-beperking: één pagina was onleesbaar.'],
  attentionGroups: [],
  notes: ['Fictief: v2-envelope, alleen-lezen.'],
  concept: {
    menus: [],
    product: v2View,
    productBlocked: true,
    productReason: 'product_v2_read_only',
    productSchemaVersion: 'menu-extraction-product/v2',
    liveLines: [],
    latest: null,
  },
});


function item(overrides) {
  return {
    position: 1,
    url: 'https://fictief-restaurant.invalid/',
    key: 'confirmed',
    label: 'Bron bevestigd',
    role: 'positive',
    icon: 'check',
    terminal: true,
    actions: ['review_manually'],
    text: null,
    high: false,
    jobId: 'job-fictief-1',
    restaurant: RESTAURANT,
    foundUrl: FOUND_URL,
    menu,
    coverage: extraction.coverage,
    limitations,
    attentionGroups: extraction.attentionGroups,
    notes: ['Fictief: 1 arrangementregel is uitgesloten en gemeld.'],
    concept: { menus: reviewMenus, liveLines: [], latest: null },
    ...overrides,
  };
}

function detailWith(items) {
  return {
    batch: {
      id: BATCH_ID,
      created_at: '2026-10-18T09:00:00.000Z',
      closed_at: '2026-10-18T09:01:00.000Z',
      close_reason: 'completed',
      item_count: items.length,
      is_starter: true,
    },
    items,
    summary: {
      total: items.length,
      done: items.length,
      running: 0,
      queued: 0,
      open: 0,
      highCertainty: 0,
      byAction: { review_manually: items.length },
    },
  };
}

const reviewDetail = detailWith([item()]);

// ── Uncertain section structure (#59 review 6307703713) ─────────────────────
//
// Two menu variants whose sections the extractor marks uncertain. The paths
// are built exactly like a receipt stores them (menu title + relative
// category path), and `required` comes from the same helper the server uses,
// so the fixture cannot invent a review shape the product does not produce.
const structureMenus = [
  {
    title: 'Fictief Lunch',
    structure: 'uncertain',
    categories: [
      {
        name: 'Koud',
        path: ['Koud'],
        sourcePath: ['LUNCH', 'KOUD'],
        locator: 'paneel Lunch, regel 1',
        uncertain: true,
        items: [{ name: 'Fictieve salade', price: '12.50', evidence: evidence('LUNCH > KOUD > regel 1', 'Fictieve salade 12,50') }],
      },
      {
        name: 'Warm',
        path: ['Warm'],
        sourcePath: ['LUNCH', 'WARM'],
        items: [{ name: 'Fictieve pasta', price: '14.50', evidence: evidence('LUNCH > WARM > regel 1', 'Fictieve pasta 14,50') }],
      },
    ],
  },
  {
    title: 'Fictief Diner',
    structure: 'uncertain',
    categories: [
      {
        name: 'Voor',
        path: ['Voor'],
        sourcePath: ['DINNER', 'VOOR'],
        locator: 'paneel Diner, regel 1',
        uncertain: true,
        items: [{ name: 'Fictieve burrata', price: '13.00', evidence: evidence('DINNER > VOOR > regel 1', 'Fictieve burrata 13,00') }],
      },
      {
        name: 'Hoofd',
        path: ['Hoofd'],
        sourcePath: ['DINNER', 'HOOFD'],
        items: [{ name: 'Fictieve zeebaars', price: '24.00', evidence: evidence('DINNER > HOOFD > regel 1', 'Fictieve zeebaars 24,00') }],
      },
    ],
  },
];
const structureMenu = summarizeRecognisedMenu(structureMenus);
const structureSections = uncertainSections(structureMenus);
const structureItem = item({
  key: 'needs_review',
  label: 'Controle nodig',
  role: 'old',
  icon: 'warning',
  high: false,
  actions: ['review_structure'],
  text: 'Er is een menukaart gevonden, maar de rubriekindeling is onzeker. Controleer elke onzekere rubriek hieronder en handhaaf of corrigeer hem; pas daarna kun je de bron bevestigen.',
  menu: structureMenu,
  concept: null,
  foundUrl: FOUND_URL,
  notes: ['Fictief: de rubriekindeling is onzeker; elke rubriek is apart beoordeeld.'],
  structureReview: {
    eligible: true,
    foundUrl: FOUND_URL,
    receiptHash: 'a'.repeat(64),
    storeAvailable: true,
    required: structureSections,
    treated: [],
    handledCount: 0,
  },
});
const structureDetail = detailWith([structureItem]);
const structureReadOnlyDetail = (() => {
  const detail = JSON.parse(JSON.stringify(structureDetail));
  detail.batch.is_starter = false;
  for (const entry of detail.items) entry.actions = [];
  return detail;
})();

// ── BE-30 (#72): diezelfde controle met gerechten, bronpagina en AI-advies ───
//
// Het fictieve voorbeeld uit de opdracht: acht onzekere rubrieken (zoals de
// praktijktest bij Smelt), een pdf-bron met paginanummers en een opgeslagen
// advies voor zes van de acht rubrieken. Het advies komt door dezelfde
// keuring als in de app (validateAdvice met de bewijscontrole), dus de fixture
// kan geen vorm tonen die het product niet produceert.
const STRUCTURE8_RECEIPT_HASH = 'c'.repeat(64);
const STRUCTURE8_SOURCE = 'https://fictief-smelt.invalid/menukaart.pdf';
const structure8Menus = [
  {
    title: 'Smelt (fictief)',
    structure: 'uncertain',
    sourceUrl: STRUCTURE8_SOURCE,
    categories: [
      {
        name: 'Voorgerechten',
        path: ['Voorgerechten'],
        sourcePath: ['SMELT', 'VOORGERECHTEN'],
        locator: 'pdf:3',
        uncertain: true,
        items: [
          { name: 'Fictieve burrata', price: '13.00', evidence: evidence('pdf:3:item:1', 'Fictieve burrata 13,00') },
          { name: 'Fictieve soep van de dag', price: '8.50', evidence: evidence('pdf:3:item:2', 'Fictieve soep van de dag 8,50') },
        ],
      },
      {
        name: 'Hoofdgerechten',
        path: ['Hoofdgerechten'],
        sourcePath: ['SMELT', 'HOOFDGERECHTEN'],
        locator: 'pdf:4',
        uncertain: true,
        items: [
          { name: 'Fictieve zeebaars', price: '24.00', evidence: evidence('pdf:4:item:1', 'Fictieve zeebaars 24,00') },
          { name: 'Fictieve risotto', price: '19.50', evidence: evidence('pdf:4:item:2', 'Fictieve risotto 19,50') },
        ],
      },
      {
        name: 'Desserts',
        path: ['Desserts'],
        sourcePath: ['SMELT', 'NAGERECHTEN'],
        locator: 'pdf:5',
        uncertain: true,
        items: [
          { name: 'Fictieve panna cotta', price: '7.50', evidence: evidence('pdf:5:item:1', 'Fictieve panna cotta 7,50') },
          { name: 'Fictief kaasbord', price: '11.00', evidence: evidence('pdf:5:item:2', 'Fictief kaasbord 11,00') },
        ],
      },
      {
        name: 'Dranken',
        path: ['Dranken'],
        sourcePath: ['SMELT', 'DRANKEN'],
        locator: 'pdf:8',
        uncertain: true,
        items: [
          { name: 'Fictieve huiswijn', price: '5.00', evidence: evidence('pdf:8:item:1', 'Fictieve huiswijn 5,00') },
          { name: 'Fictief mineraalwater', price: '3.50', evidence: evidence('pdf:8:item:2', 'Fictief mineraalwater 3,50') },
        ],
      },
    ],
  },
  {
    title: 'Smelt lunch (fictief)',
    structure: 'uncertain',
    sourceUrl: STRUCTURE8_SOURCE,
    categories: [
      {
        name: 'Lunchgerechten',
        path: ['Lunchgerechten'],
        sourcePath: ['LUNCH', 'LUNCHGERECHTEN'],
        locator: 'pdf:11',
        uncertain: true,
        items: [
          { name: 'Fictief broodje kaas', price: '8.00', evidence: evidence('pdf:11:item:1', 'Fictief broodje kaas 8,00') },
          { name: 'Fictieve tosti', price: '6.50', evidence: evidence('pdf:11:item:2', 'Fictieve tosti 6,50') },
        ],
      },
      {
        name: 'Salades',
        path: ['Salades'],
        sourcePath: ['LUNCH', 'SALADES'],
        locator: 'pdf:12',
        uncertain: true,
        items: [{ name: 'Fictieve salade niçoise', price: '14.00', evidence: evidence('pdf:12:item:1', 'Fictieve salade niçoise 14,00') }],
      },
      {
        name: 'Soepen',
        path: ['Soepen'],
        sourcePath: ['LUNCH', 'SOEPEN'],
        locator: 'pdf:13',
        uncertain: true,
        items: [{ name: 'Fictieve tomatensoep', price: '7.00', evidence: evidence('pdf:13:item:1', 'Fictieve tomatensoep 7,00') }],
      },
      {
        name: 'Bijgerechten',
        path: ['Bijgerechten'],
        sourcePath: ['LUNCH', 'BIJGERECHTEN'],
        locator: 'pdf:14',
        uncertain: true,
        items: [{ name: 'Fictieve friet', price: '4.00', evidence: evidence('pdf:14:item:1', 'Fictieve friet 4,00') }],
      },
    ],
  },
];
const structure8Sections = uncertainSections(structure8Menus);

const structure8Advice = (() => {
  const fragments = sourceFragments(structure8Menus);
  // Each advice quotes the first dish line of its own section, exactly as the
  // receipt stored it; a quote that is not literal is rejected.
  const quotes = new Map();
  structure8Menus.forEach((menu, m) => {
    menu.categories.forEach((category, c) => quotes.set(`${m}.${c}`, category.items[0].evidence.quote));
  });
  const output = {
    sections: structure8Sections.slice(0, 6).map((section, index) => ({
      rubriekId: section.id,
      decision: index % 4 === 2 ? 'correct' : 'keep',
      correctedPath: index % 4 === 2 ? [section.path[0], 'Gecorrigeerde rubriek'] : null,
      confidence: index % 2 === 0 ? 'hoog' : 'midden',
      quote: quotes.get(section.id),
    })),
  };
  const { advices, rejected } = validateAdvice({ sections: structure8Sections, fragments, output });
  const record = adviceRecord({
    jobId: 'job-fictief-72',
    receiptId: 'receipt-fictief-72',
    receiptHash: STRUCTURE8_RECEIPT_HASH,
    advices,
    rejected,
    ai: {
      label: 'Gelezen door AI',
      aiName: 'Claude (Haiku 5.5)',
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
      requestId: 'req-fictief-72',
    },
    cost: { eurCents: 3, known: true },
    now: new Date('2026-10-25T10:00:00Z'),
    readId: 'advice-fictief-72',
    outcome: 'advised',
  });
  return { record, view: storedAdviceView(record, STRUCTURE8_RECEIPT_HASH) };
})();

const structure8Review = (advice) => ({
  eligible: true,
  foundUrl: STRUCTURE8_SOURCE,
  receiptHash: STRUCTURE8_RECEIPT_HASH,
  storeAvailable: true,
  required: structure8Sections,
  treated: [],
  handledCount: 0,
  advice: advice || null,
});
const structure8Item = item({
  key: 'needs_review',
  label: 'Controle nodig',
  role: 'old',
  icon: 'warning',
  high: false,
  actions: ['review_structure'],
  text: 'Er is een menukaart gevonden, maar de rubriekindeling is onzeker. Controleer elke onzekere rubriek hieronder en handhaaf of corrigeer hem; pas daarna kun je de bron bevestigen.',
  menu: summarizeRecognisedMenu(structure8Menus),
  concept: null,
  foundUrl: STRUCTURE8_SOURCE,
  notes: ['Fictief: acht onzekere rubrieken, zoals in de praktijktest.'],
  structureReview: structure8Review(null),
});
const structure8AdviceItem = item({
  ...structure8Item,
  structureReview: structure8Review(structure8Advice.view),
});
const structure8Detail = detailWith([structure8Item]);
const structure8AdviceDetail = detailWith([structure8AdviceItem]);

const partialItem = item({

  key: 'no_menu',
  label: 'Geen bruikbare menukaart',
  role: 'neutral',
  icon: 'warning',
  text: 'De menukaart is gevonden, maar er zijn geen gerechten met een betrouwbare prijs herkend.',
  menu: null,
  concept: null,
  foundUrl: null,
  coverage: { status: 'candidate_without_items', itemCount: 0, readCount: 1 },
  attentionGroups: [],
});

// A fictional source whose only menu is an image/scan. The shape is exactly the
// one src/lib/batchAnalysis.js derives: no success, no confirm, a visible reason
// and the two human routes (Bronnen beoordelen / URL aanpassen).
const imageOnlyItem = item({
  key: 'image_only',
  label: 'Menu alleen als afbeelding · lees met AI of met de hand',
  role: 'blocked',
  icon: 'warning',
  terminal: true,
  actions: ['review_source', 'adjust_url'],
  text: 'De menukaart is alleen als afbeelding beschikbaar. Automatisch is er niets als gerecht opgeslagen. Lees de afbeelding met AI of voeg de gerechten handmatig toe.',
  reason: 'image_only_menu',
  menu: null,
  concept: null,
  foundUrl: null,
  coverage: { status: 'no_items', sourcesRead: 1, pagesRead: 1, itemsExtracted: 0, unreadSources: [], limitations: ['Fictief: alleen afbeeldingen.'] },
  attentionGroups: [],
  limitations: ['Menukaart lijkt alleen als afbeelding beschikbaar op https://fictief-brasserie.invalid/menu (2 afbeelding(en)); beeldanalyse/OCR is niet geconfigureerd.'],
  notes: [],
});

// The existing Bronnen beoordelen page, built through the same view builder the
// server uses. One known restaurant is enough to prove the follow-up route and
// the preselection; no proposal is pre-filled.
const triagePayload = (() => {
  const view = buildTriageView({
    queue: {
      rows: [
        {
          restaurantId: RESTAURANT.id,
          name: RESTAURANT.name,
          wijk: 'Centrum',
          domain: 'fictief-brasserie.example.com',
          source: 'reachable',
          menu: 'not_assessed',
          checkedAt: '2026-10-18T09:01:00.000Z',
          reason: null,
        },
      ],
      notInQueue: [],
    },
    restaurants: { [RESTAURANT.id]: { name: RESTAURANT.name, website: 'https://fictief-brasserie.example.com/' } },
    proposals: [],
    viewerId: 'fixture-user',
    proposalsAvailable: true,
  });
  return {
    city: 'Breda',
    restaurants: view.restaurants,
    proposals_available: true,
    proposal_limit_reached: false,
    orphan_proposals: view.orphanProposals,
    unattributed_checks: 0,
    job_limit_reached: false,
  };
})();

const overview = (detail) => ({
  daily: { used: detail ? 1 : 0, limit: 25 },
  own_open_batch_id: null,
  recent_batches: detail
    ? [{ id: BATCH_ID, created_at: detail.batch.created_at, closed_at: detail.batch.closed_at, close_reason: 'completed', item_count: detail.batch.item_count, is_own: detail.batch.is_starter }]
    : [],
  detail,
});

function readOnlyDetail() {
  const detail = JSON.parse(JSON.stringify(reviewDetail));
  detail.batch.is_starter = false;
  for (const entry of detail.items) {
    entry.actions = [];
    entry.high = false;
  }
  return detail;
}

// ── Existing concept list + detail routes (#59 review 6295223157) ───────────
//
// Four fictional lineages for the REAL /internal/menu-concepts list and
// /internal/menu-concepts/[id] pages. Each detail payload is built through the
// same reader the server handlers use (`readConceptProduct`,
// `buildProductReviewView`, `storedConceptInput`, `buildMenuConcept`), so the
// browser cannot be shown a shape the product does not produce. The ids are
// fictional and stable; `conceptDetails` is keyed by the route segment, so a
// click that selects the wrong row is detectable instead of masked.

const CONCEPT_IDS = {
  v1: 'concept-v1-0001',
  v2: 'concept-v2-0002',
  invalid: 'concept-invalid-0003',
  empty: 'concept-empty-0004',
};
const CONCEPT_RESTAURANTS = {
  v1: 'Fictief Concept Lunch',
  v2: 'Fictief Concept Diner',
  invalid: 'Fictief Concept Onbekend',
  empty: 'Fictief Concept Leeg',
};
const CONCEPT_CREATED = {
  v1: '2026-10-18T09:00:00.000Z',
  v2: '2026-10-18T09:05:00.000Z',
  invalid: '2026-10-18T09:10:00.000Z',
  empty: '2026-10-18T09:15:00.000Z',
};

const v1Captured = {
  title: CONCEPT_RESTAURANTS.v1,
  categories: [
    {
      name: 'Voorgerechten',
      path: [CONCEPT_RESTAURANTS.v1, 'Voorgerechten'],
      sourcePath: ['LUNCH', 'VOOR'],
      items: [
        { from: '0.0.0', name: 'Fictieve tomatensoep', price: '6,50', evidence: evidence('LUNCH > VOOR > regel 1', 'Fictieve tomatensoep 6,50') },
        { from: '0.0.1', name: 'Fictieve salade', desc: 'Fictieve groenten', price: '9,00', evidence: evidence('LUNCH > VOOR > regel 2', 'Fictieve salade 9,00') },
      ],
    },
    {
      name: 'Hoofdgerechten',
      path: [CONCEPT_RESTAURANTS.v1, 'Hoofdgerechten'],
      sourcePath: ['LUNCH', 'HOOFD'],
      items: [{ from: '0.1.0', name: 'Fictieve pasta', price: '15,50', evidence: evidence('LUNCH > HOOFD > regel 1', 'Fictieve pasta 15,50') }],
    },
  ],
};
const v1Stored = storedConceptInput(v1Captured);
const v1Concept = buildMenuConcept({ menus: v1Stored.menus, liveLines: [], edits: v1Stored.edits });
const v1OriginLines = Object.fromEntries(
  recognisedLines(v1Stored.menus).map((line) => [line.id, { name: line.name, desc: line.desc, price: line.price, category: line.category }])
);
const v1Preview = {
  concept: { key: '9002-lunch', entry: { title: CONCEPT_RESTAURANTS.v1, categories: v1Captured.categories } },
  current: [],
};


// The raw stored v2 envelope: exactly what a read-only row may contain.
const v2Captured = v2Product;
const emptyCaptured = {
  schemaVersion: 'menu-extraction-product/v2',
  menus: [],
  rejected: [],
  coverage: { status: 'no_items', sourcesRead: 1, pagesRead: 1, itemsExtracted: 0, unreadSources: [], limitations: ['Fictief: geen leesbare gerechten.'] },
};
// A versioned-looking array without a schemaVersion is NOT legacy v1 content.
const invalidCaptured = { menus: [{ id: 'menu-1', title: 'Fictief Onbekend', categories: [] }] };

const v2Info = readConceptProduct(v2Captured);
const emptyInfo = readConceptProduct(emptyCaptured);
const invalidInfo = readConceptProduct(invalidCaptured);

function blockedReason(info) {
  const message = info.reason === 'product_v2_read_only'
    ? PRODUCT_READ_ONLY_MESSAGE
    : info.reason === 'unsupported_schema_version'
      ? UNSUPPORTED_MESSAGE
      : INVALID_MESSAGE;
  return {
    reason: info.reason,
    message,
    problems: info.problems,
    blockedActions: info.blockedActions,
    blockers: info.view ? info.view.blockers : [],
  };
}

function conceptDetail({ id, key, name, captured, info, product, status }) {
  const blocked = Boolean(info && info.kind !== 'v1');
  const createdAt = CONCEPT_CREATED[key];
  return {
    concept: {
      id,
      version: 1,
      latestVersion: 1,
      latestId: id,
      isLatest: true,
      restaurantId: '9002',
      restaurantName: name,
      menuContext: 'lunch',
      sourceUrl: SOURCE_URL,
      createdAt,
      createdBySelf: true,
      originRecorded: true,
      status,
      rejectedBefore: false,
      captured: blocked ? null : captured,
      readOnly: blocked,
      schemaVersion: info && info.schemaVersion ? info.schemaVersion : null,
      blocked: blocked ? blockedReason(info) : null,
    },
    product: blocked && product ? product : null,
    liveLines: [],
    originLines: blocked ? {} : v1OriginLines,
    source: { confirmed: true, blocked: null },
    history: [{ id, version: 1, createdAt, createdBySelf: true, basedOnVersion: null, status, reviews: [] }],
    rejectReasons: { wrong_menu: 'Verkeerde menukaart', broken_source: 'Bron onbruikbaar', other: 'Anders' },
    export: null,
    preview: blocked
      ? { concept: null, current: [], blocked: info.reason, blockers: info.view ? info.view.blockers : [] }
      : v1Preview,
    githubConfigured: false,
  };
}


function conceptRow({ id, key, name, counts, readOnly, schemaVersion, blockedReason: reason, status = 'waiting' }) {
  return {
    id,
    restaurantId: '9002',
    restaurantName: name,
    menuContext: 'lunch',
    version: 1,
    sourceUrl: SOURCE_URL,
    createdAt: CONCEPT_CREATED[key],
    createdBySelf: true,
    status,
    dishCount: counts.dishCount,
    attentionCount: counts.attentionCount,
    blockerCount: counts.blockerCount,
    readOnly,
    schemaVersion,
    blockedReason: reason || null,
  };
}

const conceptList = {
  items: [
    conceptRow({
      id: CONCEPT_IDS.v1,
      key: 'v1',
      name: CONCEPT_RESTAURANTS.v1,
      counts: {
        dishCount: v1Concept.lines.filter((line) => line.status !== 'excluded').length,
        attentionCount: v1Concept.attentionLines.length + v1Concept.removed.length,
        blockerCount: v1Concept.blockers.length,
      },
      readOnly: false,
      schemaVersion: null,
    }),
    conceptRow({
      id: CONCEPT_IDS.v2,
      key: 'v2',
      name: CONCEPT_RESTAURANTS.v2,
      counts: { dishCount: v2Info.view.counts.items, attentionCount: v2Info.view.notes.length, blockerCount: v2Info.view.blockers.length },
      readOnly: true,
      schemaVersion: 'menu-extraction-product/v2',
      blockedReason: v2Info.reason,
    }),
    conceptRow({
      id: CONCEPT_IDS.invalid,
      key: 'invalid',
      name: CONCEPT_RESTAURANTS.invalid,
      counts: { dishCount: 0, attentionCount: 0, blockerCount: 1 },
      readOnly: true,
      schemaVersion: null,
      blockedReason: invalidInfo.reason,
    }),
    conceptRow({
      id: CONCEPT_IDS.empty,
      key: 'empty',
      name: CONCEPT_RESTAURANTS.empty,
      counts: { dishCount: 0, attentionCount: emptyInfo.view.notes.length, blockerCount: emptyInfo.view.blockers.length },
      readOnly: true,
      schemaVersion: 'menu-extraction-product/v2',
      blockedReason: emptyInfo.reason,
    }),
  ],
};

const conceptDetails = {
  [CONCEPT_IDS.v1]: conceptDetail({ id: CONCEPT_IDS.v1, key: 'v1', name: CONCEPT_RESTAURANTS.v1, captured: v1Captured, info: { kind: 'v1' }, product: null, status: 'waiting' }),
  [CONCEPT_IDS.v2]: conceptDetail({ id: CONCEPT_IDS.v2, key: 'v2', name: CONCEPT_RESTAURANTS.v2, captured: v2Captured, info: v2Info, product: v2Info.view, status: 'waiting' }),
  [CONCEPT_IDS.invalid]: conceptDetail({ id: CONCEPT_IDS.invalid, key: 'invalid', name: CONCEPT_RESTAURANTS.invalid, captured: invalidCaptured, info: invalidInfo, product: null, status: 'waiting' }),
  [CONCEPT_IDS.empty]: conceptDetail({ id: CONCEPT_IDS.empty, key: 'empty', name: CONCEPT_RESTAURANTS.empty, captured: emptyCaptured, info: emptyInfo, product: emptyInfo.view, status: 'waiting' }),
};

const conceptScenarios = {
  concepts: { list: conceptList, detail: conceptDetails },
  'concepts-empty': { list: { items: [] }, detail: {} },
  'concepts-error': {
    listStatus: 500,
    listError: 'De menuconcepten konden niet worden geladen.',
    detailStatus: 500,
    detailError: 'Het menuconcept kon niet worden geladen.',
  },
  'concepts-no-access': {
    listStatus: 403,
    listError: 'Alleen interne medewerkers kunnen menuconcepten beoordelen.',
    detailStatus: 403,
    detailError: 'Alleen interne medewerkers kunnen menuconcepten beoordelen.',
  },
};


module.exports = {
  BATCH_ID,
  RESTAURANT,
  SOURCE_URL,
  FOUND_URL,
  CONCEPT_IDS,
  CONCEPT_RESTAURANTS,
  reviewDetail,
  structureItem,
  structureSections,
  structure8Sections,
  structure8Advice,
  imageOnlyItem,
  triagePayload,
  v2Product,
  v2View,
  conceptList,
  conceptDetails,
  scenarios: {
    review: overview(reviewDetail),
    readonly: overview(readOnlyDetail()),
    structure: overview(structureDetail),
    'structure-readonly': overview(structureReadOnlyDetail),
    // BE-30 (#72): acht onzekere rubrieken met gerechten, bronpagina en
    // (in de tweede variant) een opgeslagen AI-advies.
    structure8: overview(structure8Detail),
    'structure8-advice': overview(structure8AdviceDetail),
    empty: overview(null),
    partial: overview(detailWith([partialItem])),
    image_only: { batch: overview(detailWith([imageOnlyItem])), triage: triagePayload },
    triage: { batch: overview(detailWith([imageOnlyItem])), triage: triagePayload },
    v2: overview(detailWith([v2Item])),
    error: null,
    // Lazy: de fictieve import gebruikt de echte productmodules en mag pas
    // draaien nadat die hieronder zijn geladen (geen TDZ bij module-init).
    manual: {
      get manual() {
        return manualImportScenario();
      },
    },
    // #59 / BE-21 "Lees met AI" (Lead review 6380804419): the same fictional
    // reading, but with the price list the source names itself, so the review
    // shows those prices in orde instead of asking for a choice.
    'manual-ai': {
      get manual() {
        return manualImportScenario({ variantsNamed: true });
      },
    },
    // Variant 1 (Lead order 6382189724): a fictional diner card with two lines
    // that no dish covers, plus the review after "Toevoegen" and after
    // "Geen gerecht".
    'manual-coverage': {
      get manual() {
        return manualCoverageScenario();
      },
    },
    // Variant 5 (Lead order 6382953597): dezelfde fictieve stroom met een bron
    // waarin een prijs op een eigen regel staat, een afwijkende prijs (rood), een
    // overgenomen regel (groen), een niet-overgenomen regel (oranje), een
    // afgewezen regel (grijs), een PDF met twee pagina's en een scan zonder tekst.
    'manual-map': {
      get manual() {
        return manualMapScenario();
      },
    },
    ...conceptScenarios,
  },
  expected: {
    conceptBlockers: concept.blockers.map((blocker) => blocker.status),
    itemCount: menu.itemCount,
    categoryCount: menu.categoryCount,
    attentionGroupCount: extraction.attentionGroups.length,
  },
};


// ── #59 fase 2: fictieve handmatige AI-import in drie stappen ───────────────
// Gebouwd met de echte productmodules, zodat de browser precies de vormen ziet
// die de server stuurt. Fictieve bron, fictief antwoord, geen netwerk.

const path = require('node:path');
const { loadMenuExtractionProtocol } = require('../../../src/lib/menuExtractionProtocol');
const { buildImportBundle, bundleMetadata, sourceHashForText } = require('../../../src/lib/manualMenuImportBundle');
const { buildImportPrompt } = require('../../../src/lib/manualMenuImportPrompt');
const { buildImportReport, publicImportReport } = require('../../../src/lib/manualMenuImportImport');
const { decideRow, decideUncoveredLine, decideSourcePriceLine, reviewView, sourceCardView, buildConceptDraft } = require('../../../src/lib/manualMenuImportReview');

function manualImportScenario({ variantsNamed = false } = {}) {
  const protocol = loadMenuExtractionProtocol({ root: path.resolve(__dirname, '..', '..', '..') });
  const text = ['FICTIEF LUNCH', 'Bites', 'Fictieve salade 12,50', 'Fictief glas wijn 4,50', 'Fictief fles wijn 24,00'].join('\n');
  const bundle = buildImportBundle({
    bundleId: 'AI-FICTIEF-0001',
    actorUserId: 'fixture-user',
    restaurantId: RESTAURANT.id,
    restaurantName: RESTAURANT.name,
    fetchedAt: '2026-10-22T12:00:00.000Z',
    sources: [{ id: 'source-1', url: 'https://fictief-brasserie.invalid/menu', kind: 'html', status: 'read', text }],
    protocol,
    now: new Date('2026-10-22T12:00:00.000Z'),
  });
  const evidenceFor = (locator, quote) => ({ sourceId: 'source-1', locator, quote });
  // BB1 (Lead review 6384867373): elk item van een echt opgeslagen AI-antwoord
  // draagt het verplichte `allergens`-object (status unknown, lege lijst) en
  // `isFrom: false`. De fixture gebruikt daarom exact die vorm; een lege of
  // onbekende lijst mag een regel niet afkeuren.
  const realAnswerShape = { isFrom: false, allergens: { status: 'unknown', values: [] } };
  const output = {
    menus: [
      {
        title: 'Fictief Lunch',
        sourceId: 'source-1',
        categories: [
          {
            name: 'Bites',
            items: [
              { name: 'Fictieve salade', priceStatus: 'known', amountMinorUnits: 1250, currency: 'EUR', ...realAnswerShape, evidence: evidenceFor('Bites · 1', 'Fictieve salade 12,50') },
              {
                name: 'Fictief glas wijn',
                priceStatus: 'multiple_undecomposed',
                // W6: unnamed by default (an open "Kies een prijs" row for the
                // manual review); the AI reading uses the named variant case,
                // where the source names every price and the row is in orde.
                priceVariants: variantsNamed
                  ? [
                      { label: 'Glas', amountMinorUnits: 450, currency: 'EUR' },
                      { label: 'Fles', amountMinorUnits: 2400, currency: 'EUR' },
                    ]
                  : [
                      { label: null, amountMinorUnits: 450, currency: 'EUR' },
                      { label: null, amountMinorUnits: 2400, currency: 'EUR' },
                    ],
                ...realAnswerShape,
                evidence: evidenceFor('Bites · 2', 'Fictief glas wijn 4,50'),
              },
              {
                name: 'Fictieve koffie',
                priceStatus: 'known',
                amountMinorUnits: 280,
                currency: 'EUR',
                ...realAnswerShape,
                evidence: evidenceFor('Bites · 9', 'Fictieve koffie 2,80'),
              },
            ],
          },
        ],
      },
    ],
    coverage: { status: 'complete', sourcesRead: 1, pagesRead: 1, itemsExtracted: 3, unreadSources: [], limitations: [] },
  };
  const report = buildImportReport({
    importId: 'fixture-import',
    bundle,
    output,
    aiName: 'Claude',
    now: new Date('2026-10-22T12:05:00.000Z'),
  });
  if (!report.ok) throw new Error(`manual fixture invalid: ${report.code}`);
  // U1/U2 (review 6376543234): een fictief afgekeurd antwoord met dezelfde
  // vorm als de echte 422 van de importroute. Gebouwd met de echte validator en
  // de echte vertaling, zodat de browser precies ziet wat de server stuurt.
  const rejected = buildImportReport({
    importId: 'fixture-import-rejected',
    bundle,
    output: {
      menus: [
        {
          title: 'Fictief Lunch',
          sourceId: 'fictief-bron-2',
          categories: [
            {
              name: 'Bites',
              items: [
                {
                  name: 'Fictieve salade',
                  priceStatus: 'known',
                  amountMinorUnits: 1250,
                  currency: 'EUR',
                  evidence: evidenceFor('Bites · 1', 'Fictieve salade 99,00'),
                },
                {
                  name: 'Fictief glas wijn',
                  priceStatus: 'known',
                  amountMinorUnits: 450,
                  currency: 'EUR',
                  priceVariants: [{ label: 'Glas', amountMinorUnits: 450, currency: 'EUR' }],
                  evidence: evidenceFor('Bites · 2', 'Fictief glas wijn 4,50'),
                },
              ],
            },
          ],
        },
      ],
      coverage: {
        status: 'complete',
        sourcesRead: 1,
        pagesRead: 1,
        itemsExtracted: 9,
        unreadSources: [{ sourceId: 'source-1', locator: 'pagina 1', reason: 'unreadable' }],
        limitations: [],
      },
    },
    aiName: 'Claude',
    now: new Date('2026-10-22T12:06:00.000Z'),
  });
  if (rejected.ok || rejected.code !== 'schema_violation') {
    throw new Error(`manual rejection fixture invalid: ${rejected.code}`);
  }
  const wine = report.rows.find((row) => row.name === 'Fictief glas wijn');
  const coffee = report.rows.find((row) => row.code === 'quote_not_in_source');
  // W6: with a named price list the wine row is already in orde, so only an
  // unnamed multiple price needs the explicit choose step.
  const first =
    wine && wine.code === 'price_variant'
      ? decideRow({ report, decisions: new Map(), decision: { rowId: wine.id, action: 'choose_price', variantIndex: 1 } })
      : { decisions: new Map() };
  const second = decideRow({
    report,
    decisions: first.decisions,
    decision: { rowId: coffee.id, action: 'confirm', reasonCode: 'niet_in_bron', note: 'Fictief op de papieren kaart gezien.' },
  });
  const draft = buildConceptDraft({ report, decisions: second.decisions, restaurantId: RESTAURANT.id });
  // V1/V2 (review 6377050602): hetzelfde fictieve antwoord met een foute telling
  // en een complete-status met limitations. De echte importroute leidt die af
  // vóór de ongewijzigde validator; deze fixture gebruikt dezelfde functies,
  // zodat de browser precies de echte melding ziet.
  const claimed = {
    ...output,
    coverage: {
      ...output.coverage,
      status: 'complete',
      itemsExtracted: 9,
      limitations: ['Fictief: alleen de lunchkaart gelezen'],
    },
  };
  const normalized = buildImportReport({
    importId: 'fixture-import-normalized',
    bundle,
    output: claimed,
    aiName: 'Claude',
    now: new Date('2026-10-22T12:06:00.000Z'),
  });
  if (!normalized.ok) throw new Error(`manual normalized fixture invalid: ${normalized.code}`);
  if (normalized.normalizations.length !== 2) {
    throw new Error(`manual normalized fixture recorded ${normalized.normalizations.length} normalizations`);
  }
  // #59 / BE-21 "Lees met AI" (Lead review 6380804419): the fictional answer of
  // the one AI route, built with the real import/review shapes so the browser
  // shows exactly what the server sends. No provider is contacted.
  const aiName = 'Claude (Haiku 5.5)';
  const ai = {
    status: {
      enabled: true,
      reason: null,
      message: null,
      label: 'Gelezen door AI',
      aiName,
      perCallMaxEurCents: 30,
      monthly: { spentEurCents: 12, limitEurCents: 1000, remainingEurCents: 988, unknownConcepts: 0 },
      budget: { allowed: true, reason: null },
    },
    // W3: the same block without a key or flag, so the calm "AI is niet
    // ingesteld" without a button is observable.
    statusOff: {
      enabled: false,
      reason: 'ai_not_configured',
      message: 'AI is niet ingesteld.',
      label: 'Gelezen door AI',
      aiName,
      perCallMaxEurCents: 30,
      monthly: { spentEurCents: null, limitEurCents: 1000, remainingEurCents: null, unknownConcepts: 0 },
      budget: { allowed: false, reason: 'budget_unavailable' },
    },
    // BB3 (Lead review 6384867373): na een lezing van 4 cent staat de maandregel
    // meteen op het nieuwe totaal. De statusroute antwoordt dit zodra de fictieve
    // lezing is geweest, net als de echte route die het duurzame concept telt.
    statusAfterRead: {
      enabled: true,
      reason: null,
      message: null,
      label: 'Gelezen door AI',
      aiName,
      perCallMaxEurCents: 30,
      monthly: { spentEurCents: 16, limitEurCents: 1000, remainingEurCents: 984, unknownConcepts: 0 },
      budget: { allowed: true, reason: null },
    },
    read: {
      status: 200,
      body: {
        origin: { kind: 'ai_gelezen', label: 'Gelezen door AI', aiName },
        ai: {
          provider: 'anthropic',
          model: 'claude-haiku-5-5',
          readAt: '2026-10-24T12:00:00.000Z',
          label: 'Gelezen door AI',
          protocolVersion: report.technical.protocolVersion,
          protocolHash: report.technical.protocolHash,
          schemaVersion: report.technical.schemaVersion,
          bundleHash: report.bundleHash,
          requestId: 'req_fictief',
          durationMs: 42000,
        },
        cost: { eurCents: 4, known: true, maxEurCents: 30 },
        monthly: { spentEurCents: 16, limitEurCents: 1000, remainingEurCents: 984, unknownConcepts: 0 },
        import: { ...publicImportReport(report), aiName },
        review: reviewView({ report, decisions: new Map(), capture: bundle.sources }),
        summary: { items: report.summary.items, valid: report.summary.valid, needsReview: report.summary.needsReview },
        concept: { id: 'concept-fictief-ai-1', version: 1, unchanged: false },
        state: 'fixture-ai-state',
        validUntil: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      },
    },
  };
  return {
    ai,
    bundle: bundleMetadata(bundle),
    prompt: buildImportPrompt(bundle),
    import: publicImportReport(report),
    // K5: een zichtbare geldigheid in de browserfixture (de echte waarde komt
    // uit het toestandstoken). K3: de bestaande restaurantkeuze op naam.
    validUntil: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    restaurants: [
      { id: RESTAURANT.id, name: RESTAURANT.name, buurt: 'Centrum' },
      { id: '1', name: 'Restaurant Wolfslaar', buurt: 'Wolfslaar' },
    ],
    reviews: [
      reviewView({ report, decisions: new Map(), capture: bundle.sources }),
      reviewView({ report, decisions: first.decisions, capture: bundle.sources }),
      reviewView({ report, decisions: second.decisions, capture: bundle.sources }),
    ],
    // V2: hetzelfde antwoord mét de afgeleide telling en status. Eén review,
    // want dit scenario beoordeelt alleen de melding, niet de beslisstappen.
    normalized: {
      import: publicImportReport(normalized),
      review: reviewView({ report: normalized, decisions: new Map(), capture: bundle.sources }),
    },
    followUpPrompt: {
      text: '# Vervolgvraag over één regel\n\nFictief.\n\n```text\nFictieve brontekst.\n```',
      byteLength: 120,
      rowIds: [coffee.id],
    },
    // U1/U2: dezelfde velden en dezelfde status als de echte importroute geeft
    // bij een afgekeurd antwoord.
    rejection: {
      status: 422,
      body: {
        error: rejected.message,
        reason: rejected.code,
        problems: rejected.problems,
        problemSummary: rejected.problemSummary,
        problemSummaryOmitted: rejected.problemSummaryOmitted,
        recoveryQuestion: rejected.recoveryQuestion,
      },
    },
    saved: {
      concept: { id: 'concept-fictief-import-1', version: 1, unchanged: false },
      provenance: draft.ok ? draft.provenance : null,
    },
  };
}

// ── Variant 1 (Lead order 6382189724): niet-overgenomen bronregels ─────────
// Dezelfde fictieve stroom, maar met een bron waarin twee regels een prijs
// printen die geen enkel gerecht dekt. De drie reviewstanden hieronder zijn met
// de echte productmodules gebouwd: eerst twee open regels, daarna één na
// "Toevoegen" (met het nieuwe gerecht in nalopen), daarna nul na "Geen
// gerecht". Geen netwerk, geen model, geen sleutel.
function manualCoverageScenario() {
  const base = manualImportScenario();
  const protocol = loadMenuExtractionProtocol({ root: path.resolve(__dirname, '..', '..', '..') });
  const text = [
    'FICTIEF DINER',
    'Voorgerechten',
    'Fictieve soep 6,50',
    'Fictieve carpaccio 11,00',
    'Hoofdgerechten',
    'Fictieve steak 24,50',
  ].join('\n');
  const bundle = buildImportBundle({
    bundleId: 'AI-FICTIEF-DEKKING',
    actorUserId: 'fixture-user',
    restaurantId: RESTAURANT.id,
    restaurantName: RESTAURANT.name,
    fetchedAt: '2026-10-24T12:00:00.000Z',
    sources: [{ id: 'source-1', url: 'https://fictief-brasserie.invalid/diner', kind: 'html', status: 'read', text }],
    protocol,
    now: new Date('2026-10-24T12:00:00.000Z'),
  });
  const output = {
    menus: [
      {
        title: 'Fictief Diner',
        sourceId: 'source-1',
        categories: [
          {
            name: 'Voorgerechten',
            items: [
              {
                name: 'Fictieve soep',
                priceStatus: 'known',
                amountMinorUnits: 650,
                currency: 'EUR',
                evidence: { sourceId: 'source-1', locator: 'regel 3', quote: 'Fictieve soep 6,50' },
              },
            ],
          },
        ],
      },
    ],
    coverage: { status: 'complete', sourcesRead: 1, pagesRead: 1, itemsExtracted: 1, unreadSources: [], limitations: [] },
  };
  const report = buildImportReport({
    // Same fictional import id as the manual scenario: the harness only allows
    // these exact fictional paths.
    importId: 'fixture-import',
    bundle,
    output,
    aiName: 'Claude',
    now: new Date('2026-10-24T12:05:00.000Z'),
  });
  if (!report.ok) throw new Error(`coverage fixture invalid: ${report.code}`);
  const capture = bundle.sources;
  const initial = reviewView({ report, decisions: new Map(), capture });
  if (initial.uncovered.total !== 2) {
    throw new Error(`coverage fixture expects two uncovered lines, got ${initial.uncovered.total}`);
  }
  const addedLine = initial.uncovered.lines[0];
  const dismissedLine = initial.uncovered.lines[1];
  const added = decideUncoveredLine({
    report,
    decisions: new Map(),
    bundle,
    decision: { action: 'add_uncovered', lineId: addedLine.id },
  });
  if (!added.ok) throw new Error(`coverage fixture cannot add: ${added.code}`);
  const addedView = reviewView({ report: added.report, decisions: added.decisions, capture });
  if (addedView.uncovered.total !== 1) {
    throw new Error(`coverage fixture expects one uncovered line after adding, got ${addedView.uncovered.total}`);
  }
  const dismissed = decideUncoveredLine({
    report: added.report,
    decisions: added.decisions,
    bundle,
    decision: { action: 'uncovered_not_dish', lineId: dismissedLine.id },
  });
  if (!dismissed.ok) throw new Error(`coverage fixture cannot dismiss: ${dismissed.code}`);
  const done = reviewView({ report: added.report, decisions: dismissed.decisions, capture });
  if (done.uncovered.total !== 0) {
    throw new Error(`coverage fixture expects no uncovered lines at the end, got ${done.uncovered.total}`);
  }
  return {
    ...base,
    bundle: bundleMetadata(bundle),
    prompt: buildImportPrompt(bundle),
    import: publicImportReport(report),
    reviews: [initial, addedView, done],
    coverage: { addedLine, dismissedLine, addedRowName: addedView.rows.find((row) => row.name === 'Fictieve carpaccio') ? 'Fictieve carpaccio' : null },
  };
}

// ── Variant 5 (Lead order 6382953597): de kaart met markeringen ─────────────
// Gebouwd met de echte productmodules: dezelfde reviews, markeringen en
// kaartpagina's die de server zou sturen. Fictieve bronnen, geen netwerk, geen
// model. De kaartpagina's staan per bron en pagina klaar; de browsercheck vraagt
// ze pas op als de medewerker de kaart opent.
function manualMapScenario() {
  const base = manualImportScenario();
  const protocol = loadMenuExtractionProtocol({ root: path.resolve(__dirname, '..', '..', '..') });
  const dinerText = [
    'FICTIEF DINER',
    'Voorgerechten',
    'Fictieve carpaccio',
    '11,00',
    'Fictieve steak 24,50',
    'Fictieve bitterballen 7,50',
    'Fictieve friet 3,50',
    // AA1 (Lead review 6383853638): een prijs zonder centen en zonder €, in de
    // vorm die de echte kaarten printen ("Zeebaars 34    geschroeid | …").
    'Fictieve zeebaars 34    geschroeid | venkel',
    'Fictieve bisque 12    van rivierkreeft',
  ].join('\n');
  const lunchText = ['FICTIEF LUNCH', 'Fictieve soep 6,50', 'Hoofdgerechten', 'Fictieve salade', '9,00']
    .join('\n')
    .replace('Hoofdgerechten', '\fHoofdgerechten');
  const bundle = buildImportBundle({
    bundleId: 'AI-FICTIEF-KAART',
    actorUserId: 'fixture-user',
    restaurantId: RESTAURANT.id,
    restaurantName: RESTAURANT.name,
    fetchedAt: '2026-10-24T13:00:00.000Z',
    sources: [
      { id: 'source-1', url: 'https://fictief-brasserie.invalid/diner', kind: 'html', status: 'read', text: dinerText },
      { id: 'source-2', url: 'https://fictief-brasserie.invalid/lunch.pdf', kind: 'pdf', status: 'read', text: lunchText },
      // Een scan zonder tekstlaag: eerlijk geen tekst en geen vergelijking.
      {
        id: 'source-3',
        url: 'https://fictief-brasserie.invalid/scan.pdf',
        kind: 'pdf',
        status: 'read',
        text: '',
        // De app hasht de bytes van de scan; hier een vaste fictieve hash.
        sha256: sourceHashForText('fictieve-scan-zonder-tekstlaag'),
      },
    ],
    protocol,
    now: new Date('2026-10-24T13:00:00.000Z'),
  });
  const output = {
    menus: [
      {
        title: 'Fictief Diner',
        sourceId: 'source-1',
        categories: [
          {
            name: 'Voorgerechten',
            items: [
              // De kaart print € 11,00, het concept zegt € 12,50: rood.
              {
                name: 'Fictieve carpaccio',
                priceStatus: 'known',
                amountMinorUnits: 1250,
                currency: 'EUR',
                evidence: { sourceId: 'source-1', locator: 'regels 3–4', quote: 'Fictieve carpaccio 11,00' },
              },
              // Dezelfde prijs: groen.
              {
                name: 'Fictieve steak',
                priceStatus: 'known',
                amountMinorUnits: 2450,
                currency: 'EUR',
                evidence: { sourceId: 'source-1', locator: 'regel 5', quote: 'Fictieve steak 24,50' },
              },
            ],
          },
        ],
      },
      {
        title: 'Fictief Lunch',
        sourceId: 'source-2',
        categories: [
          {
            name: 'Lunch',
            items: [
              // Wel overgenomen, maar zonder prijs: een open nalopen-regel.
              {
                name: 'Fictieve soep',
                priceStatus: 'unknown',
                evidence: { sourceId: 'source-2', locator: 'pagina 1, regel 2', quote: 'Fictieve soep 6,50' },
              },
            ],
          },
        ],
      },
    ],
    rejected: [{ sourceId: 'source-1', locator: 'regel 7', reason: 'not_menu', text: 'Fictieve friet 3,50' }],
    coverage: {
      status: 'partial',
      sourcesRead: 2,
      pagesRead: 3,
      itemsExtracted: 3,
      unreadSources: [{ sourceId: 'source-3', locator: 'pagina 1', reason: 'unreadable' }],
      limitations: ['Fictief: één PDF is een scan zonder tekstlaag.'],
    },
  };
  const report = buildImportReport({
    importId: 'fixture-import',
    bundle,
    output,
    aiName: 'Claude',
    now: new Date('2026-10-24T13:05:00.000Z'),
  });
  if (!report.ok) throw new Error(`map fixture invalid: ${report.code}`);
  const capture = bundle.sources;
  const initial = reviewView({ report, decisions: new Map(), capture });
  const redMark = (initial.sourceMap.marks || []).find((mark) => mark.tone === 'price_mismatch');
  const orangeMark = (initial.sourceMap.marks || []).find(
    (mark) => mark.tone === 'uncovered' && mark.sourceId === 'source-1' && mark.canAdd,
  );
  if (!redMark || !orangeMark) throw new Error('map fixture expects a red and an orange mark');
  const taken = decideSourcePriceLine({
    report,
    decisions: new Map(),
    bundle,
    decision: { action: 'take_source_price', lineId: redMark.id, rowId: redMark.rowId },
  });
  if (!taken.ok) throw new Error(`map fixture cannot take the price: ${taken.code}`);
  const afterTake = reviewView({ report, decisions: taken.decisions, capture });
  const dismissed = decideUncoveredLine({
    report,
    decisions: taken.decisions,
    bundle,
    decision: { action: 'uncovered_not_dish', lineId: orangeMark.id },
  });
  if (!dismissed.ok) throw new Error(`map fixture cannot dismiss: ${dismissed.code}`);
  const afterBoth = reviewView({ report, decisions: dismissed.decisions, capture });
  const cardsFor = (decisions) => ({
    'source-1:1': sourceCardView({ report, decisions, capture, sourceId: 'source-1', page: 1 }),
    'source-2:1': sourceCardView({ report, decisions, capture, sourceId: 'source-2', page: 1 }),
    'source-2:2': sourceCardView({ report, decisions, capture, sourceId: 'source-2', page: 2 }),
    'source-3:1': sourceCardView({ report, decisions, capture, sourceId: 'source-3', page: 1 }),
  });
  return {
    ...base,
    bundle: bundleMetadata(bundle),
    prompt: buildImportPrompt(bundle),
    import: publicImportReport(report),
    // Dezelfde volgorde als de beslissingen in de browsercheck: eerst de prijs
    // overnemen, daarna de losse regel als geen gerecht.
    reviews: [initial, afterTake, afterBoth],
    cardSteps: [cardsFor(new Map()), cardsFor(taken.decisions), cardsFor(dismissed.decisions)],
    map: {
      redMark,
      orangeMark,
      counts: initial.sourceMap.sources.map((source) => ({ id: source.id, counts: source.counts, view: source.view })),
    },
  };
}


