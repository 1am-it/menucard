'use client'

// #59 / BE-21 variant 5 (Lead order 6382953597): de originele kaart met
// markeringen. Puur presentatie: de pagina haalt de kaartpagina lui op en doet
// de duurzame acties; dit component toont alleen wat de server al besliste.
//
// Kleur is nooit de enige drager: elke markering heeft een eigen vorm, een rand-
// of stippelstijl en een aria-label met dezelfde woorden als de legenda.
//
// AA2 (Lead review 6383853638): de legenda is één regel met vier kleine chips;
// de lange uitleg per kleur zit achter "Uitleg" (een native details, dus met
// het toetsenbord te openen). De chips houden de volledige woorden, zodat de
// schermlezertekst gelijk blijft aan de mockup.

const GLYPH = {
  covered: '✓',
  uncovered: '○',
  price_mismatch: '▲',
  not_dish: '–',
}

export default function MenuSourceMap({
  map,
  card,
  cardError,
  loading,
  sourceId,
  page,
  openMarkId,
  focusMarkId,
  busy,
  onSelectSource,
  onPage,
  onOpenMark,
  onAdd,
  onNotDish,
  onTakePrice,
  onCorrect,
  onShowRow = null,
}) {
  if (!map || map.available !== true) return null
  const marksById = new Map((card && Array.isArray(card.marks) ? card.marks : []).map((mark) => [mark.id, mark]))
  const total = card && card.page ? card.page.total : 1
  const number = card && card.page ? card.page.number : page

  return (
    <section className="mai-map" aria-labelledby="mai-map-title">
      <div className="mai-map-head">
        <h3 id="mai-map-title" className="mai-map-title">
          De kaart met markeringen
        </h3>
        <p className="mai-why">
          {map.total} {map.total === 1 ? 'regel met een prijs' : 'regels met een prijs'} op deze kaart. Tik op een
          markering voor wat je kunt doen; er is geen &quot;alles overnemen&quot;.
        </p>
      </div>

      <div className="mai-map-legend" role="group" aria-label="Legenda">
        <ul className="mai-map-chips">
          {map.legend.map((entry) => (
            <li key={entry.tone} className={`mai-map-chip mai-map-chip--${entry.tone}`}>
              <span className={`mai-map-swatch mai-map-swatch--${entry.tone}`} aria-hidden="true">
                {GLYPH[entry.tone]}
              </span>
              <span className="mai-map-chip-label">{entry.label}</span>
            </li>
          ))}
        </ul>
        <details className="mai-map-legend-more">
          <summary className="mai-map-legend-summary">Uitleg</summary>
          <ul className="mai-map-legend-list">
            {map.legend.map((entry) => (
              <li key={entry.tone} className={`mai-map-legend-item mai-map-legend-item--${entry.tone}`}>
                <span className={`mai-map-swatch mai-map-swatch--${entry.tone}`} aria-hidden="true">
                  {GLYPH[entry.tone]}
                </span>
                <span className="mai-map-legend-label">{entry.label}</span>
                <span className="mai-map-legend-detail">{entry.detail}</span>
              </li>
            ))}
          </ul>
        </details>
      </div>

      <div className="mai-map-sources" role="group" aria-label="Bronnen in deze kaart">
        {map.sources.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`stg-btn-secondary mai-btn mai-map-source${entry.id === sourceId ? ' mai-map-source--active' : ''}`}
            aria-pressed={entry.id === sourceId}
            onClick={() => onSelectSource(entry.id)}
          >
            {entry.view.mode === 'images' || entry.view.mode === 'pdf_scan'
              ? `${entry.id} · ${entry.view.label}`
              : `${entry.id} · ${entry.view.label} · ${entry.counts.uncovered} niet overgenomen`}
          </button>
        ))}
      </div>

      {cardError ? (
        <p className="mai-uncovered-unavailable" role="status">
          {cardError}
        </p>
      ) : null}

      {!card ? (
        <p className="bta-muted">{loading ? 'Kaartpagina laden…' : 'Kies een bron om de kaart te zien.'}</p>
      ) : (
        <div className="mai-map-card">
          <p className={`mai-map-notice mai-map-notice--${card.source.view.mode}`} role="status">
            {card.source.view.notice}
          </p>
          <div className="mai-map-card-head">
            <span className="mai-map-card-source">
              {card.source.id} · {card.source.view.label}
            </span>
            <span className="mai-map-counts">
              {card.source.view.mode === 'images' || card.source.view.mode === 'pdf_scan' ? (
                <>
                  {Array.isArray(card.dishes) ? card.dishes.length : 0}{' '}
                  {(Array.isArray(card.dishes) ? card.dishes.length : 0) === 1 ? 'gerecht' : 'gerechten'} gelezen · Controle nodig
                </>
              ) : (
                <>
                  {card.counts.covered} overgenomen · {card.counts.uncovered} niet overgenomen · {card.counts.priceMismatch}{' '}
                  prijs wijkt af
                </>
              )}
            </span>
          </div>
          {total > 1 ? (
            <div className="mai-map-pages">
              <button
                type="button"
                className="stg-btn-secondary mai-btn"
                disabled={busy || number <= 1}
                onClick={() => onPage(number - 1)}
                aria-label={`Vorige ${card.source.view.mode === 'images' ? 'afbeelding' : 'pagina'}, ${Math.max(1, number - 1)} van ${total}`}
              >
                Vorige
              </button>
              <span className="mai-why">
                {card.source.view.mode === 'images' ? 'Afbeelding' : 'Pagina'} {number} van {total}
              </span>
              <button
                type="button"
                className="stg-btn-secondary mai-btn"
                disabled={busy || number >= total}
                onClick={() => onPage(number + 1)}
                aria-label={`Volgende ${card.source.view.mode === 'images' ? 'afbeelding' : 'pagina'}, ${Math.min(total, number + 1)} van ${total}`}
              >
                Volgende
              </button>
            </div>
          ) : null}
          {card.source.view.mode === 'images' || card.source.view.mode === 'pdf_scan' ? (
            <ImageCard card={card} busy={busy} onShowRow={onShowRow} />
          ) : (
            <CardLines
              card={card}
              marksById={marksById}
              openMarkId={openMarkId}
              focusMarkId={focusMarkId}
              busy={busy}
              onOpenMark={onOpenMark}
              onAdd={onAdd}
              onNotDish={onNotDish}
              onTakePrice={onTakePrice}
              onCorrect={onCorrect}
            />
          )}
          {card.omittedLabel ? <p className="mai-why">{card.omittedLabel}</p> : null}
        </div>
      )}
      {map.omitted > 0 ? <p className="mai-why">{map.omittedLabel}</p> : null}
    </section>
  )
}

