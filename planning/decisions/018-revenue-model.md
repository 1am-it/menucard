# Decision 018 — Revenue model (proposal)

## Status

Proposal (2026-10-28), drafted by the Delivery Lead at the product owner's
request. Revised the same day: the owner dropped the "restaurants pay nothing"
premise. Restaurants may pay for services, positioned as **cheaper than the
competition**. Nothing is built from this note before an owner decision,
except the anonymous counters in step 0, which belong to the dish sharing
ticket (BE-44).

## Context

Menucard is a neutral, dish-first menu guide: real dishes, real prices, no
photos, no tracking, fast on slow connections. Its value to diners depends on
being **complete and neutral**. Its value to restaurants is that it already
holds their menu as structured data: dishes, prices, menu headings, opening
hours. Most of what restaurants pay others for today (a menu on their own
website, a QR menu at the table, a printable menu, translations, insight into
what guests choose) can be generated from that same data at almost no extra
cost.

Dish sharing and the saved list (mockup
https://claude.ai/artifact/JWaRewzvehJnmsnW4NxfgT) are the growth engine. They
also produce a demand signal no restaurant has today: which dishes people save
and send to each other.

## Rules that stay, whatever is sold

1. **Neutrality is never for sale.** Payment never changes search order,
   ranking, "Tonight on the menu" or any listing. Nothing is labelled
   "sponsored" because nothing is.
2. **A free basic listing for every restaurant**, including claiming the profile
   and correcting the menu and opening hours. A complete guide is what makes it
   valuable for diners, and so for paying restaurants.
3. **No advertising and no tracking of people.** Insights are aggregated counts.

## What restaurants can pay for

All of these come from data Menucard already maintains, so they cost us little
and can be priced well below separate tools.

| Service | What the restaurant gets | Replaces today | Our cost |
| --- | --- | --- | --- |
| Menu everywhere | Edit the menu once; it updates on Menucard, as a widget on the restaurant's own website, as a QR menu at the table and as a printable PDF | Web designer edits, a separate QR-menu tool, reprinting | Low: same data, extra output formats |
| Translations | English and German menu (tourists, students, expats), checked by the restaurant before it goes live | Translation agency or none | Pennies per menu with the existing AI budget |
| Allergens and diets | Structured allergen and diet labels per dish, shown consistently | Paper allergen lists | Low |
| Insights | Per dish: views, saves and shares per week; anonymous comparison with the neighbourhood | Nothing comparable | Low: from the step-0 counters |
| Daily special | Daghap or dagkaart published in seconds, also on the website widget | Social media posts by hand | Low |

**Proposed packages** (amounts are a starting point, to be checked against
current competitor prices before launch):

- **Free:** listing, claim, menu corrections, daily special on Menucard.
- **Pro, ±€9–19 per month:** the menu everywhere (widget, QR, PDF),
  translations, allergen labels, insights.
- **Chain, by arrangement:** several locations under one account.

**Launch offer:** the first 10–20 Breda restaurants get Pro free for six months
in return for feedback. That gives real use and testimonials before charging.

**Reservations:** do not build a reservation system. That is complex,
support-heavy and a crowded market. Link to the restaurant's own booking route
instead (see the affiliate option below).

## Revenue from others (unchanged from the first draft)

| Who pays | What for | Note |
| --- | --- | --- |
| City marketing, the business fund, tourism | A neutral, complete eating-out guide for Breda and its campaigns | Strong local fit; slow to arrange |
| Subsidies (innovation, regional economy, digitisation of hospitality) | Building the multi-city data platform | One-off money |
| Reservation platforms the restaurant already uses | Affiliate fee per seated guest via the restaurant's own booking route | Never adds a new paid route for the restaurant |
| Market research, suppliers, media | Aggregated price trends per dish type, area and city over time | Needs a second city and history |

## Explicitly rejected

- Paid placement, higher ranking or "featured" restaurants.
- Advertising, cookies and tracking of people.
- Locking basic corrections (wrong prices, opening hours) behind payment: wrong
  information hurts diners first.

## Proposed order

0. **Now, with BE-44:** anonymous counters per dish (shared, saved, reservation
   link clicked). No identity, no cookies.
1. **Product first:** claiming a profile and editing the menu must be easy and
   free. That is the foundation for every paid service.
2. **Pro pilot** with 10–20 Breda restaurants: the menu everywhere (website
   widget and QR menu) plus insights, free for six months.
3. **In parallel:** an offer to Breda city marketing and the business fund,
   based on the counters.
4. **Then:** Pro at its launch price, translations, allergen labels.
5. **Later:** reservation affiliate, data products, other cities.

## What this asks of the owner and the organisation

- **Sales and support:** someone has to approach restaurants and answer their
  questions. The product can be self-service; the first customers will still
  need a personal visit.
- **Administration:** subscriptions, invoices, VAT, general terms, and a data
  processing agreement under the GDPR (AVG) once restaurants log in.
- **Price check:** verify competitor prices (QR-menu tools, website menu
  widgets, translation, reservation commissions) before fixing the Pro price.

## Decisions needed from the owner

1. Agree with the three rules that stay and with the rejected list.
2. Agree with the direction: free basic listing, a Pro package priced below the
   competition, and the six-month pilot.
3. Choose the first paid service for the pilot: the menu everywhere (advice) or
   insights.
