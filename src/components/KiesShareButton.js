'use client'

// BE-46 (#106, criterium 4 en 8) — de stemlink delen via de bestaande
// deelroute van BE-49.
//
// Dezelfde route als "Delen" op een gerecht: de opgeslagen deelvoorkeur kiest
// het gedrag (blad, klein menu of meteen), en elke manier gaat door
// `performShare` uit src/lib/sharePreference.js. Er gaat alleen de link mee,
// zonder begeleidende tekst (eigenaarsbesluit 28 oktober).
//
// De anonieme `gedeeld`-teller van BE-44 telt één keer per gedeeld gerecht in de
// stemming: wie een stemlink met vier gerechten deelt, heeft die vier gerechten
// gedeeld. De manier zelf wordt nergens opgeslagen of verstuurd (criterium 8).

import { useCallback, useState } from 'react'
import { absoluteShareUrl } from '@/src/lib/dishShare'
import { SHARED_EVENT, sendDishCounter } from '@/src/lib/dishCounters'
import { safeBrowserStorage } from '@/src/lib/dishList'
import {
  clearSharePreference,
  performShare,
  readSharePreference,
  sharePlan,
  storageAvailable,
  writeSharePreference,
} from '@/src/lib/sharePreference'
import { ShareDialog, ShareMenu } from '@/src/components/ShareDialog'

/** Een gekozen webmanier openen met een echte, tijdelijke link. */
function openShareLink(link) {
  if (typeof document === 'undefined' || !document.body) return
  const anchor = document.createElement('a')
  anchor.href = link
  anchor.rel = 'noopener noreferrer'
  if (/^https?:/i.test(link)) anchor.target = '_blank'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

export default function KiesShareButton({ href, title, dishKeys = [], label = 'Deel de stemlink' }) {
  const [message, setMessage] = useState('')
  const [panel, setPanel] = useState(null)
  const [menuMethods, setMenuMethods] = useState([])
  const panelPrefix = 'kies-deel'

  const countShared = useCallback(() => {
    for (const dish of dishKeys) {
      if (dish) void sendDishCounter({ dish, event: SHARED_EVENT })
    }
  }, [dishKeys])

  const runMethod = useCallback(async (method) => {
    const url = absoluteShareUrl({
      href,
      origin: typeof window === 'undefined' || !window.location ? undefined : window.location.origin,
      theme: typeof document === 'undefined' || !document.documentElement
        ? null
        : document.documentElement.getAttribute('data-theme'),
    })
    if (!url) {
      setMessage('')
      return
    }
    const navigatorRef = typeof navigator === 'undefined' ? null : navigator
    const result = await performShare({
      method,
      url,
      title,
      clipboard: navigatorRef ? navigatorRef.clipboard : null,
      share: navigatorRef ? navigatorRef.share : null,
      open: openShareLink,
      count: countShared,
    })
    setMessage(result.message || '')
  }, [countShared, href, title])

  const handleShare = useCallback(async () => {
    const storage = safeBrowserStorage()
    const plan = sharePlan(readSharePreference(storage), { canStore: storageAvailable(storage) })
    if (plan.kind === 'choose') {
      setPanel('choose')
      return
    }
    if (plan.kind === 'menu') {
      setMenuMethods(plan.methods)
      setPanel('menu')
      return
    }
    if (plan.kind === 'direct') {
      await runMethod(plan.method)
      return
    }
    await runMethod('phone')
  }, [runMethod])

  // Na het blad: bewaren en meteen doen wat de nieuwe voorkeur zegt. Lukt
  // bewaren niet (privémodus, beleid), dan geldt het telefoonmenu.
  const handlePreferenceSaved = useCallback(async (preference) => {
    const storage = safeBrowserStorage()
    const stored = preference ? writeSharePreference(storage, preference) : clearSharePreference(storage)
    setPanel(null)
    if (preference && !stored) {
      await runMethod('phone')
      return
    }
    const plan = sharePlan(readSharePreference(storage), { canStore: storageAvailable(storage) })
    if (plan.kind === 'menu') {
      setMenuMethods(plan.methods)
      setPanel('menu')
      return
    }
    if (plan.kind === 'direct') {
      await runMethod(plan.method)
      return
    }
    if (plan.kind === 'phone') await runMethod('phone')
  }, [runMethod])

  const handlePick = useCallback(async (method) => {
    setPanel(null)
    await runMethod(method)
  }, [runMethod])

  if (!href) return null

  return (
    <div className="kies-share">
      <button
        type="button"
        className="lijst-primary-btn kies-start-link"
        aria-haspopup="dialog"
        aria-expanded={panel !== null}
        onClick={handleShare}
      >
        {label}
      </button>
      <span className="lijst-status" role="status">{message}</span>
      <ShareDialog
        open={panel === 'choose'}
        mode="choose"
        onSave={handlePreferenceSaved}
        onClose={() => setPanel(null)}
        idPrefix={`${panelPrefix}-blad`}
      />
      <ShareMenu
        open={panel === 'menu'}
        methods={menuMethods}
        label={label}
        onPick={handlePick}
        onMore={() => { setPanel(null); void runMethod('phone') }}
        onClose={() => setPanel(null)}
        idPrefix={`${panelPrefix}-menu`}
      />
    </div>
  )
}
