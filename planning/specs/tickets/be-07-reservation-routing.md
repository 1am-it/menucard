# BE-07 — Reservation Routing

## Depends on

BE-02a (reservation fields)

## Goal

CTA behaviour follows the real reservation capability per restaurant, per
`planning/specs/reservation-routing.md`.

## Scope

- Read `reservationType`/`reservationUrl`/`reservationPhone`/
  `reservationWhatsapp` from the BE-02a data model.
- CTA label reflects the real action: Reserveer / Reserveer online /
  Reserveer via WhatsApp / Bel restaurant.
- Never render a reservation method the restaurant doesn't actually support.
- Replace the current `whatsappUrl()`-for-anyone-with-a-phone-number logic in
  the existing restaurant card/detail components.

## Out of scope

- Adding new reservation integrations (e.g. a booking platform API) — this
  ticket routes to the correct *existing* method per restaurant, it doesn't
  add new methods.

## Key risk

Restaurants currently generating leads via the (technically incorrect) blanket
WhatsApp assumption must not lose that lead channel — verify against real
data before flipping the default, rather than assuming "no reservation data
present" means "no reservation method."

## Acceptance criteria

- [ ] CTA label matches the real reservation method per restaurant.
- [ ] No restaurant shows an unsupported reservation method.
- [ ] Every restaurant that previously had a working WhatsApp CTA still has
      one (fields populated from real data, not empty defaults).
