# Menu source structure regression corpus

A deterministic, versioned catalogue of menu source structures (`STRUCT-*`)
that every change to menu recognition must keep green. It exists so a parser
fix for one website can never silently break another structure.

- Catalogue: `ops/benchmark/structureCorpus.js` (`STRUCTURE_CORPUS_VERSION`)
- Runner: `ops/benchmark/structureCorpusRunner.js`
- Report: `npm run benchmark:menu-structure` (`ops/benchmark/runStructureCorpus.js`;
  writes `ops/benchmark/output/structure-corpus.json`, gitignored)
- Gate: `npm run test:menu-structure` (`ops/benchmark/structureCorpus.test.js`),
  also part of `npm test`

## The gate rule

A change to any guarded module must run the **whole** corpus, not one
targeted test, and every classified case must pass:

`src/lib/htmlMenuStructure.js`, `menuExtractionContract.js`,
`restaurantSourceAnalysis.js`, `urlIntakes.js`, `menuHierarchy.js`,
`menuGroups.js`, `menuConcept.js`, `menuConceptExport.js`, `menuExport.js`,
`batchAnalysis.js` (`GUARDED_MODULES` in the runner; the gate test checks
the corpus really loads each of them).

The gate test also fails when a new HTML evidence pattern or rejection reason
(`src/lib/menuExtractionContract.js`) has no classified case pinning it, when
a layer is not covered, or when both `normalized` and `uncertain` are no
longer exercised.

There is no CI workflow that runs the normal tests yet; until one exists,
running `npm test` (or at least `npm run test:menu-structure`) before a PR
that touches a guarded module is required by this guide. Making it a
required CI check is a separate, later step.

## Data minimisation

Fixtures are fictional and hand-written: `.invalid` hosts
(`www.fictief-struct.invalid`), dish names starting with "Fictie…", generic
section names. Never real restaurant names, URLs, source HTML, JSON-LD,
screenshots, dishes or copied text — not in fixtures, tests, reports or this
guide. A structure seen on a real site is re-written from scratch as the
smallest fictional page that shows the same *shape*. The gate test rejects
any non-`.invalid` URL and any recognised dish without the "Fictie" prefix.

## A case

```js
{
  id: 'STRUCT-023',                 // next free number, never reused
  name: 'Korte omschrijving van het patroon',
  status: 'classified',             // or 'unclassified' (+ note)
  layers: ['html_parser', 'hierarchy', 'concept'],
  input: site('<h2>…</h2>…'),        // or { page }, or { homepage, pages }, + live, edits
  expected: { … },                  // only the keys given are checked
}
```

`layers`: `html_parser`, `source_analysis`, `hierarchy`, `concept`,
`batch_status`, `export`.

`expected` keys (see the catalogue header for shapes): `recognized`,
`menus` (title, `normalized`/`uncertain`, section paths with item counts and
uncertainty — exact), `parserRejected` (reasons that must appear),
`evidencePatterns`, `statuses` (exact counts per concept line status),
`blockers` (exact), `removed` and `lineStatuses` (menu-variant checks),
`batchLabel`, `notes`, `export: true` (concept = Publicatievoorbeeld =
export, and a stored version reads back identically), `flatExport`, and the
negative `mustNot` (`pathLabelIncludes`, `dishInPath`, `dishRecognised`).
`dishInPath` and `conceptRoutes` (`[dish, route, uncertain]`, the route a
dish has in the concept/review model) compare the full source route, so a
dish moved to a sibling section or flattened into its parent is caught.

Put batch-status cases on a menu page (`site(...)`), not on the homepage:
a menu on the already known homepage is "Controle nodig" by an unrelated
rule, which would hide what the case is meant to show.

## When in doubt

Keep the source route and mark the structure `uncertain`; never flatten it
and never move dishes to a previous section. A behaviour that is not a
settled product decision is recorded as `status: 'unclassified'` with a
`note`: it runs and is reported, but never passes or fails, so it cannot
block — and it is visible until someone decides.

Open (`unclassified`) today:

- `STRUCT-018` — nested JSON-LD menu sections are still joined into one flat
  section name; only the HTML route keeps the hierarchy losslessly.

## Later (not built)

Production telemetry or a structure fingerprint per analysed source is not
part of the corpus. When it is built it needs: a fingerprint over the shape
only (tag/heading levels, pattern ids, counts — never text), stored with the
analysis receipt; a way to map a new fingerprint to the closest `STRUCT-*`
case; and a rule that an unknown shape becomes a new fictional case before a
parser change is accepted.
