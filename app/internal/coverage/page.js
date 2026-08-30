import { computeCoverageMetrics } from '@/src/services/coverageMetrics'

// Internal-only, read-only dashboard (PLATFORM-01). Not linked from any
// navigation, excluded from indexing below and via /public/robots.txt.
// Not authenticated — see planning/specs/tickets/platform-01-coverage-baseline-dashboard.md
// for why that's an accepted, temporary limitation of this ticket's scope.
export const metadata = {
  title: 'MenuCard — Coverage Dashboard (internal)',
  robots: { index: false, follow: false },
}

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

export default function CoverageDashboardPage() {
  const data = computeCoverageMetrics()
  const generatedAt = new Date().toISOString()

  return (
    <main
      style={{
        maxWidth: 960,
        margin: '0 auto',
        padding: '32px 20px 64px',
        fontFamily: 'system-ui, sans-serif',
        color: 'var(--text-primary)',
        background: 'var(--bg)',
        minHeight: '100vh',
      }}
    >
      <div
        style={{
          padding: '10px 14px',
          borderRadius: 8,
          border: '1px dashed var(--warning-border)',
          background: 'var(--warning-bg)',
          color: 'var(--warning)',
          fontSize: 13,
          marginBottom: 20,
        }}
      >
        Internal tool — not indexed, not linked from navigation, and not yet
        access-controlled (no auth exists until PLATFORM-05). Do not share
        this URL externally.
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
