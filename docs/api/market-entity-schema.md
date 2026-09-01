# Market Entity Schema (MARKET-01)

The concrete, implementable schema contract for the `market` entity — the
neutral technical unit `[[011-market-foundation-and-international-growth]]`
introduced for growth beyond Breda. Documentation contract only — nothing
in the current app constructs, stores, or reads this shape yet. The
product-level rationale lives in
[`planning/decisions/011-market-foundation-and-international-growth.md`](../../planning/decisions/011-market-foundation-and-international-growth.md);
this file defines the exact fields, mirroring the convention
`docs/api/data-trust-model.md` used for `PLATFORM-03`.

## Fields

| Field | Type | Notes |
|---|---|---|
| `id` | stable technical identifier | **Immutable.** Never changes once assigned, regardless of rebranding, boundary changes, or anything else. The only field safe to use as a long-term reference (e.g. a future foreign key). Concrete format (UUID vs. an internal key scheme) not chosen — see Open questions. |
| `slug` | string | Readable, used in routes/UI (e.g. `breda`). **Mutable** — can change later (renaming, restructuring) without changing `id`. Never use `slug` where a stable reference is needed. |
| `name` | string | Display name (e.g. "Breda"). **Mutable**, independent of `slug`. |
| `boundary` | geographic boundary | Representation not chosen (polygon, postal-code list, named administrative region — see Open questions). **A valid, defined boundary is a hard precondition** — not optional — for `MARKET-04`/`05` (automated imports, market-level deduplication), `MARKET-07` (coverage metrics), and any new market launch. Not yet defined even for Breda (see below). |
| `country_code` | string | ISO-style country code. |
| `timezone` | string | e.g. IANA timezone name. |
| `default_currency` | string | e.g. ISO currency code. Multi-currency display/real-time FX is not addressed here. |
| `supported_languages` | string[] | At least one. Deeper localization behaviour is not addressed here. |
| `launch_status` | `'draft' \| 'seeding' \| 'live' \| 'paused'` | **Operational state only.** Says nothing about data quality or readiness — that is `readiness_status`, entirely independent. Fixed in `[[012-city-market-readiness-thresholds]]`. |
| `readiness_status` | `'go' \| 'conditional_go' \| 'no_go'` | The `PLATFORM-09` outcome (`[[012-city-market-readiness-thresholds]]`), re-evaluated independently of `launch_status`. **Never conflate with `launch_status`** — a market can be operationally `live` while honestly `conditional_go`. |

## Why `launch_status` and `readiness_status` are two fields, not one

An earlier draft of this schema (during `MARKET-01`'s own drafting) merged
these into one vocabulary. That was caught and corrected before this
contract was finalized: collapsing them would let "live" silently imply
"fully ready," which is exactly the kind of quiet overclaim this project
has consistently avoided elsewhere (e.g. `BE-07`'s reservation-verification
honesty, `PLATFORM-01`'s own unflattering coverage numbers). Keeping them
separate lets a market be truthfully described as both operational *and*
still catching up on data quality — which is precisely Breda's own real
state today.

## Breda — retroactive reference values

| Field | Value |
|---|---|
| `id` | Breda's own stable identity (format not yet decided — see Open questions) |
| `slug` | `breda` |
| `name` | `Breda` |
| `boundary` | **Not yet defined.** Breda has never needed one — there has only ever been one market — but this is a real, current gap, not a placeholder oversight. It would need to be defined before `MARKET-04`/`05`/`07` could run for Breda itself, or before any second market's boundary could be distinguished from it. |
| `country_code` | `NL` |
| `timezone` | `Europe/Amsterdam` |
| `default_currency` | `EUR` |
| `supported_languages` | `["nl"]` |
| `launch_status` | `live` — Breda operationally serves real visitors today. |
| `readiness_status` | `conditional_go` — per `[[012-city-market-readiness-thresholds]]`'s own table: Breda clears basic-info and price coverage, but not menu-data coverage (16% vs. a ≥50% threshold) or reservation confirmation (0% vs. ≥20%). **Deliberately not `go`** — `launch_status: live` must never be read as an implicit readiness claim. |

## Open questions (not decided here)

- Concrete `id` format (UUID vs. an internal key scheme).
- Concrete `boundary` representation (polygon, postal-code list, named
  administrative region).
- Whether/how `readiness_status` gets recomputed automatically once
  `MARKET-07` exists, versus staying a manually-recorded decision as it is
  today.
- Multi-currency and deeper localization handling beyond a single
  `default_currency`/`supported_languages` pair.

## Out of scope for this contract

- Any canonical database, storage engine, or persistence choice.
- A market selector, a second market, or any change to the current Breda
  consumer read path.
- Automatic transitions between `launch_status` values (e.g. what
  triggers `seeding` → `live`) — not defined here.
