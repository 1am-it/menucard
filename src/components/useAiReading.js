'use client'

// BE-34 (#81, criterion 1) — one click on "Lees met AI" in the result row.
//
// The page passes the token; this hook starts the existing server-side reading
// (src/lib/aiReadFlow.js names the one route) for the row's own analysis job and
// keeps the row's state (reading, done, failed) for that one row. It never
// retries by itself and never calls anything else: the manual import stays the
// honest next step, offered by the row itself.

import { useCallback, useState } from 'react'
import {
  AI_READ_API,
  HANDOFF_FAILED,
  aiReadFailure,
  aiReadRequestFor,
  aiReadRowKey,
  aiReviewHref,
  stashAiRead,
} from '@/src/lib/aiReadFlow'

export default function useAiReading({ token, onDone = null } = {}) {
  // One entry per row (its analysis job), so two rows never share progress.
  const [states, setStates] = useState({})
  const [readings, setReadings] = useState({})

  const stateFor = useCallback(
    (row) => {
      const key = aiReadRowKey(row)
      return key && states[key] ? states[key] : null
    },
    [states],
  )

  const read = useCallback(
    async (row) => {
      const key = aiReadRowKey(row)
      const body = aiReadRequestFor(row)
      if (!key || !body || !token) return null
      setStates((prev) => ({ ...prev, [key]: { phase: 'reading' } }))
      try {
        const res = await fetch(AI_READ_API, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          cache: 'no-store',
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setStates((prev) => ({
            ...prev,
            [key]: { phase: 'error', ...aiReadFailure({ reason: data.reason, error: data.error, status: res.status }) },
          }))
          return null
        }
        const summary =
          data.summary && typeof data.summary === 'object'
            ? data.summary
            : data.import && data.import.summary && typeof data.import.summary === 'object'
              ? data.import.summary
              : {}
        setReadings((prev) => ({ ...prev, [key]: data }))
        setStates((prev) => ({ ...prev, [key]: { phase: 'done', summary, cost: data.cost || null } }))
        if (typeof onDone === 'function') onDone(data, row)
        return data
      } catch {
        setStates((prev) => ({
          ...prev,
          [key]: {
            phase: 'error',
            ...aiReadFailure({ error: 'De AI-lezing lukte niet. Ga verder met de handmatige import.' }),
          },
        }))
        return null
      }
    },
    [onDone, token],
  )

  /**
   * "Bekijk en controleer": hands this one reading to the existing review screen
   * (Lijst | Kaart) under a one-time key. If the browser refuses to keep it, the
   * row says so instead of pretending the screen will open with the result.
   */
  const open = useCallback(
    (row) => {
      const key = aiReadRowKey(row)
      const payload = key ? readings[key] : null
      if (!key || !payload) return false
      const stashed = stashAiRead(typeof window !== 'undefined' ? window.sessionStorage : null, payload)
      if (!stashed.ok) {
        setStates((prev) => ({
          ...prev,
          [key]: { phase: 'error', message: HANDOFF_FAILED, nextLabel: null, nextHref: null },
        }))
        return false
      }
      if (typeof window !== 'undefined') window.location.assign(aiReviewHref(stashed.key))
      return true
    },
    [readings],
  )

  return { stateFor, read, open }
}
