# SHARE-1 — Gerecht delen v1

## Status

**Ready for implementation — not started.** No code, route, test or
style for this ticket exists yet. This ticket only specifies the work.

Authorized by:

- `share-0-dish-sharing-v1-decision.md`: D1 = A, D2 = A, D3 = A
  (product owner, 2026-10-09);
- `market-10-shareable-links.md`, "Amendment (2026-10-09, `SHARE-0`)":
  the narrow exception that allows exactly this action on today's static
  read path.

Where this ticket and those two documents seem to differ, they win; this
ticket may only be narrower.

## Goal

A visitor can share one dish from a menu page with someone else, as a
plain link to that dish on the existing menu page. Nothing is ordered,
booked, reviewed, published, measured or ranked.

## Depends on

- BE-12: the dish deep link `/menu/[id]?dish=…&name=…&cat=…`, its
  resolver `resolveDishTarget()` (`src/lib/dishDeepLink.js`) and its
  link construction `buildDishMenuHref()` (`app/search/page.js`).
- Decision 014 (orientation, focus, no dead ends, acceptance checklist).
- `docs/guides/design-reference.md` ("Kleurtaal v2", theme contract,
  "Product positioning and branding", accessibility).
- Visual handoff `docs/mockups/share-1-dish-sharing-handoff-v1.pdf`
  (see "Visual reference").

## Scope

### 1. "Deel gerecht" on every menu item

- A "Deel gerecht" button on each dish card on `/menu/[id]`.
- Secondary and outlined, like `.rp-btn-website`: never an oker fill,
  never visually stronger than the reservation action, never styled as
  ordering or a primary action.
- `aria-label`: "Deel gerecht: {gerechtnaam}". Touch target at least
  44 px on mobile.

### 2. Share sheet (mobile) and popover (desktop)

- Activating "Deel gerecht" opens a small dialog: a bottom sheet on
  mobile, a popover on desktop. It shows "{gerechtnaam} · {restaurantnaam}",
  the link, and the actions:
  - **"Delen met je apps"** — only when the Web Share API is available;
    calls `navigator.share({ text, url })` (see 4). Cancelling the
    system sheet is silent.
  - **"Kopieer link"** — always present (the fallback everywhere, and
    the only action on desktop). On success: "Link gekopieerd", with a
    check icon, in a `role="status"` region. If the clipboard is
    unavailable, the link field is selected so it can be copied by hand
    — no error styling.
  - **"Sluiten"**.
- Dialog semantics: focus moves into the dialog; Esc and "Sluiten"
  close it; focus returns to the "Deel gerecht" button that opened it.

### 3. The link — exactly the canonical BE-12 dish link

- The shared URL is `{origin}/menu/[id]?dish=…&name=…&cat=…` and
  nothing else. `{origin}` is the site origin (`window.location.origin`);
  no other part of the current browser URL is used.
- Never: `fromQuery`, `q`, `excl`, a fragment, a marker or any other
  parameter.
- Built from the dish being shared — its route id, category position,
  item position, name and category — with the same construction as
  `buildDishMenuHref()` (`URLSearchParams`, keys `dish`, `name`, `cat` in
  that order), always without a search query, so `fromQuery` is never
  set. A shared helper with identical output is allowed; a second,
  different link format is not.
- Every generated link must resolve back to the same item through
  `resolveDishTarget()` (tested).

### 4. Share text

- `text`: "{gerechtnaam} bij {restaurantnaam} — BredaEats"; `url`: the
  link from 3. The copy fallback copies only the link.
- Only the dish name and restaurant name as rendered on the page, the
  name BredaEats and the link. No city, price, availability, allergen,
  diet, date, ranking or marketing language. Never built from raw
  query-string values.
- BredaEats in the share text is deliberate: it is an outgoing message
  (design-reference, "Product positioning and branding"). All visible UI
  says Onze Menukaarten.

### 5. Dish page context (every resolved dish deep link)

- When `resolveDishTarget()` resolves a dish, from search or from a
  shared link alike, the highlighted dish card shows a context line
  inside the card:
  - "Je bekijkt een gerecht uit de menukaart." (info icon);
  - "Prijs en beschikbaarheid kunnen wijzigen." — a caveat, not an
    availability claim;
  - "Bekijk menukaart" → `/menu/[id]` without any parameters.
- The line stays visible after BE-12's 4 s highlight; scroll position
  shows the line and the dish together. BE-12's scroll, focus and
  `aria-live` behaviour stays as it is.
- The copy never says or implies that the link was shared, sent or
  received.

### 6. Mismatch status (every non-resolving dish deep link)

- When the URL carries `dish`, `name` or `cat` and `resolveDishTarget()`
  returns `null`, the menu shows a neutral status above the menu:
  - "Dit gerecht staat niet (meer) op deze menukaart." (neutral icon);
  - "Er is geen gerecht gemarkeerd.";
  - "Bekijk menukaart" → `/menu/[id]` without parameters.
- `role="status"`, `--status-neutral` styling, icon plus text — never
  the blocked/red role: this is not the visitor's error.
- No dish is highlighted, focused or guessed. A dish that resolves but is
  hidden by an active filter keeps BE-12's existing behaviour and is not
  a mismatch.
- This replaces BE-12's silent fallback for every dish deep link
  (including those from search results). It supersedes BE-12's non-goal
  "No automatic 'item no longer exists' error message"; the
  implementation adds a short cross-reference to this ticket in the
  BE-12 ticket.
