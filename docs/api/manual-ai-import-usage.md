# Manual AI import — usage export schema (#59 fase 2, finding F6)

Contract for the metadata-only usage document of the hand-built AI import, built
by `src/lib/manualMenuImportUsage.js`. The Product Owner approved the export on
2026-10-22 (`6348147293`): application, AI name and counts, with costs only when
measured. The Delivery Lead's F6 finding (review `6352404615`) then required the
counters to be durable: they are derived from stored concepts, not from an
in-process `Map`.

Two readers get the same document from the same source:

| Reader | How |
| --- | --- |
| `GET /api/internal/v1/manual-menu-import/usage` | internal role only; server-side read |
| `ops/scripts/export-app-ai-usage.js` | read-only ops export to a gitignored file |

`DevDashboardTower` reads the file as a read-only source; this schema grants no
write and no publication.

## What it is not

- Not billing, not cost control and not proof that a model was used.
- Not a place for menu content, prompts, pasted answers, keys or personal data.
  The validator rejects unknown top-level fields for exactly that reason.
- Not a claim that the AI name is true: it is self-reported and unproven.
- Not a lifetime total: the document is a window over stored concepts.

## Where the numbers come from

Every counter is derived from `menu_snapshot_proposals` rows whose
`captured_content.importProvenance.kind` is `handmatige_ai_import`. That
provenance is written when a human saves a hand-built AI import through the
existing concept route. No new table, no migration, no counter in memory.

What is not stored durably is **not counted**: a generated prompt, a checked
import that was never saved, a follow-up answer and a rejected save leave no row
behind. Those fields carry the literal `"niet bijgehouden"` and never `0`. A `0`
in this document therefore means "measured and zero", which is the whole point of
F6.

| Field | Durable source |
| --- | --- |
| `totals.conceptSaved` | one per stored concept version with `importProvenance` |
| `ai[].counts.concept_saved` | the same rows, grouped by `importProvenance.aiName` |
| `period.from` / `period.to` | min / max `importProvenance.importedAt`; a missing or invalid stamp is counted in `period.timestampsMissing` |
| `reviewOutcomes.correctedRows` / `omittedRows` / `confirmedRows` | `importProvenance.rows[].action` (`correct` / `drop` / anything else) |
| `reviewOutcomes.bounded` | a concept whose stored provenance reached the `MAX_REASONS` cap (200 decisions) |
| `costs` | only `not_measured` until a real measurement exists |

The `manual-menu-import/decisions` route is no longer a counter: per-row human
decisions are reported in `reviewOutcomes`, not as a route total.

## Document (v2)

```json
{
  "schemaVersion": "manual-ai-import-usage/v2",
  "application": "handmatige-ai-import",
  "applicationLabel": "menu-extractie",
  "generatedAt": "2026-10-22T22:18:09.392Z",
  "source": {
    "kind": "durable",
    "table": "menu_snapshot_proposals",
    "jsonField": "captured_content.importProvenance",
    "provenanceKind": "handmatige_ai_import",
    "note": "Tellingen komen uit opgeslagen conceptversies met importProvenance; niets wordt in het geheugen bijgehouden.",
    "rowsRead": 1,
    "rowsUsed": 1,
    "rowsIgnored": 0,
    "limit": 5000,
    "bounded": false
  },
  "period": {
    "from": "2026-10-22T21:09:43.345Z",
    "to": "2026-10-22T21:09:43.345Z",
    "basis": "importProvenance.importedAt",
    "timestampsMissing": 0
  },
  "costs": { "status": "not_measured", "label": "via abonnement, niet gemeten" },
  "routes": [
    { "route": "manual-menu-import/save", "counts": { "concept_saved": 1 } }
  ],
  "ai": [
    { "aiName": "Claude", "selfReported": true, "counts": { "concept_saved": 1 } }
  ],
  "aiOmitted": { "names": 0, "concepts": 0, "note": "Meer dan 20 AI-namen: de rest is niet per naam uitgesplitst." },
  "unattributed": { "concepts": 0, "note": "Concepten zonder AI-naam in de herkomst." },
  "reviewOutcomes": { "concepts": 1, "correctedRows": 0, "omittedRows": 1, "confirmedRows": 0, "bounded": false },
  "totals": {
    "promptCreated": "niet bijgehouden",
    "importChecked": "niet bijgehouden",
    "followUp": "niet bijgehouden",
    "conceptSaved": 1,
    "rejected": "niet bijgehouden"
  },
  "notTracked": [
    { "route": "manual-menu-import/bundles", "action": "prompt_created", "reason": "De prompt wordt één keer teruggegeven en nooit bewaard." }
  ],
  "actionLabels": { "concept_saved": "opgeslagen concepten" },
  "contents": "alleen metagegevens",
  "selfReportedNote": "De AI-naam is zelfgerapporteerd en onbewezen.",
  "notTrackedNote": "Stappen zonder duurzame opslag staan als \"niet bijgehouden\" en nooit als 0."
}
```

