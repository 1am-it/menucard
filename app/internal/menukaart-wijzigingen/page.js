'use client'

// BE-58 deel 2 (#143) — /internal/menukaart-wijzigingen: "Wijzigingen van
// houders", naast de werkvoorraad van BE-55.
//
// De interne controle ziet de ingediende wijzigingen, de markering "grote
// wijziging" (meer dan 50% prijsverschil) en kan per wijziging goedkeuren of
// afwijzen met een reden. Alleen intern beheer: de API gaat door
// `authenticateInternalRequest` met de rol `internal` en weigert een owner of
// editor (403). Deze pagina beslist niets zelf; de regels en de geschiedenis
// staan in src/lib/snelAanpassenHandlers.js en zijn daar getest.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import InternalNav from '@/src/components/InternalNav'
import { statusLabel, wijzigingSamenvatting } from '@/src/lib/snelAanpassen'
// BE-52 (#128): de eigen opmaak van deze pagina staat naast de pagina.
import './wijzigingen.css'

const ENDPOINT = '/api/internal/v1/menukaart-wijzigingen'

const STATUS_OPTIONS = [
  { value: 'in_controle', label: 'Te beoordelen' },
  { value: 'goedgekeurd', label: 'Goedgekeurd' },
  { value: 'afgewezen', label: 'Afgewezen' },
]

const TEKST = {
  title: 'Wijzigingen van houders',
  intro: 'Een houder wijzigde een prijs of zette een gerecht tijdelijk niet beschikbaar. Keur goed of wijs af met een reden.',
  empty: 'Er staan geen wijzigingen met deze status.',
  unavailable: 'De wijzigingen zijn nu niet beschikbaar.',
  noAccess: 'Alleen intern beheer kan wijzigingen beoordelen.',
  approve: 'Goedkeuren',
  reject: 'Afwijzen',
  reason: 'Reden voor afwijzen',
  reasonRequired: 'Geef een reden op voor het afwijzen.',
  confirmReject: 'Afwijzen bevestigen',
  cancel: 'Annuleren',
  big: 'Grote wijziging',
  filter: 'Status',
}

