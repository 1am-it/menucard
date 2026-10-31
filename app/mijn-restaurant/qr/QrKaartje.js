'use client'

// BE-68 (#168) â€” "QR-kaartje voor op tafel".
//
// Deze pagina beslist niets zelf. Ze haalt de sessie en `GET
// /api/internal/v1/me` op (dezelfde weg als /mijn-restaurant/aanbod), laat
// src/lib/qrKaartje.js bepalen welk restaurant en welke URL erbij horen, en
// toont daarna het voorbeeld en de keuzes. Zonder sessie gaat de bezoeker naar
// /mijn-restaurant/inloggen; een account zonder eigen restaurant krijgt de
// eerlijke melding, nooit andermans kaartje.
//
// Twee knoppen doen hetzelfde printwerk: "Download pdf" en "Afdrukken" openen
// allebei de printdialoog (opslaan als pdf is een keuze daar). Op mobiel komt
// "Deel de QR-afbeelding" erbij: de PNG via de Web Share API, met downloaden
// als terugval.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import { eigenRestaurants } from '@/src/lib/ownerAanbod'
import {
  QR_DOELEN,
  QR_FORMATEN,
  QR_MESSAGES,
  QR_STANDAARD_TEKST,
  controleerQrTekst,
  formaatMaat,
  kiesRestaurant,
  meldingenBij,
  nietLiveMelding,
  qrUrl,
  tekstTeller,
} from '@/src/lib/qrKaartje'
import ThemeToggle from '@/src/components/ThemeToggle'
import Wordmark from '@/src/components/Wordmark'
import QrCode, { qrPngBlob } from './QrCode'
import '../mijn-restaurant.css'
import './qr-kaartje.css'

const LOGIN_HREF = '/mijn-restaurant/inloggen'
const DASHBOARD_HREF = '/mijn-restaurant'

async function leesJson(res) {
  try {
    return await res.json()
  } catch (error) {
    return {}
  }
}

/** EÃ©n kaartje, zoals het op tafel komt te staan: altijd licht papier. */
function Kaartje({ naam, tekst, url, afdruk = false }) {
  return (
    <div
      className={`qr-kaartje-kaart${afdruk ? ' qr-kaartje-kaart--afdruk' : ''}`}
      data-url={url || ''}
    >
      <span className="qr-kaartje-strook" aria-hidden="true" />
      <p className="qr-kaartje-naam">{naam}</p>
      <p className="qr-kaartje-tekst">{tekst}</p>
      <div className="qr-kaartje-code">
        <QrCode value={url} label={`QR-code naar de menukaart van ${naam}`} />
      </div>
      <p className="qr-kaartje-voet">{QR_MESSAGES.previewFooter}</p>
      <p className="qr-kaartje-merk">
        <span className="qr-kaartje-tegel" aria-hidden="true">
          {QR_MESSAGES.previewLogoMark}
        </span>
        {QR_MESSAGES.previewLogo}
      </p>
    </div>
  )
}

