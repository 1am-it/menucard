'use client'

import { TIP_BODY_SEGMENTS, TIP_CLOSE_LABEL, TIP_LOGO_TEXT, TIP_TITLE } from '@/src/lib/homeScreenTip'
import './beginscherm-tip.css'

// BE-62 (#153, ontwerp punt 4) — de sluitbare tip "Zet ons op je beginscherm".
//
// Een gewone witte kaart boven de telefoonbalk: geen pop-up, geen modal, geen
// role="dialog" en geen focus. Wie hem sluit, ziet hem nooit meer (de stand
// staat in localStorage, zie src/lib/homeScreenTip.js). De pagina laadt deze
// component pas als de voorwaarden kloppen; daarom staat hier geen fetch, geen
// opslag en geen effect.
export default function BeginschermTip({ onClose }) {
  return (
    <aside className="beginscherm-tip" aria-label={TIP_TITLE}>
      <span className="beginscherm-tip-logo" aria-hidden="true">{TIP_LOGO_TEXT}</span>
      <div className="beginscherm-tip-text">
        <h2 className="beginscherm-tip-title">{TIP_TITLE}</h2>
        <p className="beginscherm-tip-body">
          {TIP_BODY_SEGMENTS.map((segment, index) => (
            segment.bold
              ? <strong key={index}>{segment.text}</strong>
              : <span key={index}>{segment.text}</span>
          ))}
        </p>
      </div>
      <button
        type="button"
        className="beginscherm-tip-close"
        aria-label={TIP_CLOSE_LABEL}
        onClick={onClose}
      >
        ×
      </button>
    </aside>
  )
}
