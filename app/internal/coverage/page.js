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
// read-only badge, calmer breakdown tables (centered numeric columns, a
// muted em dash in place of the old, longer per-row explanatory
// sentence), and the headline-gap callout restyled with the existing
// warning tokens instead of the danger ones, so it reads as a data
// insight rather than an error. Lightweight, stroke-only inline SVG icons
// only (no icon font, no image asset), matching this project's existing
// convention (see app/internal/import-inbox/page.js's own icons).
//
// **PLATFORM-12 Phase 1 — prioritized data gaps (2026-10-04)**, against
// the content column of `docs/mockups/coverage-dashboard-v2.png` (its
// left-hand navigation column is PLATFORM-11's scope and is not built
// here; the existing InternalNav top bar stays the only navigation). Same
// data, new hierarchy: menu coverage (`metrics.menuData`) is the one
// dominant hero metric; the four existing metric cards stay, secondary,
// with a complete/partial/empty state; `byBuurt` is re-sorted on this
// page by the absolute number of restaurants still missing menu data
// (src/lib/coveragePriority.js), top 3 first with an inline "show all"
// over the same, already-fetched array; the by-cuisine table leaves the
// primary view; and every methodology/trust caveat moves into exactly one
// collapsed-by-default "Methodology & data notes" section on this page.
// No new route, API call, button-with-a-destination, or workflow — the
// mockup's "View restaurants without menus" action is deliberately not
// built (PLATFORM-12 Phase 2+). The metrics computation
// (src/services/coverageMetrics.js), the coverage route, the session/
// fetch/auth flow and every data value are unchanged.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import InternalNav from '@/src/components/InternalNav'
import { PRIORITY_DEFAULT_VISIBLE, sortByMenuDataGap, visiblePriorityRows, metricState } from '@/src/lib/coveragePriority'

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
function IconAlert() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  )
}
function IconChevronDown() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

// Complete / partial / empty — always shown as text too, never by color
// or shape alone. Every label meets WCAG AA (4.5:1) for normal text in both
// themes: "None yet" uses --text-secondary (8.13:1 dark / 7.56:1 light on
// the card), never the near-invisible --text-faint it used before
// (1.94:1 dark), so the text is at least as clear as the empty ring.
const STATE_STYLE = {
  complete: { label: 'Complete', color: 'var(--green)' },
  partial: { label: 'Partial', color: 'var(--warning)' },
  empty: { label: 'None yet', color: 'var(--text-secondary)' },
}

/** A small, purpose-built progress ring (decorative; the state is also
 * written out as text next to it). */