export default function MenukaartWijzigingenPage() {
  const router = useRouter()
  const [session, setSession] = useState(undefined)
  const [status, setStatus] = useState('in_controle')
  const [rijen, setRijen] = useState([])
  const [groteWijzigingen, setGroteWijzigingen] = useState(0)
  const [laden, setLaden] = useState(true)
  const [fout, setFout] = useState(null)
  const [bezig, setBezig] = useState(false)
  const [afwijzen, setAfwijzen] = useState(null)
  const [reden, setReden] = useState('')

  useEffect(() => {
    let cancelled = false
    try {
      getSupabaseBrowser()
        .auth.getSession()
        .then(({ data }) => {
          if (cancelled) return
          if (!data.session) {
            router.replace('/internal/login')
            return
          }
          setSession(data.session)
        })
    } catch (error) {
      if (!cancelled) setFout(TEKST.unavailable)
    }
    return () => {
      cancelled = true
    }
  }, [router])

  const laad = useCallback(async () => {
    if (!session) return
    setLaden(true)
    setFout(null)
    try {
      const antwoord = await fetch(`${ENDPOINT}?status=${encodeURIComponent(status)}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: 'no-store',
      })
      if (antwoord.status === 401) {
        router.replace('/internal/login')
        return
      }
      const body = await antwoord.json().catch(() => ({}))
      if (antwoord.status === 403) {
        setFout(body.message || TEKST.noAccess)
        setRijen([])
        setLaden(false)
        return
      }
      if (!antwoord.ok) {
        setFout(TEKST.unavailable)
        setRijen([])
        setLaden(false)
        return
      }
      setRijen(Array.isArray(body.wijzigingen) ? body.wijzigingen : [])
      setGroteWijzigingen(Number(body.groteWijzigingen) || 0)
      setLaden(false)
    } catch (error) {
      setFout(TEKST.unavailable)
      setLaden(false)
    }
  }, [session, status, router])

  useEffect(() => {
    laad()
  }, [laad])

  async function beoordeel(wijziging, actie, metReden) {
    setBezig(true)
    setFout(null)
    try {
      const antwoord = await fetch(`${ENDPOINT}/${wijziging.wijzigingId}/${actie}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' },
        body: JSON.stringify(metReden ? { reden: metReden } : {}),
      })
      const body = await antwoord.json().catch(() => ({}))
      if (!antwoord.ok) {
        setFout(body.message || TEKST.unavailable)
      } else {
        setAfwijzen(null)
        setReden('')
        await laad()
      }
    } catch (error) {
      setFout(TEKST.unavailable)
    }
    setBezig(false)
  }

  return (
    <div>
      <InternalNav accessToken={session ? session.access_token : undefined} />
      <main className="mw-main">
        <h1 className="mw-title">{TEKST.title}</h1>
        <p className="mw-note">{TEKST.intro}</p>

        <div className="mw-filters" role="group" aria-label={TEKST.filter}>
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className="mw-filter"
              aria-pressed={status === option.value}
              onClick={() => setStatus(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {fout && (
          <p className="mw-status mw-status--error" role="alert">
            {fout}
          </p>
        )}
        {!fout && status === 'in_controle' && groteWijzigingen > 0 && (
          <p className="mw-note">
            {groteWijzigingen} van deze wijzigingen is een grote wijziging (meer dan 50% prijsverschil).
          </p>
        )}

        {laden && <p className="mw-note">Bezig met laden…</p>}

        {!laden && rijen.length === 0 && !fout && <p className="mw-note">{TEKST.empty}</p>}

        {rijen.length > 0 && (
          <ul className="mw-list">
            {rijen.map((wijziging) => (
              <li className="mw-card" key={wijziging.wijzigingId}>
                <div className="mw-card-head">
                  <h2 className="mw-dish">{wijziging.gerechtNaam}</h2>
                  <span className="mw-chip">{statusLabel(wijziging.status)}</span>
                </div>
                <p className="mw-line">{wijzigingSamenvatting(wijziging)}</p>
                <p className="mw-line">
                  Restaurant {wijziging.restaurantId} · {wijziging.menuId}
                </p>
                {wijziging.groteWijziging && <span className="mw-big">{TEKST.big}</span>}
                {wijziging.afwijsReden && <p className="mw-line">Reden: {wijziging.afwijsReden}</p>}

                {wijziging.status === 'in_controle' && (
                  <div className="mw-actions">
                    <button
                      type="button"
                      className="mw-approve"
                      disabled={bezig}
                      onClick={() => beoordeel(wijziging, 'goedkeuren', '')}
                    >
                      {TEKST.approve}
                    </button>
                    <button
                      type="button"
                      className="mw-reject"
                      disabled={bezig}
                      onClick={() => {
                        setAfwijzen(wijziging.wijzigingId)
                        setReden('')
                      }}
                    >
                      {TEKST.reject}
                    </button>
                  </div>
                )}

                {afwijzen === wijziging.wijzigingId && (
                  <form
                    className="mw-reject-form"
                    onSubmit={(event) => {
                      event.preventDefault()
                      if (!reden.trim()) {
                        setFout(TEKST.reasonRequired)
                        return
                      }
                      beoordeel(wijziging, 'afwijzen', reden.trim())
                    }}
                  >
                    <label className="mw-label" htmlFor={`reden-${wijziging.wijzigingId}`}>
                      {TEKST.reason}
                    </label>
                    <input
                      className="mw-input"
                      id={`reden-${wijziging.wijzigingId}`}
                      type="text"
                      value={reden}
                      onChange={(event) => setReden(event.target.value)}
                    />
                    <div className="mw-actions">
                      <button type="submit" className="mw-reject" disabled={bezig}>
                        {TEKST.confirmReject}
                      </button>
                      <button
                        type="button"
                        className="mw-filter"
                        onClick={() => {
                          setAfwijzen(null)
                          setReden('')
                        }}
                      >
                        {TEKST.cancel}
                      </button>
                    </div>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
