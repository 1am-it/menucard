'use client'

// BE-20 (fase 1) — "Onboarding Restaurant": the general-purpose extension
// of BE-18/19's own HTML-JSON-LD-only "Onboarding Menu" flow
// (app/internal/onboarding-menu/page.js, never modified by this file).
// One URL in, a reviewable restaurant concept and menu proposals out —
// same-host discovery, digital PDF text extraction, and per-field
// confidence/evidence are all new here; nothing is ever published
// automatically.
//
// Reuses the exact same authenticated-API pattern, visual language, and
// "Restaurantconcept maken"/menu-proposal actions as
// app/internal/onboarding-menu/page.js — POST /api/internal/v1/profile-drafts
// and POST /api/internal/v1/url-intakes + .../menu-proposals are called
// completely unchanged, fed by the receipt this page's own
// POST /api/internal/v1/restaurant-analysis-jobs issues.
//
// No restaurant/dish photography anywhere on this page, per CLAUDE.md's
// own no-photography principle and this ticket's own "Visual contract."

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/src/lib/supabaseBrowser'
import InternalNav from '@/src/components/InternalNav'

const selectStyle = {
  padding: 8,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg-card)',
  color: 'var(--text-primary)',
  fontSize: 13,
}

const FIELD_LABELS_NL = {
  name: 'Naam',
  category: 'Categorie',
  address: 'Adres',
  phone: 'Telefoon',
  website: 'Website',
}

const CONFIDENCE_CHIP_CLASS = {
  hoog: 'di-chip--approved_internal',
  middel: 'di-chip--needs_enrichment',
  laag: 'di-chip--rejected',
}

const MENU_CREATE_STATUS_LABELS = {
  pending: 'Bezig…',
  success: 'Voorstel aangemaakt',
  exists: 'Al voorgesteld',
  error: 'Mislukt',
}

function IconDocument() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
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