- A menu or restaurant that no longer exists keeps the existing
  "Menu niet gevonden" page, which already offers a way back (decision
  014, no dead ends).

## Out of scope

- Price, "Laatst gezien" or any date in the sheet, popover, share text or
  context line; any availability claim.
- Link preview, Open Graph tags, per-dish metadata, a share image or
  Story card ("Deel als kaart").
- A separate receiving page ("Gedeeld gerecht"), or copy such as "Iemand
  deelde dit gerecht met je" or "Je bekijkt een gedeelde gerechtlink".
- Social network logos or brand-specific share buttons (WhatsApp,
  Instagram and so on).
- Any measurement: no analytics, event, counter, cookie, `localStorage`,
  unique share ID, marker or dashboard (`SHARE-0` D2).
- Any popularity: no "Vaak gedeeld", "Recent gedeeld", ranking, filter,
  sort, badge or counter (`SHARE-0` D3).
- Menu links and personal multi-dish selections (they stay in
  `MARKET-10`).
- Any change to search, ranking, reservation routing (BE-07), the menu
  route's data, the app shell (header, back link, meal switch,
  categories, restaurant panel), APIs, database, dependencies, workflows
  or deployment configuration.

## Visual reference

`docs/mockups/share-1-dish-sharing-handoff-v1.pdf` is the conceptual
implementation reference: layout, the token mapping per part, copy and
visual acceptance criteria, for desktop and mobile, light and dark. It
is not a product decision on its own and does not override this ticket,
`SHARE-0`, the `MARKET-10` amendment or the design reference.

Not adopted from the earlier concept boards: serif type, the restaurant
illustration, the account icon and their navigation items.

## Design and accessibility requirements

- Kleurtaal v2 tokens only (design-reference, "Kleurtaal v2"), with the
  part-to-token mapping of the handoff; no hard-coded colours. Readable
  text uses `--text-primary` or `--text-secondary` only.
- System font; no external font.
- Light and dark per the existing theme contract (explicit Licht/Donker,
  dark is the runtime default); dark identical to the existing dark
  identity.
- Text at least 4.5:1 and focus and essential UI at least 3:1, in both
  themes, also on the highlighted card; measured and recorded.
- Visible `:focus-visible` on "Deel gerecht", the sheet actions, "Kopieer
  link", "Sluiten" and "Bekijk menukaart".
- Keyboard: open and close the sheet or popover with Enter and Esc;
  focus returns to the button.
- No horizontal page overflow at 390 px and at desktop width (decision
  014), and at 320 px as an additional limit for this ticket.
- Status and notices are icon plus text, never colour alone.
- No photography, illustration, gradient, stars, score, cart, delivery
  or booking look in the share flow.
- Within decision 003's performance budget; no new dependency.

## Tests and verification

- Unit tests for the link builder: only `dish`, `name` and `cat`; never
  `fromQuery`, `q`, `excl` or a fragment, also when the current page URL
  has them; round-trip through `resolveDishTarget()` for normal items,
  same-named items and the first and last positions.
- Unit tests for the share text: only dish name, restaurant name,
  BredaEats; no price, city or other fields.
- Tests for the dish page: the context line for a resolved link; the
  mismatch status (and no highlight) for a changed, removed, malformed
  or partial link; no mismatch for a resolved but filtered dish.
- Structural tests: no `navigator.share` call without a feature check;
  no analytics, cookie, `localStorage` or tracking; no Open Graph or
  `generateMetadata` change for the menu route; no forbidden copy
  ("gedeeld met", "verstuurd", "ontvangen", "Vaak gedeeld").
- A local browser check at 320, 390 and 1280 px in light and dark:
  sheet, popover, copy confirmation, context line, mismatch status,
  keyboard, focus, contrast, no overflow.
- The full test suite and a production build pass, or any failure is
  shown to exist on the base commit already.

## Acceptance criteria

- [ ] "Deel gerecht" exists on every dish card, secondary and outlined,
      with an accessible name that includes the dish name.
- [ ] "Delen met je apps" appears only when the Web Share API exists;
      "Kopieer link" always works, with "Link gekopieerd" as status.
- [ ] The shared link is exactly `/menu/[id]?dish=…&name=…&cat=…` on the
      site origin, built from the dish, never from the browser URL, and
      it resolves back to the same dish.
- [ ] The share text contains only dish name, restaurant name, BredaEats
      and the link; visible UI says Onze Menukaarten.
- [ ] Every resolved dish deep link shows the generic context line and
      "Bekijk menukaart"; nothing claims sharing, sending or receiving.
- [ ] Every non-resolving dish deep link shows the neutral mismatch
      status; nothing is highlighted or guessed.
- [ ] No price, date, availability claim, preview, Open Graph,
      receiving page, share card, social logo, measurement or popularity
      feature exists.
- [ ] Kleurtaal v2 tokens, system font, light and dark, visible focus,
      keyboard operation, contrast and no overflow at 320, 390 and
      desktop are verified and recorded.
- [ ] No API, database, migration, dependency, workflow or deployment
      configuration change.
- [ ] The BE-12 ticket carries a cross-reference to this ticket for the
      replaced silent fallback.

## Release

One app PR after this ticket and the `MARKET-10` amendment are on
`main`. No migration, no workflow, no production data change.
