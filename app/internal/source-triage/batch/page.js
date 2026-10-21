'use client'

// Batchanalyse (BE-25 fase 2) — under Werkvoorraad / Bronnen beoordelen.
// A staff member pastes at most 10 restaurant URLs and chooses "Analyse
// starten" once. The starter's open page can drive the next URL, one at a
// time; the same claim/lease handler also has an explicit service-worker
// entry (no cron is installed). Closing the page merely pauses this browser
// loop; a service worker may resume the same jobs without double processing.
// Colleagues can view a batch read-only and never see who started it. Every
// result stays a reviewable result: "Bevestig bron" records an accepted BE-24
// proposal after a short human confirmation, nothing is published. The visible
// states live in ./BatchAnalysisView.js.
// Contract: planning/specs/tickets/be-25-batch-source-analysis-from-triage.md;
// visual reference: docs/mockups/be-25-batch-analysis-*-v2.png (text wins).

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import InternalNav from '@/src/components/InternalNav'
import BatchAnalysisView from './BatchAnalysisView'

const LOAD_ERROR = 'De batchanalyse kon niet worden geladen.'
const API = '/api/internal/v1/batch-analysis'

function newBatchId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : null
}

export default function BatchAnalysisPage() {
  const router = useRouter()
  const [session, setSession] = useState(undefined)
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [focusItem, setFocusItem] = useState(null)
  const [showInput, setShowInput] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState(null)
  const [message, setMessage] = useState(null)
  const [confirming, setConfirming] = useState(null)
  const [notice, setNotice] = useState('')
  const loopToken = useRef(0)

  useEffect(() => {
    const supabase = getSupabaseBrowser()
    supabase.auth.getSession().then(({ data: sessionData }) => {
      if (!sessionData.session) router.replace('/internal/login')
      else setSession(sessionData.session)
    })
    const params = new URLSearchParams(window.location.search)
    const fromUrl = params.get('batch')
    const item = Number(params.get('item'))
    if (fromUrl) setSelectedId(fromUrl)
    if (Number.isInteger(item) && item > 0) setFocusItem(item)
  }, [router])

  const token = session && session.access_token

  const load = useCallback(
    async (batchId) => {
      if (!token) return null
      try {
        const qs = batchId ? `?batch=${encodeURIComponent(batchId)}` : ''
        const res = await fetch(`${API}${qs}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          setLoadError(body.error || LOAD_ERROR)
          return null
        }
        setLoadError(null)
        setData(body)
        return body
      } catch {
        setLoadError(LOAD_ERROR)
        return null
      }
    },
    [token]
  )

  useEffect(() => {
    if (token) load(selectedId)
  }, [token, selectedId, load])

  const detail = data && data.detail
  const ownOpenBatchId = data && data.own_open_batch_id
  const viewing = showInput ? null : detail

  // Keep the address bar in step with the batch on screen (shareable with
  // colleagues, who then see it read-only).
  useEffect(() => {
    const url = new URL(window.location.href)
    if (viewing) url.searchParams.set('batch', viewing.batch.id)
    else url.searchParams.delete('batch')
    window.history.replaceState(null, '', url)
  }, [viewing])

  // Page-bound processing: only the starter's open page, one job per call.
  const processing = Boolean(viewing && viewing.batch.is_starter && !viewing.batch.closed_at)
  const processingBatchId = processing ? viewing.batch.id : null
  useEffect(() => {
    if (!processingBatchId || !token) return undefined
    const myToken = ++loopToken.current
    let timer = null
    const alive = () => loopToken.current === myToken
    async function step() {
      if (!alive()) return
      let outcome = 'done'
      let retryAt = null
      try {
        const res = await fetch(`${API}/${processingBatchId}/process`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) outcome = res.status === 403 ? 'stop' : 'error'
        else {
          outcome = body.outcome
          retryAt = body.retry_at
        }
      } catch {
        outcome = 'error'
      }
      if (!alive()) return
      const fresh = await load(processingBatchId)
      if (fresh && fresh.detail) {
        const s = fresh.detail.summary
        setNotice(`${s.done} van ${s.total} klaar`)
      }
      if (!alive() || outcome === 'stop' || outcome === 'done' || (fresh && fresh.detail && fresh.detail.batch.closed_at)) return
      let wait = 400
      if (outcome === 'busy' || outcome === 'waiting') {
        const until = retryAt ? new Date(retryAt).getTime() - Date.now() : 5000
        wait = Math.min(30000, Math.max(3000, until))
      } else if (outcome === 'error') wait = 10000
      timer = setTimeout(step, wait)
    }
    step()
    return () => {
      loopToken.current += 1
      if (timer) clearTimeout(timer)
    }
  }, [processingBatchId, token, load])

  // `reanalyze`: the explicit "Opnieuw analyseren" click — one URL, a fresh
  // analysis through enqueue_source_reanalysis (0017), never the 7-day reuse.
  async function startBatch(urls, { reanalyze = false } = {}) {
    const batchId = newBatchId()
    if (!batchId) {
      setActionError('Deze browser kan geen batch starten.')
      return
    }
    setBusy(true)
    setActionError(null)
    try {
      const res = await fetch(reanalyze ? `${API}/reanalyze` : API, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(reanalyze ? { batch_id: batchId, url: urls[0] } : { batch_id: batchId, urls }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const text = body.error || 'De batch kon niet worden gestart.'
        setActionError(text)
        if (reanalyze) setMessage({ tone: 'error', text })
        return
      }
      setText('')
      setShowInput(false)
      setSelectedId(body.batch.id)
    } catch {
      setActionError('De batch kon niet worden gestart.')
    } finally {
      setBusy(false)
    }
  }

  async function confirm(jobIds, structureReviews) {
    if (!viewing) return
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(`${API}/${viewing.batch.id}/confirm`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(
          structureReviews && structureReviews.length > 0 ? { job_ids: jobIds, structure_reviews: structureReviews } : { job_ids: jobIds }
        ),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage({ tone: 'error', text: body.error || 'De bevestiging kon niet worden opgeslagen.' })
      } else {
        const failed = (body.results || []).filter((r) => !r.ok)
        const openExists = failed.some((r) => r.reason === 'open_proposal_exists' || r.reason === 'left_open')
        // The server re-checks the human structure review against the stored
        // receipt; a stale or incomplete review is reported concretely.
        const structureIssue = failed.find((r) =>
          [
            'structure_unreviewed',
            'structure_unknown_section',
            'structure_invalid',
            'structure_required',
            'structure_sections_unknown',
            'structure_already_reviewed',
            'structure_conflict',
            'structure_save_failed',
            'structure_store_unavailable',
            'receipt_mismatch',
            'receipt_unavailable',
            'receipt_binding_mismatch',
          ].includes(r.reason)
        )
        const detail = structureIssue
          ? ' De rubriekcontrole is niet opgeslagen; controleer elke onzekere rubriek opnieuw.'
          : openExists
            ? ' Voor een restaurant staat al een open voorstel; beoordeel dat in Bronnen beoordelen.'
            : ''
        setMessage(
          failed.length === 0
            ? { tone: 'success', text: `${body.confirmed} ${body.confirmed === 1 ? 'bron' : 'bronnen'} bevestigd. Er is niets gepubliceerd.` }
            : { tone: 'notice', text: `${body.confirmed} bevestigd, ${failed.length} niet.${detail}` }
        )
      }
      setConfirming(null)
      await load(viewing.batch.id)
    } catch {
      setMessage({ tone: 'error', text: 'De bevestiging kon niet worden opgeslagen.' })
    } finally {
      setBusy(false)
    }
  }

  async function rerun(url, action) {
    if (ownOpenBatchId || !url) return
    await startBatch([url], { reanalyze: action === 'reanalyze' })
  }

  // "Concept opslaan": an internal menu concept (BE-17 proposal) for a
  // confirmed source. The server re-checks every blocker; nothing is public.
  async function saveConcept(jobId, edits) {
    if (!viewing) return
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(`${API}/${viewing.batch.id}/concept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, edits }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage({ tone: 'error', text: body.error || 'Het concept kon niet worden opgeslagen.' })
      } else {
        setMessage({
          tone: 'success',
          text:
            body.concept && body.concept.unchanged
              ? `Het concept is ongewijzigd (versie ${body.concept.version}). Er is niets gepubliceerd.`
              : `Concept opgeslagen als versie ${body.concept && body.concept.version}. Het wacht op interne controle; er is niets gepubliceerd.`,
        })
        await load(viewing.batch.id)
      }
    } catch {
      setMessage({ tone: 'error', text: 'Het concept kon niet worden opgeslagen.' })
    } finally {
      setBusy(false)
    }
  }

  function adjust(url) {
    if (ownOpenBatchId) return
    setText(url)
    setShowInput(true)
    setActionError(null)
  }

  function selectBatch(id) {
    setShowInput(false)
    setMessage(null)
    setConfirming(null)
    setFocusItem(null)
    setSelectedId(id)
  }

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
        <BatchAnalysisView
          data={data}
          loadError={loadError}
          message={message}
          viewing={viewing}
          focusItem={focusItem}
          ownOpenBatchId={ownOpenBatchId}
          busy={busy}
          confirming={confirming}
          setConfirming={setConfirming}
          onConfirm={confirm}
          onRerun={rerun}
          onAdjust={adjust}
          onSaveConcept={saveConcept}
          onNew={() => {
            setShowInput(true)
            setMessage(null)
          }}
          notice={notice}
          text={text}
          setText={setText}
          onStart={startBatch}
          actionError={actionError}
          onShowOpen={() => selectBatch(ownOpenBatchId)}
          onSelect={selectBatch}
        />
      </main>
    </div>
  )
}
