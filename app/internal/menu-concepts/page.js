'use client'

// Menuconcepten beoordelen (BE-17 v1) — under Werkvoorraad. The latest
// version of every internal menu concept saved from Batchanalyse, waiting
// ones first, with restaurant, source, time, status and attention counts.
// Internal only (server-checked); nothing is published from here.
// Contract: planning/specs/tickets/be-17-menu-proposal-snapshot-foundation.md,
// decision 016; visual reference: docs/mockups/menu-concept-review-v1.png.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import InternalNav from '@/src/components/InternalNav'
import { ConceptList } from './MenuConceptsView'

const API = '/api/internal/v1/menu-concepts'
const LOAD_ERROR = 'De menuconcepten konden niet worden geladen.'

export default function MenuConceptsPage() {
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
  useEffect(() => {
    if (!token) return
    fetch(API, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) setLoadError(body.error || LOAD_ERROR)
        else setData(body)
      })
      .catch(() => setLoadError(LOAD_ERROR))
  }, [token])

  if (session === undefined) {
    return (
      <div className="di-page">
        <main className="di-main bta-main">Laden…</main>
      </div>
    )
  }

  return (
    <div className="di-page mcr-page">
      <main className="di-main bta-main">
        <InternalNav accessToken={session.access_token} />
        <ConceptList data={data} loadError={loadError} />
      </main>
    </div>
  )
}
