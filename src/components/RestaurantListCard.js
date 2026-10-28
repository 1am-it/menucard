import Link from 'next/link'
import Emoji from '@/src/components/Emoji'
import EmojiText from '@/src/components/EmojiText'
import { cardModel } from '@/src/lib/restaurantBrowse'

// BE-28b (#68) — de kaart van /alle-restaurants volgens de goedgekeurde
// mockup (docs/mockups/be-28-fresh-style-v1/alle-restaurants-*.html).
//
// Eén kaart is één link naar de bestaande restaurantpagina; daarbinnen staan
// geen geneste links of knoppen. De "knop" met menukaart is opmaak (een
// <span>) binnen die ene link. Zonder menukaart is er nooit een grote knop:
// alleen het neutrale label "Nog geen menukaart" en "Bekijk restaurant →".
// Op de telefoon wordt dat één compacte regel met een pijl.
//
// De emoji-tegel, "keuken · prijsklasse", het adres en de bestaande
// menukaart-labels (met hun eigen emoji) komen uit cardModel()
// (src/lib/restaurantBrowse.js), dus nooit uit verzonnen data.

export default function RestaurantListCard({ restaurant }) {
  const card = cardModel(restaurant)

  if (!card.hasMenu) {
    return (
      <Link href={card.href} className="ar-card ar-card--nomenu">
        <span className="ar-top">
          <Emoji glyph={card.emoji} className="ar-tile" />
          <span className="ar-main">
            <span className="ar-name">{card.name}</span>
            <span className="ar-kind">
              {card.kind}
              <span className="ar-nomenu-inline"> · {card.noMenuLabel}</span>
            </span>
          </span>
          <span className="ar-arrow" aria-hidden="true">→</span>
        </span>
        {card.address && (
          <span className="ar-address">
            <Emoji glyph="📍" /> {card.address}
          </span>
        )}
        <span className="ar-footer">
          <span className="ar-nomenu-label">{card.noMenuLabel}</span>
          <span className="ar-restaurant-link">
            {card.restaurantLabel} <span aria-hidden="true">→</span>
          </span>
        </span>
      </Link>
    )
  }

  return (
    <Link href={card.href} className="ar-card">
      <span className="ar-top">
        <Emoji glyph={card.emoji} className="ar-tile" />
        <span className="ar-main">
          <span className="ar-name">{card.name}</span>
          <span className="ar-kind">{card.kind}</span>
        </span>
      </span>
      {card.address && (
        <span className="ar-address">
          <Emoji glyph="📍" /> {card.address}
        </span>
      )}
      <span className="ar-menu-labels">
        {card.menuLabels.map((label) => (
          <span key={label} className="ar-menu-label"><EmojiText value={label} /></span>
        ))}
      </span>
      <span className="ar-cta">
        <Emoji glyph="📋" /> {card.ctaLabel}
      </span>
    </Link>
  )
}
