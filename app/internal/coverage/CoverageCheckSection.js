'use client'

// BE-31 (#74) — Dekking: "Nog niet gecontroleerd" (criterion 3). The restaurants
// without a usable source check live here now (not in Bronnen beoordelen), with
// their existing reason texts. You can select rows and then click
// "Controleer N geselecteerde", or check one row on its own. Both reuse the
// existing batch analysis — the same API, the same 10-per-batch and 25-per-day
// limits, and the same rule that it only runs while the page is open.
//
// The rows come from the same pure function as the result rows
// (src/lib/sourceReview.js), and the results use the same shared row component.

import { useCallback, useEffect, useMemo, useState } from 'react'
import SourceResultRow from '@/src/components/SourceResultRow'
import AiReadAction from '@/src/components/AiReadAction'
import useBatchProcessing from '@/src/components/useBatchProcessing'
import useAiReading from '@/src/components/useAiReading'
import {
  coverageRows,
  checkSelection,
  canStartCheck,
  rowForBatchItem,
  stepHref,
  aiReadReady,
  CHECK_COPY,
  COVERAGE_HREF,
  MANUAL_IMPORT_HREF,
  MAX_BATCH_URLS,
  DAILY_URL_LIMIT,
} from '@/src/lib/sourceReview'
import { costLine, originLabel, discoverySummary } from '@/src/lib/sourceDiscovery'
import {
  ROW_SEARCHING,
  countAiSearches,
  discoveryFailure,
  discoveryPlan,
  discoverySteps,
  updatedLabel,
} from '@/src/lib/discoveryProgress'

const TRIAGE_API = '/api/internal/v1/source-triage'
const BATCH_API = '/api/internal/v1/batch-analysis'
// BE-32 (#75): the same engine as "Zoek de bron voor mij".
const DISCOVERY_API = '/api/internal/v1/source-discovery'
// BE-33 (#79): the existing AI status; it decides the image/scan row step only.
const AI_API = '/api/internal/v1/menu-ai-import'
// The same bound the batch overview itself uses for its recent batches.
const BATCH_DETAIL_LIMIT = 10
// BE-34 (#81, criterion 4): one restaurant's search that takes longer than this
// is reported honestly as "duurde te lang" instead of waiting forever.
const DISCOVERY_TIMEOUT_MS = 120000

function newBatchId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : null
}

