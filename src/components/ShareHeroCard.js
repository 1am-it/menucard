// BE-65 (#157) — de kaart in de hero: "Zin in iets? Stuur het door."
//
// Drie tabjes (Eén gerecht, Een lijstje, Laat stemmen) met per tabje één
// statisch chatvoorbeeld en één regel uitleg. De voorbeelden zijn vaste
// teksten in deze code, geen live data: een algemeen gerecht, een fictieve
// prijs en de naam "Restaurant in Breda". Zo leert de kaart wat de bestaande
// deel- en bewaarfunctie doet zonder een echt restaurant te claimen.
//
// Waarom dit een Server Component is (Lead-review ronde 3, punt 3): de kaart
// heeft geen client-JS nodig. Wisselen tussen de voorbeelden doet de browser
// zelf met drie radio's in een <fieldset> en CSS `:checked ~`; de drie
// voorbeelden staan alle drie als HTML in de pagina en de verborgen
// voorbeelden zijn met `display: none` echt verborgen. De pijltjestoetsen
// bedienen de radiogroep, de juiste rol voor "kies één van drie" (dus beter
// dan de aria-pressed-knoppen van ronde 2). Zo kost de kaart niets van het
// eerste JS-pakket van /.
//
// De radio's liggen onzichtbaar precies over hun tabje (zie
// share-hero-card.css), zodat het tikdoel het hele tabje is en niet een piep-
// klein rondje. Kleuren komen alleen uit de bestaande tokens.

import { Fragment } from 'react'
import './share-hero-card.css'

// Vaste id's: één kaart per pagina, dus geen useId nodig (en useId zou van
// deze kaart weer een client component maken).
const ID_PREFIX = 'share-hero-kaart'
const GROUP_NAME = `${ID_PREFIX}-voorbeeld`

// De voorbeeldinhoud. Alles hier is vast: geen props, geen data, geen fetch.
// `short` is het label tot en met 640 px, zodat de drie tabjes ook op 320 px
// op één regel passen (Lead-review ronde 3, punt 2).
export const SHARE_HERO_TABS = [
  {
    id: 'een',
    label: 'Eén gerecht',
    short: 'Eén gerecht',
    figureLabel: 'Voorbeeld: één gerecht doorsturen in een chat',
    bubble: 'Zaterdag hier lunchen?',
    note: 'Tik bij een gerecht op Delen.',
  },
  {
    id: 'lijstje',
    label: 'Een lijstje',
    short: 'Lijstje',
    figureLabel: 'Voorbeeld: een lijstje met drie gerechten doorsturen',
    bubble: 'Welke zullen we doen?',
    note: 'Bewaar een paar gerechten en stuur je lijstje in één keer.',
  },
  {
    id: 'stemmen',
    label: 'Laat stemmen',
    short: 'Stemmen',
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
    { name: 'Pasta pesto', votes: '3× lekker', share: 75, leader: true },
    { name: 'Huisgemaakte burger', votes: '1× lekker', share: 25, leader: false },
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
          <li key={row.name} className="share-hero-vote-row">
            <span className="share-hero-vote-line">
              <span className={`share-hero-vote-name${row.leader ? ' is-leader' : ''}`}>{row.name}</span>
              <span className="share-hero-vote-count">{row.votes}</span>
            </span>
            {/* Het balkje: gevuld deel in --text-primary, de rest in --border. */}
            <span className="share-hero-vote-track" aria-hidden="true">
              <span className={`share-hero-vote-fill share-hero-vote-fill--${row.share}`} />
            </span>
          </li>
        ))}
      </ul>
      <span className="share-hero-domain">{DOMAIN}</span>
    </div>
  )
}

const EXAMPLES = { een: OneDishExample, lijstje: ListExample, stemmen: VoteExample }

export default function ShareHeroCard() {
  return (
    <section className="share-hero" aria-labelledby={`${ID_PREFIX}-title`}>
      <h2 className="share-hero-title" id={`${ID_PREFIX}-title`}>
        Zin in iets? Stuur het door.
      </h2>
      <p className="share-hero-sub">Met prijs en restaurant erbij. Niemand hoeft iets te installeren.</p>

      <fieldset className="share-hero-switch" aria-label="Kies een voorbeeld van delen">
        {SHARE_HERO_TABS.map((tab, index) => (
          <Fragment key={tab.id}>
            <input
              className="share-hero-radio"
              type="radio"
              name={GROUP_NAME}
              id={`${ID_PREFIX}-${tab.id}`}
              value={tab.id}
              defaultChecked={index === 0}
            />
            <label className="share-hero-tab" htmlFor={`${ID_PREFIX}-${tab.id}`}>
              <span className="share-hero-tab-full">{tab.label}</span>
              <span className="share-hero-tab-short">{tab.short}</span>
            </label>
          </Fragment>
        ))}

        {SHARE_HERO_TABS.map((tab) => {
          const Example = EXAMPLES[tab.id]
          return (
            <figure
              key={tab.id}
              className={`share-hero-example share-hero-example--${tab.id}`}
              aria-label={tab.figureLabel}
            >
              <p className="share-hero-bubble">{tab.bubble}</p>
              <Example />
              <figcaption className="share-hero-note">{tab.note}</figcaption>
            </figure>
          )
        })}
      </fieldset>
    </section>
  )
}
