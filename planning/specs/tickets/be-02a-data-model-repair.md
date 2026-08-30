# BE-02a — Data Model Repair

## Depends on

BE-01 (done)

## Goal

Fix the data underneath the current features before anything is built on top
of it. This is data cleanup, not new UI.

## Scope

- **Price normalization**: add a numeric price field to every menu item.
  Derive the display string (`€34,50`) from the number, not the other way
  around. Decide and document how "price on request" (`price: null`) is
  represented once normalized.
- **Reservation model**: add explicit fields to the restaurant model —
  `reservationType`, `reservationUrl`, `reservationPhone`,
  `reservationWhatsapp` — populated per restaurant from real data. Stop
  inferring "accepts WhatsApp" from the presence of a phone number.
- **Dish-result shape**: define and document the shape BE-02b/BE-02c/BE-03
  will produce and consume: dish name, numeric price, restaurant reference,
  short description, dietary/category tags, distance/open-status (nullable),
  menu link. This is a data-shape contract, not an implementation.
- **Allergen consistency**: reconcile `allergens: null` (unknown) vs
  `allergens: []` (confirmed none) consistently across all 11 menus so
  downstream filtering can trust the distinction.

## Out of scope

- Moving data server-side (BE-02b).
- Ranking/matching logic (BE-02c).
- Any UI change. Existing pages must render identically against the repaired
  data.

## Dependencies / sequencing note

Do this before BE-02b starts — BE-02b queries against this shape, so building
it in parallel risks building against data that changes underneath it.

## Key risk

`/menu/[id]`, `/restaurant/[id]` and `/nvwa/[id]` read the current JSON shape
directly today. Repairing the shape must not silently break them — treat this
as a refactor with the existing pages as regression tests, not a rewrite.

## Acceptance criteria

- [ ] Every menu item has a numeric price, or an explicit "price on request"
      state — no price is only a string.
- [ ] Every restaurant has an explicit, real reservation method — none is
      inferred from unrelated fields.
- [ ] The dish-result shape is written down (e.g. as a JSDoc type or a short
      markdown table) somewhere BE-02b/BE-02c can reference.
- [ ] `allergens` is never ambiguous between "unknown" and "none" across the
      full dataset.
- [ ] `/menu/[id]`, `/restaurant/[id]`, `/nvwa/[id]` render unchanged for a
      manual spot-check across a few restaurants.
