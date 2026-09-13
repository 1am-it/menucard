'use client'
import { useState } from 'react'
import Link from 'next/link'
import ThemeToggle from '@/src/components/ThemeToggle'

// EU Verordening 1169/2011 — 14 verplichte allergenen
const EU14 = [
  { id: 1,  code: 'glut', icon: '🌾', name: 'Gluten',          short: 'Glut' },
  { id: 2,  code: 'schaal', icon: '🦞', name: 'Schaaldieren',  short: 'Schaal' },
  { id: 3,  code: 'ei',   icon: '🥚', name: 'Eieren',          short: 'Ei' },
  { id: 4,  code: 'vis',  icon: '🐟', name: 'Vis',             short: 'Vis' },
  { id: 5,  code: 'pinda', icon: '🥜', name: 'Pinda\'s',       short: 'Pinda' },
  { id: 6,  code: 'soja', icon: '🫘', name: 'Soja',            short: 'Soja' },
  { id: 7,  code: 'melk', icon: '🥛', name: 'Melk / Lactose',  short: 'Melk' },
  { id: 8,  code: 'noten', icon: '🌰', name: 'Noten',          short: 'Noten' },
  { id: 9,  code: 'selderij', icon: '🥬', name: 'Selderij',    short: 'Selder' },
  { id: 10, code: 'mosterd', icon: '🌿', name: 'Mosterd',      short: 'Most.' },
  { id: 11, code: 'sesam', icon: '🌱', name: 'Sesamzaad',      short: 'Sesam' },
  { id: 12, code: 'so2',   icon: '🍇', name: 'Zwavel­dioxide', short: 'SO₂' },
  { id: 13, code: 'lupine', icon: '🌻', name: 'Lupine',        short: 'Lupin' },
  { id: 14, code: 'week',   icon: '🦑', name: 'Week­dieren',   short: 'Week' },
]

// Allergen cell status
function AllergenCell({ itemAllergens, allergenId }) {
  if (itemAllergens === null) {
    // Data not yet entered
    return <span className="allergen-unknown" title="Onbekend">?</span>
  }
  if (Array.isArray(itemAllergens) && itemAllergens.includes(allergenId)) {
    return <span className="allergen-yes" title="Aanwezig">✓</span>
  }
  return <span className="allergen-no" title="Niet aanwezig">—</span>
}

const COMPLIANCE_TONE = {
  // Neutral/informative — deliberately not the green "success" treatment.
  // A pct of 100 only means every item has *a* value (filled or explicitly
  // empty); it is not a verification result, so it must not read as one.
  // Reuses the same neutral pill treatment as /internal/moderation's
  // SourceTag (src/lib/moderationFormatting.js), not a new token.
  neutral: { color: 'var(--text-secondary)', bg: 'var(--bg-elevated)',   border: 'var(--border)' },
  partial: { color: 'var(--warning)', bg: 'var(--warning-bg)',    border: 'var(--warning-border)' },
  none:    { color: 'var(--danger)',  bg: 'var(--danger-bg)',     border: 'var(--danger-border)' },
}

function ComplianceScore({ items }) {
  if (!items.length) return null
  const known = items.filter(i => i.allergens !== null).length
  const pct = Math.round((known / items.length) * 100)
  const tone = pct === 100 ? COMPLIANCE_TONE.neutral : pct >= 50 ? COMPLIANCE_TONE.partial : COMPLIANCE_TONE.none
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '12px 16px',
      background: tone.bg,
      border: `1px solid ${tone.border}`,
      borderRadius: 10,
      marginBottom: 20,
    }}>
      <div style={{
        fontSize: 28, fontWeight: 800, color: tone.color,
        fontVariantNumeric: 'tabular-nums', minWidth: 52,
      }}>
        {pct}%
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: tone.color }}>
          {pct === 100 ? 'Elke gerechtregel heeft een waarde voor allergenen' : pct >= 50 ? 'Allergeneninformatie gedeeltelijk vastgelegd' : 'Allergeneninformatie grotendeels nog niet vastgelegd'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
          {known} van {items.length} gerechten hebben een waarde voor allergenen (ingevuld of leeg) —
          een lege waarde bevestigt geen afwezigheid van allergenen.
        </div>
      </div>
    </div>
  )
}

