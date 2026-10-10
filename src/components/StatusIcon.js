// Kleurtaal v2 — kleine, decoratieve statusiconen (inline SVG, currentColor,
// aria-hidden). Een status toont altijd icoon + tekst; de tekst draagt de
// betekenis, het icoon herhaalt die zonder kleur nodig te hebben. Zie
// docs/guides/design-reference.md ("Kleurtaal v2").
const PATHS = {
  // Positief / herkenbaar / open: vinkje in cirkel.
  check: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="m5.5 8.2 1.7 1.7 3.3-3.4" />
    </>
  ),
  // Gesloten / later open: klok.
  clock: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 4.8V8l2.2 1.4" />
    </>
  ),
  // Aandacht / actie nodig: uitroepteken in cirkel.
  alert: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 4.8v3.6M8 10.9v.1" />
    </>
  ),
  // Mislukt / afgewezen / verworpen: kruis in cirkel.
  cross: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="m5.9 5.9 4.2 4.2M10.1 5.9l-4.2 4.2" />
    </>
  ),
  // Neutrale staat zonder oordeel (bijv. een actief concept): stip in cirkel.
  dot: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  // Batchanalyse (BE-25): robots.txt-blokkade — slot.
  lock: (
    <>
      <rect x="3.5" y="7.2" width="9" height="6.3" rx="1.4" />
      <path d="M5.5 7.2V5.4a2.5 2.5 0 0 1 5 0v1.8" />
    </>
  ),
  // Menukaart gevonden: document met vink.
  file: (
    <>
      <path d="M4 2.5h5.2L12 5.3v8.2H4z" />
      <path d="m6.1 9.3 1.4 1.4 2.5-2.6" />
    </>
  ),
  // Controle nodig / fout: driehoek met uitroepteken.
  warning: (
    <>
      <path d="M8 2.6 14 13H2z" />
      <path d="M8 6.6v3M8 11.3v.1" />
    </>
  ),
  // Recent geanalyseerd: terugpijl.
  recent: (
    <>
      <path d="M3.4 8a4.6 4.6 0 1 0 1.4-3.3" />
      <path d="M3 2.9v2.6h2.6" />
    </>
  ),
  // Bezig: voortgangscirkel (statisch; de tekst draagt de betekenis).
  progress: (
    <>
      <circle cx="8" cy="8" r="6.25" opacity="0.35" />
      <path d="M8 1.75A6.25 6.25 0 0 1 14.25 8" />
    </>
  ),
  // Geen bruikbare menukaart: streep in cirkel.
  minus: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M5.2 8h5.6" />
    </>
  ),
  // Dieetlabel (vegetarisch/vegan): blaadje. Neutraal, geen successtatus.
  leaf: (
    <>
      <path d="M3.2 12.8c0-5.4 3.4-9 9.6-9.6-.4 6.2-4 9.6-9.6 9.6Z" />
      <path d="M3.2 12.8 8.6 7.4" />
    </>
  ),
}

export default function StatusIcon({ name, size = 14, className }) {
  const shape = PATHS[name]
  if (!shape) return null
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {shape}
    </svg>
  )
}
