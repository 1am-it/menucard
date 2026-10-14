// Menu source structure regression corpus — the one runner. Runs every
// STRUCT-* case (structureCorpus.js) through the REAL product chain in
// src/lib, never a second parser:
//   html parser (htmlMenuStructure) → source analysis (restaurantSourceAnalysis,
//   receipt summary) → menu hierarchy → concept (menuConcept) → batch status
//   (batchAnalysis) → Publicatievoorbeeld and export (menuConceptExport,
//   menuExport).
// Fully offline: candidate pages come from the case itself; nothing fetches.
// A case passes when every given expectation holds; `unclassified` cases are
// run and reported, never passed or failed.
//
// Isolated tooling, never imported by product code. CommonJS.

'use strict'

const { extractHtmlMenuStructure } = require('../../src/lib/htmlMenuStructure')
const { runRestaurantSourceAnalysis } = require('../../src/lib/restaurantSourceAnalysis')
const { buildCandidateSummary } = require('../../src/lib/urlIntakes')
const { buildMenuConcept, liveMenuLines, storedConceptInput } = require('../../src/lib/menuConcept')
const { exportMenuEntry } = require('../../src/lib/menuConceptExport')
const { buildMenuEntry, restaurantMenuEntries } = require('../../src/lib/menuExport')
const { menuSourceUrls, deriveItemView } = require('../../src/lib/batchAnalysis')
const { STRUCTURE_CASES, HOST } = require('./structureCorpus')

const RESTAURANT_ID = 'struct'

/** The product modules the corpus guards (docs/guides/menu-source-structure-regression-corpus.md). */
const GUARDED_MODULES = [
  'src/lib/htmlMenuStructure.js',
  'src/lib/menuExtractionContract.js',
  'src/lib/restaurantSourceAnalysis.js',
  'src/lib/urlIntakes.js',
  'src/lib/menuHierarchy.js',
  'src/lib/menuGroups.js',
  'src/lib/menuConcept.js',
  'src/lib/menuConceptExport.js',
  'src/lib/menuExport.js',
  'src/lib/batchAnalysis.js',
]

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function countBy(values) {
  const out = {}
  for (const v of values) out[v] = (out[v] || 0) + 1
  return out
}

function sortedKeys(object) {
  return Object.fromEntries(Object.keys(object).sort().map((k) => [k, object[k]]))
}

/** The pages of a case as the analysis' candidate fetcher sees them. */
function fetcherFor(input) {
  const pages = input.pages || {}
  return async (url) => {
    const path = new URL(url).pathname
    const entry = pages[path]
    if (!entry || entry.status === 'blocked') return { status: 'blocked' }
    if (entry.status === 'error') return { status: 'error' }
    return { status: 'html', body: entry.html, finalUrl: url }
  }
}

/** The menu shape the reviewer and the export see, without volatile fields. */
function menuShape(menu) {
  return {
    title: menu.title === undefined ? null : menu.title,
    structure: menu.structure || null,
    sections: (menu.categories || []).map((c) => [c.path || [c.name], c.items.length, c.uncertain === true]),
  }
}

/** Concept categories as structure: [path, [name, price]] — the semantic menu. */
function conceptStructure(content) {
  return {
    title: content.title || null,
    categories: content.categories.map((c) => [c.path || [c.name], c.items.map((i) => [i.name, Number(i.price)])]),
  }
}

function entryStructure(entry) {
  return {
    title: entry.title || null,
    categories: entry.categories.map((c) => [c.path || [c.name], c.items.map((i) => [i.name, i.priceValue])]),
  }
}

