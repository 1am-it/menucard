'use client'

// Beheer > Importhistorie — two clearly separate existing histories:
//   1. URL batches from the existing batch-analysis API (1-10 URLs each);
//   2. dataset/source import runs from the existing import-inbox API.
// Both are read-only and link to the exact existing result. This panel never
// starts an import, retries a job or implies that a bulk URL engine exists.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildImportHistoryView } from '@/src/lib/internalBeheer'

const LOAD_ERROR = 'De importhistorie kon niet worden geladen.'

function formatDateTime(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return `${date.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })}, ${date.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}`
}

function countSummary(counts) {
  if (!counts || typeof counts !== 'object') return null
  const parts = Object.entries(counts)
    .filter(([, value]) => typeof value === 'number')
    .map(([key, value]) => `${key}: ${value}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

async function fetchJson(url, token) {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, data: null, error: body.error || LOAD_ERROR }
    return { ok: true, data: body, error: null }
  } catch {
    return { ok: false, data: null, error: LOAD_ERROR }
  }
}

export default function ImportHistoryPanel({ token, active }) {
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const loadedAttempt = useRef(-1)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    const [batches, runs] = await Promise.all([
      fetchJson('/api/internal/v1/batch-analysis', token),
      fetchJson('/api/internal/v1/import-inbox/runs', token),
    ])
    setResults({ batches, runs })
    setLoading(false)
  }, [token])

  useEffect(() => {
    if (!active || loadedAttempt.current === reloadKey) return
    loadedAttempt.current = reloadKey
    load()
  }, [active, reloadKey, load])

  const view = useMemo(
    () =>
      buildImportHistoryView({
        batchData: results && results.batches.data,
        runsData: results && results.runs.data,
        batchOk: Boolean(results && results.batches.ok),
        runsOk: Boolean(results && results.runs.ok),
      }),
    [results]
  )

  return (
    <section className="bh-panel" hidden={!active} aria-labelledby="bh-imports-title">
      <div className="bh-panel-head">
        <div>
          <p className="bh-breadcrumb">Beheer</p>
          <h2 id="bh-imports-title">Importhistorie</h2>
          <p>Eerdere imports en hun opgeslagen resultaten.</p>
        </div>
        <span className="bh-pill">{view.counts.total} resultaten</span>
      </div>

      {results && view.status === 'partial' && (
        <div className="di-banner di-banner-neutral" role="status">
          Een deel van de importhistorie is niet geladen. De zichtbare resultaten zijn echt, maar de lijst is mogelijk
          onvolledig. Er wordt niets als afgerond gemeld.
        </div>
      )}
      {results && view.status === 'error' && (
        <div className="di-banner di-banner-danger" role="alert">
          <span>
            De importhistorie kon niet worden geladen.{' '}
            <button type="button" className="bh-retry" onClick={() => setReloadKey((key) => key + 1)} disabled={loading}>
              {loading ? 'Laden…' : 'Opnieuw laden'}
            </button>
          </span>
        </div>
      )}
      {loading && !results && <p className="bh-loading">Laden…</p>}

      {results && view.status !== 'error' && (
        <>
          <section className="bh-subsection" aria-labelledby="bh-batches-title">
            <h3 id="bh-batches-title">Website-imports (URL-batches)</h3>
            <p className="bh-muted">
              Batches van 1 tot 10 URL&apos;s, gestart via Nieuwe import. Dit is niet de bestands- of bronimport en niet de
              engine voor meer dan 10 URL&apos;s.
            </p>
            {view.urlBatches.length === 0 ? (
              <p className="bh-empty">Geen URL-batches in de bestaande, begrensde lijst.</p>
            ) : (
              <ul className="bh-history-list bh-history-list--rows">
                {view.urlBatches.map((batch) => (
                  <li key={batch.id} className="bh-history-row">
                    <div>
                      <strong>{formatDateTime(batch.createdAt) || 'Onbekende datum'}</strong>
                      <span className="bh-muted">
                        {batch.itemCount} {batch.itemCount === 1 ? 'URL' : "URL's"} ·{' '}
                        {batch.isOwn ? 'door jou gestart' : 'door een collega gestart'}
                      </span>
                    </div>
                    <span className={`bh-chip bh-chip--${batch.status}`}>{batch.statusLabel}</span>
                    <a className="bh-action" href={batch.href}>
                      Bekijk batch
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="bh-subsection" aria-labelledby="bh-runs-title">
            <h3 id="bh-runs-title">Bestands- en bronimports</h3>
            <p className="bh-muted">
              Bestaande gegevensimports, apart van URL-batches. Een geslaagde run is geen publicatie.
            </p>
            {view.datasetRuns.length === 0 ? (
              <p className="bh-empty">Geen bestands- of bronimports in de bestaande, begrensde lijst.</p>
            ) : (
              <ul className="bh-history-list bh-history-list--rows">
                {view.datasetRuns.map((run) => (
                  <li key={run.id} className="bh-history-row">
                    <div>
                      <strong>{run.sourceName || run.sourceLocator || 'Naamloze import'}</strong>
                      <span className="bh-muted">
                        {formatDateTime(run.startedAt) || 'Onbekende start'}
                        {run.durationSeconds !== null ? ` · ${run.durationSeconds}s` : ''}
                        {countSummary(run.recordCounts) ? ` · ${countSummary(run.recordCounts)}` : ''}
                      </span>
                    </div>
                    <span className={`bh-chip bh-chip--${run.status}`}>
                      {run.statusLabel}
                      {run.errorLog.length > 0 ? ` · ${run.errorLog.length} fout${run.errorLog.length === 1 ? '' : 'en'}` : ''}
                    </span>
                    <a className="bh-action" href={run.href}>
                      Bekijk import
                    </a>
                    {run.errorLog.length > 0 && (
                      <details className="bh-error-details">
                        <summary>Foutdetails</summary>
                        <ul>
                          {run.errorLog.map((entry, index) => (
                            <li key={index}>{typeof entry === 'string' ? entry : JSON.stringify(entry)}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="bh-footnote">
            De bestaande API&apos;s tonen alleen de meest recente batches en imports. Oudere resultaten blijven opgeslagen,
            maar vallen buiten deze begrensde lijst.
          </p>
        </>
      )}
      {results && view.status === 'empty' && <p className="bh-empty">Nog geen imports vastgelegd.</p>}
    </section>
  )
}
