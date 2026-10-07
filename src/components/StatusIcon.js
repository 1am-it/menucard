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
