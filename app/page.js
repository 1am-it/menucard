// BE-28 — de home is een dunne serverpagina (#65). De zware data
// (data/menus.json via de bestaande zoeklogica) blijft daardoor aan de
// serverkant: de browser krijgt alleen de drie gekozen gerechten als props,
// nooit het volledige menu-archief. Zie app/HomeView.js voor de opmaak en
// src/lib/publicTonight.js voor de eerlijke selectie.
//
// `revalidate` houdt de pagina snel (één ISR-render per vijf minuten) terwijl
// "Vanavond op de kaart" per dag wisselt. "Nu open" wordt client-side met de
// browserklok bepaald, nooit hier op de server.

import HomeView from './HomeView'
import { selectTonightDishes } from '@/src/lib/publicTonight'

export const revalidate = 300

export default function HomePage() {
  return <HomeView tonight={selectTonightDishes()} />
}
