'use client'

// BE-44 (#105, criterium 4) — de onderbalk op de menupagina.
//
// Zodra er iets bewaard is, staat er onderin "<n> bewaard · Bekijken →" als één
// link naar /mijn-lijstje. Is het lijstje leeg, dan is er geen balk. De telling
// komt uit dezelfde opslag als de knop "Bewaren" en ververst via hetzelfde
// event, dus de balk en de knop kunnen niet uit elkaar lopen.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  LIST_PAGE,
  SAVED_LIST_EVENT,
  VIEW_LIST_LABEL,
  readSavedList,
  safeBrowserStorage,
  savedBarLabel,
} from '@/src/lib/dishList'

export default function SavedListBar() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    const sync = () => setCount(readSavedList(safeBrowserStorage()).length)
    sync()
    window.addEventListener(SAVED_LIST_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(SAVED_LIST_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  if (count === 0) return null

  return (
    <>
      <Link href={LIST_PAGE} className="saved-list-bar">
        <svg className="saved-list-bar-icon" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true" focusable="false">
          <path d="M7 3h10a1 1 0 0 1 1 1v17l-6-4-6 4V4a1 1 0 0 1 1-1z" />
        </svg>
        <span className="saved-list-bar-count">{savedBarLabel(count)}</span>
        <span aria-hidden="true">·</span>
        <span className="saved-list-bar-action">{VIEW_LIST_LABEL}</span>
      </Link>
      {/* Ruimte in de pagina zelf, zodat de vaste balk nooit over de laatste
          regel van de menukaart heen valt. */}
      <div className="saved-list-bar-spacer" aria-hidden="true" />
    </>
  )
}
