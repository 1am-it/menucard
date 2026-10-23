'use strict';

// #59 — U1/U2 (Delivery Lead review 6376543234): maak een afgekeurd antwoord
// begrijpelijk en herstelbaar.
//
// De validator (menuExtractionSchema.validateStructuredOutput) levert technische
// regels zoals
//   `menus[0].categories[1].items[2].evidence.quote is not present in the cited source`.
// Die regels blijven bestaan (`problems`) en blijven de bron van waarheid; dit
// module vertaalt ze naar hooguit vijf concrete punten in gewoon Nederlands en
// bouwt daaruit één deterministische vervolgvraag aan de AI.
//
// Regels:
//   - geen versoepeling: er wordt niets gevalideerd of goedgekeurd, alleen
//     uitgelegd. Een onbekende regel wordt nooit stil weggelaten;
//   - de hoofdtekst bevat geen JSON-paden en geen technische codes; die staan
//     in `technical` (het inklapbare detail);
//   - het gerecht of de rubriek wordt bij naam genoemd als het pad bekend is;
//   - dezelfde invoer geeft altijd dezelfde uitvoer (vaste volgorde, geen
//     toeval, geen tijd, geen locale-afhankelijke sortering);
//   - puur en zonder I/O: elke regel is met een test te bewijzen.

const MAX_PROBLEM_GROUPS = 5;
const MAX_TECHNICAL_PER_GROUP = 5;
const MAX_QUOTE_EXAMPLE = 40;
const MAX_NAME_EXAMPLE = 60;
const MAX_RECOVERY_CHARS = 1400;

