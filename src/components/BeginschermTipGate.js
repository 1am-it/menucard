'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import {
  browserStorage,
  decideTip,
  dismissTip,
  isPublicPath,
} from '@/src/lib/homeScreenTip'

// BE-62 (#153, ontwerp punt 4) — de poort voor de tip "Zet ons op je
// beginscherm".
//
// Deze component is klein en doet niets bij de eerste lading: pas na het
// monteren kijkt hij of dit een publieke pagina op een telefoon is, telt hij het
// bezoek en laadt hij de kaart zelf via `next/dynamic`. Zo groeit de eerste
// lading van de home nauwelijks (contract, acceptatie 3).
//
// Geen pop-up, geen modal en geen focus: de kaart zelf is gewone inhoud
// (src/components/BeginschermTip.js). Na sluiten wordt de stand bewaard en
// verdwijnt de kaart voorgoed.
const BeginschermTip = dynamic(() => import('./BeginschermTip'), { ssr: false })

export default function BeginschermTipGate() {
  const pathname = usePathname()
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!isPublicPath(pathname)) {
      setShow(false)
      return
    }
    const matchMedia = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia.bind(window)
      : null
    const result = decideTip({
      storage: browserStorage('localStorage'),
      session: browserStorage('sessionStorage'),
      matchMedia,
    })
    setShow(result.show)
  }, [pathname])

  const close = useCallback(() => {
    dismissTip(browserStorage('localStorage'))
    setShow(false)
  }, [])

  if (!show) return null
  return <BeginschermTip onClose={close} />
}
