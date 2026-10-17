'use client'

// Beheer > Concepten en besluiten — recorded history only: the latest menu
// concept version per lineage, decided source proposals and profile-draft
// history. Open daily work stays in Werkvoorraad. Approval alone is never
// presented as publication readiness; only the stored export status is shown.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildDecisionView } from '@/src/lib/internalBeheer'

const LOAD_ERROR = 'De concepten en besluiten konden niet worden geladen.'

function formatDate(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })
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

export default function DecisionsPanel({ token, active }) {
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const loadedAttempt = useRef(-1)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    const [concepts, triage, drafts] = await Promise.all([
      fetchJson('/api/internal/v1/menu-concepts', token),
      fetchJson('/api/internal/v1/source-triage', token),
      fetchJson('/api/internal/v1/profile-drafts', token),
    ])
    setResults({ concepts, triage, drafts })
    setLoading(false)
  }, [token])

  useEffect(() => {
    if (!active || loadedAttempt.current === reloadKey) return
    loadedAttempt.current = reloadKey
    load()
  }, [active, reloadKey, load])

  const view = useMemo(
    () =>
      buildDecisionView({
        conceptsData: results && results.concepts.data,
        triageData: results && results.triage.data,
        draftsData: results && results.drafts.data,
        conceptsOk: Boolean(results && results.concepts.ok),
        // A 200 with proposals_available=false is incomplete, not proof that
        // no source decision exists.
        triageOk: Boolean(results && results.triage.ok && results.triage.data && results.triage.data.proposals_available !== false),
        draftsOk: Boolean(results && results.drafts.ok),
      }),
    [results]
  )

  return (
    <section className="bh-panel" hidden={!active} aria-labelledby="bh-decisions-title">
      <div className="bh-panel-head">
        <div>
          <p className="bh-breadcrumb">Beheer</p>
          <h2 id="bh-decisions-title">Concepten en besluiten</h2>
          <p>Opgeslagen versies, bronbesluiten en profielconcepten.</p>
        </div>
        <span className="bh-pill">Publieke gegevens ongewijzigd</span>
      </div>

      {results && view.status === 'partial' && (
        <div className="di-banner di-banner-neutral" role="status">
          Een deel van de opgeslagen geschiedenis is niet geladen. De zichtbare records zijn echt, maar de lijst is
          mogelijk onvolledig.
        </div>
      )}
      {results && view.status === 'error' && (
        <div className="di-banner di-banner-danger" role="alert">
          <span>
            De concepten en besluiten konden niet worden geladen.{' '}
            <button type="button" className="bh-retry" onClick={() => setReloadKey((key) => key + 1)} disabled={loading}>
              {loading ? 'Laden…' : 'Opnieuw laden'}
            </button>
          </span>
        </div>
      )}
      {loading && !results && <p className="bh-loading">Laden…</p>}
      {results && view.status === 'empty' && <p className="bh-empty">Nog geen concepten of besluiten vastgelegd.</p>}

      {results && view.status !== 'error' && view.status !== 'empty' && (
        <>
          <section className="bh-subsection" aria-labelledby="bh-concepts-title">
            <h3 id="bh-concepts-title">Menuconcepten</h3>
            <p className="bh-muted">De nieuwste opgeslagen versie per restaurant en menukaart. Eerdere versies blijven in het concept bewaard.</p>
            {view.menuConcepts.length === 0 ? (
              <p className="bh-empty">Geen menuconcepten vastgelegd.</p>
            ) : (
              <ul className="bh-history-list bh-history-list--rows">
                {view.menuConcepts.map((concept) => (
                  <li key={concept.id} className="bh-history-row">
                    <div>
                      <strong>{concept.restaurantName}</strong>
                      <span className="bh-muted">
                        Menuconcept · versie {concept.version ?? '?'}
                        {concept.menuContext ? ` · ${concept.menuContext}` : ''}
                        {concept.createdAt ? ` · ${formatDate(concept.createdAt)}` : ''}
                      </span>
                    </div>
                    <div className="bh-history-status">
                      <span className={`bh-chip bh-chip--${concept.status}`}>{concept.statusLabel}</span>
                      <span className="bh-muted">{concept.exportLabel}</span>
                    </div>
                    <a className="bh-action" href={concept.href}>
                      Bekijk concept
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="bh-subsection" aria-labelledby="bh-source-decisions-title">
            <h3 id="bh-source-decisions-title">Bronbesluiten</h3>
            <p className="bh-muted">Vastgelegde acceptaties en afwijzingen. Open voorstellen staan in de Werkvoorraad.</p>
            {view.sourceDecisions.length === 0 ? (
              <p className="bh-empty">Geen bronbesluiten vastgelegd.</p>
            ) : (
              <ul className="bh-history-list bh-history-list--rows">
                {view.sourceDecisions.map((decision) => (
                  <li key={decision.id} className="bh-history-row">
                    <div>
                      <strong>{decision.restaurantName}</strong>
                      <span className="bh-muted">
                        {decision.kindLabel}
                        {decision.decidedAt ? ` · beslist ${formatDate(decision.decidedAt)}` : ''}
                      </span>
                    </div>
                    <div className="bh-history-status">
                      <span className={`bh-chip bh-chip--${decision.status}`}>{decision.statusLabel}</span>
                      {decision.decisionNote && <span className="bh-muted">{decision.decisionNote}</span>}
                    </div>
                    <a className="bh-action" href={decision.href}>
                      Bekijk bron
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="bh-subsection" aria-labelledby="bh-drafts-title">
            <h3 id="bh-drafts-title">Profielconcepten</h3>
            <p className="bh-muted">Actieve en verworpen profielconcepten. Een concept is geen publicatie.</p>
            {view.profileDrafts.length === 0 ? (
              <p className="bh-empty">Geen profielconcepten vastgelegd.</p>
            ) : (
              <ul className="bh-history-list bh-history-list--rows">
                {view.profileDrafts.map((draft) => (
                  <li key={draft.id} className="bh-history-row">
                    <div>
                      <strong>{draft.candidateName}</strong>
                      <span className="bh-muted">
                        {draft.promotedAt ? `Klaargezet ${formatDate(draft.promotedAt)}` : 'Klaargezet'}
                        {draft.discardedAt ? ` · verworpen ${formatDate(draft.discardedAt)}` : ''}
                      </span>
                      {draft.discardNote && <span className="bh-muted">{draft.discardNote}</span>}
                    </div>
                    <div className="bh-history-status">
                      <span className={`bh-chip bh-chip--${draft.status}`}>{draft.statusLabel}</span>
                    </div>
                    <a className="bh-action" href={draft.href}>
                      Bekijk profielconcept
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </section>
  )
}
