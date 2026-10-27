// BE-37 (#89) — een label met een decoratief emoji ervoor.
//
// Dezelfde afspraak als src/components/Emoji.js: de emoji is decoratie en
// altijd `aria-hidden`; de schermlezer leest alleen de tekst. Labels komen uit
// de data en houden daar hun emoji (tests en API's blijven gelijk); alleen de
// weergave splitst hem af.

import Emoji from '@/src/components/Emoji'
import { splitLeadingEmoji } from '@/src/lib/emojiLabel'

export default function EmojiText({ value, className }) {
  const { glyph, text } = splitLeadingEmoji(value)
  const content = glyph ? (
    <>
      <Emoji glyph={glyph} />
      {text ? ` ${text}` : null}
    </>
  ) : (
    text
  )
  return className ? <span className={className}>{content}</span> : content
}
