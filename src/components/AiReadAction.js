'use client'

// BE-34 (#81, criterion 1) — the one row action "Lees met AI".
//
// Presentational only: the page's useAiReading hook owns the call and the state,
// the pure module src/lib/aiReadFlow.js owns the words. The four states are the
// contract's own:
//   idle    → the primary "Lees met AI" button + the estimate; the manual import
//             is only the small link "Liever zelf plakken";
//   reading → "⏳ AI leest de kaart… ± 1 minuut" with the cost estimate;
//   done    → "✅ 42 gerechten gelezen · 3 controle nodig" + "Bekijk en
//             controleer" (the existing review screen, result already loaded);
//   error   → an honest message with "Handmatig toevoegen" as the next step.
// It never starts anything by itself.

import EmojiText from '@/src/components/EmojiText'
import {
  PASTE_LABEL,
  REVIEW_LABEL,
  aiReadCostLine,
  aiReadEstimateLine,
  aiReadOutcomeLine,
  aiReadProgressLine,
  manualPasteHref,
} from '@/src/lib/aiReadFlow'

export default function AiReadAction({ row, state, onRead, onOpen, disabled = false, label = '📖 Lees met AI' }) {
  const phase = state && typeof state === 'object' ? state.phase : null

  if (phase === 'reading') {
    return (
      <span className="srr-ai" role="status" aria-live="polite">
        <span className="srr-ai-line"><EmojiText value={aiReadProgressLine()} /></span>
        <span className="srr-ai-hint">{aiReadEstimateLine()}</span>
      </span>
    )
  }

  if (phase === 'done') {
    const summary = state.summary && typeof state.summary === 'object' ? state.summary : {}
    return (
      <span className="srr-ai" role="status">
        <span className="srr-ai-line"><EmojiText value={aiReadOutcomeLine({ items: summary.items, needsReview: summary.needsReview, pagesFailed: state.pagesFailed })} /></span>
        <span className="srr-ai-hint">{aiReadCostLine(state.cost)}</span>
        <button type="button" className="di-btn-primary srr-action" disabled={disabled} onClick={() => onOpen && onOpen(row)}>
          {REVIEW_LABEL}
        </button>
      </span>
    )
  }

  if (phase === 'error') {
    return (
      <span className="srr-ai" role="alert">
        <span className="srr-ai-line">{state.message}</span>
        {state.nextHref && state.nextLabel ? (
          <a className="stg-btn-secondary srr-action" href={state.nextHref}>
            <EmojiText value={state.nextLabel} />
          </a>
        ) : null}
      </span>
    )
  }

  return (
    <span className="srr-ai">
      <button type="button" className="di-btn-primary srr-action" disabled={disabled} onClick={() => onRead && onRead(row)}>
        <EmojiText value={label} />
      </button>
      <span className="srr-ai-hint">{aiReadEstimateLine()}</span>
      <a className="srr-paste-link" href={manualPasteHref(row)}>
        {PASTE_LABEL}
      </a>
    </span>
  )
}