// Vaste volgorde van de soorten. De sortering gebruikt deze index als
// tie-breaker, zodat gelijke aantallen altijd in dezelfde volgorde staan.
const KINDS = [
  {
    code: 'quote_not_in_source',
    phrase: 'staat het citaat niet letterlijk in de bron',
    hint: 'Neem elk citaat letterlijk en aaneengesloten uit de brontekst over.',
  },
  {
    code: 'quote_missing',
    phrase: 'ontbreekt het citaat of is het te lang',
    hint: 'Geef bij elk gerecht een kort citaat dat letterlijk in de bron staat.',
  },
  {
    code: 'evidence_missing',
    phrase: 'ontbreekt het bronbewijs met bron-ID, vindplaats en citaat',
    hint: 'Geef bij elk gerecht bron-ID, vindplaats en citaat.',
  },
  {
    code: 'source_not_in_inventory',
    phrase: 'hoort het bron-ID niet bij de bronnen in de opdracht',
    hint: 'Gebruik uitsluitend de bron-ID\u2019s die in de opdracht staan.',
  },
  {
    code: 'locator_missing',
    phrase: 'ontbreekt de vindplaats of is die te lang',
    hint: 'Geef bij elk gerecht een korte vindplaats in de bron.',
  },
  {
    code: 'price_variants_conflict',
    phrase: 'met meerdere prijzen staat ook één losse hoofdprijs',
    hint: 'Zet bij meerdere gedrukte prijzen alleen prijsvarianten, met priceStatus multiple_undecomposed en zonder los bedrag of valuta.',
  },
  {
    code: 'price_variants_invalid',
    phrase: 'zijn de prijsvarianten onvolledig',
    hint: 'Geef elke prijsvariant een label, een bedrag in centen en EUR.',
  },
  {
    code: 'price_known_incomplete',
    phrase: 'met een bekende prijs ontbreekt het bedrag in centen of de valuta EUR',
    hint: 'Geef bij een bekende prijs het bedrag in centen en de valuta EUR.',
  },
  {
    code: 'price_unexpected',
    phrase: 'staat een bedrag of valuta terwijl de prijs niet als bekend geldt',
    hint: 'Laat amountMinorUnits en currency weg als de prijs niet bekend is.',
  },
  {
    code: 'price_status_invalid',
    phrase: 'is de prijsstatus geen toegestane waarde',
    hint: 'Gebruik alleen known, multiple_undecomposed, on_request of unknown.',
  },
  {
    code: 'price_text_invalid',
    phrase: 'is de prijstekst te lang',
    hint: 'Maak de prijstekst kort.',
  },
  {
    code: 'name_missing',
    phrase: 'ontbreekt de naam',
    hint: 'Neem de naam over zoals die in de bron staat.',
  },
  {
    code: 'description_invalid',
    phrase: 'is de omschrijving te lang',
    hint: 'Maak de omschrijving korter dan 1000 tekens.',
  },
  {
    code: 'is_from_invalid',
    phrase: 'is de vanaf-prijs geen ja of nee',
    hint: 'Zet isFrom alleen op true of false.',
  },
  {
    code: 'supplement_invalid',
    phrase: 'verwijst de toeslag naar een onbruikbare naam',
    hint: 'Verwijs bij een toeslag naar de naam van het gerecht waar hij bij hoort.',
  },
  {
    code: 'allergens_invalid',
    phrase: 'kloppen de allergenen niet',
    hint: 'Gebruik alleen status explicit of unknown en alleen waarden uit de bron.',
  },
  {
    code: 'availability_invalid',
    phrase: 'is de beschikbaarheid te lang',
    hint: 'Maak de beschikbaarheid kort.',
  },
  {
    code: 'shape_invalid',
    phrase: 'heeft een onderdeel de verkeerde vorm',
    hint: 'Gebruik voor elk onderdeel precies de vorm uit het schema.',
  },
  {
    code: 'unknown_field',
    phrase: 'staat een veld dat niet in het schema past',
    hint: 'Laat velden weg die niet in het schema staan.',
  },
  {
    code: 'forbidden_trust_key',
    phrase: 'staat een veld dat niet mag, zoals confidence, reviewReady of approved',
    hint: 'Laat confidence, reviewReady, approved en publicationReady weg.',
  },
  {
    code: 'too_many_items',
    phrase: 'staan meer items dan het schema toestaat',
    hint: 'Beperk het aantal items tot het maximum in het schema.',
  },
  {
    code: 'too_many_categories',
    phrase: 'staan meer rubrieken dan het schema toestaat',
    hint: 'Beperk het aantal rubrieken per menukaart.',
  },
  {
    code: 'too_many_menus',
    phrase: 'staan meer menukaarten dan het schema toestaat',
    hint: 'Beperk het aantal menukaarten.',
  },
  {
    code: 'menus_missing',
    phrase: 'ontbreekt de lijst met menukaarten',
    hint: 'Geef een menus-lijst volgens het schema.',
  },
  {
    code: 'categories_missing',
    phrase: 'ontbreekt de lijst met rubrieken',
    hint: 'Geef elke menukaart een categories-lijst.',
  },
  {
    code: 'items_missing',
    phrase: 'ontbreekt de lijst met gerechten',
    hint: 'Geef elke rubriek een items-lijst.',
  },
  {
    code: 'menu_source_unknown',
    phrase: 'staat een bron die niet in de opdracht voorkomt',
    hint: 'Gebruik bij elke menukaart een sourceId uit de opdracht.',
  },
  {
    code: 'menu_title_missing',
    phrase: 'ontbreekt de titel van de menukaart',
    hint: 'Neem de titel van de menukaart over zoals die in de bron staat.',
  },
  {
    code: 'menu_variant_invalid',
    phrase: 'is de variant van de menukaart te lang',
    hint: 'Maak de variant kort of laat hem weg.',
  },
  {
    code: 'menu_order_invalid',
    phrase: 'is de volgorde van de menukaart geen geldig getal',
    hint: 'Gebruik voor order een geheel getal vanaf nul.',
  },
  {
    code: 'category_path_invalid',
    phrase: 'is het rubriekpad te lang of geen lijst met namen',
    hint: 'Maak het rubriekpad een korte lijst met namen.',
  },
  {
    code: 'category_uncertain_invalid',
    phrase: 'is de onzekerheid van de rubriek geen ja of nee',
    hint: 'Zet uncertain alleen op true of false.',
  },
  {
    code: 'coverage_missing',
    phrase: 'ontbreekt de dekking van de extractie',
    hint: 'Geef een coverage-object volgens het schema.',
  },
  {
    code: 'coverage_status_conflict',
    phrase: 'klopt de dekking niet met de rest van de inhoud',
    hint: 'Zorg dat de dekking klopt: bij "compleet" geen ongelezen bron of beperking, en "geen items" alleen bij nul items.',
  },
  {
    code: 'coverage_count_mismatch',
    phrase: 'kloppen de aantallen in de dekking niet met de inhoud',
    hint: 'Laat itemsExtracted en sourcesRead kloppen met het antwoord en de opdracht.',
  },
  {
    code: 'coverage_counts_invalid',
    phrase: 'staat in de dekking een aantal dat geen geldig getal is',
    hint: 'Gebruik gehele getallen vanaf nul in de dekking.',
  },
  {
    code: 'coverage_limitations_invalid',
    phrase: 'bevat de dekking een beperking die te lang is',
    hint: 'Maak elke beperking kort.',
  },
  {
    code: 'coverage_unread_invalid',
    phrase: 'zijn de ongelezen bronnen in de dekking onvolledig',
    hint: 'Geef elke ongelezen bron een sourceId, vindplaats en reden.',
  },
  {
    code: 'rejected_invalid',
    phrase: 'is de lijst met afgewezen regels onvolledig',
    hint: 'Geef elke afgewezen regel een sourceId, vindplaats, reden en korte tekst.',
  },
  {
    code: 'answer_not_object',
    phrase: 'is de inhoud geen JSON-object',
    hint: 'Geef één JSON-object volgens het schema.',
  },
  {
    code: 'unclassified',
    phrase: 'past een onderdeel niet bij de afspraken',
    hint: 'Volg het uitvoerschema exact en laat verzonnen velden weg.',
  },
];

