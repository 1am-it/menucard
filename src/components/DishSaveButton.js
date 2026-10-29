'use client'

// BE-44 (#105, criterium 4) — de knop "Bewaren" met de bladwijzer, naast
// "Delen" op de gerechtkaart.
//
// - Staat hij aan, dan toont hij "Bewaard" met een gevulde bladwijzer en
//   `aria-pressed="true"` (contract).
// - De stand komt altijd uit de opslag zelf (`localStorage`, in try/catch in
//   src/lib/dishList.js). Kan de browser niet opslaan, dan blijft de knop
//   werken en de pagina staan; alleen het onthouden lukt dan niet.
// - Een eigen event (`SAVED_LIST_EVENT`) houdt de knop, de onderbalk en de
//   lijstpagina in dezelfde stand, zonder twee bronnen van waarheid.

import { useCallback, useEffect, useState } from 'react'
import {
  SAVED_LABEL,
  SAVED_LIST_EVENT,
  SAVE_LABEL,
  isDishSaved,
  safeBrowserStorage,
  toggleSavedDish,
} from '@/src/lib/dishList'

export default function DishSaveButton({ entry = null }) {
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
  }, [entry])

  if (!entry) return null

  return (
    <button
      type="button"
      className={`dish-save-btn${saved ? ' is-saved' : ''}`}
      aria-pressed={saved}
      onClick={handleClick}
    >
      {/* Variant 1: een bladwijzer; gevuld zodra het gerecht bewaard is. */}
      <svg className="dish-share-icon" viewBox="0 0 24 24" fill={saved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z" />
      </svg>
      {saved ? SAVED_LABEL : SAVE_LABEL}
    </button>
  )
}
