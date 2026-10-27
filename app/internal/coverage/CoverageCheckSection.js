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
import useBatchProcessing from '@/src/components/useBatchProcessing'
import {
  coverageRows,
  checkSelection,
  canStartCheck,
  rowForBatchItem,
  stepHref,
  CHECK_COPY,
  COVERAGE_HREF,
  MANUAL_IMPORT_HREF,
  MAX_BATCH_URLS,
  DAILY_URL_LIMIT,
} from '@/src/lib/sourceReview'

const TRIAGE_API = '/api/internal/v1/source-triage'
const BATCH_API = '/api/internal/v1/batch-analysis'
// The same bound the batch overview itself uses for its recent batches.
const BATCH_DETAIL_LIMIT = 10

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

  const load = useCallback(async () => {
    if (!token) return
    const auth = { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }
    try {
      const [triageRes, overviewRes] = await Promise.all([fetch(TRIAGE_API, auth), fetch(BATCH_API, auth)])
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
    () => coverageRows(entries || [], { batchDetails: details, now: new Date() }),
    [entries, details],
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

  return (
    <section className="cov-check" aria-labelledby="cov-check-title">
      <div className="cov-check-head">
        <h2 id="cov-check-title" className="cov-check-title">
          Nog niet gecontroleerd ({rows.length})
        </h2>
        <div style={{ flex: 1 }} />
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
                  <div className="cov-check-meta">{row.url || 'Geen website bekend'}</div>
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
                  {row.deadEnd ? (
                    // The one fitting step of this dead end: "Handmatig
                    // toevoegen" or "Lees met AI", the existing routes.
                    <a
                      className="stg-btn-secondary cov-check-action"
                      href={stepHref(row, { batchId: row.batchId, returnTo: COVERAGE_HREF }) || MANUAL_IMPORT_HREF}
                    >
                      {row.step.label}
                    </a>
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
              const row = rowForBatchItem(item, { batchId: activeBatch.batch.id, now: new Date() })
              return (
                <SourceResultRow
                  key={`${item.position}-${item.jobId || item.key}`}
                  row={row}
                  position={item.position}
                  href={stepHref(row, { batchId: activeBatch.batch.id, returnTo: COVERAGE_HREF })}
                  onRecheck={(target) => start([target.url])}
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
