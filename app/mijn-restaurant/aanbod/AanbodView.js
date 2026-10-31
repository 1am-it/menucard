'use client'

// BE-55 stap B (#135) — /mijn-restaurant/aanbod: een daghap of seizoensgerecht
// plaatsen, aanpassen en offline halen.
//
// De server is de baas: deze pagina stuurt alleen het formulier naar de
// bestaande API (/api/v1/daghap) en toont wat die teruggeeft. De foutmeldingen
// komen per veld onder het juiste veld (src/lib/daghapFormulier.js), de stand
// `in_controle` heet hier "Wordt kort gecontroleerd".
//
// De sessie, de rollen en de restaurants komen uit dezelfde bronnen als het
// dashboard (/api/internal/v1/me). Welke restaurants mogen: alleen een
// owner-rol met restaurant_id (src/lib/ownerAanbod.js).
//
// Opmaak staat in ./aanbod.css (BE-52); globals.css blijft ongemoeid.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import { eigenRestaurants } from '@/src/lib/ownerAanbod'
import { DAGHAP_LABELS } from '@/src/lib/daghapAanbod'
import {
  FORM_MESSAGES,
  LABEL_LABELS,
  SOORT_LABELS,
  aanbodVerzoek,
  beschrijvingTeller,
  foutmeldingen,
  formulierVanAanbod,
  leegFormulier,
  statusLabel,
  verloopTekst,
} from '@/src/lib/daghapFormulier'
import ThemeToggle from '@/src/components/ThemeToggle'
import Wordmark from '@/src/components/Wordmark'
// De gedeelde owner-klassen (owner-main, owner-section, owner-card, ...) komen
// uit het bestaande stylesheet van Mijn restaurant; dit bestand voegt alleen de
// nieuwe aanbodklassen toe (BE-52).
import '../mijn-restaurant.css'
import './aanbod.css'

const LOGIN_HREF = '/mijn-restaurant/inloggen'
const DASHBOARD_HREF = '/mijn-restaurant'

async function leesJson(res) {
  try {
    return await res.json()
  } catch (error) {
    return {}
  }
}

