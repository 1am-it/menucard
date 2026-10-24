'use client'

// #59 / BE-21 "Lees met AI" — the one block that offers the AI reading
// (Lead review 6380804419, W1/W3/W4/W5; layout Y2 of review 6381657192).
//
// It is a standalone card and the primary route on /internal/menu-import: it is
// shown after the source choice, never nested inside the manual "Prompt maken"
// step. The manual steps stay collapsed behind one link, so the AI reading stays
// the main path and the old three-step flow stays available unchanged when AI is
// not configured.
//
// It never decides anything itself: the server reports whether AI is configured
// (W3) and what this month already cost (W4); this block only shows that and
// passes one click through.
//
// States: loading (no status yet), not configured ("AI is niet ingesteld", no
// button), ready, reading (progress), done ("Concept klaar: N gerechten · X in
// orde, Y nalopen" + "Nalopen" + costs) and error (a readable message with the
// way to continue manually). There is no automatic retry.

function euroFromCents(cents) {
  if (!Number.isInteger(cents)) return null
  return `€ ${(cents / 100).toFixed(2).replace('.', ',')}`
}

export default function AiMenuReadBlock({
  status,
  statusError = null,
  phase = 'idle',
  result = null,
  error = null,
  busy = false,
  canRead = true,
  hint = null,
  manualOpen = false,
  onManual = null,
  onRead,
  onReview,
  title = 'Laat AI de kaart lezen',
  step = null,
}) {
  const monthly = status && status.monthly ? status.monthly : null
  const enabled = Boolean(status && status.enabled)
  const budgetBlocked = Boolean(status && status.budget && status.budget.allowed === false)
  const done = phase === 'done' && result
  const failed = phase === 'error'

  return (
    <section className="bta-card mai-ai-card mai-ai" aria-labelledby="mai-ai-title">
      {/* BB3 (Lead review 6384867373): the card is a numbered step whenever the
          manual route is collapsed, so "Nalopen en opslaan" is never step 4
          while only step 1 and this card are visible. */}
      <div className="mai-step-head">
        {step === null ? null : (
          <span className="step-num" aria-hidden="true">
            {step}
          </span>
        )}
        <h2 id="mai-ai-title" className="mai-step-title">
          {title}
        </h2>
      </div>

      {statusError ? (
        <p className="mai-why" role="status">
          AI is niet ingesteld.
        </p>
      ) : null}

      {!statusError && !status ? (
        <p className="bta-muted" role="status">
          Bezig met controleren of AI beschikbaar is…
        </p>
      ) : null}

      {!statusError && status && !enabled ? (
        <p className="mai-why" role="status">
          AI is niet ingesteld.
        </p>
      ) : null}

      {!statusError && enabled ? (
        <>
          <p className="bta-muted">
            Lukt automatisch lezen niet, dan leest de AI dezelfde bron. Het resultaat is een voorstel dat je daarna
            zelf naleest. Er wordt niets gepubliceerd.
          </p>

          {monthly ? (
            <p className="mai-why">
              {monthly.spentEurCents === null
                ? 'AI deze maand: gebruik onbekend'
                : `AI deze maand ${euroFromCents(monthly.spentEurCents)} van ${euroFromCents(monthly.limitEurCents)}`}
            </p>
          ) : null}

          {phase === 'reading' ? (
            <p className="mai-why" role="status" aria-live="polite">
              De AI leest de kaart. Dit duurt ongeveer een minuut; je hoeft deze pagina niet te verversen.
            </p>
          ) : null}

          {done ? (
            <div className="mai-ai-done" role="status">
              <p className="mai-summary">
                Concept klaar: {result.summary.items} {result.summary.items === 1 ? 'gerecht' : 'gerechten'} ·{' '}
                {result.summary.valid} in orde, {result.summary.needsReview} nalopen
              </p>
              <p className="mai-why">
                Kosten:{' '}
                {result.cost && result.cost.known
                  ? euroFromCents(result.cost.eurCents)
                  : 'niet gemeten (het maximum per aanroep blijft gereserveerd)'}
                {result.ai && result.ai.label ? ` · ${result.ai.label}` : ''}
              </p>
              <button type="button" className="di-btn-primary mai-btn" onClick={onReview} disabled={busy}>
                Nalopen
              </button>
            </div>
          ) : null}

          {failed ? (
            <div className="di-banner di-banner-danger" role="alert">
              <span>{error || 'De AI-lezing lukte niet.'}</span>
            </div>
          ) : null}

          {!done ? (
            <div className="mai-actions">
              <button
                type="button"
                className="di-btn-primary mai-btn"
                onClick={onRead}
                disabled={busy || phase === 'reading' || !canRead || budgetBlocked}
                aria-describedby="mai-ai-cost"
              >
                Lees met AI
              </button>
              <span id="mai-ai-cost" className="bta-muted">
                Kost ongeveer 1 cent · duurt ± 1 minuut
              </span>
            </div>
          ) : null}

          {budgetBlocked && !done ? (
            <p className="mai-why" role="status">
              Het AI-budget van deze maand is op. Ga verder met de handmatige import.
            </p>
          ) : null}

          {hint && !canRead ? <p className="mai-why">{hint}</p> : null}
        </>
      ) : null}

      {onManual ? (
        <p className="mai-why">
          {/* Y2: the manual steps are collapsed behind this link. It stays
              visible after a finished reading, so the expansion state is the
              only thing that changes. */}
          <button
            type="button"
            className="mai-link mai-linkbtn"
            aria-expanded={manualOpen}
            aria-controls="mai-manual"
            onClick={onManual}
          >
            Liever zelf invoeren of plakken
          </button>
        </p>
      ) : null}
    </section>
  )
}
