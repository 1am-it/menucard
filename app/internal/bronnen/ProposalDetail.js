'use client'

// BE-31 (#74) — the existing BE-24 proposal UI, moved out of the old
// /internal/source-triage page so the new /internal/bronnen screen can use it
// unchanged. Opening a proposal, accepting or rejecting it and recording a new
// proposal all go through the same existing API routes and the same tested
// validation (src/lib/sourceTriage.js). Nothing here fetches a website, starts
// an analysis or publishes: "Wijzigingen worden pas na controle verwerkt."

import { useEffect, useRef, useState } from 'react'
import StatusIcon from '@/src/components/StatusIcon'
import ExternalLinkIcon from '@/src/components/ExternalLinkIcon'
import { SOURCE_LABELS, MENU_LABELS, NOT_IN_QUEUE_LABELS } from '@/src/lib/sourceWorkqueue'
import {
  TRIAGE_NOTICE,
  PROPOSAL_KINDS,
  KIND_LABELS,
  UNUSABLE_REASONS,
  UNUSABLE_REASON_LABELS,
  STATUS_ROLES,
  NEXT_STEP_LABELS,
  NOTE_MAX,
  validateProposedUrl,
  validateProposalForm,
  validateDecisionForm,
} from '@/src/lib/sourceTriage'
const LOAD_ERROR = 'Bronnen beoordelen kon niet worden geladen.'

const BANNER_CLASS = { success: 'di-banner-info', notice: 'di-banner-neutral', error: 'di-banner-danger' }

function formatDateTime(value) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return `${d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}`
}

function actorText(actor) {
  if (!actor) return 'onbekend'
  if (actor.self) return 'jou'
  return actor.ref ? `medewerker ${actor.ref}` : 'onbekend'
}

// Status always shows icon + text; the role only adds colour.
function Badge({ tone, icon, children }) {
  return (
    <span className={`status-badge status-badge--${tone} stg-badge`}>
      <StatusIcon name={icon} />
      <span>{children}</span>
    </span>
  )
}

function SourceBadges({ entry }) {
  if (entry.source) {
    const s = SOURCE_BADGES[entry.source]
    const m = MENU_BADGES[entry.menu]
    return (
      <span className="stg-badges">
        {s && <Badge tone={s.tone} icon={s.icon}>Bron: {SOURCE_LABELS[entry.source]}</Badge>}
        {m && <Badge tone={m.tone} icon={m.icon}>Menukaart: {MENU_LABELS[entry.menu]}</Badge>}
      </span>
    )
  }
  return (
    <span className="stg-badges">
      <Badge tone="neutral" icon="dot">
        Nog niet in de werkvoorraad
      </Badge>
    </span>
  )
}

function ProposalBadge({ status }) {
  const role = STATUS_ROLES[status]
  if (!role) return null
  return (
    <Badge tone={role.tone} icon={role.icon}>
      Voorstel: {STATUS_LABELS[status]}
    </Badge>
  )
}

function ProposalSummary({ proposal }) {
  return (
    <dl className="stg-facts stg-facts--compact">
      <div>
        <dt>Voorstel</dt>
        <dd>{KIND_LABELS[proposal.kind] || proposal.kind}</dd>
      </div>
      {proposal.proposed_url && (
        <div>
          <dt>Voorgestelde URL</dt>
          <dd className="stg-url">{proposal.proposed_url}</dd>
        </div>
      )}
      {proposal.current_url && (
        <div>
          <dt>Bron op dat moment</dt>
          <dd className="stg-url">{proposal.current_url}</dd>
        </div>
      )}
      {proposal.unusable_reason && (
        <div>
          <dt>Reden</dt>
          <dd>{UNUSABLE_REASON_LABELS[proposal.unusable_reason] || proposal.unusable_reason}</dd>
        </div>
      )}
      {proposal.note && (
        <div>
          <dt>Toelichting</dt>
          <dd>{proposal.note}</dd>
        </div>
      )}
      <div>
        <dt>Voorgesteld</dt>
        <dd>
          door {actorText(proposal.proposed_by)}
          {formatDateTime(proposal.proposed_at) ? `, ${formatDateTime(proposal.proposed_at)}` : ''}
        </dd>
      </div>
      {proposal.status !== 'open' && (
        <div>
          <dt>{proposal.status === 'accepted' ? 'Geaccepteerd' : 'Afgewezen'}</dt>
          <dd>
            door {actorText(proposal.decided_by)}
            {formatDateTime(proposal.decided_at) ? `, ${formatDateTime(proposal.decided_at)}` : ''}
            {proposal.decision_note ? ` — ${proposal.decision_note}` : ''}
          </dd>
        </div>
      )}
    </dl>
  )
}

