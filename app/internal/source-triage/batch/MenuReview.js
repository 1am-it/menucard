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
import { STATUS, buildMenuConcept, displayPrice, mergeEdits, removalKey } from '@/src/lib/menuConcept'
import { formatPath, pathKey } from '@/src/lib/menuHierarchy'
import { parsePathText, reviewKey } from '@/src/lib/menuStructureReview'

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

const PRODUCT_KIND_LABELS = {
  dish: 'Gerecht',
  choice: 'Keuze',
  supplement: 'Supplement',
  arrangement: 'Arrangement',
  beverage: 'Drank',
  unknown: 'Soort onbekend',
  section: 'Rubriek',
  choice_group: 'Keuzegroep',
};

const PRODUCT_PRICE_LABELS = {
  multiple_undecomposed: 'Meerdere prijzen',
  on_request: 'Prijs op aanvraag',
  unknown: 'Prijs onbekend',
};

function productPriceText(price) {
  if (!price) return 'Prijs onbekend';
  if (price.status === 'known' || price.status === 'from') {
    const amount = price.display || (price.text ? price.text : null);
    if (amount) return price.isFrom ? `Vanaf ${amount}` : amount;
    return 'Prijs onbekend';
  }
  if (price.text) return price.text;
  return PRODUCT_PRICE_LABELS[price.status] || 'Prijs onbekend';
}

/**
 * Read-only, version-faithful rendering of a validated menu-extraction v2
 * view: variants, nested sections, multiple/glass/bottle prices, supplements,
 * explicit or unknown allergens, and source evidence. Source text is rendered
 * as plain React text, never as HTML or an instruction.
 */