function StateRing({ state, pct }) {
  const r = 9
  const circumference = 2 * Math.PI * r
  const fraction = state === 'complete' ? 1 : state === 'empty' ? 0 : Math.min(1, Math.max(0, (pct || 0) / 100))
  const { color } = STATE_STYLE[state]
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r={r} fill="none" stroke="var(--border-strong)" strokeWidth="3" />
      {fraction > 0 && (
        <circle
          cx="12"
          cy="12"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${fraction * circumference} ${circumference}`}
          transform="rotate(-90 12 12)"
        />
      )}
    </svg>
  )
}

function Metric({ label, count, total, pct, icon }) {
  const state = metricState(count, total)
  const { label: stateLabel, color } = STATE_STYLE[state]
  return (
    // A flex column whose label row absorbs any extra height, so the
    // figures line up across cards even when one label wraps to two lines.
    <div style={{ padding: 16, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', background: 'var(--bg-card)', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10, flex: '1 0 auto' }}>
        <span style={{ width: 16, height: 16, display: 'flex', flexShrink: 0, color: 'var(--text-secondary)' }}>{icon}</span>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', minWidth: 0 }}>{label}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>
          {count} / {total}
        </div>
        <StateRing state={state} pct={pct} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 6, fontSize: 12.5 }}>
        <span style={{ color: 'var(--cov-text-subtle)' }}>{pct === null ? '—' : `${pct}%`}</span>
        <span style={{ color, fontWeight: 600 }}>{stateLabel}</span>
      </div>
    </div>
  )
}

const TH_STYLE = { padding: '10px 12px', borderBottom: '1px solid var(--border)', fontWeight: 600 }
const TD_STYLE = { padding: '10px 12px', borderBottom: '1px solid var(--border)' }

function BreakdownTable({ title, rows, tbodyId }) {
  return (
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
        <tbody id={tbodyId}>
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
  )
}

const NOTE_HEADING_STYLE = { fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px' }
const NOTE_TEXT_STYLE = { fontSize: 13, lineHeight: 1.55, color: 'var(--text-secondary)', margin: '0 0 14px' }

const CARD_STYLE = { padding: 20, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', background: 'var(--bg-card)' }

// Every <main> on this page carries className="cov-dashboard", which scopes
// --cov-text-subtle (app/globals.css): this page's own secondary-text color,
// AA-compliant in both themes, used instead of the global --text-muted
// (3.09–3.45:1 in dark). Global tokens stay unchanged for other screens.
const SHELL_STYLE = {
  maxWidth: 960,
  margin: '0 auto',
  padding: '32px 20px 64px',
  fontFamily: 'system-ui, sans-serif',
  color: 'var(--text-primary)',
  background: 'var(--bg)',
  minHeight: '100vh',
}

const PRIORITY_TBODY_ID = 'coverage-priority-rows'

export default function CoverageDashboardPage() {
  const router = useRouter()
  const [session, setSession] = useState(undefined) // undefined = loading, null = no session
  const [data, setData] = useState(null)
  const [generatedAt, setGeneratedAt] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  // The only client state PLATFORM-12 adds: whether the priority table
  // shows every neighbourhood or only the top PRIORITY_DEFAULT_VISIBLE.
  const [showAllBuurten, setShowAllBuurten] = useState(false)

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

  // Presentation-only re-sort of the already-fetched byBuurt rows (a new
  // array; `data` itself is never mutated).
  const priorityRows = useMemo(() => (data ? sortByMenuDataGap(data.byBuurt) : []), [data])

  if (session === undefined) {
    return <main className="cov-dashboard" style={{ ...SHELL_STYLE, color: 'var(--cov-text-subtle)' }}>Loading…</main>
  }

  if (error) {
    return (
      <main className="cov-dashboard" style={SHELL_STYLE}>
        <InternalNav accessToken={session.access_token} />
        <div
          style={{
            marginTop: 20,
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
    return (
      <main className="cov-dashboard" style={SHELL_STYLE}>
        <InternalNav accessToken={session.access_token} />
        <p style={{ marginTop: 20, color: 'var(--cov-text-subtle)' }}>Loading…</p>
      </main>
    )
  }

  const menuState = metricState(data.metrics.menuData.count, data.metrics.menuData.total)
  const { rows: visibleBuurten, hiddenCount } = visiblePriorityRows(priorityRows, showAllBuurten)

  return (
    <main className="cov-dashboard" style={SHELL_STYLE}>
      <InternalNav accessToken={session.access_token} />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginTop: 20, marginBottom: 20 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 26, margin: 0 }}>Coverage Dashboard</h1>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 11px',
                borderRadius: 'var(--radius-pill)',
                border: '1px solid var(--green-border)',
                background: 'var(--green-faint)',
                color: 'var(--green)',
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
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: '6px 0 2px' }}>
            Overview of restaurant data coverage across {data.city}.
          </p>
          <p style={{ color: 'var(--cov-text-subtle)', fontSize: 12.5, margin: 0 }}>Read-only, recomputed on every load. Generated {generatedAt}.</p>
        </div>
      </div>

      {/* Hero: menu coverage — data presence, not verified accuracy */}
      <section
        aria-labelledby="coverage-hero-heading"
        style={{ ...CARD_STYLE, padding: 24, display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start', marginBottom: 16 }}
      >
        <div style={{ flex: '1 1 300px', minWidth: 0 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--cov-text-subtle)' }}>
            Overall menu coverage
          </div>
          <h2 id="coverage-hero-heading" style={{ fontSize: 22, margin: '6px 0 4px', color: 'var(--text-primary)' }}>
            {menuState === 'complete' ? 'Menu coverage is complete' : 'Menu coverage needs attention'}
          </h2>
          <div style={{ fontSize: 'clamp(44px, 10vw, 64px)', fontWeight: 800, lineHeight: 1.05, color: 'var(--green)' }}>
            {data.metrics.menuData.pct === null ? '—' : `${data.metrics.menuData.pct}%`}
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 15, color: 'var(--text-secondary)' }}>
            {data.metrics.menuData.count} of {data.metrics.menuData.total} restaurants have digitized menu data.
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--cov-text-subtle)' }}>
            Shows whether menu data is present — not whether it has been verified as accurate.
          </p>
        </div>

        {data.metrics.menuData.missingRestaurantIds.length > 0 && (
          <div
            style={{
              flex: '1 1 300px',
              minWidth: 0,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: 16,
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--warning-border)',
              background: 'var(--warning-bg)',
            }}
          >
            <span style={{ width: 18, height: 18, display: 'flex', flexShrink: 0, color: 'var(--warning)', marginTop: 1 }}>
              <IconAlert />
            </span>
            <div style={{ minWidth: 0 }}>
              <strong style={{ color: 'var(--warning)' }}>Menu data is limited</strong>
              <div style={{ marginTop: 6, fontSize: 13.5, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>
                Dish search can currently only ever return results from these {data.metrics.menuData.count} restaurants:{' '}
                {data.metrics.menuData.restaurantIds.join(', ')}. The other{' '}
                {data.metrics.menuData.missingRestaurantIds.length} have no menu items in
                <code style={{ margin: '0 4px' }}>data/menus.json</code> at all — not a display bug, an actual
                data gap.
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Four secondary metric cards — the same four figures as before */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: 12,
          marginBottom: 20,
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

      {/* Priority gaps by neighbourhood */}
      <section aria-labelledby="coverage-priority-heading" style={{ ...CARD_STYLE, marginBottom: 20 }}>
        <h2 id="coverage-priority-heading" style={{ fontSize: 17, margin: '0 0 4px', color: 'var(--text-primary)' }}>
          Priority gaps by neighbourhood
        </h2>
        <p style={{ fontSize: 13, color: 'var(--cov-text-subtle)', margin: '0 0 12px' }}>
          Neighbourhoods with the most restaurants still missing menu data, largest gap first.
        </p>
        <BreakdownTable title="Priority gaps by neighbourhood" rows={visibleBuurten} tbodyId={PRIORITY_TBODY_ID} />
        {hiddenCount > 0 && (
          <button
            type="button"
            className="cov-toggle"
            aria-expanded={showAllBuurten}
            aria-controls={PRIORITY_TBODY_ID}
            onClick={() => setShowAllBuurten((open) => !open)}
          >
            {showAllBuurten ? `Show top ${PRIORITY_DEFAULT_VISIBLE} only` : `Show all ${priorityRows.length} neighbourhoods`}
            <span className="cov-toggle-chevron" aria-hidden="true">
              <IconChevronDown />
            </span>
          </button>
        )}
      </section>

      {/* Methodology & data notes — exactly one section, collapsed by default */}
      <details className="di-accordion-item">
        <summary className="di-accordion-trigger">
          <span className="di-accordion-icon">
            <IconDocument />
          </span>
          <span className="di-accordion-heading">
            <span className="di-accordion-title">Methodology &amp; data notes</span>
            <span className="di-accordion-subtitle">Coverage shows data presence, not verified accuracy.</span>
          </span>
          <span className="di-accordion-chevron">
            <IconChevronDown />
          </span>
        </summary>
        <div className="di-accordion-body">
          <h3 style={NOTE_HEADING_STYLE}>How the priority order works</h3>
          <p style={NOTE_TEXT_STYLE}>
            Neighbourhoods are ordered by the number of restaurants still missing menu data (restaurants minus
            restaurants with menu data), largest gap first. Ties go to the larger neighbourhood, then to the
            neighbourhood name alphabetically. The order is worked out on this page from the same figures shown in
            the table; no neighbourhood is left out, only the first {PRIORITY_DEFAULT_VISIBLE} are shown until the
            list is expanded.
          </p>

          <h3 style={NOTE_HEADING_STYLE}>Sample size</h3>
          <p style={NOTE_TEXT_STYLE}>
            Percentages are only shown for groups with at least {data.sampleThreshold} restaurants. Smaller groups
            show a dash (—) instead.
          </p>

          <h3 style={NOTE_HEADING_STYLE}>Why there is no cuisine breakdown</h3>
          <p style={NOTE_TEXT_STYLE}>
            The current <code>cuisine</code> field is a near-unique free-text description per restaurant (
            {data.byCuisine.length} distinct values across {data.totals.restaurants} restaurants), not a shared
            category taxonomy — most cuisine groups contain a single restaurant, so there is nothing meaningful to
            average within them. A cuisine table would look like a ranked priority list without being one, so it is
            not used as a prioritization axis here.
          </p>

          <h3 style={NOTE_HEADING_STYLE}>Presence, not verified accuracy</h3>
          <p style={NOTE_TEXT_STYLE}>
            All figures reflect data <em>presence</em>, not verified trust/provenance — the per-field trust model
            (PLATFORM-03) doesn&apos;t exist yet.
          </p>

          <h3 style={NOTE_HEADING_STYLE}>Baseline</h3>
          <p style={{ ...NOTE_TEXT_STYLE, marginBottom: 0 }}>
            A written, dated baseline snapshot of these same numbers is recorded at{' '}
            <code>docs/coverage/breda-baseline-2026-08-30.md</code>.
          </p>
        </div>
      </details>
    </main>
  )
}
