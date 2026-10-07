'use client'

// Bronwerkvoorraad — internal, read-only source workqueue
// (planning/specs/tickets/be-23-internal-source-workqueue.md; visual
// reference docs/mockups/internal-source-workqueue-v1.png). Same
// authenticated-API pattern as every other internal page: the session
// comes from src/lib/supabaseBrowser.js, the data from
// GET /api/internal/v1/source-workqueue — never direct Supabase access from
// the browser. Reachable through the existing InternalNav Werkvoorraad
// disclosure; no second navigation.
//
// Every row shows two separate statuses (Bron, Menukaart) and exactly one
// action. Actions only open a guidance or comparison panel inside this
// page: nothing here starts an analysis, fetches a website, changes data,
// approves or publishes anything. All wording comes from
// src/lib/sourceWorkqueue.js, the same vocabulary everywhere on the page.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import InternalNav from '@/src/components/InternalNav'
import {
  SOURCE_STATUSES,
  MENU_STATUSES,
  SOURCE_LABELS,
  MENU_LABELS,
  ACTION_LABELS,
  QUEUES,
  QUEUE_LABELS,
  NOT_IN_QUEUE_LABELS,
  SORT_MODES,
  SORT_LABELS,
  sortRows,
  filterRows,
  wijkOptions,
} from '@/src/lib/sourceWorkqueue'

// ── Icons (decorative; every status always also has its text) ───────────

function Svg({ children }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  )
}
const ICON_CHECK = (
  <Svg>
    <circle cx="12" cy="12" r="10" />
    <path d="m8 12 3 3 5-6" />
  </Svg>
)
const ICON_WARNING = (
  <Svg>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </Svg>
)
const ICON_LOCK = (
  <Svg>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </Svg>
)
const ICON_SWAP = (
  <Svg>
    <path d="M17 2l4 4-4 4" />
    <path d="M3 11V9a3 3 0 0 1 3-3h15" />
    <path d="M7 22l-4-4 4-4" />
    <path d="M21 13v2a3 3 0 0 1-3 3H3" />
  </Svg>
)
const ICON_INFO = (
  <Svg>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4" />
    <path d="M12 8h.01" />
  </Svg>
)
const ICON_DOT = (
  <Svg>
    <circle cx="12" cy="12" r="4" fill="currentColor" />
  </Svg>
)
const ICON_CHEVRON = (
  <Svg>
    <path d="m9 18 6-6-6-6" />
  </Svg>
)
const ICON_SEARCH = (
  <Svg>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Svg>
)

// Kleurtaal v2-statusrol + icoon per status. De rol voegt alleen kleur toe;
// de betekenis staat altijd in de tekst ("Bron: …" / "Menukaart: …") en
// de vorm van het icoon. Mapping volgens de ontwerpbron (design-reference.md,
// "Kleurtaal v2"): Bereikbaar → positive; Niet bereikbaar → blocked;
// Toegang beperkt, Identiteit gewijzigd, Structuur niet herkend → old;
// Klaar voor review → file; Niet beoordeeld, Geen menukaart → neutral.
const SOURCE_BADGE = {
  reachable: { tone: 'positive', icon: ICON_CHECK },
  unreachable: { tone: 'blocked', icon: ICON_WARNING },
  access_limited: { tone: 'old', icon: ICON_LOCK },
  identity_changed: { tone: 'old', icon: ICON_SWAP },
}
const MENU_BADGE = {
  ready_for_review: { tone: 'file', icon: ICON_INFO },
  structure_not_recognized: { tone: 'old', icon: ICON_WARNING },
  no_menu_found: { tone: 'neutral', icon: ICON_DOT },
  not_assessed: { tone: 'neutral', icon: ICON_DOT },
}

const SOURCE_EXPLANATIONS = {
  reachable: 'De website kon bij de laatste controle worden opgehaald.',
  unreachable: 'De website kon bij de laatste controle niet worden opgehaald.',
  access_limited: 'De website staat automatisch ophalen niet toe.',
  identity_changed: 'Er is vastgelegd bewijs dat dit adres nu bij een ander of hernoemd restaurant hoort.',
}
const MENU_EXPLANATIONS = {
  ready_for_review: 'Er is automatisch een menukaart herkend; die wacht op menselijke beoordeling.',
  structure_not_recognized: 'Er is een mogelijke menukaart gevonden, maar de opbouw is niet herkend.',
  no_menu_found: 'Er is vastgesteld dat de bron geen menukaart bevat.',
  not_assessed: 'Er is (nog) geen oordeel over de menukaart — bijvoorbeeld omdat de bron niet gelezen kon worden.',
}

