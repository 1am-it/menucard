'use client'

// Batchanalyse (BE-25 fase 2) — the presentational part of the page: every
// visible state (input with pre-check, open batch with progress, read-only
// colleague view, results with their next steps, inline and bulk
// confirmation, side panels). It receives data and callbacks from page.js
// and never fetches anything itself.

import { useEffect, useMemo, useRef, useState } from 'react'
import StatusIcon from '@/src/components/StatusIcon'
import { MAX_BATCH_URLS, DAILY_URL_LIMIT, COPY, ACTION_LABELS, precheckLines, splitLines } from '@/src/lib/batchAnalysis'

function timeOf(value) {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
}

function dayLabel(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const same = (a, b) => a.toDateString() === b.toDateString()
  if (same(d, today)) return `Vandaag ${timeOf(value)}`
  if (same(d, yesterday)) return `Gisteren ${timeOf(value)}`
  return `${d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })} ${timeOf(value)}`
}

function batchStateText(b) {
  const n = `${b.item_count} URL${b.item_count === 1 ? '' : "'s"}`
  if (!b.closed_at) return `${n} · open`
  if (b.close_reason === 'expired') return `${n} · verlopen`
  return `${n} · klaar voor controle`
}

function Badge({ role, icon, children }) {
  return (
    <span className={`status-badge status-badge--${role} bta-badge`}>
      <StatusIcon name={icon} />
      <span>{children}</span>
    </span>
  )
}

function Explainer() {
  return (
    <ul className="bta-explainer">
      <li>Maximaal {MAX_BATCH_URLS} URL&apos;s per batch, handmatig ingevoerd.</li>
      <li>De analyse loopt alleen zolang jij deze pagina open hebt. Sluiten pauzeert; terugkomen hervat.</li>
      <li>Geen AI, geen OCR, geen automatische wijziging van restaurantgegevens.</li>
      <li>
        Zeker resultaat: bevestig de bron hier. Twijfel, robots.txt of geen bruikbare menukaart: beoordeel handmatig in
        Bronnen beoordelen.
      </li>
      <li>Onbekende restaurants gaan naar Onboarding Restaurant.</li>
    </ul>
  )
}