export default function QrKaartje({ restaurantIndex, siteUrl, siteIndexable }) {
  const router = useRouter()
  const [session, setSession] = useState(undefined) // undefined = laden, null = geen sessie
  const [restaurants, setRestaurants] = useState([])
  const [restaurantId, setRestaurantId] = useState('')
  const [doel, setDoel] = useState(QR_DOELEN[0].value)
  const [tekst, setTekst] = useState(QR_STANDAARD_TEKST)
  const [formaat, setFormaat] = useState(QR_FORMATEN[0].value)
  const [origin, setOrigin] = useState('')
  const [laden, setLaden] = useState(true)
  const [fout, setFout] = useState('')
  const [melding, setMelding] = useState('')
  const [keuzesOpen, setKeuzesOpen] = useState(true)
  const [mobiel, setMobiel] = useState(false)
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
        setFout(QR_MESSAGES.genericError)
        setLaden(false)
      }
    }
    return () => {
      cancelled = true
    }
  }, [router])

  // De oorsprong is de terugval als NEXT_PUBLIC_SITE_URL ontbreekt. Die is er
  // pas in de browser, dus na de eerste render.
  useEffect(() => {
    if (typeof window !== 'undefined') setOrigin(window.location.origin)
  }, [])

  // Op mobiel staan het voorbeeld en de knoppen bovenaan; de keuzes klappen
  // pas open met "Tekst of formaat aanpassen".
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const vraag = window.matchMedia('(max-width: 640px)')
    const bijwerken = () => {
      setMobiel(vraag.matches)
      setKeuzesOpen(!vraag.matches)
    }
    bijwerken()
    vraag.addEventListener('change', bijwerken)
    return () => vraag.removeEventListener('change', bijwerken)
  }, [])

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
          setFout(QR_MESSAGES.genericError)
          return
        }
        const gevonden = eigenRestaurants({ roles: body.roles, restaurantIndex })
        setRestaurants(gevonden)
        if (gevonden.length > 0) setRestaurantId(gevonden[0].id)
      } catch (error) {
        if (!cancelled) setFout(QR_MESSAGES.genericError)
      } finally {
        if (!cancelled) setLaden(false)
      }
    }
    start()
    return () => {
      cancelled = true
    }
  }, [session, restaurantIndex, router])

  // De keuze gaat door dezelfde toegangsregel als de rest van Mijn restaurant:
  // alleen een eigen restaurant komt eruit, ook als er iets anders gevraagd is.
  const restaurant = useMemo(
    () =>
      kiesRestaurant({
        roles: restaurants.map((entry) => ({ role: 'owner', restaurant_id: entry.id })),
        restaurantIndex,
        gevraagdId: restaurantId,
      }),
    [restaurants, restaurantIndex, restaurantId],
  )

  const maat = formaatMaat(formaat)
  const tekstUitkomst = controleerQrTekst(tekst)
  const tekstFouten = meldingenBij(tekstUitkomst.codes)
  const url = restaurant ? qrUrl({ doel, restaurantId: restaurant.id, siteUrl, origin }) : ''
  const nietLive = nietLiveMelding(siteIndexable)
  const aantalKaartjes = formaat === 'png' ? 1 : maat.perPagina

  const print = useCallback(() => {
    setMelding('')
    try {
      window.print()
    } catch (error) {
      setFout(QR_MESSAGES.genericError)
    }
  }, [])

  const deel = useCallback(async () => {
    if (!url || bezig) return
    setBezig(true)
    setFout('')
    setMelding('')
    try {
      const blob = await qrPngBlob({ value: url, px: maat.px })
      const bestand = new File([blob], 'qr-kaartje.png', { type: 'image/png' })
      const kanDelen =
        typeof navigator !== 'undefined'
        && typeof navigator.canShare === 'function'
        && navigator.canShare({ files: [bestand] })
      if (kanDelen) {
        await navigator.share({ files: [bestand], title: QR_MESSAGES.title })
        return
      }
      const href = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = href
      link.download = 'qr-kaartje.png'
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(href)
      setMelding(QR_MESSAGES.shareFallback)
    } catch (error) {
      // Wie het deelvenster sluit, heeft niets kapotgemaakt.
      if (error && error.name === 'AbortError') return
      setFout(QR_MESSAGES.genericError)
    } finally {
      setBezig(false)
    }
  }, [url, bezig, maat.px])

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
        {/* Een nav-landmark, net als op /mijn-restaurant/menukaart: de pagina
            hoort bij Mijn restaurant en heeft een weg terug. */}
        <nav className="qr-kaartje-back" aria-label="Mijn restaurant">
          <Link className="owner-link" href={DASHBOARD_HREF}>
            ← Terug naar Mijn restaurant
          </Link>
        </nav>

        <h1 className="owner-title">{QR_MESSAGES.title}</h1>
        <p className="owner-intro">{QR_MESSAGES.intro}</p>

        {laden && (
          <p className="owner-note" role="status">
            {QR_MESSAGES.loading}
          </p>
        )}

        {fout && (
          <p className="auth-error" role="alert">
            {fout}
          </p>
        )}

        {melding && (
          <p className="qr-kaartje-melding" role="status">
            {melding}
          </p>
        )}

        {!laden && restaurants.length === 0 && (
          <p className="owner-note">
            {QR_MESSAGES.noRestaurant}{' '}
            <Link className="owner-link" href="/mijn-restaurant/claimen">
              Claim je restaurant
            </Link>
          </p>
        )}

        {restaurants.length > 0 && restaurant && (
          <div className="qr-kaartje-pagina">
            <div className="qr-kaartje-paneel">
              {nietLive && <p className="qr-kaartje-nietlive">{nietLive}</p>}

              <div id="qr-kaartje-keuzes" className="qr-kaartje-keuzes" hidden={mobiel && !keuzesOpen}>
                {restaurants.length > 1 && (
                  <div className="qr-kaartje-veld">
                    <label className="qr-kaartje-label" htmlFor="qr-kaartje-restaurant">
                      {QR_MESSAGES.restaurantLabel}
                    </label>
                    <select
                      id="qr-kaartje-restaurant"
                      className="qr-kaartje-input"
                      value={restaurant.id}
                      onChange={(event) => setRestaurantId(event.target.value)}
                    >
                      {restaurants.map((entry) => (
                        <option value={entry.id} key={entry.id}>
                          {entry.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <fieldset className="qr-kaartje-veld">
                  <legend className="qr-kaartje-label">{QR_MESSAGES.doelLegend}</legend>
                  <div className="qr-kaartje-doelen">
                    {QR_DOELEN.map((optie) => (
                      <label
                        className="qr-kaartje-doel"
                        key={optie.value}
                        data-actief={doel === optie.value ? 'ja' : 'nee'}
                      >
                        <input
                          type="radio"
                          name="qr-doel"
                          value={optie.value}
                          checked={doel === optie.value}
                          onChange={() => setDoel(optie.value)}
                        />
                        <span className="qr-kaartje-doel-label">{optie.label}</span>
                        <span className="qr-kaartje-doel-hint">{optie.hint}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="qr-kaartje-veld">
                  <label className="qr-kaartje-label" htmlFor="qr-kaartje-tekst">
                    {QR_MESSAGES.tekstLabel}
                  </label>
                  <input
                    id="qr-kaartje-tekst"
                    className="qr-kaartje-input"
                    type="text"
                    value={tekst}
                    onChange={(event) => setTekst(event.target.value)}
                    aria-describedby="qr-kaartje-tekst-hint qr-kaartje-tekst-teller"
                    aria-invalid={tekstFouten.length > 0}
                  />
                  <p className="qr-kaartje-hint" id="qr-kaartje-tekst-hint">
                    {QR_MESSAGES.tekstHint}
                  </p>
                  <p className="qr-kaartje-teller" id="qr-kaartje-tekst-teller">
                    {tekstTeller(tekst)}
                  </p>
                  {tekstFouten.length > 0 && (
                    <p className="qr-kaartje-error" role="alert">
                      {tekstFouten.join(' ')}
                    </p>
                  )}
                </div>

                <fieldset className="qr-kaartje-veld">
                  <legend className="qr-kaartje-label">{QR_MESSAGES.formaatLegend}</legend>
                  <div className="qr-kaartje-formaten">
                    {QR_FORMATEN.map((optie) => (
                      <label
                        className="qr-kaartje-formaat"
                        key={optie.value}
                        data-actief={formaat === optie.value ? 'ja' : 'nee'}
                      >
                        <input
                          type="radio"
                          name="qr-formaat"
                          value={optie.value}
                          checked={formaat === optie.value}
                          onChange={() => setFormaat(optie.value)}
                        />
                        {optie.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>

              <div className="qr-kaartje-acties">
                <button type="button" className="qr-kaartje-knop qr-kaartje-knop--primair" onClick={print}>
                  {QR_MESSAGES.download}
                </button>
                <button type="button" className="qr-kaartje-knop" onClick={print}>
                  {QR_MESSAGES.print}
                </button>
                {mobiel && (
                  <button type="button" className="qr-kaartje-knop" onClick={deel} disabled={bezig || !url}>
                    {QR_MESSAGES.share}
                  </button>
                )}
              </div>
              <p className="qr-kaartje-hint">{QR_MESSAGES.printHint}</p>

              {mobiel && (
                <button
                  type="button"
                  className="qr-kaartje-aanpassen"
                  aria-expanded={keuzesOpen}
                  aria-controls="qr-kaartje-keuzes"
                  onClick={() => setKeuzesOpen((open) => !open)}
                >
                  {QR_MESSAGES.adjust}
                </button>
              )}
            </div>

            <section className="qr-kaartje-voorbeeld" aria-labelledby="qr-kaartje-voorbeeld-titel">
              <h2 className="qr-kaartje-voorbeeld-titel" id="qr-kaartje-voorbeeld-titel">
                {QR_MESSAGES.preview}
              </h2>
              <Kaartje naam={restaurant.name} tekst={tekstUitkomst.effectief} url={url} />
            </section>
          </div>
        )}
      </main>

      {restaurant && (
        <div className="qr-kaartje-afdruk" data-formaat={formaat} aria-hidden="true">
          {Array.from({ length: aantalKaartjes }, (_, index) => (
            <Kaartje
              key={index}
              naam={restaurant.name}
              tekst={tekstUitkomst.effectief}
              url={url}
              afdruk
            />
          ))}
        </div>
      )}
    </>
  )
}