function Badge({ dimension, status }) {
  const isSource = dimension === 'source'
  const meta = (isSource ? SOURCE_BADGE : MENU_BADGE)[status]
  const label = (isSource ? SOURCE_LABELS : MENU_LABELS)[status]
  if (!meta || !label) return null
  return (
    <span className={`swq-badge swq-badge--${meta.tone}`}>
      {meta.icon}
      <span>
        {isSource ? 'Bron' : 'Menukaart'}: {label}
      </span>
    </span>
  )
}

function formatChecked(value) {
  if (!value) return { date: 'Onbekend', time: null }
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return { date: 'Onbekend', time: null }
  return {
    date: d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }),
  }
}

// ── Action panels: guidance only, never a state change ───────────────────

function ActionPanel({ row, onLater }) {
  const onboarding = (
    <a href="/internal/onboarding-restaurant" className="swq-panel-link">
      Naar Onboarding Restaurant
    </a>
  )
  if (row.action === 'check_identity') {
    // Only reachable with explicit identity evidence, which the current
    // data model never provides (see the ticket's "Datamodelkloof"). No
    // confirm button: "Later" is the only option here.
    return (
      <div className="swq-panel">
        <p className="swq-panel-title">Identiteit controleren</p>
        <div className="swq-compare">
          <div>
            <p className="swq-compare-heading">Bekend bij ons</p>
            <p>{row.name}</p>
            {row.wijk && <p className="swq-muted">{row.wijk}</p>}
            {row.domain && <p className="swq-muted">{row.domain}</p>}
          </div>
          <div>
            <p className="swq-compare-heading">Aangetroffen op de bron</p>
            <p>{(row.identity && row.identity.observedName) || 'Niet vastgelegd'}</p>
          </div>
        </div>
        <p className="swq-panel-text">
          Er wordt niets overgenomen: naam, menukaart en status blijven ongewijzigd tot iemand dit bewust bevestigt in een
          aparte stap.
        </p>
        <button type="button" className="swq-btn-secondary" onClick={onLater}>
          Later
        </button>
      </div>
    )
  }
  const texts = {
    review: 'Er is automatisch een menukaart herkend. Start de analyse van deze bron in Onboarding Restaurant en controleer gerechten en prijzen voordat er iets wordt opgeslagen.',
    review_manually: 'Er is geen menukaart automatisch herkend. Bekijk de website van het restaurant zelf en leg een menukaart alleen vast via Onboarding Restaurant.',
    check_source:
      row.source === 'unreachable'
        ? 'De website kon bij de laatste controle niet worden opgehaald. Controleer of het adres nog klopt en of het restaurant nog bestaat.'
        : 'Op deze bron is geen menukaart aangetroffen. Kijk of de menukaart op een andere pagina of als PDF staat.',
    check_access: 'De website staat automatisch ophalen niet toe. Bekijk de website zelf; probeer de beperking nooit te omzeilen.',
  }
  return (
    <div className="swq-panel">
      <p className="swq-panel-title">{ACTION_LABELS[row.action]}</p>
      <p className="swq-panel-text">{texts[row.action]}</p>
      {onboarding}
    </div>
  )
}

