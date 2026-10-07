'use client'
import { useEffect, useState } from 'react'

// The browser's current time, known only after mount (null during the
// server render and the first paint), refreshed every minute. Used for the
// "Nu open" status so a server clock or a stale page never shows a
// restaurant as open (Kleurtaal v2, src/lib/openingStatus.js).
export default function useClientNow(intervalMs = 60000) {
  const [now, setNow] = useState(null)
  useEffect(() => {
    setNow(new Date())
    const timer = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
