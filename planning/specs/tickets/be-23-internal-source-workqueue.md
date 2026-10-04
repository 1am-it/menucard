# BE-23 — Internal source workqueue (Bronwerkvoorraad)

## Status

Built locally on `feat/internal-source-workqueue`; not pushed, not
merged, not deployed. Internal, read-only. Awaiting an independent
pre-push review.

## Goal

One calm, internal overview of every known restaurant source for a city
(Breda first) that answers, per restaurant, two separate questions —
*can we read the source?* and *what do we know about its menu?* — and
names exactly one next step for a staff member. Reachable under the
existing `Werkvoorraad` control in `InternalNav`; no second navigation.

Visual reference: `docs/mockups/internal-source-workqueue-v1.png`
(direction, not pixel-perfect — see "Deviations from the mockup").

## What exists

- `src/lib/sourceWorkqueue.js` — pure, tested classifier (no Supabase,
  network, DOM or React).
- `GET /api/internal/v1/source-workqueue` — `internal`-only, select only,
  no outbound fetch; reads `restaurant_source_analysis_jobs` (0014),
  `url_intake_analysis_receipts` (0013) and `data/restaurants.json`.
- `/internal/source-workqueue` — the page; `InternalNav` gets one new
  `internal`-only Werkvoorraad entry, `Bronwerkvoorraad`, without a badge
  count.

No migration, database write, external URL analysis, provider, AI/OCR,
public route or product behaviour change.

## Vocabulary (one list, used everywhere)

Bron: `Bereikbaar` · `Niet bereikbaar` · `Toegang beperkt` ·
`Identiteit gewijzigd`.
Menukaart: `Klaar voor review` · `Structuur niet herkend` ·
`Geen menukaart aangetroffen` · `Niet beoordeeld`.
Actions: `Beoordeel` · `Beoordeel handmatig` · `Controleer bron` ·
`Controleer toegang` · `Controleer identiteit`.
Queues (mutually exclusive, they always add up to the total):
`Beoordelen` · `Bron controleren` · `Identiteit`, plus `Alles`.

Hard rules:

- If Bron is not `Bereikbaar`, Menukaart is always `Niet beoordeeld`.
- `Identiteit gewijzigd` never takes over an old name, menu or status;
  its action only opens a comparison with `Later` as the only option —
  no one-click confirmation.
- Status is never shown by colour alone: every badge has an icon and the
  full text ("Bron: …", "Menukaart: …").

| Bron | Menukaart | Action | Queue |
|---|---|---|---|
| Bereikbaar | Klaar voor review | Beoordeel | Beoordelen |
| Bereikbaar | Structuur niet herkend | Beoordeel handmatig | Beoordelen |
| Bereikbaar | Niet beoordeeld | Beoordeel handmatig | Beoordelen |
| Bereikbaar | Geen menukaart aangetroffen | Controleer bron | Bron controleren |
| Niet bereikbaar | Niet beoordeeld | Controleer bron | Bron controleren |
| Toegang beperkt | Niet beoordeeld | Controleer toegang | Bron controleren |
| Identiteit gewijzigd | Niet beoordeeld | Controleer identiteit | Identiteit |

Default sort `Eerst actie nodig`: identity, then source/access checks,
then manual review, then review; within each, oldest check first.

## Mapping from existing data (never a guess)

Per restaurant, the newest *terminal* analysis job that says something
reliable about the source decides the row; its `updated_at` is shown as
"Gecontroleerd".

- `succeeded` (with its receipt) → Bron `Bereikbaar`, and Menukaart:
  `Klaar voor review` when menu items were recognized (HTML menu in the
  receipt, or `recognizedSections` of a discovered PDF);
  `Structuur niet herkend` when a menu candidate was found but nothing
  recognized; otherwise `Niet beoordeeld`.
