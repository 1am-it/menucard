// BE-29 (#70) — de home is een dunne serverpagina. De zware data
// (data/menus.json / data/restaurants.json) blijft aan de serverkant: de
// browser krijgt alleen een compacte, eerlijke kandidatenlijst als props,
// nooit het volledige menu-archief. Zie app/HomeView.js voor de opmaak en
// src/lib/publicTonight.js voor de pure selectie.
//
// `revalidate` houdt de pagina snel (één ISR-render per vijf minuten). De
// server rendert bewust geen "Vanavond op de kaart", geen "Nu open", geen
// daghap en geen seizoenstegels: die hangen van de browserklok af en worden
// na het laden bepaald (zie HomeView).

import HomeView from './HomeView'
import { buildTonightCandidates } from '@/src/lib/publicTonightData'

export const revalidate = 300

export default function HomePage() {
  return <HomeView candidates={buildTonightCandidates()} />
}