export default function NvwaView({ id, restaurant, allItems }) {
  const [filterAllergen, setFilterAllergen] = useState(null)
  const [filterMeal, setFilterMeal] = useState('')

  if (!restaurant) {
    return (
      <div className="empty-state" style={{ paddingTop: 80 }}>
        <h3>Restaurant niet gevonden</h3>
        <p><Link href="/" style={{ color: 'var(--green)' }}>← Terug naar overzicht</Link></p>
      </div>
    )
  }

  const mealTypes = [...new Set(allItems.map(i => i.mealType))]

  const filtered = allItems.filter(item => {
    if (filterMeal && item.mealType !== filterMeal) return false
    if (filterAllergen !== null) {
      // Show only items that contain this allergen
      if (!Array.isArray(item.allergens) || !item.allergens.includes(filterAllergen)) return false
    }
    return true
  })

  const handlePrint = () => window.print()

  return (
    <>
      <header>
        <div className="header-inner">
          <Link href="/" className="logo">Breda<span>Eats</span></Link>
          <div className="nvwa-header-actions">
            <ThemeToggle />
            <Link href={`/restaurant/${id}`} className="back-btn">← {restaurant.name}</Link>
            <button onClick={handlePrint} className="nvwa-export-btn">⬇ Export PDF</button>
          </div>
        </div>
      </header>

      <div className="nvwa-page">
        {/* Header */}
        <div className="nvwa-header">
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--green)', marginBottom: 6 }}>
              Allergenenmatrix · EU Verordening 1169/2011
            </div>
            <h1 className="nvwa-title">{restaurant.name}</h1>
            <div className="nvwa-subtitle">
              {restaurant.address} · {allItems.length} gerechten · 14 EU-allergenen
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
            <button onClick={handlePrint} className="nvwa-export-btn">⬇ Export PDF</button>
            <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>Gegenereerd {new Date().toLocaleDateString('nl-NL')}</div>
          </div>
        </div>

        {/* Compliance score */}
        <ComplianceScore items={allItems} />

        {/* Warning if incomplete */}
        {allItems.some(i => i.allergens === null) && (
          <div className="nvwa-warning">
            ⚠ Sommige gerechten missen nog allergeneninformatie (weergegeven als <strong>?</strong>).
            Dit betekent niet dat deze gerechten vrij zijn van deze allergenen — vul de ontbrekende
            gegevens aan zodra ze bekend zijn. {restaurant.name} blijft zelf verantwoordelijk voor de
            juistheid en volledigheid van deze informatie.
          </div>
        )}

        {/* Filters */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Filter:</span>

          {/* Meal type filter */}
          {mealTypes.length > 1 && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => setFilterMeal('')}
                style={{
                  padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                  border: `1px solid ${!filterMeal ? 'var(--green)' : 'var(--input-border)'}`,
                  background: !filterMeal ? 'var(--green-faint)' : 'var(--bg-input)',
                  color: !filterMeal ? 'var(--green)' : 'var(--text-muted)', cursor: 'pointer',
                }}>
                Alle kaarten
              </button>
              {mealTypes.map(m => (
                <button
                  key={m}
                  onClick={() => setFilterMeal(m)}
                  style={{
                    padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                    border: `1px solid ${filterMeal === m ? 'var(--green)' : 'var(--input-border)'}`,
                    background: filterMeal === m ? 'var(--green-faint)' : 'var(--bg-input)',
                    color: filterMeal === m ? 'var(--green)' : 'var(--text-muted)', cursor: 'pointer',
                  }}>
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
          )}

          {/* Allergen filter */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <button
              onClick={() => setFilterAllergen(null)}
              style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                border: `1px solid ${filterAllergen === null ? 'var(--green)' : 'var(--input-border)'}`,
                background: filterAllergen === null ? 'var(--green-faint)' : 'var(--bg-input)',
                color: filterAllergen === null ? 'var(--green)' : 'var(--text-muted)', cursor: 'pointer',
              }}>
              Alle allergenen
            </button>
            {EU14.map(a => (
              <button
                key={a.id}
                onClick={() => setFilterAllergen(filterAllergen === a.id ? null : a.id)}
                title={a.name}
                style={{
                  padding: '4px 8px', borderRadius: 6, fontSize: 11,
                  border: `1px solid ${filterAllergen === a.id ? 'var(--green)' : 'var(--input-border)'}`,
                  background: filterAllergen === a.id ? 'var(--green-faint)' : 'var(--bg-input)',
                  color: filterAllergen === a.id ? 'var(--green)' : 'var(--text-muted)', cursor: 'pointer',
                }}>
                {a.icon} {a.short}
              </button>
            ))}
          </div>
        </div>

        {/* Result count */}
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12 }}>
          {filtered.length} gerecht{filtered.length !== 1 ? 'en' : ''} weergegeven
          {filterAllergen !== null && ` met ${EU14.find(a => a.id === filterAllergen)?.name}`}
        </div>

        {/* Table */}
        {filtered.length === 0 ? (
          <div className="empty-state">
            <h3>Geen gerechten gevonden</h3>
            <p>Pas de filters aan om gerechten te zien.</p>
          </div>
        ) : (
          <div className="allergen-table-wrap">
            <table className="allergen-table">
              <thead>
                <tr>
                  <th>Gerecht</th>
                  {EU14.map(a => (
                    <th key={a.id} title={a.name}>{a.icon}<br />{a.short}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Group by meal type → category */}
                {(() => {
                  const rows = []
                  let lastMeal = null
                  let lastCat = null

                  for (const item of filtered) {
                    const mealLabel = item.menuSubtitle || item.mealType
                    if (item.mealType !== lastMeal) {
                      rows.push(
                        <tr key={`meal-${item.mealType}`}>
                          <td colSpan={15} style={{
                            background: 'var(--green-faint)',
                            color: 'var(--green)',
                            fontWeight: 700,
                            fontSize: 11,
                            textTransform: 'uppercase',
                            letterSpacing: '0.6px',
                            padding: '8px 12px',
                            borderLeft: '3px solid var(--green)',
                          }}>
                            {mealLabel}
                          </td>
                        </tr>
                      )
                      lastMeal = item.mealType
                      lastCat = null
                    }
                    if (item.category !== lastCat) {
                      rows.push(
                        <tr key={`cat-${item.mealType}-${item.category}`}>
                          <td colSpan={15} style={{
                            background: 'var(--bg-elevated)',
                            color: 'var(--text-dim)',
                            fontWeight: 600,
                            fontSize: 11,
                            padding: '6px 12px 6px 20px',
                          }}>
                            {item.category}
                          </td>
                        </tr>
                      )
                      lastCat = item.category
                    }
                    rows.push(
                      <tr key={item.key}>
                        <td>
                          <div className="allergen-item-name">{item.name}</div>
                          {item.desc && (
                            <div className="allergen-item-cat" style={{ marginTop: 2 }}>
                              {item.desc.length > 60 ? item.desc.slice(0, 60) + '…' : item.desc}
                            </div>
                          )}
                        </td>
                        {EU14.map(a => (
                          <td key={a.id}>
                            <AllergenCell itemAllergens={item.allergens} allergenId={a.id} />
                          </td>
                        ))}
                      </tr>
                    )
                  }
                  return rows
                })()}
              </tbody>
            </table>
          </div>
        )}

        {/* Legend */}
        <div className="nvwa-legend">
          <div className="nvwa-legend-item">
            <span className="allergen-yes">✓</span> Aanwezig
          </div>
          <div className="nvwa-legend-item">
            <span className="allergen-no">—</span> Niet opgegeven voor dit gerecht
          </div>
          <div className="nvwa-legend-item">
            <span className="allergen-unknown">?</span> Onbekend (nog niet vastgelegd)
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 8, maxWidth: 640 }}>
          Een "—" of "?" is geen garantie dat een gerecht vrij is van dit allergeen — het betekent
          alleen dat dit niet als aanwezig is geregistreerd in MenuCard.
        </div>

        {/* Legal footer */}
        <div style={{
          marginTop: 40,
          padding: '16px 20px',
          background: 'var(--bg-input)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          fontSize: 11,
          color: 'var(--text-faint)',
          lineHeight: 1.6,
        }}>
          <p style={{ margin: '0 0 8px 0' }}>
            <strong style={{ color: 'var(--text-dim)' }}>Achtergrond:</strong> EU Verordening (EU) Nr. 1169/2011
            verplicht horecabedrijven in Nederland om allergene informatie over hun gerechten beschikbaar te
            stellen aan gasten. Toezicht hierop ligt bij de NVWA (Nederlandse Voedsel- en Warenautoriteit).
            MenuCard helpt {restaurant.name} deze informatie overzichtelijk vast te leggen en te delen —
            MenuCard voert zelf geen keuring of inspectie uit.
          </p>
          <p style={{ margin: '0 0 8px 0' }}>
            Deze pagina, en een eventuele geprinte of gedownloade versie ervan, is een momentopname van de
            op dit moment in MenuCard vastgelegde informatie — geen certificering, keuring of juridische
            garantie van naleving. {restaurant.name} blijft zelf verantwoordelijk voor de juistheid en
            actualiteit van deze gegevens, de gebruikte recepturen, leveranciersinformatie, en het beheersen
            van kruisbesmettingsrisico's in de keuken.
          </p>
          <p style={{ margin: 0 }}>
            Weergave gemaakt op {new Date().toLocaleDateString('nl-NL', { year: 'numeric', month: 'long', day: 'numeric' })} via MenuCard.
          </p>
        </div>
      </div>
    </>
  )
}
