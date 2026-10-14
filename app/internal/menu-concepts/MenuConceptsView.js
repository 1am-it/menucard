'use client'

// BE-17 Menuconcepten beoordelen v1 — everything below the internal
// navigation, for the list (/internal/menu-concepts) and the review page
// (/internal/menu-concepts/[id]). Presentational: the pages load data and
// call the routes; every rule is re-checked on the server
// (src/lib/menuConceptReviewHandlers.js).
// Visual direction: docs/mockups/menu-concept-review-v1.png (text and
// Kleurtaal v2 win). Approval stays internal: nothing is published.

import { useMemo, useState } from 'react'
import StatusIcon from '@/src/components/StatusIcon'
import { buildMenuConcept, storedConceptInput, mergeEdits } from '@/src/lib/menuConcept'
import {
  plural,
  LineEditor,
  RemovedDecisions,
  SafeLines,
  ExcludedLines,
  ConceptChips,
  BlockerBanner,
  useConceptEdits,
  conceptParts,
} from '../source-triage/batch/MenuReview'

const STATUS_VIEW = {
  waiting: { role: 'neutral', icon: 'clock', label: 'Wacht op beoordeling' },
  approved: { role: 'positive', icon: 'check', label: 'Intern goedgekeurd' },
  rejected: { role: 'neutral', icon: 'cross', label: 'Afgewezen' },
}

const NOTHING_PUBLISHED = 'Goedkeuren blijft intern: er wordt niets gepubliceerd en de publieke menukaart blijft ongewijzigd.'

function formatMoment(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' })
}

export function StatusBadge({ status }) {
  const view = STATUS_VIEW[status] || STATUS_VIEW.waiting
  return (
    <span className={`status-badge status-badge--${view.role} bta-badge`}>
      <StatusIcon name={view.icon} />
      <span>{view.label}</span>
    </span>
  )
}

function Messages({ loadError, message }) {
  return (
    <>
      <div role="alert">{loadError && <div className="di-banner di-banner-danger">{loadError}</div>}</div>
      <div role="status">
        {message && <div className={`di-banner ${message.tone === 'error' ? 'di-banner-danger' : message.tone === 'success' ? 'di-banner-info' : 'di-banner-neutral'}`}>{message.text}</div>}
      </div>
    </>
  )
}

function InternalOnlyNote() {
  return (
    <div className="di-banner di-banner-info" role="note">
      <span className="di-banner-icon">
        <StatusIcon name="alert" />
      </span>
      <span>{NOTHING_PUBLISHED}</span>
    </div>
  )
}

function ConceptItem({ item }) {
  return (
    <li className="mcr-item">
      <div className="mcr-item-head">
        <h3 className="mcr-item-title">
          <a href={`/internal/menu-concepts/${item.id}`}>{item.restaurantName}</a>
        </h3>
        <StatusBadge status={item.status} />
      </div>
      <p className="mcr-meta">
        Conceptversie {item.version} · aangemaakt {formatMoment(item.createdAt)} {item.createdBySelf ? 'door jou' : 'door een collega'}
      </p>
      <p className="mcr-meta bta-url">{item.sourceUrl}</p>
      <ul className="bta-chips" aria-label="Aantallen">
        <li className="bta-chip">{plural(item.dishCount, 'gerecht', 'gerechten')}</li>
        <li className="bta-chip">{plural(item.attentionCount, 'aandachtspunt', 'aandachtspunten')}</li>
        {item.blockerCount > 0 && <li className="bta-chip">{plural(item.blockerCount, 'blokkade', 'blokkades')}</li>}
      </ul>
    </li>
  )
}

