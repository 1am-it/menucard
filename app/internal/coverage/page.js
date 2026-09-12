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
// dated correction. Reuses the exact same, already-proven session +
// authenticated-fetch pattern every other internal page already uses
// (src/lib/supabaseBrowser.js for the session,
// /api/internal/v1/coverage for data — gated there by
// authenticateInternalRequest + isInternalOnly('internal'), see
// src/lib/internalAuth.js/src/lib/importInbox.js). No direct Supabase
// access from the browser.
//
// **Presentation-only rebuild (2026-09-12, later still)** against
// `docs/mockups/coverage-dashboard-v1.png`: a compact internal-only/
// read-only badge, four equal metric cards (count first, percentage as
// secondary context — matching the mockup's own emphasis), calmer
// breakdown tables (centered numeric columns, a muted em dash in place
// of the old, longer per-row explanatory sentence, one shared
// explanation below each table instead of repeating it per row), and
// the headline-gap
// callout restyled with the existing warning tokens instead of the
// danger ones, so it reads as a data insight rather than an error. The
// metrics computation (src/services/coverageMetrics.js), the session/
// fetch/auth flow above, every data value, and the mobile horizontal
// table scroll are all unchanged — only how the same numbers are laid
// out changed. Lightweight, stroke-only inline SVG icons only (no icon
// font, no image asset), matching this project's existing convention
// (see app/internal/import-inbox/page.js's own icons).

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'

function IconLock() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}
function IconDocument() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  )
}
function IconUtensils() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2v6a2 2 0 0 0 4 0V2M8 8v14" />
      <path d="M18 2c-1.4 1.6-1.8 4.2-1.8 6s.4 3 1.8 3v10" />
    </svg>
  )
}
function IconTag() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.59 13.41 11 3.83A2 2 0 0 0 9.59 3.24L3 9.83a2 2 0 0 0 0 2.83l9.59 9.59a2 2 0 0 0 2.83 0l6.59-6.59a2 2 0 0 0 0-2.83Z" />
      <circle cx="7.5" cy="7.5" r="1.2" />
    </svg>
  )
}
function IconCalendar() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  )
}
function IconInfo() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-5M12 8h.01" />
    </svg>
  )
}

function Metric({ label, count, total, pct, icon }) {
  return (
    <div style={{ padding: 18, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)' }}>
          {count} / {total}
        </div>
        <span
          style={{
            width: 34,
            height: 34,
            borderRadius: '50%',
            background: 'var(--green-faint)',
            color: 'var(--green)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <span style={{ width: 16, height: 16, display: 'flex' }}>{icon}</span>
        </span>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>{pct === null ? '—' : `${pct}%`}</div>
    </div>
  )
}

const TH_STYLE = { padding: '10px 12px', borderBottom: '1px solid var(--border)', fontWeight: 600 }
const TD_STYLE = { padding: '10px 12px', borderBottom: '1px solid var(--border)' }

function BreakdownTable({ title, rows, sampleThreshold }) {
  return (
    <div style={{ padding: 20, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', background: 'var(--bg-card)', marginBottom: 20 }}>
      <h2 style={{ fontSize: 16, margin: '0 0 12px', color: 'var(--text-primary)' }}>{title}</h2>
      <div
        role="region"
        aria-label={`${title} table, horizontally scrollable`}
        tabIndex={0}
        style={{ overflowX: 'auto' }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--text-secondary)', background: 'var(--green-faint)' }}>
              <th scope="col" style={TH_STYLE}>Group</th>
              <th scope="col" style={{ ...TH_STYLE, textAlign: 'center' }}>Restaurants</th>
              <th scope="col" style={{ ...TH_STYLE, textAlign: 'center' }}>With menu data</th>
              <th scope="col" style={{ ...TH_STYLE, textAlign: 'center' }}>Coverage</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td style={{ ...TD_STYLE, color: 'var(--text-primary)' }}>{r.label}</td>
                <td style={{ ...TD_STYLE, textAlign: 'center', color: 'var(--text-secondary)' }}>{r.total}</td>
                <td style={{ ...TD_STYLE, textAlign: 'center', color: 'var(--text-secondary)' }}>{r.withMenuData}</td>
                <td style={{ ...TD_STYLE, textAlign: 'center', color: 'var(--text-secondary)' }}>
                  {r.pct === null ? '—' : `${r.pct}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginTop: 14,
          padding: '8px 12px',
          borderRadius: 'var(--radius-md)',
          background: 'var(--bg-elevated)',
          color: 'var(--text-muted)',
          fontSize: 12.5,
        }}
      >
        <span style={{ width: 14, height: 14, display: 'flex', flexShrink: 0 }}>
          <IconInfo />
        </span>
        Percentages are only shown for groups with at least {sampleThreshold} restaurants.
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
            borderRadius: 'var(--radius-lg)',
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, margin: '0 0 4px' }}>MenuCard — {data.city} Coverage Dashboard</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>Read-only, recomputed on every load. Generated {generatedAt}.</p>
        </div>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            borderRadius: 'var(--radius-pill)',
            border: '1px solid var(--border)',
            background: 'var(--bg-card)',
            color: 'var(--text-secondary)',
            fontSize: 12,
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ width: 13, height: 13, display: 'flex' }}>
            <IconLock />
          </span>
          Internal only · Read-only
        </span>
      </div>

      <div
        style={{
          padding: 18,
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--warning-border)',
          background: 'var(--warning-bg)',
          marginBottom: 28,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span style={{ width: 18, height: 18, display: 'flex', flexShrink: 0, color: 'var(--warning)', marginTop: 1 }}>
            <IconInfo />
          </span>
          <div>
            <strong style={{ color: 'var(--warning)' }}>
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
          icon={<IconDocument />}
        />
        <Metric
          label="Restaurants with menu data"
          count={data.metrics.menuData.count}
          total={data.metrics.menuData.total}
          pct={data.metrics.menuData.pct}
          icon={<IconUtensils />}
        />
        <Metric
          label="Menu items with a price"
          count={data.metrics.priceCoverage.count}
          total={data.metrics.priceCoverage.total}
          pct={data.metrics.priceCoverage.pct}
          icon={<IconTag />}
        />
        <Metric
          label="Reservation method confirmed"
          count={data.metrics.reservationConfirmed.count}
          total={data.metrics.reservationConfirmed.total}
          pct={data.metrics.reservationConfirmed.pct}
          icon={<IconCalendar />}
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

      <div style={{ marginTop: 32, padding: 16, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', background: 'var(--bg-card)', fontSize: 13, color: 'var(--text-secondary)' }}>
        All figures reflect data <em>presence</em>, not verified trust/provenance —
        the per-field trust model (PLATFORM-03) doesn't exist yet. A written,
        dated baseline snapshot of these same numbers is recorded at{' '}
        <code>docs/coverage/breda-baseline-2026-08-30.md</code>.
      </div>
    </main>
  )
}
