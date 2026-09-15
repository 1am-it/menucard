import Link from 'next/link'

// BE-11 — the light, text-first restaurant browse card. Built for
// /alle-restaurants (Fase 1) and extracted here, unchanged, so /search
// (Fase 2) can render the same card in its "Restaurants gevonden" group
// instead of duplicating it. Consumes the public shape documented in
// docs/api/restaurant-summary-shape.md (GET /api/restaurants /
// src/services/restaurantIndex.js) — restaurant-level fields only, never
// dish/menu content.
//
// Deliberately keeps every constraint from the original ticket: exactly
// one primary action per card (view menu(s), or view the restaurant when
// there is no menu yet), an accessible (not aria-label-overridden) price
// level, a real address rendered as-is, an explicit "Buurt: X" fallback
// when there is no valid address (never a bare neighbourhood name in the
// same slot/style a street address would occupy), and no contact,
// reservation, phone, chat, or website action of any kind.
//
// `headingLevel` (default 2) picks the restaurant-name heading's tag. On
// /alle-restaurants, the card sits directly under that page's own <h1>, so
// the default <h2> is correct and unchanged. On /search (BE-11 Fase 2),
// the card sits inside a "Restaurants gevonden" <h2> group heading, so
// that page passes headingLevel={3} — otherwise the restaurant's own name
// would render as a sibling <h2> to the group heading itself, flattening
// the group→item hierarchy for screen-reader heading navigation (a real
// defect a pre-commit review found and this prop exists to fix). Purely a
// tag choice — `.lrc-name`'s styling is class-based, not tag-based, so
// this never changes how the card looks.

const PRICE_LEVEL_LABEL = { 1: 'laag', 2: 'gemiddeld', 3: 'hoog' }

// Menu-type ids are "{restaurantId}-{mealType}" — derive a clean label
// from the suffix rather than using menuLinks[].label, which carries an
// emoji prefix (e.g. "🥗 Lunchkaart") not appropriate for this light
// card's plain-text information row. See BE-11 ticket §2 (no emoji).
const MEAL_TYPE_LABELS = {
  lunch: 'Lunch',
  diner: 'Diner',
  borrel: 'Borrel',
  specialiteiten: 'Specialiteiten',
}

function mealTypeLabel(menuLinkId, restaurantId) {
  const suffix = menuLinkId.slice(restaurantId.length + 1)
  return MEAL_TYPE_LABELS[suffix] || suffix
}

export default function RestaurantBrowseCard({ restaurant, headingLevel = 2 }) {
  const priceLabel = restaurant.priceLevel ? PRICE_LEVEL_LABEL[restaurant.priceLevel] : null
  const priceGlyph = restaurant.priceLevel ? '€'.repeat(restaurant.priceLevel) : null
  const NameHeading = headingLevel === 3 ? 'h3' : 'h2'

  return (
    <article className="lrc-card">
      <div className="lrc-header">
        <NameHeading className="lrc-name">{restaurant.name}</NameHeading>
        <div className="lrc-cuisine">
          {restaurant.cuisine}
          {priceGlyph && (
            <>
              <span aria-hidden="true"> · <span className="lrc-price-glyph">{priceGlyph}</span></span>
              <span className="vh">, prijsniveau: {priceLabel}</span>
            </>
          )}
        </div>
      </div>
      <div className="lrc-body">
        {restaurant.hasMenu && (
          <div className="lrc-menu-type-row" aria-label="Beschikbare menutypen">
            {restaurant.menuLinks.map((link) => (
              <span key={link.id} className="lrc-menu-type-pill">
                {mealTypeLabel(link.id, restaurant.restaurantId)}
              </span>
            ))}
          </div>
        )}
        <div className="lrc-meta">
          {restaurant.address ? (
            <span className="lrc-address">{restaurant.address}</span>
          ) : restaurant.buurt ? (
            // No valid address on file (see docs/api/restaurant-summary-
            // shape.md "Known limitations") — fall back to the buurt,
            // but say so explicitly ("Buurt: X") rather than showing a
            // bare neighbourhood name in the exact same slot/style a
            // real street address would occupy, which could otherwise
            // read as an unusually short address. The visible text is
            // the only accessible name here (no aria-label override),
            // so both are identical by construction.
            <span className="lrc-address">Buurt: {restaurant.buurt}</span>
          ) : null}
          {restaurant.openStatus && (
            <span className={`lrc-status is-${restaurant.openStatus}`}>
              {restaurant.openStatus === 'open' ? 'Open nu' : 'Gesloten'}
            </span>
          )}
        </div>
      </div>
      <div className="lrc-footer">
        {restaurant.hasMenu ? (
          <Link href={`/restaurant/${restaurant.restaurantId}`} className="lrc-primary-btn">
            Bekijk {restaurant.menuLinks.length} menukaart{restaurant.menuLinks.length !== 1 ? 'en' : ''}
          </Link>
        ) : (
          <>
            <Link href={`/restaurant/${restaurant.restaurantId}`} className="lrc-primary-btn">
              Bekijk restaurant
            </Link>
            <p className="lrc-secondary-note">Nog geen menukaart beschikbaar.</p>
          </>
        )}
      </div>
    </article>
  )
}
