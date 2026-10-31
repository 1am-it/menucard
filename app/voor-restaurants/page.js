// BE-64 (#156) — de pagina /voor-restaurants, volgens het op 31 oktober
// goedgekeurde ontwerp (artboards "5 · /voor-restaurants", desktop licht en
// mobiel donker).
//
// Een Server Component zonder client-JS van zichzelf: alleen de gedeelde kop
// (PublicHeaderActions) is client-JS, net als op /inloggen. De teksten, het
// voorbeeld van het weekoverzicht en de paden staan in
// src/lib/forRestaurantsCopy.js, zodat de tests één bron hebben.
//
// De opmaak staat in het eigen bestand ernaast (BE-52), met alleen tokens.

import Link from 'next/link'
import { FOR_RESTAURANTS } from '@/src/lib/forRestaurantsCopy'
import PublicFooter from '@/src/components/PublicFooter'
import PublicHeaderActions from '@/src/components/PublicHeaderActions'
import Wordmark from '@/src/components/Wordmark'
import './voor-restaurants.css'

export const metadata = {
  title: FOR_RESTAURANTS.metadata.title,
  description: FOR_RESTAURANTS.metadata.description,
}

// Lijn-iconen per kaart van "Wat je krijgt": inline SVG, geen afbeeldingen en
// geen dependency. De kleur komt uit --accent via currentColor (zie het
// stylesheet); de vorm is puur decoratief en dus aria-hidden.
const ICONS = {
  dish: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5" />
    </>
  ),
  price: (
    <>
      <path d="M4 12.5 12.5 4H19a1 1 0 0 1 1 1v6.5L11.5 20a1 1 0 0 1-1.4 0L4 13.9a1 1 0 0 1 0-1.4Z" />
      <circle cx="16" cy="8" r="1.3" />
    </>
  ),
  today: (
    <>
      <rect x="4" y="6" width="16" height="14" rx="2" />
      <path d="M8 4v4M16 4v4M4 11h16" />
    </>
  ),
  stats: <path d="M5 20V11M12 20V5M19 20v-6" />,
  share: (
    <>
      <circle cx="6" cy="12" r="2.3" />
      <circle cx="18" cy="6" r="2.3" />
      <circle cx="18" cy="18" r="2.3" />
      <path d="M8 10.9 16 7.1M8 13.1l8 3.8" />
    </>
  ),
  qr: (
    <>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <path d="M14 14h5M14 18h3M20 16v4" />
    </>
  ),
}

// De twee knoppen staan twee keer op de pagina: in de hero en onderaan. Dezelfde
// bron, dus dezelfde tekst en dezelfde bestemming.
function StartActions({ className }) {
  return (
    <div className={className}>
      <Link className="vr-cta-primary" href={FOR_RESTAURANTS.primary.href}>
        {FOR_RESTAURANTS.primary.label}
      </Link>
      <Link className="vr-cta-secondary" href={FOR_RESTAURANTS.secondary.href}>
        {FOR_RESTAURANTS.secondary.label}
      </Link>
    </div>
  )
}

export default function VoorRestaurantsPage() {
  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          {/* Hetzelfde navigatielandmark als de andere publieke pagina's
              (ops/browser/lib/a11y-audit.js, BE-51): het woordmerk is de weg
              terug naar de site. */}
          <nav className="vr-nav" aria-label="Naar de site">
            <Wordmark />
          </nav>
          <div className="header-right">
            <PublicHeaderActions />
          </div>
        </div>
      </header>

      <main className="vr-main">
        <section className="vr-hero" aria-labelledby="vr-title">
          <div className="vr-hero-text">
            <h1 className="vr-title" id="vr-title">
              {FOR_RESTAURANTS.title}
            </h1>
            <p className="vr-intro">{FOR_RESTAURANTS.intro}</p>
            <StartActions className="vr-actions" />
            <p className="vr-micro">{FOR_RESTAURANTS.micro}</p>
          </div>

          {/* Voorbeeldwerk: geen echte en geen verzonnen cijfers, daarom "—".
              De regel eronder zegt in gewone taal dat dit een voorbeeld is. */}
          <aside className="vr-preview" aria-labelledby="vr-preview-title">
            <h2 className="vr-preview-eyebrow" id="vr-preview-title">
              {FOR_RESTAURANTS.preview.eyebrow}
            </h2>
            <dl className="vr-preview-stats">
              {FOR_RESTAURANTS.preview.stats.map((stat) => (
                <div className="vr-preview-stat" key={stat.label}>
                  <dt className="vr-preview-label">{stat.label}</dt>
                  <dd className="vr-preview-value">{FOR_RESTAURANTS.preview.empty}</dd>
                </div>
              ))}
            </dl>
            <p className="vr-preview-caption">{FOR_RESTAURANTS.preview.caption}</p>
          </aside>
        </section>

        <section className="vr-features" aria-labelledby="vr-features-title">
          <h2 className="vr-section-title" id="vr-features-title">
            {FOR_RESTAURANTS.featuresTitle}
          </h2>
          <ul className="vr-feature-grid">
            {FOR_RESTAURANTS.features.map((feature) => (
              <li className="vr-feature" key={feature.key}>
                <svg
                  className="vr-feature-icon"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  focusable="false"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {ICONS[feature.key]}
                </svg>
                <h3 className="vr-feature-title">
                  {feature.title}
                  {feature.soon ? <span className="vr-soon">{FOR_RESTAURANTS.soonLabel}</span> : null}
                </h3>
                <p className="vr-feature-body">{feature.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="vr-allergens" aria-labelledby="vr-allergens-title">
          <div className="vr-allergens-text">
            <h2 className="vr-section-title" id="vr-allergens-title">
              {FOR_RESTAURANTS.allergens.title}
            </h2>
            <p className="vr-allergens-body">{FOR_RESTAURANTS.allergens.body}</p>
          </div>
          <Link className="vr-cta-secondary vr-allergens-action" href={FOR_RESTAURANTS.allergens.previewHref}>
            {FOR_RESTAURANTS.allergens.actionLabel}
          </Link>
        </section>

        <section className="vr-bottom-actions" aria-label="Aan de slag">
          <StartActions className="vr-actions" />
        </section>
      </main>

      <PublicFooter />
    </>
  )
}