/** Runs one case through the chain; returns what the chain actually produced. */
async function observeCase(structCase) {
  const input = structCase.input
  const homepageHtml = input.page || input.homepage
  const analysis = await runRestaurantSourceAnalysis({ homepageHtml, homepageUrl: `${HOST}/`, fetchCandidate: fetcherFor(input) })

  // Parser layer: rejections and evidence of every page the analysis could read.
  const htmlPages = [homepageHtml, ...Object.values(input.pages || {}).filter((p) => p.status === 'html').map((p) => p.html)]
  const parsed = htmlPages.map((html) => extractHtmlMenuStructure(html))
  const parserRejected = [...new Set(parsed.flatMap((r) => r.rejected.map((line) => line.reason)))].sort()
  const evidencePatterns = [...new Set(parsed.flatMap((r) => r.sections.flatMap((s) => s.items.map((i) => i.evidence.pattern))))].sort()

  const summary = buildCandidateSummary({ restaurantCandidateFields: {}, menus: analysis.menuContexts })
  const recognized = summary.menus.some((m) => m.categories.some((c) => c.items.length > 0))
  const live = input.live || {}
  const liveLines = liveMenuLines(live, RESTAURANT_ID)
  const concept = buildMenuConcept({ menus: summary.menus, liveLines, edits: input.edits || {} })

  const view = deriveItemView({
    item: { item_position: 1, canonical_source_url: `${HOST}/`, outcome: 'queued', job_id: 'j1' },
    job: { id: 'j1', status: 'succeeded', attempt_count: 1, finished_at: '2026-10-15T09:00:00Z', result_receipt_id: 'r1', unknown_menu_contexts: analysis.unknownMenuContexts || [], menu_source_urls: menuSourceUrls(analysis), notes: analysis.notes },
    receipt: { restaurant_match_type: 'exact', matched_restaurant_id: RESTAURANT_ID, menus: summary.menus },
    restaurants: { [RESTAURANT_ID]: { name: 'Fictief Restaurant', website: HOST } },
    proposals: [],
    now: new Date('2026-10-15T09:05:00Z'),
  })

  // Concept = Publicatievoorbeeld = export, from a stored version (round trip).
  let exportCheck = null
  if (concept.canSave) {
    const snapshot = { restaurant_id: RESTAURANT_ID, captured_content: concept.content, source_url: `${HOST}/menukaart`, created_at: '2026-10-15T09:00:00Z' }
    const preview = exportMenuEntry({ snapshot, menus: live })
    const stored = storedConceptInput(concept.content)
    const reloaded = buildMenuConcept({ menus: stored.menus, liveLines, edits: stored.edits })
    const exported = preview.entry ? buildMenuEntry({ content: reloaded.content, currentEntries: restaurantMenuEntries(live, RESTAURANT_ID), sourceUrl: snapshot.source_url, scraped: '2026-10-15' }) : null
    exportCheck = {
      previewEqualsExport: Boolean(preview.entry && exported && sameJson(preview.entry, exported)),
      conceptEqualsExport: Boolean(exported && sameJson(conceptStructure(concept.content), entryStructure(exported))),
      roundTripStable: sameJson(reloaded.content, concept.content),
      flat: Boolean(exported && !('title' in exported) && exported.categories.every((c) => !('path' in c))),
    }
  }

  return {
    recognized,
    menus: analysis.menuContexts.map(menuShape),
    parserRejected,
    evidencePatterns,
    statuses: sortedKeys(countBy(concept.lines.map((l) => l.status))),
    blockers: concept.blockers.map((b) => b.status).sort(),
    removed: concept.removed.map((l) => [l.menuScope || '', l.name]),
    lineStatuses: concept.lines.map((l) => [l.menuScope || '', l.name, l.status]),
    batchLabel: view.label,
    notes: analysis.notes,
    exportCheck,
    dishesByPath: analysis.menuContexts.flatMap((m) => m.categories.flatMap((c) => c.items.map((i) => [i.name, c.path || [c.name]]))),
  }
}

