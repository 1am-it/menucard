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
  { value: 'system', label: 'Systeem' },
]

function applyTheme(value) {
  if (value === 'light' || value === 'dark') {
    document.documentElement.setAttribute('data-theme', value)
  } else {
    document.documentElement.removeAttribute('data-theme')
  }
}

export default function ThemeToggle() {
  // Starts null so the toggle only renders once we know the real stored
  // preference (set by the blocking script in app/layout.js) — avoids
  // briefly showing a control that doesn't match the page's actual theme.
  const [theme, setTheme] = useState(null)

  useEffect(() => {
    let stored = null
    try { stored = localStorage.getItem(THEME_KEY) } catch {}
    setTheme(stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'dark')
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
