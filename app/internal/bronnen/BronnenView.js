'use client'

// BE-31 (#74) — the visible "Bronnen beoordelen" screen (approved mockup
// "Bronnen beoordelen v2", screens 1-4). Presentational only: the page owns the
// data and the existing write routes.
//
// Layout rules from the contract: the first thing you see is the real work
// (chips with real numbers, the task list), the detail only after choosing a
// task ("Kies een taak links"), and with no work only "✅ Geen open bronwerk"
// plus the link to Dekking — no chips, no detail pane. On a telephone the list
// is the screen and a task opens as its own screen with a back link.

import { Fragment } from 'react'
import { Detail, FeedbackRegion } from './ProposalDetail'
import SourceResultRow from '@/src/components/SourceResultRow'
import {
  TASK_FILTERS,
  TASK_FILTER_LABELS,
  CHECK_COPY,
  COVERAGE_HREF,
  BRONNEN_HREF,
  stepHref,
} from '@/src/lib/sourceReview'

const KIND_NAMES = { batch: 'Batch', proposal: 'Voorstel', attention: 'Bron vraagt aandacht' }

function BatchRows({ task, busy, onConfirmRow }) {
  if (!task.rows || task.rows.length === 0) return null
  // "Menukopjes controleren" comes back to this row: the same task stays chosen.
  const returnTo = `${BRONNEN_HREF}?batch=${encodeURIComponent(task.batchId)}`
  return (
    <ol className="srr-list" aria-label="Resultaten van deze batch">
      {task.rows.map((row, index) => (
        <SourceResultRow
          key={`${row.position}-${row.jobId || row.key}-${index}`}
          row={row}
          position={row.position}
          href={stepHref(row, { batchId: task.batchId, returnTo })}
          onConfirm={(target) => onConfirmRow(task, target)}
          busy={busy}
        />
      ))}
    </ol>
  )
}

function BatchSummary({ task }) {
  const batch = (task.detail && task.detail.batch) || {}
  const when = batch.created_at ? new Date(batch.created_at) : null
  const label =
    when && !Number.isNaN(when.getTime())
      ? when.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' }) +
        ` ${when.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}`
      : null
  return (
    <p className="brn-batch-summary">
      {label ? `Batch van ${label}` : 'Batch'} · {batch.item_count || task.rows.length} URL
      {(batch.item_count || task.rows.length) === 1 ? '' : "'s"} · {task.activeCount} met een volgende stap
    </p>
  )
}


