'use client'

// Menukaartcontrole → concept (BE-25) and its shared review parts (BE-17
// Menuconcepten beoordelen v1).
// - MenuControl: the recognised dishes per section with prices, a link to the
//   original menu, and only the uncertain lines as attention points;
// - MenuConcept: for a confirmed source of a known restaurant, the internal
//   menu concept. Safe lines are summarised and collapsed; attention points
//   and blockers are open by default and can be corrected, excluded or
//   explicitly accepted. Saving creates an internal BE-17 menu proposal —
//   nothing is published.
// - LineEditor, RemovedDecisions, SafeLines, ExcludedLines: the parts both
//   MenuConcept and the review page (app/internal/menu-concepts) use.
// Uncertainty (missing price, unclear section, duplicate, disappeared dish)
// is the neutral status role, never an error colour (Kleurtaal v2).
// Logic: src/lib/menuConcept.js (shared with the server, which re-checks).

import { useMemo, useState } from 'react'
import StatusIcon from '@/src/components/StatusIcon'
import { STATUS, buildMenuConcept, displayPrice, removalKey } from '@/src/lib/menuConcept'
import { formatPath } from '@/src/lib/menuHierarchy'

/**
 * The proposed section structure next to its original source route, for
 * internal review (src/lib/menuHierarchy.js). Uncertain sections say so.
 */
export function ConceptStructure({ captured }) {
  const categories = (captured && Array.isArray(captured.categories) && captured.categories) || []
  if (categories.length === 0) return null
  const title = captured && typeof captured.title === 'string' ? captured.title : null
  return (
    <details className="bta-category">
      <summary>
        <span className="bta-category-name">Structuur</span>
        <span className="bta-muted"> · {plural(categories.length, 'rubriek', 'rubrieken')}{title ? ` onder "${title}"` : ''}</span>
      </summary>
      <ul className="bta-structure">
        {categories.map((category, i) => {
          const proposed = formatPath(Array.isArray(category.path) && category.path.length > 0 ? category.path : [category.name])
          const source = Array.isArray(category.sourcePath) ? formatPath(category.sourcePath) : null
          return (
            <li key={i}>
              <span className="bta-dish">{title ? `${title} › ${proposed}` : proposed}</span>
              {category.uncertain && (
                <span className="status-badge status-badge--neutral bta-badge">
                  <StatusIcon name="warning" />
                  <span>Rubriekindeling onzeker</span>
                </span>
              )}
              <span className="bta-source-route">Bronroute: {source || 'niet vastgelegd'}</span>
            </li>
          )
        })}
      </ul>
    </details>
  )
}