const KIND_BY_CODE = new Map(KINDS.map((kind, index) => [kind.code, { ...kind, index }]));

const ITEM_AT = /^menus\[(\d+)\]\.categories\[(\d+)\]\.items\[(\d+)\]/;
const CATEGORY_AT = /^menus\[(\d+)\]\.categories\[(\d+)\]/;
const MENU_AT = /^menus\[(\d+)\]/;
const REJECTED_AT = /^rejected\[(\d+)\]/;
const UNREAD_AT = /^coverage\.unreadSources\[(\d+)\]/;

// Van technische validatorregel naar soort. Eerste treffer wint; de volgorde is
// daarom van smal naar breed.
const RULES = [
  [/^forbidden trust key: /, 'forbidden_trust_key'],
  [/^unknown top-level field: /, 'unknown_field'],
  [/\.evidence\.quote is not present in the cited source$/, 'quote_not_in_source'],
  [/\.evidence\.quote must contain a short supporting passage$/, 'quote_missing'],
  [/\.evidence must be an object$/, 'evidence_missing'],
  [/\.evidence\.sourceId must reference the source inventory$/, 'source_not_in_inventory'],
  [/\.evidence\.locator must be a short non-empty string$/, 'locator_missing'],
  [/\.evidence has unknown fields$/, 'unknown_field'],
  [/\.priceVariants require priceStatus multiple_undecomposed$/, 'price_variants_conflict'],
  [/\.amountMinorUnits must be null when price variants exist$/, 'price_variants_conflict'],
  [/\.priceVariants must be an array of at most \d+$/, 'price_variants_invalid'],
  [/\.priceVariants\[\d+\]/, 'price_variants_invalid'],
  [/\.amountMinorUnits is required for a known price$/, 'price_known_incomplete'],
  [/\.currency must be EUR for a known price$/, 'price_known_incomplete'],
  [/\.amountMinorUnits must be absent\/null unless known$/, 'price_unexpected'],
  [/\.currency must be absent\/null unless known$/, 'price_unexpected'],
  [/\.priceStatus is invalid$/, 'price_status_invalid'],
  [/\.priceText is too long or not a string$/, 'price_text_invalid'],
  [/\.description is too long or not a string$/, 'description_invalid'],
  [/\.isFrom must be boolean when present$/, 'is_from_invalid'],
  [/\.supplementOf must be a short non-empty item reference$/, 'supplement_invalid'],
  [/\.allergens/, 'allergens_invalid'],
  [/\.availability must be a short non-empty string$/, 'availability_invalid'],
  [/\.path must be a bounded string array$/, 'category_path_invalid'],
  [/\.uncertain must be boolean when present$/, 'category_uncertain_invalid'],
  [/\.items must be an array$/, 'items_missing'],
  [/\.categories must be an array$/, 'categories_missing'],
  [/\.title must be a short non-empty string$/, 'menu_title_missing'],
  [/\.variant must be null or a short string$/, 'menu_variant_invalid'],
  [/\.order must be a non-negative integer or null$/, 'menu_order_invalid'],
  [/\.name must be a short non-empty string$/, 'name_missing'],
  [/^menus\[\d+\]\.sourceId must reference the source inventory$/, 'menu_source_unknown'],
  [/^menus\[\d+\] has more than \d+ categories$/, 'too_many_categories'],
  [/^menus\[\d+\]\.categories\[\d+\] has more than \d+ items$/, 'too_many_items'],
  [/^menus must be an array$/, 'menus_missing'],
  [/^more than \d+ menus$/, 'too_many_menus'],
  [/^more than \d+ items$/, 'too_many_items'],
  [/^coverage must be an object$/, 'coverage_missing'],
  [/^coverage has unknown fields$/, 'unknown_field'],
  [/^coverage\.status is invalid$/, 'coverage_status_conflict'],
  [/^coverage\.(sourcesRead|pagesRead|itemsExtracted) must be a non-negative integer$/, 'coverage_counts_invalid'],
  [/^coverage\.itemsExtracted must equal the number of extracted items$/, 'coverage_count_mismatch'],
  [/^coverage\.sourcesRead exceeds the source inventory$/, 'coverage_count_mismatch'],
  [/^coverage\.unreadSources must be a bounded array$/, 'coverage_unread_invalid'],
  [/^coverage\.unreadSources\[\d+\]/, 'coverage_unread_invalid'],
  [/^coverage\.limitations must be a bounded string array$/, 'coverage_limitations_invalid'],
  [/^(complete|partial|no_items) coverage /, 'coverage_status_conflict'],
  [/^coverage status requires at least one extracted item$/, 'coverage_status_conflict'],
  [/^rejected must be a bounded array$/, 'rejected_invalid'],
  [/^rejected\[\d+\]/, 'rejected_invalid'],
  [/^output must be an object$/, 'answer_not_object'],
  [/ must be an object$/, 'shape_invalid'],
  [/ is not an object$/, 'shape_invalid'],
  [/ has unknown fields$/, 'unknown_field'],
];