export default function BronnenView({
  triage,
  counts,
  loading,
  error,
  warning,
  message,
  filter,
  onFilter,
  tasks,
  totalTasks,
  selected,
  onSelect,
  onClear,
  busy,
  headingRef,
  feedbackRef,
  proposalsAvailable,
  onCreateProposal,
  onDecideProposal,
  onConfirmRow,
  followUp,
  followUpBanner,
}) {
  const empty = Boolean(triage) && totalTasks === 0
  return (
    <>
      <nav aria-label="Kruimelpad" className="brn-breadcrumb">
        <a href="/internal" className="stg-link">
          Werkvoorraad
        </a>
        <span aria-hidden="true"> / </span>
        <b aria-current="page">Bronnen beoordelen</b>
        <span className="brn-route">/internal/bronnen</span>
      </nav>

      <div className="brn-title-row">
        <h1 className="di-title">Bronnen beoordelen 🔎</h1>
        <span className="brn-subtitle">
          {empty ? 'Niets te doen' : `${totalTasks} ${totalTasks === 1 ? 'taak wacht' : 'taken wachten'} op jou`}
        </span>
      </div>

      <div role="alert" aria-atomic="true">
        {error ? <div className="di-banner di-banner-danger">{error}</div> : null}
      </div>
      <div role="status" aria-atomic="true">
        {!error && message ? (
          <div
            className={`di-banner ${
              message.tone === 'error' ? 'di-banner-danger' : message.tone === 'success' ? 'di-banner-info' : 'di-banner-neutral'
            }`}
          >
            {message.text}
          </div>
        ) : null}
        {warning ? <div className="di-banner di-banner-neutral">{warning}</div> : null}
      </div>

      {!triage && loading ? <p className="brn-hint">Laden…</p> : null}

      {followUpBanner ? (
        <div className="di-banner di-banner-neutral" role="note">
          <strong>Vervolg van de batchanalyse:</strong> {followUpBanner.reason}. {followUpBanner.nextStep}
        </div>
      ) : null}

      {empty ? (
        <section className="brn-empty" aria-label="Geen open bronwerk">
          <h2 className="brn-empty-title">{CHECK_COPY.noWork}</h2>
          <p className="brn-hint">
            Er staan geen open voorstellen, aandachtspunten of batchresultaten met een volgende stap klaar.
          </p>
          <a className="di-btn-primary brn-action" href={COVERAGE_HREF}>
            📊 Naar Dekking
          </a>
        </section>
      ) : null}

      {triage && !empty ? (
        <>
          <div className="brn-chips" role="group" aria-label="Taken filteren">
            {TASK_FILTERS.map((key) => (
              <button
                key={key}
                type="button"
                className="brn-chip"
                aria-pressed={filter === key}
                onClick={() => onFilter(key)}
              >
                {TASK_FILTER_LABELS[key]} {counts[key]}
              </button>
            ))}
          </div>

          <div className={`brn-layout${selected ? ' brn-layout--selected' : ''}`}>
            <section className="brn-list" aria-labelledby="brn-list-title">
              <h2 id="brn-list-title" className="visually-hidden">
                Taken
              </h2>
              <p className="brn-count" aria-live="polite">
                {tasks.length} van {totalTasks} taken
              </p>
              {tasks.length === 0 ? (
                <p className="brn-hint">Geen taken voor deze selectie.</p>
              ) : (
                <ul className="brn-tasks">
                  {tasks.map((task) => (
                    <li key={task.id}>
                      <button
                        type="button"
                        className="brn-task"
                        aria-current={selected && selected.id === task.id ? 'true' : undefined}
                        aria-controls="brn-detail"
                        onClick={() => onSelect(task.id)}
                      >
                        <span className="brn-task-emoji" aria-hidden="true">
                          {task.emoji}
                        </span>
                        <span className="brn-task-text">
                          <span className="brn-task-kind">{KIND_NAMES[task.kind]}</span>
                          <span className="brn-task-name">{task.name}</span>
                          <span className="brn-task-what">{task.what}</span>
                          <span className="brn-task-status">{task.status}</span>
                        </span>
                        <span className="brn-task-arrow" aria-hidden="true">
                          →
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="brn-hint">
                Restaurants zonder bruikbare broncontrole staan bij{' '}
                <a className="stg-link" href={COVERAGE_HREF}>
                  Dekking
                </a>
                .
              </p>
            </section>
            <section id="brn-detail" className="brn-detail" aria-label="Details">
              <FeedbackRegion message={message} regionRef={feedbackRef} />
              {!selected ? (
                <p className="brn-hint brn-detail-empty">{CHECK_COPY.pickTask}</p>
              ) : (
                <article className="brn-detail-card">
                  <button type="button" className="stg-btn-secondary brn-back" onClick={onClear}>
                    ← Terug naar de taken
                  </button>
                  <span className="brn-detail-kind">
                    {selected.emoji} {KIND_NAMES[selected.kind]} · {selected.status}
                  </span>
                  {selected.kind === 'batch' ? (
                    <>
                      <h2 id="brn-detail-title" className="brn-detail-title" tabIndex={-1} ref={headingRef}>
                        {selected.name}
                      </h2>
                      <BatchSummary task={selected} />
                      <BatchRows task={selected} busy={busy} onConfirmRow={onConfirmRow} />
                    </>
                  ) : (
                    <Detail
                      entry={selected.entry}
                      proposalsAvailable={proposalsAvailable}
                      busy={busy}
                      onCreate={onCreateProposal}
                      onDecide={onDecideProposal}
                      headingRef={headingRef}
                      followUp={followUp}
                    />
                  )}
                  <p className="brn-notice">
                    {CHECK_COPY.nothingPublished} {CHECK_COPY.staysTask}
                  </p>
                </article>
              )}
            </section>
          </div>
        </>
      ) : null}
    </>
  )
}


