'use client'

// Menukaartcontrole → concept v1 (BE-25). Two presentational parts of a
// Batchanalyse result card:
// - MenuControl: the recognised dishes per section with prices, a link to the
//   original menu, and only the uncertain lines as attention points;
// - MenuConcept: for a confirmed source of a known restaurant, the internal
//   menu concept. Safe lines are summarised and collapsed; attention points
//   and blockers are open by default and can be corrected, excluded or
//   explicitly accepted. Saving creates an internal BE-17 menu proposal —
//   nothing is published.
// Logic: src/lib/menuConcept.js (shared with the server, which re-checks).

import { useMemo, useState } from 'react'
import StatusIcon from '@/src/components/StatusIcon'
import { STATUS, buildMenuConcept, displayPrice } from '@/src/lib/menuConcept'

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`
}

export function MenuControl({ item }) {
  const menu = item.menu
  const href = item.foundUrl || item.url
  return (
    <section className="bta-control" aria-label="Menukaartcontrole">
      <div className="bta-control-head">
        <p className="bta-control-count">
          {menu ? `${plural(menu.itemCount, 'gerecht', 'gerechten')} in ${plural(menu.categoryCount, 'rubriek', 'rubrieken')}` : 'Geen herkende gerechten'}
        </p>
        {href && (
          <a className="stg-btn-secondary bta-btn" href={href} target="_blank" rel="noopener noreferrer">
            Open originele menukaart
            <span className="bta-sr-only"> (opent in een nieuw tabblad)</span>
          </a>
        )}
      </div>

      {menu && menu.attention.length > 0 && (
        <div className="bta-attention" role="group" aria-label="Aandachtspunten">
          <p className="bta-attention-title">
            <StatusIcon name="warning" /> {plural(menu.attention.length, 'aandachtspunt', 'aandachtspunten')}
          </p>
          <ul>
            {menu.attention.map((a) => (
              <li key={a.id}>
                <span className="bta-dish">{a.name}</span> <span className="bta-muted">· {a.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {menu &&
        menu.categories.map((category) => (
          <details key={category.name} className="bta-category">
            <summary>
              <span className="bta-category-name">{category.name}</span>
              <span className="bta-muted"> · {plural(category.items.length, 'gerecht', 'gerechten')}</span>
            </summary>
            <ul className="bta-dishes">
              {category.items.map((dish) => (
                <li key={dish.id}>
                  <span className="bta-dish">{dish.name}</span>
                  <span className={dish.price ? 'bta-price' : 'bta-price bta-price--missing'}>{dish.price || 'geen prijs'}</span>
                </li>
              ))}
            </ul>
          </details>
        ))}

      {item.notes.length > 0 && (
        <ul className="bta-notes" aria-label="Analysedetails">
          {item.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </section>
  )
}

function LineEditor({ jobId, line, edit, setEdit, categories, readOnly }) {
  const id = `${jobId}-${line.id}`
  const canAccept = line.status === 'duplicate' || line.status === 'unclear_category' || edit.accept === true
  const status = STATUS[line.status]
  const resolved = !status.attention
  const role = status.blocker ? 'blocked' : resolved ? 'positive' : 'old'
  return (
    <li className={`bta-concept-line${status.blocker ? ' bta-concept-line--blocker' : ''}`}>
      <div className="bta-concept-line-head">
        <span className="bta-dish">{line.name}</span>
        <span className={`status-badge status-badge--${role} bta-badge`}>
          <StatusIcon name={resolved ? 'check' : 'warning'} />
          <span>{resolved ? 'Opgelost' : status.label}</span>
        </span>
      </div>
      <p className="bta-muted">
        {line.category || 'Zonder rubriek'} · {displayPrice(line.price) || 'geen prijs'}
        {line.status === 'price_changed' && line.livePrice ? ` (nu live ${displayPrice(line.livePrice)})` : ''}
      </p>
      {!readOnly && (
        <div className="bta-concept-edit">
          <label htmlFor={`${id}-name`}>Naam</label>
          <input id={`${id}-name`} className="stg-input" value={edit.name ?? line.name} onChange={(e) => setEdit({ name: e.target.value })} />
          <label htmlFor={`${id}-price`}>Prijs</label>
          <input id={`${id}-price`} className="stg-input" inputMode="decimal" placeholder="bijv. 14,50" value={edit.price ?? (line.price ? line.price.replace('.', ',') : '')} onChange={(e) => setEdit({ price: e.target.value })} />
          <label htmlFor={`${id}-category`}>Rubriek</label>
          <input id={`${id}-category`} className="stg-input" list={`${jobId}-categories`} value={edit.category ?? line.category} onChange={(e) => setEdit({ category: e.target.value })} />
          <datalist id={`${jobId}-categories`}>
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <div className="bta-concept-checks">
            <label>
              <input type="checkbox" checked={edit.exclude === true} onChange={(e) => setEdit({ exclude: e.target.checked || undefined })} /> Uitsluiten
            </label>
            {canAccept && (
              <label>
                <input type="checkbox" checked={edit.accept === true} onChange={(e) => setEdit({ accept: e.target.checked || undefined })} /> Klopt zo
              </label>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

export function MenuConcept({ item, readOnly, busy, onSave }) {
  const [edits, setEdits] = useState({ lines: {}, removed: null })
  const concept = useMemo(() => buildMenuConcept({ menus: item.concept.menus, liveLines: item.concept.liveLines, edits }), [item.concept, edits])
  const categories = useMemo(() => [...new Set(concept.lines.map((l) => l.category).filter(Boolean))], [concept])
  // A line stays in the editing list once it was an attention point or has
  // been edited, so it never jumps away while it is being corrected.
  const [touched, setTouched] = useState(() => new Set())
  const inEditor = (l) => l.status !== 'excluded' && (STATUS[l.status].attention || touched.has(l.id))
  const editorLines = concept.lines.filter(inEditor)
  const safe = concept.lines.filter((l) => (l.status === 'unchanged' || l.status === 'new') && !inEditor(l))
  const excluded = concept.lines.filter((l) => l.status === 'excluded')
  const latest = item.concept.latest

  function setLineEdit(lineId, patch) {
    if (!('exclude' in patch)) setTouched((prev) => (prev.has(lineId) ? prev : new Set(prev).add(lineId)))
    setEdits((prev) => {
      const next = { ...(prev.lines[lineId] || {}), ...patch }
      for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key]
      return { ...prev, lines: { ...prev.lines, [lineId]: next } }
    })
  }

  return (
    <section className="bta-concept" aria-labelledby={`bta-concept-${item.jobId}`}>
      <h3 id={`bta-concept-${item.jobId}`} className="bta-concept-title">
        Menuconcept · intern
      </h3>
      <p className="bta-muted">
        {latest ? `Laatst opgeslagen: versie ${latest.version}. ` : ''}Een concept wacht op interne controle. Er wordt niets
        gepubliceerd.
      </p>

      <ul className="bta-chips" aria-label="Samenvatting van het concept">
        <li className="bta-chip">{plural(safe.length, 'gerecht', 'gerechten')} in orde</li>
        {concept.attentionLines.length > 0 && <li className="bta-chip">{plural(concept.attentionLines.length, 'aandachtspunt', 'aandachtspunten')}</li>}
        {concept.removed.length > 0 && <li className="bta-chip">{concept.removed.length} niet meer in de bron</li>}
        {excluded.length > 0 && <li className="bta-chip">{excluded.length} uitgesloten</li>}
      </ul>

      {concept.blockers.length > 0 && (
        <div className="di-banner di-banner-danger" role="status">
          <span>
            <strong>{plural(concept.blockers.length, 'blokkade', 'blokkades')}</strong> — los ze op voordat het concept kan
            worden opgeslagen.
          </span>
        </div>
      )}

      {editorLines.length > 0 && (
        <ul className="bta-concept-lines" aria-label="Aandachtspunten en blokkades">
          {editorLines.map((line) => (
            <LineEditor key={line.id} jobId={item.jobId} line={line} edit={edits.lines[line.id] || {}} setEdit={(patch) => setLineEdit(line.id, patch)} categories={categories} readOnly={readOnly} />
          ))}
        </ul>
      )}

      {concept.removed.length > 0 && (
        <fieldset className="bta-removed" disabled={readOnly}>
          <legend>
            {plural(concept.removed.length, 'gerecht', 'gerechten')} van de huidige kaart {concept.removed.length === 1 ? 'ontbreekt' : 'ontbreken'} in de bron
          </legend>
          <ul className="bta-dishes">
            {concept.removed.map((l) => (
              <li key={l.id}>
                <span className="bta-dish">{l.name}</span>
                <span className="bta-price">{displayPrice(l.price) || 'geen prijs'}</span>
              </li>
            ))}
          </ul>
          <label>
            <input type="radio" name={`${item.jobId}-removed`} checked={edits.removed === 'keep'} onChange={() => setEdits((p) => ({ ...p, removed: 'keep' }))} /> Behouden in het concept
          </label>
          <label>
            <input type="radio" name={`${item.jobId}-removed`} checked={edits.removed === 'remove'} onChange={() => setEdits((p) => ({ ...p, removed: 'remove' }))} /> Verwijderen uit het concept
          </label>
        </fieldset>
      )}

      {safe.length > 0 && (
        <details className="bta-category">
          <summary>
            <span className="bta-category-name">{plural(safe.length, 'gerecht', 'gerechten')} zonder aandachtspunt</span>
            <span className="bta-muted"> · {concept.counts.new || 0} nieuw, {concept.counts.unchanged || 0} ongewijzigd</span>
          </summary>
          <ul className="bta-dishes">
            {safe.map((l) => (
              <li key={l.id}>
                <span className="bta-dish">
                  {l.name} <span className="bta-muted">· {l.category}</span>
                </span>
                <span className="bta-price">{displayPrice(l.price)}</span>
                {!readOnly && (
                  <label className="bta-inline-check">
                    <input type="checkbox" checked={false} onChange={() => setLineEdit(l.id, { exclude: true })} /> Uitsluiten
                  </label>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {excluded.length > 0 && !readOnly && (
        <details className="bta-category">
          <summary>
            <span className="bta-category-name">{excluded.length} uitgesloten</span>
          </summary>
          <ul className="bta-dishes">
            {excluded.map((l) => (
              <li key={l.id}>
                <span className="bta-dish">{l.name}</span>
                <button type="button" className="stg-btn-secondary bta-btn" onClick={() => setLineEdit(l.id, { exclude: undefined })}>
                  Terugzetten
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {!readOnly && (
        <div className="bta-actions">
          <button
            type="button"
            className="di-btn-primary bta-btn"
            aria-disabled={!concept.canSave || busy ? 'true' : undefined}
            aria-describedby={`bta-concept-save-${item.jobId}`}
            onClick={() => {
              if (concept.canSave && !busy) onSave(item.jobId, edits)
            }}
          >
            Concept opslaan
          </button>
          <p id={`bta-concept-save-${item.jobId}`} className="bta-muted">
            {concept.canSave ? 'Slaat een interne conceptversie op voor controle. Niets wordt gepubliceerd.' : 'Kan pas zonder blokkades.'}
          </p>
        </div>
      )}
    </section>
  )
}
