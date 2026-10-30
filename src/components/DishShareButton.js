'use client'

// BE-49 (#115, criterium 1, 2, 3, 4 en 6) — de kleine deelknop op de
// gerechtkaart, samen met "Bewaren" (DishSaveButton) rechtsonder.
//
// Eigenaarsbesluit 29 oktober: het gerecht staat weer centraal. Daarom is dit
// een icoonknop van 44 × 44 px met een zichtbaar icoon van ±20 px, zonder
// gevulde achtergrond; de toegankelijke naam is "Deel <gerecht>". Hetzelfde
// geldt voor "Bewaar <gerecht>".
//
// Wat een tik op "Delen" doet (contract "Voorbeelden"), staat in
// src/lib/sharePreference.js:
//   - nog geen voorkeur → het blad "Hoe deel je meestal?";
//   - één favoriet → meteen delen via die manier;
//   - twee of drie favorieten → een klein menu met die manieren en "Meer…";
//   - "telefoonmenu" → navigator.share, anders kopiëren.
// Een tik op Delen opent dus altijd iets dat met het toetsenbord te bedienen is:
// focus erin, Esc sluit, focus terug naar deze knop, en `aria-expanded` zegt of
// er iets openstaat (criterium 6).
//
// De link is de bestaande BE-44-deeplink (`absoluteShareUrl`), met de stand van
// dit moment; er gaat geen begeleidende tekst mee (eigenaarsbesluit 28
// oktober). De bestaande `gedeeld`-teller telt één keer per geslaagde actie,
// via welke manier ook; de manier zelf wordt niet opgeslagen of verstuurd.

import { useCallback, useState } from 'react'
import dynamic from 'next/dynamic'
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
import DishSaveButton from '@/src/components/DishSaveButton'

// BE-50 (#120) — het deelblad en het kleine deelmenu verschijnen pas na een tik
// op "Delen"; ze worden daarom pas dan geladen. De meting liet zien dat het blad
// anders op /menu en op de restaurantpagina in het eerste JS-pakket zat terwijl
// niemand het zag. Knoppen, labels, aria-expanded en het gedrag blijven gelijk.
const ShareDialog = dynamic(
  () => import('@/src/components/ShareDialog').then((module) => module.ShareDialog),
  { ssr: false }
)
const ShareMenu = dynamic(
  () => import('@/src/components/ShareDialog').then((module) => module.ShareMenu),
  { ssr: false }
)

function currentTheme() {
  return typeof document !== 'undefined' && document.documentElement
    ? document.documentElement.getAttribute('data-theme')
    : null
}

/**
 * Een gekozen webmanier openen met een echte link: `https:` in een nieuw
 * tabblad (WhatsApp, Telegram), `sms:` en `mailto:` in hetzelfde venster zodat
 * het systeem zijn eigen app opent. Een tijdelijke, onzichtbare anchor is de
 * gewone manier daarvoor — geen popup-blokkade en geen eigen URL-parser.
 */
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

export default function DishShareButton({ href, title, entry = null, dishKey = null, name = null }) {
  const [message, setMessage] = useState('')
  // Welk paneel staat open: het blad ("choose") of het kleine menu ("menu").
  const [panel, setPanel] = useState(null)
  const [menuMethods, setMenuMethods] = useState([])

  const shareName = String(name || title || '').trim() || 'dit gerecht'
  const panelPrefix = `deel-${dishKey || 'gerecht'}`
  // BE-44 (#105, criterium 5) — de anonieme teller van dit gerecht. Alleen na
  // een geslaagde deelactie, fire-and-forget, en zonder de gekozen manier.
  const dish = dishKey || (entry && entry.id) || null

  const countShared = useCallback(() => {
    void sendDishCounter({ dish, event: SHARED_EVENT })
  }, [dish])

  const runMethod = useCallback(async (method) => {
    const url = absoluteShareUrl({
      href,
      origin: typeof window === 'undefined' ? undefined : window.location.origin,
      theme: currentTheme(),
    })
    const navigatorRef = typeof navigator === 'undefined' ? null : navigator
    const result = await performShare({
      method,
      url,
      title,
      clipboard: navigatorRef ? navigatorRef.clipboard : null,
      share: navigatorRef && typeof navigatorRef.share === 'function' ? navigatorRef.share.bind(navigatorRef) : null,
      open: openShareLink,
      count: countShared,
    })
    setMessage(result.message || '')
    return result
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

  // Na het blad: bewaren, en meteen doen wat de nieuwe voorkeur zegt. Lukt
  // bewaren niet (privémodus, beleid), dan geldt het gedrag van het
  // telefoonmenu — nooit een blad dat niets onthoudt.
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

  // "Meer…" is het systeemmenu; op desktop zonder navigator.share kopieert het.
  const handleMore = useCallback(async () => {
    setPanel(null)
    await runMethod('phone')
  }, [runMethod])

  if (!href && !entry) return null

  const open = panel !== null

  return (
    <div className="dish-share">
      <div className="dish-share-buttons" role="group" aria-label={`Delen en bewaren van ${shareName}`}>
        {href ? (
          <button
            type="button"
            className="dish-share-btn"
            aria-label={`Deel ${shareName}`}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={handleShare}
          >
            {/* Het deelicoon, variant A: een vierkant met een pijl omhoog. */}
            <svg className="dish-share-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <path d="M12 3v12" />
              <path d="M8 7l4-4 4 4" />
              <path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
            </svg>
          </button>
        ) : null}
        {entry ? <DishSaveButton entry={entry} name={shareName} /> : null}
      </div>
      <span className="dish-share-status" role="status">{message}</span>
      {panel === 'choose' ? (
        <ShareDialog
          open
          mode="choose"
          onSave={handlePreferenceSaved}
          onClose={() => setPanel(null)}
          idPrefix={`${panelPrefix}-blad`}
        />
      ) : null}
      {panel === 'menu' ? (
        <ShareMenu
          open
          methods={menuMethods}
          label={`Deel ${shareName}`}
          onPick={handlePick}
          onMore={handleMore}
          onClose={() => setPanel(null)}
          idPrefix={`${panelPrefix}-menu`}
        />
      ) : null}
    </div>
  )
}