/** Every failed expectation of a case, in plain words (empty = pass). */
function compare(expected, actual) {
  const failures = []
  const check = (ok, message) => {
    if (!ok) failures.push(message)
  }
  if ('recognized' in expected) check(actual.recognized === expected.recognized, `herkend: verwacht ${expected.recognized}, kreeg ${actual.recognized}`)
  if (expected.menus) check(sameJson(actual.menus, expected.menus), `menustructuur: verwacht ${JSON.stringify(expected.menus)}, kreeg ${JSON.stringify(actual.menus)}`)
  for (const reason of expected.parserRejected || []) check(actual.parserRejected.includes(reason), `afwijzing ${reason} ontbreekt (kreeg ${actual.parserRejected.join(', ') || 'geen'})`)
  for (const pattern of expected.evidencePatterns || []) check(actual.evidencePatterns.includes(pattern), `patroon ${pattern} niet gebruikt (kreeg ${actual.evidencePatterns.join(', ')})`)
  if (expected.statuses) check(sameJson(actual.statuses, sortedKeys(expected.statuses)), `regelstatussen: verwacht ${JSON.stringify(sortedKeys(expected.statuses))}, kreeg ${JSON.stringify(actual.statuses)}`)
  if (expected.blockers) check(sameJson(actual.blockers, [...expected.blockers].sort()), `blokkades: verwacht ${JSON.stringify(expected.blockers)}, kreeg ${JSON.stringify(actual.blockers)}`)
  if (expected.removed) check(sameJson(actual.removed, expected.removed), `verdwenen: verwacht ${JSON.stringify(expected.removed)}, kreeg ${JSON.stringify(actual.removed)}`)
  for (const line of expected.lineStatuses || []) check(actual.lineStatuses.some((a) => sameJson(a, line)), `regel ${JSON.stringify(line)} ontbreekt`)
  if (expected.batchLabel) check(actual.batchLabel === expected.batchLabel, `batchstatus: verwacht "${expected.batchLabel}", kreeg "${actual.batchLabel}"`)
  for (const note of expected.notes || []) check(actual.notes.some((n) => n.includes(note)), `notitie met "${note}" ontbreekt`)
  if (expected.export) {
    const e = actual.exportCheck
    check(Boolean(e), 'export: concept kan niet worden opgeslagen')
    if (e) {
      check(e.previewEqualsExport, 'export: publicatievoorbeeld wijkt af van export')
      check(e.conceptEqualsExport, 'export: conceptstructuur wijkt af van export')
      check(e.roundTripStable, 'export: opgeslagen versie leest niet identiek terug')
      if (expected.flatExport) check(e.flat, 'export: plat menu kreeg titel of pad')
    }
  }
  const mustNot = expected.mustNot || {}
  for (const text of mustNot.pathLabelIncludes || []) {
    check(!actual.menus.some((m) => m.sections.some(([path]) => path.some((label) => label.includes(text)))), `rubriekpad bevat "${text}"`)
  }
  for (const [dish, path] of mustNot.dishInPath || []) {
    check(!actual.dishesByPath.some(([name, p]) => name === dish && sameJson(p, path)), `"${dish}" staat in ${JSON.stringify(path)}`)
  }
  for (const dish of mustNot.dishRecognised || []) check(!actual.dishesByPath.some(([name]) => name === dish), `"${dish}" is als gerecht herkend`)
  return failures
}

/** Runs the whole corpus. Returns { version, results: [{ id, name, status, outcome, failures, layers }] }. */
async function runStructureCorpus(cases = STRUCTURE_CASES) {
  const results = []
  for (const structCase of cases) {
    let actual = null
    let failures
    try {
      actual = await observeCase(structCase)
      failures = compare(structCase.expected || {}, actual)
    } catch (err) {
      failures = [`fout in de keten: ${err && err.message}`]
    }
    const outcome = structCase.status === 'unclassified' ? 'unclassified' : failures.length === 0 ? 'pass' : 'fail'
    results.push({ id: structCase.id, name: structCase.name, status: structCase.status, layers: structCase.layers, outcome, failures, note: structCase.note || null, actual })
  }
  return { results }
}

module.exports = { RESTAURANT_ID, GUARDED_MODULES, observeCase, compare, runStructureCorpus }
