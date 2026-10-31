'use client'

// BE-68 (#168) — de QR-code zelf, als SVG en als PNG.
//
// `qrcode-generator` (MIT, zonder afhankelijkheden) wordt hier dynamisch
// geladen: alleen deze pagina vraagt dit bestand op, dus de eerste lading van
// de publieke pagina's groeit niet (zie qrKaartjeSurface.test.js). Een eigen
// QR-encoder staat hier bewust niet.
//
// De rustzone van 4 modules zit in de viewBox en niet in de matrix: de
// bibliotheek levert alleen de modules, de witruimte eromheen is opmaak.

import { useEffect, useState } from 'react'

import { QR_FOUTCORRECTIE, QR_RUSTZONE } from '@/src/lib/qrKaartje'

// Het kaartje is altijd papier, ook in het donkere thema: een QR-code op een
// donkere ondergrond scant niet betrouwbaar. Daarom echte kleuren en geen
// thematokens, net als het printblok in app/globals.css.
const PAPIER = '#FFFFFF'
const INKT = '#1F2328'

/** De matrix van een URL: `{ aantal, cellen }`, of `null` als het niet lukt. */
async function leesMatrix(value) {
  const module = await import('qrcode-generator')
  const maak = module.default || module
  const code = maak(0, QR_FOUTCORRECTIE)
  code.addData(String(value))
  code.make()
  const aantal = code.getModuleCount()
  const cellen = []
  for (let rij = 0; rij < aantal; rij += 1) {
    for (let kolom = 0; kolom < aantal; kolom += 1) {
      if (code.isDark(rij, kolom)) cellen.push([kolom, rij])
    }
  }
  return { aantal, cellen }
}

/** Eén pad voor alle donkere modules; kleiner dan een rect per module. */
function matrixPad(matrix) {
  if (!matrix) return ''
  const offset = QR_RUSTZONE
  return matrix.cellen
    .map(([kolom, rij]) => `M${kolom + offset} ${rij + offset}h1v1h-1z`)
    .join('')
}

/**
 * De QR als PNG-afbeelding voor "Deel de QR-afbeelding" (Web Share API) en als
 * terugval een download. Alleen in de browser; de aanroeper vangt fouten op.
 */
export async function qrPngBlob({ value, px = 1024 } = {}) {
  const matrix = await leesMatrix(value)
  if (!matrix) throw new Error('geen matrix')
  const totaal = matrix.aantal + QR_RUSTZONE * 2
  const canvas = document.createElement('canvas')
  canvas.width = px
  canvas.height = px
  const context = canvas.getContext('2d')
  if (!context) throw new Error('geen canvas')
  context.fillStyle = PAPIER
  context.fillRect(0, 0, px, px)
  context.fillStyle = INKT
  const maat = px / totaal
  for (const [kolom, rij] of matrix.cellen) {
    context.fillRect((kolom + QR_RUSTZONE) * maat, (rij + QR_RUSTZONE) * maat, maat, maat)
  }
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('geen png')
  return blob
}

/**
 * De QR-code als SVG. `label` is de toegankelijke naam van de afbeelding; een
 * QR-code is informatie, dus geen aria-hidden.
 */
export default function QrCode({ value, label }) {
  const [matrix, setMatrix] = useState(null)
  const [mislukt, setMislukt] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!value) {
      setMatrix(null)
      return undefined
    }
    leesMatrix(value)
      .then((uitkomst) => {
        if (!cancelled) setMatrix(uitkomst)
      })
      .catch(() => {
        if (!cancelled) setMislukt(true)
      })
    return () => {
      cancelled = true
    }
  }, [value])

  if (mislukt) return null
  if (!matrix) {
    // Ruimte reserveren, zodat het voorbeeld niet verspringt bij het laden.
    return <span className="qr-kaartje-code-leeg" aria-hidden="true" />
  }

  const totaal = matrix.aantal + QR_RUSTZONE * 2
  return (
    <svg
      className="qr-kaartje-code-svg"
      viewBox={`0 0 ${totaal} ${totaal}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={totaal} height={totaal} fill={PAPIER} />
      <path d={matrixPad(matrix)} fill={INKT} />
    </svg>
  )
}
