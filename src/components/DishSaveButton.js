'use client'

// BE-44 (#105, criterium 4) + BE-49 (#115, criterium 1) — de knop "Bewaren"
// met de bladwijzer, rechtsonder naast "Delen" op de gerechtkaart.
//
// BE-49: kleine icoonknop van 44 × 44 px, zichtbaar icoon ±20 px, geen gevulde
// achtergrond. De toegankelijke naam is "Bewaar <gerecht>"; staat hij aan, dan
// is de bladwijzer gevuld en zegt `aria-pressed="true"` het (contract).
//
// - De stand komt altijd uit de opslag zelf (`localStorage`, in try/catch in
//   src/lib/dishList.js). Kan de browser niet opslaan, dan blijft de knop
//   werken en de pagina staan; alleen het onthouden lukt dan niet.
// - Een eigen event (`SAVED_LIST_EVENT`) houdt de knop, de onderbalk en de
//   lijstpagina in dezelfde stand, zonder twee bronnen van waarheid.

import { useCallback, useEffect, useState } from 'react'
import {
  SAVED_LIST_EVENT,
  isDishSaved,
  safeBrowserStorage,
  toggleSavedDish,
} from '@/src/lib/dishList'
import { SAVED_EVENT, sendDishCounter } from '@/src/lib/dishCounters'

export default function DishSaveButton({ entry = null, name = null }) {
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!entry) return undefined
    const sync = () => setSaved(isDishSaved(safeBrowserStorage(), entry.id))
    sync()
    window.addEventListener(SAVED_LIST_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(SAVED_LIST_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [entry])

  const handleClick = useCallback(() => {
    const result = toggleSavedDish(safeBrowserStorage(), entry)
    setSaved(result.saved)
    try {
      window.dispatchEvent(new Event(SAVED_LIST_EVENT))
    } catch (error) {
      // Geen venster (zou niet kunnen na een klik): de knop zelf is al bij.
    }
    // BE-44 (#105, criterium 5) — alleen tellen als het gerecht erbij komt,
    // nooit bij weghalen (contract), en fire-and-forget: de knop wacht niet op
    // de teller en een mislukte telling verandert niets aan de stand.
    if (result.saved) void sendDishCounter({ dish: entry && entry.id, event: SAVED_EVENT })
  }, [entry])

  if (!entry) return null

  const saveName = String(name || entry.name || '').trim() || 'dit gerecht'

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
