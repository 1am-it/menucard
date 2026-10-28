'use client'

// BE-44 (#105, criterium 1) — de knop "Delen" op de gerechtkaart.
//
// De eigenaar koos variant A (het iPhone-deelicoon) en "zo snel mogelijk
// doorsturen, zonder begeleidende tekst": de gebruiker typt zelf in de chat.
// Daarom:
//   - op een telefoon met `navigator.share`: het systeemmenu met alleen
//     `{ url, title }` — de bestaande BE-12-deeplink, geen `text`;
//   - zonder `navigator.share`: de link naar het klembord, met de melding
//     "Link gekopieerd" in een `role="status"`;
//   - een afgebroken of mislukte deelactie laat de knop gewoon werken.
//
// De knop bouwt de absolute link pas bij de klik, uit de relatieve deeplink die
// de server al rendert: zo blijft de HTML aan beide kanten gelijk en gaat de
// stand van dit moment (licht of donker) mee voor de voorvertoning.

import { useState } from 'react'
import { buildSharePayload, copyShareLink, shareTarget, withShareTheme } from '@/src/lib/dishShare'

function absoluteShareUrl(href) {
  if (!href || typeof window === 'undefined') return null
  const theme = typeof document !== 'undefined' && document.documentElement
    ? document.documentElement.getAttribute('data-theme')
    : null
  const withTheme = withShareTheme(href, theme) || href
  try {
    return new URL(withTheme, window.location.origin).toString()
  } catch (error) {
    return null
  }
}

export default function DishShareButton({ href, title }) {
  const [message, setMessage] = useState('')

  async function handleShare() {
    const url = absoluteShareUrl(href)
    if (!url) return
    const navigatorRef = typeof navigator === 'undefined' ? null : navigator
    const target = shareTarget({
      share: navigatorRef ? navigatorRef.share : undefined,
      clipboard: navigatorRef ? navigatorRef.clipboard : undefined,
    })
    if (target === 'share') {
      try {
        await navigatorRef.share(buildSharePayload({ title, url }))
      } catch (error) {
        // Afgebroken door de gebruiker of niet beschikbaar: geen melding, en
        // vooral geen tweede, stille poging via het klembord.
      }
      return
    }
    if (target === 'clipboard') {
      const result = await copyShareLink(navigatorRef.clipboard, url)
      setMessage(result.ok ? result.message : '')
    }
  }

  if (!href) return null

  return (
    <div className="dish-share">
      <button type="button" className="dish-share-btn" onClick={handleShare}>
        {/* Het deelicoon, variant A: een vierkant met een pijl omhoog. */}
        <svg className="dish-share-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M12 3v12" />
          <path d="M8 7l4-4 4 4" />
          <path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
        </svg>
        Delen
      </button>
      <span className="dish-share-status" role="status">{message}</span>
    </div>
  )
}
