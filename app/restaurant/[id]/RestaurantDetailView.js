'use client'
import { useState } from 'react'
import Link from 'next/link'
import ThemeToggle from '@/src/components/ThemeToggle'
import ShareSettingsButton from '@/src/components/ShareSettingsButton'
import MobileTabBar from '@/src/components/MobileTabBar'
import { getReservationActions, getReservationNote, isExternalReservation, isValidPhone, isValidUrl } from '@/src/utils/reservation'
import Wordmark from '@/src/components/Wordmark'
import Emoji from '@/src/components/Emoji'
import EmojiText from '@/src/components/EmojiText'
import ExternalLinkIcon from '@/src/components/ExternalLinkIcon'
import StatusIcon from '@/src/components/StatusIcon'
import useClientNow from '@/src/components/useClientNow'
import { todayOpening, openingBadge } from '@/src/lib/openingStatus'
// BE-42 (#98) 2A — de hele kaart van het actieve tabblad is exact dezelfde
// opbouw als op /menu/<id> (src/components/MenuBody.js). Geen tweede
// weergave van gerechten.
import { StaticMenu } from '@/src/components/MenuBody'
// BE-57 (#139): de anonieme teller "bekeken", één keer per pagina en per
// sessie, na het laden en zonder dat deze pagina erop wacht.
import ViewBeacon from '@/src/components/ViewBeacon'

const DAYS = ['ma','di','wo','do','vr','za','zo']
const DAY_LABELS = {
  ma: 'Maandag', di: 'Dinsdag', wo: 'Woensdag', do: 'Donderdag',
  vr: 'Vrijdag', za: 'Zaterdag', zo: 'Zondag'
}
const DAY_SHORT = { ma:'Ma', di:'Di', wo:'Wo', do:'Do', vr:'Vr', za:'Za', zo:'Zo' }

function getTodayKey() {
  const map = ['zo','ma','di','wo','do','vr','za']
  return map[new Date().getDay()]
}