function SidePanels({ data, selectedId, onSelect }) {
  const daily = (data && data.daily) || { used: 0, limit: DAILY_URL_LIMIT }
  const recent = (data && data.recent_batches) || []
  return (
    <>
      <section className="bta-side-card bta-desktop-only" aria-labelledby="bta-how">
        <h2 id="bta-how" className="bta-side-title">
          Zo werkt deze analyse
        </h2>
        <Explainer />
      </section>
      <details className="bta-side-card bta-mobile-only">
        <summary className="bta-side-title">Zo werkt deze analyse</summary>
        <Explainer />
      </details>
      <section className="bta-side-card" aria-labelledby="bta-limit">
        <h2 id="bta-limit" className="bta-side-title">
          Jouw limiet vandaag
        </h2>
        <p className="bta-side-text">
          <strong>{daily.used}</strong> van {daily.limit} URL&apos;s gebruikt
        </p>
        <p className="bta-side-muted">Recent geanalyseerde URL&apos;s tellen niet mee. Teller loopt per kalenderdag.</p>
      </section>
      <section className="bta-side-card" aria-labelledby="bta-recent">
        <h2 id="bta-recent" className="bta-side-title">
          Recente batches
        </h2>
        {recent.length === 0 ? (
          <p className="bta-side-muted">Nog geen batches. Je eerste batch verschijnt hier, met elk resultaat.</p>
        ) : (
          <ul className="bta-recent">
            {recent.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  className="bta-recent-item"
                  aria-current={b.id === selectedId ? 'true' : undefined}
                  onClick={() => onSelect(b.id)}
                >
                  <span className="bta-recent-when">{dayLabel(b.created_at)}</span>
                  <span className="bta-recent-state">{batchStateText(b)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

function InputCard({ text, setText, daily, ownOpenBatchId, onStart, busy, error, onShowOpen }) {
  const check = useMemo(() => precheckLines(text), [text])
  const lineCount = splitLines(text).length
  const remaining = Math.max(0, (daily ? daily.limit : DAILY_URL_LIMIT) - (daily ? daily.used : 0))
  let blocked = null
  if (ownOpenBatchId) blocked = 'Je hebt al een open batch. Rond die eerst af.'
  else if (check.tooMany) blocked = `Maximaal ${MAX_BATCH_URLS} regels per batch.`
  else if (check.queueableCount === 0) blocked = 'Plak minstens één geldige URL om te starten.'
  else if (check.queueableCount > remaining) blocked = `Je hebt vandaag nog ${remaining} URL's over.`

  function submit(e) {
    e.preventDefault()
    if (!blocked && !busy) onStart(check.entries.map((entry) => entry.raw))
  }

  return (
    <form className="bta-card" onSubmit={submit} aria-labelledby="bta-input-title">
      <div className="bta-card-head">
        <h2 id="bta-input-title" className="bta-card-title">
          URL&apos;s invoeren
        </h2>
        <span className="bta-muted">
          {lineCount} van {MAX_BATCH_URLS} regels
        </span>
      </div>
      <label className="bta-label" htmlFor="bta-urls">
        Restaurant-URL&apos;s, één per regel
      </label>
      <textarea
        id="bta-urls"
        className="bta-textarea"
        rows={8}
        value={text}
        placeholder="https://restaurant.example"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-describedby="bta-urls-help"
        onChange={(e) => setText(e.target.value)}
      />
      <p id="bta-urls-help" className="bta-muted">
        Alleen het webadres wordt opgeslagen, zonder ?-parameters of #-deel. Er worden geen andere pagina&apos;s gezocht
        dan BE-20 toestaat.
      </p>

      {check.entries.length > 0 && (
        <div className="bta-precheck">
          <h3 className="bta-subtitle">Controle vooraf</h3>
          <ul className="bta-precheck-list">
            {check.entries.map((entry) => (
              <li key={entry.line} className="bta-precheck-item">
                <span className="bta-url">{entry.raw}</span>
                {entry.status === 'ok' && <span className="bta-muted">Wordt geanalyseerd.</span>}
                {entry.status === 'duplicate' && (
                  <>
                    <Badge role="neutral" icon="dot">
                      Dubbel in deze lijst
                    </Badge>
                    <span className="bta-muted">Zelfde adres als regel {entry.duplicateOf}; wordt één keer geanalyseerd.</span>
                  </>
                )}
                {entry.status === 'invalid' && (
                  <>
                    <Badge role="blocked" icon="cross">
                      Ongeldige URL
                    </Badge>
                    <span className="bta-muted">Geen geldig webadres; pas de regel aan.</span>
                  </>
                )}
              </li>
            ))}
          </ul>
          <p className="bta-muted">
            Een URL die al in een andere actieve batch staat, wordt niet opnieuw in de wachtrij gezet. Een URL met een
            resultaat van hooguit 7 dagen wordt niet opnieuw opgehaald.
          </p>
        </div>
      )}

      <div role="alert">{error && <div className="di-banner di-banner-danger">{error}</div>}</div>

      <div className="bta-start">
        <button type="submit" className="di-btn-primary bta-btn" aria-disabled={blocked || busy ? 'true' : undefined} aria-describedby="bta-start-note">
          {busy ? 'Bezig met starten…' : COPY.start}
        </button>
        <p id="bta-start-note" className="bta-muted">
          {blocked ||
            `${check.queueableCount} URL${check.queueableCount === 1 ? '' : "'s"} worden geanalyseerd · telt ${check.queueableCount} van je ${remaining} resterende voor vandaag`}
        </p>
        {ownOpenBatchId && (
          <button type="button" className="stg-btn-secondary bta-btn" onClick={onShowOpen}>
            Naar je open batch
          </button>
        )}
      </div>
    </form>
  )
}

function ResultCard({ item, isStarter, batchOpen, ownOpenBatchId, confirming, setConfirming, onConfirm, onRerun, onAdjust, busy }) {
  const [details, setDetails] = useState(false)
  const confirmRef = useRef(null)
  const restaurantName = item.restaurant && item.restaurant.name
  const knownText = item.restaurant ? `Bekend restaurant · ${restaurantName}` : item.key === 'menu_found' || item.key === 'needs_review' ? 'Onbekend restaurant' : null
  const open = Boolean(item.jobId) && confirming === item.jobId

  useEffect(() => {
    if (open && confirmRef.current) confirmRef.current.focus()
  }, [open])

  const canAct = isStarter
  const rerunBlocked = Boolean(ownOpenBatchId) || batchOpen
  const actions = canAct ? item.actions : []
  const reviewHref = item.restaurant ? '/internal/source-triage' : `/internal/onboarding-restaurant${item.url ? `?url=${encodeURIComponent(item.url)}` : ''}`

  function actionButton(action, primary) {
    const cls = primary ? 'di-btn-primary bta-btn' : 'stg-btn-secondary bta-btn'
    if (action === 'confirm') {
      return (
        <button key={action} type="button" className={cls} onClick={() => setConfirming(item.jobId)} disabled={busy}>
          {ACTION_LABELS.confirm}
        </button>
      )
    }
    if (action === 'review_manually') {
      return (
        <a key={action} className={cls} href={reviewHref}>
          {ACTION_LABELS.review_manually}
        </a>
      )
    }
    if (action === 'onboarding') {
      return (
        <a key={action} className={cls} href={`/internal/onboarding-restaurant${item.url ? `?url=${encodeURIComponent(item.url)}` : ''}`}>
          {ACTION_LABELS.onboarding}
        </a>
      )
    }
    if (action === 'adjust_url') {
      return (
        <button key={action} type="button" className={cls} onClick={() => onAdjust(item.url || '')} aria-disabled={rerunBlocked ? 'true' : undefined} disabled={busy}>
          {ACTION_LABELS.adjust_url}
        </button>
      )
    }
    if (action === 'retry' || action === 'reanalyze') {
      return (
        <button key={action} type="button" className={cls} onClick={() => onRerun(item.url)} aria-disabled={rerunBlocked ? 'true' : undefined} disabled={busy || !item.url}>
          {ACTION_LABELS[action]}
        </button>
      )
    }
    return null
  }

  return (
    <li className={`bta-result${open ? ' bta-result--confirming' : ''}`}>
      <div className="bta-result-head">
        <div className="bta-result-id">
          <span className="bta-url bta-url--strong">{item.url || `Regel ${item.position}`}</span>
          {knownText && <span className="bta-muted">{knownText}</span>}
        </div>
        <Badge role={item.role} icon={item.icon}>
          {item.label}
        </Badge>
      </div>
      {item.text && <p className="bta-result-text">{item.text}</p>}
      {item.foundUrl && (
        <dl className="bta-facts">
          <div>
            <dt>Gevonden menukaart</dt>
            <dd className="bta-url">{item.foundUrl}</dd>
          </div>
          {details && restaurantName && (
            <div>
              <dt>Herkende naam</dt>
              <dd>{restaurantName}</dd>
            </div>
          )}
        </dl>
      )}

      {details && item.notes.length > 0 && (
        <ul className="bta-notes" aria-label="Analysedetails">
          {item.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      {open && (
        <div className="bta-confirm" role="group" aria-labelledby={`bta-confirm-${item.jobId}`}>
          <p id={`bta-confirm-${item.jobId}`} className="bta-confirm-title">
            Bron bevestigen voor {restaurantName}?
          </p>
          <p className="bta-muted">
            Je bevestigt na eigen controle dat deze menukaart de bron van {restaurantName} is. Er wordt niets
            gepubliceerd.
          </p>
          <div className="bta-actions">
            <button ref={confirmRef} type="button" className="di-btn-primary bta-btn" disabled={busy} onClick={() => onConfirm([item.jobId])}>
              {ACTION_LABELS.confirm}
            </button>
            <button type="button" className="stg-btn-secondary bta-btn" onClick={() => setConfirming(null)}>
              Annuleren
            </button>
          </div>
        </div>
      )}

      {!open && (
        <div className="bta-actions">
          {actions.map((a, i) => actionButton(a, i === 0))}
          {(item.foundUrl || item.restaurant || item.notes.length > 0) && (
            <button type="button" className="stg-btn-secondary bta-btn" aria-expanded={details} onClick={() => setDetails((d) => !d)}>
              Details bekijken
            </button>
          )}
        </div>
      )}
      {canAct && rerunBlocked && actions.some((a) => a === 'retry' || a === 'reanalyze' || a === 'adjust_url') && (
        <p className="bta-muted">Kan pas als je open batch klaar is.</p>
      )}
    </li>
  )
}

function BatchDetail({ detail, ownOpenBatchId, busy, confirming, setConfirming, onConfirm, onRerun, onAdjust, onNew, notice }) {
  const { batch, items, summary } = detail
  const isStarter = batch.is_starter
  const batchOpen = !batch.closed_at
  const high = items.filter((i) => i.high && i.actions.includes('confirm'))
  const [bulkOpen, setBulkOpen] = useState(false)
  const bulkRef = useRef(null)
  const percent = summary.total > 0 ? Math.round((summary.done / summary.total) * 100) : 0

  useEffect(() => {
    if (bulkOpen && bulkRef.current) bulkRef.current.focus()
  }, [bulkOpen])

  const chips = Object.entries(summary.byAction)
    .filter(([, n]) => n > 0)
    .map(([action, n]) => `${n} × ${ACTION_LABELS[action]}`)

  return (
    <section className="bta-card" aria-labelledby="bta-batch-title">
      <div className="bta-card-head">
        <div>
          <h2 id="bta-batch-title" className="bta-card-title">
            Batch van {dayLabel(batch.created_at).toLowerCase()}
          </h2>
          <p className="bta-muted">
            {isStarter ? 'Gestart door jou · ' : ''}
            {summary.total} URL{summary.total === 1 ? '' : "'s"}
            {!isStarter ? ' · alleen lezen' : ''}
          </p>
        </div>
        {isStarter && !batchOpen && (
          <button type="button" className="stg-btn-secondary bta-btn" onClick={onNew}>
            Nieuwe batch
          </button>
        )}
      </div>

      {batchOpen && isStarter && (
        <div className="di-banner di-banner-info" role="note">
          <span className="di-banner-icon">
            <StatusIcon name="clock" />
          </span>
          <span>{COPY.keepOpen}</span>
        </div>
      )}
      {batchOpen && !isStarter && (
        <div className="di-banner di-banner-neutral" role="status">
          <span className="di-banner-icon">
            <StatusIcon name="clock" />
          </span>
          <span>
            <strong>{COPY.colleaguePaused}</strong> {COPY.colleagueReadOnly}
          </span>
        </div>
      )}
      {!batchOpen && batch.close_reason === 'expired' && (
        <div className="di-banner di-banner-neutral" role="status">
          Deze batch is verlopen na 24 uur zonder activiteit. Niet afgeronde URL&apos;s staan op Fout; probeer ze opnieuw in
          een nieuwe batch.
        </div>
      )}

      <div className="bta-progress-row">
        <span className="bta-progress-label">
          {batchOpen ? `${summary.done} van ${summary.total} klaar` : `Klaar voor controle · ${summary.done} van ${summary.total}`}
        </span>
        <span className="bta-muted">
          {batchOpen
            ? `${summary.running} bezig · ${summary.queued} in wachtrij`
            : `${summary.byAction.confirm || 0} voor bevestiging · ${(summary.byAction.review_manually || 0) + (summary.byAction.retry || 0) + (summary.byAction.adjust_url || 0)} met vervolgstap`}
        </span>
      </div>
      <div
        className="bta-progress"
        role="progressbar"
        aria-label="Voortgang van de batch"
        aria-valuemin={0}
        aria-valuemax={summary.total}
        aria-valuenow={summary.done}
        aria-valuetext={`${summary.done} van ${summary.total} klaar`}
      >
        <span className="bta-progress-fill" style={{ width: `${percent}%` }} />
      </div>

      {chips.length > 0 && isStarter && (
        <ul className="bta-chips" aria-label="Samenvatting per vervolgstap">
          {chips.map((c) => (
            <li key={c} className="bta-chip">
              {c}
            </li>
          ))}
        </ul>
      )}

      {isStarter && high.length >= 2 && (
        <div className={`bta-bulk${bulkOpen ? ' bta-bulk--open' : ''}`}>
          {!bulkOpen ? (
            <>
              <div>
                <p className="bta-bulk-title">{high.length} resultaten met voldoende zekerheid</p>
                <p className="bta-muted">Bevestig ze samen of per resultaat. Elke bevestiging is een menselijke kwaliteitscontrole.</p>
              </div>
              <button type="button" className="di-btn-primary bta-btn" onClick={() => setBulkOpen(true)} disabled={busy}>
                Bevestig {high.length} bronnen
              </button>
            </>
          ) : (
            <div role="group" aria-labelledby="bta-bulk-title" className="bta-bulk-step">
              <p id="bta-bulk-title" className="bta-bulk-title">
                {high.length} bronnen bevestigen?
              </p>
              <p className="bta-muted">
                Je bevestigt na eigen controle dat deze menukaarten de bron van deze restaurants zijn. Er wordt niets
                gepubliceerd.
              </p>
              <ul className="bta-bulk-list">
                {high.map((i) => (
                  <li key={i.jobId}>
                    <span className="bta-url">{i.foundUrl}</span>
                    <span className="bta-muted">{i.restaurant && i.restaurant.name}</span>
                  </li>
                ))}
              </ul>
              <div className="bta-actions">
                <button
                  ref={bulkRef}
                  type="button"
                  className="di-btn-primary bta-btn"
                  disabled={busy}
                  onClick={async () => {
                    await onConfirm(high.map((i) => i.jobId))
                    setBulkOpen(false)
                  }}
                >
                  Bevestig {high.length} bronnen
                </button>
                <button type="button" className="stg-btn-secondary bta-btn" onClick={() => setBulkOpen(false)}>
                  Annuleren
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div role="status" aria-live="polite" className="bta-sr-only">
        {notice}
      </div>

      <ol className="bta-results">
        {items.map((item) => (
          <ResultCard
            key={`${item.position}-${item.jobId || 'none'}`}
            item={item}
            isStarter={isStarter}
            batchOpen={batchOpen}
            ownOpenBatchId={ownOpenBatchId}
            confirming={confirming}
            setConfirming={setConfirming}
            onConfirm={onConfirm}
            onRerun={onRerun}
            onAdjust={onAdjust}
            busy={busy}
          />
        ))}
      </ol>
    </section>
  )
}

/** Everything below the internal navigation. */
export default function BatchAnalysisView({ data, loadError, message, viewing, ownOpenBatchId, busy, confirming, setConfirming, onConfirm, onRerun, onAdjust, onNew, notice, text, setText, onStart, actionError, onShowOpen, onSelect }) {
  return (
    <>
      <nav aria-label="Kruimelpad" className="bta-breadcrumb">
        <span className="bta-desktop-only">Werkvoorraad</span>
        <span className="bta-desktop-only" aria-hidden="true">
          /
        </span>
        <a href="/internal/source-triage" className="stg-link">
          <span className="bta-mobile-only" aria-hidden="true">
            ←{' '}
          </span>
          Bronnen beoordelen
        </a>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Batchanalyse</span>
      </nav>

      <div className="bta-header">
        <div className="bta-title-row">
          <h1 className="di-title">Batchanalyse</h1>
          <span className="bta-tag">Alleen intern</span>
        </div>
        <p className="bta-muted">
          Analyseer maximaal {MAX_BATCH_URLS} restaurant-URL&apos;s tegelijk. Elk resultaat blijft een voorstel voor
          menselijke controle.
        </p>
      </div>

      <div className="di-banner di-banner-info" role="note">
        <span className="di-banner-icon">
          <StatusIcon name="alert" />
        </span>
        <span>
          <strong>{COPY.nothingPublished.replace(/\.$/, '')}.</strong> Elke bevestiging is een menselijke kwaliteitscontrole
          door een medewerker.
        </span>
      </div>

      <div role="alert">{loadError && <div className="di-banner di-banner-danger">{loadError}</div>}</div>
      <div role="status">
        {message && (
          <div className={`di-banner ${message.tone === 'error' ? 'di-banner-danger' : message.tone === 'success' ? 'di-banner-info' : 'di-banner-neutral'}`}>
            {message.text}
          </div>
        )}
      </div>

      <div className="bta-layout">
        <div className="bta-content">
          {!data && !loadError && <p className="bta-muted">Laden…</p>}
          {data && viewing && (
            <BatchDetail
              detail={viewing}
              ownOpenBatchId={ownOpenBatchId}
              busy={busy}
              confirming={confirming}
              setConfirming={setConfirming}
              onConfirm={onConfirm}
              onRerun={onRerun}
              onAdjust={onAdjust}
              onNew={onNew}
              notice={notice}
            />
          )}
          {data && !viewing && (
            <InputCard
              text={text}
              setText={setText}
              daily={data.daily}
              ownOpenBatchId={ownOpenBatchId}
              onStart={onStart}
              busy={busy}
              error={actionError}
              onShowOpen={onShowOpen}
            />
          )}
        </div>
        <aside className="bta-side" aria-label="Over deze analyse">
          {data && <SidePanels data={data} selectedId={viewing ? viewing.batch.id : null} onSelect={onSelect} />}
        </aside>
      </div>
    </>
  )
}
