'use client'

// BE-32 (#75, criterion 3) — "🆕 Nieuw gevonden" on Dekking.
//
// Restaurants OpenStreetMap knows in Breda that we do not have. Dekking never
// adds anything itself: "＋ Toevoegen" opens the existing add form with the
// name, address and website filled in, and "Negeren" is remembered (a BE-24
// proposal on the OSM object's own key, no migration). The data is the same
// cached, server-side OSM answer as "Vind bronnen"; only name, address, website
// and kind are shown, with the attribution.

import { useCallback, useEffect, useState } from 'react'
import { OSM_ATTRIBUTION } from '@/src/lib/osmSource'
import { NEW_FOUND_LOADING, RETRY_LABEL, updatedLabel } from '@/src/lib/discoveryProgress'

const DISCOVERY_API = '/api/internal/v1/source-discovery'
const IGNORE_API = '/api/internal/v1/source-discovery/ignore'

function fetchedLabel(value) {
  return updatedLabel(value)
}

export default function NewFoundSection({ token }) {
  const [state, setState] = useState({ loading: true, items: [], error: null, fetchedAt: null, notice: null })
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    if (!token) return
    setState((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const res = await fetch(DISCOVERY_API, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setState({ loading: false, items: [], error: body.error || 'Nieuw gevonden kon niet worden geladen.', fetchedAt: null, notice: null })
        return
      }
      setState({
        loading: false,
        items: Array.isArray(body.items) ? body.items : [],
        error: body.ok === false ? body.message || 'OpenStreetMap is nu niet bereikbaar.' : null,
        fetchedAt: body.fetchedAt || null,
        notice: null,
      })
    } catch {
      setState({ loading: false, items: [], error: 'Nieuw gevonden kon niet worden geladen.', fetchedAt: null, notice: null })
    }
  }, [token])

  useEffect(() => {
    load()
  }, [load])

  async function ignore(item) {
    if (!token || !item) return
    setBusyId(item.osmId)
    try {
      const res = await fetch(IGNORE_API, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ osm_id: item.osmId }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setState((prev) => ({ ...prev, notice: body.error || 'Negeren kon niet worden onthouden.' }))
        return
      }
      setState((prev) => ({
        ...prev,
        items: prev.items.filter((row) => row.osmId !== item.osmId),
        notice: `${item.name} genegeerd. Dat wordt onthouden; er is niets toegevoegd.`,
      }))
    } catch {
      setState((prev) => ({ ...prev, notice: 'Negeren kon niet worden onthouden.' }))
    } finally {
      setBusyId(null)
    }
  }

  const fetched = fetchedLabel(state.fetchedAt)
  return (
    <section className="cov-new" aria-labelledby="cov-new-title">
      <div className="cov-check-head">
        <h2 id="cov-new-title" className="cov-check-title">
          {/* BE-34 (#81, criterion 4): no "(0)" while the first fetch of the day
              is still running. */}
          {state.loading ? '🆕 Nieuw gevonden' : `🆕 Nieuw gevonden (${state.items.length})`}
        </h2>
        <p className="cov-check-meta" style={{ margin: 0 }}>
          Restaurants in Breda die OpenStreetMap kent en wij nog niet. Dekking voegt nooit zelf iets toe.
        </p>
        <div style={{ flex: 1 }} />
        {!state.loading && fetched ? <span className="cov-check-meta">{fetched}</span> : null}
      </div>

      {state.loading ? (
        <p className="cov-check-meta cov-loading" role="status" aria-live="polite">
          <span className="cov-spinner" aria-hidden="true" />
          {NEW_FOUND_LOADING}
        </p>
      ) : null}
      {state.error ? (
        <div className="di-banner di-banner-neutral" role="status">
          <span>{state.error}</span>
          <button type="button" className="stg-btn-secondary cov-check-action" onClick={load}>
            {RETRY_LABEL}
          </button>
        </div>
      ) : null}
      {state.notice ? (
        <div className="di-banner di-banner-info" role="status">
          {state.notice}
        </div>
      ) : null}

      {!state.loading && !state.error && state.items.length === 0 ? (
        <p className="brn-hint">Geen nieuwe restaurants in OpenStreetMap gevonden.</p>
      ) : null}

      {state.items.length > 0 ? (
        <table className="cov-check-table">
          <thead>
            <tr>
              <th scope="col">Naam</th>
              <th scope="col">Adres · website</th>
              <th scope="col">Soort (volgens OSM)</th>
              <th scope="col">Volgende stap</th>
            </tr>
          </thead>
          <tbody>
            {state.items.map((item) => (
              <tr key={item.osmId}>
                <td>
                  <div className="cov-check-name">{item.name}</div>
                </td>
                <td>
                  <div className="cov-check-meta">{item.address}</div>
                  <div className="cov-check-meta">{item.website || '— geen website in OSM'}</div>
                </td>
                <td>
                  <div className="cov-check-meta">{item.kindLabel}</div>
                </td>
                <td>
                  <div className="cov-new-actions">
                    <a className="di-btn-primary cov-check-action" href={item.addHref}>
                      ＋ Toevoegen
                    </a>
                    <button
                      type="button"
                      className="stg-btn-secondary cov-check-action"
                      disabled={busyId === item.osmId}
                      onClick={() => ignore(item)}
                    >
                      Negeren
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <p className="cov-check-meta">
        &quot;＋ Toevoegen&quot; opent &quot;Restaurant of menu toevoegen&quot; met naam, adres en website al ingevuld.
        &quot;Negeren&quot; onthoudt dat het geen restaurant voor ons is, bijvoorbeeld een snackbar of een gesloten zaak.
        Kaartgegevens: {OSM_ATTRIBUTION}.
      </p>
    </section>
  )
}
