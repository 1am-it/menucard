'use client'

// BE-31 (#74) — the one result row of "afhandelen waar je het start"
// (criterion 4): the same component for the batch detail of Bronnen beoordelen,
// the "Nog niet gecontroleerd" rows of Dekking and the result of "Restaurant of
// menu toevoegen". It renders exactly what rowForBatchItem decided: the
// progress (⏳), the outcome and precisely one next step.
//
// All the decisions live in src/lib/sourceReview.js (pure, tested). This file
// only renders them and never invents a second route: "Bevestig bron" calls the
// existing confirmation route through the page's own handler, and every other
// step is the link the pure function built (the BE-30 menukopjes screen, the
// existing "Lees met AI" and the existing manual import).

import StatusIcon from '@/src/components/StatusIcon'
import AiReadAction from '@/src/components/AiReadAction'
import { CHECK_COPY } from '@/src/lib/sourceReview'

const STATE_ICON = {
  progress: { tone: 'neutral', icon: 'progress' },
  certain: { tone: 'positive', icon: 'check' },
  doubt: { tone: 'old', icon: 'warning' },
  no_menu: { tone: 'neutral', icon: 'minus' },
  blocked: { tone: 'blocked', icon: 'lock' },
  done: { tone: 'positive', icon: 'check' },
  handled: { tone: 'neutral', icon: 'dot' },
  skip: { tone: 'neutral', icon: 'dot' },
}

function handledDate(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
}

export default function SourceResultRow({ row, href, onConfirm, onRecheck, onAiRead, onOpenAiRead, aiRead, busy, position }) {
  if (!row) return null
  const tone = STATE_ICON[row.state] || STATE_ICON.blocked
  const name = (row.restaurant && row.restaurant.name) || row.url || `Regel ${position || row.position || '?'}`
  const step = row.step
  const confirmable = Boolean(step && step.key === 'confirm' && typeof onConfirm === 'function')
  // BE-34 (#81): "Lees met AI" starts the existing server-side reading right
  // here, in this row. Only when the page wired the handler; without it the row
  // keeps the existing link to the same route, so nothing breaks.
  const aiReadable = Boolean(step && step.key === 'ai_read' && typeof onAiRead === 'function')
  // The age of a result stays visible and can be re-checked through the existing
  // batch analysis; nothing expires by itself (review points 5 and 6).
  const recheckable = Boolean(row.url && typeof onRecheck === 'function' && !row.handled)
  const closedAt = row.handled ? handledDate(row.handled.at) : null
  return (
    <li className={`srr-row srr-row--${row.state}`}>
      <div className="srr-main">
        <span className="srr-emoji" aria-hidden="true">
          {row.emoji}
        </span>
        <span className="srr-text">
          <span className="srr-name">{name}</span>
          <span className="srr-source">
            {row.url ? (
              <a className="srr-url" href={row.url} target="_blank" rel="noopener noreferrer">
                {row.url}
              </a>
            ) : (
              'Geen website bekend'
            )}
          </span>
          <span className="srr-outcome">
            <span className={`status-badge status-badge--${tone.tone} srr-badge`}>
              <StatusIcon name={tone.icon} />
              <span>{row.label}</span>
            </span>
            {row.detail ? <span className="srr-detail">{row.detail}</span> : null}
          </span>
          {row.foundUrl && row.foundUrl !== row.url ? <span className="srr-found">Gevonden: {row.foundUrl}</span> : null}
          {row.handled ? (
            <span className="srr-age">
              {CHECK_COPY.handled}
              {closedAt ? ` op ${closedAt}` : ''} · niets gewist
            </span>
          ) : row.age ? (
            <span className="srr-age">
              {row.age}
              {recheckable ? (
                <>
                  {' · '}
                  <button type="button" className="srr-recheck" disabled={busy} onClick={() => onRecheck(row)}>
                    {CHECK_COPY.recheck}
                  </button>
                </>
              ) : null}
            </span>
          ) : null}
        </span>
      </div>
      <div className="srr-step">
        {confirmable ? (
          <button type="button" className="di-btn-primary srr-action" disabled={busy} onClick={() => onConfirm(row)}>
            {step.label}
          </button>
        ) : aiReadable ? (
          <AiReadAction
            row={row}
            state={aiRead}
            onRead={onAiRead}
            onOpen={onOpenAiRead}
            disabled={busy}
            label={step.label}
          />
        ) : step && href ? (
          <a className="stg-btn-secondary srr-action" href={href}>
            {step.label}
          </a>
        ) : step && step.key === 'wait' ? (
          <span className="srr-wait" role="status">
            {step.label}
          </span>
        ) : (
          <span className="srr-none">{row.handled ? CHECK_COPY.handled : 'Geen actie nodig'}</span>
        )}
      </div>
    </li>
  )
}