export default function AanbodView({ restaurantIndex }) {
  const router = useRouter()
  const [session, setSession] = useState(undefined) // undefined = laden, null = geen sessie
  const [restaurants, setRestaurants] = useState([])
  const [restaurantId, setRestaurantId] = useState('')
  const [aanbod, setAanbod] = useState([])
  const [waarden, setWaarden] = useState(leegFormulier())
  const [bewerkId, setBewerkId] = useState(null)
  const [fouten, setFouten] = useState(null)
  const [fout, setFout] = useState('')
  const [melding, setMelding] = useState('')
  const [laden, setLaden] = useState(true)
  const [bezig, setBezig] = useState(false)

  useEffect(() => {
    let cancelled = false
    try {
      getSupabaseBrowser()
        .auth.getSession()
        .then(({ data }) => {
          if (cancelled) return
          if (!data.session) {
            router.replace(LOGIN_HREF)
            return
          }
          setSession(data.session)
        })
    } catch (error) {
      if (!cancelled) {
        setFout(FORM_MESSAGES.genericError)
        setLaden(false)
      }
    }
    return () => {
      cancelled = true
    }
  }, [router])

  /** Het aanbod van dit restaurant ophalen (alleen voor de houder). */
  const laadAanbod = useCallback(
    async (token, id) => {
      if (!token || !id) return
      try {
        const res = await fetch(`/api/v1/daghap?restaurant_id=${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        if (res.status === 401) {
          router.replace(LOGIN_HREF)
          return
        }
        const body = await leesJson(res)
        if (!res.ok) {
          setFout(body.message || FORM_MESSAGES.genericError)
          setAanbod([])
          return
        }
        setAanbod(Array.isArray(body.aanbod) ? body.aanbod : [])
      } catch (error) {
        setFout(FORM_MESSAGES.genericError)
      }
    },
    [router],
  )

  useEffect(() => {
    if (!session) return undefined
    let cancelled = false
    async function start() {
      try {
        const res = await fetch('/api/internal/v1/me', {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: 'no-store',
        })
        if (res.status === 401) {
          router.replace(LOGIN_HREF)
          return
        }
        const body = await leesJson(res)
        if (cancelled) return
        if (!res.ok) {
          setFout(FORM_MESSAGES.genericError)
          return
        }
        const gevonden = eigenRestaurants({ roles: body.roles, restaurantIndex })
        setRestaurants(gevonden)
        if (gevonden.length > 0) {
          setRestaurantId(gevonden[0].id)
          await laadAanbod(session.access_token, gevonden[0].id)
        }
      } catch (error) {
        if (!cancelled) setFout(FORM_MESSAGES.genericError)
      } finally {
        if (!cancelled) setLaden(false)
      }
    }
    start()
    return () => {
      cancelled = true
    }
  }, [session, restaurantIndex, router, laadAanbod])

  function zetVeld(veld, waarde) {
    setWaarden((huidig) => ({ ...huidig, [veld]: waarde }))
  }

  function wisselLabel(label) {
    setWaarden((huidig) => ({
      ...huidig,
      labels: huidig.labels.includes(label)
        ? huidig.labels.filter((huidige) => huidige !== label)
        : [...huidig.labels, label],
    }))
  }

  function kiesRestaurant(id) {
    setRestaurantId(id)
    setBewerkId(null)
    setWaarden(leegFormulier())
    setFouten(null)
    setMelding('')
    setFout('')
    laadAanbod(session && session.access_token, id)
  }

  function beginAanpassen(item) {
    setBewerkId(item.id)
    setWaarden(formulierVanAanbod(item))
    setFouten(null)
    setMelding('')
    setFout('')
  }

  function stopAanpassen() {
    setBewerkId(null)
    setWaarden(leegFormulier({ soort: waarden.soort }))
    setFouten(null)
  }

  async function verstuur(event) {
    event.preventDefault()
    if (!session || !restaurantId || bezig) return
    setBezig(true)
    setFout('')
    setMelding('')
    setFouten(null)
    try {
      const verzoek = aanbodVerzoek(waarden)
      const body = bewerkId ? verzoek : { restaurant_id: restaurantId, ...verzoek }
      const res = await fetch(bewerkId ? `/api/v1/daghap/${encodeURIComponent(bewerkId)}` : '/api/v1/daghap', {
        method: bewerkId ? 'PATCH' : 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      if (res.status === 401) {
        router.replace(LOGIN_HREF)
        return
      }
      const antwoord = await leesJson(res)
      if (!res.ok) {
        setFouten(foutmeldingen(antwoord))
        if (!Array.isArray(antwoord.errors)) setFout(antwoord.message || FORM_MESSAGES.genericError)
        return
      }
      setMelding(antwoord.inControle ? FORM_MESSAGES.savedControle : FORM_MESSAGES.saved)
      setBewerkId(null)
      setWaarden(leegFormulier({ soort: waarden.soort }))
      await laadAanbod(session.access_token, restaurantId)
    } catch (error) {
      setFout(FORM_MESSAGES.genericError)
    } finally {
      setBezig(false)
    }
  }

  async function haalOffline(item) {
    if (!session || bezig) return
    setBezig(true)
    setFout('')
    setMelding('')
    try {
      const res = await fetch(`/api/v1/daghap/${encodeURIComponent(item.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (res.status === 401) {
        router.replace(LOGIN_HREF)
        return
      }
      const antwoord = await leesJson(res)
      if (!res.ok) {
        setFout(antwoord.message || FORM_MESSAGES.genericError)
        return
      }
      setMelding(FORM_MESSAGES.offlineDone)
      await laadAanbod(session.access_token, restaurantId)
    } catch (error) {
      setFout(FORM_MESSAGES.genericError)
    } finally {
      setBezig(false)
    }
  }

  const veldFout = (veld) => (fouten && Array.isArray(fouten.velden[veld]) ? fouten.velden[veld] : [])
  const heeftFout = (veld) => veldFout(veld).length > 0

  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <Wordmark />
          <div className="header-right">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="owner-main">
        <p className="aanbod-back">
          <Link className="owner-link" href={DASHBOARD_HREF}>
            ← Terug naar Mijn restaurant
          </Link>
        </p>

        <h1 className="owner-title">{FORM_MESSAGES.title}</h1>
        <p className="owner-intro">{FORM_MESSAGES.intro}</p>

        {laden && (
          <p className="owner-note" role="status">
            {FORM_MESSAGES.loading}
          </p>
        )}

        {fout && (
          <p className="auth-error" role="alert">
            {fout}
          </p>
        )}

        {melding && (
          <p className="aanbod-notice" role="status">
            {melding}
          </p>
        )}

        {!laden && restaurants.length === 0 && (
          <p className="owner-note">
            {FORM_MESSAGES.noRestaurant} {FORM_MESSAGES.noRestaurantHelp}{' '}
            <Link className="owner-link" href="/alle-restaurants">
              Claim je restaurant
            </Link>
          </p>
        )}

        {restaurants.length > 0 && (
          <>
            {restaurants.length > 1 && (
              <div className="aanbod-field">
                <label className="aanbod-label" htmlFor="aanbod-restaurant">
                  {FORM_MESSAGES.restaurantLabel}
                </label>
                <select
                  id="aanbod-restaurant"
                  className="aanbod-input"
                  value={restaurantId}
                  onChange={(event) => kiesRestaurant(event.target.value)}
                >
                  {restaurants.map((restaurant) => (
                    <option value={restaurant.id} key={restaurant.id}>
                      {restaurant.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <section className="owner-section aanbod-section" aria-labelledby="aanbod-form-title">
              <h2 className="owner-section-title" id="aanbod-form-title">
                {bewerkId ? FORM_MESSAGES.adjust : FORM_MESSAGES.title}
              </h2>

              <form className="aanbod-form" onSubmit={verstuur} noValidate>
                <fieldset className="aanbod-fieldset" aria-describedby={heeftFout('soort') ? 'aanbod-soort-error' : undefined}>
                  <legend className="aanbod-label">{FORM_MESSAGES.soortLegend}</legend>
                  <div className="aanbod-soort">
                    {Object.entries(SOORT_LABELS).map(([soort, label]) => (
                      <label className="aanbod-soort-keuze" key={soort}>
                        <input
                          type="radio"
                          name="soort"
                          value={soort}
                          checked={waarden.soort === soort}
                          onChange={() => zetVeld('soort', soort)}
                          disabled={Boolean(bewerkId)}
                        />
                        <span>{label}</span>
                        <span className="aanbod-hint">
                          {soort === 'daghap' ? FORM_MESSAGES.soortDaghapHint : FORM_MESSAGES.soortSeizoenHint}
                        </span>
                      </label>
                    ))}
                  </div>
                  {heeftFout('soort') && (
                    <p className="aanbod-error" id="aanbod-soort-error">
                      {veldFout('soort').join(' ')}
                    </p>
                  )}
                </fieldset>

                <div className="aanbod-field">
                  <label className="aanbod-label" htmlFor="aanbod-naam">
                    {FORM_MESSAGES.naamLabel}
                  </label>
                  <input
                    id="aanbod-naam"
                    className="aanbod-input"
                    type="text"
                    value={waarden.naam}
                    onChange={(event) => zetVeld('naam', event.target.value)}
                    aria-describedby={heeftFout('naam') ? 'aanbod-naam-error' : 'aanbod-naam-hint'}
                    aria-invalid={heeftFout('naam') || undefined}
                    maxLength={120}
                  />
                  <p className="aanbod-hint" id="aanbod-naam-hint">
                    {FORM_MESSAGES.naamHint}
                  </p>
                  {heeftFout('naam') && (
                    <p className="aanbod-error" id="aanbod-naam-error">
                      {veldFout('naam').join(' ')}
                    </p>
                  )}
                </div>

                <div className="aanbod-field">
                  <label className="aanbod-label" htmlFor="aanbod-prijs">
                    {FORM_MESSAGES.prijsLabel}
                  </label>
                  <input
                    id="aanbod-prijs"
                    className="aanbod-input aanbod-input--prijs"
                    type="text"
                    inputMode="decimal"
                    value={waarden.prijs}
                    onChange={(event) => zetVeld('prijs', event.target.value)}
                    aria-describedby={heeftFout('prijs') ? 'aanbod-prijs-error' : 'aanbod-prijs-hint'}
                    aria-invalid={heeftFout('prijs') || undefined}
                  />
                  <p className="aanbod-hint" id="aanbod-prijs-hint">
                    {FORM_MESSAGES.prijsHint}
                  </p>
                  {heeftFout('prijs') && (
                    <p className="aanbod-error" id="aanbod-prijs-error">
                      {veldFout('prijs').join(' ')}
                    </p>
                  )}
                </div>

                <div className="aanbod-field">
                  <label className="aanbod-label" htmlFor="aanbod-beschrijving">
                    {FORM_MESSAGES.beschrijvingLabel}
                  </label>
                  <textarea
                    id="aanbod-beschrijving"
                    className="aanbod-input aanbod-textarea"
                    rows={3}
                    value={waarden.beschrijving}
                    onChange={(event) => zetVeld('beschrijving', event.target.value)}
                    aria-describedby={heeftFout('beschrijving') ? 'aanbod-beschrijving-error' : 'aanbod-beschrijving-hint'}
                    aria-invalid={heeftFout('beschrijving') || undefined}
                  />
                  <p className="aanbod-hint" id="aanbod-beschrijving-hint">
                    {FORM_MESSAGES.beschrijvingHint}{' '}
                    <span className="aanbod-counter">{beschrijvingTeller(waarden.beschrijving)}</span>
                  </p>
                  {heeftFout('beschrijving') && (
                    <p className="aanbod-error" id="aanbod-beschrijving-error">
                      {veldFout('beschrijving').join(' ')}
                    </p>
                  )}
                </div>

                <fieldset className="aanbod-fieldset" aria-describedby={heeftFout('labels') ? 'aanbod-labels-error' : undefined}>
                  <legend className="aanbod-label">{FORM_MESSAGES.labelsLegend}</legend>
                  <div className="aanbod-chips">
                    {DAGHAP_LABELS.map((label) => (
                      <label className="aanbod-chip" key={label}>
                        <input
                          type="checkbox"
                          checked={waarden.labels.includes(label)}
                          onChange={() => wisselLabel(label)}
                        />
                        <span>{LABEL_LABELS[label] || label}</span>
                      </label>
                    ))}
                  </div>
                  {heeftFout('labels') && (
                    <p className="aanbod-error" id="aanbod-labels-error">
                      {veldFout('labels').join(' ')}
                    </p>
                  )}
                </fieldset>

                {waarden.soort === 'seizoensgerecht' && (
                  <div className="aanbod-field">
                    <label className="aanbod-label" htmlFor="aanbod-einddatum">
                      {FORM_MESSAGES.einddatumLabel}
                    </label>
                    <input
                      id="aanbod-einddatum"
                      className="aanbod-input aanbod-input--datum"
                      type="date"
                      value={waarden.einddatum}
                      onChange={(event) => zetVeld('einddatum', event.target.value)}
                      aria-describedby={heeftFout('einddatum') ? 'aanbod-einddatum-error' : 'aanbod-einddatum-hint'}
                      aria-invalid={heeftFout('einddatum') || undefined}
                    />
                    <p className="aanbod-hint" id="aanbod-einddatum-hint">
                      {FORM_MESSAGES.einddatumHint}
                    </p>
                    {heeftFout('einddatum') && (
                      <p className="aanbod-error" id="aanbod-einddatum-error">
                        {veldFout('einddatum').join(' ')}
                      </p>
                    )}
                  </div>
                )}

                <div className="aanbod-actions">
                  <button type="submit" className="aanbod-submit" disabled={bezig}>
                    {bezig ? FORM_MESSAGES.busy : (bewerkId ? FORM_MESSAGES.submitWijziging : FORM_MESSAGES.submit)}
                  </button>
                  {bewerkId && (
                    <button type="button" className="auth-secondary" onClick={stopAanpassen}>
                      {FORM_MESSAGES.cancel}
                    </button>
                  )}
                </div>
              </form>
            </section>

            <section className="owner-section" aria-labelledby="aanbod-online-title">
              <h2 className="owner-section-title" id="aanbod-online-title">
                {FORM_MESSAGES.onlineTitel}
              </h2>
              {aanbod.length === 0 ? (
                <p className="owner-note">{FORM_MESSAGES.onlineEmpty}</p>
              ) : (
                <ul className="owner-list">
                  {aanbod.map((item) => (
                    <li className="owner-card aanbod-card" key={item.id}>
                      <div className="owner-card-head">
                        <h3 className="owner-restaurant-name">{item.naam}</h3>
                        <span className={`aanbod-status aanbod-status--${item.status}`}>{statusLabel(item.status)}</span>
                      </div>
                      <p className="owner-note">
                        {SOORT_LABELS[item.soort] || item.soort} · {item.prijs}
                        {verloopTekst({ soort: item.soort, verlooptOp: item.verlooptOp })
                          ? ` · ${verloopTekst({ soort: item.soort, verlooptOp: item.verlooptOp })}`
                          : ''}
                      </p>
                      {item.inControle && <p className="aanbod-controle">{FORM_MESSAGES.wordtGecontroleerd}</p>}
                      <div className="aanbod-card-actions">
                        <button type="button" className="owner-link aanbod-knop" onClick={() => beginAanpassen(item)}>
                          {FORM_MESSAGES.adjust}
                        </button>
                        <button
                          type="button"
                          className="owner-link aanbod-knop"
                          onClick={() => haalOffline(item)}
                          disabled={bezig || item.status === 'offline'}
                        >
                          {FORM_MESSAGES.takeOffline}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <p className="owner-note">{FORM_MESSAGES.onlineLimit}</p>
            </section>
          </>
        )}
      </main>
    </>
  )
}
