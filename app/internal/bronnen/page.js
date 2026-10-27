'use client'

// BE-31 (#74) — "Bronnen beoordelen" on its approved address /internal/bronnen.
// One screen with two panes: the real open work on the left, the detail of
// exactly one chosen task on the right. Nothing is copied: the same triage API
// (BE-24) and the same batch API (BE-25) feed it, and the same confirmation
// route writes.
//
// What counts as work is decided in one pure, tested place
// (src/lib/sourceReview.js): one task per restaurant, built from its newest
// batch result (a certain result or a doubt result), plus open proposals and
// sources that ask attention. Dead ends and "Nog niet gecontroleerd" are NOT
// work here; those restaurants live in Dekking (owner decision 2026-10-27, Lead
// review #6439131777).
//
// The age of a result stays visible and "Opnieuw controleren" reuses the
// existing batch analysis (10 per batch, 25 per day, only while this page is
// open). "Oude resultaten opruimen" closes results by hand through the existing
// job row's field_evidence (like BE-30, no migration); nothing is deleted.
//
// The old /internal/source-triage and /internal/source-triage/batch addresses
// answer with a 308 (next.config.js). The technical names of tables, APIs and
// ids are unchanged.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import InternalNav from '@/src/components/InternalNav'
import useBatchProcessing from '@/src/components/useBatchProcessing'
import BronnenView from './BronnenView'
import { BRONNEN_HREF, CHECK_COPY, selectTasks, countTasks, filterTasks, effectiveTaskFilter, aiReadReady } from '@/src/lib/sourceReview'
import { readFollowUp, followUpForEntry } from '@/src/lib/sourceTriage'

const TRIAGE_API = '/api/internal/v1/source-triage'
const BATCH_API = '/api/internal/v1/batch-analysis'
// BE-33 (#79, criterion 1): the existing AI status (same flag, key and month
// counter as "Lees met AI"). It only decides whether an image/scan row may
// offer the AI reading; a failed request keeps that row on the manual route.
const AI_API = '/api/internal/v1/menu-ai-import'
// The same bound the batch overview itself uses for its recent batches.
const BATCH_DETAIL_LIMIT = 10
const LOAD_ERROR = 'Bronnen beoordelen kon niet worden geladen.'

function newBatchId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : null
}

