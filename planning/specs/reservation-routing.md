# Spec — Reservation Routing

## Goal

Send users to the correct reservation method for each restaurant.

## Rule

Do not assume every restaurant accepts WhatsApp reservations.

Reservation behaviour must be determined per restaurant.

Possible methods:

- official reservation URL
- restaurant booking platform
- WhatsApp
- telephone
- restaurant website

## Data model

A restaurant may expose something similar to:

- reservationType
- reservationUrl
- reservationPhone
- reservationWhatsapp

Use the project's existing model where possible rather than introducing
parallel fields unnecessarily.

## UX

The CTA label should reflect the real action.

Examples:

- Reserveer
- Reserveer online
- Reserveer via WhatsApp
- Bel restaurant

Do not display a reservation method that is unsupported by the restaurant.
