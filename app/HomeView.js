'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import PublicHeaderActions from '@/src/components/PublicHeaderActions'
import PublicFooter from '@/src/components/PublicFooter'
import DaghappenVandaag from '@/src/components/DaghappenVandaag'
import PrimaryNav from '@/src/components/PrimaryNav'
import MobileTabBar from '@/src/components/MobileTabBar'
import Wordmark from '@/src/components/Wordmark'
import Emoji from '@/src/components/Emoji'
import useClientNow from '@/src/components/useClientNow'
// BE-65 (#157) — de bestaande bewaar- en deelknoppen bij elk gerecht van
// "Vanavond op de kaart". De deelkaart in de hero komt als prop binnen
// (Server Component, zie app/page.js).
import DishShareButton from '@/src/components/DishShareButton'
import SavedDishesBar from '@/src/components/SavedDishesBarLazy'
// BE-52 — opmaak die alleen bij deze pagina hoort, in een eigen bestand naast
// de pagina in plaats van onderaan app/globals.css.
import './home.css'
import { todayOpening } from '@/src/lib/openingStatus'
import { selectTonight } from '@/src/lib/publicTonight'
import { seasonTiles } from '@/src/lib/seasonCalendar'
import { zonedParts } from '@/src/lib/localTime'

// BE-28 — de frisse, emoji-rijke home (#65, owner decision 2026-10-25).
// BE-29 (#70) — de browser kiest "Vanavond op de kaart" nu zelf uit een
// compacte kandidatenlijst (props), met de browserklok en de kalender van
// Europe/Amsterdam. De server rendert de sectie, de seizoenstegels en alle
// labels daarom bewust niet: geen "Nu open" en geen daghap in de server-HTML.
// BE-38 (#90) — is er voor dit moment minder dan drie gerechten, dan toont
// dezelfde sectie de terugval uit src/lib/publicTonight.js: "Straks op de
// kaart · vanaf HH:MM" (het eerstvolgende moment van vandaag) of "Morgen op
// de kaart" (de lunch van morgen). Zulke gerechten krijgen "🕒 Opent om HH:MM";
// "Nu open" blijft voor wat nu echt open is.
// Referentie: docs/mockups/be-28-fresh-style-v1/home-licht.html en
// home-antraciet.html (canvas v14). Opbouw: zoekpaneel met "📍 Breda · echte
// menukaarten", emoji-titel, ronde zoekbalk en maaltijdchips; de tegelrij
// "Populair in Breda"; de seizoenstegels (alleen als de bestaande zoekopdracht
// nu resultaten heeft); "Vanavond op de kaart" met alleen echte gerechten en
// prijzen; en de regel "⚡ / 💶 / 📵".
//
// Geen nieuwe zoeklogica: elke chip, tegel en seizoenstegel linkt naar de
// bestaande /search-parameters (meal/cuisine/q) en de zoekbalk naar
// /search?q=. "🟢 Nu open" komt alleen uit de bestaande openingslogica
// (src/lib/openingStatus.js) met de browserklok — nooit uit een aanname.
// De emoji's zijn decoratief (aria-hidden via <Emoji/>).

const MEAL_SHORTCUTS = [
  { value: 'lunch', label: 'Lunch', glyph: '🥪' },
  { value: 'diner', label: 'Diner', glyph: '🍝' },
  { value: 'borrel', label: 'Borrel', glyph: '🍻' },
]

// Alleen keukens die in de bestaande zoeklogica bestaan
// (CUISINE_KEYWORDS in src/services/dishSearch.js), zodat elke tegel ook
// echt resultaten oplevert. Geen verzonnen keuken of gerecht.
const POPULAR_CUISINES = [
  { cuisine: 'Italiaans', glyph: '🍕' },
  { cuisine: 'Grill & Steak', glyph: '🥩' },
  { cuisine: 'Mediterraan', glyph: '🫒' },
  { cuisine: 'Indonesisch', glyph: '🍜' },
  { cuisine: 'Frans', glyph: '🥐' },
  { cuisine: 'Chinees', glyph: '🥡' },
]

const PROMISES = [
  { glyph: '⚡', text: 'Laadt snel, ook op 4G' },
  { glyph: '💶', text: 'Altijd met prijs' },
  { glyph: '📵', text: "Geen foto’s, wel info" },
]