export default function BronnenPage() {
  const router = useRouter()
  const [session, setSession] = useState(undefined)
  const [triage, setTriage] = useState(null)
  const [details, setDetails] = useState([])
  const [error, setError] = useState(null)
  const [batchWarning, setBatchWarning] = useState(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('all')
  const [selectedId, setSelectedId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  // "Oude resultaten opruimen" (review point 6): the picked tasks and the one
  // confirmation that names the number.
  const [picked, setPicked] = useState(() => new Set())
  const [cleanup, setCleanup] = useState(null)
  // "Opnieuw controleren" runs the existing batch analysis while this page is
  // open, exactly like the batch screen.
  const [recheckBatchId, setRecheckBatchId] = useState(null)
  // BE-33 (#79): AI availability for the image/scan row step; null until the
  // status request answers, and null stays "not available" (manual route).
  const [aiStatus, setAiStatus] = useState(null)
  const headingRef = useRef(null)
  const focusDetail = useRef(false)
  const feedbackRef = useRef(null)
  const focusFeedback = useRef(false)

  useEffect(() => {
    const supabase = getSupabaseBrowser()
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace('/internal/login')
      else setSession(data.session)
    })
  }, [router])

  const token = session && session.access_token

  const load = useCallback(
    async (accessToken, { refresh = false } = {}) => {
      if (!refresh) {
        setLoading(true)
        setError(null)
      }
      try {
        const auth = { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' }
        const [triageRes, overviewRes, aiRes] = await Promise.all([
          fetch(TRIAGE_API, auth).catch(() => null),
          fetch(BATCH_API, auth).catch(() => null),
          fetch(AI_API, auth).catch(() => null),
        ])
        // AI is only offered for an image/scan when the same status endpoint
        // says it is on and the budget allows a call (BE-33 #79).
        if (aiRes && aiRes.ok) {
          const aiBody = await aiRes.json().catch(() => null)
          setAiStatus(aiBody)
        } else {
          setAiStatus(null)
        }
        if (!triageRes || !overviewRes) {
          if (!refresh) setError(LOAD_ERROR)
          return false
        }
        const triageBody = await triageRes.json().catch(() => ({}))
        if (!triageRes.ok || !Array.isArray(triageBody.restaurants)) {
          if (!refresh) setError(triageBody.error || LOAD_ERROR)
          return false
        }
        setTriage(triageBody)
        const overviewBody = await overviewRes.json().catch(() => ({}))
        // One detail per recent batch: the rows of the batch are the same rows,
        // not a summary that could disagree with the confirmation route.
        const recent = overviewRes.ok && Array.isArray(overviewBody.recent_batches) ? overviewBody.recent_batches : []
        const loaded = await Promise.all(
          recent.slice(0, BATCH_DETAIL_LIMIT).map(async (batch) => {
            try {
              const res = await fetch(`${BATCH_API}?batch=${encodeURIComponent(batch.id)}`, auth)
              if (!res.ok) return null
              const body = await res.json().catch(() => null)
              return body && body.detail ? body.detail : null
            } catch {
              return null
            }
          }),
        )
        const found = loaded.filter(Boolean)
        setDetails(found)
        setBatchWarning(
          recent.length > 0 && found.length < Math.min(recent.length, BATCH_DETAIL_LIMIT)
            ? 'Niet elke batch kon worden geladen; de lijst is daardoor korter dan de werkvoorraad.'
            : null,
        )
        setError(null)
        return true
      } catch {
        if (!refresh) setError(LOAD_ERROR)
        return false
      } finally {
        if (!refresh) setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    if (token) load(token)
  }, [token, load])

  // One batch detail through the existing GET: used for "Opnieuw controleren".
  const fetchDetail = useCallback(async (accessToken, batchId) => {
    if (!accessToken || !batchId) return null
    try {
      const res = await fetch(`${BATCH_API}?batch=${encodeURIComponent(batchId)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      })
      if (!res.ok) return null
      const body = await res.json().catch(() => null)
      return body && body.detail ? body : null
    } catch {
      return null
    }
  }, [])

  useBatchProcessing({
    token,
    batchId: recheckBatchId,
    enabled: Boolean(recheckBatchId),
    onTick: async (id) => {
      const body = await fetchDetail(token, id)
      await load(token, { refresh: true })
      return body
    },
  })

  const entries = useMemo(() => (triage && triage.restaurants) || [], [triage])
  const aiReady = aiReadReady(aiStatus)
  // The age of a result is calculated once per load, with the browser's clock.
  const tasks = useMemo(
    () => selectTasks({ entries, batchDetails: details, returnTo: BRONNEN_HREF, now: new Date(), aiReady }),
    [entries, details, aiReady],
  )
  const counts = useMemo(() => countTasks(tasks), [tasks])
  const activeFilter = effectiveTaskFilter(filter)
  const visible = useMemo(() => filterTasks(tasks, activeFilter), [tasks, activeFilter])
  const selected = tasks.find((task) => task.id === selectedId) || null

  // #59 Lead review 6319894232 (R4/R5): the image/scan follow-up stays page
  // context, never a stored status. It attaches only to the restaurant the link
  // named; anything else is a page-level note.
  const [search, setSearch] = useState('')
  useEffect(() => {
    setSearch(window.location.search)
  }, [])
  const followUpContext = useMemo(() => readFollowUp(search), [search])
  const detailFollowUp = useMemo(
    () => followUpForEntry(followUpContext, selected && selected.entry ? selected.entry : null),
    [followUpContext, selected],
  )
  const bannerFollowUp = followUpContext && !detailFollowUp ? followUpContext.followUp : null

  // A deep link keeps working: ?batch=<id> opens the task whose newest result
  // came from that batch, ?restaurant=<id> opens the task of that restaurant
  // (proposal, attention or its batch result).
  useEffect(() => {
    if (selectedId || tasks.length === 0) return
    const params = new URLSearchParams(window.location.search)
    const batch = params.get('batch')
    const restaurant = params.get('restaurant')
    if (batch) {
      const match = tasks.find(
        (task) => task.kind === 'batch' && (task.batchId === batch || (task.batchIds || []).includes(batch)),
      )
      // An older batch is not among the recent ones shown here: keep the old
      // deeplink usable by opening the existing batch screen for exactly that id.
      if (match) setSelectedId(match.id)
      else router.replace(`/internal/bronnen/batch?batch=${encodeURIComponent(batch)}`)
      return
    }
    if (restaurant) {
      const match = tasks.find(
        (task) =>
          (task.restaurantId && task.restaurantId === restaurant) ||
          (task.rows && task.rows.some((row) => row.restaurant && String(row.restaurant.id) === restaurant)),
      )
      if (match) setSelectedId(match.id)
    }
  }, [tasks, selectedId, router])

  useEffect(() => {
    if (focusDetail.current && headingRef.current) {
      focusDetail.current = false
      headingRef.current.focus()
    }
  }, [selectedId])

  useEffect(() => {
    if (message && focusFeedback.current && feedbackRef.current) {
      focusFeedback.current = false
      feedbackRef.current.focus()
    }
  }, [message])

  function select(id) {
    setMessage(null)
    focusDetail.current = true
    setSelectedId(id)
    const task = tasks.find((item) => item.id === id)
    if (task && task.kind === 'batch') {
      const url = new URL(window.location.href)
      url.searchParams.set('batch', task.batchId)
      url.searchParams.delete('restaurant')
      window.history.replaceState(null, '', url)
    }
  }

  function clearSelection() {
    setSelectedId(null)
    const url = new URL(window.location.href)
    url.searchParams.delete('batch')
    url.searchParams.delete('restaurant')
    window.history.replaceState(null, '', url)
  }

  // ── Opnieuw controleren (review point 5) ───────────────────────────────────
  // The existing batch analysis for exactly this URL: same POST, same limits
  // (10 per batch, 25 per day) and the same rule that it only runs while this
  // page is open. Nothing is published and nothing expires by itself.
  async function recheck(row) {
    const url = row && (row.url || row.foundUrl)
    if (!url) return
    const batchId = newBatchId()
    if (!batchId) {
      setMessage({ tone: 'error', text: 'Deze browser kan geen controle starten.' })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(BATCH_API, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_id: batchId, urls: [url] }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage({ tone: 'error', text: body.error || 'De controle kon niet worden gestart.' })
        return
      }
      setRecheckBatchId(batchId)
      setMessage({ tone: 'notice', text: `${CHECK_COPY.running}. ${CHECK_COPY.keepOpen}` })
      await load(token, { refresh: true })
    } catch {
      setMessage({ tone: 'error', text: 'De controle kon niet worden gestart.' })
    } finally {
      focusFeedback.current = true
      setBusy(false)
    }
  }

  // ── Oude resultaten opruimen (review point 6) ──────────────────────────────
  // The picked tasks, or all of them when none is picked, are closed by hand
  // through the existing job rows. One confirmation names the number, nothing
  // is deleted and the record stays.
  const pickable = useMemo(() => tasks.filter((task) => task.kind === 'batch'), [tasks])
  // BE-32 (#75, criterion 7): "Alle N opruimen" counts the RESULTS it closes,
  // not the tasks that carry them.
  const pickableJobCount = useMemo(
    () => new Set(pickable.flatMap((task) => task.handledJobIds || [])).size,
    [pickable],
  )

  useEffect(() => {
    // A closed task can no longer be picked.
    setPicked((prev) => {
      const ids = new Set(pickable.map((task) => task.id))
      const next = new Set([...prev].filter((id) => ids.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [pickable])

  function togglePick(id) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function pickAll() {
    setPicked((prev) => (prev.size === pickable.length ? new Set() : new Set(pickable.map((task) => task.id))))
  }

  function startCleanup() {
    const chosen = pickable.filter((task) => picked.has(task.id))
    const all = chosen.length === 0
    const targets = all ? pickable : chosen
    const jobIds = [...new Set(targets.flatMap((task) => task.handledJobIds || []))]
    if (jobIds.length === 0) {
      setMessage({ tone: 'notice', text: 'Er zijn geen oude batchresultaten om op te ruimen.' })
      return
    }
    setMessage(null)
    // BE-32 (#75, criterion 7): `all` travels with the confirmation so the
    // dialog can say out loud that it takes every result, not a selection.
    setCleanup({ jobIds, count: jobIds.length, taskCount: targets.length, all })
  }

  async function confirmCleanup() {
    if (!cleanup) return
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(`${BATCH_API}/handled`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_ids: cleanup.jobIds }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage({ tone: 'error', text: body.error || 'De resultaten konden niet worden afgehandeld.' })
        return
      }
      const closed = (Number(body.handled) || 0) + (Number(body.already) || 0)
      const when = body.at ? new Date(body.at) : null
      const on = when && !Number.isNaN(when.getTime()) ? when.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' }) : null
      setCleanup(null)
      setPicked(new Set())
      const refreshed = await load(token, { refresh: true })
      setMessage({
        tone: refreshed ? 'success' : 'notice',
        text:
          `${closed} ${closed === 1 ? 'resultaat' : 'resultaten'} afgehandeld${on ? ` op ${on}` : ''}. ` +
          `${CHECK_COPY.cleanupHint}${refreshed ? '' : ' De lijst kon niet worden vernieuwd; herlaad de pagina.'}`,
      })
    } catch {
      setMessage({ tone: 'error', text: 'De resultaten konden niet worden afgehandeld.' })
    } finally {
      focusFeedback.current = true
      setBusy(false)
    }
  }

  // One write through an existing route, then a reload of the same lists. The
  // message reports the real outcome: saved and refreshed, saved but not
  // refreshed, or not saved.
  async function postAndReload(url, payload, successText) {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage({ tone: 'error', text: body.error || 'De actie kon niet worden opgeslagen.' })
        return false
      }
      const refreshed = await load(token, { refresh: true })
      setMessage({
        tone: refreshed ? 'success' : 'notice',
        text: refreshed ? successText : `${successText} De lijst kon niet worden vernieuwd; herlaad de pagina.`,
      })
      return true
    } catch {
      setMessage({ tone: 'error', text: 'De actie kon niet worden opgeslagen.' })
      return false
    } finally {
      focusFeedback.current = true
      setBusy(false)
    }
  }

  // The existing confirmation route of BE-25 — the same call the batch page
  // makes, for exactly this job. A grouped task can span batches, so the row's
  // own batch is used, never the task's.
  function confirmRow(task, row) {
    if (!task || task.kind !== 'batch' || !row || !row.jobId) return Promise.resolve(false)
    const batchId = row.batchId || task.batchId
    if (!batchId) return Promise.resolve(false)
    return postAndReload(
      `${BATCH_API}/${encodeURIComponent(batchId)}/confirm`,
      { job_ids: [row.jobId] },
      'Bron bevestigd na jouw controle. Er is niets gepubliceerd.',
    )
  }

  function createProposal(payload) {
    return postAndReload(
      `${TRIAGE_API}/proposals`,
      payload,
      'Voorstel opgeslagen. Het wacht nu op een besluit; er is niets gepubliceerd.',
    )
  }
  function decideProposal(id, decision, note) {
    return postAndReload(
      `${TRIAGE_API}/proposals/${encodeURIComponent(id)}/decision`,
      { decision, note },
      decision === 'accepted' ? 'Voorstel geaccepteerd. Er is niets automatisch doorgevoerd.' : 'Voorstel afgewezen.',
    )
  }

  if (session === undefined) {
    return (
      <div className="di-page">
        <main className="di-main brn-main">Laden…</main>
      </div>
    )
  }

  return (
    <div className="di-page">
      <main className="di-main brn-main">
        <InternalNav accessToken={token} />
        <BronnenView
          triage={triage}
          counts={counts}
          loading={loading}
          error={error}
          warning={batchWarning}
          message={message}
          filter={activeFilter}
          onFilter={setFilter}
          tasks={visible}
          totalTasks={tasks.length}
          selected={selected}
          onSelect={select}
          onClear={clearSelection}
          busy={busy}
          headingRef={headingRef}
          feedbackRef={feedbackRef}
          proposalsAvailable={Boolean(triage && triage.proposals_available)}
          onCreateProposal={createProposal}
          onDecideProposal={decideProposal}
          onConfirmRow={confirmRow}
          onRecheckRow={recheck}
          picked={picked}
          pickableCount={pickable.length}
          pickableJobCount={pickableJobCount}
          onTogglePick={togglePick}
          onPickAll={pickAll}
          cleanup={cleanup}
          onStartCleanup={startCleanup}
          onConfirmCleanup={confirmCleanup}
          onCancelCleanup={() => setCleanup(null)}
          followUp={detailFollowUp}
          followUpBanner={bannerFollowUp}
        />
      </main>
    </div>
  )
}
