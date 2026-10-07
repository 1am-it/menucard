'use client'

// Brontriage — internal, proposal-only source triage
// (planning/specs/tickets/be-24-internal-source-triage.md). Same
// authenticated-API pattern as every other internal page: the session comes
// from src/lib/supabaseBrowser.js, the data from
// /api/internal/v1/source-triage — never direct Supabase access from the
// browser. Reachable under Werkvoorraad → Brontriage in InternalNav.
//
// Per restaurant: the BE-23 source status (or why it is not in the
// workqueue), why it needs attention, the known source URL, the last check
// and the one safe next step. Staff can record a PROPOSAL (add a candidate
// URL, replace the source, mark it unusable) and accept or reject an open
// proposal. Nothing here fetches a website, starts an analysis or publishes:
// "Wijzigingen worden pas na controle verwerkt."

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import InternalNav from '@/src/components/InternalNav'
import StatusIcon from '@/src/components/StatusIcon'
import ExternalLinkIcon from '@/src/components/ExternalLinkIcon'
import { SOURCE_LABELS, MENU_LABELS, NOT_IN_QUEUE_LABELS } from '@/src/lib/sourceWorkqueue'
import {
  TRIAGE_NOTICE,
  PROPOSAL_KINDS,
  KIND_LABELS,
  UNUSABLE_REASONS,
  UNUSABLE_REASON_LABELS,
  STATUS_LABELS,
  STATUS_ROLES,
  SOURCE_BADGES,
  MENU_BADGES,
  EVENT_LABELS,
  NEXT_STEP_LABELS,
  NOTE_MAX,
  TRIAGE_FILTERS,
  TRIAGE_FILTER_LABELS,
  validateProposedUrl,
  filterTriage,
  countTriage,
} from '@/src/lib/sourceTriage'