export default function HomeView({ candidates = [], shareCard = null }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  // Browserklok, net als op de restaurant- en menukaartpagina. Vóór de
  // eerste meting is `now` null: dan is er geen "Nu open", geen daghap, geen
  // momentselectie en nog geen seizoenstegel.
  const now = useClientNow()
  const month = now ? zonedParts(now).month : null

  // BE-29 — de pure selectie draait in de browser. De server gaf alleen de
  // compacte kandidatenlijst mee, dus de keuze hangt nooit van de
  // serverklok of van een oude ISR-render af.
  const selection = useMemo(
    () => (now ? selectTonight({ candidates, now }) : null),
    [candidates, now]
  )
  const tonight = selection && !selection.hidden ? selection.dishes : []

  // BE-29 — een seizoenstegel is een bestaande zoekopdracht. Alleen een
  // tegel met echte resultaten verschijnt; de controle gebeurt in de browser
  // via de bestaande /api/search-route.
  const [seasonResult, setSeasonResult] = useState({ month: null, tiles: [] })
  useEffect(() => {
    if (month === null) return undefined
    let cancelled = false
    const tiles = seasonTiles(month)
    Promise.all(
      tiles.map(async (tile) => {
        try {
          const response = await fetch(`/api/search?q=${encodeURIComponent(tile.query)}&limit=1`)
          if (!response.ok) return null
          const data = await response.json()
          return data && data.total > 0 ? tile : null
        } catch {
          return null
        }
      })
    ).then((found) => {
      if (!cancelled) setSeasonResult({ month, tiles: found.filter(Boolean) })
    })
    return () => {
      cancelled = true
    }
  }, [month])
  const visibleSeasonTiles = seasonResult.month === month ? seasonResult.tiles : []

  const handleSubmit = (e) => {
    e.preventDefault()
    const trimmed = query.trim()
    router.push(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : '/search')
  }

  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <Wordmark />
          <div className="header-right">
            <PrimaryNav />
            <PublicHeaderActions />
          </div>
        </div>
      </header>

      <main className="page-with-tabbar">
        <section className="home-hero" aria-labelledby="home-title">
          <p className="home-eyebrow">
            <Emoji glyph="📍" /> Breda · echte menukaarten
          </p>
          <h1 className="home-title" id="home-title">
            Waar heb je vanavond zin in? <Emoji glyph="😋" />
          </h1>

          {/* BE-65 (issue 157) — twee kolommen op een breed scherm: links zoeken en
              de maaltijdchips, rechts de deelkaart. Op mobiel staat de kaart
              onder de zoekbalk en de chips. */}
          <div className="home-hero-grid">
            <div className="home-hero-main">
              <form className="home-search" role="search" onSubmit={handleSubmit}>
                <label htmlFor="home-q" className="home-search-label">Zoek een gerecht</label>
                <Emoji glyph="🔍" />
                <input
                  id="home-q"
                  type="search"
                  className="home-search-input"
                  placeholder="Pizza, pasta, risotto…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button type="submit" className="home-search-btn">Zoeken</button>
              </form>

              <div className="home-chips">
                {MEAL_SHORTCUTS.map((meal) => (
                  <Link key={meal.value} href={`/search?meal=${meal.value}`} className="home-chip">
                    <Emoji glyph={meal.glyph} />
                    {meal.label}
                  </Link>
                ))}
              </div>
            </div>
            {/* BE-65 ronde 3 — de kaart komt als Server Component van app/page.js
                binnen en kost daardoor geen client-JS. */}
            {shareCard}
          </div>
        </section>

        <section className="home-section" aria-labelledby="populair-title">
          <h2 className="home-section-title" id="populair-title">
            Populair in Breda <Emoji glyph="🔥" />
          </h2>
          <div className="home-tile-grid">
            {POPULAR_CUISINES.map((tile) => (
              <Link
                key={tile.cuisine}
                href={`/search?cuisine=${encodeURIComponent(tile.cuisine)}`}
                className="home-tile"
              >
                <Emoji glyph={tile.glyph} className="home-tile-emoji" />
                <span>{tile.cuisine}</span>
              </Link>
            ))}
          </div>
        </section>


        {/* BE-55: "Daghappen vandaag" — maximaal drie, in willekeurige
            volgorde, met een link "Alle" naar het filter "Vandaag". De sectie
            haalt het aanbod zelf op na het laden (browserklok) en verschijnt
            niet als er niets is. */}
        <DaghappenVandaag />

        {/* BE-29 — seizoenstegels verschijnen pas als de browser de maand
            kent én de bestaande zoekopdracht echte resultaten heeft. */}
        {visibleSeasonTiles.length > 0 && (
          <section className="home-section" aria-labelledby="seizoen-title">
            <h2 className="home-section-title" id="seizoen-title">
              Nu in het seizoen <Emoji glyph="🌿" />
            </h2>
            <div className="home-tile-grid">
              {visibleSeasonTiles.map((tile) => (
                <Link
                  key={tile.id}
                  href={tile.href}
                  className="home-tile"
                  data-season={tile.id}
                >
                  <Emoji glyph={tile.emoji} className="home-tile-emoji" />
                  <span>{tile.label}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Alleen renderen als de browser (met zijn eigen klok) drie echte
            gerechten met een echte prijs vindt (src/lib/publicTonight.js).
            BE-38: eerst het huidige moment, anders het eerstvolgende moment
            van vandaag, anders de lunch van morgen. Nooit een verzonnen
            gerecht of prijs, en geen lege sectie als de data het niet toelaat. */}
        {tonight.length > 0 && (
          <section
            className="home-section tonight-section"
            aria-labelledby="vanavond-title"
            data-meal={selection.mealType}
            data-mode={selection.mode}
          >
            <div className="home-section-head">
              <h2 className="home-section-title" id="vanavond-title">
                {selection.title} <Emoji glyph="🔥" />
              </h2>
              <Link href={`/search?meal=${selection.mealType}`} className="home-all-link">Alles →</Link>
            </div>
            <ul className="tonight-list">
              {tonight.map((dish) => {
                const isOpen = !!now && !!dish.openingHours && todayOpening(dish.openingHours, now).state === 'open'
                return (
                  <li key={dish.dishId} className="tonight-item">
                    <Link href={dish.href} className="tonight-card" data-dish={dish.dishId}>
                      <Emoji glyph={dish.emoji} className="tonight-emoji" />
                      <span className="tonight-main">
                        <span className="tonight-name">{dish.name}</span>
                        <span className="tonight-meta">
                          <span>{dish.restaurantName}</span>
                        </span>
                        {(dish.newOnMenu || dish.seasonal || dish.vegetarian || dish.daily || dish.opensAt || isOpen) && (
                          <span className="tonight-tags">
                            {dish.newOnMenu && (
                              <span className="tonight-tag tonight-tag--new">
                                <Emoji glyph="✨" /> Nieuw op de kaart
                              </span>
                            )}
                            {dish.seasonal && (
                              <span className="tonight-tag tonight-tag--season">
                                <Emoji glyph="🌿" /> Seizoen
                              </span>
                            )}
                            {dish.vegetarian && (
                              <span className="tonight-tag tonight-tag--veg">
                                <Emoji glyph="🌱" /> Vegetarisch
                              </span>
                            )}
                            {dish.daily && (
                              <span className="tonight-tag tonight-tag--daily">
                                <Emoji glyph="📅" /> Daghap · {dish.daily.dateLine}
                              </span>
                            )}
                            {dish.opensAt ? (
                              // BE-38 — een gerecht uit de terugval is er nog
                              // niet: het noemt het moment waarop het kan.
                              <span className="open-label open-label--later">
                                <Emoji glyph="🕒" />
                                Opent om {dish.opensAt}
                              </span>
                            ) : (
                              isOpen && (
                                <span className="open-label">
                                  <Emoji glyph="🟢" />
                                  Nu open
                                </span>
                              )
                            )}
                          </span>
                        )}
                      </span>
                      <span className="tonight-price">{dish.priceDisplay}</span>
                    </Link>
                    {/* BE-65 (issue 157) — de knoppen staan naast de link, nooit
                        erin: een knop in een link is geen bediening. Ze
                        gebruiken de bestaande componenten, dus dezelfde opslag
                        en dezelfde deelfunctie met de voorkeur uit "Delen via". */}
                    <div className="tonight-actions">
                      <DishShareButton
                        href={dish.href}
                        dish={{
                          dishId: dish.dishId,
                          name: dish.name,
                          category: dish.category,
                          price: dish.priceDisplay,
                          restaurantName: dish.restaurantName,
                        }}
                        dishKey={dish.dishId}
                        name={dish.name}
                        withLabel
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        <p className="home-promise">
          {PROMISES.map((promise) => (
            <span key={promise.text}>
              <Emoji glyph={promise.glyph} /> {promise.text}
            </span>
          ))}
        </p>

        <div className="home-browse">
          <Link href="/alle-restaurants" className="detail-menu-btn-outline">
            Bekijk alle restaurants →
          </Link>
        </div>
      </main>

      <PublicFooter />
      <SavedDishesBar />
      <MobileTabBar />
    </>
  )
}
