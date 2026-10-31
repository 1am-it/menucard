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
//
// BE-65 (#157, ronde 2, Lead-besluit) — de knop zelf blijft klein en statisch,
// maar de deellogica (`dishShare`, `sharePreference`, de teller en het menu)
// komt pas binnen bij de klik. Daarvoor is `loadShareModules()`; de bundel van
// / en /search groeit daardoor niet met de bestaande clientcode van de
// menukaart. De stand van "Bewaren" leest de kleine lezer in
// src/lib/savedListRead.js, zodat die meteen klopt zonder de zware module.

import { useCallback, useState } from 'react'
import dynamic from 'next/dynamic'
import { browserStorage } from '@/src/lib/savedListRead'
import DishSaveButton from '@/src/components/DishSaveButton'
// BE-65 (#157) — de variant met het woord "Delen" ernaast, alleen voor de home
// en de zoekresultaten (BE-52: eigen bestand naast de component).
import './dish-share-button.css'

// BE-50 (#120) — het deelblad en het kleine deelmenu verschijnen pas na een tik
// op "Delen"; ze worden daarom pas dan geladen. Knoppen, labels, aria-expanded
// en het gedrag blijven gelijk.
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
 * De deellogica pas bij de klik laden: de deeplink, de voorkeur uit "Delen
 * via" en de anonieme teller. De bundelaar bewaart ze daarna; een tweede klik
 * betaalt niets opnieuw.
 */
function loadShareModules() {
  return Promise.all([
    import('@/src/lib/dishShare'),
    import('@/src/lib/sharePreference'),
    import('@/src/lib/dishCounters'),
  ]).then(([share, preference, counters]) => ({ share, preference, counters }))
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

export default function DishShareButton({
  href,
  title = null,
  entry = null,
  dish = null,
  dishKey = null,
  name = null,
  restaurantName = null,
  withLabel = false,
}) {
  const [message, setMessage] = useState('')
  // Welk paneel staat open: het blad ("choose") of het kleine menu ("menu").
  const [panel, setPanel] = useState(null)
  const [menuMethods, setMenuMethods] = useState([])

  const shareName = String(name || title || (dish && dish.name) || (entry && entry.name) || '').trim() || 'dit gerecht'
  const panelPrefix = `deel-${dishKey || (dish && dish.dishId) || 'gerecht'}`
  // BE-44 (#105, criterium 5) — de anonieme teller van dit gerecht. Alleen na
  // een geslaagde deelactie, fire-and-forget, en zonder de gekozen manier.
  const dishId = dishKey || (dish && dish.dishId) || (entry && entry.id) || null
  const restaurant = restaurantName || (dish && dish.restaurantName) || (entry && entry.restaurant) || ''

  const runMethod = useCallback(async (method, modules) => {
    const mods = modules || (await loadShareModules())
    const url = mods.share.absoluteShareUrl({
      href,
      origin: typeof window === 'undefined' ? undefined : window.location.origin,
      theme: currentTheme(),
    })
    const shareTitle = title || mods.share.dishShareTitle({ name: shareName, restaurantName: restaurant })
    const navigatorRef = typeof navigator === 'undefined' ? null : navigator
    const result = await mods.preference.performShare({
      method,
      url,
      title: shareTitle,
      clipboard: navigatorRef ? navigatorRef.clipboard : null,
      share: navigatorRef && typeof navigatorRef.share === 'function' ? navigatorRef.share.bind(navigatorRef) : null,
      open: openShareLink,
      count: () => {
        void mods.counters.sendDishCounter({ dish: dishId, event: mods.counters.SHARED_EVENT })
      },
    })
    setMessage(result.message || '')
    return result
  }, [dishId, href, restaurant, shareName, title])

  const handleShare = useCallback(async () => {
    const mods = await loadShareModules()
    const storage = browserStorage()
    const plan = mods.preference.sharePlan(
      mods.preference.readSharePreference(storage),
      { canStore: mods.preference.storageAvailable(storage) }
    )
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
      await runMethod(plan.method, mods)
      return
    }
    await runMethod('phone', mods)
  }, [runMethod])

  // Na het blad: bewaren, en meteen doen wat de nieuwe voorkeur zegt. Lukt
  // bewaren niet (privémodus, beleid), dan geldt het gedrag van het
  // telefoonmenu — nooit een blad dat niets onthoudt.
  const handlePreferenceSaved = useCallback(async (preference) => {
    const mods = await loadShareModules()
    const storage = browserStorage()
    const stored = preference
      ? mods.preference.writeSharePreference(storage, preference)
      : mods.preference.clearSharePreference(storage)
    setPanel(null)
    if (preference && !stored) {
      await runMethod('phone', mods)
      return
    }
    const plan = mods.preference.sharePlan(
      mods.preference.readSharePreference(storage),
      { canStore: mods.preference.storageAvailable(storage) }
    )
    if (plan.kind === 'menu') {
      setMenuMethods(plan.methods)
      setPanel('menu')
      return
    }
    if (plan.kind === 'direct') {
      await runMethod(plan.method, mods)
      return
    }
    if (plan.kind === 'phone') await runMethod('phone', mods)
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

  if (!href && !entry && !dish) return null

  const open = panel !== null

  // BE-65 (#157) — `withLabel` toont op een breed scherm ook het woord
  // "Delen" naast het icoon (home en /search); op mobiel blijft het een ronde
  // icoonknop van 44 × 44 px. Op de menukaart blijft het de bestaande
  // "Deel <gerecht>".

  return (
    <div className="dish-share">
      <div className="dish-share-buttons" role="group" aria-label={`Delen en bewaren van ${shareName}`}>
        {href ? (
          <button
            type="button"
            className={`dish-share-btn${withLabel ? ' dish-share-btn--label' : ''}`}
            aria-label={withLabel ? `Delen: ${shareName}` : `Deel ${shareName}`}
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
            {withLabel ? <span className="dish-share-btn-text">Delen</span> : null}
          </button>
        ) : null}
        {entry || dish ? <DishSaveButton entry={entry} dish={dish} name={shareName} /> : null}
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