/**
 * BE-33 (#79, criterion 3): the original image (or the page number of a scan)
 * beside the dishes the AI read from it. Read-only on purpose: every judgement
 * stays in the list, where the same row has its own buttons. Nothing here
 * approves anything.
 */
function ImageCard({ card, busy, onShowRow }) {
  const image = Array.isArray(card.images) && card.images[0] ? card.images[0] : null
  const dishes = Array.isArray(card.dishes) ? card.dishes : []
  const isImage = card.source.kind === 'image' || card.source.view.mode === 'images'
  const kindLabel = isImage ? 'afbeelding' : 'pagina'
  return (
    <div className="mai-map-imagegrid">
      <figure className="mai-map-figure">
        {image && image.url ? (
          <img
            className="mai-map-image"
            src={image.url}
            alt={`Menukaart-${kindLabel} ${image.number} van ${card.page.total}`}
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="mai-map-image mai-map-image--missing" role="note">
            <span>De {kindLabel} zelf wordt hier niet getoond; je ziet de herkomst per gerecht.</span>
          </div>
        )}
        <figcaption className="mai-why">
          {isImage
            ? `Afbeelding ${image ? image.number : card.page.number} van ${card.page.total}`
            : `Pagina ${card.page.number} van ${card.page.total}`}
          {image && image.alt ? ` · ${image.alt}` : ''}
        </figcaption>
      </figure>
      <div className="mai-map-dishelist">
        <h4 className="mai-map-dishelist-title">Gerechten van deze {kindLabel}</h4>
        {dishes.length === 0 ? (
          <p className="mai-why">Van deze {kindLabel} is geen gerecht gelezen.</p>
        ) : (
          <ul className="mai-map-dishes">
            {dishes.map((dish) => (
              <li key={dish.rowId} className="mai-map-dish">
                <span className="mai-map-dish-name">
                  {dish.name || 'Gerecht zonder naam'} <span className="mai-review-price">{dish.priceText}</span>
                </span>
                <span className="status-badge status-badge--old">{dish.label}</span>
                {dish.provenance ? <span className="mai-provenance">{dish.provenance}</span> : null}
                {onShowRow ? (
                  <button
                    type="button"
                    className="stg-btn-secondary mai-btn"
                    disabled={busy}
                    aria-label={`Nalopen in de lijst: ${dish.name || 'dit gerecht'}`}
                    onClick={() => onShowRow(dish.rowId)}
                  >
                    Nalopen in de lijst
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/** De regels van de kaart met hun markering en, onder de markering, het paneel. */
function CardLines({ card, marksById, openMarkId, focusMarkId, busy, onOpenMark, onAdd, onNotDish, onTakePrice, onCorrect }) {
  if (card.page.lines.length === 0) {
    return <p className="mai-why">Deze kaart heeft geen leesbare regels om te vergelijken.</p>
  }
  return (
    <ol className="mai-map-lines" aria-label="Regels van de kaart">
      {card.page.lines.map((line) => {
        const mark = line.markId ? marksById.get(line.markId) : null
        const showPanel = Boolean(mark && openMarkId === mark.id && mark.endLine === line.number)
        const focused = Boolean(mark && focusMarkId === mark.id && mark.endLine === line.number)
        return (
          <li
            key={`${line.number}`}
            className={`mai-map-line${line.tone ? ` mai-map-line--${line.tone}` : ''}${focused ? ' mai-map-line--focus' : ''}`}
            data-line={line.number}
            data-mark-id={line.marker ? line.markId : undefined}
          >
            {line.marker ? (
              <button
                type="button"
                className={`mai-map-mark mai-map-mark--${line.tone}`}
                aria-expanded={openMarkId === line.markId}
                aria-controls={`mai-map-panel-${line.markId}`}
                aria-label={line.ariaLabel}
                title={line.ariaLabel}
                onClick={() => onOpenMark(line.markId)}
              >
                <span className={`mai-map-dot mai-map-dot--${line.tone}`} aria-hidden="true">
                  {GLYPH[line.tone] || '•'}
                </span>
              </button>
            ) : (
              <span className="mai-map-mark-space" aria-hidden="true" />
            )}
            <span className="mai-map-text">{line.text}</span>
            {showPanel && mark ? (
              <MarkPanel mark={mark} busy={busy} onAdd={onAdd} onNotDish={onNotDish} onTakePrice={onTakePrice} onCorrect={onCorrect} />
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

/** Het paneel onder een markering: per kleur precies de toegestane acties. */
function MarkPanel({ mark, busy, onAdd, onNotDish, onTakePrice, onCorrect }) {
  const title = mark.label || 'Markering'
  return (
    <div
      id={`mai-map-panel-${mark.id}`}
      className={`mai-map-panel mai-map-panel--${mark.tone}`}
      role="region"
      aria-label={`${title}: ${mark.ariaLabel}`}
    >
      <p className="mai-map-panel-title">{title}</p>
      {mark.tone === 'covered' ? (
        <p className="mai-map-panel-line">
          {mark.name || 'Regel zonder gerechtnaam'}
          {mark.conceptPriceText ? ` · concept ${mark.conceptPriceText}` : ' · prijs onbekend in het concept'}
        </p>
      ) : null}
      {mark.tone === 'price_mismatch' ? (
        <>
          <p className="mai-map-panel-price">
            Kaart {mark.priceText || 'onbekend'} · concept {mark.conceptPriceText || 'onbekend'}
          </p>
          {mark.priceTaken ? (
            <p className="mai-map-panel-done" role="status">
              {mark.takenPriceText} overgenomen uit de kaart. Bij opslaan krijgt dit gerecht die prijs.
            </p>
          ) : (
            <div className="mai-row-actions">
              <button
                type="button"
                className="di-btn-primary mai-btn"
                disabled={busy}
                aria-label={`Neem ${mark.priceText || 'de prijs'} over voor ${mark.name || 'dit gerecht'}`}
                onClick={() => onTakePrice(mark)}
              >
                Neem {mark.priceText || 'de prijs'} over
              </button>
              <button
                type="button"
                className="stg-btn-secondary mai-btn"
                disabled={busy}
                aria-label={`Wijzig ${mark.name || 'dit gerecht'}`}
                onClick={() => onCorrect(mark)}
              >
                Wijzig
              </button>
            </div>
          )}
        </>
      ) : null}
      {mark.tone === 'uncovered' ? (
        <>
          <p className="mai-map-panel-line">{mark.name || 'Losse prijsregel zonder gerechtnaam'}</p>
          {mark.loose ? (
            <p className="mai-why">
              Deze regel print alleen een prijs; de app verzint er geen gerechtnaam bij. Voeg het gerecht zo nodig met de
              hand toe.
            </p>
          ) : null}
          <div className="mai-row-actions">
            {mark.canAdd ? (
              <button
                type="button"
                className="di-btn-primary mai-btn"
                disabled={busy}
                aria-label={`Toevoegen: ${mark.name || mark.locator}`}
                onClick={() => onAdd(mark)}
              >
                Toevoegen
              </button>
            ) : null}
            <button
              type="button"
              className="stg-btn-secondary mai-btn"
              disabled={busy}
              aria-label={`Geen gerecht: ${mark.name || mark.locator}`}
              onClick={() => onNotDish(mark)}
            >
              Geen gerecht
            </button>
          </div>
        </>
      ) : null}
      {mark.tone === 'not_dish' ? (
        <p className="mai-map-panel-line">Deze regel telt als geen gerecht en komt niet terug.</p>
      ) : null}
      <p className="mai-why">{mark.locator}</p>
    </div>
  )
}
