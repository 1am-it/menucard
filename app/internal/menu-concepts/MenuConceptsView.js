'use client'

// BE-17 Menuconcepten beoordelen v1 — everything below the internal
// navigation, for the list (/internal/menu-concepts) and the review page
// (/internal/menu-concepts/[id]). Presentational: the pages load data and
// call the routes; every rule is re-checked on the server
// (src/lib/menuConceptReviewHandlers.js).
// Visual direction: docs/mockups/menu-concept-review-v1.png (text and
// Kleurtaal v2 win). Approval stays internal: nothing is published.

import { useMemo, useRef, useState } from 'react'
import StatusIcon from '@/src/components/StatusIcon'
import { StaticMenu, menuTitle } from '@/src/components/MenuBody'
import { buildMenuConcept, storedConceptInput, mergeEdits } from '@/src/lib/menuConcept'
import {
  plural,
  LineEditor,
  RemovedDecisions,
  SafeLines,
  ExcludedLines,
  ConceptChips,
  BlockerBanner,
  ConceptStructure,
  useConceptEdits,
  conceptParts,
  ProductReview,
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
        {item.readOnly && (
          <li className="bta-chip">
            {item.schemaVersion === 'menu-extraction-product/v2' ? 'v2' : 'onbekende versie'} · alleen-lezen
          </li>
        )}
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
    <>
      <p className="bta-muted">{plural(history.length, 'versie', 'versies')}</p>
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
    </>
  )
}

const TABS = [
  { id: 'preview', label: 'Publicatievoorbeeld' },
  { id: 'changes', label: 'Wijzigingen' },
  { id: 'source', label: 'Bron' },
  { id: 'history', label: 'Versiegeschiedenis' },
]

