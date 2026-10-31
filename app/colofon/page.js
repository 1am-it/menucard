// BE-69 (#172, uitkomst 2) — het publieke colofon op /colofon.
//
// Dezelfde opbouw als /privacy: een statische Server Component (○) zonder eigen
// woorden. De tekst staat in src/lib/legalCopy.js en de vorm in
// src/components/LegalDocument.js.

import { COLOFON } from '@/src/lib/legalCopy'
import LegalDocument from '@/src/components/LegalDocument'

export const metadata = {
  title: COLOFON.metadata.title,
  description: COLOFON.metadata.description,
}

export default function ColofonPage() {
  return <LegalDocument document={COLOFON} />
}
