// BE-69 (#172, uitkomst 1) — de publieke privacyverklaring op /privacy.
//
// Een statische Server Component (○): geen data, geen client-JS van zichzelf en
// geen afbeeldingen. De tekst staat in src/lib/legalCopy.js en de vorm in
// src/components/LegalDocument.js; deze pagina voegt geen eigen woorden toe.

import { PRIVACY } from '@/src/lib/legalCopy'
import LegalDocument from '@/src/components/LegalDocument'

export const metadata = {
  title: PRIVACY.metadata.title,
  description: PRIVACY.metadata.description,
}

export default function PrivacyPage() {
  return <LegalDocument document={PRIVACY} />
}
