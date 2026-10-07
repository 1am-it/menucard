// Extern-icoon voor acties die de site verlaten (handoff "5 · Oker licht —
// uitgewerkt": "Reserveer via website" met dit pijl-uit-kader-icoon).
// Het icoon zelf is decoratief; de visueel verborgen tekst vertelt
// schermlezers dat de link in een nieuw venster opent (target="_blank").
export default function ExternalLinkIcon({ size = 14, className = 'rp-btn-external-icon' }) {
  return (
    <>
      <svg className={className} width={size} height={size} viewBox="0 0 18 18" fill="none"
        stroke="currentColor" strokeWidth="1.8" aria-hidden="true" focusable="false">
        <path d="M10.5 3h4.5v4.5M15 3l-7 7M13 10.5V15H3V5h4.5" />
      </svg>
      <span className="visually-hidden"> (opent in een nieuw venster)</span>
    </>
  )
}
