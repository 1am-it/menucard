'use client'
import { useEffect, useState } from 'react'

// THEME ticket — shared, theme-agnostic toggle. Same component/markup is
// used on every page; only the CSS custom properties it flips change what
// things look like (see app/globals.css). See
// planning/decisions/006-theme-token-system.md for the precedence rules.

const THEME_KEY = 'bredaeats_theme'
const OPTIONS = [
  { value: 'light', label: 'Licht' },
  { value: 'dark', label: 'Donker' },
]

// BE-09 — "Systeem" removed from the picker; only 'light'/'dark' are valid
// choices now. The one-time migration of a pre-existing 'system' value to a
// concrete OS-resolved preference happens in the blocking script in
// app/layout.js, before this component ever mounts — by the time this runs,
// localStorage should already hold 'light' or 'dark'.
function applyTheme(value) {
  document.documentElement.setAttribute('data-theme', value)
}

export default function ThemeToggle() {
  // Starts null so the toggle only renders once we know the real stored
  // preference (set by the blocking script in app/layout.js) — avoids
  // briefly showing a control that doesn't match the page's actual theme.
  const [theme, setTheme] = useState(null)

  useEffect(() => {
    let stored = null
    try { stored = localStorage.getItem(THEME_KEY) } catch {}
    setTheme(stored === 'light' || stored === 'dark' ? stored : 'dark')
  }, [])

  const choose = (value) => {
    setTheme(value)
    try { localStorage.setItem(THEME_KEY, value) } catch {}
    applyTheme(value)
  }

  if (!theme) return null

  return (
    <div className="theme-switch" role="group" aria-label="Thema">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`theme-btn ${theme === opt.value ? 'active' : ''}`}
          onClick={() => choose(opt.value)}
          aria-pressed={theme === opt.value}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