- `failed` + `fetch_failed` → `Niet bereikbaar`; `robots_disallowed` →
  `Toegang beperkt`; `unsupported_content_type` / `pdf_extraction_failed`
  → `Bereikbaar` + `Niet beoordeeld`.
- `failed` + `internal_error`, `unsafe_url` or the reserved
  `ai_structuring_failed` / `budget_exceeded` /
  `no_reliable_content_found`, and `pending` / `running` say nothing
  reliable about the source and are never mapped to a status.

Attribution: a succeeded job counts for a restaurant only through its
receipt's server-side `exact` match; a failed job only through an exact
hostname match of the checked URL (`restaurantHostMatch`). Anything else
is counted as "niet gekoppeld" and not attributed.

Restaurants without a usable check are not given a status; they are
listed under "Nog niet in de werkvoorraad" with a plain reason
(`Geen website bekend`, `Nog nooit gecontroleerd`, `Controle loopt nog`,
`Laatste controle gaf geen bruikbaar resultaat`).

## Datamodelkloof (data-model gap)

Two statuses cannot be carried reliably by the current data model; the
page therefore never shows them, and says so in its status legend:

1. **`Identiteit gewijzigd`** — no table records an explicit identity
   change for a source (for example "this address now belongs to a
   renamed or different restaurant", with the observed name and who
   recorded it). Inferring it from a name, URL, redirect or HTTP status
   would be a guess. Needed later: an explicit, reviewed identity
   observation per source (previous restaurant, observed name, evidence,
   recorder, time) — a schema change, so a migration and a separate
   decision.
2. **`Geen menukaart aangetroffen`** — the analysis records what it
   recognized, not an explicit verdict that a source has no menu. Per the
   BE-22 decision, "nothing recognized" is not evidence of absence, so it
   maps to `Niet beoordeeld`. Needed later: an explicit, human-recorded
   "geen menukaart" observation per source.

`classifyRow` already supports both statuses, so a future evidence field
can feed them without changing the queue logic. Until then the
`Identiteit` queue shows 0.

Smaller limits: the jobs table has no restaurant id (attribution goes
through the receipt or the hostname, see above); "Gecontroleerd" is the
moment of the last usable analysis, not a separate scheduled check; the
route reads at most the 2000 newest jobs and says so when that bound is
reached.

## Deviations from the mockup

- The existing `InternalNav` shell is reused unchanged (BredaEats wordmark,
  `Werkvoorraad` as an icon disclosure, existing sign-out label); the
  mockup's top bar is not rebuilt.
- No `Geen actie` queue: every row in this workqueue has exactly one
  action, and there is no reliable "afgehandeld" signal in the current
  data; `Actie nodig` therefore equals the total.
- No "was: …" line under a restaurant name: it would require identity
  evidence that does not exist yet.
- Badge text uses the main text colour with the status colour on icon,
  border and background — for contrast in both themes.
- Actions open a guidance panel inside the page (with a link to
  Onboarding Restaurant where relevant); they never start an analysis,
  open an external site automatically, change data, approve or publish.

## Not built (deliberately)

Bulk selection or actions, "alle bronnen controleren", re-checks,
publish/approve/AI actions, HTTP codes, logs, scores or retries in the
main view, inline editing, notifications, export, a city selector (one
city today), and any nav badge count.

## Verification

- `src/lib/sourceWorkqueue.test.js`: all 16 status combinations, the
  dependency rule, every job status and error reason, attribution, counts
  (always adding up to the total), sorting and filtering; checked by
  mutation.
- `src/lib/sourceWorkqueueSurface.test.js`: structural safety net — the
  route is read only and outbound-fetch free, the response exposes no URL
  or error reason, the page has no bulk/publish/approve actions, one
  shared vocabulary, an identity panel with only `Later`, and accessible
  table/filter semantics.
- `src/lib/internalNav.test.js`: the new Werkvoorraad entry.
- Local browser check with fictional fixture data (desktop and mobile,
  light and dark): no page overflow, keyboard operation, contrast.
