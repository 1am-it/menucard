import Link from 'next/link'
import { HOME_HREF } from '@/src/lib/returnVisit'
import './zoek-gerecht-block.css'

// BE-62 (#153, ontwerp punt 1, 2 en 3) — het rustige vlak waarmee een ontvanger
// terugkomt: "Zelf ook zin in iets?" (gedeeld gerecht of lijstje) en
// "Jij koos <gerecht>. Zelf ook een lijstje maken?" (na het stemmen).
//
// Alleen opmaak: de pagina bepaalt of het vlak er staat, de woorden komen uit
// src/lib/returnVisit.js. Kleuren uitsluitend via tokens, dus licht en donker
// werken zonder eigen variant. Geen pop-up en geen focus: het is gewone inhoud
// in de pagina, met één gewone link naar de home.
export default function ZoekGerechtBlock({ title, body, cta, variant = 'shared' }) {
  return (
    <section className={`zoek-gerecht zoek-gerecht--${variant}`}>
      <h2 className="zoek-gerecht-title">{title}</h2>
      <p className="zoek-gerecht-body">{body}</p>
      <Link href={HOME_HREF} className="zoek-gerecht-btn" prefetch={false}>{cta}</Link>
    </section>
  )
}
