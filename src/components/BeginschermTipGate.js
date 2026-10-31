'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

// BE-62 (ontwerp punt 4) — de poort voor de tip "Zet ons op je beginscherm".
//
// Deze component is klein en doet niets bij de eerste lading: pas na het
// monteren laadt hij de regels (src/lib/homeScreenTip.js) en daarna, als het
// echt mag, de kaart zelf via `next/dynamic`. Zo groeit de eerste lading van de
// home en van de menukaart nauwelijks (contract, acceptatie 3).
//
// Geen pop-up, geen modal en geen focus: de kaart zelf is gewone inhoud
// (src/components/BeginschermTip.js). Na sluiten wordt de stand bewaard en
// verdwijnt de kaart voorgoed.
const BeginschermTip = dynamic(() => import('./BeginschermTip'), { ssr: false })

export default function BeginschermTipGate() {
  const pathname = usePathname()
  const [show, setShow] = useState(false)

  useEffect(() => {
    let cancelled = false
    setShow(false)
    import('@/src/lib/homeScreenTip')
      .then((tip) => {
        if (cancelled || !tip.isPublicPath(pathname)) return
        const matchMedia = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
          ? window.matchMedia.bind(window)
          : null
        const result = tip.decideTip({
          storage: tip.browserStorage('localStorage'),
          session: tip.browserStorage('sessionStorage'),
          matchMedia,
        })
        if (!cancelled) setShow(result.show)
      })
      .catch(() => {
        // Zonder de regels geen tip en geen fout.
      })
    return () => {
      cancelled = true
    }
  }, [pathname])

  const close = useCallback(() => {
    setShow(false)
    import('@/src/lib/homeScreenTip')
      .then((tip) => tip.dismissTip(tip.browserStorage('localStorage')))
      .catch(() => {})
  }, [])

  if (!show) return null
  return <BeginschermTip onClose={close} />
}
