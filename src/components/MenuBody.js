// The public menu body: sections, dishes, prices, allergens and tags. One
// renderer for the public menu page (app/menu/[id]/MenuView.js) and the
// internal Publicatievoorbeeld (app/internal/menu-concepts), so a previewed
// menu looks exactly as it will be published. Only presentation: no page
// chrome, no URL parameters, no filters, no reservation actions — those stay
// in MenuView. Classes and markup are the public menu's own (app/globals.css).

import Link from 'next/link'
import Emoji from '@/src/components/Emoji'
// BE-62 — bij een gedeeld gerecht hetzelfde vlak als bij een gedeeld lijstje en
// op /kies: één component, één stylesheet (src/components/ZoekGerechtBlock.js).
// Ronde 1 zette de opmaak hier zelf neer om bytes te sparen, maar dan laadde de
// menukaart de bijbehorende CSS nooit en stond het vlak zonder vorm in de
// pagina. Het vlak komt nu als kant-en-klaar knooppunt binnen (`shareBlock`),
// zodat deze gedeelde body geen eigen import en geen eigen chunk meeneemt; de
// menukaart laadt hetzelfde component pas bij de gedeelde link (zie
// app/menu/[id]/MenuView.js), net als /kies.
import DishShareButton from '@/src/components/DishShareButton'
import { SHARED_DISH_NOTE } from '@/src/lib/dishShare'
import { groupHeadingsBefore } from '@/src/lib/menuGroups'
import { dailyDishInfo } from '@/src/lib/dailyDish'
import { menuPriceLabel } from '@/src/lib/menuPrice'
// BE-42 (#98) 2A — de kaartnamen staan op één plek (src/lib/menuTabs.js), zodat
// de tabbladen op de restaurantpagina en de menukaart zelf nooit uit elkaar
// lopen. Alleen de titel komt daar vandaan; het label met emoji blijft hier.
import { MENU_TITLES } from '@/src/lib/menuTabs'
// BE-52 (#128): de eigen opmaak van dit onderdeel staat naast de code.
import './menu-body.css'

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
  lunch:          { label: '🥗 Lunch',          title: MENU_TITLES.lunch },
  diner:          { label: '🍽 Diner',          title: MENU_TITLES.diner },
  borrel:         { label: '🍸 Borrel',         title: MENU_TITLES.borrel },
  specialiteiten: { label: '⭐ Specialiteiten', title: MENU_TITLES.specialiteiten },
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

/** The visible title of a data/menus.json entry, e.g. "Dinerkaart" for
 * "6-diner", or the menu's own shared title ("Proef het beste van het
 * seizoen") when it has one. */
export function menuTitle(key, entry) {
  const mealType = String(key).split('-').slice(1).join('-')
  return MEAL_CONFIG[mealType]?.title || (entry && entry.title) || (entry && entry.subtitle) || 'Menukaart'
}

/**
 * Group headings of a nested menu ("Diner" above "Voor", "Tussen", …),
 * rendered before section `index` when its group differs from the previous
 * section's. Flat menus (no `path`) render nothing extra.
 */
