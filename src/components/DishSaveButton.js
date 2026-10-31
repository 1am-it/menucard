'use client'

// BE-44 (#105, criterium 4) + BE-49 (#115, criterium 1) — de knop "Bewaren"
// met de bladwijzer, rechtsonder naast "Delen" op de gerechtkaart.
//
// BE-49: kleine icoonknop van 44 × 44 px, zichtbaar icoon ±20 px, geen gevulde
// achtergrond. De toegankelijke naam is "Bewaar <gerecht>"; staat hij aan, dan
// is de bladwijzer gevuld en zegt `aria-pressed="true"` het (contract).
//
// BE-65 (#157, ronde 2) — de knop is klein en statisch; de bewaarlogica komt
// pas bij de klik binnen (`import('@/src/lib/dishList')`). Wat meteen moet
// kloppen is de stand: die leest de kleine lezer in src/lib/savedListRead.js
// rechtstreeks uit `localStorage`, zonder de zware module te laden.
//
// - Zonder opslag (privémodus, beleid) werkt de knop gewoon en blijft de pagina
//   staan; alleen het onthouden lukt dan niet. Nooit een harde fout.
// - Een eigen event (`SAVED_LIST_EVENT_NAME`) houdt de knop, de balk en de
//   lijstpagina in dezelfde stand, zonder twee bronnen van waarheid.

import { useCallback, useEffect, useState } from 'react'
import {
  SAVED_LIST_EVENT_NAME,
  browserStorage,
  hasSavedId,
} from '@/src/lib/savedListRead'

/** De id van dit gerecht, uit de bestaande `entry` of uit de compacte regel. */
function dishIdOf({ entry, dish }) {
  if (entry && entry.id) return entry.id
  if (dish && dish.dishId) return dish.dishId
  return null
}

export default function DishSaveButton({ entry = null, dish = null, name = null }) {
  const [saved, setSaved] = useState(false)
  const id = dishIdOf({ entry, dish })

  useEffect(() => {
    if (!id) return undefined
    const sync = () => setSaved(hasSavedId(browserStorage(), id))
    sync()
    window.addEventListener(SAVED_LIST_EVENT_NAME, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(SAVED_LIST_EVENT_NAME, sync)
      window.removeEventListener('storage', sync)
    }
  }, [id])

  const handleClick = useCallback(async () => {
    // Pas bij de klik: de echte bewaarlogica en de anonieme teller.
    const [list, counters] = await Promise.all([
      import('@/src/lib/dishList'),
      import('@/src/lib/dishCounters'),
    ])
    const wanted = entry || (dish ? list.entryFromDish(dish) : null)
    if (!wanted) return
    const result = list.toggleSavedDish(browserStorage(), wanted)
    setSaved(result.saved)
    try {
      window.dispatchEvent(new Event(SAVED_LIST_EVENT_NAME))
    } catch (error) {
      // Geen venster (zou niet kunnen na een klik): de knop zelf is al bij.
    }
    // BE-44 (#105, criterium 5) — alleen tellen als het gerecht erbij komt,
    // nooit bij weghalen (contract), en fire-and-forget: de knop wacht niet op
    // de teller en een mislukte telling verandert niets aan de stand.
    if (result.saved) void counters.sendDishCounter({ dish: wanted.id, event: counters.SAVED_EVENT })
  }, [dish, entry])

  if (!id) return null

  const saveName = String(name || (entry && entry.name) || (dish && dish.name) || '').trim() || 'dit gerecht'

  return (
    <button
      type="button"
      className={`dish-save-btn${saved ? ' is-saved' : ''}`}
      aria-pressed={saved}
      aria-label={`Bewaar ${saveName}`}
      onClick={handleClick}
    >
      {/* Variant 1: een bladwijzer; gevuld zodra het gerecht bewaard is. */}
      <svg className="dish-share-icon" viewBox="0 0 24 24" fill={saved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z" />
      </svg>
    </button>
  )
}
