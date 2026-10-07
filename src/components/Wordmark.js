import Link from 'next/link'

// Onze Menukaarten — gedeeld woordmerk (gekozen Claude Design-richting
// "5 · Oker licht — uitgewerkt", zie docs/guides/design-reference.md,
// "Wordmark and brand accent").
//
// - Gestapeld: "ONZE" (klein, spatiëring, hoofdletters via CSS) boven
//   "Menukaarten". De link krijgt een expliciete toegankelijke naam
//   (handoff: "Onze Menukaarten, naar de startpagina"): zonder die naam
//   leest de browser "ONZE Menukaarten" (text-transform), gemeten in Edge.
// - Eén kleur (--wordmark), geen gesplitste accentbehandeling van een
//   woorddeel.
// - Het motief is een gevouwen menukaart: inline SVG, currentColor,
//   aria-hidden. Geen externe asset, geen font.
// - De descriptor "Menukaarten in Breda" is optioneel en staat naast het
//   woordmerk, buiten de link.
//
// `href` blijft standaard "/" — dit vervangt de vroegere
// `<Link href="/" className="logo">` op elke pagina met exact één link naar
// de homepage. Voor de interne navigatie (gewone <a>-elementen) is er
// WordmarkInline; de omringende <a> draagt daar zelf de aria-label.

export const WORDMARK_HOME_LABEL = 'Onze Menukaarten, naar de startpagina'

export function WordmarkMark({ size = 24 }) {
  return (
    <svg
      className="wordmark-mark"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3.5 5.5L11 3.5v17l-7.5 2z" />
      <path d="M11 3.5l9.5 2v17L11 20.5z" />
      <path d="M13.8 9.2h4.2M13.8 12.2h4.2M13.8 15.2h2.6" />
    </svg>
  )
}

function WordmarkText() {
  return (
    <span className="wordmark-text">
      <span className="wordmark-top">Onze</span>{' '}
      <span className="wordmark-main">Menukaarten</span>
    </span>
  )
}

export default function Wordmark({ href = '/', descriptor = true, size = 'md', label = WORDMARK_HOME_LABEL }) {
  return (
    <span className={`wordmark-wrap wordmark--${size}`}>
      <Link href={href} className="wordmark" aria-label={label}>
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
      <WordmarkMark size={20} />
      <WordmarkText />
    </span>
  )
}
