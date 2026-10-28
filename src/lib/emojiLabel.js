// BE-37 (#89) — een label dat met een decoratief emoji begint, splitsen.
//
// De labels komen uit de data ("🥗 Lunchkaart", "✍️ Handmatig toevoegen",
// "✅ 42 gerechten gelezen"). Zo'n emoji is decoratie: de betekenis staat in de
// tekst ernaast. Dit pure functietje haalt het leidende teken eraf zodat de
// render het via `<Emoji>` (altijd aria-hidden) kan tonen, zonder de data of de
// bestaande labels zelf te wijzigen.
//
// Alleen een LEIDEND emoji telt. Een pijl midden in een zin ("Alles →") en een
// gewoon teken blijven staan: dat is typografie, geen emoji.

const LEADING_EMOJI =
  /^[\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F000}-\u{1FAFF}]\uFE0F?/u

export function splitLeadingEmoji(value) {
  const text = String(value === undefined || value === null ? '' : value)
  const match = text.match(LEADING_EMOJI)
  if (!match) return { glyph: null, text }
  return { glyph: match[0], text: text.slice(match[0].length).replace(/^\s+/, '') }
}
