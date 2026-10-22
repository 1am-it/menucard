# Manual AI import — usage export schema (#59 fase 2)

Contract for the metadata-only export of the hand-built AI import
(`GET /api/internal/v1/manual-menu-import/usage`), built by
`src/lib/manualMenuImportUsage.js`. The Product Owner approved this export on
2026-10-22 (`6348147293`): application, route, AI name and counts, with costs
only when measured. `DevDashboardTower` reads the file as a read-only source;
this schema grants no write and no publication.

## What it is not

- Not billing, not cost control and not proof that a model was used.
- Not a place for menu content, prompts, pasted answers, keys or personal data.
  The validator rejects unknown top-level fields for exactly that reason.
- Not a claim that the AI name is true: it is self-reported and unproven.

## Document

```json
{
  "schemaVersion": "manual-ai-import-usage/v1",
  "application": "handmatige-ai-import",
  "applicationLabel": "menu-extractie",
  "generatedAt": "2026-10-22T12:00:00.000Z",
  "period": { "from": "2026-10-22T10:00:00.000Z", "to": "2026-10-22T12:00:00.000Z" },
  "costs": { "status": "not_measured", "label": "via abonnement, niet gemeten" },
  "routes": [
    {
      "route": "manual-menu-import/bundles",
      "counts": { "prompt_created": 1, "import_checked": 0, "follow_up": 0, "concept_saved": 0, "rejected": 0 }
    }
  ],
  "ai": [
    {
      "aiName": "Claude",
      "selfReported": true,
      "counts": { "prompt_created": 1, "import_checked": 1, "follow_up": 0, "concept_saved": 0, "rejected": 0 }
    }
  ],
  "totals": { "promptCreated": 1, "importChecked": 1, "followUp": 0, "conceptSaved": 0, "rejected": 0 },
  "actionLabels": { "prompt_created": "prompts gemaakt" },
  "contents": "alleen metagegevens",
  "selfReportedNote": "De AI-naam is zelfgerapporteerd en onbewezen."
}
```

## Fields and bounds

| Field | Rule |
| --- | --- |
| `schemaVersion` | fixed `manual-ai-import-usage/v1`; any other value is unsupported |
| `application` | fixed `handmatige-ai-import` |
| `applicationLabel` | fixed `menu-extractie` (the application the owner named) |
| `generatedAt`, `period.from/to` | ISO timestamps, never free text |
| `costs` | `measured` with a positive `amount` and a currency, or `not_measured` with the literal label `via abonnement, niet gemeten`. Never `0`, never an estimate |
| `routes` | at most 8, each from the fixed route list (`manual-menu-import/bundles`, `imports`, `decisions`, `follow-up`, `save`) |
| `routes[].counts` | five non-negative integers: `prompt_created`, `import_checked`, `follow_up`, `concept_saved`, `rejected` |
| `ai` | at most 20 names, each at most 80 characters, `selfReported: true`, same five counters |
| `totals` | the same counters, summed over the routes |

`validateUsageExport()` enforces all of the above and rejects unknown
top-level fields. An unknown route or action is dropped at record time and
never reaches the document.

## Where the counters come from

| Route | Action |
| --- | --- |
| `manual-menu-import/bundles` | `prompt_created` when the prompt was made |
| `manual-menu-import/imports` | `import_checked` on a valid import, `rejected` on a plain refusal |
| `manual-menu-import/follow-up` | `follow_up` when a follow-up answer passed, `rejected` when it did not |
| `manual-menu-import/save` | `concept_saved` when the existing concept route accepted the version, `rejected` otherwise |

The counters live in process memory and reset when the app restarts; the export
is therefore a window, not a lifetime total. That limitation is deliberate and
is reported rather than hidden.
