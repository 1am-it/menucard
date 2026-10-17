'use client'

// Issue #53 round 2 — secondary navigation for Beheer. Four links, one per
// approved section. The hrefs stay real URLs (`/internal?section=...`) so a
// copied link opens the same section and the browser's Back button works;
// the page intercepts an ordinary left click only to avoid a full reload.

import { BEHEER_SECTIONS } from '@/src/lib/internalBeheer'

export default function BeheerNav({ section, onSelect }) {
  return (
    <nav className="bh-nav" aria-label="Beheeronderdelen">
      {BEHEER_SECTIONS.map((item) => (
        <a
          key={item.id}
          href={item.href}
          aria-current={section === item.id ? 'page' : undefined}
          onClick={(event) => {
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
              return
            }
            event.preventDefault()
            onSelect(item.id)
          }}
        >
          {item.label}
        </a>
      ))}
    </nav>
  )
}
