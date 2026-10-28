import Link from 'next/link'
import Emoji from '@/src/components/Emoji'
import EmojiText from '@/src/components/EmojiText'
import { cardModel } from '@/src/lib/restaurantBrowse'

// BE-28b (#68) — de kaart van /alle-restaurants volgens de goedgekeurde
// mockup (docs/mockups/be-28-fresh-style-v1/alle-restaurants-*.html).
//
// BE-42 (#98) — 1A: de kaart is geen ene grote link meer. De restaurantnaam is
// de link naar de restaurantpagina en elke kaartnaam (Lunchkaart, Dinerkaart,
// Borrelkaart, …) is een eigen knop naar díe menukaart (/menu/<id>). De grote
// knop "Bekijk N menukaarten" is vervallen. Zonder menukaart blijft de kaart
// zoals hij was: één link met "Nog geen menukaart" en "Bekijk restaurant →";
// op de telefoon één compacte regel met een pijl.
//
// De tabvolgorde volgt de DOM: eerst de restaurantnaam, daarna de
// menuknoppen. Alle knoppen zijn echte links met een zichtbare focusring en
// een aanraakvlak van minimaal 44 px (app/globals.css).
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
    <article className="ar-card">
      <span className="ar-top">
        <Emoji glyph={card.emoji} className="ar-tile" />
        <span className="ar-main">
          <Link href={card.href} className="ar-name ar-name-link">
            {card.name}
          </Link>
          <span className="ar-kind">{card.kind}</span>
        </span>
      </span>
      {card.address && (
        <span className="ar-address">
          <Emoji glyph="📍" /> {card.address}
        </span>
      )}
      <ul className="ar-menu-buttons" aria-label={`Menukaarten van ${card.name}`}>
        {card.menuButtons.map((button) => (
          <li key={button.id}>
            <Link href={button.href} className="ar-menu-button">
              <EmojiText value={button.label} />
            </Link>
          </li>
        ))}
      </ul>
    </article>
  )
}
