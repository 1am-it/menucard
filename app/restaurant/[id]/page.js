'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import ThemeToggle from '@/src/components/ThemeToggle'
import restaurantsData from '@/data/restaurants.json'
import menusData from '@/data/menus.json'

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

function getMenuPreview(restaurantId) {
  // Return first menu found for this restaurant
  const keys = Object.keys(menusData).filter(k => k.startsWith(`${restaurantId}-`))
  if (!keys.length) return null
  const key = keys[0]
  const menu = menusData[key]
  const items = []
  for (const cat of (menu.categories || [])) {
    for (const item of (cat.items || [])) {
      items.push({ ...item, category: cat.name })
      if (items.length >= 6) break
    }
    if (items.length >= 6) break
  }
  return { key, menu, items }
}

export default function RestaurantPage() {
  const params = useParams()
  const id = params.id
  const restaurant = restaurantsData[id]
  const todayKey = getTodayKey()
  const [activeDay, setActiveDay] = useState(todayKey)

  if (!restaurant) {
    return (
      <div className="empty-state" style={{ paddingTop: 80 }}>
        <h3>Restaurant niet gevonden</h3>
        <p>
          <Link href="/" style={{ color: 'var(--green)' }}>← Terug naar overzicht</Link>
        </p>
      </div>
    )
  }

  const menuLinks = restaurant.menuLinks || []
  const menuPreview = getMenuPreview(id)
  const priceStr = '€'.repeat(restaurant.priceLevel || 2)
  const openingHours = restaurant.openingHours || {}
  const todayHours = openingHours[todayKey]
  const isOpenToday = !!todayHours

  return (
    <>
      {/* ── Header ── */}
      <header>
        <div className="header-inner">
          <Link href="/" className="logo">Breda<span>Eats</span></Link>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <ThemeToggle />
            <Link href="/" className="back-btn">← Alle restaurants</Link>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <div className="detail-hero" style={{
        background: `linear-gradient(160deg, color-mix(in srgb, ${restaurant.color || 'var(--green)'} 40%, var(--bg)) 0%, var(--bg) 60%)`
      }}>
        <div className="detail-hero-inner">

          {/* Left: main info */}
          <div>
            {restaurant.badge && (
              <div className="detail-badge">{restaurant.badge}</div>
            )}
            <h1 className="detail-name">{restaurant.name}</h1>
            <div className="detail-cuisine">{restaurant.cuisineLabel || restaurant.cuisine}</div>

            <p className="detail-desc">{restaurant.description}</p>

            {restaurant.tags?.length > 0 && (
              <div className="detail-tags">
                {restaurant.tags.map(tag => (
                  <span key={tag} className="detail-tag">{tag}</span>
                ))}
              </div>
            )}

            {/* Menu links */}
            {menuLinks.length > 0 && (
              <div className="detail-menu-links">
                {menuLinks.map(link => (
                  <Link key={link.id} href={`/menu/${link.id}`} className="detail-menu-btn">
                    {link.label}
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{
                  display: 'inline-block',
                  width: 8, height: 8,
                  borderRadius: '50%',
                  background: isOpenToday ? 'var(--green)' : 'var(--text-dim)',
                  flexShrink: 0,
                }} />
                <span style={{ fontSize: 14, fontWeight: 700, color: isOpenToday ? 'var(--green)' : 'var(--text-muted)' }}>
                  {isOpenToday ? `Open · ${todayHours}` : 'Gesloten'}
                </span>
              </div>
            </div>

            {/* Contact */}
            <div>
              <div className="dip-section-title">Contact</div>
              <div className="dip-row">
                <span className="dip-icon">📍</span>
                <span>{restaurant.address}</span>
              </div>
              {restaurant.phone && (
                <div className="dip-row" style={{ marginTop: 6 }}>
                  <span className="dip-icon">📞</span>
                  <a href={`tel:${restaurant.phone}`} style={{ color: 'inherit' }}>
                    {restaurant.phoneDisplay || restaurant.phone}
                  </a>
                </div>
              )}
              {restaurant.website && (
                <div className="dip-row" style={{ marginTop: 6 }}>
                  <span className="dip-icon">🌐</span>
                  <a href={restaurant.website} target="_blank" rel="noopener noreferrer"
                    style={{ color: 'var(--green)', textDecoration: 'none', fontSize: 12 }}>
                    {restaurant.website.replace('https://','').replace('http://','').replace(/\/$/,'')}
                  </a>
                </div>
              )}
              <div className="dip-row" style={{ marginTop: 6 }}>
                <span className="dip-icon">💶</span>
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
                      <span className="hours-day">{DAY_SHORT[day]}</span>
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
                  Bekijk menukaart
                </Link>
              )}
              {restaurant.website && (
                <a href={restaurant.website} target="_blank" rel="noopener noreferrer"
                  className="dip-btn-secondary">
                  Reserveer via website →
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Menu preview ── */}
      <main className="page-main">
        {menuPreview ? (
          <section>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
                Menukaart preview — {menuPreview.menu.subtitle}
              </h2>
              <Link href={`/menu/${menuPreview.key}`} className="detail-menu-btn-outline">
                Volledige kaart →
              </Link>
            </div>

            {menuPreview.menu.notes && (
              <div className="rp-note" style={{ marginBottom: 20 }}>
                {menuPreview.menu.notes}
              </div>
            )}

            <div className="menu-grid">
              {menuPreview.items.map((item, i) => (
                <div key={i} className="menu-card">
                  <div className="card-top">
                    <div className="td-name">{item.name}</div>
                    {item.price && (
                      <div className="td-price">{item.price}</div>
                    )}
                  </div>
                  {item.desc && <div className="td-desc">{item.desc}</div>}
                  {item.wine && <div className="td-wine">🍷 {item.wine}</div>}
                  <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 6 }}>{item.category}</div>
                </div>
              ))}
            </div>

            {menuLinks.length > 0 && (
              <div style={{ marginTop: 24, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {menuLinks.map(link => (
                  <Link key={link.id} href={`/menu/${link.id}`} className="detail-menu-btn">
                    {link.label}
                  </Link>
                ))}
              </div>
            )}
          </section>
        ) : (
          <section style={{ textAlign: 'center', padding: '60px 0' }}>
            <div style={{ fontSize: 36, marginBottom: 16 }}>📋</div>
            <h3 style={{ color: 'var(--text-secondary)', marginBottom: 8 }}>Menukaart nog niet beschikbaar</h3>
            <p style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 24 }}>
              Bekijk de website van het restaurant voor de actuele menukaart.
            </p>
            {restaurant.website && (
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
          background: 'var(--green-faint)',
          border: '1px solid var(--green-border)',
          borderRadius: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)', marginBottom: 4 }}>
              🛡 Allergeneninformatie (NVWA)
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Wettelijk verplichte allergenenmatrix · EU Verordening 1169/2011
            </div>
          </div>
          <Link href={`/nvwa/${id}`} style={{
            padding: '9px 18px',
            background: 'var(--green)',
            color: 'var(--on-accent)',
            fontSize: 13,
            fontWeight: 700,
            borderRadius: 8,
            textDecoration: 'none',
          }}>
            Bekijk allergenenmatrix
          </Link>
        </div>
      </main>
    </>
  )
}
