'use client'

// Beheer > Overzicht — the existing coverage data rendered directly on the
// default Beheer view. No new metric is computed here: the panel fetches the
// same read-only /api/internal/v1/coverage route the full dashboard uses and
// reuses the existing priority-gap presentation helpers. The full existing
// dashboard stays reachable as a secondary detail link.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildOverviewModel } from '@/src/lib/internalBeheer'
import { metricState, visiblePriorityRows } from '@/src/lib/coveragePriority'

const LOAD_ERROR = 'Het dekkingsoverzicht kon niet worden geladen.'

function MetricTile({ metric }) {
  const state = metricState(metric.count, metric.total)
  const stateLabel = state === 'complete' ? 'Compleet' : state === 'partial' ? 'Gedeeltelijk' : 'Nog geen'
  return (
    <div className="bh-metric">
      <span className="bh-metric-label">{metric.label}</span>
      <strong className="bh-metric-value">
        {metric.count} / {metric.total}
      </strong>
      <span className={`bh-metric-state bh-metric-state--${state}`}>
        {metric.pct === null ? '—' : `${metric.pct}%`} · {stateLabel}
      </span>
    </div>
  )
}

export default function OverviewPanel({ token, active }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [showAll, setShowAll] = useState(false)
  const loadedAttempt = useRef(-1)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/internal/v1/coverage', { headers: { Authorization: `Bearer ${token}` } })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error || LOAD_ERROR)
        setData(null)
        return
      }
      setData(body)
    } catch {
      setError(LOAD_ERROR)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (!active || loadedAttempt.current === reloadKey) return
    loadedAttempt.current = reloadKey
    load()
  }, [active, reloadKey, load])

  const model = useMemo(() => buildOverviewModel(data), [data])
  const priority = useMemo(
    () => (model ? visiblePriorityRows(model.priorityRows, showAll) : { rows: [], hiddenCount: 0 }),
    [model, showAll]
  )

  return (
    <section className="bh-panel" hidden={!active} aria-labelledby="bh-overview-title">
      <div className="bh-panel-head">
        <div>
          <p className="bh-breadcrumb">Beheer</p>
          <h2 id="bh-overview-title">Dekkingsoverzicht</h2>
          <p>Overzicht van restaurants en beschikbare menukaartgegevens.</p>
        </div>
        <span className="bh-pill">Alleen lezen</span>
      </div>

      {error && (
        <div className="di-banner di-banner-danger" role="alert">
          <span>
            {error}{' '}
            <button type="button" className="bh-retry" onClick={() => setReloadKey((key) => key + 1)} disabled={loading}>
              {loading ? 'Laden…' : 'Opnieuw laden'}
            </button>
          </span>
        </div>
      )}
      {loading && !model && <p className="bh-loading">Laden…</p>}
      {data && !model && !error && !loading && <p className="bh-empty">Geen dekkingsoverzicht beschikbaar.</p>}

      {model && (
        <>
          <section className="bh-hero" aria-labelledby="bh-hero-title">
            <div>
              <span className="bh-eyebrow">Menukaartgegevens</span>
              <h3 id="bh-hero-title">
                {model.menu.count} van {model.menu.total} restaurants hebben gedigitaliseerde menukaartgegevens.
              </h3>
              <strong className="bh-hero-number">{model.menu.pct === null ? '—' : `${model.menu.pct}%`}</strong>
              <p className="bh-muted">
                Aanwezigheid van gegevens is geen bewijs van volledigheid of juistheid. Deze pagina herberekent niets.
              </p>
            </div>
          </section>

          <div className="bh-metrics">
            {model.metrics.map((metric) => (
              <MetricTile key={metric.id} metric={metric} />
            ))}
          </div>

          <section className="bh-subsection" aria-labelledby="bh-priority-title">
            <h3 id="bh-priority-title">Waar ontbreken nog menukaarten?</h3>
            <p className="bh-muted">Buurten met de meeste restaurants zonder menugegevens, grootste gat eerst.</p>
            <div className="bh-table-wrap">
              <table className="bh-table">
                <thead>
                  <tr>
                    <th scope="col">Buurt</th>
                    <th scope="col">Restaurants</th>
                    <th scope="col">Met menugegevens</th>
                    <th scope="col">Nog zonder</th>
                  </tr>
                </thead>
                <tbody>
                  {priority.rows.map((row) => (
                    <tr key={row.label}>
                      <td>{row.label}</td>
                      <td>{row.total}</td>
                      <td>{row.withMenuData}</td>
                      <td>{row.missingMenuData}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {priority.hiddenCount > 0 && (
              <button
                type="button"
                className="bh-link-button"
                aria-expanded={showAll}
                onClick={() => setShowAll((open) => !open)}
              >
                {showAll ? 'Toon de grootste gaten' : `Toon alle ${model.priorityRows.length} buurten`}
              </button>
            )}
          </section>

          <details className="bh-details">
            <summary>Methodologie en datatoelichting</summary>
            <p>
              Het dekkingsoverzicht toont alleen of gegevens aanwezig zijn, niet of ze gecontroleerd of actueel zijn. Het is
              een overzicht, geen actiewachtrij. Dagelijks werk staat in de Werkvoorraad.
            </p>
          </details>

          <p className="bh-muted">
            <a className="bh-link" href="/internal/coverage">
              Volledig dekkingsoverzicht openen
            </a>{' '}
            — dezelfde bestaande cijfers, met alle uitsplitsingen.
          </p>
        </>
      )}
    </section>
  )
}
