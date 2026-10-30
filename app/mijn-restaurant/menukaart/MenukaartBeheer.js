'use client'

// BE-58 deel 2 (#143) — "Snel aanpassen" in Mijn restaurant.
//
// Per gerecht van de eigen goedgekeurde kaart: de prijs en "Tijdelijk niet
// beschikbaar". Opslaan dient de wijziging in; die staat daarna op `in_controle`
// tot de interne controle beslist. De oude kaart blijft gewoon staan en de
// statische menudata wordt nooit beschreven (contract, uitkomst 1).
//
// Deze pagina beslist niets zelf: eigenaarschap, plaatsrecht, de prijsgrenzen,
// de 30 per dag en de geschiedenis staan in src/lib/snelAanpassenHandlers.js en
// zijn daar met `node --test` getest. Hier staat alleen het scherm. Het label
// "Bevestigd door het restaurant" komt van dezelfde API en vervalt na 90 dagen.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import { MESSAGES } from '@/src/lib/authErrors'
import { OWNER_LOGIN_HREF } from '@/src/lib/ownerAccess'
import {
  IN_CONTROLE_MESSAGE,
  parsePrijsCent,
  statusLabel,
  wijzigingSamenvatting,
} from '@/src/lib/snelAanpassen'
import ThemeToggle from '@/src/components/ThemeToggle'
import Wordmark from '@/src/components/Wordmark'
// BE-52 (#128): de eigen opmaak van deze pagina staat naast de pagina.
import './menukaart.css'

const GERICHTEN_API = '/api/v1/menukaart/gerechten'
const WIJZIGINGEN_API = '/api/v1/menukaart/wijzigingen'
const BEVESTIGEN_API = '/api/v1/menukaart/bevestigen'

const TEKST = {
  title: 'Menukaart bijwerken',
  intro: 'Pas hier de prijs aan of zet een gerecht tijdelijk niet beschikbaar.',
  priceLabel: (naam) => `Prijs voor ${naam}`,
  unavailable: 'Tijdelijk niet beschikbaar',
  save: 'Wijzigingen opslaan',
  ownChanges: 'Je wijzigingen',
  noChanges: 'Je hebt nog geen wijzigingen doorgegeven.',
  confirm: 'Bevestig je menukaart',
  confirmedOn: (datum) => `Laatst bevestigd op ${datum}.`,
  notConfirmed: 'Je hebt je menukaart nog niet bevestigd.',
  noOwner: 'Je account is nog niet aan een restaurant gekoppeld.',
  noMenu: 'Er staat nog geen menukaart online voor je restaurant.',
  unavailableData: 'Je menukaart is nu niet beschikbaar. Probeer het later opnieuw.',
  back: '← Terug naar Mijn restaurant',
  menuChoice: 'Menukaart',
  currentPrice: (prijs) => `Nu op de kaart: ${prijs || 'op aanvraag'}`,
  inControle: 'In controle',
  noRights: 'Je mag de menukaart van dit restaurant niet aanpassen.',
  nothingChanged: 'Er is niets gewijzigd aan dit gerecht.',
  confirmed: 'Bedankt: je menukaart is bevestigd.',
}

function sleutelVan(gerecht) {
  return `${gerecht.categorieIndex}:${gerecht.gerechtIndex}`
}

function prijsTekst(cent) {
  return cent === null || cent === undefined ? '' : (cent / 100).toFixed(2).replace('.', ',')
}

