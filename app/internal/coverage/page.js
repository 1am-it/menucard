'use client'

// Internal-only, read-only dashboard (PLATFORM-01). Not linked from any
// navigation, excluded from indexing via app/internal/layout.js's shared
// robots metadata and /public/robots.txt's own `Disallow: /internal/`.
//
// **Security fix (2026-09-12): now genuinely internal-only on the server,
// not merely unlinked.** Previously rendered with no authentication check
// at all — accepted at the time this ticket was scoped, before
// PLATFORM-05's internal-only mechanism existed; see
// planning/specs/tickets/platform-01-coverage-baseline-dashboard.md's own
// dated correction. Now reuses the exact same, already-proven session +
// authenticated-fetch pattern every other internal page already uses
// (src/lib/supabaseBrowser.js for the session,
// /api/internal/v1/coverage for data — gated there by
// authenticateInternalRequest + isInternalOnly('internal'), see
// src/lib/internalAuth.js/src/lib/importInbox.js). No direct Supabase
// access from the browser. The metrics computation itself
// (src/services/coverageMetrics.js) is unchanged — only how it's reached
// changed.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'

function Metric({ label, count, total, pct, tone }) {
  return (
    <div
      style={{
        padding: 18,
        borderRadius: 12,
        border: `1px solid ${tone === 'warning' ? 'var(--warning-border)' : 'var(--border)'}`,
        background: tone === 'warning' ? 'var(--warning-bg)' : 'var(--bg-card)',
      }}
    >
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 32, fontWeight: 700, color: tone === 'warning' ? 'var(--warning)' : 'var(--text-primary)' }}>
        {pct === null ? '—' : `${pct}%`}
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        {count} / {total}
      </div>
    </div>
  )
}

