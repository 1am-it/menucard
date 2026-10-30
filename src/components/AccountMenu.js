'use client'

// BE-59 (#146, "Delen 1") — het accountmenu rechtsboven.
//
// Eén knop, overal dezelfde: een ronde avatar (44 px) met de initialen uit de
// naam of het e-mailadres, en een stip als er voor deze rol openstaand werk is.
// Het menu toont alleen wat bij de rol hoort (src/lib/accountMenu.js beslist
// dat, puur en getest). Dit is een zichtbaarheidslaag: elke route houdt zijn
// eigen, ongewijzigde servercontrole.
//
// Performance (criterium 2): een gast laadt hier niets van. Eerst een goedkope
// controle of er een Supabase-sessiesleutel in localStorage staat; alleen dan
// komen de Supabase-client en dit menu in beeld, via een dynamische import().
// Zonder sleutel is er geen import, geen verzoek en geen knop.
//
// Desktop: het menu klapt uit onder de knop; Escape sluit het, de pijltoetsen
// (en Home/End) verplaatsen de focus, en Escape zet de focus terug op de knop.
// Smaller dan 720 px: hetzelfde menu als paneel van onderen, met een sluitknop
// en grote tikvlakken (de opmaak staat in account-menu.css).
//
// De tellingen komen uit GET /api/internal/v1/workqueue-counts — hetzelfde
// antwoord dat de Werkvoorraad in de interne navigatie gebruikt, en al
// rolgefilterd. Een ontbrekend aantal geeft geen stip, nooit een nep-getal.

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import {
  accountAriaLabel,
  hasSupabaseSessionKey,
  hasWorkRoles,
  initialsFrom,
  openWorkTotal,
  resolveAccountMenuItems,
  resolveAccountName,
  resolveRoleLabels,
  shouldShowDot,
} from '@/src/lib/accountMenu'
import './account-menu.css'

const ME_API = '/api/internal/v1/me'
const COUNT_API = '/api/internal/v1/workqueue-counts'
const MOBILE_QUERY = '(max-width: 719px)'
const PANEL_ID = 'account-menu-panel'