const LOAD_ERROR = 'De brontriage kon niet worden geladen.'

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
  const [error, setError] = useState(null)
  const noteId = `stg-decision-note-${proposal.id}`
  const errorId = `${noteId}-error`
  function submit(decision) {
    if (decision === 'rejected' && note.trim() === '') {
      setError('Geef een reden voor het afwijzen.')
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
          {error}
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

function ProposalForm({ entry, busy, onCreate }) {
  const kinds = PROPOSAL_KINDS.filter((k) => k === 'add_candidate' || entry.known_url)
  const [kind, setKind] = useState(kinds[0])
  const [url, setUrl] = useState('')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState(null)
  const base = `stg-new-${entry.restaurant_id}`
  const needsUrl = kind === 'add_candidate' || kind === 'replace_source'
  const preview = needsUrl && url.trim() ? validateProposedUrl(url) : null

  function submit(e) {
    e.preventDefault()
    if (needsUrl) {
      const v = validateProposedUrl(url)
      if (!v.ok) return setError(v.message)
      if (entry.known_url && v.url === entry.known_url) return setError('Deze URL is al de bekende bron.')
    } else {
      if (!reason) return setError('Kies een reden.')
      if (reason === 'other' && note.trim() === '') return setError('Geef een korte toelichting.')
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
            className="stg-input"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={`${base}-url-help${error ? ` ${base}-error` : ''}`}
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
            className="stg-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? `${base}-error` : undefined}
          >
            <option value="">Kies een reden</option>
            {UNUSABLE_REASONS.map((r) => (
              <option key={r} value={r}>
                {UNUSABLE_REASON_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="stg-field">
        <label htmlFor={`${base}-note`} className="stg-label">
          Toelichting{' '}
          <span className="stg-label-extra">
            ({!needsUrl && reason === 'other' ? 'verplicht' : 'optioneel'}, max. {NOTE_MAX} tekens, geen persoonsgegevens)
          </span>
        </label>
        <textarea id={`${base}-note`} className="stg-textarea" rows={2} maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      {error && (
        <p id={`${base}-error`} className="stg-error" role="alert">
          {error}
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

function Detail({ entry, proposalsAvailable, busy, onCreate, onDecide, headingRef }) {
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
            {entry.next_step === 'check_via_onboarding' ? (
              <a href="/internal/onboarding-restaurant" className="stg-link">
                {NEXT_STEP_LABELS[entry.next_step]}
              </a>
            ) : (
              NEXT_STEP_LABELS[entry.next_step]
            )}
          </dd>
        </div>
      </dl>

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
          <ProposalForm key={entry.restaurant_id} entry={entry} busy={busy} onCreate={onCreate} />
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

export default function SourceTriagePage() {
  const router = useRouter()
  const [session, setSession] = useState(undefined) // undefined = loading, null = no session
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null) // { tone: 'success' | 'error', text }
  const headingRef = useRef(null)
  const focusDetail = useRef(false)

  useEffect(() => {
    const supabase = getSupabaseBrowser()
    supabase.auth.getSession().then(({ data: sessionData }) => {
      if (!sessionData.session) router.replace('/internal/login')
      else setSession(sessionData.session)
    })
  }, [router])

  const load = useCallback(async (token) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/internal/v1/source-triage', { headers: { Authorization: `Bearer ${token}` } })
      const body = await res.json()
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
  }, [])

  useEffect(() => {
    if (session) load(session.access_token)
  }, [session, load])

  const entries = useMemo(() => (data && data.restaurants) || [], [data])
  const counts = useMemo(() => countTriage(entries), [entries])
  const visible = useMemo(() => filterTriage(entries, { filter, query }), [entries, filter, query])
  const selected = entries.find((e) => e.restaurant_id === selectedId) || null

  useEffect(() => {
    if (focusDetail.current && headingRef.current) {
      focusDetail.current = false
      headingRef.current.focus()
    }
  }, [selectedId])

  function select(id) {
    setMessage(null)
    focusDetail.current = true
    setSelectedId(id)
  }

  async function post(url, payload, successText) {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage({ tone: 'error', text: body.error || 'Opslaan is niet gelukt.' })
        return
      }
      setMessage({ tone: 'success', text: successText })
      await load(session.access_token)
    } catch {
      setMessage({ tone: 'error', text: 'Opslaan is niet gelukt.' })
    } finally {
      setBusy(false)
    }
  }

  function createProposal(payload) {
    return post('/api/internal/v1/source-triage/proposals', payload, `Voorstel opgeslagen. ${TRIAGE_NOTICE}`)
  }
  function decideProposal(id, decision, note) {
    const text =
      decision === 'accepted'
        ? 'Voorstel geaccepteerd. Er is niets gepubliceerd en er is geen controle gestart.'
        : 'Voorstel afgewezen. De bron blijft ongewijzigd.'
    return post(`/api/internal/v1/source-triage/proposals/${encodeURIComponent(id)}/decision`, { decision, note }, text)
  }

  if (session === undefined) {
    return (
      <div className="di-page">
        <main className="di-main stg-main stg-loading">Laden…</main>
      </div>
    )
  }

  return (
    <div className="di-page">
      <main className="di-main stg-main">
        <InternalNav accessToken={session.access_token} />

        <div className="stg-header">
          <h1 className="di-title">Brontriage</h1>
          <p className="stg-subtitle">
            <span>{(data && data.city) || 'Breda'}</span>
            <span aria-hidden="true"> · </span>
            <span>{counts.all} restaurants</span>
            <span aria-hidden="true"> · </span>
            <strong>{TRIAGE_NOTICE}</strong>
          </p>
          <p className="stg-muted">
            Leg een voorstel vast over de bron van een restaurant. Een voorstel publiceert niets, haalt geen website op en
            start geen controle.
          </p>
        </div>

        {error && (
          <div className="di-banner di-banner-danger" role="alert">
            {error}
          </div>
        )}
        {loading && !data && <p className="stg-muted">Laden…</p>}

        {data && (
          <>
            {!data.proposals_available && (
              <div className="di-banner di-banner-neutral" role="status">
                Voorstellen konden niet worden geladen. De bronstatus hieronder is wel actueel; voorstellen doen en
                beoordelen kan nu niet.
              </div>
            )}

            <div className="stg-filters">
              <div className="stg-filter-group" role="group" aria-label="Restaurants filteren">
                {TRIAGE_FILTERS.map((f) => (
                  <button key={f} type="button" className="stg-filter" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                    <span>{TRIAGE_FILTER_LABELS[f]}</span>
                    <span className="stg-count">{counts[f]}</span>
                  </button>
                ))}
              </div>
              <div className="stg-search">
                <label htmlFor="stg-search" className="visually-hidden">
                  Zoek restaurant of domein
                </label>
                <input id="stg-search" type="search" placeholder="Zoek restaurant of domein" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
            </div>

            <div className="stg-layout">
              <section className="stg-list" aria-labelledby="stg-list-title">
                <h2 id="stg-list-title" className="visually-hidden">
                  Restaurants
                </h2>
                <p className="stg-result-count" aria-live="polite">
                  {visible.length} van {counts.all} restaurants
                </p>
                {visible.length === 0 ? (
                  <p className="stg-empty">Geen restaurants voor deze selectie.</p>
                ) : (
                  <ul className="stg-items">
                    {visible.map((e) => {
                      const isSelected = e.restaurant_id === selectedId
                      return (
                        <li key={e.restaurant_id}>
                          <button
                            type="button"
                            className="stg-item"
                            aria-current={isSelected ? 'true' : undefined}
                            aria-controls="stg-detail"
                            onClick={() => select(e.restaurant_id)}
                          >
                            <span className="stg-item-name">{e.name}</span>
                            <span className="stg-item-meta">{[e.wijk, e.domain].filter(Boolean).join(' · ') || 'Geen website bekend'}</span>
                            {e.attention && <span className="stg-item-attention">{e.attention}</span>}
                            <span className="stg-item-step">Vervolgstap: {NEXT_STEP_LABELS[e.next_step]}</span>
                            {e.open_proposal_id && <ProposalBadge status="open" />}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>

              <section id="stg-detail" className="stg-detail" aria-label="Details">
                {message && (
                  <div className={`di-banner ${message.tone === 'error' ? 'di-banner-danger' : 'di-banner-info'}`} role={message.tone === 'error' ? 'alert' : 'status'}>
                    {message.text}
                  </div>
                )}
                {selected ? (
                  <Detail
                    entry={selected}
                    proposalsAvailable={data.proposals_available}
                    busy={busy}
                    onCreate={createProposal}
                    onDecide={decideProposal}
                    headingRef={headingRef}
                  />
                ) : (
                  <p className="stg-empty">Kies een restaurant om de bron te bekijken of een voorstel te doen.</p>
                )}
              </section>
            </div>

            {(data.orphan_proposals > 0 || data.unattributed_checks > 0 || data.job_limit_reached || data.proposal_limit_reached) && (
              <div className="stg-footnotes">
                {data.orphan_proposals > 0 && (
                  <p className="stg-muted">{data.orphan_proposals} voorstel(len) horen bij een restaurant dat niet meer in de lijst staat.</p>
                )}
                {data.unattributed_checks > 0 && (
                  <p className="stg-muted">{data.unattributed_checks} controle(s) konden niet aan precies één restaurant worden gekoppeld.</p>
                )}
                {(data.job_limit_reached || data.proposal_limit_reached) && (
                  <p className="stg-muted">Alleen de meest recente controles en voorstellen zijn geladen.</p>
                )}
              </div>
            )}

            <p className="stg-footnote">{TRIAGE_NOTICE} Niets wordt automatisch gepubliceerd.</p>
          </>
        )}
      </main>
    </div>
  )
}