const LEVEL_NOUNS = {
  item: ['gerecht', 'gerechten'],
  category: ['rubriek', 'rubrieken'],
  menu: ['menukaart', 'menukaarten'],
  rejected: ['afgewezen regel', 'afgewezen regels'],
  unread: ['ongelezen bron', 'ongelezen bronnen'],
  answer: ['plek', 'plekken'],
};

/** Het pad uit een validatorregel, als het er is. */
function pathOf(problem) {
  const text = String(problem);
  let match = ITEM_AT.exec(text);
  if (match) return { level: 'item', menu: Number(match[1]), category: Number(match[2]), item: Number(match[3]) };
  match = CATEGORY_AT.exec(text);
  if (match) return { level: 'category', menu: Number(match[1]), category: Number(match[2]) };
  match = MENU_AT.exec(text);
  if (match) return { level: 'menu', menu: Number(match[1]) };
  if (REJECTED_AT.test(text)) return { level: 'rejected' };
  if (UNREAD_AT.test(text)) return { level: 'unread' };
  return { level: 'answer' };
}

function kindFor(problem) {
  const text = String(problem);
  for (const [pattern, code] of RULES) {
    if (pattern.test(text)) return KIND_BY_CODE.get(code);
  }
  return KIND_BY_CODE.get('unclassified');
}

function subject(level, count) {
  const [one, many] = LEVEL_NOUNS[level] || LEVEL_NOUNS.answer;
  const noun = count === 1 ? one : many;
  if (level === 'answer') return `Op ${count} ${noun} in het antwoord`;
  return `Bij ${count} ${noun}`;
}

