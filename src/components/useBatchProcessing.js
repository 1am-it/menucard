'use client'

// BE-31 (#74) — the existing page-bound batch processing, reused instead of
// duplicated. BE-25/BE-30 already drive the next URL, one job per call, from the
// starter's open page (there is no cron; the same claim/lease handler also has a
// service-worker entry). Dekking's "Controleer N geselecteerde" and the result
// below the add form use this hook so both keep exactly that rule: the check runs
// only while the page is open, closing merely pauses it.
//
// The hook never writes anything itself: it calls the same
// POST /api/internal/v1/batch-analysis/<id>/process endpoint the batch page
// calls, and reports back so the caller can reload its own rows.

import { useCallback, useEffect, useRef } from 'react'

const API = '/api/internal/v1/batch-analysis'

export default function useBatchProcessing({ token, batchId, enabled = true, onTick }) {
  const loopToken = useRef(0)
  const tickRef = useRef(onTick)
  tickRef.current = onTick

  const run = useCallback(
    async (id, signal) => {
      let outcome = 'done'
      let retryAt = null
      try {
        const res = await fetch(`${API}/${id}/process`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) outcome = res.status === 403 ? 'stop' : 'error'
        else {
          outcome = body.outcome
          retryAt = body.retry_at
        }
      } catch {
        outcome = 'error'
      }
      if (signal.aborted) return null
      const fresh = tickRef.current ? await tickRef.current(id) : null
      return { outcome, retryAt, fresh }
    },
    [token],
  )

  useEffect(() => {
    if (!token || !batchId || !enabled) return undefined
    const controller = new AbortController()
    const myToken = ++loopToken.current
    let timer = null
    const alive = () => loopToken.current === myToken && !controller.signal.aborted

    async function step() {
      if (!alive()) return
      const result = await run(batchId, controller.signal)
      if (!result || !alive()) return
      const { outcome, retryAt, fresh } = result
      const closed = fresh && fresh.detail && fresh.detail.batch && fresh.detail.batch.closed_at
      if (outcome === 'stop' || outcome === 'done' || closed) return
      let wait = 400
      if (outcome === 'busy' || outcome === 'waiting') {
        const until = retryAt ? new Date(retryAt).getTime() - Date.now() : 5000
        wait = Math.min(30000, Math.max(3000, until))
      } else if (outcome === 'error') wait = 10000
      timer = setTimeout(step, wait)
    }

    step()
    return () => {
      controller.abort()
      loopToken.current += 1
      if (timer) clearTimeout(timer)
    }
  }, [token, batchId, enabled, run])
}

export { API as BATCH_ANALYSIS_API }
