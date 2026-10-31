'use client'

// BE-57 (#139, deel 2) — het cijferblok van één restaurant op "Mijn restaurant".
//
// Dit component beslist niets: het krijgt het schermmodel van
// src/lib/ownerStatsView.js binnen en tekent het. Alle teksten, de
// privacydrempel ("minder dan 5"), de standen "net geclaimd" en "nog geen
// cijfers" en de datum van de menukaart staan daar en zijn daar getest.
//
// Wat er bewust niet staat (contract "Grenzen" en de Lead-opdracht): geen
// QR-code, geen mailregel, geen label "Bevestigd" en geen knop "Menukaart
// bijwerken". De drie dingen om mee te beginnen zijn tekst, geen link.
//
// De opmaak staat in mijn-restaurant-cijfers.css naast dit bestand (BE-52).

import Link from 'next/link'
import './mijn-restaurant-cijfers.css'

function MenuCard({ menu }) {
  return (
    <div className="owner-menu">
      <h4 className="owner-stats-subtitle">{menu.title}</h4>
      <p className="owner-note">{menu.note}</p>
      {menu.href && (
        <Link className="owner-link" href={menu.href}>
          {menu.linkLabel}
        </Link>
      )}
    </div>
  )
}

function WeekBlock({ week, top }) {
  return (
    <>
      <h4 className="owner-stats-subtitle">{week.title}</h4>
      <dl className="owner-figures">
        {week.figures.map((figure) => (
          <div className="owner-figure" key={figure.id}>
            <dt className="owner-figure-label">{figure.label}</dt>
            <dd className="owner-figure-value">
              <span className={`owner-figure-number owner-figure-number--${figure.id}`}>{figure.value}</span>
              {figure.change && <span className="owner-figure-change">{figure.change}</span>}
            </dd>
          </div>
        ))}
      </dl>
      <p className="owner-privacy">{week.privacy}</p>

      <h4 className="owner-stats-subtitle">{top.title}</h4>
      {top.rows.length === 0 ? (
        <p className="owner-note">{top.emptyNote}</p>
      ) : (
        <ol className="owner-top">
          {top.rows.map((row) => (
            <li className="owner-top-row" key={row.dishKey}>
              <span className="owner-top-name">{row.name}</span>
              <span className="owner-top-value">{row.shown}</span>
              <span className="owner-top-track" aria-hidden="true">
                <span className="owner-top-bar" style={{ width: `${row.percent}%` }} />
              </span>
            </li>
          ))}
        </ol>
      )}
    </>
  )
}

function WelcomeBlock({ welcome }) {
  return (
    <div className="owner-welcome">
      <h4 className="owner-stats-subtitle">{welcome.title}</h4>
      <p className="owner-note">{welcome.body}</p>
      <h5 className="owner-stats-minor">{welcome.monthTitle}</h5>
      <dl className="owner-month">
        {welcome.figures.map((figure) => (
          <div className="owner-month-figure" key={figure.id}>
            <dt className="owner-figure-label">{figure.label}</dt>
            <dd className="owner-figure-value">{figure.value}</dd>
          </div>
        ))}
      </dl>
      <h5 className="owner-stats-minor">{welcome.startTitle}</h5>
      <ol className="owner-start">
        {welcome.startItems.map((item) => (
          <li className="owner-start-item" key={item}>
            {item}
          </li>
        ))}
      </ol>
    </div>
  )
}

export default function OwnerStatsPanel({ view }) {
  if (!view) {
    return (
      <p className="owner-note" role="status">
        Cijfers laden…
      </p>
    )
  }

  return (
    <div className="owner-stats">
      {view.status === 'cijfers' && <WeekBlock week={view.week} top={view.top} />}
      {view.status === 'net-geclaimd' && <WelcomeBlock welcome={view.welcome} />}
      {view.problem && (
        <p className="owner-note owner-stats-problem" role="status">
          {view.problem}
        </p>
      )}
      <MenuCard menu={view.menu} />
    </div>
  )
}