function DecisionForm({ proposal, busy, onDecide }) {
  const [note, setNote] = useState('')
  const [error, setError] = useState(null) // { message }: a new object per attempt, so focus moves every time
  const noteRef = useRef(null)
  const noteId = `stg-decision-note-${proposal.id}`
  const errorId = `${noteId}-error`

  // After a refused attempt, focus the note once its error is rendered and linked.
  useEffect(() => {
    if (error && noteRef.current) noteRef.current.focus()
  }, [error])

  function submit(decision) {
    const check = validateDecisionForm({ decision, note })
    if (!check.ok) {
      setError({ message: check.message })
      return
    }
    setError(null)
    onDecide(proposal.id, decision, note)
  }
  return (
    <div className="stg-form">
      {proposal.proposed_by && proposal.proposed_by.self && (
        <p className="stg-hint">Je beoordeelt je eigen voorstel.</p>
      )}
      <label htmlFor={noteId} className="stg-label">
        Toelichting <span className="stg-label-extra">(verplicht bij afwijzen, max. {NOTE_MAX} tekens, geen persoonsgegevens)</span>
      </label>
      <textarea
        id={noteId}
        ref={noteRef}
        className="stg-textarea"
        rows={2}
        maxLength={NOTE_MAX}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      {error && (
        <p id={errorId} className="stg-error" role="alert">
          {error.message}
        </p>
      )}
      <div className="stg-actions">
        <button type="button" className="di-btn-primary stg-btn" disabled={busy} onClick={() => submit('accepted')}>
          Voorstel accepteren
        </button>
        <button type="button" className="stg-btn-secondary" disabled={busy} onClick={() => submit('rejected')}>
          Voorstel afwijzen
        </button>
      </div>
      <p className="stg-notice">{TRIAGE_NOTICE} Accepteren publiceert niets en start geen controle.</p>
    </div>
  )
}

