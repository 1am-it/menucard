'use client'

// Beoordeel menuconcept (BE-17 v1). One internal menu concept version: the
// current menu, the original extraction and the concept value side by side,
// attention points open, safe dishes collapsed. A correction becomes a new
// immutable version; "Concept goedkeuren" and "Concept afwijzen" record one
// review decision on the latest version. Every rule is re-checked on the
// server; approval stays internal and publishes nothing.

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import InternalNav from '@/src/components/InternalNav'
import { ConceptReview } from '../MenuConceptsView'

const API = '/api/internal/v1/menu-concepts'
const LOAD_ERROR = 'Het menuconcept kon niet worden geladen.'

export default function MenuConceptReviewPage() {
  const router = useRouter()
  const { id } = useParams()
  const [session, setSession] = useState(undefined)
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getSupabaseBrowser()
      .auth.getSession()
      .then(({ data: sessionData }) => {
        if (!sessionData.session) router.replace('/internal/login')
        else setSession(sessionData.session)
      })
  }, [router])

  const token = session && session.access_token
  const load = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch(`${API}/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setLoadError(body.error || LOAD_ERROR)
        setData(null)
      } else {
        setLoadError(null)
        setData(body)
      }
    } catch {
      setLoadError(LOAD_ERROR)
    }
  }, [token, id])

  useEffect(() => {
    load()
  }, [load])

  async function post(path, payload) {
    const res = await fetch(`${API}/${encodeURIComponent(id)}/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return { res, body: await res.json().catch(() => ({})) }
  }

  async function saveVersion(expectedVersion, edits) {
    setBusy(true)
    setMessage(null)
    try {
      const { res, body } = await post('versions', { expected_version: expectedVersion, edits })
      if (!res.ok) {
        setMessage({ tone: 'error', text: body.error || 'De correcties konden niet worden opgeslagen.' })
      } else if (body.concept && body.concept.unchanged) {
        setMessage({ tone: 'neutral', text: `Geen wijziging: de inhoud is gelijk aan versie ${body.concept.version}. Er is geen nieuwe versie gemaakt.` })
      } else {
        setMessage({ tone: 'success', text: `Correcties opgeslagen als versie ${body.concept.version}. Er is niets gepubliceerd.` })
        router.replace(`/internal/menu-concepts/${body.concept.id}`)
        return
      }
    } catch {
      setMessage({ tone: 'error', text: 'De correcties konden niet worden opgeslagen.' })
    } finally {
      setBusy(false)
    }
  }

  async function decide(expectedVersion, decision, reason, note) {
    setBusy(true)
    setMessage(null)
    try {
      const { res, body } = await post('decision', { expected_version: expectedVersion, decision, reason: reason || undefined, note: note || undefined })
      if (!res.ok) {
        setMessage({ tone: 'error', text: body.error || 'Het besluit kon niet worden vastgelegd.' })
      } else if (decision === 'approved_internal') {
        setMessage({
          tone: 'success',
          text: body.review && body.review.created ? `Versie ${expectedVersion} is intern goedgekeurd. Er is niets gepubliceerd.` : `Versie ${expectedVersion} was al intern goedgekeurd.`,
        })
      } else {
        setMessage({ tone: 'success', text: body.review && body.review.created ? `Versie ${expectedVersion} is afgewezen.` : `Versie ${expectedVersion} was al afgewezen.` })
      }
      await load()
    } catch {
      setMessage({ tone: 'error', text: 'Het besluit kon niet worden vastgelegd.' })
    } finally {
      setBusy(false)
    }
  }

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
        <ConceptReview key={data ? data.concept.id : 'loading'} data={data} loadError={loadError} message={message} busy={busy} onSaveVersion={saveVersion} onDecide={decide} />
      </main>
    </div>
  )
}