function ActionButton({ row, open, panelId, onToggle, buttonRef }) {
  return (
    <button
      type="button"
      ref={buttonRef}
      className="swq-action"
      aria-expanded={open}
      aria-controls={panelId}
      aria-label={`${ACTION_LABELS[row.action]} — ${row.name}`}
      onClick={onToggle}
    >
      <span>{ACTION_LABELS[row.action]}</span>
      {ICON_CHEVRON}
    </button>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function SourceWorkqueuePage() {
  const router = useRouter()
  const [session, setSession] = useState(undefined) // undefined = loading, null = no session
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [queue, setQueue] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [menuFilter, setMenuFilter] = useState('all')
  const [wijkFilter, setWijkFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [sortMode, setSortMode] = useState('action_first')
  const [legendOpen, setLegendOpen] = useState(false)
  const [openRow, setOpenRow] = useState(null) // `${view}:${restaurantId}`
  const actionRefs = useRef({})

  useEffect(() => {
    const supabase = getSupabaseBrowser()
    supabase.auth.getSession().then(({ data: sessionData }) => {
      if (!sessionData.session) router.replace('/internal/login')
      else setSession(sessionData.session)
    })
  }, [router])

  const load = useCallback(async (token) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/internal/v1/source-workqueue', { headers: { Authorization: `Bearer ${token}` } })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error || 'De bronwerkvoorraad kon niet worden geladen.')
        setData(null)
        return
      }
      setData(body)
    } catch {
      setError('De bronwerkvoorraad kon niet worden geladen.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (session) load(session.access_token)
  }, [session, load])

  const rows = useMemo(
    () =>
      ((data && data.rows) || []).map((r) => ({
        restaurantId: r.restaurant_id,
        name: r.name,
        wijk: r.wijk,
        domain: r.domain,
        source: r.source,
        menu: r.menu,
        action: r.action,
        queue: r.queue,
        priority: r.priority,
        checkedAt: r.checked_at,
        identity: null,
      })),
    [data]
  )
  const counts = (data && data.counts) || { review: 0, source: 0, identity: 0, total: 0 }
  const visible = useMemo(
    () => sortRows(filterRows(rows, { queue, source: sourceFilter, menu: menuFilter, wijk: wijkFilter, query }), sortMode),
    [rows, queue, sourceFilter, menuFilter, wijkFilter, query, sortMode]
  )
  const wijken = useMemo(() => wijkOptions(rows), [rows])
  const notInQueue = (data && data.not_in_queue) || []

  function toggleRow(key) {
    setOpenRow((current) => (current === key ? null : key))
  }
  function closeAndFocus(key) {
    setOpenRow(null)
    const button = actionRefs.current[key]
    if (button) button.focus()
  }

  if (session === undefined) {
    return (
      <div className="di-page">
        <main className="di-main" style={{ color: 'var(--text-secondary)' }}>
          Laden…
        </main>
      </div>
    )
  }

  const filtersActive = queue !== 'all' || sourceFilter !== 'all' || menuFilter !== 'all' || wijkFilter !== 'all' || query.trim() !== ''

  return (
    <div className="di-page">
      <main className="di-main swq-main">
        <InternalNav accessToken={session.access_token} />

        <div className="swq-header">
          <h1 className="di-title">Bronwerkvoorraad</h1>
          <p className="swq-subtitle">
            <span>{(data && data.city) || 'Breda'}</span>
            <span aria-hidden="true"> · </span>
            <span>{counts.total} bronnen</span>
            <span aria-hidden="true"> · </span>
            <strong>Niets wordt automatisch gepubliceerd.</strong>
          </p>
        </div>

        {error && (
          <div className="di-banner di-banner-danger" role="alert">
            {error}
          </div>
        )}
        {loading && <p className="swq-muted">Laden…</p>}

        {!loading && data && (
          <>
            <section aria-labelledby="swq-queues-label" className="swq-queues-wrap">
              <p id="swq-queues-label" className="swq-queues-label">
                Actie nodig <span className="swq-count">{counts.total}</span>
              </p>
              <div className="swq-queues" role="group" aria-label="Werkvoorraad filteren op actie">
                {[...QUEUES, 'all'].map((q) => {
                  const label = q === 'all' ? 'Alles' : QUEUE_LABELS[q]
                  const count = q === 'all' ? counts.total : counts[q]
                  return (
                    <button key={q} type="button" className="swq-queue" aria-pressed={queue === q} onClick={() => setQueue(q)}>
                      <span>{label}</span>
                      <span className="swq-count">{count}</span>
                    </button>
                  )
                })}
              </div>
            </section>

            <div className="swq-filters">
              <div className="swq-search">
                <label htmlFor="swq-search" className="swq-sr-only">
                  Zoek restaurant of domein
                </label>
                {ICON_SEARCH}
                <input
                  id="swq-search"
                  type="search"
                  placeholder="Zoek restaurant of domein"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="swq-select">
                <label htmlFor="swq-filter-source" className="swq-sr-only">
                  Bron
                </label>
                <select id="swq-filter-source" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
                  <option value="all">Bron: alle</option>
                  {SOURCE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      Bron: {SOURCE_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="swq-select">
                <label htmlFor="swq-filter-menu" className="swq-sr-only">
                  Menukaart
                </label>
                <select id="swq-filter-menu" value={menuFilter} onChange={(e) => setMenuFilter(e.target.value)}>
                  <option value="all">Menukaart: alle</option>
                  {MENU_STATUSES.map((m) => (
                    <option key={m} value={m}>
                      Menukaart: {MENU_LABELS[m]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="swq-select">
                <label htmlFor="swq-filter-wijk" className="swq-sr-only">
                  Wijk
                </label>
                <select id="swq-filter-wijk" value={wijkFilter} onChange={(e) => setWijkFilter(e.target.value)}>
                  <option value="all">Wijk: alle</option>
                  {wijken.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
              </div>
              <div className="swq-select">
                <label htmlFor="swq-sort" className="swq-sr-only">
                  Sortering
                </label>
                <select id="swq-sort" value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
                  {SORT_MODES.map((m) => (
                    <option key={m} value={m}>
                      {SORT_LABELS[m]}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="swq-legend-toggle"
                aria-expanded={legendOpen}
                aria-controls="swq-legend"
                onClick={() => setLegendOpen((o) => !o)}
              >
                {ICON_INFO}
                <span>Uitleg statussen</span>
              </button>
            </div>

            {legendOpen && (
              <section id="swq-legend" className="swq-legend" aria-label="Uitleg statussen">
                <p className="swq-legend-intro">Bron en menukaart worden afzonderlijk beoordeeld. Is de bron niet bereikbaar, dan is de menukaart altijd ‘Niet beoordeeld’.</p>
                <div className="swq-legend-cols">
                  <div>
                    <p className="swq-legend-heading">Bron</p>
                    <ul>
                      {SOURCE_STATUSES.map((s) => (
                        <li key={s}>
                          <Badge dimension="source" status={s} />
                          <span>{SOURCE_EXPLANATIONS[s]}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="swq-legend-heading">Menukaart</p>
                    <ul>
                      {MENU_STATUSES.map((m) => (
                        <li key={m}>
                          <Badge dimension="menu" status={m} />
                          <span>{MENU_EXPLANATIONS[m]}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <p className="swq-legend-note">
                  ‘Identiteit gewijzigd’ en ‘Geen menukaart aangetroffen’ worden alleen getoond bij expliciet vastgelegd bewijs.
                  Dat bewijs wordt nu nog niet vastgelegd, dus deze statussen komen in deze lijst nog niet voor.
                </p>
              </section>
            )}

            <p className="swq-result-count" aria-live="polite">
              {visible.length} van {counts.total} bronnen{filtersActive ? ' (gefilterd)' : ''}
            </p>

            {rows.length === 0 ? (
              <p className="swq-empty">
                Er staan nog geen gecontroleerde bronnen in de werkvoorraad. Controles ontstaan wanneer een bron wordt
                geanalyseerd via Onboarding Restaurant.
              </p>
            ) : visible.length === 0 ? (
              <p className="swq-empty">Geen bronnen voor deze filters.</p>
            ) : (
              <>
                <div className="swq-table-wrap">
                  <table className="swq-table">
                    <caption className="swq-sr-only">Bronwerkvoorraad, {visible.length} bronnen</caption>
                    <thead>
                      <tr>
                        <th scope="col">Restaurant</th>
                        <th scope="col">Bron</th>
                        <th scope="col">Menukaart</th>
                        <th scope="col">Gecontroleerd</th>
                        <th scope="col">Actie</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((row) => {
                        const key = `t:${row.restaurantId}`
                        const panelId = `swq-panel-t-${row.restaurantId}`
                        const checked = formatChecked(row.checkedAt)
                        const open = openRow === key
                        return (
                          <Fragment key={key}>
                            <tr className={open ? 'swq-row swq-row--open' : 'swq-row'}>
                              <th scope="row" className="swq-cell-name">
                                <span className="swq-name">{row.name}</span>
                                {row.wijk && <span className="swq-muted">{row.wijk}</span>}
                                {row.domain && <span className="swq-domain">{row.domain}</span>}
                              </th>
                              <td>
                                <Badge dimension="source" status={row.source} />
                              </td>
                              <td>
                                <Badge dimension="menu" status={row.menu} />
                              </td>
                              <td>
                                <span className="swq-date">{checked.date}</span>
                                {checked.time && <span className="swq-muted">{checked.time}</span>}
                              </td>
                              <td>
                                <ActionButton
                                  row={row}
                                  open={open}
                                  panelId={panelId}
                                  onToggle={() => toggleRow(key)}
                                  buttonRef={(el) => {
                                    actionRefs.current[key] = el
                                  }}
                                />
                              </td>
                            </tr>
                            {open && (
                              <tr className="swq-panel-row">
                                <td colSpan={5} id={panelId}>
                                  <ActionPanel row={row} onLater={() => closeAndFocus(key)} />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                <ul className="swq-cards" aria-label={`Bronwerkvoorraad, ${visible.length} bronnen`}>
                  {visible.map((row) => {
                    const key = `c:${row.restaurantId}`
                    const panelId = `swq-panel-c-${row.restaurantId}`
                    const checked = formatChecked(row.checkedAt)
                    const open = openRow === key
                    return (
                      <li key={key} className="swq-card">
                        <p className="swq-card-title">
                          <span className="swq-name">{row.name}</span>
                          {row.wijk && <span className="swq-muted"> · {row.wijk}</span>}
                        </p>
                        {row.domain && <p className="swq-domain">{row.domain}</p>}
                        <div className="swq-card-badges">
                          <Badge dimension="source" status={row.source} />
                          <Badge dimension="menu" status={row.menu} />
                        </div>
                        <p className="swq-muted">
                          Gecontroleerd: {checked.date}
                          {checked.time ? `, ${checked.time}` : ''}
                        </p>
                        <ActionButton
                          row={row}
                          open={open}
                          panelId={panelId}
                          onToggle={() => toggleRow(key)}
                          buttonRef={(el) => {
                            actionRefs.current[key] = el
                          }}
                        />
                        {open && (
                          <div id={panelId}>
                            <ActionPanel row={row} onLater={() => closeAndFocus(key)} />
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </>
            )}

            {(notInQueue.length > 0 || data.unattributed_checks > 0 || data.job_limit_reached) && (
              <section className="swq-outside" aria-labelledby="swq-outside-title">
                <h2 id="swq-outside-title" className="swq-outside-title">
                  Nog niet in de werkvoorraad
                </h2>
                {notInQueue.length > 0 && (
                  <details className="swq-outside-details">
                    <summary>
                      {notInQueue.length} {notInQueue.length === 1 ? 'restaurant' : 'restaurants'} zonder bruikbare controle
                    </summary>
                    <ul>
                      {notInQueue.map((r) => (
                        <li key={r.restaurant_id}>
                          <span className="swq-name">{r.name}</span>
                          {r.wijk && <span className="swq-muted"> · {r.wijk}</span>}
                          <span className="swq-muted"> — {NOT_IN_QUEUE_LABELS[r.reason] || 'Onbekende reden'}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {data.unattributed_checks > 0 && (
                  <p className="swq-muted">
                    {data.unattributed_checks} {data.unattributed_checks === 1 ? 'controle kon' : 'controles konden'} niet aan
                    precies één bekend restaurant worden gekoppeld en {data.unattributed_checks === 1 ? 'staat' : 'staan'} niet in
                    deze lijst.
                  </p>
                )}
                {data.job_limit_reached && (
                  <p className="swq-muted">Alleen de meest recente controles zijn meegenomen; oudere controles zijn niet geladen.</p>
                )}
              </section>
            )}

            <p className="swq-footnote">Niets wordt automatisch gepubliceerd. Deze lijst wijzigt geen gegevens.</p>
          </>
        )}
      </main>
    </div>
  )
}
