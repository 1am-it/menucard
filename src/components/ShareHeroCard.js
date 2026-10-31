'use client'

// BE-65 (#157) — de kaart in de hero: "Zin in iets? Stuur het door."
//
// Drie tabjes (Eén gerecht, Een lijstje, Laat stemmen) met per tabje één
// statisch chatvoorbeeld en één regel uitleg. De voorbeelden zijn vaste
// teksten in deze code, geen live data: een algemeen gerecht, een fictieve
// prijs en de naam "Restaurant in Breda". Zo leert de kaart wat de bestaande
// deel- en bewaarfunctie doet zonder een echt restaurant te claimen.
//
// De tabjes zijn echte <button>s met aria-pressed in een role="group" met een
// aria-label; het voorbeeld is een <figure> met een eigen aria-label, zodat de
// voorlezer zegt wat er wordt voorgelezen. Kleuren komen alleen uit de
// bestaande tokens (share-hero-card.css), in licht en donker.

import { useCallback, useId, useState } from 'react'
import './share-hero-card.css'

// De voorbeeldinhoud. Alles hier is vast: geen props, geen data, geen fetch.
export const SHARE_HERO_TABS = [
  {
    id: 'een',
    label: 'Eén gerecht',
    figureLabel: 'Voorbeeld: één gerecht doorsturen in een chat',
    bubble: 'Zaterdag hier lunchen?',
    note: 'Tik bij een gerecht op Delen.',
  },
  {
    id: 'lijstje',
    label: 'Een lijstje',
    figureLabel: 'Voorbeeld: een lijstje met drie gerechten doorsturen',
    bubble: 'Welke zullen we doen?',
    note: 'Bewaar een paar gerechten en stuur je lijstje in één keer.',
  },
  {
    id: 'stemmen',
    label: 'Laat stemmen',
    figureLabel: 'Voorbeeld: een lijstje met stemmen doorsturen',
    bubble: 'Stem even, ik reserveer!',
    note: 'Stuur je lijstje met stemmen aan. Iedereen kiest, jij ziet de winnaar. Zonder account.',
  },
]

// De fictieve gerechten van de voorbeelden: één gerecht, het lijstje en de
// twee balkjes van het stemvoorbeeld.
const EXAMPLE_DISH = { name: 'Pasta pesto', price: '€ 12,50', restaurant: 'Restaurant in Breda' }
const EXAMPLE_LIST = {
  heading: 'Lijstje · 3 gerechten',
  rows: [
    { name: 'Pasta pesto', price: '€ 12,50' },
    { name: 'Huisgemaakte burger', price: '€ 15,50' },
    { name: 'Steak tartaar', price: '€ 14,00' },
  ],
}
const EXAMPLE_VOTE = {
  heading: 'Stem mee · 4 van 5 gestemd',
  rows: [
    { label: '3× lekker', width: 'more' },
    { label: '1× lekker', width: 'less' },
  ],
}

const DOMAIN = 'onzemenukaarten.nl'

function OneDishExample() {
  return (
    <div className="share-hero-linkcard">
      <span className="share-hero-strip" aria-hidden="true" />
      <span className="share-hero-linkcard-body">
        <span className="share-hero-dish">{EXAMPLE_DISH.name}</span>
        <span className="share-hero-meta">
          {EXAMPLE_DISH.restaurant} · {EXAMPLE_DISH.price}
        </span>
        <span className="share-hero-domain">{DOMAIN}</span>
      </span>
    </div>
  )
}

function ListExample() {
  return (
    <div className="share-hero-linkcard">
      <span className="share-hero-cardtitle">{EXAMPLE_LIST.heading}</span>
      <ul className="share-hero-rows">
        {EXAMPLE_LIST.rows.map((row) => (
          <li key={row.name} className="share-hero-row">
            <span className="share-hero-row-name">{row.name}</span>
            <span className="share-hero-row-price">{row.price}</span>
          </li>
        ))}
      </ul>
      <span className="share-hero-domain">{DOMAIN}</span>
    </div>
  )
}

function VoteExample() {
  return (
    <div className="share-hero-linkcard">
      <span className="share-hero-cardtitle">{EXAMPLE_VOTE.heading}</span>
      <ul className="share-hero-rows">
        {EXAMPLE_VOTE.rows.map((row) => (
          <li key={row.label} className={`share-hero-bar share-hero-bar--${row.width}`}>
            {row.label}
          </li>
        ))}
      </ul>
      <span className="share-hero-domain">{DOMAIN}</span>
    </div>
  )
}

export default function ShareHeroCard() {
  const [activeId, setActiveId] = useState(SHARE_HERO_TABS[0].id)
  const titleId = useId()
  const active = SHARE_HERO_TABS.find((tab) => tab.id === activeId) || SHARE_HERO_TABS[0]

  const pick = useCallback((id) => setActiveId(id), [])

  return (
    <section className="share-hero" aria-labelledby={titleId}>
      <h2 className="share-hero-title" id={titleId}>
        Zin in iets? Stuur het door.
      </h2>
      <p className="share-hero-sub">Met prijs en restaurant erbij. Niemand hoeft iets te installeren.</p>

      <div className="share-hero-tabs" role="group" aria-label="Kies een voorbeeld van delen">
        {SHARE_HERO_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`share-hero-tab${tab.id === active.id ? ' is-active' : ''}`}
            aria-pressed={tab.id === active.id}
            onClick={() => pick(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <figure className="share-hero-example" aria-label={active.figureLabel}>
        <p className="share-hero-bubble">{active.bubble}</p>
        {active.id === 'een' ? <OneDishExample /> : null}
        {active.id === 'lijstje' ? <ListExample /> : null}
        {active.id === 'stemmen' ? <VoteExample /> : null}
      </figure>

      <p className="share-hero-note">{active.note}</p>
    </section>
  )
}