function BreakdownTable({ title, rows, sampleThreshold }) {
  return (
    <div style={{ marginTop: 12 }}>
      <h3 style={{ fontSize: 16, margin: '0 0 8px', color: 'var(--text-primary)' }}>{title}</h3>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--text-secondary)' }}>
              <th style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>Group</th>
              <th style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>Restaurants</th>
              <th style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>With menu data</th>
              <th style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>Coverage</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-primary)' }}>{r.label}</td>
                <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>{r.total}</td>
                <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>{r.withMenuData}</td>
                <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                  {r.pct === null ? `too few restaurants (n<${sampleThreshold}) for a %` : `${r.pct}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const SHELL_STYLE = {
  maxWidth: 960,
  margin: '0 auto',
  padding: '32px 20px 64px',
  fontFamily: 'system-ui, sans-serif',
  color: 'var(--text-primary)',
  background: 'var(--bg)',
  minHeight: '100vh',
}

export default function CoverageDashboardPage() {
  const router = useRouter()
  const [session, setSession] = useState(undefined) // undefined = loading, null = no session
  const [data, setData] = useState(null)
  const [generatedAt, setGeneratedAt] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const supabase = getSupabaseBrowser()
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace('/internal/login')
      } else {
        setSession(data.session)
      }
    })
  }, [router])

  const loadCoverage = useCallback(async (token) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/internal/v1/coverage', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || 'Failed to load the coverage dashboard')
        setData(null)
        return
      }
      setData(json)
      setGeneratedAt(new Date().toISOString())
    } catch {
      setError('Failed to load the coverage dashboard')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (session) loadCoverage(session.access_token)
  }, [session, loadCoverage])

  if (session === undefined) {
    return <main style={{ ...SHELL_STYLE, color: 'var(--text-muted)' }}>Loading…</main>
  }

  if (error) {
    return (
      <main style={SHELL_STYLE}>
        <div
          style={{
            padding: 18,
            borderRadius: 12,
            border: '1px solid var(--danger-border)',
            background: 'var(--danger-bg)',
            color: 'var(--danger)',
          }}
        >
          {error}
        </div>
      </main>
    )
  }

  if (loading || !data) {
    return <main style={{ ...SHELL_STYLE, color: 'var(--text-muted)' }}>Loading…</main>
  }

  return (
    <main style={SHELL_STYLE}>
      <div
        style={{
          padding: '10px 14px',
          borderRadius: 8,
          border: '1px dashed var(--border)',
          background: 'var(--bg-card)',
          color: 'var(--text-secondary)',
          fontSize: 13,
          marginBottom: 20,
        }}
      >
        Internal tool — internal-only, not indexed, and not linked from navigation. Read-only; recomputed on every
        load.
      </div>

      <h1 style={{ fontSize: 28, margin: '0 0 4px' }}>MenuCard — {data.city} Coverage Dashboard</h1>
      <p style={{ color: 'var(--text-secondary)', margin: '0 0 24px' }}>
        Live, read-only. Recomputed from the current static data on every
        request. Generated {generatedAt}.
      </p>

      <div
        style={{
          padding: 18,
          borderRadius: 12,
          border: '1px solid var(--danger-border)',
          background: 'var(--danger-bg)',
          marginBottom: 28,
        }}
      >
        <strong style={{ color: 'var(--danger)' }}>
          Headline gap: only {data.metrics.menuData.count} of {data.metrics.menuData.total} restaurants
          ({data.metrics.menuData.pct}%) have any digitized menu data in the canonical,
          search-indexed dataset.
        </strong>
        <div style={{ marginTop: 8, fontSize: 14, color: 'var(--text-secondary)' }}>
          Dish search can currently only ever return results from these {data.metrics.menuData.count} restaurants:{' '}
          {data.metrics.menuData.restaurantIds.join(', ')}. The other{' '}
          {data.metrics.menuData.missingRestaurantIds.length} have no menu items in
          <code style={{ margin: '0 4px' }}>data/menus.json</code> at all — not a display bug, an actual
          data gap.
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 14,
          marginBottom: 32,
        }}
      >
        <Metric
          label="Restaurants with basic info"
          count={data.metrics.basicInfo.count}
          total={data.metrics.basicInfo.total}
          pct={data.metrics.basicInfo.pct}
        />
        <Metric
          label="Restaurants with menu data"
          count={data.metrics.menuData.count}
          total={data.metrics.menuData.total}
          pct={data.metrics.menuData.pct}
          tone="warning"
        />
        <Metric
          label="Menu items with a price"
          count={data.metrics.priceCoverage.count}
          total={data.metrics.priceCoverage.total}
          pct={data.metrics.priceCoverage.pct}
        />
        <Metric
          label="Reservation method confirmed"
          count={data.metrics.reservationConfirmed.count}
          total={data.metrics.reservationConfirmed.total}
          pct={data.metrics.reservationConfirmed.pct}
          tone="warning"
        />
      </div>

      <BreakdownTable title="By neighbourhood (buurt)" rows={data.byBuurt} sampleThreshold={data.sampleThreshold} />
      <BreakdownTable title="By cuisine" rows={data.byCuisine} sampleThreshold={data.sampleThreshold} />

      <p style={{ marginTop: 12, fontSize: 13, color: 'var(--text-muted)' }}>
        Note: the current <code>cuisine</code> field is a near-unique free-text
        description per restaurant (24 distinct values across 25 restaurants), not a
        shared category taxonomy — most rows above show a count only, not a
        percentage, because there's nothing meaningful to average within a group of
        one.
      </p>

      <div style={{ marginTop: 32, padding: 16, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-card)', fontSize: 13, color: 'var(--text-secondary)' }}>
        All figures reflect data <em>presence</em>, not verified trust/provenance —
        the per-field trust model (PLATFORM-03) doesn't exist yet. A written,
        dated baseline snapshot of these same numbers is recorded at{' '}
        <code>docs/coverage/breda-baseline-2026-08-30.md</code>.
      </div>
    </main>
  )
}
