// BE-28 — decoratief systeem-emoji (#65, owner decision 2026-10-25).
//
// Emoji's zijn gewone tekens, geen afbeelding, geen emoji-font en geen
// bibliotheek. Dit component is de enige plek waar een emoji in de opmaak
// staat: altijd `aria-hidden`, zodat een schermlezer alleen de tekst ernaast
// leest. De betekenis staat dus nooit in het emoji alleen.
//
// Gebruik: <Emoji glyph="🔍" /> vóór of naast de tekst die de betekenis
// draagt. Geen `label`-prop: een decoratief teken hoort geen toegankelijke
// naam te hebben (design-reference.md, "BE-28 — frisse publieke stijl").

export default function Emoji({ glyph, className }) {
  return (
    <span className={className ? `emoji ${className}` : 'emoji'} aria-hidden="true">
      {glyph}
    </span>
  )
}
