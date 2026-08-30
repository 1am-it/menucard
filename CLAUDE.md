# BredaEats — Claude Instructions

## Mission

BredaEats helps users answer:

> Wat wil je vanavond eten, waar kan ik dat krijgen, en wat kost het?

The product is evolving from a restaurant-first browsing experience into a fast,
lightweight, text-first, dish-first restaurant menu search experience.

## Core instruction

Do NOT rebuild the project from scratch.

Reuse the existing architecture, routing, data structures, filtering logic,
services and components wherever sensible.

Prefer incremental migration over replacement.

Preserve existing working functionality unless a planning/spec document
explicitly replaces it.

## Product principles

- Dish-first
- Text-first
- Mobile-first
- Fast on slow connections
- Low data usage
- Prices are first-class information
- Search should be the primary interaction
- Restaurant information is secondary to the dish during discovery
- Accessibility over decorative effects
- Real menu data over visual decoration

## UI principles

Do not use restaurant or dish photography in:

- homepage hero
- dish search results
- restaurant listing cards

Prefer:

- strong typography
- whitespace
- subtle borders
- compact filter chips
- system fonts
- lightweight SVG icons
- restrained CSS transitions

Avoid:

- large hero images
- carousels
- image-heavy cards
- unnecessary animation
- large UI dependencies
- external fonts when avoidable

### Theming

Both a light theme (the primary/default design direction, per
`docs/mockups/`) and the original dark theme are supported as
user-selectable options — dark is not being deprecated. Use the CSS custom
properties defined in `app/globals.css` (`var(--text-primary)`,
`var(--border)`, `var(--green)`, etc.) for any color, border, or surface
styling instead of hardcoded values, so new UI works correctly in both
themes automatically. See `docs/guides/design-reference.md` and
`planning/specs/tickets/theme-design-tokens.md`.

## Performance principles

Target:

- <250 KB initial transferred data where realistically possible
- no restaurant/dish images during initial page load
- no full menu database downloaded to the client
- paginated or progressively loaded search results
- small JavaScript bundle
- caching where appropriate
- API responses limited to required fields

Performance is a product feature, not a later optimization.

## Development workflow

Before making major architectural or UX changes:

1. Inspect the existing implementation.
2. Identify reusable code.
3. Identify the smallest required change.
4. List affected files.
5. Note regression risks.
6. Implement only the requested scope.
7. Run available build, typecheck, lint and tests.
8. Report changes and remaining issues.

Do not silently expand ticket scope.

## Initial migration rule

The first phase is analysis only.

Before implementing the dish-first redesign, audit:

- project architecture
- routes/pages
- restaurant data model
- dish/menu data model
- current search
- current filters
- reusable components
- components to replace
- image dependencies
- data loading strategy
- performance bottlenecks
- API/backend requirements
- regression risks

After the audit, STOP and wait for approval.

## Planning

Product specifications live under:

`planning/specs/`

Architecture and migration decisions live under:

`planning/architecture/`

Long-lived technical/product decisions live under:

`planning/decisions/`

Design mockups live under:

`docs/mockups/`

When visual direction matters, read:

`docs/mockups/README.md`

Commit workflow, plain-language change summaries, and versioning (practical
SemVer during this migration — stay on `0.x.y` until the dish-first flow is
genuinely stable) are documented under:

`docs/changelog/`

Commit after each approved ticket or clearly scoped sub-ticket; avoid large
mixed commits across unrelated work. See `docs/changelog/README.md` for the
full policy and the required commit message / plain-language summary /
changelog line for every approved step.

Always read the nearest CONTEXT.md before working inside a directory.