function ProposalForm({ entry, busy, onCreate, suggestion }) {
  const kinds = PROPOSAL_KINDS.filter((k) => k === 'add_candidate' || entry.known_url)
  const [kind, setKind] = useState(kinds[0])
  const [url, setUrl] = useState('')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState(null) // { field: 'url' | 'reason' | 'note', message }
  const [suggested, setSuggested] = useState(false)
  const suggestionApplied = useRef(false)
  const urlRef = useRef(null)
  const reasonRef = useRef(null)
  const noteRef = useRef(null)
  const base = `stg-new-${entry.restaurant_id}`
  const errorId = `${base}-error`
  const needsUrl = kind === 'add_candidate' || kind === 'replace_source'
  const noteRequired = !needsUrl && reason === 'other'
  const preview = needsUrl && url.trim() ? validateProposedUrl(url) : null

  // #59 review 6319894232 (R5): a fitting reason exists. On the human follow-up
  // of an image/scan menu, choosing "markeren als onbruikbaar" preselects the
  // existing `other` reason and fills in its fixed, required explanation — once,
  // and never over text the human already typed. No stored value is added.
  useEffect(() => {
    if (!suggestion || suggestionApplied.current) return
    if (kind !== suggestion.kind) return
    suggestionApplied.current = true
    setSuggested(true)
    setReason(suggestion.unusableReason)
    setNote((current) => (current.trim() ? current : suggestion.note))
  }, [kind, suggestion])

  // Only the control the error is about is marked invalid and described.
  const invalid = (field) => (error && error.field === field ? 'true' : undefined)
  const describedBy = (field, ...always) => [...always, error && error.field === field ? errorId : null].filter(Boolean).join(' ') || undefined
  const clearError = (...fields) => {
    if (error && fields.includes(error.field)) setError(null)
  }

  // After a refused attempt, focus the control in error once its message is
  // rendered and linked through aria-describedby.
  useEffect(() => {
    const ref = error && { url: urlRef, reason: reasonRef, note: noteRef }[error.field]
    if (ref && ref.current) ref.current.focus()
  }, [error])

  function submit(e) {
    e.preventDefault()
    const check = validateProposalForm({ kind, url, reason, note, knownUrl: entry.known_url })
    if (!check.ok) {
      setError({ field: check.field, message: check.message })
      return
    }
    setError(null)
    onCreate({
      restaurant_id: entry.restaurant_id,
      kind,
      proposed_url: needsUrl ? url : undefined,
      unusable_reason: needsUrl ? undefined : reason,
      note,
    })
  }

  return (
    <form className="stg-form" onSubmit={submit} noValidate>
      <fieldset className="stg-fieldset">
        <legend className="stg-label">Soort voorstel</legend>
        <div className="stg-kinds">
          {kinds.map((k) => (
            <label key={k} className="stg-kind">
              <input
                type="radio"
                name={`${base}-kind`}
                value={k}
                checked={kind === k}
                onChange={() => {
                  setKind(k)
                  setError(null)
                }}
              />
              <span>{KIND_LABELS[k]}</span>
            </label>
          ))}
        </div>
        {!entry.known_url && (
          <p className="stg-hint">Vervangen en markeren als onbruikbaar kan pas als er een bekende bron-URL is.</p>
        )}
      </fieldset>

      {needsUrl ? (
        <div className="stg-field">
          <label htmlFor={`${base}-url`} className="stg-label">
            {kind === 'replace_source' ? 'Nieuwe bron-URL' : 'Kandidaat-URL'}
          </label>
          <input
            id={`${base}-url`}
            ref={urlRef}
            className="stg-input"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value)
              clearError('url')
            }}
            aria-invalid={invalid('url')}
            aria-describedby={describedBy('url', `${base}-url-help`)}
          />
          <p id={`${base}-url-help`} className="stg-hint">
            {preview && preview.ok
              ? `Wordt opgeslagen als: ${preview.url}`
              : 'Alleen het webadres wordt opgeslagen, zonder ?-parameters of #-deel. De URL wordt niet bezocht.'}
          </p>
        </div>
      ) : (
        <div className="stg-field">
          <label htmlFor={`${base}-reason`} className="stg-label">
            Reden
          </label>
          <select
            id={`${base}-reason`}
            ref={reasonRef}
            className="stg-input"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value)
              clearError('reason', 'note')
            }}
            aria-invalid={invalid('reason')}
            aria-describedby={describedBy('reason', suggested && suggestion ? `${base}-reason-help` : null)}
          >
            <option value="">Kies een reden</option>
            {UNUSABLE_REASONS.map((r) => (
              <option key={r} value={r}>
                {UNUSABLE_REASON_LABELS[r]}
              </option>
            ))}
          </select>
          {suggested && suggestion && (
            <p id={`${base}-reason-help`} className="stg-hint stg-followup-suggestion">
              {suggestion.explain}
            </p>
          )}
        </div>
      )}

      <div className="stg-field">
        <label htmlFor={`${base}-note`} className="stg-label">
          Toelichting{' '}
          <span className="stg-label-extra">
            ({noteRequired ? 'verplicht bij Andere reden' : 'optioneel'}, max. {NOTE_MAX} tekens, geen persoonsgegevens)
          </span>
        </label>
        <textarea
          id={`${base}-note`}
          ref={noteRef}
          className="stg-textarea"
          rows={2}
          maxLength={NOTE_MAX}
          value={note}
          onChange={(e) => {
            setNote(e.target.value)
            clearError('note')
          }}
          aria-required={noteRequired ? 'true' : undefined}
          aria-invalid={invalid('note')}
          aria-describedby={describedBy('note')}
        />
      </div>

      {error && (
        <p id={errorId} className="stg-error" role="alert">
          {error.message}
        </p>
      )}
      <div className="stg-actions">
        <button type="submit" className="di-btn-primary stg-btn" disabled={busy}>
          Voorstel opslaan
        </button>
      </div>
      <p className="stg-notice">{TRIAGE_NOTICE} Een voorstel wijzigt niets aan gepubliceerde gegevens.</p>
    </form>
  )
}