export default function MenukaartBeheer({ restaurantIndex }) {
  const router = useRouter()
  const [token, setToken] = useState(null)
  const [restaurantIds, setRestaurantIds] = useState(null)
  const [restaurantId, setRestaurantId] = useState(null)
  const [menuId, setMenuId] = useState(null)
  const [gerechten, setGerechten] = useState([])
  const [wijzigingen, setWijzigingen] = useState([])
  const [bevestiging, setBevestiging] = useState(null)
  const [formulier, setFormulier] = useState({})
  const [bezig, setBezig] = useState(false)
  const [melding, setMelding] = useState(null)
  const [fout, setFout] = useState(null)
  const [laden, setLaden] = useState(true)

  const index = restaurantIndex && typeof restaurantIndex === 'object' ? restaurantIndex : {}

  useEffect(() => {
    let cancelled = false
    try {
      getSupabaseBrowser()
        .auth.getSession()
        .then(({ data }) => {
          if (cancelled) return
          if (!data.session) {
            router.replace(OWNER_LOGIN_HREF)
            return
          }
          setToken(data.session.access_token)
        })
    } catch (error) {
      if (!cancelled) setFout(MESSAGES.generic)
    }
    return () => {
      cancelled = true
    }
  }, [router])

  // Welke restaurants heeft dit account als houder? (/api/internal/v1/me)
  useEffect(() => {
    if (!token) return undefined
    let cancelled = false
    async function laadRollen() {
      try {
        const antwoord = await fetch('/api/internal/v1/me', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        if (antwoord.status === 401) {
          router.replace(OWNER_LOGIN_HREF)
          return
        }
        const body = await antwoord.json().catch(() => ({}))
        const rollen = Array.isArray(body.roles) ? body.roles : []
        const ids = []
        for (const rol of rollen) {
          if (!rol || rol.role !== 'owner') continue
          const id = String(rol.restaurant_id || '').trim()
          if (id && !ids.includes(id)) ids.push(id)
        }
        if (cancelled) return
        setRestaurantIds(ids)
        setRestaurantId(ids.length > 0 ? ids[0] : null)
      } catch (error) {
        if (!cancelled) setFout(TEKST.unavailableData)
      }
    }
    laadRollen()
    return () => {
      cancelled = true
    }
  }, [token, router])

  const menuIds = useMemo(() => {
    if (!restaurantId) return []
    const entry = index[restaurantId]
    return entry && Array.isArray(entry.menuIds) ? entry.menuIds.filter(Boolean) : []
  }, [index, restaurantId])

  useEffect(() => {
    if (menuIds.length === 0) {
      setMenuId(null)
      return
    }
    if (!menuId || !menuIds.includes(menuId)) setMenuId(menuIds[0])
  }, [menuIds, menuId])

  const laad = useCallback(async () => {
    if (!token || !menuId) return
    setLaden(true)
    setFout(null)
    try {
      const headers = { Authorization: `Bearer ${token}` }
      const [gerechtenRes, wijzigingenRes] = await Promise.all([
        fetch(`${GERICHTEN_API}?menuId=${encodeURIComponent(menuId)}`, { headers, cache: 'no-store' }),
        fetch(`${WIJZIGINGEN_API}?restaurant=${encodeURIComponent(restaurantId)}`, { headers, cache: 'no-store' }),
      ])

      if (gerechtenRes.status === 401 || wijzigingenRes.status === 401) {
        router.replace(OWNER_LOGIN_HREF)
        return
      }
      if (gerechtenRes.status === 403) {
        const body = await gerechtenRes.json().catch(() => ({}))
        setFout(body.message || TEKST.noRights)
        setGerechten([])
        setLaden(false)
        return
      }

      const gerechtenBody = await gerechtenRes.json().catch(() => ({}))
      const wijzigingenBody = await wijzigingenRes.json().catch(() => ({}))
      if (!gerechtenRes.ok) {
        setFout(TEKST.unavailableData)
        setLaden(false)
        return
      }

      const rijen = Array.isArray(gerechtenBody.gerechten) ? gerechtenBody.gerechten : []
      setGerechten(rijen)
      setBevestiging(gerechtenBody.bevestiging || null)
      setWijzigingen(Array.isArray(wijzigingenBody.wijzigingen) ? wijzigingenBody.wijzigingen : [])
      setFormulier(
        Object.fromEntries(
          rijen.map((rij) => [
            sleutelVan(rij),
            { prijs: prijsTekst(rij.prijsCent), nietBeschikbaar: rij.tijdelijkNietBeschikbaar === true },
          ]),
        ),
      )
      setLaden(false)
    } catch (error) {
      setFout(TEKST.unavailableData)
      setLaden(false)
    }
  }, [token, menuId, restaurantId, router])

  useEffect(() => {
    laad()
  }, [laad])

  function wijzigVeld(gerecht, veld, waarde) {
    const key = sleutelVan(gerecht)
    setFormulier((huidig) => ({
      ...huidig,
      [key]: { ...(huidig[key] || { prijs: '', nietBeschikbaar: false }), [veld]: waarde },
    }))
  }

  async function dienIn(gerecht) {
    const key = sleutelVan(gerecht)
    const invoer = formulier[key] || { prijs: '', nietBeschikbaar: false }
    const gevraagd = []

    const nieuweCent = parsePrijsCent(invoer.prijs)
    if (invoer.prijs.trim() !== '' && nieuweCent !== gerecht.prijsCent) {
      gevraagd.push({ soort: 'prijs', prijs: invoer.prijs })
    }
    if (invoer.nietBeschikbaar !== (gerecht.tijdelijkNietBeschikbaar === true)) {
      gevraagd.push({ soort: 'beschikbaarheid', beschikbaar: !invoer.nietBeschikbaar })
    }
    if (gevraagd.length === 0) {
      setMelding(TEKST.nothingChanged)
      return
    }

    setBezig(true)
    setFout(null)
    setMelding(null)
    try {
      for (const wijziging of gevraagd) {
        const antwoord = await fetch(WIJZIGINGEN_API, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            menuId,
            categorieIndex: gerecht.categorieIndex,
            gerechtIndex: gerecht.gerechtIndex,
            ...wijziging,
          }),
        })
        const body = await antwoord.json().catch(() => ({}))
        if (!antwoord.ok) {
          setFout(body.message || TEKST.unavailableData)
          setBezig(false)
          await laad()
          return
        }
      }
      setMelding(IN_CONTROLE_MESSAGE)
      await laad()
    } catch (error) {
      setFout(TEKST.unavailableData)
    }
    setBezig(false)
  }

  async function bevestig() {
    setBezig(true)
    setFout(null)
    setMelding(null)
    try {
      const antwoord = await fetch(BEVESTIGEN_API, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ menuId }),
      })
      const body = await antwoord.json().catch(() => ({}))
      if (!antwoord.ok) {
        setFout(body.message || TEKST.unavailableData)
      } else {
        setBevestiging(body.bevestiging || null)
        setMelding(TEKST.confirmed)
      }
    } catch (error) {
      setFout(TEKST.unavailableData)
    }
    setBezig(false)
  }

  const openPerGerecht = useMemo(() => {
    const open = new Set()
    for (const wijziging of wijzigingen) {
      if (!wijziging || wijziging.status !== 'in_controle') continue
      open.add(`${wijziging.categorieIndex}:${wijziging.gerechtIndex}`)
    }
    return open
  }, [wijzigingen])

  return (
    <div>
      <header>
        <div className="header-inner">
          <Wordmark />
          <div className="header-actions">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mk-main">
        <Link className="mk-back" href="/mijn-restaurant">
          {TEKST.back}
        </Link>
        <h1 className="mk-title">{TEKST.title}</h1>
        {restaurantId && index[restaurantId] && (
          <p className="mk-subtitle">{index[restaurantId].name}</p>
        )}
        <p className="mk-note">{TEKST.intro}</p>

        {fout && (
          <p className="mk-status mk-status--error" role="alert">
            {fout}
          </p>
        )}
        {melding && (
          <p className="mk-status" role="status">
            {melding}
          </p>
        )}

        {restaurantIds !== null && restaurantIds.length === 0 && (
          <p className="mk-note">{TEKST.noOwner}</p>
        )}

        {restaurantIds !== null && restaurantIds.length > 0 && menuIds.length === 0 && (
          <p className="mk-note">{TEKST.noMenu}</p>
        )}

        {menuIds.length > 1 && (
          <div className="mk-menu-choice" role="group" aria-label={TEKST.menuChoice}>
            {menuIds.map((id) => (
              <button
                key={id}
                type="button"
                className="mk-menu-button"
                aria-pressed={menuId === id}
                onClick={() => setMenuId(id)}
              >
                {id.split('-').slice(1).join(' ') || id}
              </button>
            ))}
          </div>
        )}

        {laden && !fout && <p className="mk-note">Bezig met laden…</p>}

        {!laden && gerechten.length > 0 && (
          <section className="mk-section" aria-labelledby="mk-dishes-title">
            <h2 className="mk-section-title" id="mk-dishes-title">Gerechten</h2>
            <ul className="mk-list">
              {gerechten.map((gerecht) => {
                const key = sleutelVan(gerecht)
                const invoer = formulier[key] || { prijs: '', nietBeschikbaar: false }
                const open = openPerGerecht.has(key)
                return (
                  <li className="mk-card" key={key}>
                    <div className="mk-card-head">
                      <h3 className="mk-dish-name">{gerecht.naam}</h3>
                      <span className="mk-dish-category">{gerecht.categorie}</span>
                    </div>
                    <p className="mk-current">{TEKST.currentPrice(gerecht.prijs)}</p>
                    {open && <span className="mk-badge">{TEKST.inControle}</span>}

                    <form
                      className="mk-form"
                      onSubmit={(event) => {
                        event.preventDefault()
                        dienIn(gerecht)
                      }}
                    >
                      <div className="mk-field">
                        <label className="mk-label" htmlFor={`prijs-${key}`}>
                          {TEKST.priceLabel(gerecht.naam)}
                        </label>
                        <input
                          className="mk-input"
                          id={`prijs-${key}`}
                          inputMode="decimal"
                          type="text"
                          value={invoer.prijs}
                          onChange={(event) => wijzigVeld(gerecht, 'prijs', event.target.value)}
                        />
                      </div>
                      <label className="mk-check" htmlFor={`niet-beschikbaar-${key}`}>
                        <input
                          id={`niet-beschikbaar-${key}`}
                          type="checkbox"
                          checked={invoer.nietBeschikbaar}
                          onChange={(event) => wijzigVeld(gerecht, 'nietBeschikbaar', event.target.checked)}
                        />
                        {TEKST.unavailable}
                      </label>
                      <button className="mk-save" type="submit" disabled={bezig}>
                        {TEKST.save}
                      </button>
                    </form>
                  </li>
                )
              })}
            </ul>
            <p className="mk-note">{IN_CONTROLE_MESSAGE}</p>
          </section>
        )}

        <section className="mk-section" aria-labelledby="mk-history-title">
          <h2 className="mk-section-title" id="mk-history-title">{TEKST.ownChanges}</h2>
          {wijzigingen.length === 0 ? (
            <p className="mk-note">{TEKST.noChanges}</p>
          ) : (
            <ul className="mk-history">
              {wijzigingen.map((wijziging) => (
                <li className="mk-history-row" key={wijziging.wijzigingId || `${wijziging.gerechtNaam}-${wijziging.ingediendOp}`}>
                  <span>{wijziging.gerechtNaam}</span>
                  <span>{wijzigingSamenvatting(wijziging)}</span>
                  <span className="mk-chip">{statusLabel(wijziging.status)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mk-section mk-confirm" aria-labelledby="mk-confirm-title">
          <h2 className="mk-section-title" id="mk-confirm-title">{TEKST.confirm}</h2>
          <p className="mk-note">
            {bevestiging && bevestiging.actief && bevestiging.datum
              ? TEKST.confirmedOn(bevestiging.datum)
              : TEKST.notConfirmed}
          </p>
          <button className="mk-save" type="button" onClick={bevestig} disabled={bezig || !menuId}>
            {TEKST.confirm}
          </button>
          {bevestiging && bevestiging.actief && bevestiging.label && (
            <span className="mk-confirmed-label">
              {bevestiging.label}
              {bevestiging.datum ? ` · ${bevestiging.datum}` : ''}
            </span>
          )}
        </section>
      </main>
    </div>
  )
}
