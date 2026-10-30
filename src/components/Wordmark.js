import Link from 'next/link'

// Onze Menukaarten — gedeeld woordmerk, logo E2 "om-tegel" (gekozen
// 2026-10-14, Claude Design-canvas "Logo richting E", variant E2; zie
// docs/guides/design-reference.md, "Wordmark and brand accent").
//
// - Teken: afgeronde tegel in --accent-fill met een getekend "om"-monogram
//   in --on-accent-fill. Inline SVG, aria-hidden, geen externe asset, geen
//   font. Dezelfde vorm is de favicon (app/icon.svg).
// - Tekst: gestapeld "onze" (rustig, --text-secondary) boven "menukaarten"
//   (vet, --wordmark), in kleine letters, systeemletter. De link krijgt een
//   expliciete toegankelijke naam (handoff: "Onze Menukaarten, naar de
//   startpagina"), zodat schermlezers de naam met hoofdletters horen.
// - De descriptor "Menukaarten in Breda" is optioneel en staat naast het
//   woordmerk, buiten de link.
//
// `href` blijft standaard "/" — dit vervangt de vroegere
// `<Link href="/" className="logo">` op elke pagina met exact één link naar
// de homepage. Voor de interne navigatie (gewone <a>-elementen) is er
// WordmarkInline; de omringende <a> draagt daar zelf de aria-label.

export const WORDMARK_HOME_LABEL = 'Onze Menukaarten, naar de startpagina'

export function WordmarkMark({ size = 26 }) {
  return (
    <svg
      className="wordmark-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <rect className="wordmark-tile" width="32" height="32" rx="8" />
      <g className="wordmark-om" fill="none" strokeWidth="2.8" strokeLinecap="round">
        <circle cx="10.6" cy="16.8" r="4.1" />
        <path d="M16.5 20.9v-5.6a2.4 2.4 0 014.8 0v5.6M21.3 15.3a2.4 2.4 0 014.8 0v5.6" />
      </g>
    </svg>
  )
}

function WordmarkText() {
  return (
    <span className="wordmark-text">
      <span className="wordmark-top">onze</span>{' '}
      <span className="wordmark-main">menukaarten</span>
    </span>
  )
}

// BE-50 (#120) — het woordmerk is op elke publieke pagina de tweede weg naar
// de home, niet de eerste: de twee echte bestemmingen staan in <PrimaryNav/> en
// in de telefoonbalk. Zonder `prefetch={false}` haalde Next.js daarom op elke
// andere pagina de hele home vooruit op: de routechunk van `/` (8,8 KB) plus
// de complete RSC-lading van de home (5,9 KB, inclusief de kandidatenlijst van
// "Vanavond op de kaart"). De meting in ops/perf/ laat dat als grootste
// post zien die niemand nodig heeft vóór een tik. De link zelf, zijn doel en
// zijn toegankelijke naam blijven precies gelijk; alleen het vooruit laden
// vervalt.
export default function Wordmark({ href = '/', descriptor = true, size = 'md', label = WORDMARK_HOME_LABEL }) {
  return (
    <span className={`wordmark-wrap wordmark--${size}`}>
      <Link href={href} className="wordmark" aria-label={label} prefetch={false}>
        <WordmarkMark />
        <WordmarkText />
      </Link>
      {descriptor && <span className="wordmark-descriptor">Menukaarten in Breda</span>}
    </span>
  )
}

// Variant zonder Next-<Link> en zonder descriptor, voor de interne
// navigatie (die bewust gewone <a>-elementen gebruikt).
export function WordmarkInline() {
  return (
    <span className="wordmark wordmark--sm">
      <WordmarkMark size={26} />
      <WordmarkText />
    </span>
  )
}