export default function RestaurantDetailView({ id, restaurant, menus }) {
  const todayKey = getTodayKey()
  const [activeDay, setActiveDay] = useState(todayKey)
  // Kleurtaal v2: "Nu open" only when open at this moment (browser clock,
  // after mount) — opening hours today alone are not a positive status.
  const now = useClientNow()

  if (!restaurant) {
    return (
      <div className="empty-state" style={{ paddingTop: 80 }}>
        <h3>Restaurant niet gevonden</h3>
        <p>
          <Link href="/" style={{ color: 'var(--accent)' }}>← Terug naar overzicht</Link>
        </p>
      </div>
    )
  }

  const menuLinks = restaurant.menuLinks || []
  const reservationActions = getReservationActions(restaurant)
  const primaryReservation = reservationActions[0]
  const priceStr = '€'.repeat(restaurant.priceLevel || 2)
  const openingHours = restaurant.openingHours || {}
  const todayBadge = openingBadge(now ? todayOpening(openingHours, now) : null, openingHours, todayKey)

  return (
    <>
      <ViewBeacon restaurantId={id} />
      {/* ── Header ── */}
      <header>
        <div className="header-inner">
          <Wordmark />
          <div className="header-actions">
            <ThemeToggle />
            <ShareSettingsButton />
            <Link href="/alle-restaurants" className="back-btn">← Alle restaurants</Link>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      {/* Geen gradient en geen restaurantkleur als achtergrond (design-reference:
          geen huisstijl van restaurants overnemen; Onze Menukaarten: geen gradients). */}
      <div className="detail-hero">
        <div className="detail-hero-inner">

          {/* Left: main info */}
          <div>
            {restaurant.badge && (
              <div className="detail-badge"><EmojiText value={restaurant.badge} /></div>
            )}
            <h1 className="detail-name">{restaurant.name}</h1>
            <div className="detail-cuisine">{restaurant.cuisineLabel || restaurant.cuisine}</div>

            <p className="detail-desc">{restaurant.description}</p>

            {restaurant.tags?.length > 0 && (
              <div className="detail-tags">
                {restaurant.tags.map(tag => (
                  <span key={tag} className="detail-tag"><EmojiText value={tag} /></span>
                ))}
              </div>
            )}

            {/* Menu links */}
            {menuLinks.length > 0 && (
              <div className="detail-menu-links">
                {menuLinks.map(link => (
                  <Link key={link.id} href={`/menu/${link.id}`} className="detail-menu-btn">
                    <EmojiText value={link.label} />
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Right: info panel */}
          <div className="detail-info-panel">

            {/* Open status */}
            <div>
              <div className="dip-section-title">Vandaag</div>
              <div style={{ marginBottom: 4 }}>
                <span className={`status-badge status-badge--${todayBadge.role}`} style={{ fontSize: 13 }}>
                  {todayBadge.role === 'positive' && <Emoji glyph="🟢" />}
                  <StatusIcon name={todayBadge.icon} size={14} />
                  {todayBadge.text}
                </span>
              </div>
            </div>

            {/* Contact */}
            <div>
              <div className="dip-section-title">Contact</div>
              <div className="dip-row">
                <span className="dip-icon" aria-hidden="true">📍</span>
                <span>{restaurant.address}</span>
              </div>
              {isValidPhone(restaurant.phone) && (
                <div className="dip-row" style={{ marginTop: 6 }}>
                  <span className="dip-icon" aria-hidden="true">📞</span>
                  <a href={`tel:${restaurant.phone}`} style={{ color: 'inherit' }}>
                    {restaurant.phoneDisplay || restaurant.phone}
                  </a>
                </div>
              )}
              {isValidUrl(restaurant.website) && (
                <div className="dip-row" style={{ marginTop: 6 }}>
                  <span className="dip-icon" aria-hidden="true">🌐</span>
                  <a href={restaurant.website} target="_blank" rel="noopener noreferrer"
                    style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: 12 }}>
                    {restaurant.website.replace('https://','').replace('http://','').replace(/\/$/,'')}
                  </a>
                </div>
              )}
              <div className="dip-row" style={{ marginTop: 6 }}>
                <span className="dip-icon" aria-hidden="true">💶</span>
                <span>{priceStr} · {restaurant.price}</span>
              </div>
            </div>

            {/* Opening hours */}
            <div>
              <div className="dip-section-title">Openingstijden</div>
              <div className="hours-grid">
                {DAYS.map(day => {
                  const hours = openingHours[day]
                  const isToday = day === todayKey
                  return (
                    <div key={day} className={`hours-row ${isToday ? 'hours-today' : ''}`}
                      style={{ display: 'contents' }}>
                      <span className="hours-day" aria-current={isToday ? 'date' : undefined}>{DAY_SHORT[day]}</span>
                      {hours
                        ? <span className="hours-time">{hours}</span>
                        : <span className="hours-closed">Gesloten</span>
                      }
                    </div>
                  )
                })}
              </div>
            </div>

            {/* CTA */}
            <div className="dip-cta">
              {menuLinks.length > 0 && (
                <Link href={`/menu/${menuLinks[0].id}`} className="dip-btn-primary">
                  <Emoji glyph="📋" /> Bekijk menukaart
                </Link>
              )}
              {primaryReservation && (
                <a
                  href={primaryReservation.href}
                  target={isExternalReservation(primaryReservation) ? '_blank' : undefined}
                  rel={isExternalReservation(primaryReservation) ? 'noopener noreferrer' : undefined}
                  className="dip-btn-secondary dip-btn-reserve"
                >
                  {primaryReservation.label}
                  {isExternalReservation(primaryReservation) && <ExternalLinkIcon />}
                </a>
              )}
              {primaryReservation && (
                <p className="reservation-note">{getReservationNote(primaryReservation, restaurant.name)}</p>
              )}
            </div>

            {/* PLATFORM-07 — small, unobtrusive claim link, not a CTA */}
            <Link
              href={`/claim/${id}`}
              className="dip-claim"
              style={{ marginTop: 12, fontSize: 13, color: 'var(--text-secondary)' }}
            >
              Is dit jouw restaurant? Claim dit restaurant →
            </Link>
          </div>
        </div>
      </div>

      {/* ── Menukaarten (BE-42 2A) ── */}
      <main className="page-main page-with-tabbar">
        {menus ? (
          <section aria-labelledby="menukaarten-title">
            <div className="rpm-head">
              <h2 className="rpm-title" id="menukaarten-title">Menukaarten</h2>
              <Link href={`/menu/${menus.activeMenu.id}`} className="detail-menu-btn-outline">
                Bekijk menu →
              </Link>
            </div>

            {/* Echte links: de server rendert `?kaart=<id>` al, dus zonder
                JavaScript werkt hetzelfde. Met JavaScript wisselt Next.js
                alleen dit deel van de pagina (geen volledige herlaadbeurt) en
                laadt het precies één kaart. Geen prefetch: de andere kaarten
                blijven ongeladen. */}
            <nav className="meal-switch rpm-tabs" aria-label="Menukaarten">
              {menus.tabs.map(tab => (
                <Link
                  key={tab.id}
                  href={tab.href}
                  prefetch={false}
                  scroll={false}
                  className={`meal-btn ${tab.active ? 'active' : ''}`}
                  aria-current={tab.active ? 'page' : undefined}
                >
                  {tab.label}
                  <span className="rpm-tab-count" aria-hidden="true">{tab.dishCount}</span>
                  <span className="visually-hidden">, {tab.dishCount} gerechten</span>
                </Link>
              ))}
            </nav>

            <div className="rpm-panel">
              <p className="rpm-panel-title">
                {menus.activeMenu.label} · {menus.activeMenu.dishCount} gerechten
              </p>

              {menus.activeMenu.notes && (
                <div className="rp-note" style={{ marginBottom: 20 }}>
                  {menus.activeMenu.notes}
                </div>
              )}

              <StaticMenu
                categories={menus.activeMenu.categories}
                idPrefix={`rpm-${menus.activeMenu.id}`}
                sourceDate={menus.activeMenu.scraped}
              />

              {menus.activeMenu.source && (
                <div className="rp-source rpm-source">
                  Bron: <a href={menus.activeMenu.source} target="_blank" rel="noopener noreferrer">
                    {menus.activeMenu.source.replace('https://', '').replace('http://', '')}
                  </a>
                  {menus.activeMenu.scraped ? ` · ${menus.activeMenu.scraped}` : ''}
                </div>
              )}
            </div>
          </section>
        ) : (
          <section style={{ textAlign: 'center', padding: '60px 0' }}>
            <div style={{ fontSize: 36, marginBottom: 16 }}><Emoji glyph="📋" /></div>
            <h3 style={{ color: 'var(--text-secondary)', marginBottom: 8 }}>Menukaart nog niet beschikbaar</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 24 }}>
              Bekijk de website van het restaurant voor de actuele menukaart.
            </p>
            {isValidUrl(restaurant.website) && (
              <a href={restaurant.website} target="_blank" rel="noopener noreferrer"
                className="detail-menu-btn">
                Bezoek website →
              </a>
            )}
          </section>
        )}

        {/* NVWA link */}
        <div style={{
          marginTop: 48,
          padding: 20,
          background: 'var(--accent-faint)',
          border: '1px solid var(--accent-border)',
          borderRadius: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', marginBottom: 4 }}>
              <Emoji glyph="🛡" /> Allergeneninformatie (NVWA)
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Wettelijk verplichte allergenenmatrix · EU Verordening 1169/2011
            </div>
          </div>
          <Link href={`/nvwa/${id}`} className="dip-nvwa-btn" style={{
            padding: '9px 18px',
            background: 'var(--accent-fill)',
            color: 'var(--on-accent-fill)',
            fontSize: 13,
            fontWeight: 700,
            borderRadius: 8,
            textDecoration: 'none',
          }}>
            Bekijk allergenenmatrix
          </Link>
        </div>
      </main>

      <MobileTabBar />
    </>
  )
}
