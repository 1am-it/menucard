// The public menu body: sections, dishes, prices, allergens and tags. One
// renderer for the public menu page (app/menu/[id]/MenuView.js) and the
// internal Publicatievoorbeeld (app/internal/menu-concepts), so a previewed
// menu looks exactly as it will be published. Only presentation: no page
// chrome, no URL parameters, no filters, no reservation actions — those stay
// in MenuView. Classes and markup are the public menu's own (app/globals.css).

import StatusIcon from '@/src/components/StatusIcon'

export const TAG_LABELS = {
  aanbevolen:  'Aanbevolen',
  dagspecial:  'Dagspecial',
  vegetarisch: 'Vegetarisch',
  vegan:       'Vegan',
  halal:       'Halal',
  glutenvrij:  'Glutenvrij',
}

// Dieetlabels zijn neutrale labels met een blaadje-icoon, geen successtatus
// (Kleurtaal v2).
const NEUTRAL_DIET_TAG_KEYS = new Set(['vegetarisch', 'vegan'])

export const MEAL_CONFIG = {
  lunch:          { label: '🥗 Lunch',          title: 'Lunchkaart' },
  diner:          { label: '🍽 Diner',          title: 'Dinerkaart' },
  borrel:         { label: '🍸 Borrel',         title: 'Borrelkaart' },
  specialiteiten: { label: '⭐ Specialiteiten', title: 'Specialiteiten' },
}

export const EU14 = [
  { id: 1,  icon: '🌾', name: 'Gluten' },
  { id: 2,  icon: '🦞', name: 'Schaaldieren' },
  { id: 3,  icon: '🥚', name: 'Eieren' },
  { id: 4,  icon: '🐟', name: 'Vis' },
  { id: 5,  icon: '🥜', name: "Pinda's" },
  { id: 6,  icon: '🫘', name: 'Soja' },
  { id: 7,  icon: '🥛', name: 'Melk' },
  { id: 8,  icon: '🌰', name: 'Noten' },
  { id: 9,  icon: '🥬', name: 'Selderij' },
  { id: 10, icon: '🌿', name: 'Mosterd' },
  { id: 11, icon: '🌱', name: 'Sesam' },
  { id: 12, icon: '🍇', name: 'Sulfiet' },
  { id: 13, icon: '🌻', name: 'Lupine' },
  { id: 14, icon: '🦑', name: 'Weekdieren' },
]

/** The visible title of a data/menus.json entry, e.g. "Dinerkaart" for "6-diner". */
export function menuTitle(key, entry) {
  const mealType = String(key).split('-').slice(1).join('-')
  return MEAL_CONFIG[mealType]?.title || (entry && entry.subtitle) || 'Menukaart'
}

export function highlight(text, query) {
  if (!query || query.length < 2) return text
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark className="search-highlight">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  )
}

export function itemMatchesAllergens(item, excludeIds) {
  if (!excludeIds.length) return { safe: true, unknown: false }
  const allergens = item.allergens
  if (!Array.isArray(allergens)) return { safe: false, unknown: true }
  const hasExcluded = excludeIds.some(id => allergens.includes(id))
  return { safe: !hasExcluded, unknown: false }
}

// ─── MenuItem Component ────────────────────────────────────────────────────────

export function MenuItem({ item, query = '', excludeAllergens = [], isResolvedTarget = false, showPulse = false, highlightQuery = null, innerRef }) {
  const { safe, unknown } = itemMatchesAllergens(item, excludeAllergens)
  const hasAllergenFilter = excludeAllergens.length > 0
  // BE-12 — the resolved dish's own substring mark comes from `fromQuery`,
  // never the shared `?q=` filter state, and only for this one item; it
  // stays for as long as this item is the resolved target (the life of
  // this page view), independent of the separate, temporary `showPulse`
  // highlight below, which fades after 4s (BE-16, was ~2.5-3s).
  const displayQuery = isResolvedTarget && highlightQuery ? highlightQuery : query

  return (
    <div
      ref={innerRef}
      tabIndex={isResolvedTarget ? -1 : undefined}
      className={`menu-card ${hasAllergenFilter && unknown ? 'mc-unknown' : ''} ${hasAllergenFilter && !safe ? 'mc-unsafe' : ''} ${showPulse ? 'menu-card-highlighted' : ''}`}
    >
      <div className="card-top">
        <div className="td-name">{highlight(item.name, displayQuery)}</div>
        <div className={`td-price ${!item.price ? 'no-price' : ''}`}>
          {item.price || 'op aanvraag'}
        </div>
      </div>

      {item.desc && (
        <div className="td-desc">{highlight(item.desc, displayQuery)}</div>
      )}
      {item.sup  && <div className="td-sup">+ {highlight(item.sup, query)}</div>}
      {item.wine && <div className="td-wine">🍷 {item.wine}</div>}

      {/* Allergen status badges */}
      {hasAllergenFilter && (
        <div className="mc-allergen-status">
          {unknown && (
            <span className="mc-badge mc-badge-unknown">
              ⚠ Allergeneninformatie onbekend
            </span>
          )}
          {!safe && !unknown && (
            <span className="mc-badge mc-badge-contains">
              Bevat geselecteerde allergenen
            </span>
          )}
        </div>
      )}

      {/* Allergen icons for contained allergens */}
      {Array.isArray(item.allergens) && item.allergens.length > 0 && (
        <div className="mc-allergen-icons">
          {item.allergens.map(id => {
            const a = EU14.find(x => x.id === id)
            if (!a) return null
            const isExcluded = excludeAllergens.includes(id)
            return (
              <span
                key={id}
                className={`mc-allergen-icon ${isExcluded ? 'excluded' : ''}`}
                title={a.name}
              >
                {a.icon}
              </span>
            )
          })}
        </div>
      )}

      {item.tags?.length > 0 && (
        <div className="item-tags">
          {item.tags.map(t => (
            <span key={t} className={`item-tag tag-${t}`}>
              {NEUTRAL_DIET_TAG_KEYS.has(t) && <StatusIcon name="leaf" size={11} className="item-tag-icon" />}
              {TAG_LABELS[t] || t}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── MenuSection Component ─────────────────────────────────────────────────────

/** One section of a menu: its title (optionally with a count) and its dishes. */
export function MenuSection({ id, sectionRef, name, count, children }) {
  return (
    <div className="cat-section" id={id} ref={sectionRef}>
      <div className="cat-title">
        {name}
        {count !== undefined && (
          <span className="cat-count">{count} gerecht{count !== 1 ? 'en' : ''}</span>
        )}
      </div>
      <div className="menu-grid">{children}</div>
    </div>
  )
}

/** A whole menu entry exactly as the public page shows it, without filters (Publicatievoorbeeld). */
export function StaticMenu({ categories, idPrefix }) {
  return (
    <>
      {(categories || []).map((cat, i) => (
        <MenuSection key={i} id={`${idPrefix}-cat-${i}`} name={cat.name}>
          {(cat.items || []).map((item, j) => (
            <MenuItem key={j} item={item} />
          ))}
        </MenuSection>
      ))}
    </>
  )
}