export default function AccountMenu() {
  const pathname = usePathname()
  const router = useRouter()

  // undefined = nog aan het kijken, null = gast, object = ingelogd.
  const [account, setAccount] = useState(undefined)
  const [count, setCount] = useState(null)
  const [open, setOpen] = useState(false)
  const [narrow, setNarrow] = useState(false)

  const triggerRef = useRef(null)
  const panelRef = useRef(null)
  const wrapperRef = useRef(null)

  // Gasten: geen Supabase-code, geen verzoek. Alleen bij een sessiesleutel
  // laden we de client (dynamische import) en vragen we de rollen op.
  useEffect(() => {
    let cancelled = false

    async function resolveAccount() {
      let storage = null
      try {
        storage = window.localStorage
      } catch {
        return
      }
      if (!hasSupabaseSessionKey(storage)) return

      try {
        const { getSupabaseBrowser } = await import('@/src/lib/supabaseBrowser')
        const supabase = getSupabaseBrowser()
        const { data } = await supabase.auth.getSession()
        const session = data && data.session
        if (!session || !session.access_token) return

        const res = await fetch(ME_API, {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: 'no-store',
        })
        if (!res.ok) return
        const body = await res.json().catch(() => ({}))
        if (cancelled) return
        setAccount({
          name: resolveAccountName(session.user),
          roles: Array.isArray(body.roles) ? body.roles : [],
          token: session.access_token,
        })
      } catch {
        // Geen client of geen sessie: geen knop. Nooit een half ingelogde kop.
      }
    }

    resolveAccount()
    return () => {
      cancelled = true
    }
  }, [])

  // De stip gebruikt dezelfde countingen als de Werkvoorraad. Alleen voor
  // internal/editor; voor een houder vragen we niets.
  useEffect(() => {
    if (!account || !hasWorkRoles(account.roles)) return undefined
    let cancelled = false

    async function loadCounts() {
      try {
        const res = await fetch(COUNT_API, {
          headers: { Authorization: `Bearer ${account.token}` },
          cache: 'no-store',
        })
        const body = await res.json().catch(() => ({}))
        if (cancelled) return
        setCount(res.ok ? openWorkTotal(body.counts) : null)
      } catch {
        if (!cancelled) setCount(null)
      }
    }

    loadCounts()
    return () => {
      cancelled = true
    }
  }, [account])

  // Paneel van onderen of uitklapmenu onder de knop: alleen een weergavekeuze.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const query = window.matchMedia(MOBILE_QUERY)
    const update = () => setNarrow(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  // Escape sluit en zet de focus terug op de knop; een klik buiten sluit zonder
  // de focus te verplaatsen. Beide luisteraars bestaan alleen zolang het menu
  // open is.
  useEffect(() => {
    if (!open) return undefined

    function handleKeyDown(event) {
      if (event.key !== 'Escape') return
      setOpen(false)
      if (triggerRef.current) triggerRef.current.focus()
    }

    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) setOpen(false)
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open])

  // Een navigatie vanuit het menu laat het niet openstaan op de volgende pagina.
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  // Bij openen staat de focus meteen in het menu (eerste item of de sluitknop),
  // zodat de pijltoetsen en Tab vanaf de eerste rij werken.
  useEffect(() => {
    if (!open || !panelRef.current) return
    const first = panelRef.current.querySelector('a[href], button:not([disabled])')
    if (first) first.focus()
  }, [open, narrow])

  // Pijltoetsen, Home en End verplaatsen de focus binnen het geopende menu.
  function handlePanelKeyDown(event) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const panel = panelRef.current
    if (!panel) return
    const focusable = Array.from(panel.querySelectorAll('a[href], button:not([disabled])'))
    if (focusable.length === 0) return
    const index = focusable.indexOf(document.activeElement)
    let next = index
    if (event.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % focusable.length
    else if (event.key === 'ArrowUp') next = index <= 0 ? focusable.length - 1 : index - 1
    else if (event.key === 'Home') next = 0
    else next = focusable.length - 1
    event.preventDefault()
    focusable[next].focus()
  }

  async function signOut() {
    setOpen(false)
    try {
      const { getSupabaseBrowser } = await import('@/src/lib/supabaseBrowser')
      await getSupabaseBrowser().auth.signOut()
    } catch {
      // Geen client? Dan is er ook geen sessie om te beëindigen.
    }
    router.replace('/')
    router.refresh()
  }

  // Gast of nog aan het kijken: geen knop, geen menu.
  if (!account) return null

  const workCount = hasWorkRoles(account.roles) ? count : null
  const dot = shouldShowDot(account.roles, workCount)
  const roleLabels = resolveRoleLabels(account.roles)
  const items = resolveAccountMenuItems({ roles: account.roles, pathname })

  function menuBody() {
    return (
      <>
        <div className="account-menu-header">
          <p className="account-menu-name">{account.name}</p>
          {roleLabels.length > 0 && <p className="account-menu-roles">{roleLabels.join(' · ')}</p>}
        </div>

        <ul className="account-menu-items">
          {items.map((item) => (
            <li key={item.id}>
              {item.href ? (
                <a className="account-menu-item" href={item.href}>
                  <span className="account-menu-item-label">{item.label}</span>
                  {item.id === 'beheer' && Number.isInteger(workCount) && (
                    <span className="account-menu-item-count">{workCount} open</span>
                  )}
                </a>
              ) : (
                <button type="button" className="account-menu-item" onClick={signOut}>
                  <span className="account-menu-item-label">{item.label}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      </>
    )
  }

  return (
    <div className="account-menu" ref={wrapperRef}>
      <button
        ref={triggerRef}
        type="button"
        className="account-menu-trigger"
        aria-expanded={open}
        aria-controls={PANEL_ID}
        aria-label={accountAriaLabel(account.name, dot ? workCount : null)}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="account-menu-avatar" aria-hidden="true">
          {initialsFrom(account.name)}
        </span>
        {dot && <span className="account-menu-dot" aria-hidden="true" />}
      </button>

      {open && (
        <div
          ref={panelRef}
          id={PANEL_ID}
          role="dialog"
          aria-label="Accountmenu"
          className={`account-menu-panel ${narrow ? 'account-menu-panel--sheet' : ''}`}
          onKeyDown={handlePanelKeyDown}
        >
          {narrow && (
            <div className="account-menu-sheet-header">
              <span className="account-menu-sheet-title">Account</span>
              <button
                type="button"
                className="account-menu-close"
                onClick={() => {
                  setOpen(false)
                  if (triggerRef.current) triggerRef.current.focus()
                }}
              >
                Sluiten
              </button>
            </div>
          )}
          {menuBody()}
        </div>
      )}
    </div>
  )
}