function truncate(value, max) {
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}\u2026`;
}

function menuAt(output, path) {
  if (!output || typeof output !== 'object' || !path) return null;
  const menus = Array.isArray(output.menus) ? output.menus : [];
  const menu = menus[path.menu];
  return menu && typeof menu === 'object' ? menu : null;
}

function categoryAt(output, path) {
  const menu = menuAt(output, path);
  if (!menu || !Array.isArray(menu.categories)) return null;
  const category = menu.categories[path.category];
  return category && typeof category === 'object' ? category : null;
}

function itemAt(output, path) {
  const category = categoryAt(output, path);
  if (!category || !Array.isArray(category.items)) return null;
  const item = category.items[path.item];
  return item && typeof item === 'object' ? item : null;
}

/** De naam van het gerecht, de rubriek of de menukaart waar de regel over gaat. */
function nameAt(output, path) {
  if (path.level === 'menu') {
    const menu = menuAt(output, path);
    return menu && typeof menu.title === 'string' ? menu.title : null;
  }
  if (path.level === 'category') {
    const category = categoryAt(output, path);
    return category && typeof category.name === 'string' ? category.name : null;
  }
  if (path.level === 'item') {
    const item = itemAt(output, path);
    return item && typeof item.name === 'string' ? item.name : null;
  }
  return null;
}

/** Het citaat van het item uit de afgekeurde uitvoer, als het er is. */
function quoteAt(output, path) {
  if (path.level !== 'item') return null;
  const item = itemAt(output, path);
  const evidence = item && item.evidence;
  return evidence && typeof evidence.quote === 'string' && evidence.quote.trim() !== '' ? evidence.quote : null;
}

/**
 * Eén voorbeeld per soort, in gewone taal: bij een citaatprobleem het citaat
 * (met het gerecht erbij), anders het gerecht of de rubriek bij naam.
 */
function exampleAt(kind, problem, output) {
  const path = pathOf(problem);
  const name = nameAt(output, path);
  const quotedName = typeof name === 'string' && name.trim() !== ''
    ? `\u201C${truncate(name, MAX_NAME_EXAMPLE)}\u201D`
    : null;
  if (kind.code === 'quote_not_in_source' || kind.code === 'quote_missing') {
    const quote = quoteAt(output, path);
    if (quote) {
      const short = `\u2018${truncate(quote, MAX_QUOTE_EXAMPLE)}\u2019`;
      return quotedName ? `${short} bij ${quotedName}` : short;
    }
  }
  return quotedName;
}

/**
 * De vertaling van alle afgekeurde regels: hooguit vijf groepen, elk met één
 * leesbare zin, een korte herstelopdracht en (begrensd) de technische regels.
 */
function describeImportProblems(problems, output) {
  const list = Array.isArray(problems) ? problems : [];
  const groups = [];
  const byCode = new Map();
  for (const problem of list) {
    const kind = kindFor(problem);
    let group = byCode.get(kind.code);
    if (!group) {
      group = {
        code: kind.code,
        index: kind.index,
        count: 0,
        level: pathOf(problem).level,
        phrase: kind.phrase,
        hint: kind.hint,
        example: null,
        technical: [],
      };
      byCode.set(kind.code, group);
      groups.push(group);
    }
    group.count += 1;
    if (group.example === null) group.example = exampleAt(kind, problem, output);
    if (group.technical.length < MAX_TECHNICAL_PER_GROUP) group.technical.push(String(problem).slice(0, 240));
  }

  // Grootste probleem eerst; gelijke aantallen in de vaste soortvolgorde.
  const ordered = groups
    .slice()
    .sort((a, b) => b.count - a.count || a.index - b.index || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    .map((group) => {
      const example = group.example ? ` (bijvoorbeeld ${group.example})` : '';
      return {
        code: group.code,
        count: group.count,
        text: `${subject(group.level, group.count)} ${group.phrase}${example}.`,
        hint: group.hint,
        technical: group.technical,
      };
    });

  const kept = ordered.slice(0, MAX_PROBLEM_GROUPS);
  return {
    groups: kept,
    omitted: ordered.length - kept.length,
    recoveryQuestion: buildRecoveryQuestion(kept),
  };
}

/**
 * Eén kopieerbare vervolgvraag, uitsluitend opgebouwd uit dezelfde groepen.
 * Geen tijd, geen teller en geen toevallige volgorde: dezelfde problemen geven
 * altijd exact dezelfde vraag.
 */
function buildRecoveryQuestion(groups) {
  const list = Array.isArray(groups) ? groups.filter((group) => group && typeof group.text === 'string') : [];
  if (list.length === 0) return null;
  const lines = [
    'Corrigeer alleen deze punten en geef daarna het volledige antwoord opnieuw in precies één codeblok:',
    ...list.map((group, index) => `${index + 1}. ${group.text} ${group.hint}`),
    'Verander niets anders. Voeg geen velden toe, verzin geen gegevens en geef geen confidence, reviewReady of goedkeuring.',
  ];
  const text = lines.join('\n');
  if (text.length <= MAX_RECOVERY_CHARS) return text;
  return `${text.slice(0, MAX_RECOVERY_CHARS - 1).trimEnd()}\u2026`;
}

module.exports = {
  MAX_PROBLEM_GROUPS,
  MAX_RECOVERY_CHARS,
  KINDS,
  describeImportProblems,
  buildRecoveryQuestion,
  // Alleen voor de regressies: dezelfde indeling als het scherm gebruikt.
  classifyProblem: (problem) => kindFor(problem).code,
};
