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

const STATE_ICON = {
  progress: { tone: 'neutral', icon: 'progress' },
  certain: { tone: 'positive', icon: 'check' },
  doubt: { tone: 'old', icon: 'warning' },
  no_menu: { tone: 'neutral', icon: 'minus' },
  blocked: { tone: 'blocked', icon: 'lock' },
  done: { tone: 'positive', icon: 'check' },
  skip: { tone: 'neutral', icon: 'dot' },
}

export default function SourceResultRow({ row, href, onConfirm, busy, position }) {
  if (!row) return null
  const tone = STATE_ICON[row.state] || STATE_ICON.blocked
  const name = (row.restaurant && row.restaurant.name) || row.url || `Regel ${position || row.position || '?'}`
  const step = row.step
  const confirmable = Boolean(step && step.key === 'confirm' && typeof onConfirm === 'function')
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
        </span>
      </div>
      <div className="srr-step">
        {confirmable ? (
          <button type="button" className="di-btn-primary srr-action" disabled={busy} onClick={() => onConfirm(row)}>
            {step.label}
          </button>
        ) : step && href ? (
          <a className="stg-btn-secondary srr-action" href={href}>
            {step.label}
          </a>
        ) : step && step.key === 'wait' ? (
          <span className="srr-wait" role="status">
            {step.label}
          </span>
        ) : (
          <span className="srr-none">Geen actie nodig</span>
        )}
      </div>
    </li>
  )
}