export default function CoverageCheckSection({ token, onUncheckedCount }) {
  const [entries, setEntries] = useState(null)
  const [details, setDetails] = useState([])
  const [daily, setDaily] = useState(null)
  const [selected, setSelected] = useState(() => new Set())
  const [activeBatch, setActiveBatch] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const [loadError, setLoadError] = useState(null)
  // BE-32 (#75): the result of "✨ Vind bronnen" — the summary, the honest
  // notices and the AI cost of this run.
  const [discovery, setDiscovery] = useState(null)
  const [discoveryBusy, setDiscoveryBusy] = useState(false)
  // BE-34 (#81, criterion 4): the run itself, so the screen can show the steps,
  // the row it is working on, the time it finished and an honest reason when it
  // stopped. One request per restaurant — the same engine, the same limits, the
  // same budget; only the progress is visible now.
  const [discoveryRun, setDiscoveryRun] = useState(null)
  // BE-33 (#79): AI availability for the image/scan row; null means "use the
  // manual route".
  const [aiStatus, setAiStatus] = useState(null)
  // BE-34 (#81): one click on "Lees met AI" starts the existing reading here and
  // the row shows its progress and outcome; the manual import is only the small
  // link "Liever zelf plakken".
  const aiRead = useAiReading({ token })

  const load = useCallback(async () => {
    if (!token) return
    const auth = { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }
    try {
      const [triageRes, overviewRes, aiRes] = await Promise.all([
        fetch(TRIAGE_API, auth),
        fetch(BATCH_API, auth),
        fetch(AI_API, auth).catch(() => null),
      ])
      setAiStatus(aiRes && aiRes.ok ? await aiRes.json().catch(() => null) : null)
      const triageBody = await triageRes.json().catch(() => ({}))
      const overviewBody = await overviewRes.json().catch(() => ({}))
      if (!triageRes.ok || !Array.isArray(triageBody.restaurants)) {
        setLoadError(triageBody.error || 'Nog niet gecontroleerd kon niet worden geladen.')
        return
      }
      setLoadError(null)
      setEntries(triageBody.restaurants)
      if (overviewRes.ok) setDaily(overviewBody.daily || null)
      // The newest result per restaurant is needed here too: a dead end
      // ("geen bruikbaar resultaat", robots/access block, "geen menukaart
      // gevonden") belongs to Dekking with its own reason and next step
      // (Lead review #6439131777). Same read, same bound, no new query.
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
      setDetails(loaded.filter(Boolean))
    } catch {
      setLoadError('Nog niet gecontroleerd kon niet worden geladen.')
    }
  }, [token])

  useEffect(() => {
    load()
  }, [load])

  const rows = useMemo(
    () => coverageRows(entries || [], { batchDetails: details, now: new Date(), aiReady: aiReadReady(aiStatus) }),
    [entries, details, aiStatus],
  )
  // Criterium 6: de tegel "nog niet gecontroleerd" toont dezelfde telling als
  // deze lijst — geen tweede schatting, en niets zolang de lijst niet geladen is.
  useEffect(() => {
    if (typeof onUncheckedCount === 'function' && Array.isArray(entries)) onUncheckedCount(rows.length)
  }, [rows, entries, onUncheckedCount])
  const remaining = daily && Number.isInteger(daily.used) ? Math.max(0, DAILY_URL_LIMIT - daily.used) : DAILY_URL_LIMIT


  const loadBatch = useCallback(
    async (batchId) => {
      if (!token) return null
      try {
        const res = await fetch(`${BATCH_API}?batch=${encodeURIComponent(batchId)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        if (!res.ok) return null
        const body = await res.json().catch(() => null)
        if (!body || !body.detail) return null
        setActiveBatch(body.detail)
        return body
      } catch {
        return null
      }
    },
    [token],
  )

  const started = Boolean(activeBatch && activeBatch.batch && !activeBatch.batch.closed_at)
  useBatchProcessing({ token, batchId: activeBatch ? activeBatch.batch.id : null, enabled: started, onTick: loadBatch })

  useEffect(() => {
    if (!activeBatch || !activeBatch.batch || !activeBatch.batch.closed_at) return
    // A finished check changes which restaurants still need one.
    load()
  }, [activeBatch, load])

  const selection = useMemo(() => checkSelection(rows, selected), [rows, selected])
  const startCheck = canStartCheck({ count: selection.count, remaining })

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function start(urls) {
    if (!urls || urls.length === 0) return
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
        body: JSON.stringify({ batch_id: batchId, urls }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage({ tone: 'error', text: body.error || 'De controle kon niet worden gestart.' })
        return
      }
      setSelected(new Set())
      setMessage({
        tone: 'success',
        text: `${urls.length} ${urls.length === 1 ? 'bron wordt' : 'bronnen worden'} gecontroleerd. ${CHECK_COPY.keepOpen}`,
      })
      await loadBatch(body.batch.id)
      await load()
    } catch {
      setMessage({ tone: 'error', text: 'De controle kon niet worden gestart.' })
    } finally {
      setBusy(false)
    }
  }

  if (entries === null && !loadError) {
    return <p className="brn-hint">Nog niet gecontroleerd wordt geladen…</p>
  }

  // BE-32 (#75, criterion 1/4): "✨ Vind bronnen" runs the engine for the
  // selection or for every row, then reloads so the proposals appear as rows.
  // BE-34 (#81, criterion 4): one request per restaurant, in order, so the steps
  // ("🌐 Websites 4 van 10") and the row the app is working on are real. The
  // engine, the limits and the budget are exactly the same as before.
  async function findSources(ids) {
    if (!token || !Array.isArray(ids) || ids.length === 0 || discoveryBusy) return
    const list = ids.slice(0, MAX_BATCH_URLS)
    const byId = new Map(rows.map((row) => [row.restaurantId, row]))
    const plan = discoveryPlan(list.map((id) => byId.get(id) || { restaurantId: id }))
    setDiscoveryBusy(true)
    setMessage(null)
    setDiscovery(null)
    setDiscoveryRun({
      phase: 'running',
      plan,
      done: 0,
      aiDone: 0,
      osmDone: false,
      currentId: list[0] || null,
      pendingIds: list,
      finishedAt: null,
      failure: null,
    })
    const results = []
    const messages = []
    let cost = 0
    let costKnown = false
    let monthly = null
    let failure = null
    for (const id of list) {
      setDiscoveryRun((prev) => (prev ? { ...prev, currentId: id } : prev))
      let timer = null
      try {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
        if (controller) timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS)
        const res = await fetch(DISCOVERY_API, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ restaurant_ids: [id] }),
          ...(controller ? { signal: controller.signal } : {}),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          failure = discoveryFailure({ status: res.status, error: body.error })
          break
        }
        if (Array.isArray(body.results)) results.push(...body.results)
        for (const text of Array.isArray(body.messages) ? body.messages : []) {
          if (typeof text === 'string' && !messages.includes(text)) messages.push(text)
        }
        if (body.cost && Number.isInteger(body.cost.eurCents)) {
          cost += body.cost.eurCents
          costKnown = true
        }
        if (body.monthly) monthly = body.monthly
      } catch (error) {
        failure = discoveryFailure({ timedOut: Boolean(error && error.name === 'AbortError') })
        break
      } finally {
        if (timer) clearTimeout(timer)
      }
      const aiDone = countAiSearches(results)
      setDiscoveryRun((prev) =>
        prev ? { ...prev, done: results.length, aiDone, osmDone: true, currentId: null } : prev,
      )
    }

    if (failure) {
      const done = new Set(results.map((result) => result.restaurantId))
      const pendingIds = list.filter((id) => !done.has(id))
      setDiscoveryRun((prev) =>
        prev ? { ...prev, phase: 'error', currentId: null, finishedAt: Date.now(), failure, pendingIds } : prev,
      )
    } else {
      setDiscoveryRun((prev) => (prev ? { ...prev, phase: 'done', currentId: null, finishedAt: Date.now() } : prev))
      setDiscovery({
        summary: discoverySummary({ results, costEurCents: costKnown ? cost : null }),
        messages,
        cost: { eurCents: costKnown ? cost : null, known: costKnown },
        monthly,
        attribution: null,
      })
      await load()
    }
    setDiscoveryBusy(false)
  }

  // A proposal is confirmed by the human, through the existing BE-24 decision
  // route. Nothing is published; the row then offers the existing check.
  async function confirmProposal(row) {
    if (!token || !row || !row.proposal || !row.proposal.id) return
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(`${TRIAGE_API}/proposals/${encodeURIComponent(row.proposal.id)}/decision`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'accepted' }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage({ tone: 'error', text: body.error || 'Het voorstel kon niet worden bevestigd.' })
        return
      }
      setMessage({
        tone: 'success',
        text: 'Voorstel bevestigd. Er is niets automatisch gepubliceerd: controleer nu de bron.',
      })
      await load()
    } catch {
      setMessage({ tone: 'error', text: 'Het voorstel kon niet worden bevestigd.' })
    } finally {
      setBusy(false)
    }
  }

  const discoveryIds = selected.size > 0 ? [...selected] : rows.map((row) => row.restaurantId)
  const discoveryLabel = `✨ Vind bronnen (${discoveryIds.length})`

  return (
    <section className="cov-check" aria-labelledby="cov-check-title">
      <div className="cov-check-head">
        <h2 id="cov-check-title" className="cov-check-title">
          Nog niet gecontroleerd ({rows.length})
        </h2>
        <div style={{ flex: 1 }} />
        {/* BE-32 (#75, criterion 1): the same engine as "Zoek de bron voor mij",
            for the selected rows — or for every row when none is selected. */}
        <button
          type="button"
          className="stg-btn-secondary cov-check-action"
          disabled={busy || discoveryBusy || rows.length === 0}
          onClick={() => findSources(discoveryIds)}
        >
          {discoveryBusy ? '✨ Bezig…' : discoveryLabel}
        </button>
        <button
          type="button"
          className="di-btn-primary cov-check-action"
          disabled={busy || !startCheck.ok}
          title={startCheck.reason || undefined}
          onClick={() => start(selection.urls)}
        >
          🔎 Controleer {selection.count} geselecteerde
        </button>
      </div>
      <p className="cov-check-meta">
        Maximaal {MAX_BATCH_URLS} per controle · vandaag nog {remaining} van {DAILY_URL_LIMIT} URL&apos;s.{' '}
        {CHECK_COPY.keepOpen}
      </p>
      {startCheck.reason && selection.selectedCount > 0 ? <p className="cov-check-meta">{startCheck.reason}</p> : null}
      {selection.skipped.length > 0 ? (
        <p className="cov-check-meta">
          Zonder website kan niet automatisch worden gecontroleerd: {selection.skipped.join(', ')}.
        </p>
      ) : null}
      {loadError ? <div className="di-banner di-banner-danger">{loadError}</div> : null}
      {message ? (
        <div className={message.tone === 'error' ? 'di-banner di-banner-danger' : 'di-banner di-banner-info'} role="status">
          {message.text}
        </div>
      ) : null}
      {discoveryRun ? (
        <div className="cov-progress" role="status" aria-live="polite">
          {(() => {
            const steps = discoverySteps({
              plan: discoveryRun.plan,
              done: discoveryRun.done,
              aiDone: discoveryRun.aiDone,
              osmDone: discoveryRun.osmDone,
            })
            return (
              <>
                <p className="cov-progress-line">{steps.line}</p>
                <div
                  className="cov-progress-bar"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={steps.percent}
                  aria-label="Voortgang van het zoeken"
                >
                  <span className="cov-progress-fill" style={{ width: `${steps.percent}%` }} />
                </div>
              </>
            )
          })()}
          {discoveryRun.phase === 'running' ? <p className="cov-check-meta">Even geduld; je hoeft deze pagina niet te verversen.</p> : null}
          {discoveryRun.phase === 'error' && discoveryRun.failure ? (
            <div className="di-banner di-banner-danger" role="alert">
              <span>{discoveryRun.failure.message}</span>
              {discoveryRun.failure.retryLabel && discoveryRun.pendingIds && discoveryRun.pendingIds.length > 0 ? (
                <button
                  type="button"
                  className="stg-btn-secondary cov-check-action"
                  disabled={discoveryBusy}
                  onClick={() => findSources(discoveryRun.pendingIds)}
                >
                  {discoveryRun.failure.retryLabel}
                </button>
              ) : null}
            </div>
          ) : null}
          {discoveryRun.phase === 'done' && updatedLabel(discoveryRun.finishedAt) ? (
            <p className="cov-check-meta">{updatedLabel(discoveryRun.finishedAt)}</p>
          ) : null}
        </div>
      ) : null}
      {discovery ? (
        <div className="cov-discovery" role="status">
          {discovery.summary ? <p className="cov-discovery-summary">{discovery.summary}</p> : null}
          <p className="cov-check-meta">
            {costLine({ costEurCents: discovery.cost ? discovery.cost.eurCents : null, monthly: discovery.monthly })}
          </p>
          {discovery.messages.map((text) => (
            <p key={text} className="cov-check-meta">
              {text}
            </p>
          ))}
          {discovery.attribution ? <p className="cov-check-meta">Kaartgegevens: {discovery.attribution}.</p> : null}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="brn-hint">Alle restaurants hebben al een bruikbare broncontrole.</p>
      ) : (
        <table className="cov-check-table">
          <thead>
            <tr>
              <th scope="col">Selecteer</th>
              <th scope="col">Restaurant</th>
              <th scope="col">Website</th>
              <th scope="col">Reden</th>
              <th scope="col">Volgende stap</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.restaurantId}>
                <td>
                  <input
                    type="checkbox"
                    className="cov-check-select"
                    checked={selected.has(row.restaurantId)}
                    disabled={!row.canCheck}
                    onChange={() => toggle(row.restaurantId)}
                    aria-label={`Selecteer ${row.name}`}
                  />
                </td>
                <td>
                  <div className="cov-check-name">{row.name}</div>
                  {row.wijk ? <div className="cov-check-meta">{row.wijk}</div> : null}
                </td>
                <td>
                  <div className="cov-check-meta">
                    {row.proposal
                      ? row.proposal.menu || row.proposal.website || row.url
                      : row.url || 'Geen website bekend'}
                  </div>
                  {row.proposal ? (
                    <div className="cov-check-meta">
                      {originLabel(row.proposal.origin, { quote: row.proposal.quote, source: row.proposal.source }) ||
                        'Voorstel'}
                    </div>
                  ) : null}
                </td>
                <td>
                  <div className="cov-check-meta">{row.reasonLabel}</div>
                  {row.deadEnd ? (
                    <div className="cov-check-result">
                      <span className="cov-check-outcome">{row.outcome}</span>
                      {row.detail ? <span className="cov-check-meta">{row.detail}</span> : null}
                      {row.age ? <span className="cov-check-meta">{row.age}</span> : null}
                    </div>
                  ) : null}
                </td>
                <td>
                  {/* BE-34 (#81, criterion 4): the restaurant the app is working
                      on right now says so, in its own row. */}
                  {discoveryRun && discoveryRun.phase === 'running' && discoveryRun.currentId === row.restaurantId ? (
                    <span className="cov-check-meta cov-row-searching" role="status">
                      {ROW_SEARCHING}
                    </span>
                  ) : null}
                  {row.step && row.step.key === 'confirm_proposal' ? (
                    <button
                      type="button"
                      className="di-btn-primary cov-check-action"
                      disabled={busy}
                      onClick={() => confirmProposal(row)}
                    >
                      {row.step.label}
                    </button>
                  ) : row.deadEnd ? (
                    // The one fitting step of this dead end: "Handmatig
                    // toevoegen" or, since BE-34 (#81), the one-click AI reading
                    // in this row itself. The manual import stays the small link
                    // inside that action, never the first destination.
                    row.step && row.step.key === 'ai_read' ? (
                      <AiReadAction
                        row={row}
                        state={aiRead.stateFor(row)}
                        onRead={aiRead.read}
                        onOpen={aiRead.open}
                        disabled={busy}
                        label={row.step.label}
                      />
                    ) : (
                      <a
                        className="stg-btn-secondary cov-check-action"
                        href={stepHref(row, { batchId: row.batchId, returnTo: COVERAGE_HREF }) || MANUAL_IMPORT_HREF}
                      >
                        {row.step.label}
                      </a>
                    )
                  ) : row.canCheck ? (
                    <button
                      type="button"
                      className="stg-btn-secondary cov-check-action"
                      disabled={busy}
                      onClick={() => start([row.url])}
                    >
                      {row.step.label}
                    </button>
                  ) : (
                    <span className="cov-check-meta">Geen automatische controle mogelijk</span>
                  )}
                  {row.deadEnd && row.canCheck ? (
                    <button type="button" className="srr-recheck cov-check-recheck" disabled={busy} onClick={() => start([row.url])}>
                      {CHECK_COPY.recheck}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {activeBatch ? (
        <div>
          <h3 className="cov-check-title">{activeBatch.batch.closed_at ? 'Resultaat van de controle' : CHECK_COPY.running}</h3>
          <ol className="srr-list" aria-label="Resultaat van de controle">
            {activeBatch.items.map((item) => {
              const row = rowForBatchItem(item, { batchId: activeBatch.batch.id, now: new Date(), aiReady: aiReadReady(aiStatus) })
              return (
                <SourceResultRow
                  key={`${item.position}-${item.jobId || item.key}`}
                  row={row}
                  position={item.position}
                  href={stepHref(row, { batchId: activeBatch.batch.id, returnTo: COVERAGE_HREF })}
                  onRecheck={(target) => start([target.url])}
                  onAiRead={aiRead.read}
                  onOpenAiRead={aiRead.open}
                  aiRead={aiRead.stateFor(row)}
                  busy={busy}
                />
              )
            })}
          </ol>
          <p className="cov-check-meta">{CHECK_COPY.staysTask}</p>
        </div>
      ) : null}
    </section>
  )
}
