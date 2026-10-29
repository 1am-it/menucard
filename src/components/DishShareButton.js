'use client'

// BE-44 (#105, criterium 1 en 4) — de knoppen op de gerechtkaart: "Delen" en
// "Bewaren", in één regel onder de beschrijving.
//
// De eigenaar koos variant A (het iPhone-deelicoon), variant 1 (de bladwijzer)
// en "zo snel mogelijk doorsturen, zonder begeleidende tekst": de gebruiker typt
// zelf in de chat. Daarom:
//   - op een telefoon met `navigator.share`: het systeemmenu met alleen
//     `{ url, title }` — de bestaande BE-12-deeplink, geen `text`;
//   - zonder `navigator.share`: de link naar het klembord, met de melding
//     "Link gekopieerd" in een `role="status"`;
//   - een afgebroken of mislukte deelactie laat de knop gewoon werken.
//
// De knop bouwt de absolute link pas bij de klik, uit de relatieve deeplink die
// de server al rendert: zo blijft de HTML aan beide kanten gelijk en gaat de
// stand van dit moment (licht of donker) mee voor de voorvertoning.
//
// Het bewaren zelf (opslag, stand, aria-pressed) zit in DishSaveButton; deze
// component bezit alleen de regel waarin beide knoppen staan.

import { useState } from 'react'
import { absoluteShareUrl, buildSharePayload, copyShareLink, shareTarget } from '@/src/lib/dishShare'
import { SHARED_EVENT, sendDishCounter } from '@/src/lib/dishCounters'
import DishSaveButton from '@/src/components/DishSaveButton'

function currentTheme() {
  return typeof document !== 'undefined' && document.documentElement
    ? document.documentElement.getAttribute('data-theme')
    : null
}

export default function DishShareButton({ href, title, entry = null, dishKey = null }) {
  const [message, setMessage] = useState('')

  // BE-44 (#105, criterium 5) — de anonieme teller van dit gerecht. Alleen na
  // een geslaagd delen of kopiëren, en fire-and-forget: er wordt niet op
  // gewacht, er verschijnt niets van en een fout laat de knop met rust. Een
  // door de gebruiker afgebroken systeemmenu telt niet mee.
  const dish = dishKey || (entry && entry.id) || null

  function countShared() {
    void sendDishCounter({ dish, event: SHARED_EVENT })
  }

  async function handleShare() {
    const url = absoluteShareUrl({
      href,
      origin: typeof window === 'undefined' ? undefined : window.location.origin,
      theme: currentTheme(),
    })
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
        return
      }
      countShared()
      return
    }
    if (target === 'clipboard') {
      const result = await copyShareLink(navigatorRef.clipboard, url)
      setMessage(result.ok ? result.message : '')
      if (result.ok) countShared()
    }
  }

  if (!href && !entry) return null

  return (
    <div className="dish-share">
      <div className="dish-share-buttons">
        {href ? (
          <button type="button" className="dish-share-btn" onClick={handleShare}>
            {/* Het deelicoon, variant A: een vierkant met een pijl omhoog. */}
            <svg className="dish-share-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <path d="M12 3v12" />
              <path d="M8 7l4-4 4 4" />
              <path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
            </svg>
            Delen
          </button>
        ) : null}
        {entry ? <DishSaveButton entry={entry} /> : null}
      </div>
      <span className="dish-share-status" role="status">{message}</span>
    </div>
  )
}
