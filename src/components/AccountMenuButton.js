'use client'

// BE-59 (#146, "Delen 1") — de goedkope voordeur van het accountmenu.
//
// Deze component staat in de koppen en kost een gast bijna niets: na het
// mounten wordt één keer in localStorage gekeken of er een Supabase-
// sessiesleutel staat (src/lib/accountSession.js). Is die er niet, dan gebeurt
// er niets — geen Supabase-client, geen menu, geen verzoek, geen knop.
//
// Is de sleutel er wel, dan komt het echte menu pas dan in beeld, met een
// dynamische import(). Daardoor zit de component, de opmaak en de
// rolopvraag niet in de eerste lading van een publieke pagina.

import { useEffect, useState } from 'react'
import { hasSupabaseSessionKey } from '@/src/lib/accountSession'

export default function AccountMenuButton() {
  // null = nog niets geladen (dus ook geen knop); een functie = het menu.
  const [Menu, setMenu] = useState(null)

  useEffect(() => {
    let cancelled = false
    let storage = null

    try {
      storage = window.localStorage
    } catch {
      return undefined
    }
    if (!hasSupabaseSessionKey(storage)) return undefined

    import('./AccountMenu')
      .then((module) => {
        if (cancelled || !module || typeof module.default !== 'function') return
        setMenu(() => module.default)
      })
      .catch(() => {
        // Geen menu is een geldige toestand (bijvoorbeeld een geblokkeerde chunk).
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (!Menu) return null
  return <Menu />
}