/** /internal/menu-concepts */
export function ConceptList({ data, loadError }) {
  const items = (data && data.items) || []
  const waiting = items.filter((i) => i.status === 'waiting')
  const decided = items.filter((i) => i.status !== 'waiting')
  return (
    <>
      <nav aria-label="Kruimelpad" className="bta-breadcrumb">
        <span>Werkvoorraad</span>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Menuconcepten beoordelen</span>
      </nav>
      <div className="bta-header">
        <div className="bta-title-row">
          <h1 className="di-title">Menuconcepten beoordelen</h1>
          <span className="bta-tag">Alleen intern</span>
        </div>
        <p className="bta-muted">Controleer menuconcepten uit Batchanalyse. Je ziet alleen de aandachtspunten; veilige gerechten zijn samengevat.</p>
      </div>
      <InternalOnlyNote />
      <Messages loadError={loadError} />
      {!data && !loadError && <p className="bta-muted">Laden…</p>}
      {data && (
        <section aria-labelledby="mcr-waiting" className="bta-card">
          <h2 id="mcr-waiting" className="bta-card-title">
            Wacht op beoordeling ({waiting.length})
          </h2>
          {waiting.length === 0 ? (
            <p className="bta-muted">
              Er wachten geen menuconcepten. Een concept ontstaat in <a className="stg-link" href="/internal/source-triage/batch">Batchanalyse</a> na
              &quot;Bevestig bron&quot; en &quot;Concept opslaan&quot;.
            </p>
          ) : (
            <ul className="mcr-list">
              {waiting.map((item) => (
                <ConceptItem key={item.id} item={item} />
              ))}
            </ul>
          )}
          {decided.length > 0 && (
            <>
              <h2 className="mcr-section-title">Beoordeeld ({decided.length})</h2>
              <ul className="mcr-list">
                {decided.map((item) => (
                  <ConceptItem key={item.id} item={item} />
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </>
  )
}

function RejectForm({ reasons, busy, onCancel, onReject }) {
  const [reason, setReason] = useState(null)
  const [note, setNote] = useState('')
  return (
    <fieldset className="mcr-reject">
      <legend>Reden van afwijzing</legend>
      {Object.entries(reasons).map(([value, label]) => (
        <label key={value}>
          <input type="radio" name="mcr-reject-reason" checked={reason === value} onChange={() => setReason(value)} /> {label}
        </label>
      ))}
      <label htmlFor="mcr-reject-note" className="bta-muted">
        Toelichting (optioneel)
      </label>
      <textarea id="mcr-reject-note" className="stg-input" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="mcr-actions">
        <button
          type="button"
          className="stg-btn-secondary bta-btn"
          aria-disabled={!reason || busy ? 'true' : undefined}
          onClick={() => {
            if (reason && !busy) onReject(reason, note)
          }}
        >
          Afwijzing vastleggen
        </button>
        <button type="button" className="stg-btn-secondary bta-btn" onClick={onCancel}>
          Annuleren
        </button>
      </div>
      {!reason && <p className="bta-muted">Kies eerst een reden.</p>}
    </fieldset>
  )
}

function History({ history, currentId }) {
  return (
    <details className="bta-category">
      <summary>
        <span className="bta-category-name">Versiegeschiedenis</span>
        <span className="bta-muted"> · {plural(history.length, 'versie', 'versies')}</span>
      </summary>
      <ul className="mcr-history">
        {history.map((v) => (
          <li key={v.id}>
            <span>
              {v.id === currentId ? <strong>Versie {v.version} (deze)</strong> : <a className="stg-link" href={`/internal/menu-concepts/${v.id}`}>Versie {v.version}</a>} ·{' '}
              {formatMoment(v.createdAt)} {v.createdBySelf ? 'door jou' : 'door een collega'}
              {v.basedOnVersion ? ` · correctie op versie ${v.basedOnVersion}` : ' · uit Batchanalyse'}
            </span>
            <StatusBadge status={v.status} />
            {v.reviews.length > 0 && (
              <ul>
                {v.reviews.map((r, i) => (
                  <li key={i}>
                    {r.decision === 'approved_internal' ? 'Intern goedgekeurd' : r.decision === 'rejected' ? `Afgewezen: ${r.reasonLabel}` : r.decision} · {formatMoment(r.decidedAt)}{' '}
                    {r.bySelf ? 'door jou' : 'door een collega'}
                    {r.note ? ` · “${r.note}”` : ''}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </details>
  )
}

/** /internal/menu-concepts/[id] */
export function ConceptReview({ data, loadError, message, busy, onSaveVersion, onDecide }) {
  const { edits, touched, setLineEdit, decideRemoved, reset, dirty } = useConceptEdits()
  const [rejecting, setRejecting] = useState(false)
  const stored = useMemo(() => (data ? storedConceptInput(data.concept.captured) : null), [data])
  const concept = useMemo(
    () => (stored ? buildMenuConcept({ menus: stored.menus, liveLines: data.liveLines, edits: mergeEdits(stored.edits, edits) }) : null),
    [stored, data, edits]
  )

  const crumbs = (
    <nav aria-label="Kruimelpad" className="bta-breadcrumb">
      <span className="bta-desktop-only">Werkvoorraad</span>
      <span className="bta-desktop-only" aria-hidden="true">
        /
      </span>
      <a href="/internal/menu-concepts" className="stg-link">
        <span className="bta-mobile-only" aria-hidden="true">
          ←{' '}
        </span>
        Menuconcepten beoordelen
      </a>
      <span aria-hidden="true">/</span>
      <span aria-current="page">{data ? data.concept.restaurantName : 'Menuconcept'}</span>
    </nav>
  )

  if (!data) {
    return (
      <>
        {crumbs}
        <Messages loadError={loadError} message={message} />
        {!loadError && <p className="bta-muted">Laden…</p>}
        {loadError && (
          <p>
            <a className="stg-link" href="/internal/menu-concepts">
              Terug naar Menuconcepten beoordelen
            </a>
          </p>
        )}
      </>
    )
  }

  const c = data.concept
  const readOnly = !c.isLatest
  const { editorLines, safe, excluded, categories } = conceptParts(concept, touched)
  const sectionCount = new Set(concept.lines.filter((l) => l.status !== 'excluded').map((l) => l.category)).size
  const dishCount = concept.lines.filter((l) => l.status !== 'excluded').length
  const sourceOk = data.source.confirmed && !data.source.blocked
  const approveBlockers = []
  if (concept.blockers.length > 0) approveBlockers.push(`Los eerst ${plural(concept.blockers.length, 'blokkade', 'blokkades')} op.`)
  if (!data.source.confirmed) approveBlockers.push('De bron is niet (meer) bevestigd.')
  if (data.source.blocked) approveBlockers.push(`De bron is geblokkeerd: ${data.source.blocked.label}.`)
  if (c.rejectedBefore) approveBlockers.push('Deze menukaart is eerder afgewezen.')
  if (c.status === 'approved') approveBlockers.push('Deze versie is al intern goedgekeurd.')
  const canApprove = c.isLatest && !dirty && approveBlockers.length === 0

  return (
    <>
      {crumbs}
      <div className="bta-header">
        <div className="bta-title-row">
          <h1 className="di-title">Beoordeel menuconcept</h1>
          <span className="bta-tag">Alleen intern</span>
        </div>
        <p className="bta-muted">Controleer alleen de wijzigingen voordat je het concept goedkeurt.</p>
      </div>
      <Messages loadError={loadError} message={message} />
      {!c.isLatest && (
        <div className="di-banner di-banner-neutral" role="status">
          <span>
            Je bekijkt versie {c.version}. Er is een nieuwere versie {c.latestVersion}:{' '}
            <a className="stg-link" href={`/internal/menu-concepts/${c.latestId}`}>
              open versie {c.latestVersion}
            </a>
            . Oudere versies blijven alleen-lezen.
          </span>
        </div>
      )}

      <ul className="mcr-stats" aria-label="Concept in cijfers">
        <li>
          <strong>{dishCount}</strong> gerechten
        </li>
        <li>
          <strong>{sectionCount}</strong> rubrieken
        </li>
        <li>
          <StatusIcon name="warning" /> <strong>{concept.attentionLines.length + concept.removed.length}</strong> aandachtspunten
        </li>
        <li>
          <StatusIcon name="file" /> conceptversie {c.version}
        </li>
      </ul>

      <div className="bta-layout">
        <div className="bta-content">
          <section className="bta-concept" aria-labelledby="mcr-changes">
            <h2 id="mcr-changes" className="bta-concept-title">
              Wijzigingen controleren
            </h2>
            <ConceptChips safe={safe} concept={concept} excluded={excluded} />
            <BlockerBanner concept={concept} />
            {editorLines.length > 0 && (
              <ul className="bta-concept-lines" aria-label="Aandachtspunten en blokkades">
                {editorLines.map((line) => (
                  <LineEditor
                    key={line.id}
                    idPrefix={`mcr-${c.id}`}
                    line={line}
                    edit={edits.lines[line.id] || {}}
                    setEdit={(patch) => setLineEdit(line.id, patch)}
                    categories={categories}
                    readOnly={readOnly}
                    compare={{ origin: line.from ? data.originLines[line.from] || null : null }}
                  />
                ))}
              </ul>
            )}
            <RemovedDecisions idPrefix={`mcr-${c.id}`} removed={concept.removed} readOnly={readOnly} onDecide={decideRemoved} />
            <SafeLines safe={safe} counts={concept.counts} readOnly={readOnly} onExclude={(lineId) => setLineEdit(lineId, { exclude: true })} />
            <ExcludedLines excluded={excluded} readOnly={readOnly} onRestore={(lineId) => setLineEdit(lineId, { exclude: false })} />
            {!c.originRecorded && (
              <p className="bta-muted">Van deze versie is de oorspronkelijke herkenning niet vastgelegd (opgeslagen vóór de auditvelden).</p>
            )}
          </section>
          <History history={data.history} currentId={c.id} />
        </div>

        <aside className="bta-side" aria-label="Conceptstatus en bron">
          <section className="bta-side-card" aria-labelledby="mcr-status">
            <h2 id="mcr-status" className="bta-side-title">
              Conceptstatus
            </h2>
            <StatusBadge status={c.status} />
            <ul className="mcr-status-list">
              <li>
                <StatusIcon name={sourceOk ? 'check' : data.source.blocked ? 'lock' : 'dot'} />
                <span>
                  <strong>{data.source.blocked ? `Bron geblokkeerd: ${data.source.blocked.label}` : data.source.confirmed ? 'Bron bevestigd' : 'Bron niet bevestigd'}</strong>
                </span>
              </li>
              <li>
                <StatusIcon name={concept.blockers.length > 0 ? 'warning' : 'check'} />
                <span>
                  <strong>
                    {concept.blockers.length > 0 ? `${plural(concept.blockers.length, 'blokkade', 'blokkades')} open` : 'Geen blokkades'}
                  </strong>
                  <span className="bta-muted">
                    {concept.blockers.length > 0 ? 'Los deze op voordat je het concept kunt goedkeuren.' : 'Prijswijzigingen blijven zichtbaar, maar blokkeren niet.'}
                  </span>
                </span>
              </li>
              <li>
                <StatusIcon name="check" />
                <span>
                  <strong>Publieke menukaart ongewijzigd</strong>
                  <span className="bta-muted">Er wordt niets gepubliceerd.</span>
                </span>
              </li>
            </ul>
            <div className="di-banner di-banner-info" role="note">
              <span>
                <strong>De oorspronkelijke herkenning blijft bewaard.</strong> Elke correctie wordt een nieuwe conceptversie; eerdere versies
                veranderen nooit.
              </span>
            </div>

            {c.isLatest && (
              <div className="mcr-actions">
                {dirty ? (
                  <>
                    <button
                      type="button"
                      className="di-btn-primary bta-btn"
                      aria-disabled={!concept.canSave || busy ? 'true' : undefined}
                      aria-describedby="mcr-save-hint"
                      onClick={() => {
                        if (concept.canSave && !busy) onSaveVersion(c.version, edits)
                      }}
                    >
                      Correcties opslaan als versie {c.latestVersion + 1}
                    </button>
                    <p id="mcr-save-hint" className="bta-muted">
                      {concept.canSave ? 'Daarna kun je deze nieuwe versie intern goedkeuren.' : 'Kan pas zonder blokkades.'}
                    </p>
                    <button type="button" className="stg-btn-secondary bta-btn" disabled={busy} onClick={reset}>
                      Correcties ongedaan maken
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="di-btn-primary bta-btn"
                      aria-disabled={!canApprove || busy ? 'true' : undefined}
                      aria-describedby="mcr-approve-hint"
                      onClick={() => {
                        if (canApprove && !busy) onDecide(c.version, 'approved_internal')
                      }}
                    >
                      Concept goedkeuren
                    </button>
                    <p id="mcr-approve-hint" className="bta-muted">
                      {approveBlockers.length > 0 ? approveBlockers.join(' ') : NOTHING_PUBLISHED}
                    </p>
                  </>
                )}
                {!dirty &&
                  c.status !== 'rejected' &&
                  (rejecting ? (
                    <RejectForm
                      reasons={data.rejectReasons}
                      busy={busy}
                      onCancel={() => setRejecting(false)}
                      onReject={(reason, note) => onDecide(c.version, 'rejected', reason, note)}
                    />
                  ) : (
                    <button type="button" className="stg-btn-secondary bta-btn" disabled={busy} onClick={() => setRejecting(true)}>
                      Concept afwijzen
                    </button>
                  ))}
              </div>
            )}
          </section>

          <section className="bta-side-card" aria-labelledby="mcr-source">
            <h2 id="mcr-source" className="bta-side-title">
              Bron
            </h2>
            <p className="bta-url">{c.sourceUrl}</p>
            <a className="stg-btn-secondary bta-btn" href={c.sourceUrl} target="_blank" rel="noopener noreferrer">
              Open originele menukaart
              <span className="bta-sr-only"> (opent in een nieuw tabblad)</span>
            </a>
          </section>
        </aside>
      </div>
    </>
  )
}
