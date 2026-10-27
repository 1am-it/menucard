'use client'

// BE-31 (#74) — "Bronnen beoordelen" on its approved address /internal/bronnen.
// One screen with two panes: the real open work on the left, the detail of
// exactly one chosen task on the right. Nothing is copied: the same triage API
// (BE-24) and the same batch API (BE-25) feed it, and the same confirmation
// route writes.
//
// What counts as work is decided in one pure, tested place
// (src/lib/sourceReview.js): open proposals, sources asking attention and batch
// results with a human action. "Nog niet gecontroleerd" is NOT work here; those
// restaurants live in Dekking (owner decision 2026-10-27).
//
// The old /internal/source-triage and /internal/source-triage/batch addresses
// answer with a 308 (next.config.js). The technical names of tables, APIs and
// ids are unchanged.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import InternalNav from '@/src/components/InternalNav'
import BronnenView from './BronnenView'
import { BRONNEN_HREF, selectTasks, countTasks, filterTasks, effectiveTaskFilter } from '@/src/lib/sourceReview'
import { readFollowUp, followUpForEntry } from '@/src/lib/sourceTriage'

const TRIAGE_API = '/api/internal/v1/source-triage'
const BATCH_API = '/api/internal/v1/batch-analysis'
// The same bound the batch overview itself uses for its recent batches.
const BATCH_DETAIL_LIMIT = 10
const LOAD_ERROR = 'Bronnen beoordelen kon niet worden geladen.'

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
        const [triageRes, overviewRes] = await Promise.all([
          fetch(TRIAGE_API, auth).catch(() => null),
          fetch(BATCH_API, auth).catch(() => null),
        ])
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

  const entries = useMemo(() => (triage && triage.restaurants) || [], [triage])
  const tasks = useMemo(
    () => selectTasks({ entries, batchDetails: details, returnTo: BRONNEN_HREF }),
    [entries, details],
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

  // A deep link keeps working: ?batch=<id> opens that batch task, ?restaurant=<id>
  // opens the task of that restaurant (proposal, attention or its batch row).
  useEffect(() => {
    if (selectedId || tasks.length === 0) return
    const params = new URLSearchParams(window.location.search)
    const batch = params.get('batch')
    const restaurant = params.get('restaurant')
    if (batch) {
      const match = tasks.find((task) => task.kind === 'batch' && task.batchId === batch)
      if (match) setSelectedId(match.id)
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
  }, [tasks, selectedId])

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
  // makes, for exactly this job.
  function confirmRow(task, row) {
    if (!task || task.kind !== 'batch' || !row || !row.jobId) return Promise.resolve(false)
    return postAndReload(
      `${BATCH_API}/${encodeURIComponent(task.batchId)}/confirm`,
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
          followUp={detailFollowUp}
          followUpBanner={bannerFollowUp}
        />
      </main>
    </div>
  )
}
