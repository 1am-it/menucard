'use client'

// BE-44 (#105, criterium 4) — de knop "Lijstje delen" op /mijn-lijstje.
//
// Net als bij één gerecht (eigenaarsbesluit 28 oktober) gaat er alleen een link
// mee: het systeemmenu op de telefoon of, zonder dat, het klembord met "Link
// gekopieerd". De logica staat in src/lib/dishShare.js (`shareLink`), samen met
// de knop "Delen" van een gerecht; hier staat alleen de knop zelf.

import { useState } from 'react'
import { shareLink } from '@/src/lib/dishShare'
import { LIST_SHARE_LABEL } from '@/src/lib/dishList'

export default function ListShareButton({ href, title }) {
  const [message, setMessage] = useState('')

  async function handleShare() {
    const result = await shareLink({
      browser: typeof window === 'undefined' ? null : window,
      href,
      title,
      theme: typeof document === 'undefined' || !document.documentElement
        ? null
        : document.documentElement.getAttribute('data-theme'),
    })
    setMessage(result.message || '')
  }

  if (!href) return null

  return (
    <div className="lijst-share">
      <button type="button" className="lijst-primary-btn lijst-share-btn" onClick={handleShare}>
        <svg className="dish-share-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M12 3v12" />
          <path d="M8 7l4-4 4 4" />
          <path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
        </svg>
        {LIST_SHARE_LABEL}
      </button>
      <span className="dish-share-status" role="status">{message}</span>
    </div>
  )
}