export function MenuGroupHeadings({ categories, index }) {
  const headings = groupHeadingsBefore(categories, index)
  if (headings.length === 0) return null
  return headings.map(({ label, depth }) => {
    const Tag = depth === 0 ? 'h2' : 'h3'
    return (
      <Tag key={`${depth}-${label}`} className={`cat-group cat-group--depth-${Math.min(depth, 2)}`}>
        {label}
      </Tag>
    )
  })
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

/**
 * BE-58 (#143) — "Bevestigd door het restaurant · [datum]" bij de kop van de
 * publieke menukaart en restaurantpagina. Alleen als de bevestiging nog geldig
 * is (90 dagen, src/lib/snelAanpassen.js); anders rendert dit niets.
 */
export function MenuConfirmation({ bevestiging }) {
  if (!bevestiging || bevestiging.actief !== true) return null
  const label = bevestiging.label || 'Bevestigd door het restaurant'
  return (
    <p className="menu-confirmed">
      <span className="menu-confirmed-mark" aria-hidden="true">✓</span>
      {label}
      {bevestiging.datum ? ` · ${bevestiging.datum}` : ''}
    </p>
  )
}

/**
 * BE-71 (#176, R6) — een kaart waarvan minstens 90% van de gerechten aan de eis
 * voldoet, staat zonder de twijfelgevallen op de site. Dat zegt de pagina zelf,
 * met de link naar de volledige kaart bij het restaurant. Alleen kaarten met
 * `incomplete: true` (uit de startvulling) renderen dit; elke andere kaart
 * blijft ongewijzigd.
 */
export function MenuIncompleteNotice({ entry }) {
  if (!entry || entry.incomplete !== true) return null
  const count = Number.isFinite(entry.omittedCount) && entry.omittedCount > 0 ? entry.omittedCount : null
  const tail = `bekijk de volledige kaart bij het restaurant`
  return (
    <p className="menu-incomplete">
      <span>Niet alle gerechten staan erop{count ? ` (${count} niet)` : ''} · </span>
      {entry.source ? (
        <a href={entry.source} target="_blank" rel="noopener">{tail}</a>
      ) : (
        <span>{tail}</span>
      )}
    </p>
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

export function MenuItem({ item, query = '', excludeAllergens = [], isResolvedTarget = false, showPulse = false, highlightQuery = null, innerRef, domId = null, category = null, menuTitle = null, sourceDate = null, shareHref = null, shareTitle = null, shareNote = false, saveEntry = null, dishKey = null, shareBlock = null }) {
  const { safe, unknown } = itemMatchesAllergens(item, excludeAllergens)
  const hasAllergenFilter = excludeAllergens.length > 0
  // BE-29 (#70) — een daghap alleen als de bron het zelf zegt en de kaart
  // een leesbare brondatum heeft. Het label komt altijd met die datum; een
  // verlopen daghap blijft zo gewoon op de menukaart staan.
  const dailyInfo = dailyDishInfo(item, { category, menuTitle, sourceDate })
  const visibleTags = (item.tags || []).filter((tag) => !(dailyInfo && tag === 'dagspecial'))
  // BE-29 (#70) — dezelfde eerlijke prijs als op de home: een expliciete
  // bron-eenheid ("per stuk", "per kilo", "voor 2 personen") blijft zichtbaar;
  // zonder echte prijs blijft "op aanvraag" staan.
  // BE-71 R5 (#176) — een toeslag ("Extra vlees: Kipfilet € 4") staat als
  // "+ € 4" op de kaart: hetzelfde label als altijd, met het plusteken van de
  // bestaande toeslagweergave. Geen nieuwe opmaak, geen nieuw veld.
  const priceLabel = menuPriceLabel(item)
  // BE-12 — the resolved dish's own substring mark comes from `fromQuery`,
  // never the shared `?q=` filter state, and only for this one item; it
  // stays for as long as this item is the resolved target (the life of
  // this page view), independent of the separate, temporary `showPulse`
  // highlight below, which fades after 4s (BE-16, was ~2.5-3s).
  const displayQuery = isResolvedTarget && highlightQuery ? highlightQuery : query

  return (
    <>
    <div
      ref={innerRef}
      id={domId || undefined}
      tabIndex={isResolvedTarget ? -1 : undefined}
      className={`menu-card ${hasAllergenFilter && unknown ? 'mc-unknown' : ''} ${hasAllergenFilter && !safe ? 'mc-unsafe' : ''} ${showPulse ? 'menu-card-highlighted' : ''}`}
    >
      {/* BE-44 (#105, criterium 2) — de ontvanger van een gedeelde link ziet
          deze regel boven de hele kaart van het opgelichte gerecht. */}
      {shareNote && <div className="dish-share-note">{SHARED_DISH_NOTE}</div>}
      <div className="card-top">
        <div className="td-name">{highlight(item.name, displayQuery)}</div>
        <div className={`td-price ${!item.price ? 'no-price' : ''}`}>
          {priceLabel}
        </div>
      </div>

      {/* BE-58 (#143): een goedgekeurde wijziging van de houder zet dit gerecht
          tijdelijk op niet beschikbaar. De prijs en de rest van de kaart blijven
          zoals ze zijn; alleen dit label komt erbij. */}
      {item.tijdelijkNietBeschikbaar && (
        <div className="mc-unavailable">Tijdelijk niet beschikbaar</div>
      )}

      {item.desc && (
        <div className="td-desc">{highlight(item.desc, displayQuery)}</div>
      )}

      {/* BE-49 (#115, criterium 1) — de kaart is weer van het gerecht: naam en
          prijs bovenaan, de beschrijving over de volle breedte, en helemaal
          onderaan één regel met links het label (bijvoorbeeld "Glutenvrij") en
          rechts de twee icoonknoppen. De knoppen staan dus na de beschrijving,
          de supplementen en de allergenen; de regel houdt zijn hoogte zodat een
          kaart zonder label niet verspringt. */}

      {item.sup  && <div className="td-sup">+ {highlight(item.sup, query)}</div>}
      {item.wine && <div className="td-wine"><Emoji glyph="🍷" /> {item.wine}</div>}

      {/* Allergen status badges */}
      {hasAllergenFilter && (
        <div className="mc-allergen-status">
          {unknown && (
            <span className="mc-badge mc-badge-unknown">
              <Emoji glyph="⚠" /> Allergeneninformatie onbekend
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
                <Emoji glyph={a.icon} />
                <span className="visually-hidden">{a.name}</span>
              </span>
            )
          })}
        </div>
      )}

      <div className="card-foot">
        <div className="card-foot-labels">
          {dailyInfo && (
            <div className="item-tags item-daily">
              <span className="item-tag tag-daghap">
                <Emoji glyph="📅" /> Daghap
              </span>
              <span className="item-daily-date">{dailyInfo.dateLine}</span>
            </div>
          )}

          {visibleTags.length > 0 && (
            <div className="item-tags">
              {visibleTags.map(t => (
                <span key={t} className={`item-tag tag-${t}`}>
                  {/* BE-28 — het blad is nu het systeem-emoji (aria-hidden) in
                      plaats van een SVG; de tekst ernaast draagt de betekenis. */}
                  {NEUTRAL_DIET_TAG_KEYS.has(t) && <Emoji glyph="🌱" className="item-tag-icon-size" />}
                  {TAG_LABELS[t] || t}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* BE-44 (#105, criterium 1 en 4) + BE-49 (#115) — alleen de publieke
            menukaart geeft een link en een bewaarplek mee; het
            Publicatievoorbeeld (StaticMenu) blijft ongewijzigd. `dishKey` is de
            id van dit gerecht voor de anonieme teller, `name` de gerechtnaam
            voor de aria-labels ("Deel Poussin", "Bewaar Poussin"). */}
        {(shareHref || saveEntry) && (
          <DishShareButton
            href={shareHref}
            title={shareTitle}
            entry={saveEntry}
            dishKey={dishKey}
            name={item.name}
          />
        )}
      </div>
    </div>
    {/* BE-62 (#153, ontwerp punt 2) — pas ná het gedeelde gerecht: eerst de
        regel "Iemand deelde dit gerecht met je", dan de kaart met de bestaande
        Bewaar-knop, en dan dit eigen vlak. Het staat als broer van de kaart in
        dezelfde grid (en spant over de volle breedte, zie
        zoek-gerecht-block.css), zodat het niet met de kaart samenvloeit. */}
    {shareNote && shareBlock}
    </>
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
export function StaticMenu({ categories, idPrefix, sourceDate = null }) {
  const list = categories || []
  return (
    <>
      {list.map((cat, i) => (
        <div key={i} className="cat-block">
          <MenuGroupHeadings categories={list} index={i} />
          <MenuSection id={`${idPrefix}-cat-${i}`} name={cat.name}>
            {(cat.items || []).map((item, j) => (
              <MenuItem key={j} item={item} category={cat.name} sourceDate={sourceDate} />
            ))}
          </MenuSection>
        </div>
      ))}
    </>
  )
}