The example above is abridged for `notTracked` and `actionLabels`; a real export
carries all five fixed `notTracked` pairs and all five action labels.

## Fields and bounds

| Field | Rule |
| --- | --- |
| `schemaVersion` | fixed `manual-ai-import-usage/v2`; a v1 document is unsupported |
| `application` | fixed `handmatige-ai-import` |
| `applicationLabel` | fixed `menu-extractie` (the application the owner named) |
| `generatedAt` | ISO timestamp, never free text |
| `source` | fixed durable source (`kind`, `table`, `jsonField`, `provenanceKind`), plus `rowsRead`, `rowsUsed`, `rowsIgnored`, `limit`, `bounded`; `rowsRead = rowsUsed + rowsIgnored`, `limit` at most 5000, `bounded` exactly when `rowsRead = limit` |
| `period` | `from`/`to` null or ISO, `from <= to`, fixed `basis`, `timestampsMissing` a count |
| `costs` | `measured` with a positive `amount` and a currency, or `not_measured` with the literal label `via abonnement, niet gemeten`. Never `0`, never an estimate |
| `routes` | only durably tracked actions; today one route (`manual-menu-import/save`) with `concept_saved`; every route with a count must appear, sums must equal `totals` |
| `ai` | at most 20 names, each at most 80 characters, `selfReported: true`, counts exactly `concept_saved` |
| `aiOmitted` | names and concepts beyond the 20-name bound; `names = 0` implies `concepts = 0` |
| `unattributed` | concepts whose provenance has no AI name |
| `reviewOutcomes` | counts of corrected / omitted / confirmed rows, `bounded` when a provenance hit the 200-decision cap, `concepts` equals `source.rowsUsed` |
| `totals` | five keys; a durably tracked action is an integer and equals the route sum, everything else is the literal `niet bijgehouden` and must be explained in `notTracked` |
| `notTracked` | fixed route/action pairs with a short reason; never carries a count |
| `contents` | fixed `alleen metagegevens` |

`validateUsageExport()` enforces all of the above, rejects unknown top-level
fields and rejects a `0` for an action that no route tracks. Saved concepts must
add up: `ai[].concept_saved + unattributed.concepts + aiOmitted.concepts =
totals.conceptSaved`.

## Ops export for DevDashboardTower

```bash
# local Supabase stack only; no production URL is accepted
node --env-file=.env.local ops/scripts/export-app-ai-usage.js
# -> ops/benchmark/output/app-ai-usage.json  (gitignored, BE-21)
```

| Aspect | Rule |
| --- | --- |
| Input | `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; missing values exit 2 with a concrete message |
| Host | loopback only (`127.0.0.1`, `localhost`, `::1`); any other host is refused before a client is created |
| Reads | one `select` on `menu_snapshot_proposals` with the JSON-path filter; never insert, update, delete, migration or provider call |
| Writes | atomic: temp file in the target directory, then a rename; a failed write leaves the previous file untouched and exits 1 |
| Output | metadata only; the script prints counts and the relative path, never a key and never menu content |
| Validation | the document is validated with the same `validateUsageExport()` before it is written |

`--out <path>` overrides the target; a relative path resolves from the repository
root. A read error writes nothing and exits 1.

## Schema history

- **v1** (`manual-ai-import-usage/v1`, 2026-10-22): five counters per route and
  per AI name, filled from a module-level `Map`. Accurate only inside one
  process: on Vercel the numbers were per instance and lost on restart, and no
  file existed for DevDashboardTower (Lead finding F6).
- **v2** (this document): counters derived from stored concepts; `routes` carries
  only durably tracked actions; every untracked action is the literal
  `niet bijgehouden` with a reason in `notTracked`; `source`, `aiOmitted`,
  `unattributed`, `reviewOutcomes` and `period.timestampsMissing` make coverage
  and bounds explicit. The in-memory ledger is removed, not deprecated.

## Limitations

- A window, not a lifetime total: at most `source.limit` (5000) matching rows are
  read; hitting that limit sets `source.bounded: true` instead of silently
  truncating.
- The AI name is self-reported and unproven; names differing only in case or
  spacing count as different names.
- Costs are not measured: an app subscription is not billing data, so the export
  says `not_measured` rather than inventing a number.
- Import steps without durable storage stay `niet bijgehouden` even when they
  demonstrably happened; the document never turns them into a `0`.