export default function OnboardingRestaurantPage() {
  const router = useRouter()
  const [session, setSession] = useState(undefined)
  const [roles, setRoles] = useState(undefined)

  const [sourceUrlInput, setSourceUrlInput] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState(null)
  const [result, setResult] = useState(null)

  const [chosenRestaurantId, setChosenRestaurantId] = useState('')
  const [selectedMenuSlugs, setSelectedMenuSlugs] = useState({})
  const [menuStatusBySlug, setMenuStatusBySlug] = useState({})
  const [menuErrorBySlug, setMenuErrorBySlug] = useState({})
  const [creatingProposals, setCreatingProposals] = useState(false)
  const [urlIntakeId, setUrlIntakeId] = useState(null)

  const [creatingConcept, setCreatingConcept] = useState(false)
  const [conceptError, setConceptError] = useState(null)
  const [conceptDuplicateOf, setConceptDuplicateOf] = useState(null)
  const [conceptResult, setConceptResult] = useState(null)

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

  useEffect(() => {
    if (!session) return
    fetch('/api/internal/v1/me', { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((res) => res.json().then((data) => (res.ok ? data.roles || [] : [])))
      .catch(() => [])
      .then(setRoles)
  }, [session])

  const rolesLoaded = roles !== undefined
  const isInternal = rolesLoaded && roles.some((r) => r.role === 'internal')

  async function runAnalysis() {
    setAnalyzing(true)
    setAnalyzeError(null)
    setResult(null)
    setChosenRestaurantId('')
    setSelectedMenuSlugs({})
    setMenuStatusBySlug({})
    setMenuErrorBySlug({})
    setUrlIntakeId(null)
    setConceptError(null)
    setConceptDuplicateOf(null)
    setConceptResult(null)
    try {
      const res = await fetch('/api/internal/v1/restaurant-analysis-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ url: sourceUrlInput }),
      })
      const data = await res.json()
      if (!res.ok) {
        setAnalyzeError(data.error || 'De analyse is mislukt.')
        return
      }
      setResult(data)
      if (data.restaurant_match && data.restaurant_match.type === 'exact') {
        setChosenRestaurantId(data.restaurant_match.restaurant_id)
      }
      const initialSelection = {}
      for (const menu of data.menus || []) initialSelection[menu.contextSlug] = true
      setSelectedMenuSlugs(initialSelection)
    } catch {
      setAnalyzeError('De analyse is mislukt.')
    } finally {
      setAnalyzing(false)
    }
  }

  async function ensureUrlIntake() {
    if (urlIntakeId) return { id: urlIntakeId, error: null }
    if (!result || !result.receipt) {
      return { id: null, error: 'Geen geldige analyse beschikbaar. Voer de analyse opnieuw uit.' }
    }
    try {
      const res = await fetch('/api/internal/v1/url-intakes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ receipt_id: result.receipt.id, source_url: sourceUrlInput }),
      })
      const data = await res.json()
      if (!res.ok) {
        const message = data.error || 'Analyse kon niet worden vastgelegd. Voer de analyse opnieuw uit.'
        return { id: null, error: message }
      }
      setUrlIntakeId(data.url_intake.id)
      return { id: data.url_intake.id, error: null }
    } catch {
      return { id: null, error: 'Analyse kon niet worden vastgelegd. Voer de analyse opnieuw uit.' }
    }
  }

  async function submitSelectedMenus(menusToSubmit) {
    setCreatingProposals(true)
    for (const menu of menusToSubmit) {
      setMenuStatusBySlug((prev) => ({ ...prev, [menu.contextSlug]: 'pending' }))
      setMenuErrorBySlug((prev) => ({ ...prev, [menu.contextSlug]: null }))
    }

    const { id: intakeId, error: intakeErrMsg } = await ensureUrlIntake()
    if (!intakeId) {
      for (const menu of menusToSubmit) {
        setMenuStatusBySlug((prev) => ({ ...prev, [menu.contextSlug]: 'error' }))
        setMenuErrorBySlug((prev) => ({ ...prev, [menu.contextSlug]: intakeErrMsg }))
      }
      setCreatingProposals(false)
      return
    }

    try {
      const res = await fetch(`/api/internal/v1/url-intakes/${intakeId}/menu-proposals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ menu_context_slugs: menusToSubmit.map((m) => m.contextSlug) }),
      })
      const data = await res.json()
      if (!res.ok) {
        for (const menu of menusToSubmit) {
          setMenuStatusBySlug((prev) => ({ ...prev, [menu.contextSlug]: 'error' }))
          setMenuErrorBySlug((prev) => ({ ...prev, [menu.contextSlug]: data.error || 'Aanmaken mislukt.' }))
        }
        setCreatingProposals(false)
        return
      }
      for (const item of data.results || []) {
        const alreadyExists = typeof item.error === 'string' && /already exists/i.test(item.error)
        if (item.ok) {
          setMenuStatusBySlug((prev) => ({ ...prev, [item.context_slug]: 'success' }))
        } else if (alreadyExists) {
          setMenuStatusBySlug((prev) => ({ ...prev, [item.context_slug]: 'exists' }))
        } else {
          setMenuStatusBySlug((prev) => ({ ...prev, [item.context_slug]: 'error' }))
          setMenuErrorBySlug((prev) => ({ ...prev, [item.context_slug]: item.error || 'Aanmaken mislukt.' }))
        }
      }
    } catch {
      for (const menu of menusToSubmit) {
        setMenuStatusBySlug((prev) => ({ ...prev, [menu.contextSlug]: 'error' }))
        setMenuErrorBySlug((prev) => ({ ...prev, [menu.contextSlug]: 'Aanmaken mislukt.' }))
      }
    }
    setCreatingProposals(false)
  }

  async function createConceptFromReceipt(confirmDuplicateOfDraftId) {
    if (!result || !result.receipt) return
    setCreatingConcept(true)
    setConceptError(null)
    try {
      const res = await fetch('/api/internal/v1/profile-drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          receipt_id: result.receipt.id,
          source_url: sourceUrlInput,
          confirm_possible_duplicate_of_draft_id: confirmDuplicateOfDraftId || undefined,
        }),
      })
      const data = await res.json()
      if (res.status === 409 && data.possible_duplicate) {
        setConceptDuplicateOf(data.possible_duplicate_of_draft_id)
        return
      }
      if (!res.ok) {
        setConceptError(data.error || 'Restaurantconcept aanmaken is mislukt.')
        return
      }
      setConceptDuplicateOf(null)
      setConceptResult(data.draft)
    } catch {
      setConceptError('Restaurantconcept aanmaken is mislukt.')
    } finally {
      setCreatingConcept(false)
    }
  }

  if (session === undefined) {
    return (
      <div className="di-page">
        <main className="di-main" style={{ color: 'var(--text-muted)' }}>Loading…</main>
      </div>
    )
  }

  const foundMenus = (result && result.menus) || []
  const unknownMenuContexts = (result && result.unknown_menu_contexts) || []
  const fieldEvidence = (result && result.field_evidence) || {}
  const notes = (result && result.notes) || []
  const needsRestaurantChoice = result && result.restaurant_match && result.restaurant_match.type !== 'exact'
  const selectedMenus = foundMenus.filter((m) => selectedMenuSlugs[m.contextSlug])
  const createReady = Boolean(chosenRestaurantId) && selectedMenus.length > 0 && !creatingProposals

  return (
    <div className="di-page">
      <main className="di-main">
        <InternalNav accessToken={session.access_token} roles={roles} />

        <div className="di-topbar">
          <h1 className="di-title">Onboarding Restaurant</h1>
        </div>

        {rolesLoaded && !isInternal && (
          <div className="di-banner di-banner-warning">
            <span className="di-banner-icon"><IconDocument /></span>
            <span>Your account does not have the "internal" role — this workflow cannot be used.</span>
          </div>
        )}

        {isInternal && (
          <div className="di-candidate-card" style={{ marginBottom: 16 }}>
            <div className="di-row-name">Bron-URL</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
              Nog niets wordt gepubliceerd. De analyse leest alleen deze pagina en een klein, vast aantal
              vergelijkbare pagina's op dezelfde website (bijvoorbeeld een menukaart-link) en toont het resultaat
              hier ter beoordeling.
            </div>
            <div style={{ display: 'grid', gap: 8, maxWidth: 480 }}>
              <label htmlFor="onboarding-restaurant-source-url" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Restaurant-URL
              </label>
              <input
                id="onboarding-restaurant-source-url"
                placeholder="https://restaurant.nl"
                value={sourceUrlInput}
                onChange={(e) => setSourceUrlInput(e.target.value)}
                style={selectStyle}
              />
              {analyzeError && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{analyzeError}</div>}
              <button
                type="button"
                className="di-btn-primary"
                disabled={sourceUrlInput.trim().length === 0 || analyzing}
                onClick={runAnalysis}
                style={{ justifySelf: 'start' }}
              >
                {analyzing ? 'Bezig met analyseren…' : 'Analyse starten'}
              </button>
            </div>

            {result && (
              <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
                <div className="di-banner di-banner-neutral">
                  <span className="di-banner-icon"><IconDocument /></span>
                  <span>
                    Analyse voltooid — {foundMenus.length} menu{foundMenus.length === 1 ? '' : "'s"} gevonden,
                    veilig verwerkt (alleen deze en een klein aantal gerelateerde pagina's, met broncontrole
                    per pagina).
                  </span>
                </div>

                {notes.length > 0 && (
                  <div className="di-banner di-banner-warning">
                    <span className="di-banner-icon"><IconDocument /></span>
                    <div>
                      {notes.map((note, idx) => (
                        <div key={idx}>{note}</div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Restaurantconcept ── */}
                <div className="di-candidate-card">
                  <div className="di-row-name">Restaurantconcept</div>
                  {Object.keys(fieldEvidence).length === 0 && (
                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      Geen restaurantgegevens met voldoende bewijs gevonden op deze bron.
                    </div>
                  )}
                  <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                    {Object.entries(fieldEvidence).map(([fieldName, evidence]) => (
                      <div key={fieldName} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                        <div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{FIELD_LABELS_NL[fieldName] || fieldName}</div>
                          <div style={{ fontSize: 14 }}>{evidence.value}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            Bron: {evidence.extractionMethod} — {evidence.sourceUrl}
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                          <span className={`di-chip ${CONFIDENCE_CHIP_CLASS[evidence.confidence] || 'di-chip--muted'}`}>
                            {evidence.confidence}
                          </span>
                          {!evidence.reviewReady && (
                            <span className="di-chip di-chip--muted">Handmatige beoordeling nodig</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {result.description && (
                    <div style={{ marginTop: 10, fontSize: 13, fontStyle: 'italic', color: 'var(--text-muted)' }}>
                      Korte omschrijving: "{result.description}"
                    </div>
                  )}

                  {needsRestaurantChoice ? (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
                        Bestaat dit restaurant nog niet in het systeem? Maak een restaurantconcept aan op basis van deze bron.
                        Menuvoorstellen zijn pas mogelijk zodra dit restaurant later is bevestigd als bestaand restaurant.
                      </div>
                      {conceptError && <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 8 }}>{conceptError}</div>}
                      {conceptDuplicateOf && (
                        <div className="di-banner di-banner-warning" style={{ marginBottom: 8 }}>
                          <span className="di-banner-icon"><IconDocument /></span>
                          <span>
                            Dit lijkt op een al bestaand restaurantconcept. Weet je zeker dat je toch een nieuw concept wilt aanmaken?
                            {' '}
                            <button type="button" className="di-link-btn" onClick={() => createConceptFromReceipt(conceptDuplicateOf)}>
                              Toch aanmaken
                            </button>
                          </span>
                        </div>
                      )}
                      {conceptResult ? (
                        <div className="di-banner di-banner-neutral">
                          <span className="di-banner-icon"><IconDocument /></span>
                          <span>Restaurantconcept aangemaakt. Menuvoorstellen zijn pas mogelijk na latere bevestiging als bestaand restaurant.</span>
                        </div>
                      ) : (
                        <button type="button" className="di-btn-primary" disabled={creatingConcept} onClick={() => createConceptFromReceipt()}>
                          {creatingConcept ? 'Bezig…' : 'Restaurantconcept maken'}
                        </button>
                      )}
                    </div>
                  ) : (
                    <div style={{ marginTop: 12, fontSize: 13 }}>
                      Gekoppeld aan: <strong>{result.restaurant_match.restaurant_name}</strong>
                    </div>
                  )}
                </div>

                {/* ── Menu proposals (only for a confirmed restaurant identity) ── */}
                {!needsRestaurantChoice && foundMenus.map((menu) => {
                  const status = menuStatusBySlug[menu.contextSlug]
                  return (
                    <div key={menu.contextSlug} className="di-candidate-card">
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                        <input
                          type="checkbox"
                          checked={Boolean(selectedMenuSlugs[menu.contextSlug])}
                          disabled={creatingProposals}
                          onChange={(e) => setSelectedMenuSlugs((prev) => ({ ...prev, [menu.contextSlug]: e.target.checked }))}
                          style={{ marginTop: 4 }}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                            <div className="di-row-name" style={{ marginBottom: 0 }}>{menu.name || 'Menu zonder naam'}</div>
                            {status && (
                              <span className={`di-chip ${status === 'success' ? 'di-chip--approved_internal' : status === 'error' ? 'di-chip--rejected' : 'di-chip--new'}`}>
                                {MENU_CREATE_STATUS_LABELS[status]}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            Bron: {menu.extractionMethod} — {menu.sourceUrl}
                          </div>
                          {menuErrorBySlug[menu.contextSlug] && (
                            <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>{menuErrorBySlug[menu.contextSlug]}</div>
                          )}
                          <div className="di-accordion" style={{ marginTop: 8 }}>
                            <details className="di-accordion-item">
                              <summary className="di-accordion-trigger">
                                <span className="di-accordion-icon"><IconDocument /></span>
                                <span className="di-accordion-heading">
                                  <span className="di-accordion-title">Preview</span>
                                  <span className="di-accordion-subtitle">{menu.categories.length} categorie{menu.categories.length === 1 ? '' : "ën"}</span>
                                </span>
                                <span className="di-accordion-chevron"><IconChevronDown /></span>
                              </summary>
                              <div className="di-accordion-body">
                                {menu.categories.map((category) => (
                                  <div key={category.name} style={{ marginBottom: 10 }}>
                                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{category.name}</div>
                                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                                      {category.items.map((item, idx) => (
                                        <li key={`${item.name}-${idx}`}>
                                          {item.name}
                                          {item.price ? ` — ${item.price}` : ''}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                ))}
                              </div>
                            </details>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}

                {!needsRestaurantChoice && foundMenus.length > 0 && (
                  <div>
                    <button type="button" className="di-btn-primary" disabled={!createReady} onClick={() => submitSelectedMenus(selectedMenus)}>
                      {creatingProposals
                        ? 'Bezig…'
                        : `Maak ${selectedMenus.length} menuvoorstel${selectedMenus.length === 1 ? '' : 'len'} voor review`}
                    </button>
                  </div>
                )}

                {/* ── Unknown menu contexts — never silently dropped ── */}
                {unknownMenuContexts.length > 0 && (
                  <div className="di-candidate-card">
                    <div className="di-row-name">
                      {unknownMenuContexts.length} onbekende sectie{unknownMenuContexts.length === 1 ? '' : 's'}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
                      Deze bron(nen) zijn gevonden maar konden niet automatisch als een herkend menu worden ingedeeld —
                      handmatige beoordeling nodig.
                    </div>
                    {unknownMenuContexts.map((unknown, idx) => (
                      <div key={idx} style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                        {unknown.sourceUrl} ({unknown.extractionMethod}, {unknown.pageCount} pagina{unknown.pageCount === 1 ? '' : "'s"})
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
