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
import Emoji from '@/src/components/Emoji'
import CoverageCheckSection from './CoverageCheckSection'
import NewFoundSection from './NewFoundSection'
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
function IconChevronDown() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

// Complete / partial / empty — always shown as text too, never by color
// or shape alone. Kleurtaal v2: only "Compleet" is a positive status;
// "Gedeeltelijk" has no decided role and stays neutral (--status-neutral), and
// "Nog niets" uses --text-secondary. Every label meets WCAG AA on the card
// in both themes (asserted in src/lib/coveragePriority.test.js).
// BE-32 (#75, criterion 6): the visible copy is Dutch.
const STATE_STYLE = {
  complete: { label: 'Compleet', color: 'var(--status-positive)' },
  partial: { label: 'Gedeeltelijk', color: 'var(--status-neutral)' },
  empty: { label: 'Nog niets', color: 'var(--text-secondary)' },
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
        <span style={{ color: 'var(--text-secondary)' }}>{pct === null ? '—' : `${pct}%`}</span>
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
      aria-label={`${title}: tabel, horizontaal scrollbaar`}
      tabIndex={0}
      style={{ overflowX: 'auto' }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--text-secondary)', background: 'var(--bg-elevated)' }}>
            <th scope="col" style={TH_STYLE}>Buurt</th>
            <th scope="col" style={{ ...TH_STYLE, textAlign: 'center' }}>Restaurants</th>
            <th scope="col" style={{ ...TH_STYLE, textAlign: 'center' }}>Met menukaart</th>
            <th scope="col" style={{ ...TH_STYLE, textAlign: 'center' }}>Dekking</th>
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

// Every <main> on this page carries className="cov-dashboard" (a page
// hook). Secondary text uses the global --text-secondary, the only
// readable secondary colour under Kleurtaal v2 — no page-scoped variant.
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
  // Criterium 6: de derde tegel telt dezelfde rijen als "Nog niet
  // gecontroleerd". De sectie laadt ze; deze pagina toont alleen het getal.
  const [uncheckedCount, setUncheckedCount] = useState(null)

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
        setError(json.error || 'Dekking kon niet worden geladen.')
        setData(null)
        return
      }
      setData(json)
      setGeneratedAt(new Date().toISOString())
    } catch {
      setError('Dekking kon niet worden geladen.')
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
    return <main className="cov-dashboard" style={{ ...SHELL_STYLE, color: 'var(--text-secondary)' }}>Laden…</main>
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
        <p style={{ marginTop: 20, color: 'var(--text-secondary)' }}>Laden…</p>
      </main>
    )
  }

  const menuState = metricState(data.metrics.menuData.count, data.metrics.menuData.total)
  const { rows: visibleBuurten, hiddenCount } = visiblePriorityRows(priorityRows, showAllBuurten)

  return (
    <main className="cov-dashboard" style={SHELL_STYLE}>
      <InternalNav accessToken={session.access_token} />

      {/* Kop (BE-32, criterium 6): Nederlands, drie tegels in de BE-28-stijl. */}
      <div className="cov-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h1 className="cov-title">Dekking <Emoji glyph="📊" /></h1>
          <span className="cov-badge">
            <span style={{ width: 13, height: 13, display: 'flex' }}>
              <IconLock />
            </span>
            Alleen intern · Alleen lezen
          </span>
        </div>
        <p className="cov-sub">
          Hoeveel van {data.city} staat er al in, en waar zitten de gaten. Je start én rondt het werk hier af.
        </p>
        <p className="cov-stamp">Alleen lezen, bij elke load opnieuw berekend · bijgewerkt {generatedAt}.</p>
      </div>

      {/* De drie tegels van de mockup: restaurants, met menukaart, nog niet
          gecontroleerd. De derde tegel komt uit dezelfde telling als de rijen
          eronder (CoverageCheckSection), nooit uit een tweede schatting. */}
      <div className="cov-tiles" role="group" aria-label="Dekking in drie cijfers">
        <div className="cov-tile">
          <span className="cov-tile-value">{data.totals.restaurants}</span>
          <span className="cov-tile-label"><Emoji glyph="🍽️" /> restaurants</span>
        </div>
        <div className={menuState === 'complete' ? 'cov-tile cov-tile--positive' : 'cov-tile'}>
          <span className="cov-tile-value">{data.metrics.menuData.count}</span>
          <span className="cov-tile-label">
            <Emoji glyph="📋" /> met menukaart
            <span className="cov-tile-note">
              {data.metrics.menuData.pct === null ? '—' : `${data.metrics.menuData.pct}%`} van{' '}
              {data.metrics.menuData.total}
            </span>
          </span>
        </div>
        <div className="cov-tile cov-tile--attention">
          <span className="cov-tile-value">{uncheckedCount === null ? '…' : uncheckedCount}</span>
          <span className="cov-tile-label"><Emoji glyph="🔎" /> nog niet gecontroleerd</span>
        </div>
      </div>

      {/* BE-31 (#74): "Nog niet gecontroleerd" lives here now, with the existing
          reason texts, selection and the existing batch analysis as its check. */}
      <div style={{ marginBottom: 20 }}>
        <CoverageCheckSection token={session.access_token} onUncheckedCount={setUncheckedCount} />
        <NewFoundSection token={session.access_token} />
      </div>

      {/* Details: dezelfde cijfers als voorheen, zonder de dubbele
          menukaart-hero — dat cijfer staat nu in de tweede tegel. */}
      <h2 className="cov-section-title">Details per onderdeel</h2>
      {data.metrics.menuData.missingRestaurantIds.length > 0 && (
        <section className="cov-note" aria-labelledby="coverage-limit-heading">
          <span style={{ width: 18, height: 18, display: 'flex', flexShrink: 0, color: 'var(--status-neutral)', marginTop: 1 }}>
            <IconDocument />
          </span>
          <div style={{ minWidth: 0 }}>
            <strong id="coverage-limit-heading" style={{ color: 'var(--status-neutral)' }}>
              Menudata is beperkt
            </strong>
            <div style={{ marginTop: 6, fontSize: 13.5, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>
              De gerechtzoekfunctie kan nu alleen resultaten geven uit deze {data.metrics.menuData.count} restaurants:{' '}
              {data.metrics.menuData.restaurantIds.join(', ')}. De andere{' '}
              {data.metrics.menuData.missingRestaurantIds.length} hebben helemaal geen gerechten in
              <code style={{ margin: '0 4px' }}>data/menus.json</code> — geen weergavefout, maar een echt gat in de
              data. Presence, geen bewezen juistheid.
            </div>
          </div>
        </section>
      )}

      {/* The same figures as before, minus the menu-data card: that number is
          now the second tile of the page top. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: 12,
          marginBottom: 20,
        }}
      >
        <Metric
          label="Restaurants met basisgegevens"
          count={data.metrics.basicInfo.count}
          total={data.metrics.basicInfo.total}
          pct={data.metrics.basicInfo.pct}
          icon={<IconDocument />}
        />
        <Metric
          label="Gerechten met een prijs"
          count={data.metrics.priceCoverage.count}
          total={data.metrics.priceCoverage.total}
          pct={data.metrics.priceCoverage.pct}
          icon={<IconTag />}
        />
        <Metric
          label="Reserveren bevestigd"
          count={data.metrics.reservationConfirmed.count}
          total={data.metrics.reservationConfirmed.total}
          pct={data.metrics.reservationConfirmed.pct}
          icon={<IconCalendar />}
        />
      </div>

      {/* Grootste gaten per buurt — dezelfde tabel, Nederlandse kop */}
      <section aria-labelledby="coverage-priority-heading" style={{ ...CARD_STYLE, marginBottom: 20 }}>
        <h2 id="coverage-priority-heading" style={{ fontSize: 17, margin: '0 0 4px', color: 'var(--text-primary)' }}>
          Grootste gaten per buurt
        </h2>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
          Buurten met de meeste restaurants zonder menukaart, grootste gat eerst.
        </p>
        <BreakdownTable title="Grootste gaten per buurt" rows={visibleBuurten} tbodyId={PRIORITY_TBODY_ID} />
        {hiddenCount > 0 && (
          <button
            type="button"
            className="cov-toggle"
            aria-expanded={showAllBuurten}
            aria-controls={PRIORITY_TBODY_ID}
            onClick={() => setShowAllBuurten((open) => !open)}
          >
            {showAllBuurten ? `Toon alleen de top ${PRIORITY_DEFAULT_VISIBLE}` : `Toon alle ${priorityRows.length} buurten`}
            <span className="cov-toggle-chevron" aria-hidden="true">
              <IconChevronDown />
            </span>
          </button>
        )}
      </section>

      {/* Methodologie & datanotities — één sectie, standaard dichtgeklapt */}
      <details className="di-accordion-item">
        <summary className="di-accordion-trigger">
          <span className="di-accordion-icon">
            <IconDocument />
          </span>
          <span className="di-accordion-heading">
            <span className="di-accordion-title">Methodologie &amp; datanotities</span>
            <span className="di-accordion-subtitle">Dekking toont aanwezigheid van data, geen bewezen juistheid.</span>
          </span>
          <span className="di-accordion-chevron">
            <IconChevronDown />
          </span>
        </summary>
        <div className="di-accordion-body">
          <h3 style={NOTE_HEADING_STYLE}>Hoe de volgorde werkt</h3>
          <p style={NOTE_TEXT_STYLE}>
            Buurten staan op het aantal restaurants zonder menukaart (restaurants min restaurants met menukaart),
            grootste gat eerst. Bij een gelijk gat gaat de grotere buurt voor, daarna de naam op alfabet. De volgorde
            wordt op deze pagina berekend uit dezelfde cijfers als de tabel; geen buurt valt weg, alleen de eerste{' '}
            {PRIORITY_DEFAULT_VISIBLE} zijn zichtbaar tot je de lijst uitklapt.
          </p>

          <h3 style={NOTE_HEADING_STYLE}>Steekproefgrootte</h3>
          <p style={NOTE_TEXT_STYLE}>
            Percentages verschijnen alleen bij groepen met minstens {data.sampleThreshold} restaurants. Kleinere
            groepen tonen een streepje (—).
          </p>

          <h3 style={NOTE_HEADING_STYLE}>Waarom er geen keuken-tabel is</h3>
          <p style={NOTE_TEXT_STYLE}>
            Het huidige <code>cuisine</code>-veld is een bijna unieke vrije tekst per restaurant (
            {data.byCuisine.length} verschillende waarden over {data.totals.restaurants} restaurants), geen gedeelde
            keuken-taxonomie — de meeste groepen bevatten één restaurant, dus er valt niets zinvols te middelen. Een
            keuken-tabel zou op een prioriteitenlijst lijken zonder er een te zijn en wordt hier daarom niet gebruikt.
          </p>

          <h3 style={NOTE_HEADING_STYLE}>Aanwezigheid, geen bewezen juistheid</h3>
          <p style={NOTE_TEXT_STYLE}>
            Alle cijfers gaan over de <em>aanwezigheid</em> van data, niet over bewezen betrouwbaarheid of herkomst —
            het trust-model per veld (PLATFORM-03) bestaat nog niet.
          </p>

          <h3 style={NOTE_HEADING_STYLE}>Nulmeting</h3>
          <p style={{ ...NOTE_TEXT_STYLE, marginBottom: 0 }}>
            Een geschreven, gedateerde nulmeting van dezelfde cijfers staat in{' '}
            <code>docs/coverage/breda-baseline-2026-08-30.md</code>.
          </p>

        </div>
      </details>

      {/* Criterium 5: de bronvermelding van de kaartgegevens staat zichtbaar op
          de pagina waar OSM-gegevens verschijnen. */}
      <p className="cov-stamp" style={{ marginTop: 18 }}>
        Kaartgegevens: © OpenStreetMap-bijdragers. Voorstellen zijn voorstellen; niets wordt automatisch toegevoegd.
      </p>
    </main>
  )
}