export function plural(n, one, many) {
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

      {menu && menu.title && <p className="bta-control-count">Menutitel: {menu.title}</p>}

      {menu &&
        menu.categories.map((category) => (
          <details key={category.label || category.name} className="bta-category">
            <summary>
              <span className="bta-category-name">{category.label || category.name}</span>
              <span className="bta-muted"> · {plural(category.items.length, 'gerecht', 'gerechten')}</span>
              {category.uncertain && (
                <span className="status-badge status-badge--neutral bta-badge bta-inline-badge">
                  <StatusIcon name="warning" />
                  <span>Rubriekindeling onzeker</span>
                </span>
              )}
            </summary>
            {category.sourceRoute && <p className="bta-source-route">Bronroute: {category.sourceRoute}</p>}
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

function DishValue({ value, empty }) {
  if (!value) return <p className="bta-compare-empty">{empty}</p>
  return (
    <p className="bta-compare-value">
      <span className="bta-dish">{value.name}</span>
      <span className="bta-muted">
        {value.category || 'Zonder rubriek'} · {displayPrice(value.price) || 'geen prijs'}
      </span>
    </p>
  )
}

/**
 * One attention point or blocker. With `compare`, the current menu and the
 * original extraction are shown next to the concept value (audit trail).
 */
export function LineEditor({ idPrefix, line, edit, setEdit, categories, readOnly, compare }) {
  const id = `${idPrefix}-${line.id}`
  const canAccept = line.status === 'duplicate' || line.status === 'unclear_category' || line.accepted === true
  const status = STATUS[line.status]
  const resolved = !status.attention
  return (
    <li className={`bta-concept-line${status.blocker ? ' bta-concept-line--blocker' : ''}`}>
      <div className="bta-concept-line-head">
        <span className="bta-dish bta-line-name">{line.name}</span>
        <span className={`status-badge status-badge--${resolved ? 'positive' : 'neutral'} bta-badge`}>
          <StatusIcon name={resolved ? 'check' : 'warning'} />
          <span>{resolved ? 'Opgelost' : `${status.label}${status.blocker ? ' · blokkade' : ''}`}</span>
        </span>
      </div>
      {compare ? (
        <div className="bta-compare" role="group" aria-label={`Vergelijking voor ${line.name}`}>
          <div>
            <p className="bta-compare-label">Huidige menukaart</p>
            <DishValue value={line.live} empty="Staat niet op de huidige kaart" />
          </div>
          <div>
            <p className="bta-compare-label">Oorspronkelijke herkenning</p>
            <DishValue value={compare.origin} empty={line.kept ? 'Behouden van de huidige kaart' : 'Niet vastgelegd voor deze versie'} />
          </div>
          <div>
            <p className="bta-compare-label">Conceptwaarde</p>
            <DishValue value={line} empty="" />
          </div>
        </div>
      ) : (
        <p className="bta-muted">
          {line.category || 'Zonder rubriek'} · {displayPrice(line.price) || 'geen prijs'}
          {line.status === 'price_changed' && line.livePrice ? ` (nu live ${displayPrice(line.livePrice)})` : ''}
        </p>
      )}
      {!readOnly && (
        <div className="bta-concept-edit">
          <label htmlFor={`${id}-name`}>Naam</label>
          <input id={`${id}-name`} className="stg-input" value={edit.name ?? line.original.name} onChange={(e) => setEdit({ name: e.target.value })} />
          <label htmlFor={`${id}-price`}>Prijs</label>
          <input
            id={`${id}-price`}
            className="stg-input"
            inputMode="decimal"
            placeholder="bijv. 14,50"
            value={edit.price ?? (line.original.price ? line.original.price.replace('.', ',') : '')}
            onChange={(e) => setEdit({ price: e.target.value })}
          />
          <label htmlFor={`${id}-category`}>Rubriek</label>
          <input id={`${id}-category`} className="stg-input" list={`${idPrefix}-categories`} value={edit.category ?? line.original.category} onChange={(e) => setEdit({ category: e.target.value })} />
          <datalist id={`${idPrefix}-categories`}>
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <div className="bta-concept-checks">
            <label>
              <input type="checkbox" checked={line.excluded === true} onChange={(e) => setEdit({ exclude: e.target.checked })} /> Uitsluiten
            </label>
            {canAccept && (
              <label>
                <input type="checkbox" checked={line.accepted === true} onChange={(e) => setEdit({ accept: e.target.checked })} /> Klopt zo
              </label>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

/** Dishes on the current menu that the concept no longer has: keep or remove, one by one. */
export function RemovedDecisions({ idPrefix, removed, readOnly, onDecide }) {
  if (removed.length === 0) return null
  return (
    <fieldset className="bta-removed" disabled={readOnly}>
      <legend>
        {plural(removed.length, 'gerecht', 'gerechten')} van de huidige kaart {removed.length === 1 ? 'ontbreekt' : 'ontbreken'} in de bron
      </legend>
      <ul className="bta-removed-list">
        {removed.map((l) => {
          const key = removalKey(l)
          return (
            <li key={l.id}>
              <div className="bta-removed-head">
                <span className="bta-dish">
                  {l.name}
                  {l.menuScope ? <span className="bta-muted"> · {l.menuScope}</span> : null}
                </span>
                <span className="bta-price">{displayPrice(l.price) || 'geen prijs'}</span>
                {!l.decision && (
                  <span className="status-badge status-badge--neutral bta-badge">
                    <StatusIcon name="warning" />
                    <span>Keuze nodig · blokkade</span>
                  </span>
                )}
              </div>
              <div className="bta-removed-choices" role="radiogroup" aria-label={`Keuze voor ${l.name}`}>
                <label>
                  <input type="radio" name={`${idPrefix}-removed-${key}`} checked={l.decision === 'keep'} onChange={() => onDecide(key, 'keep')} /> Behouden
                </label>
                <label>
                  <input type="radio" name={`${idPrefix}-removed-${key}`} checked={l.decision === 'remove'} onChange={() => onDecide(key, 'remove')} /> Verwijderen
                </label>
              </div>
            </li>
          )
        })}
      </ul>
    </fieldset>
  )
}

export function SafeLines({ safe, counts, readOnly, onExclude }) {
  if (safe.length === 0) return null
  return (
    <details className="bta-category">
      <summary>
        <span className="bta-category-name">{plural(safe.length, 'gerecht', 'gerechten')} zonder aandachtspunt</span>
        <span className="bta-muted">
          {' '}
          · {counts.new || 0} nieuw, {counts.unchanged || 0} ongewijzigd
        </span>
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
                <input type="checkbox" checked={false} onChange={() => onExclude(l.id)} /> Uitsluiten
              </label>
            )}
          </li>
        ))}
      </ul>
    </details>
  )
}

export function ExcludedLines({ excluded, readOnly, onRestore }) {
  if (excluded.length === 0) return null
  return (
    <details className="bta-category">
      <summary>
        <span className="bta-category-name">{excluded.length} uitgesloten</span>
      </summary>
      <ul className="bta-dishes">
        {excluded.map((l) => (
          <li key={l.id}>
            <span className="bta-dish">{l.name}</span>
            {!readOnly && (
              <button type="button" className="stg-btn-secondary bta-btn" onClick={() => onRestore(l.id)}>
                Terugzetten
              </button>
            )}
          </li>
        ))}
      </ul>
    </details>
  )
}

/** Editing state shared by MenuConcept and the review page: a delta on top of stored choices. */
export function useConceptEdits() {
  const [edits, setEdits] = useState({ lines: {}, removed: {} })
  // A line stays in the editing list once it was an attention point or has
  // been edited, so it never jumps away while it is being corrected.
  const [touched, setTouched] = useState(() => new Set())
  function setLineEdit(lineId, patch) {
    if (!('exclude' in patch)) setTouched((prev) => (prev.has(lineId) ? prev : new Set(prev).add(lineId)))
    setEdits((prev) => ({ ...prev, lines: { ...prev.lines, [lineId]: { ...(prev.lines[lineId] || {}), ...patch } } }))
  }
  function decideRemoved(key, decision) {
    setEdits((prev) => ({ ...prev, removed: { ...prev.removed, [key]: decision } }))
  }
  function reset() {
    setEdits({ lines: {}, removed: {} })
    setTouched(new Set())
  }
  const dirty = Object.keys(edits.lines).length > 0 || Object.keys(edits.removed).length > 0
  return { edits, touched, setLineEdit, decideRemoved, reset, dirty }
}

/** Splits a concept into the editor list, the safe lines and the excluded lines. */
export function conceptParts(concept, touched) {
  const inEditor = (l) => l.status !== 'excluded' && (STATUS[l.status].attention || touched.has(l.id))
  return {
    editorLines: concept.lines.filter(inEditor),
    safe: concept.lines.filter((l) => (l.status === 'unchanged' || l.status === 'new') && !inEditor(l)),
    excluded: concept.lines.filter((l) => l.status === 'excluded'),
    categories: [...new Set(concept.lines.map((l) => l.category).filter(Boolean))],
  }
}

export function ConceptChips({ safe, concept, excluded }) {
  return (
    <ul className="bta-chips" aria-label="Samenvatting van het concept">
      <li className="bta-chip">{plural(safe.length, 'gerecht', 'gerechten')} in orde</li>
      {concept.attentionLines.length > 0 && <li className="bta-chip">{plural(concept.attentionLines.length, 'aandachtspunt', 'aandachtspunten')}</li>}
      {concept.removed.length > 0 && <li className="bta-chip">{concept.removed.length} niet meer in de bron</li>}
      {excluded.length > 0 && <li className="bta-chip">{excluded.length} uitgesloten</li>}
    </ul>
  )
}

export function BlockerBanner({ concept }) {
  if (concept.blockers.length === 0) return null
  return (
    <div className="di-banner di-banner-neutral" role="status">
      <span className="di-banner-icon">
        <StatusIcon name="warning" />
      </span>
      <span>
        <strong>{plural(concept.blockers.length, 'blokkade', 'blokkades')}</strong> — los ze op voordat het concept kan worden
        opgeslagen.
      </span>
    </div>
  )
}

export function MenuConcept({ item, readOnly, busy, onSave }) {
  const { edits, touched, setLineEdit, decideRemoved } = useConceptEdits()
  const concept = useMemo(() => buildMenuConcept({ menus: item.concept.menus, liveLines: item.concept.liveLines, edits }), [item.concept, edits])
  const { editorLines, safe, excluded, categories } = conceptParts(concept, touched)
  const latest = item.concept.latest

  return (
    <section className="bta-concept" aria-labelledby={`bta-concept-${item.jobId}`}>
      <h3 id={`bta-concept-${item.jobId}`} className="bta-concept-title">
        Menuconcept · intern
      </h3>
      <p className="bta-muted">
        {latest ? `Laatst opgeslagen: versie ${latest.version}. ` : ''}Een concept wacht op interne controle. Er wordt niets
        gepubliceerd.
      </p>

      <ConceptChips safe={safe} concept={concept} excluded={excluded} />
      <BlockerBanner concept={concept} />

      {editorLines.length > 0 && (
        <ul className="bta-concept-lines" aria-label="Aandachtspunten en blokkades">
          {editorLines.map((line) => (
            <LineEditor key={line.id} idPrefix={item.jobId} line={line} edit={edits.lines[line.id] || {}} setEdit={(patch) => setLineEdit(line.id, patch)} categories={categories} readOnly={readOnly} />
          ))}
        </ul>
      )}

      <RemovedDecisions idPrefix={item.jobId} removed={concept.removed} readOnly={readOnly} onDecide={decideRemoved} />
      <SafeLines safe={safe} counts={concept.counts} readOnly={readOnly} onExclude={(lineId) => setLineEdit(lineId, { exclude: true })} />
      {!readOnly && <ExcludedLines excluded={excluded} onRestore={(lineId) => setLineEdit(lineId, { exclude: false })} />}

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
