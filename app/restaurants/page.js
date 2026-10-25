// BE-29 (#70) — /restaurants is uitgefaseerd (eigenaarsbesluit 2026-10-25):
// de oude pagina stuurt permanent door (308) naar /alle-restaurants. Een
// eventuele bestaande zoekterm `q` gaat mee; andere oude parameters hebben op
// de nieuwe pagina geen betekenis en worden niet verzonnen.
//
// De gedeelde componenten (header, kaarten, thema, tabbar) blijven bestaan;
// alleen de code die uitsluitend deze oude pagina diende is verwijderd.

import { permanentRedirect } from 'next/navigation'

export default async function RestaurantsRedirect({ searchParams }) {
  const params = await searchParams
  const raw = params ? params.q : null
  const value = Array.isArray(raw) ? raw[0] : raw
  const query = typeof value === 'string' ? value.trim() : ''
  permanentRedirect(query ? `/alle-restaurants?q=${encodeURIComponent(query)}` : '/alle-restaurants')
}