export function ProductReview({ product }) {
  if (!product) return null;
  const coverage = product.coverage || {};
  return (
    <div className="bta-product" aria-label="Menukaart v2, alleen-lezen">
      <div className="di-banner di-banner-neutral" role="status">
        <span className="di-banner-icon">
          <StatusIcon name="warning" />
        </span>
        <span>
          <strong>Alleen-lezen.</strong> {product.blockers.map((blocker) => blocker.label).join(' ')}
        </span>
      </div>
      <ul className="bta-chips" aria-label="Aantallen in deze kaart">
        <li className="bta-chip">{plural(product.counts.items, 'item', 'items')}</li>
        <li className="bta-chip">{plural(product.counts.categories, 'rubriek', 'rubrieken')}</li>
        {product.counts.priceVariants > 0 && <li className="bta-chip">{plural(product.counts.priceVariants, 'prijsvariant', 'prijsvarianten')}</li>}
        {product.counts.supplements > 0 && <li className="bta-chip">{plural(product.counts.supplements, 'supplement', 'supplementen')}</li>}
      </ul>

      {product.notes.length > 0 && (
        <ul className="bta-notes" aria-label="Aandachtspunten in deze kaart">
          {product.notes.map((note) => (
            <li key={`${note.code}-${note.label}`}>
              {note.name ? <strong>{note.name}</strong> : null}
              {note.name ? ' · ' : null}
              {note.label}
            </li>
          ))}
        </ul>
      )}
      {product.menus.map((menu) => (
        <section key={menu.id} className="bta-product-menu" aria-label={menu.title || 'Menukaart'}>
          <h3 className="bta-concept-title">{menu.title || 'Naamloze menukaart'}</h3>
          {(menu.variant.label || menu.variant.sourceLabel) && (
            <p className="bta-muted">
              Variant: {menu.variant.label || 'onbekend'}
              {menu.variant.sourceLabel && menu.variant.sourceLabel !== menu.variant.label ? ` · bronlabel: ${menu.variant.sourceLabel}` : ''}
              {menu.variant.locale ? ` · taal: ${menu.variant.locale}` : ''}
              {menu.variant.location ? ` · vestiging: ${menu.variant.location}` : ''}
            </p>
          )}
          {menu.categories.map((category) => (
            <details key={category.id} className="bta-category">
              <summary>
                <span className="bta-category-name">{category.name || 'Zonder rubriek'}</span>
                <span className="bta-muted"> · {plural(category.items.length, 'item', 'items')}</span>
                {category.kind !== 'section' && (
                  <span className="status-badge status-badge--neutral bta-badge bta-inline-badge">
                    <span>{PRODUCT_KIND_LABELS[category.kind] || category.kind}</span>
                  </span>
                )}
                {category.uncertain && (
                  <span className="status-badge status-badge--neutral bta-badge bta-inline-badge">
                    <StatusIcon name="warning" />
                    <span>Rubriekindeling onzeker</span>
                  </span>
                )}
              </summary>
              {category.path.length > 1 && <p className="bta-source-route">Pad: {formatPath(category.path)}</p>}
              {category.sourcePath.length > 0 && <p className="bta-source-route">Bronroute: {formatPath(category.sourcePath)}</p>}
              {category.choice && (
                <p className="bta-muted">
                  Keuzegroep{category.choice.count !== null ? ` · ${category.choice.count} keuzes` : ''}
                  {category.choice.min !== null || category.choice.max !== null ? ` (min ${category.choice.min ?? '?'}, max ${category.choice.max ?? '?'})` : ''}
                </p>
              )}
              <ul className="bta-dishes">
                {category.items.map((item) => (
                  <li key={item.id} className="bta-product-item">
                    <div>
                      <span className="bta-dish">{item.name || 'Naam ontbreekt'}</span>{' '}
                      <span className="bta-muted">· {PRODUCT_KIND_LABELS[item.kind] || item.kind}</span>
                    </div>
                    {item.description && <p className="bta-muted">{item.description}</p>}
                    <span className={item.price.status === 'known' || item.price.status === 'from' ? 'bta-price' : 'bta-price bta-price--missing'}>
                      {productPriceText(item.price)}
                    </span>
                    {item.priceVariants.length > 0 && (
                      <ul className="bta-notes" aria-label={`Prijsvarianten van ${item.name || 'dit item'}`}>
                        {item.priceVariants.map((variant) => (
                          <li key={variant.id}>
                            {variant.label || PRODUCT_KIND_LABELS[variant.kind] || 'Variant'}: {variant.display || variant.text || 'onbekend'}
                            {variant.isSupplement ? ' · supplement' : ''}
                            {variant.perPerson ? ' · per persoon' : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                    {item.supplementOf && (
                      <p className="bta-muted">
                        {item.supplementOf.status === 'resolved'
                          ? `Supplement bij item ${item.supplementOf.itemId}.`
                          : `Supplement${item.supplementOf.label ? `: ${item.supplementOf.label}` : ''}; doel niet vastgelegd (context ${item.supplementOf.context.menuId || '?'} / ${item.supplementOf.context.categoryId || '?'}). ${item.supplementOf.limitation || ''}`}
                      </p>
                    )}
                    <p className="bta-muted">
                      {item.allergens.status === 'explicit'
                        ? `Allergenen: ${item.allergens.codes.join(', ') || 'geen code vermeld'}`
                        : 'Allergenen onbekend (geen bronvermelding)'}
                      {item.dietaryLabels.length > 0 ? ` · ${item.dietaryLabels.join(', ')}` : ''}
                    </p>
                    {item.evidence && (
                      <details className="bta-evidence">
                        <summary>Bronbewijs</summary>
                        <p className="bta-muted">
                          {item.evidence.sourceId || 'bron onbekend'} · {item.evidence.locator || 'vindplaats onbekend'}
                        </p>
                        {item.evidence.quote && <p className="bta-quote">{item.evidence.quote}</p>}
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </section>
      ))}

      <details className="bta-category">
        <summary>
          <span className="bta-category-name">Dekking</span>
          <span className="bta-muted"> · {coverage.status || 'onbekend'} · {plural(coverage.itemsExtracted || 0, 'item', 'items')}</span>
        </summary>
        <p className="bta-muted">
          {plural(coverage.sourcesRead || 0, 'bron gelezen', 'bronnen gelezen')} · {plural(coverage.pagesRead || 0, 'pagina', "pagina's")}
        </p>
        {coverage.unreadSources.length > 0 && (
          <ul className="bta-notes" aria-label="Niet-gelezen bronnen">
            {coverage.unreadSources.map((source, index) => (
              <li key={`${source.sourceId}-${source.locator}-${index}`}>
                {source.sourceId || 'bron onbekend'} · {source.locator || 'vindplaats onbekend'} · {source.reason || 'reden onbekend'}
              </li>
            ))}
          </ul>
        )}
        {coverage.limitations.length > 0 && (
          <ul className="bta-notes" aria-label="Beperkingen">
            {coverage.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        )}
      </details>

      {product.rejected.length > 0 && (
        <details className="bta-category">
          <summary>
            <span className="bta-category-name">Niet opgenomen regels</span>
            <span className="bta-muted"> · {product.rejected.length}</span>
          </summary>
          <ul className="bta-notes">
            {product.rejected.map((row, index) => (
              <li key={`${row.sourceId}-${row.locator}-${index}`}>
                {row.text || 'Geen tekst'} · {row.reason} · {row.sourceId || 'bron onbekend'} / {row.locator || 'vindplaats onbekend'}
              </li>
            ))}
          </ul>
        </details>
      )}

    </div>
  );
}

function coverageText(coverage) {
  if (!coverage) return null
  if (coverage.status === 'candidate_without_items') {
    return 'Bron gevonden, maar er zijn geen gerechten met een betrouwbare prijs herkend. Dit is geen geslaagde extractie.'
  }
  if (coverage.status === 'no_content_found') return 'Geen bruikbare menukaart gevonden.'
  const sources = plural(coverage.readCount || 0, 'bron gelezen', 'bronnen gelezen')
  return `${plural(coverage.itemCount || 0, 'gerecht', 'gerechten')} uit ${sources}; controle nodig.`
}

export function MenuControl({ item }) {
  const menu = item.menu
  const href = item.foundUrl || item.url
  const coverage = coverageText(item.coverage)
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

      {coverage && <p className="bta-muted">{coverage}</p>}

      {item.productBlocked && !item.product && (
        <div className="di-banner di-banner-neutral" role="status">
          <span className="di-banner-icon">
            <StatusIcon name="warning" />
          </span>
          <span>
            <strong>Alleen-lezen.</strong> Deze analyse bevat een versiegebonden kaart die niet als v1 kan worden gelezen
            {item.productReason ? ` (${item.productReason}).` : '.'} Opslaan, bevestigen en exporteren zijn geblokkeerd.
          </span>
        </div>
      )}

      {item.product && <ProductReview product={item.product} />}

      {item.attentionGroups && item.attentionGroups.length > 0 && (
        <div className="bta-attention" role="group" aria-label="Gedeelde onzekerheid">
          <p className="bta-attention-title">
            <StatusIcon name="warning" /> {plural(item.attentionGroups.length, 'gedeelde onzekerheid', 'gedeelde onzekerheden')}
          </p>
          <ul>
            {item.attentionGroups.map((group) => (
              <li key={group.id}>
                <span className="bta-dish">{group.label}</span>{' '}
                <span className="bta-muted">· {plural(group.itemCount, 'gerecht', 'gerechten')} · rubriekindeling onzeker</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {item.limitations && item.limitations.length > 0 && (
        <ul className="bta-notes" aria-label="Beperkingen van deze extractie">
          {item.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      )}

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
                  <span className={dish.price ? 'bta-price' : 'bta-price bta-price--missing'}>
                    {dish.price || (dish.priceText ? `${dish.priceText} · meerdere prijzen` : 'geen prijs')}
                  </span>
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

/**
 * The explicit human control of an uncertain section structure (#59 review
 * 6307703713, BE-30 #72). Every uncertain section of THIS source version is
 * shown with its dishes and prices, why it is uncertain, its source route and a
 * direct link to that page of the source; a reviewer keeps it or corrects its
 * whole path. "Alles klopt zo" fills exactly the same per-section choices and
 * still asks one explicit confirmation. Only a complete set can be confirmed —
 * the server re-checks the same paths against the stored receipt.
 */
export function StructureReview({ idPrefix, review, value, readOnly, onChange, onAcceptAll, bulkLabel }) {
  const required = (review && Array.isArray(review.required) && review.required) || []
  if (required.length === 0) return null
  const titleId = `${idPrefix}-structure-title`
  const decisions = (review && Array.isArray(review.treated) && review.treated) || []
  const handled = required.filter((section) => {
    const choice = value[section.key]
    if (!choice) return false
    if (choice.action === 'keep') return true
    if (choice.action !== 'correct') return false
    const corrected = parsePathText(choice.text || '')
    return Boolean(corrected && reviewKey(corrected) !== section.key)
  })
  const editable = !readOnly && review.storeAvailable !== false
  return (
    <div className="bta-structure-review" role="group" aria-labelledby={titleId}>
      <p id={titleId} className="bta-attention-title">
        <StatusIcon name="warning" /> Rubriekindeling controleren
      </p>
      <p className="bta-muted">
        {plural(required.length, 'onzekere rubriek', 'onzekere rubrieken')} in deze bronversie. Klap een rubriek open: je
        ziet de gerechten met hun prijs, waarom de indeling onzeker is en de plek in de bron. Handhaaf of corrigeer elke
        rubriek; daarna kun je de bron bevestigen.
      </p>
      <p className="bta-structure-count" role="status">
        {handled.length} van {required.length} behandeld
      </p>
      {review.storeAvailable === false && (
        <div className="di-banner di-banner-neutral" role="status">
          <span className="di-banner-icon">
            <StatusIcon name="warning" />
          </span>
          <span>
            <strong>Controle niet beschikbaar.</strong> De opgeslagen rubriekcontrole kan niet worden gelezen. Er kan nu
            niets worden bevestigd; probeer het later opnieuw.
          </span>
        </div>
      )}
      {editable && (
        <div className="bta-structure-bulk">
          <button type="button" className="stg-btn-secondary bta-btn" onClick={() => onAcceptAll && onAcceptAll()}>
            {bulkLabel || 'Alles klopt zo'}
          </button>
          <p className="bta-muted">
            Zet alle {required.length} rubrieken op “klopt zo”. Je bevestigt daarna zelf de bron; niets wordt automatisch
            vastgelegd.
          </p>
        </div>
      )}
      <ol className="bta-structure-list">
        {required.map((section, index) => {
          const choice = value[section.key] || {}
          const corrected = choice.action === 'correct'
          const correctedPath = corrected ? parsePathText(choice.text || '') : null
          const invalid = corrected && (!correctedPath || reviewKey(correctedPath) === section.key)
          const fieldId = `${idPrefix}-structure-${index}`
          const treated = decisions.find((decision) => decision.key === section.key) || null
          const items = Array.isArray(section.items) ? section.items : []
          const sourceLink = section.sourceLink && typeof section.sourceLink.url === 'string' ? section.sourceLink : null
          return (
            <li key={section.key} className="bta-structure-row">
              <details className="bta-structure-section">
                <summary className="bta-structure-head">
                  <span className="bta-dish">{section.label}</span>
                  <span className="bta-muted">{plural(section.itemCount || items.length, 'gerecht', 'gerechten')}</span>
                  {choice.action === 'keep' && (
                    <span className="status-badge status-badge--positive bta-badge bta-inline-badge">
                      <StatusIcon name="check" />
                      <span>Klopt zo</span>
                    </span>
                  )}
                  {corrected && (
                    <span className="status-badge status-badge--neutral bta-badge bta-inline-badge">
                      <span>Gecorrigeerd</span>
                    </span>
                  )}
                </summary>
                <p className="bta-structure-reason">Twijfel: {section.reason || 'de indeling van dit kopje is niet zeker.'}</p>
                <p className="bta-source-route">
                  {sourceLink ? (
                    <a className="bta-structure-link" href={sourceLink.url} target="_blank" rel="noopener noreferrer">
                      {sourceLink.text}
                    </a>
                  ) : (
                    'Geen directe bronlink bekend'
                  )}
                  {section.locator ? <span className="bta-muted"> · vindplaats: {section.locator}</span> : null}
                </p>
                <p className="bta-source-route">Bronroute: {section.sourceRoute || 'niet vastgelegd'}</p>
                {items.length > 0 ? (
                  <ul className="bta-structure-dishes" aria-label={`Gerechten in ${section.label}`}>
                    {items.map((dish) => (
                      <li key={dish.id}>
                        <span className="bta-dish">{dish.name}</span>
                        <span className={dish.price ? 'bta-price' : 'bta-price bta-price--missing'}>
                          {dish.price || (dish.priceText ? `${dish.priceText} · meerdere prijzen` : 'geen prijs')}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="bta-muted">Geen gerechten met een naam in deze rubriek gelezen.</p>
                )}
                {treated && (
                  <p className="bta-muted">
                    Al behandeld{treated.reviewedAt ? ` op ${reviewedText(treated.reviewedAt)}` : ''}:{' '}
                    {treated.action === 'correct' ? `gecorrigeerd naar ${formatPath(treated.correctedPath)}` : 'gehandhaafd'}.
                  </p>
                )}
              <div className="bta-structure-choices" role="radiogroup" aria-label={`Beslissing voor ${section.label}`}>
                <label>
                  <input
                    type="radio"
                    name={`${fieldId}-decision`}
                    checked={choice.action === 'keep'}
                    disabled={!editable}
                    onChange={() => onChange(section.key, { action: 'keep', text: formatPath(section.path) })}
                  />{' '}
                  Rubriek klopt zo
                </label>
                <label>
                  <input
                    type="radio"
                    name={`${fieldId}-decision`}
                    checked={corrected}
                    disabled={!editable}
                    onChange={() =>
                      onChange(section.key, { action: 'correct', text: choice.action === 'correct' ? choice.text : formatPath(section.path) })
                    }
                  />{' '}
                  Rubriek corrigeren
                </label>
              </div>
              {corrected && (
                <div className="bta-structure-edit">
                  <label htmlFor={`${fieldId}-path`}>Gecorrigeerde rubriek en pad</label>
                  <input
                    id={`${fieldId}-path`}
                    className="stg-input"
                    value={choice.text || ''}
                    disabled={!editable}
                    placeholder="bijv. Diner › Voorgerechten"
                    aria-describedby={`${fieldId}-hint`}
                    aria-invalid={invalid ? 'true' : undefined}
                    onChange={(event) => onChange(section.key, { action: 'correct', text: event.target.value })}
                  />
                  <p id={`${fieldId}-hint`} className="bta-muted">
                    {invalid
                      ? 'Vul een ander pad in dan het onzekere bronpad; gebruik › tussen niveaus.'
                      : 'Gebruik › tussen niveaus, bijvoorbeeld Diner › Voorgerechten.'}
                  </p>
                </div>
              )}
              </details>
            </li>
          )
        })}
      </ol>
      <p className="bta-muted">
        Deze controle geldt alleen voor deze bronversie. Ontbrekende prijzen en andere blokkades los je daarna in het
        concept op. Er wordt niets gepubliceerd.
      </p>
    </div>
  )
}

function reviewedText(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'onbekend moment'
  return date.toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
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
  const canAcceptCategory = line.categoryNeedsAcceptance === true || line.categoryAccepted === true
  const canAcceptDuplicate = line.duplicateNeedsAcceptance === true || line.duplicateAccepted === true
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
          {line.category || 'Zonder rubriek'} · {displayPrice(line.price) || (line.priceText ? `${line.priceText} (meerdere prijzen)` : 'geen prijs')}
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
            {canAcceptCategory && (
              <label>
                <input type="checkbox" checked={line.categoryAccepted === true} onChange={(e) => setEdit({ acceptCategory: e.target.checked })} /> Rubriek klopt zo
              </label>
            )}
            {canAcceptDuplicate && (
              <label>
                <input type="checkbox" checked={line.duplicateAccepted === true} onChange={(e) => setEdit({ acceptDuplicate: e.target.checked })} /> Duplicaat klopt zo
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

/** The human structure decisions that were part of the confirmed source version. */
function StructureTrail({ review }) {
  const treated = (review && Array.isArray(review.treated) && review.treated) || []
  if (treated.length === 0) return null
  return (
    <details className="bta-category">
      <summary>
        <span className="bta-category-name">Rubriekcontrole</span>
        <span className="bta-muted"> · {plural(treated.length, 'rubriek', 'rubrieken')} behandeld</span>
      </summary>
      <ul className="bta-notes">
        {treated.map((decision) => (
          <li key={decision.key}>
            {formatPath(decision.path)} → {decision.action === 'correct' ? formatPath(decision.correctedPath) : 'gehandhaafd'}
            {decision.reviewedAt ? ` · ${reviewedText(decision.reviewedAt)}` : ''}
          </li>
        ))}
      </ul>
      <p className="bta-muted">
        Deze keuzes horen bij de bevestigde bronversie en zitten als edits in dit concept. Er is niets gepubliceerd.
      </p>
    </details>
  )
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

/**
 * A shared uncertainty is one decision about the shown section, not an
 * "accept everything" switch. Price/duplicate/removed blockers stay untouched.
 */
function UncertainGroups({ lines, readOnly, onAcceptGroup }) {
  const groups = []
  const byPath = new Map()
  for (const line of lines) {
    // Only the category blocker is settled here. A duplicate or missing price
    // on the same line keeps its own blocker and needs its own decision.
    if (!line.categoryUncertain || line.categoryEdited || line.status !== 'unclear_category') continue
    const key = pathKey(line.categoryPath || [line.category])
    let group = byPath.get(key)
    if (!group) {
      group = { key, path: line.categoryPath || [line.category], lines: [] }
      byPath.set(key, group)
      groups.push(group)
    }
    group.lines.push(line)
  }
  if (groups.length === 0) return null
  return (
    <div className="bta-attention" role="group" aria-label="Gedeelde rubriekonzekerheid">
      <p className="bta-attention-title">
        <StatusIcon name="warning" /> {plural(groups.length, 'gedeelde rubriekonzekerheid', 'gedeelde rubriekonzekerheden')}
      </p>
      <ul>
        {groups.map((group) => (
          <li key={group.key}>
            <span className="bta-dish">{formatPath(group.path)}</span>{' '}
            <span className="bta-muted">· {plural(group.lines.length, 'gerecht', 'gerechten')}</span>
            {!readOnly && (
              <button type="button" className="stg-btn-secondary bta-btn" onClick={() => onAcceptGroup(group.lines)}>
                Rubriek klopt zo
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="bta-muted">Deze keuze geldt alleen voor de getoonde rubriek en lost geen ontbrekende prijzen of andere blokkades op.</p>
    </div>
  )
}

export function MenuConcept({ item, readOnly, busy, onSave }) {
  const { edits, touched, setLineEdit, decideRemoved } = useConceptEdits()
  const productBlocked = item.concept.productBlocked === true
  // The confirmed source's human structure decisions are the base edits; the
  // reviewer's own line corrections apply on top. The server recomputes the
  // same base on save, so preview and version stay identical.
  const structureEdits = item.concept.structureEdits && typeof item.concept.structureEdits === 'object' ? item.concept.structureEdits : null
  const concept = useMemo(
    () =>
      productBlocked
        ? null
        : buildMenuConcept({
            menus: item.concept.menus,
            liveLines: item.concept.liveLines,
            edits: structureEdits ? mergeEdits({ lines: structureEdits, removed: null }, edits) : edits,
          }),
    [item.concept, edits, productBlocked, structureEdits]
  )
  if (productBlocked) {
    return (
      <section className="bta-concept" aria-labelledby={`bta-concept-${item.jobId}`}>
        <h3 id={`bta-concept-${item.jobId}`} className="bta-concept-title">
          Menuconcept · intern
        </h3>
        <div className="di-banner di-banner-neutral" role="status">
          <span className="di-banner-icon">
            <StatusIcon name="warning" />
          </span>
          <span>
            <strong>Alleen-lezen.</strong> Deze kaart is versiegebonden (v2) en kan in deze ronde niet als v1-concept worden
            opgeslagen, goedgekeurd of geëxporteerd.
          </span>
        </div>
        <p className="bta-muted">
          De volledige, versiegetrouwe kaart staat bij <strong>Menukaart controleren</strong> hierboven
          {item.concept.product ? ` (${item.concept.product.counts.items} items, ${item.concept.product.counts.priceVariants} prijsvarianten).` : '.'}
          {!item.concept.product && item.concept.productReason ? ` Reden: ${item.concept.productReason}.` : ''}
        </p>
      </section>
    )
  }
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
      <StructureTrail review={item.concept.structureReview} />
      <BlockerBanner concept={concept} />
      <UncertainGroups
        lines={concept.lines}
        readOnly={readOnly}
        onAcceptGroup={(lines) => {
          for (const line of lines) setLineEdit(line.id, { acceptCategory: true })
        }}
      />

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