/** Accessible tabs: arrow keys, Home and End move between them (WAI-ARIA tabs pattern). */
function ConceptTabs({ tabs, active, onSelect, idPrefix }) {
  const refs = useRef({})
  function onKeyDown(event) {
    const i = tabs.findIndex((t) => t.id === active)
    let next = null
    if (event.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length]
    if (event.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length]
    if (event.key === 'Home') next = tabs[0]
    if (event.key === 'End') next = tabs[tabs.length - 1]
    if (!next) return
    event.preventDefault()
    onSelect(next.id)
    if (refs.current[next.id]) refs.current[next.id].focus()
  }
  return (
    <div className="mcr-tabs" role="tablist" aria-label="Weergave van het menuconcept">
      {tabs.map((t) => (
        <button
          key={t.id}
          ref={(el) => (refs.current[t.id] = el)}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${t.id}`}
          aria-selected={active === t.id}
          aria-controls={`${idPrefix}-panel-${t.id}`}
          tabIndex={active === t.id ? 0 : -1}
          className="mcr-tab"
          onClick={() => onSelect(t.id)}
          onKeyDown={onKeyDown}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

function dishCount(entries) {
  return entries.reduce((n, { entry }) => n + (entry.categories || []).reduce((m, c) => m + (c.items || []).length, 0), 0)
}

/**
 * Publicatievoorbeeld: the menu exactly as the public menu page shows it,
 * rendered by the same body renderer (src/components/MenuBody.js) from data
 * built on the server. "Nieuw concept" is the entry "Maak review-PR" writes;
 * "Huidige publieke kaart" is the unchanged published menu. Read-only.
 */
function PublicationPreview({ preview, restaurantName, version, dirty }) {
  const [mode, setMode] = useState('concept')
  const entries = mode === 'concept' ? (preview.concept ? [preview.concept] : []) : preview.current
  const sections = entries.reduce((n, { entry }) => n + (entry.categories || []).length, 0)
  return (
    <section className="mcr-preview" aria-labelledby="mcr-preview-title">
      <div className="mcr-preview-head">
        <h2 id="mcr-preview-title" className="bta-concept-title">
          {restaurantName}
        </h2>
        <span className="bta-tag">Voorvertoning zoals publiek</span>
      </div>
      <div className="mcr-toggle" role="group" aria-label="Welke menukaart tonen">
        <button type="button" className="mcr-toggle-btn" aria-pressed={mode === 'concept'} onClick={() => setMode('concept')}>
          Nieuw concept
        </button>
        <button type="button" className="mcr-toggle-btn" aria-pressed={mode === 'current'} onClick={() => setMode('current')}>
          Huidige publieke kaart
        </button>
      </div>
      <p className="bta-muted" aria-live="polite">
        {mode === 'concept'
          ? `Precies wat de review-PR voor versie ${version} schrijft. Nog niet gepubliceerd.`
          : 'Zoals de menukaart nu publiek staat. Deze blijft ongewijzigd tot een review-PR handmatig is gemerged.'}
      </p>
      {dirty && mode === 'concept' && (
        <div className="di-banner di-banner-neutral" role="note">
          <span>Je niet-opgeslagen correcties staan nog niet in dit voorbeeld. Sla ze eerst op als nieuwe versie.</span>
        </div>
      )}
      <div className="mcr-preview-menu">
        {entries.length === 0 ? (
          <p className="bta-muted">
            {mode === 'concept'
              ? 'Geen voorbeeld: deze versie heeft nog blokkades. Een gedeeltelijke menukaart wordt nooit getoond of geëxporteerd.'
              : 'Dit restaurant heeft nog geen publieke menukaart.'}
          </p>
        ) : (
          entries.map(({ key, entry }) => (
            <div key={key} className="mcr-preview-entry">
              <h3 className="mcr-preview-entry-title">{menuTitle(key, entry)}</h3>
              <StaticMenu categories={entry.categories} idPrefix={`mcp-${mode}-${key}`} />
            </div>
          ))
        )}
      </div>
      {entries.length > 0 && (
        <p className="mcr-meta">
          {plural(dishCount(entries), 'gerecht', 'gerechten')} · {plural(sections, 'rubriek', 'rubrieken')}
          {mode === 'concept' ? ' · volledige menukaart' : ` · ${plural(entries.length, 'menukaart', 'menukaarten')}`}
        </p>
      )}
    </section>
  )
}

/** /internal/menu-concepts/[id] */
const EXPORT_VIEW = {
  opened: { role: 'neutral', icon: 'clock', label: 'Review-PR open' },
  merged: { role: 'positive', icon: 'check', label: 'Review-PR gemerged' },
  closed: { role: 'neutral', icon: 'cross', label: 'Review-PR gesloten zonder merge' },
  failed: { role: 'neutral', icon: 'cross', label: 'Vorige poging mislukt' },
  pending: { role: 'neutral', icon: 'progress', label: 'Review-PR wordt gemaakt' },
}

/** BE-27: "Maak review-PR" for an approved concept, then its pull request and status. Never publishes. */
function PublicationCard({ concept, exportInfo, githubConfigured, canExport, exportBlockers, busy, onExport }) {
  const view = exportInfo ? EXPORT_VIEW[exportInfo.status] : null
  const active = exportInfo && (exportInfo.status === 'opened' || exportInfo.status === 'merged' || exportInfo.status === 'pending')
  return (
    <section className="bta-side-card" aria-labelledby="mcr-publication">
      <h2 id="mcr-publication" className="bta-side-title">
        Publicatie
      </h2>
      {view && (
        <span className={`status-badge status-badge--${view.role} bta-badge`}>
          <StatusIcon name={view.icon} />
          <span>{view.label}</span>
        </span>
      )}
      {exportInfo && exportInfo.prUrl && (
        <a className="stg-btn-secondary bta-btn" href={exportInfo.prUrl} target="_blank" rel="noopener noreferrer">
          Review-PR openen
          <span className="bta-sr-only"> (opent in een nieuw tabblad)</span>
        </a>
      )}
      {exportInfo && exportInfo.status === 'merged' ? (
        <p className="bta-side-text">Gemerged op GitHub. De menukaart wordt zichtbaar na de normale productie-deploy.</p>
      ) : (
        <p className="bta-side-text">
          <strong>Nog niet gepubliceerd. Handmatig mergen vereist.</strong>
        </p>
      )}
      {exportInfo && exportInfo.branch && (
        <p className="bta-side-muted mcr-meta">
          Branch <span className="bta-url">{exportInfo.branch}</span>
          {exportInfo.commitSha ? ` · commit ${exportInfo.commitSha.slice(0, 7)}` : ''} · conceptversie {concept.version}
        </p>
      )}
      {!active && (
        <div className="mcr-actions">
          <button
            type="button"
            className="di-btn-primary bta-btn"
            aria-disabled={!canExport || busy ? 'true' : undefined}
            aria-describedby="mcr-export-hint"
            onClick={() => {
              if (canExport && !busy) onExport(concept.version)
            }}
          >
            Maak review-PR
          </button>
          <p id="mcr-export-hint" className="bta-muted">
            {!githubConfigured
              ? 'De GitHub-koppeling ontbreekt op de server. Er kan nog geen review-PR worden gemaakt; er is niets gewijzigd.'
              : exportBlockers.length > 0
                ? exportBlockers.join(' ')
                : 'Maakt één gewone GitHub-PR met alleen deze volledige menukaart. Er wordt niets automatisch gemerged of gepubliceerd.'}
          </p>
        </div>
      )}
    </section>
  )
}

/** A versioned v2 concept: version-faithful display, every write action blocked. */
function ProductConceptReview({ data, crumbs, loadError, message }) {
  const c = data.concept
  const blocked = c.blocked || {}
  const product = data.product
  return (
    <>
      {crumbs}
      <div className="bta-header">
        <div className="bta-title-row">
          <h1 className="di-title">Beoordeel menuconcept</h1>
          <span className="bta-tag">Alleen intern</span>
        </div>
        <p className="bta-muted">Versiegebonden kaart. Alleen lezen: opslaan, goedkeuren en exporteren zijn in deze ronde geblokkeerd.</p>
      </div>
      <Messages loadError={loadError} message={message} />
      <div className="di-banner di-banner-neutral" role="status">
        <span className="di-banner-icon">
          <StatusIcon name="warning" />
        </span>
        <span>
          <strong>Alleen-lezen.</strong> {blocked.message || 'Deze kaart kan niet als v1-concept worden verwerkt.'}{' '}
          {blocked.reason ? `Reden: ${blocked.reason}.` : ''}
        </span>
      </div>
      {blocked.problems && blocked.problems.length > 0 && (
        <ul className="bta-notes" aria-label="Validatieproblemen">
          {blocked.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      <ul className="mcr-stats" aria-label="Concept in cijfers">
        <li>
          <strong>{product ? product.counts.items : 0}</strong> items
        </li>
        <li>
          <strong>{product ? product.counts.categories : 0}</strong> rubrieken
        </li>
        <li>
          <StatusIcon name="file" /> conceptversie {c.version}
        </li>
        <li>
          <StatusIcon name="warning" /> {blocked.blockedActions && blocked.blockedActions.length > 0 ? blocked.blockedActions.join(', ') : 'schrijven geblokkeerd'}
        </li>
      </ul>

      {product ? (
        <ProductReview product={product} />
      ) : (
        <p className="bta-muted">De inhoud kon niet als v2 worden gelezen. De onbewerkte rij blijft bewaard; er wordt niets omgezet.</p>
      )}

      <section className="bta-concept" aria-labelledby="mcr-source-v2">
        <h2 id="mcr-source-v2" className="bta-concept-title">
          Bron
        </h2>
        <p className="bta-url">{c.sourceUrl}</p>
        <p className="bta-muted">
          De brontekst en hash zijn niet als controleerbare broncontext geregistreerd. Een structureel geldige kaart is daarom niet
          bronbevestigd.
        </p>
        <div className="bta-actions">
          <a className="stg-btn-secondary bta-btn" href={c.sourceUrl} target="_blank" rel="noopener noreferrer">
            Open originele menukaart
            <span className="bta-sr-only"> (opent in een nieuw tabblad)</span>
          </a>
        </div>
      </section>

      <section className="bta-concept" aria-labelledby="mcr-history-v2">
        <h2 id="mcr-history-v2" className="bta-concept-title">
          Versiegeschiedenis
        </h2>
        <History history={data.history} currentId={c.id} />
      </section>

      <p>
        <a className="stg-link" href="/internal/menu-concepts">
          Terug naar Menuconcepten beoordelen
        </a>
      </p>
    </>
  )
}

export function ConceptReview({ data, loadError, message, busy, onSaveVersion, onDecide, onExport }) {
  const { edits, touched, setLineEdit, decideRemoved, reset, dirty } = useConceptEdits()
  const [rejecting, setRejecting] = useState(false)
  const [tab, setTab] = useState(() => (data && data.concept.status === 'approved' && data.preview && data.preview.concept ? 'preview' : 'changes'))
  const blockedContent = Boolean(data && (data.product || data.concept.blocked))
  const stored = useMemo(() => (data && !blockedContent ? storedConceptInput(data.concept.captured) : null), [data, blockedContent])
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

  if (blockedContent) {
    return <ProductConceptReview data={data} crumbs={crumbs} loadError={loadError} message={message} />
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
  const exportBlockers = []
  if (!c.isLatest) exportBlockers.push('Alleen de nieuwste versie kan een review-PR krijgen.')
  if (c.status !== 'approved') exportBlockers.push('Keur het concept eerst intern goed.')
  if (concept.blockers.length > 0) exportBlockers.push('Een menukaart met blokkades wordt nooit geëxporteerd.')
  if (!sourceOk) exportBlockers.push('De bron moet bevestigd en niet geblokkeerd zijn.')
  if (dirty) exportBlockers.push('Sla eerst je correcties op of maak ze ongedaan.')
  const canExport = Boolean(data.githubConfigured) && exportBlockers.length === 0

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
          <ConceptTabs tabs={TABS} active={tab} onSelect={setTab} idPrefix={`mcr-${c.id}`} />
          <div role="tabpanel" id={`mcr-${c.id}-panel-preview`} aria-labelledby={`mcr-${c.id}-tab-preview`} hidden={tab !== 'preview'}>
            <PublicationPreview preview={data.preview} restaurantName={c.restaurantName} version={c.version} dirty={dirty} />
          </div>
          <div role="tabpanel" id={`mcr-${c.id}-panel-changes`} aria-labelledby={`mcr-${c.id}-tab-changes`} hidden={tab !== 'changes'}>
          <section className="bta-concept" aria-labelledby="mcr-changes">
            <h2 id="mcr-changes" className="bta-concept-title">
              Wijzigingen controleren
            </h2>
            <ConceptChips safe={safe} concept={concept} excluded={excluded} />
            <BlockerBanner concept={concept} />
            <ConceptStructure captured={c.captured} />
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
          </div>
          <div role="tabpanel" id={`mcr-${c.id}-panel-source`} aria-labelledby={`mcr-${c.id}-tab-source`} hidden={tab !== 'source'}>
            <section className="bta-concept" aria-labelledby="mcr-source">
              <h2 id="mcr-source" className="bta-concept-title">
                Bron
              </h2>
              <p className="bta-url">{c.sourceUrl}</p>
              <p className="bta-muted">
                {c.originRecorded ? 'De oorspronkelijke herkenning van deze bron is bewaard en staat bij Wijzigingen naast elke conceptwaarde.' : 'Van deze versie is de oorspronkelijke herkenning niet vastgelegd.'}
              </p>
              <div className="bta-actions">
                <a className="stg-btn-secondary bta-btn" href={c.sourceUrl} target="_blank" rel="noopener noreferrer">
                  Open originele menukaart
                  <span className="bta-sr-only"> (opent in een nieuw tabblad)</span>
                </a>
              </div>
            </section>
          </div>
          <div role="tabpanel" id={`mcr-${c.id}-panel-history`} aria-labelledby={`mcr-${c.id}-tab-history`} hidden={tab !== 'history'}>
            <section className="bta-concept" aria-labelledby="mcr-history-title">
              <h2 id="mcr-history-title" className="bta-concept-title">
                Versiegeschiedenis
              </h2>
              <History history={data.history} currentId={c.id} />
            </section>
          </div>
        </div>

        <aside className="bta-side" aria-label="Conceptstatus en publicatie">
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

          {(c.status === 'approved' || data.export) && (
            <PublicationCard
              concept={c}
              exportInfo={data.export}
              githubConfigured={data.githubConfigured}
              canExport={canExport}
              exportBlockers={exportBlockers}
              busy={busy}
              onExport={onExport}
            />
          )}

        </aside>
      </div>
    </>
  )
}
