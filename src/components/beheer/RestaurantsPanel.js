'use client'

// Beheer > Restaurants en bronnen — a read-only view over the existing
// source-triage restaurant/source records. Selecting a record shows its
// existing source URL, the two status dimensions and its proposal history.
// Actions remain links to the existing source screens; this panel never
// posts, starts an analysis or publishes anything.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildRestaurantView } from '@/src/lib/internalBeheer'

const LOAD_ERROR = 'De restaurant- en brongegevens konden niet worden geladen.'

function formatDateTime(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return `${date.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })}, ${date.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}`
}

function StatusText({ label, muted }) {
  if (!label) return <span className="bh-muted">Onbekend</span>
  return <span className={muted ? 'bh-muted' : undefined}>{label}</span>
}

export default function RestaurantsPanel({ token, active }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const detailHeading = useRef(null)
  const loadedAttempt = useRef(-1)

  useEffect(() => {
    if (!selectedId || !detailHeading.current) return
    detailHeading.current.focus()
    detailHeading.current.scrollIntoView({ block: 'start' })
  }, [selectedId])

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/internal/v1/source-triage', { headers: { Authorization: `Bearer ${token}` } })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !Array.isArray(body.restaurants)) {
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

  const view = useMemo(() => buildRestaurantView(data), [data])
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return view.rows
    return view.rows.filter((row) =>
      [row.name, row.wijk, row.domain].filter(Boolean).some((value) => value.toLowerCase().includes(needle))
    )
  }, [view.rows, query])
  const selected = view.rows.find((row) => row.id === selectedId) || null

  return (
    <section className="bh-panel" hidden={!active} aria-labelledby="bh-restaurants-title">
      <div className="bh-panel-head">
        <div>
          <p className="bh-breadcrumb">Beheer</p>
          <h2 id="bh-restaurants-title">Restaurants en bronnen</h2>
          <p>Bestaande gegevens, bronkoppelingen en beschikbare historie.</p>
        </div>
        <span className="bh-pill">{view.total} restaurants</span>
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
      {data && data.proposals_available === false && (
        <div className="di-banner di-banner-neutral" role="status">
          Bronvoorstellen zijn tijdelijk niet beschikbaar. De bron- en menustatus hieronder is wel actueel; de
          voorstelgeschiedenis ontbreekt.
        </div>
      )}
      {loading && !data && <p className="bh-loading">Laden…</p>}

      {data && (
        <>
          <div className="bh-search">
            <label htmlFor="bh-restaurant-search" className="visually-hidden">
              Zoek restaurant, buurt of domein
            </label>
            <input
              id="bh-restaurant-search"
              type="search"
              placeholder="Zoek restaurant, buurt of domein"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <span className="bh-muted">
              {visible.length} van {view.total}
            </span>
          </div>

          {visible.length === 0 ? (
            <p className="bh-empty">Geen restaurants voor deze selectie.</p>
          ) : (
            <ul className="bh-records" aria-label="Restaurants en bronnen">
              {visible.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    className={`bh-record${selectedId === row.id ? ' is-selected' : ''}`}
                    aria-pressed={selectedId === row.id}
                    onClick={() => setSelectedId(row.id)}
                  >
                    <span className="bh-record-main">
                      <strong>{row.name}</strong>
                      <span className="bh-muted">
                        {[row.wijk, row.domain].filter(Boolean).join(' · ') || 'Geen buurt of domein bekend'}
                      </span>
                    </span>
                    <span className="bh-record-status">
                      <StatusText label={row.sourceLabel || row.notInQueueLabel} />
                      <span className="bh-muted">{row.menuLabel || 'Menukaart niet beoordeeld'}</span>
                    </span>
                    {row.openProposal && <span className="bh-chip bh-chip--attention">Open voorstel</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {selected ? (
            <article className="bh-detail-card" aria-labelledby="bh-restaurant-detail-title">
              <div className="bh-detail-head">
                <div>
                  <h3 id="bh-restaurant-detail-title" ref={detailHeading} tabIndex={-1}>{selected.name}</h3>
                  <p className="bh-muted">{[selected.wijk, selected.domain].filter(Boolean).join(' · ') || null}</p>
                </div>
                {selected.openProposal && <span className="bh-chip bh-chip--attention">Open voorstel</span>}
              </div>

              <dl className="bh-facts">
                <div>
                  <dt>Bronstatus</dt>
                  <dd>
                    <StatusText label={selected.sourceLabel} />
                  </dd>
                </div>
                <div>
                  <dt>Menukaartstatus</dt>
                  <dd>
                    <StatusText label={selected.menuLabel} />
                  </dd>
                </div>
                <div>
                  <dt>Bekende bron-URL</dt>
                  <dd>
                    {selected.knownUrl ? (
                      <a className="bh-link" href={selected.knownUrl} target="_blank" rel="noopener noreferrer">
                        {selected.knownUrl}
                      </a>
                    ) : (
                      <span className="bh-muted">Geen website bekend</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Laatste controle</dt>
                  <dd>{formatDateTime(selected.checkedAt) || <span className="bh-muted">Onbekend</span>}</dd>
                </div>
                <div>
                  <dt>Waarom aandacht</dt>
                  <dd>{selected.attention || <span className="bh-muted">Geen actieve aandachtspost</span>}</dd>
                </div>
                <div>
                  <dt>Vervolgstap</dt>
                  <dd>{selected.nextStepLabel || selected.notInQueueLabel || <span className="bh-muted">Geen</span>}</dd>
                </div>
              </dl>

              <div className="bh-detail-actions">
                <a className="bh-action" href={selected.triageHref}>
                  Open in brontriage
                </a>
                <a className="bh-action bh-action--secondary" href={selected.workqueueHref}>
                  Open in bronwerkvoorraad
                </a>
              </div>

              <section className="bh-history" aria-labelledby="bh-proposals-title">
                <h4 id="bh-proposals-title">Voorstelgeschiedenis</h4>
                {selected.proposals.length === 0 ? (
                  <p className="bh-muted">Nog geen voorstellen voor dit restaurant.</p>
                ) : (
                  <ol className="bh-history-list">
                    {selected.proposals.map((proposal) => (
                      <li key={proposal.id}>
                        <div className="bh-history-head">
                          <strong>{proposal.kindLabel}</strong>
                          <span className={`bh-chip bh-chip--${proposal.status}`}>{proposal.statusLabel}</span>
                        </div>
                        <p className="bh-muted">
                          Voorgesteld {formatDateTime(proposal.proposedAt) || 'onbekend'}
                          {proposal.decidedAt ? ` · beslist ${formatDateTime(proposal.decidedAt)}` : ''}
                        </p>
                        {proposal.decisionNote && <p>{proposal.decisionNote}</p>}
                        {proposal.note && <p className="bh-muted">{proposal.note}</p>}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </article>
          ) : (
            <p className="bh-hint">Kies een restaurant om de bestaande bron, status en historie te bekijken.</p>
          )}
        </>
      )}
    </section>
  )
}