function Detail({ entry, proposalsAvailable, busy, onCreate, onDecide, headingRef, followUp }) {
  const open = entry.proposals.find((p) => p.status === 'open') || null
  const history = entry.proposals.filter((p) => p.status !== 'open')
  const checked = formatDateTime(entry.checked_at)
  return (
    <article className="stg-detail-card" aria-labelledby="stg-detail-title">
      <h2 id="stg-detail-title" className="stg-detail-title" tabIndex={-1} ref={headingRef}>
        {entry.name}
      </h2>
      {entry.wijk && <p className="stg-muted">{entry.wijk}</p>}

      <dl className="stg-facts">
        <div>
          <dt>Bronstatus</dt>
          <dd>
            <SourceBadges entry={entry} />
          </dd>
        </div>
        <div>
          <dt>Waarom aandacht</dt>
          <dd>{entry.attention || '—'}</dd>
        </div>
        <div>
          <dt>Bekende bron-URL</dt>
          <dd className="stg-url">
            {entry.known_url ? (
              <a href={entry.known_url} target="_blank" rel="noopener noreferrer" className="stg-link">
                {entry.known_url}
                <ExternalLinkIcon size={12} className="stg-ext-icon" />
              </a>
            ) : (
              'Geen website bekend'
            )}
          </dd>
        </div>
        <div>
          <dt>Laatste controle</dt>
          <dd>{checked || (entry.not_in_queue_reason ? NOT_IN_QUEUE_LABELS[entry.not_in_queue_reason] : 'Onbekend')}</dd>
        </div>
        <div>
          <dt>Vervolgstap</dt>
          <dd>
            {followUp ? (
              <>
                {followUp.nextStep}
                <p className="stg-hint">Algemene route: {NEXT_STEP_LABELS[entry.next_step]}</p>
              </>
            ) : entry.next_step === 'check_via_onboarding' ? (
              <a href="/internal/onboarding-restaurant" className="stg-link">
                {NEXT_STEP_LABELS[entry.next_step]}
              </a>
            ) : (
              NEXT_STEP_LABELS[entry.next_step]
            )}
          </dd>
        </div>
      </dl>

      {followUp && (
        <section className="stg-section stg-followup" aria-labelledby="stg-followup-title">
          <h3 id="stg-followup-title" className="stg-section-title">
            {followUp.title}
          </h3>
          <dl className="stg-facts">
            <div>
              <dt>Reden</dt>
              <dd>{followUp.reason}</dd>
            </div>
            <div>
              <dt>Wat dit betekent</dt>
              <dd>{followUp.detail}</dd>
            </div>
          </dl>
        </section>
      )}

      {!proposalsAvailable ? (
        <p className="stg-muted">Voorstellen kunnen nu niet worden geladen of opgeslagen.</p>
      ) : open ? (
        <section className="stg-section" aria-labelledby="stg-open-title">
          <h3 id="stg-open-title" className="stg-section-title">
            Open voorstel
          </h3>
          <ProposalBadge status="open" />
          <ProposalSummary proposal={open} />
          <DecisionForm key={open.id} proposal={open} busy={busy} onDecide={onDecide} />
        </section>
      ) : (
        <section className="stg-section" aria-labelledby="stg-new-title">
          <h3 id="stg-new-title" className="stg-section-title">
            Voorstel doen
          </h3>
          <ProposalForm key={entry.restaurant_id} entry={entry} busy={busy} onCreate={onCreate} suggestion={followUp ? followUp.suggestion : null} />
        </section>
      )}

      {proposalsAvailable && (
        <section className="stg-section" aria-labelledby="stg-history-title">
          <h3 id="stg-history-title" className="stg-section-title">
            Geschiedenis
          </h3>
          {entry.proposals.length === 0 ? (
            <p className="stg-muted">Nog geen voorstellen voor dit restaurant.</p>
          ) : (
            <ol className="stg-history">
              {[...(open ? [open] : []), ...history].map((p) => (
                <li key={p.id} className="stg-history-item">
                  <div className="stg-history-head">
                    <ProposalBadge status={p.status} />
                    <span className="stg-history-kind">{KIND_LABELS[p.kind]}</span>
                  </div>
                  {p.status !== 'open' && <ProposalSummary proposal={p} />}
                  <ol className="stg-events" aria-label="Audittrail">
                    {p.events.map((ev, i) => (
                      <li key={i}>
                        {EVENT_LABELS[ev.event] || ev.event} door {actorText(ev.actor)}
                        {formatDateTime(ev.created_at) ? `, ${formatDateTime(ev.created_at)}` : ''}
                        {ev.note ? ` — ${ev.note}` : ''}
                      </li>
                    ))}
                  </ol>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </article>
  )
}

// Save feedback lives in two live regions that are rendered with the detail
// pane, before any message exists: a message placed in them later is
// announced. Success and notice go to the polite status region, errors to
// the alert region. The wrapper takes focus after every save, so focus is
// never lost when the submitted form itself disappears.
function FeedbackRegion({ message, regionRef }) {
  const isError = Boolean(message) && message.tone === 'error'
  const banner = message ? <div className={`di-banner ${BANNER_CLASS[message.tone] || 'di-banner-neutral'}`}>{message.text}</div> : null
  return (
    <div id="stg-feedback" className="stg-feedback" ref={regionRef} tabIndex={-1}>
      <div role="status" aria-live="polite" aria-atomic="true">
        {message && !isError ? banner : null}
      </div>
      <div role="alert" aria-atomic="true">
        {isError ? banner : null}
      </div>
    </div>
  )
}

export { Detail, FeedbackRegion, formatDateTime, actorText }
