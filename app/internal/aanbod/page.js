'use client'

// BE-55 stap B, deel 4 (#135) — /internal/aanbod, de interne werkvoorraad voor
// daghap en seizoensgerecht.
//
// Achter dezelfde poort als elke andere /internal-pagina: zonder sessie naar
// /internal/login, en de API weigert bovendien een account zonder de rol
// `internal` (401/403). Wat hier staat is tegengehouden (filter of meldingen)
// of gemeld aanbod, met per regel: restaurant, soort, naam, prijs, de reden en
// het aantal meldingen. Acties: goedkeuren (weer online), verwijderen (offline,
// de geschiedenis blijft) en het plaatsrecht van de houder afnemen of
// teruggeven. Niets hiervan publiceert een menukaart of een profiel.
//
// De opmaak staat in ./aanbod-beheer.css (BE-52), niet in globals.css.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import InternalNav from '@/src/components/InternalNav'
import AanbodBeheer from './AanbodBeheer'
import './aanbod-beheer.css'

const API = '/api/internal/v1/daghap/werkvoorraad'
const LOAD_ERROR = 'De werkvoorraad kon niet worden geladen.'

export default function AanbodBeheerPage() {
  const router = useRouter()
  const [session, setSession] = useState(undefined)
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState(null)

  useEffect(() => {
    getSupabaseBrowser()
      .auth.getSession()
      .then(({ data: sessionData }) => {
        if (!sessionData.session) router.replace('/internal/login')
        else setSession(sessionData.session)
      })
  }, [router])

  const token = session && session.access_token

  const laad = useCallback(() => {
    if (!token) return Promise.resolve()
    return fetch(API, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) setLoadError(body.message || body.error || LOAD_ERROR)
        else {
          setLoadError(null)
          setData(body)
        }
      })
      .catch(() => setLoadError(LOAD_ERROR))
  }, [token])

  useEffect(() => {
    laad()
  }, [laad])

  if (session === undefined) {
    return (
      <div className="di-page">
        <main className="di-main bta-main">Laden…</main>
      </div>
    )
  }

  return (
    <div className="di-page">
      <main className="di-main bta-main">
        <InternalNav accessToken={session.access_token} />
        <AanbodBeheer data={data} loadError={loadError} token={session.access_token} onChanged={laad} />
      </main>
    </div>
  )
}
